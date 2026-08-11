// =============================================================================
// RANKKS — FIFA World Cup History Ingestion (1930–2006)
//
// Fills in the 18 men's World Cup editions missing from the DB (2010, 2014,
// 2018, 2022 and 2026 are already ingested by another process).
//
// Data source: this repo's other ingest scripts (ingest.js, ingest_ucl.js)
// pull live from TheSportsDB or the Kaggle dataset piterfm/fifa-football-world-cup
// linked by the user — both are unreachable from this development sandbox's
// network egress. As an equivalent live source (fetched the same way, at
// ingest time, no bundled data files), this script instead pulls from the
// Fjelstul World Cup Database (github.com/jfjelstul/worldcup) — a
// peer-reviewed academic dataset (cited by BBC, FiveThirtyEight, The
// Washington Post, etc.) covering every men's World Cup 1930-2022 at
// match/goal level, published as CSV on GitHub. Facts (winners, hosts, famous
// matches) were spot-checked against well-known tournament history while
// testing this script against a local Postgres instance.
//
// IMPORTANT — verify before running:
//   1. COMPETITION_SLUG below must match the slug of the FIFA World Cup row
//      already in your `competitions` table (the one used by 2010-2026).
//   2. ENTITY_TYPE must match the entity_type your DB already uses for
//      national teams (e.g. 'national_team'). Adjust if different.
//   3. Historical nation names are preserved as they competed under them
//      (e.g. "West Germany", "Soviet Union", "Czechoslovakia", "Zaire") —
//      these are intentionally kept separate from their modern-day successor
//      entities ("Germany", "Russia", ...) for historical accuracy.
//
// Run: node ingest_worldcup_history.js
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
const COMPETITION_SLUG = 'fifa-world-cup-men'; // ⚠️ verify against your `competitions` table
const ENTITY_TYPE       = 'national_team';  // ⚠️ verify against your `entities` table
const ALIAS_SOURCE       = 'worldcup-history';

const CSV_BASE = 'https://raw.githubusercontent.com/jfjelstul/worldcup/master/data-csv';

// The dataset also contains Women's World Cups (under other years); this is
// the exact set of men's tournament_ids for the 18 editions missing from the DB.
const MEN_TOURNAMENT_IDS = new Set(
  [1930, 1934, 1938, 1950, 1954, 1958, 1962, 1966, 1970, 1974, 1978, 1982, 1986, 1990, 1994, 1998, 2002, 2006]
    .map(y => `WC-${y}`)
);

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

function titleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

const int = (v, fallback = 0) => (v === '' || v == null ? fallback : parseInt(v, 10));

