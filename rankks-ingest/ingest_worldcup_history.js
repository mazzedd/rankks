// =============================================================================
// RANKKS — FIFA World Cup History Ingestion
//
// Fills in whichever World Cup editions for the given gender are missing
// from the target competition (editions already present, e.g. men's
// 2010-2026 ingested by another process, are detected from the DB and
// skipped automatically — nothing to hand-maintain per run).
//
// Tab structure matches the real 2010-2026 convention exactly (verified
// against the live DB, not guessed):
//   - One combined games+standings tab per group (typology 'standings_game',
//     tab_group 'group_stages', result_tabs.group_name = bare letter/number
//     e.g. 'A'), not one flat "Groups" + "Group Stage" pair.
//   - One tab per knockout round (typology 'game', tab_group 'final_tour'),
//     not one flat "Knockout Stage" tab. Only 'final' is is_default — unless
//     the tournament has no knockout stage at all (1950, see below), in
//     which case its last group tab takes that role instead.
//   - No "Final Standings" tab — the real convention has no such tab; the
//     Final + 3rd Place games are the only tournament-wide placement shown.
//   - Game `score` JSON matches the real shape (status/fulltime/halftime/
//     extratime/penalty), reconstructed from goals.csv's per-goal
//     match_period since the dataset doesn't provide halftime/fulltime
//     splits directly.
//
// Historical format quirks handled:
//   - 1934/1938: no group stage at all, straight knockout from round one.
//   - 1950: no knockout stage at all — decided by a 4-team final round-robin
//     group instead of a final match. Modeled as an extra group tab
//     ("Final Round"); becomes this season's is_default tab since there's
//     no 'final' game tab to hold that role.
//   - 1974/1978: two-stage groups — first round (numbered) then a second
//     round-robin group stage (lettered) before the actual Final/3rd Place.
//   - 1982: two-stage groups where BOTH stages reuse the same numeric
//     labels (Group 1-6 first round, Group 1-4 second round) — tab_key
//     disambiguates second-stage groups with a '-2nd' suffix.
//   - Uneven/withdrawal-affected group sizes (1930, 1954, 1958) — handled
//     automatically since games/standings are read straight from the
//     source data, not assumed to be a fixed 6-per-group round robin.
//
// Data source: this repo's other ingest scripts (ingest.js, ingest_ucl.js)
// pull live from TheSportsDB or the Kaggle dataset piterfm/fifa-football-world-cup
// linked by the user — both are unreachable from this development sandbox's
// network egress. As an equivalent live source (fetched the same way, at
// ingest time, no bundled data files), this script instead pulls from the
// Fjelstul World Cup Database (github.com/jfjelstul/worldcup) — a
// peer-reviewed academic dataset (cited by BBC, FiveThirtyEight, The
// Washington Post, etc.) covering every men's World Cup 1930-2022 and every
// women's World Cup 1991-2019 at match/goal level, published as CSV on
// GitHub. Facts (winners, hosts, famous matches) were spot-checked against
// well-known tournament history while testing this script against a local
// Postgres instance.
//
// Known gap: per-game "Matchday N" labels inside a group tab are
// reconstructed as the chronological rank of that game's date within the
// group (1st distinct date = Matchday 1, etc.). The real 2010-2026 data
// (ingested by a different process/source) doesn't always follow a clean
// round-robin pairing — e.g. two games played on the same decisive final
// matchday can carry different Matchday numbers there — and that exact
// numbering isn't recoverable from this dataset. This is a cosmetic label
// only; it doesn't affect tab structure, scores, or standings.
//
// IMPORTANT — verify before running:
//   1. --slug must match an existing row in your `competitions` table.
//   2. ENTITY_TYPE must match the entity_type your DB already uses for
//      national teams (e.g. 'national_team'). Adjust if different. Team
//      entities are shared across genders (e.g. one "France" entity plays
//      in both the men's and women's competitions) — only seasons carry a
//      gender column, so this does not need to vary by --gender.
//   3. Historical nation names are preserved as they competed under them
//      (e.g. "West Germany", "Soviet Union", "Czechoslovakia", "Zaire") —
//      these are intentionally kept separate from their modern-day successor
//      entities ("Germany", "Russia", ...) for historical accuracy.
//
// Run:
//   node ingest_worldcup_history.js --gender men   --slug fifa-world-cup-men
//   node ingest_worldcup_history.js --gender women --slug fifa-world-cup-women
// =============================================================================

