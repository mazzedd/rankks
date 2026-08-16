// =============================================================================
// RANKKS — FIFA World Cup Players/Teams/Scorers History (1930-2006)
//
// Companion to ingest_worldcup_history.js (which already ingested games/
// standings for these 18 editions). That script left the Players, Teams
// (countries) and Scorers pages empty — this one fills them in from the same
// source (Fjelstul World Cup Database, github.com/jfjelstul/worldcup),
// pulling 3 CSVs that script didn't need: squads.csv (roster),
// player_appearances.csv (games played), players.csv (bio/birth_date).
//
// Passers/Assists is deliberately NOT built — the dataset has no assist data
// anywhere (goals.csv has no assist_player_id column, no separate assists
// file exists), so there's nothing to ingest. No 'passers' result_tab is
// created for these seasons; the Line A nav simply won't show that link for
// pre-2010 editions, same as any other genuine source-data gap.
//
// Team resolution reuses the EXACT SAME alias cache (entity_aliases,
// source='worldcup-history') the original script already populated — so
// e.g. "West Germany" already resolves through that alias to the merged
// Germany entity (id 32693), no separate handling needed here.
//
// Player identity: external_ids->>'worldcup_player_id' (Fjelstul's own
// P-xxxxx id), unique-partial-indexed (idx_entities_worldcup_player) for
// idempotent re-runs — same pattern as F1's idx_entities_f1_driver.
//
// Known limitation: players active across BOTH this 1930-2006 range and the
// already-ingested 2010-2026 range (e.g. Zidane's not one — 1998/2002/2006
// all fall in this range — but plenty of 2006+2010 dual-era players like
// Casillas, Xavi, Messi, Ronaldo exist) will get a SEPARATE entity here,
// since this dataset's player_id has no relation to the api-sports ids the
// 2010+ ingestion used. Their career will show as two disconnected player
// pages instead of one continuous one. Flagged, not fixed — reconciling by
// name would risk false merges, and no shared ID exists between the sources.
//
// Re-runnable: every write is guarded (ON CONFLICT / existence check).
// Run: node ingest_worldcup_players_history.js
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

const COMPETITION_SLUG = 'fifa-world-cup-men';
const ENTITY_TYPE       = 'national_team';
const ALIAS_SOURCE      = 'worldcup-history';
const SPORT_ID           = 1; // football

const CSV_BASE = 'https://raw.githubusercontent.com/jfjelstul/worldcup/master/data-csv';

const YEARS = [1930, 1934, 1938, 1950, 1954, 1958, 1962, 1966, 1970, 1974, 1978, 1982, 1986, 1990, 1994, 1998, 2002, 2006];
const TOURNAMENT_ID_BY_YEAR = Object.fromEntries(YEARS.map(y => [y, `WC-${y}`]));

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
  const header = rows[0];
  return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
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
const namePart = (v) => (v === 'not applicable' || v == null ? '' : v);
// players.csv uses the literal string "not available" for unknown birth
// dates (same 'not applicable' quirk as names elsewhere in this dataset).
const validDate = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Fjelstul's position_name -> the same Goalkeeper/Defender/Midfielder/
// Attacker vocabulary the 2010-2026 ingestion (and the Players page's
// position filter dropdown) already uses.
const POSITION_MAP = {
  'goal keeper': 'Goalkeeper',
  'defender':    'Defender',
  'midfielder':  'Midfielder',
  'forward':     'Attacker',
};

// ── DB helpers ───────────────────────────────────────────────────────────────
async function getCompetitionId() {
  const res = await pool.query('SELECT id FROM competitions WHERE slug = $1', [COMPETITION_SLUG]);
  if (!res.rows[0]) throw new Error(`Competition not found for slug "${COMPETITION_SLUG}".`);
  return res.rows[0].id;
}

// Identical to ingest_worldcup_history.js's own upsertTeamEntity — hits the
// same entity_aliases cache that script already populated, so e.g. "West
// Germany" resolves through its existing alias to the merged Germany entity.
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