// ── DB helpers ───────────────────────────────────────────────────────────────
async function getCompetitionId() {
  const res = await pool.query('SELECT id FROM competitions WHERE slug = $1', [COMPETITION_SLUG]);
  if (!res.rows[0]) {
    throw new Error(
      `Competition not found for slug "${COMPETITION_SLUG}". ` +
      `Update COMPETITION_SLUG at the top of this script to match your existing FIFA World Cup row.`
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

async function upsertSeason(client, { competition_id, year, status }) {
  const res = await client.query(`
    INSERT INTO seasons (competition_id, year, status)
    VALUES ($1, $2, $3)
    ON CONFLICT (competition_id, event_id, year, gender)
    DO UPDATE SET status = EXCLUDED.status
    RETURNING id
  `, [competition_id, year, status]);
  return res.rows[0].id;
}

async function upsertResultTab(client, { season_id, tab_name, tab_key, typology, display_order, is_default }) {
  const res = await client.query(`
    INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (season_id, tab_key) DO UPDATE SET
      tab_name = EXCLUDED.tab_name,
      display_order = EXCLUDED.display_order,
      is_default = EXCLUDED.is_default
    RETURNING id
  `, [season_id, tab_name, tab_key, typology, display_order, is_default]);
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
    const season_id = await upsertSeason(client, { competition_id, year, status: 'past' });

    const tournamentMatches = data.matches.filter(m => m.tournament_id === tournament.tournament_id);
    const groupMatches      = tournamentMatches.filter(m => m.group_stage === '1');
    const knockoutMatches   = tournamentMatches.filter(m => m.knockout_stage === '1');

    // ── Games: group stage ──
    const groupTabId = await upsertResultTab(client, {
      season_id, tab_name: 'Group Stage', tab_key: 'group-stage',
      typology: 'game', display_order: 2, is_default: false,
    });
    await ingestGames(client, groupTabId, groupMatches, data.goalsByMatch, teamEntityMap);

    // ── Games: knockout stage ──
    const knockoutTabId = await upsertResultTab(client, {
      season_id, tab_name: 'Knockout Stage', tab_key: 'knockout',
      typology: 'game', display_order: 3, is_default: false,
    });
    await ingestGames(client, knockoutTabId, knockoutMatches, data.goalsByMatch, teamEntityMap);

    // ── Standings: groups ──
    const groupsTabId = await upsertResultTab(client, {
      season_id, tab_name: 'Groups', tab_key: 'groups',
      typology: 'standings', display_order: 1, is_default: false,
    });
    await ingestGroupStandings(client, groupsTabId, tournament.tournament_id, data.groupStandings, teamEntityMap);

    // ── Standings: final tournament ranking ──
    const finalTabId = await upsertResultTab(client, {
      season_id, tab_name: 'Final Standings', tab_key: 'final-standings',
      typology: 'standings', display_order: 0, is_default: true,
    });
    await ingestTournamentStandings(client, finalTabId, tournament.tournament_id, data.tournamentStandings, teamEntityMap);

    await client.query(`
      INSERT INTO ingestion_log
        (source, competition_id, year, records_total, records_created, status, started_at, completed_at)
      VALUES ('worldcup-history', $1, $2, $3, $3, 'success', NOW(), NOW())
    `, [competition_id, year, tournamentMatches.length]);

    await client.query('COMMIT');
    console.log(`  ✅ ${tournamentMatches.length} matches (${groupMatches.length} group + ${knockoutMatches.length} knockout)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ❌ Error for ${year}:`, err.message);
  } finally {
    client.release();
  }
}

async function ingestGames(client, tab_id, matchList, goalsByMatch, teamEntityMap) {
  await client.query('DELETE FROM games WHERE result_tab_id = $1', [tab_id]);

  for (const m of matchList) {
    const homeEntity = teamEntityMap.get(m.home_team_id);
    const awayEntity = teamEntityMap.get(m.away_team_id);
    if (!homeEntity || !awayEntity) continue;

    let winnerId = null, homeWon = null;
    if (m.result === 'home team win') { winnerId = homeEntity; homeWon = true; }
    else if (m.result === 'away team win') { winnerId = awayEntity; homeWon = false; }

    const scoreJson = {
      home: int(m.home_team_score),
      away: int(m.away_team_score),
      extra_time: m.extra_time === '1',
      penalty: m.penalty_shootout === '1'
        ? { home: int(m.home_team_score_penalties), away: int(m.away_team_score_penalties) }
        : null,
    };

    const goals = goalsByMatch.get(m.match_id) || [];
    const scorers = goals.map(g => ({
      player: `${g.given_name} ${g.family_name}`.trim(),
      team_id: g.team_id,
      minute: int(g.minute_regulation, null),
      extra: int(g.minute_stoppage, 0) || null,
      period: g.match_period,
      own_goal: g.own_goal === '1',
      penalty: g.penalty === '1',
    }));

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
      tab_id, titleCase(m.stage_name), matchNumber,
      m.match_date, m.stadium_name, m.city_name,
      homeEntity, awayEntity, ENTITY_TYPE,
      JSON.stringify(scoreJson), winnerId, homeWon,
      JSON.stringify(scorers),
    ]);
  }
}