require('dotenv').config({ path: '../rankks-api/.env' });
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'rankks',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// ── Config ───────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--gender') args.gender = process.argv[++i];
    else if (process.argv[i] === '--slug') args.slug = process.argv[++i];
  }
  if (!['men', 'women'].includes(args.gender) || !args.slug) {
    console.error('Usage: node ingest_worldcup_history.js --gender <men|women> --slug <competition_slug>');
    process.exit(1);
  }
  return args;
}

const { gender: GENDER, slug: COMPETITION_SLUG } = parseArgs();
const ENTITY_TYPE  = 'national_team';  // ⚠️ verify against your `entities` table — shared across genders, see note above
const ALIAS_SOURCE = 'worldcup-history';

// jfjelstul/worldcup tournament_name reads e.g. "1930 FIFA Men's World Cup" /
// "1991 FIFA Women's World Cup" — case-sensitive match required: "Women's"
// lowercase-contains "men's", so a case-insensitive check on "Men's" would
// wrongly match women's editions too.
const TOURNAMENT_NAME_FILTER = GENDER === 'women' ? "Women's" : "Men's";
const SEASON_GENDER = GENDER === 'women' ? 'F' : 'M'; // matches this DB's M/F convention (entities.gender on players)

const CSV_BASE = 'https://raw.githubusercontent.com/jfjelstul/worldcup/master/data-csv';

// Every historical round-robin stage the dataset uses. 'final round' is
// 1950's unique decisive group (its group_name is 'not applicable' — see
// groupTabInfo below).
const ROUND_ROBIN_STAGES = new Set(['group stage', 'second group stage', 'final round']);
const STAGE_SORT_RANK = { 'group stage': 0, 'second group stage': 1, 'final round': 2 };

// Fixed final_tour slots, matching the real result_tabs rows on every
// existing 2010-2026 season exactly (tab_key/tab_name/display_order/
// is_default). tab_key doubles as games.round for these tabs (verified
// against the live DB: round='final', not 'Final').
const KNOCKOUT_STAGE_MAP = {
  'final':             { tab_key: 'final',           tab_name: 'Final',          display_order: 10, is_default: true },
  'third-place match': { tab_key: '3rd-place',        tab_name: '3rd Place',      display_order: 11, is_default: false },
  'semi-finals':       { tab_key: 'semi-finals',      tab_name: 'Semifinals',     display_order: 12, is_default: false },
  'quarter-finals':    { tab_key: 'quarter-finals',   tab_name: 'Quarter Finals', display_order: 13, is_default: false },
  'round of 16':       { tab_key: 'round-of-16',      tab_name: 'Round of 16',    display_order: 14, is_default: false },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Minimal RFC 4180 CSV parser (handles quoted fields with commas/quotes) ──
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  return rows.map(r => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])));
}