const playerEntityCache = new Map(); // worldcup_player_id -> entity_id
const teamCountryCache = new Map();  // team entity_id -> country_id

async function getTeamCountryId(client, teamEntityId) {
  if (teamCountryCache.has(teamEntityId)) return teamCountryCache.get(teamEntityId);
  const r = await client.query('SELECT country_id FROM entities WHERE id = $1', [teamEntityId]);
  const countryId = r.rows[0]?.country_id ?? null;
  teamCountryCache.set(teamEntityId, countryId);
  return countryId;
}

async function upsertPlayerEntity(client, { worldcupPlayerId, givenName, familyName, birthDate, gender, teamEntityId, teamName }) {
  if (playerEntityCache.has(worldcupPlayerId)) return playerEntityCache.get(worldcupPlayerId);

  const existing = await client.query(
    `SELECT id FROM entities WHERE external_ids->>'worldcup_player_id' = $1`,
    [worldcupPlayerId]
  );
  if (existing.rows[0]) {
    playerEntityCache.set(worldcupPlayerId, existing.rows[0].id);
    return existing.rows[0].id;
  }

  const canonicalName = `${namePart(givenName)} ${namePart(familyName)}`.trim() || worldcupPlayerId;
  let slug = slugify(canonicalName) || `player-${worldcupPlayerId.toLowerCase()}`;

  const slugCheck = await client.query('SELECT id FROM entities WHERE slug = $1', [slug]);
  if (slugCheck.rows[0]) slug = `${slug}-${worldcupPlayerId.replace('P-', '').toLowerCase()}`;

  const countryId = await getTeamCountryId(client, teamEntityId);

  const insertRes = await client.query(`
    INSERT INTO entities (canonical_name, slug, entity_type, gender, birth_date, country_id, is_active, is_verified, external_ids)
    VALUES ($1, $2, 'player', $3, $4, $5, true, false, jsonb_build_object('worldcup_player_id', $6::text))
    ON CONFLICT (slug) DO UPDATE SET canonical_name = entities.canonical_name
    RETURNING id
  `, [canonicalName, slug, gender, birthDate || null, countryId, worldcupPlayerId]);
  const entityId = insertRes.rows[0].id;

  playerEntityCache.set(worldcupPlayerId, entityId);

  await client.query(`
    INSERT INTO player_attributes (entity_id, sport_id, attribute_key, attribute_value)
    VALUES ($1, $2, 'nationality', $3)
    ON CONFLICT (entity_id, sport_id, attribute_key) DO UPDATE SET attribute_value = EXCLUDED.attribute_value
  `, [entityId, SPORT_ID, teamName]);

  return entityId;
}

async function upsertPosition(client, entityId, positionName) {
  const mapped = POSITION_MAP[positionName];
  if (!mapped) return;
  await client.query(`
    INSERT INTO player_attributes (entity_id, sport_id, attribute_key, attribute_value)
    VALUES ($1, $2, 'position', $3)
    ON CONFLICT (entity_id, sport_id, attribute_key) DO UPDATE SET attribute_value = EXCLUDED.attribute_value
  `, [entityId, SPORT_ID, mapped]);
}

async function upsertResultTab(client, { season_id, tab_name, tab_key, typology, display_order, is_default }) {
  const res = await client.query(`
    INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (season_id, tab_key) DO UPDATE SET
      tab_name = EXCLUDED.tab_name, display_order = EXCLUDED.display_order, is_default = EXCLUDED.is_default
    RETURNING id
  `, [season_id, tab_name, tab_key, typology, display_order, is_default]);
  return res.rows[0].id;
}