async function ingestGroupStandings(client, tab_id, tournament_id, groupStandingsRows, teamEntityMap) {
  await client.query('DELETE FROM standings WHERE result_tab_id = $1', [tab_id]);

  const rows = groupStandingsRows.filter(r => r.tournament_id === tournament_id);

  // Stable group ordering, keyed on stage_name+group_name (not group_name alone) —
  // some tournaments (e.g. 1950) reuse group labels ("Group 1") across stages
  // (first round vs. final round), which would otherwise collide.
  const groupKey = r => `${r.stage_name}|${r.group_name}`;
  const groupKeys = [...new Set(rows.map(groupKey))];

  for (const row of rows) {
    const entityId = teamEntityMap.get(row.team_id);
    if (!entityId) continue;

    const groupIndex = groupKeys.indexOf(groupKey(row)); // 0-based
    // Position encoding: groupIndex*100 + position-in-group keeps (tab_id, position)
    // unique across every group in the tab — decode with:
    // group = floor(position/100), rank = position % 100
    const position = groupIndex * 100 + int(row.position);

    const stats = {
      group: row.group_name,
      stage: row.stage_name,
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

    await client.query(`
      INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (result_tab_id, position) DO UPDATE SET
        entity_id = EXCLUDED.entity_id,
        stats = EXCLUDED.stats
    `, [tab_id, position, entityId, ENTITY_TYPE, JSON.stringify(stats)]);
  }
}

async function ingestTournamentStandings(client, tab_id, tournament_id, tournamentStandingsRows, teamEntityMap) {
  await client.query('DELETE FROM standings WHERE result_tab_id = $1', [tab_id]);

  const rows = tournamentStandingsRows.filter(r => r.tournament_id === tournament_id);

  for (const row of rows) {
    const entityId = teamEntityMap.get(row.team_id);
    if (!entityId) continue;

    await client.query(`
      INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (result_tab_id, position) DO UPDATE SET
        entity_id = EXCLUDED.entity_id,
        stats = EXCLUDED.stats
    `, [tab_id, int(row.position), entityId, ENTITY_TYPE, JSON.stringify({ placement: int(row.position) })]);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  RANKKS — FIFA World Cup History Ingestion (1930–2006)');
  console.log('═══════════════════════════════════════════════════');

  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  await getCompetitionId(); // fail fast if slug is wrong

  console.log('\n📥 Fetching World Cup history data from jfjelstul/worldcup...');
  const [tournamentsAll, matchesAll, goalsAll, groupStandingsAll, tournamentStandingsAll, teamsAll] =
    await Promise.all([
      fetchCSV('tournaments'), fetchCSV('matches'), fetchCSV('goals'),
      fetchCSV('group_standings'), fetchCSV('tournament_standings'), fetchCSV('teams'),
    ]);

  const tournaments = tournamentsAll
    .filter(t => MEN_TOURNAMENT_IDS.has(t.tournament_id))
    .sort((a, b) => int(a.year) - int(b.year));
  const matches = matchesAll.filter(m => MEN_TOURNAMENT_IDS.has(m.tournament_id));
  const goalsByMatch = new Map();
  for (const g of goalsAll) {
    if (!MEN_TOURNAMENT_IDS.has(g.tournament_id)) continue;
    if (!goalsByMatch.has(g.match_id)) goalsByMatch.set(g.match_id, []);
    goalsByMatch.get(g.match_id).push(g);
  }
  const groupStandings = groupStandingsAll.filter(r => MEN_TOURNAMENT_IDS.has(r.tournament_id));
  const tournamentStandings = tournamentStandingsAll.filter(r => MEN_TOURNAMENT_IDS.has(r.tournament_id));

  const teamIdsInPlay = new Set();
  for (const m of matches) { teamIdsInPlay.add(m.home_team_id); teamIdsInPlay.add(m.away_team_id); }
  const teamsById = new Map(teamsAll.map(t => [t.team_id, t]));

  console.log(`   ✅ ${tournaments.length} tournaments, ${matches.length} matches, ${goalsAll.length} goals, ${teamIdsInPlay.size} teams`);

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

  const data = { matches, goalsByMatch, groupStandings, tournamentStandings };
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