async function fetchCSV(name) {
  const res = await fetch(`${CSV_BASE}/${name}.csv`);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${name}.csv`);
  return parseCSV(await res.text());
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const int = (v, fallback = 0) => (v === '' || v == null ? fallback : parseInt(v, 10));

// Group label/tab_key generation, handling every historical anomaly found
// in the source data (see header comment): 1950's unnamed decisive group,
// and 1974/1978/1982's second-stage groups (which reuse group labels from
// the first stage — 1982 reuses them exactly, "Group 1".."Group 4" twice).
function groupTabInfo(stageName, groupName) {
  if (groupName === 'not applicable') {
    return { label: 'Final Round', tabKey: 'final-round', groupLabel: null };
  }
  const bare = groupName.replace(/^Group\s*/i, ''); // "A" or "1"
  const isPrimary = stageName === 'group stage';
  return {
    label: isPrimary ? groupName : `${groupName} (2nd Round)`,
    tabKey: `group-${slugify(bare)}${isPrimary ? '' : '-2nd'}`,
    groupLabel: bare,
  };
}

// Reconstructs the real score JSON shape (status/fulltime/halftime/
// extratime/penalty) from the match row's authoritative final score plus
// this match's goals (for the halftime/fulltime split) — the dataset gives
// no halftime/fulltime score directly, only the final score plus
// extra_time/penalty flags, so those splits must be derived from
// individual goal timings (goals.csv's match_period).
function buildScore(m, goals) {
  const final = { home: int(m.home_team_score), away: int(m.away_team_score) };
  const isET  = m.extra_time === '1';
  const isPen = m.penalty_shootout === '1';

  const tally = (pred) => goals.reduce((acc, g) => {
    if (!pred(g)) return acc;
    if (g.home_team === '1') acc.home++;
    else if (g.away_team === '1') acc.away++;
    return acc;
  }, { home: 0, away: 0 });

  const isFirstHalf  = (g) => g.match_period === 'first half' || g.match_period === 'first half, stoppage time';
  const isSecondHalf = (g) => g.match_period === 'second half' || g.match_period === 'second half, stoppage time';

  const halftime  = tally(isFirstHalf);
  // When there's no extra time, the match ended at 90' — the final score
  // IS the fulltime score, no need to re-derive it from goal tallies.
  const fulltime  = isET ? tally((g) => isFirstHalf(g) || isSecondHalf(g)) : final;
  const extratime = isET ? { home: final.home - fulltime.home, away: final.away - fulltime.away } : null;

  return {
    home: final.home,
    away: final.away,
    status: isPen ? 'PEN' : (isET ? 'AET' : 'FT'),
    penalty: isPen ? { home: int(m.home_team_score_penalties), away: int(m.away_team_score_penalties) } : null,
    fulltime,
    halftime,
    extratime,
  };
}

// Mononym players (e.g. Bebeto) have given_name literally set to the
// string 'not applicable' in this dataset rather than being left blank —
// naive concatenation produced scorer entries like "not applicable Bebeto".
const namePart = (v) => (v === 'not applicable' ? '' : v);

function buildScorers(goals) {
  return goals.map(g => ({
    team: g.team_name,
    player: `${namePart(g.given_name)} ${namePart(g.family_name)}`.trim(),
    minute: int(g.minute_regulation, null),
    extra: int(g.minute_stoppage, 0) || null,
    detail: g.penalty === '1' ? 'Penalty' : (g.own_goal === '1' ? 'Own Goal' : 'Normal Goal'),
    assist: null, // not available in this dataset
  }));
}

// ── DB helpers ───────────────────────────────────────────────────────────────
async function getCompetitionId() {
  const res = await pool.query('SELECT id FROM competitions WHERE slug = $1', [COMPETITION_SLUG]);
  if (!res.rows[0]) {
    throw new Error(
      `Competition not found for slug "${COMPETITION_SLUG}". ` +
      `Create the competition row first (or pass the correct --slug).`
    );
  }
  return res.rows[0].id;
}

async function upsertTeamEntity(client, name) {
  const aliasRes = await client.query(
    'SELECT entity_id FROM entity_aliases WHERE alias = $1 AND source = $2',
    [name, ALIAS_SOURCE]
  );
  if (aliasRes.rows[0]) return aliasRes.rows[0].entity_id;

  const nameRes = await client.query(
    'SELECT id FROM entities WHERE canonical_name = $1 AND entity_type = $2',
    [name, ENTITY_TYPE]
  );

  let entityId;
  if (nameRes.rows[0]) {
    entityId = nameRes.rows[0].id;
  } else {
    const insertRes = await client.query(`
      INSERT INTO entities (canonical_name, slug, entity_type, is_active, is_verified)
      VALUES ($1, $2, $3, true, false)
      ON CONFLICT (slug) DO UPDATE SET canonical_name = entities.canonical_name
      RETURNING id
    `, [name, slugify(name), ENTITY_TYPE]);
    entityId = insertRes.rows[0].id;
  }

  await client.query(`
    INSERT INTO entity_aliases (entity_id, alias, source)
    VALUES ($1, $2, $3)
    ON CONFLICT (alias, source) DO NOTHING
  `, [entityId, name, ALIAS_SOURCE]);

  return entityId;
}

async function upsertSeason(client, { competition_id, year, gender, status, start_date, end_date }) {
  const res = await client.query(`
    INSERT INTO seasons (competition_id, event_id, year, gender, sub_edition, category, status, start_date, end_date)
    VALUES ($1, NULL, $2, $3, 1, NULL, $4, $5, $6)
    ON CONFLICT (competition_id, event_id, year, gender, sub_edition, category)
    DO UPDATE SET status = EXCLUDED.status, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
    RETURNING id
  `, [competition_id, year, gender, status, start_date || null, end_date || null]);
  return res.rows[0].id;
}

async function upsertResultTab(client, { season_id, tab_name, tab_key, typology, display_order, is_default, tab_group = null, group_name = null }) {
  const res = await client.query(`
    INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default, tab_group, group_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (season_id, tab_key) DO UPDATE SET
      tab_name = EXCLUDED.tab_name,
      display_order = EXCLUDED.display_order,
      is_default = EXCLUDED.is_default,
      tab_group = EXCLUDED.tab_group,
      group_name = EXCLUDED.group_name
    RETURNING id
  `, [season_id, tab_name, tab_key, typology, display_order, is_default, tab_group, group_name]);
  return res.rows[0].id;
}

// ── Ingest one tournament ────────────────────────────────────────────────────
async function ingestTournament(tournament, data, teamEntityMap) {
  const year = int(tournament.year);
  console.log(`\n🏆 ${year} — ${tournament.host_country} (winner: ${tournament.winner})`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const competition_id = await getCompetitionId();
    const season_id = await upsertSeason(client, {
      competition_id, year, gender: SEASON_GENDER, status: 'past',
      start_date: tournament.start_date, end_date: tournament.end_date,
    });

    const tournamentMatches = data.matches.filter(m => m.tournament_id === tournament.tournament_id);

    // ── Round-robin stages: one combined games+standings tab per group ──
    const groupMatches = tournamentMatches.filter(m => ROUND_ROBIN_STAGES.has(m.stage_name));
    const groupKeys = [...new Set(groupMatches.map(m => `${m.stage_name}|${m.group_name}`))]
      .sort((a, b) => {
        const [as, an] = a.split('|'), [bs, bn] = b.split('|');
        if (STAGE_SORT_RANK[as] !== STAGE_SORT_RANK[bs]) return STAGE_SORT_RANK[as] - STAGE_SORT_RANK[bs];
        return an.localeCompare(bn, undefined, { numeric: true });
      });

    // 1950 has no knockout stage at all (see KNOCKOUT_STAGE_MAP loop below)
    // — its decisive final-round group takes the is_default role instead,
    // so every season still lands somewhere sane by default.
    const hasFinal = tournamentMatches.some(m => m.stage_name === 'final');

    let groupCount = 0;
    for (const gk of groupKeys) {
      const [stageName, groupName] = gk.split('|');
      const info = groupTabInfo(stageName, groupName);
      const isLastGroup = gk === groupKeys[groupKeys.length - 1];

      const tabId = await upsertResultTab(client, {
        season_id, tab_name: info.label, tab_key: info.tabKey,
        typology: 'standings_game', tab_group: 'group_stages', group_name: info.groupLabel,
        display_order: 100 + groupCount, is_default: !hasFinal && isLastGroup,
      });
      groupCount++;

      const thisGroupMatches = groupMatches.filter(m => m.stage_name === stageName && m.group_name === groupName);
      await ingestGroupGames(client, tabId, thisGroupMatches, data.goalsByMatch, teamEntityMap);
      await ingestGroupStandings(client, tabId, tournament.tournament_id, stageName, groupName, data.groupStandings, teamEntityMap);
    }

    // ── Knockout rounds: one tab per real round ──
    const knockoutMatches = tournamentMatches.filter(m => KNOCKOUT_STAGE_MAP[m.stage_name]);
    const presentStages = [...new Set(knockoutMatches.map(m => m.stage_name))]
      .sort((a, b) => KNOCKOUT_STAGE_MAP[a].display_order - KNOCKOUT_STAGE_MAP[b].display_order);

    for (const stageName of presentStages) {
      const info = KNOCKOUT_STAGE_MAP[stageName];
      const tabId = await upsertResultTab(client, {
        season_id, tab_name: info.tab_name, tab_key: info.tab_key,
        typology: 'game', tab_group: 'final_tour',
        display_order: info.display_order, is_default: info.is_default,
      });
      const stageMatches = knockoutMatches.filter(m => m.stage_name === stageName);
      await ingestKnockoutGames(client, tabId, stageMatches, data.goalsByMatch, teamEntityMap);
    }

    await client.query(`
      INSERT INTO ingestion_log
        (source, competition_id, year, records_total, records_created, status, started_at, completed_at)
      VALUES ('worldcup-history', $1, $2, $3, $3, 'success', NOW(), NOW())
    `, [competition_id, year, tournamentMatches.length]);

    await client.query('COMMIT');
    console.log(`  ✅ ${tournamentMatches.length} matches (${groupKeys.length} groups, ${presentStages.length} knockout rounds)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ❌ Error for ${year}:`, err.message);
  } finally {
    client.release();
  }
}

async function ingestGroupGames(client, tab_id, matchList, goalsByMatch, teamEntityMap) {
  await client.query('DELETE FROM games WHERE result_tab_id = $1', [tab_id]);

  // Matchday label = chronological rank of this game's date among the
  // group's distinct match dates — see header comment for why this is an
  // approximation, not a byte-for-byte match of the real 2010-2026 data.
  const uniqueDates = [...new Set(matchList.map(m => m.match_date))].sort();

  for (const m of matchList) {
    const homeEntity = teamEntityMap.get(m.home_team_id);
    const awayEntity = teamEntityMap.get(m.away_team_id);
    if (!homeEntity || !awayEntity) continue;

    let winnerId = null, homeWon = null;
    if (m.result === 'home team win') { winnerId = homeEntity; homeWon = true; }
    else if (m.result === 'away team win') { winnerId = awayEntity; homeWon = false; }

    const goals = goalsByMatch.get(m.match_id) || [];
    const round = `Matchday ${uniqueDates.indexOf(m.match_date) + 1}`;
    const matchNumber = int(m.match_id.split('-').pop());

    await client.query(`
      INSERT INTO games (
        result_tab_id, round, match_number,
        match_date, venue, venue_city,
        home_entity_id, away_entity_id,
        home_entity_type, away_entity_type,
        score, winner_entity_id, home_won, scorers
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13)
      ON CONFLICT DO NOTHING
    `, [
      tab_id, round, matchNumber,
      m.match_date, m.stadium_name, m.city_name,
      homeEntity, awayEntity, ENTITY_TYPE,
      JSON.stringify(buildScore(m, goals)), winnerId, homeWon,
      JSON.stringify(buildScorers(goals)),
    ]);
  }
}

async function ingestKnockoutGames(client, tab_id, matchList, goalsByMatch, teamEntityMap) {
  await client.query('DELETE FROM games WHERE result_tab_id = $1', [tab_id]);

  for (const m of matchList) {
    const homeEntity = teamEntityMap.get(m.home_team_id);
    const awayEntity = teamEntityMap.get(m.away_team_id);
    if (!homeEntity || !awayEntity) continue;

    let winnerId = null, homeWon = null;
    if (m.result === 'home team win') { winnerId = homeEntity; homeWon = true; }
    else if (m.result === 'away team win') { winnerId = awayEntity; homeWon = false; }

    const goals = goalsByMatch.get(m.match_id) || [];
    const round = KNOCKOUT_STAGE_MAP[m.stage_name].tab_key; // matches real convention: round='final', not 'Final'
    const matchNumber = int(m.match_id.split('-').pop());

    await client.query(`
      INSERT INTO games (
        result_tab_id, round, match_number,
        match_date, venue, venue_city,
        home_entity_id, away_entity_id,
        home_entity_type, away_entity_type,
        score, winner_entity_id, home_won, scorers
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13)
      ON CONFLICT DO NOTHING
    `, [
      tab_id, round, matchNumber,
      m.match_date, m.stadium_name, m.city_name,
      homeEntity, awayEntity, ENTITY_TYPE,
      JSON.stringify(buildScore(m, goals)), winnerId, homeWon,
      JSON.stringify(buildScorers(goals)),
    ]);
  }
}

async function ingestGroupStandings(client, tab_id, tournament_id, stageName, groupName, groupStandingsRows, teamEntityMap) {
  await client.query('DELETE FROM standings WHERE result_tab_id = $1', [tab_id]);

  const rows = groupStandingsRows.filter(r =>
    r.tournament_id === tournament_id && r.stage_name === stageName && r.group_name === groupName
  );

  for (const row of rows) {
    const entityId = teamEntityMap.get(row.team_id);
    if (!entityId) continue;

    const stats = {
      played: int(row.played),
      won: int(row.wins),
      drawn: int(row.draws),
      lost: int(row.losses),
      goals_for: int(row.goals_for),
      goals_against: int(row.goals_against),
      goal_diff: int(row.goal_difference),
      points: int(row.points),
      advanced: row.advanced === '1',
    };

    // group_name stays blank here (matching the real convention) — this
    // tab is already scoped to one group, so position alone is unique
    // within it; no need to also stamp the group onto every row.
    await client.query(`
      INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (result_tab_id, COALESCE(group_name, ''::character varying), position) DO UPDATE SET
        entity_id = EXCLUDED.entity_id,
        stats = EXCLUDED.stats
    `, [tab_id, int(row.position), entityId, ENTITY_TYPE, JSON.stringify(stats)]);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(`  RANKKS — FIFA World Cup History Ingestion (${GENDER}, ${COMPETITION_SLUG})`);
  console.log('═══════════════════════════════════════════════════');

  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  const competitionId = await getCompetitionId(); // fail fast if slug is wrong

  const existingYearsRes = await pool.query('SELECT year FROM seasons WHERE competition_id = $1', [competitionId]);
  const existingYears = new Set(existingYearsRes.rows.map(r => r.year));

  console.log('\n📥 Fetching World Cup history data from jfjelstul/worldcup...');
  const [tournamentsAll, matchesAll, goalsAll, groupStandingsAll, teamsAll] =
    await Promise.all([
      fetchCSV('tournaments'), fetchCSV('matches'), fetchCSV('goals'),
      fetchCSV('group_standings'), fetchCSV('teams'),
    ]);

  const tournamentIds = new Set(
    tournamentsAll
      .filter(t => t.tournament_name.includes(TOURNAMENT_NAME_FILTER) && !existingYears.has(int(t.year)))
      .map(t => t.tournament_id)
  );

  const tournaments = tournamentsAll
    .filter(t => tournamentIds.has(t.tournament_id))
    .sort((a, b) => int(a.year) - int(b.year));
  const matches = matchesAll.filter(m => tournamentIds.has(m.tournament_id));
  const goalsByMatch = new Map();
  for (const g of goalsAll) {
    if (!tournamentIds.has(g.tournament_id)) continue;
    if (!goalsByMatch.has(g.match_id)) goalsByMatch.set(g.match_id, []);
    goalsByMatch.get(g.match_id).push(g);
  }
  const groupStandings = groupStandingsAll.filter(r => tournamentIds.has(r.tournament_id));

  const teamIdsInPlay = new Set();
  for (const m of matches) { teamIdsInPlay.add(m.home_team_id); teamIdsInPlay.add(m.away_team_id); }
  const teamsById = new Map(teamsAll.map(t => [t.team_id, t]));

  console.log(`   ✅ ${tournaments.length} tournaments, ${matches.length} matches, ${goalsAll.length} goals, ${teamIdsInPlay.size} teams`);

  if (tournaments.length === 0) {
    console.log(`\n   Nothing to do — every ${GENDER} edition in the dataset is already in "${COMPETITION_SLUG}".`);
    await pool.end();
    return;
  }

  console.log('\n📇 Upserting national team entities...');
  const teamEntityMap = new Map();
  const entityClient = await pool.connect();
  try {
    await entityClient.query('BEGIN');
    for (const team_id of teamIdsInPlay) {
      const team = teamsById.get(team_id);
      if (!team) continue;
      const entityId = await upsertTeamEntity(entityClient, team.team_name);
      teamEntityMap.set(team_id, entityId);
    }
    await entityClient.query('COMMIT');
  } catch (err) {
    await entityClient.query('ROLLBACK');
    throw err;
  } finally {
    entityClient.release();
  }
  console.log(`   ✅ ${teamEntityMap.size} teams resolved`);

  const data = { matches, goalsByMatch, groupStandings };
  for (const tournament of tournaments) {
    await ingestTournament(tournament, data, teamEntityMap);
    await sleep(50);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Ingestion complete!');
  console.log('═══════════════════════════════════════════════════\n');

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