async function upsertPlayerSeasonStats(client, { entity_id, season_id, club_entity_id, games_played, goals }) {
  await client.query(`
    INSERT INTO player_season_stats (entity_id, season_id, club_entity_id, games_played, goals, assists, result_tab_id)
    VALUES ($1, $2, $3, $4, $5, 0, NULL)
    ON CONFLICT (entity_id, season_id, club_entity_id) DO UPDATE SET
      games_played = EXCLUDED.games_played, goals = EXCLUDED.goals
  `, [entity_id, season_id, club_entity_id, games_played, goals]);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const competitionId = await getCompetitionId();

  console.log('Fetching CSVs (squads, player_appearances, players, goals)...');
  const [squadsAll, appearancesAll, playersAll, goalsAll] = await Promise.all([
    fetchCSV('squads'), fetchCSV('player_appearances'), fetchCSV('players'), fetchCSV('goals'),
  ]);
  console.log(`squads: ${squadsAll.length}, appearances: ${appearancesAll.length}, players: ${playersAll.length}, goals: ${goalsAll.length}`);

  const playersById = new Map(playersAll.map(p => [p.player_id, p]));

  for (const year of YEARS) {
    const tournamentId = TOURNAMENT_ID_BY_YEAR[year];
    console.log(`\n🏆 ${year}`);

    const seasonRes = await pool.query(
      'SELECT id FROM seasons WHERE competition_id = $1 AND year = $2',
      [competitionId, year]
    );
    const seasonId = seasonRes.rows[0]?.id;
    if (!seasonId) { console.log(`  ⚠️  no season row for ${year} — skipping (run ingest_worldcup_history.js first)`); continue; }

    const squads = squadsAll.filter(s => s.tournament_id === tournamentId);
    if (!squads.length) { console.log(`  ⚠️  no squads rows for ${tournamentId} — skipping`); continue; }

    const appearances = appearancesAll.filter(a => a.tournament_id === tournamentId);
    const goals = goalsAll.filter(g => g.tournament_id === tournamentId);

    const gamesPlayedByPlayer = new Map();
    for (const a of appearances) {
      gamesPlayedByPlayer.set(a.player_id, (gamesPlayedByPlayer.get(a.player_id) || 0) + 1);
    }
    const goalsByPlayer = new Map();
    for (const g of goals) {
      if (g.own_goal === '1') continue; // own goals don't count toward the scorer's personal tally
      goalsByPlayer.set(g.player_id, (goalsByPlayer.get(g.player_id) || 0) + 1);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let teamCount = 0, playerCount = 0;
      const teamIds = [...new Set(squads.map(s => s.team_id))];
      for (const teamId of teamIds) {
        const teamRows = squads.filter(s => s.team_id === teamId);
        const teamName = teamRows[0].team_name;
        const teamEntityId = await upsertTeamEntity(client, teamName);
        teamCount++;

        for (const row of teamRows) {
          const bio = playersById.get(row.player_id);
          const entityId = await upsertPlayerEntity(client, {
            worldcupPlayerId: row.player_id,
            givenName: row.given_name,
            familyName: row.family_name,
            birthDate: validDate(bio?.birth_date),
            gender: bio?.female === '1' ? 'F' : 'M',
            teamEntityId,
            teamName,
          });
          await upsertPosition(client, entityId, row.position_name);
          await upsertPlayerSeasonStats(client, {
            entity_id: entityId,
            season_id: seasonId,
            club_entity_id: teamEntityId,
            games_played: gamesPlayedByPlayer.get(row.player_id) || 0,
            goals: goalsByPlayer.get(row.player_id) || 0,
          });
          playerCount++;
        }
      }

      await upsertResultTab(client, { season_id: seasonId, tab_name: 'Scorers',  tab_key: 'scorers',   typology: 'players',   display_order: 200, is_default: false });
      await upsertResultTab(client, { season_id: seasonId, tab_name: 'Players',  tab_key: 'players',   typology: 'players',   display_order: 202, is_default: false });
      await upsertResultTab(client, { season_id: seasonId, tab_name: 'Teams',    tab_key: 'countries', typology: 'countries', display_order: 203, is_default: false });

      await client.query('COMMIT');
      console.log(`  ✅ ${teamCount} teams, ${playerCount} player-season rows`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ❌ ${year} failed, rolled back:`, err.message);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
