// Ingests All-NBA 1st/2nd Team selections for 1947-1965 — the years
// "End of Season Teams (Voting).csv" (ingest-nba-eost.js's source) has zero
// all_nba/all_defense rows for (that file's all_rookie type starts earlier,
// at 1963, which is what misled an earlier pass into thinking 1963 was the
// cutoff — the real one, checked directly, is 1966), even though All-NBA
// teams are real since the 1946-47 season (see nba-award-introduction-years
// memory: "never gated — predates the whole dataset"). All-Defense
// (1968-69+) and All-NBA 3rd Team (1988-89+) genuinely don't apply to this
// range, so only 1st/2nd are scraped/loaded.
//
// Source: rankks-scrap/nba-historical-scraper/nba-historical-raw/
// all-nba-teams-1947-1965.json (scrape-all-nba.js), a single-page scrape of
// basketball-reference.com's All-League Teams page. Writes into the SAME
// event (79, "Team of the Year") and tab_keys ('all-nba-1st'/'all-nba-2nd')
// migrate-nba-team-of-the-year.js already re-homed the 1963+ CSV-sourced
// data onto — so both sources render on one continuous timeline with zero
// frontend changes.
//
// Player entities are resolved via the SAME nba-player-lookup.js helper
// ingest-nba-eost.js already uses (keyed by bref_player_id, exact-name
// fallback, self-creating with Player Career Info.csv bio data) — no new
// resolution logic needed since these are the same-shaped IDs.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { loadCareerInfo, resolvePlayerEntity, getRegularSeasonStats } = require('./nba-player-lookup');

const RAW_PATH = path.join(__dirname, '..', 'rankks-scrap', 'nba-historical-scraper', 'nba-historical-raw', 'all-nba-teams-1947-1965.json');
const COMPETITION_ID = 4828;
const TOTY_EVENT_ID = 79;
const REGULAR_SEASON_EVENT_ID = 74;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const TAB_DEFS = {
  '1st': { tabKey: 'all-nba-1st', tabName: 'All NBA 1st', displayOrder: 1 },
  '2nd': { tabKey: 'all-nba-2nd', tabName: 'All NBA 2nd', displayOrder: 2 },
};

async function getOrCreateSeason(year) {
  const existing = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, TOTY_EVENT_ID, year]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const regSeason = await pool.query(
    `SELECT start_date, end_date FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, REGULAR_SEASON_EVENT_ID, year]
  );
  const { start_date, end_date } = regSeason.rows[0] || {};
  const inserted = await pool.query(
    `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition, start_date, end_date)
     VALUES ($1, $2, $3, 'past', 'M', 1, $4, $5) RETURNING id`,
    [COMPETITION_ID, TOTY_EVENT_ID, year, start_date || null, end_date || null]
  );
  return inserted.rows[0].id;
}

async function getOrCreateTab(seasonId, def) {
  const existing = await pool.query(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
    [seasonId, def.tabKey]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
     VALUES ($1, $2, $3, 'players', $4, $5) RETURNING id`,
    [seasonId, def.tabName, def.tabKey, def.displayOrder, def.displayOrder === 1]
  );
  return inserted.rows[0].id;
}

async function main() {
  const rows = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
  const careerInfo = loadCareerInfo();

  let inserted = 0, skippedNoPlayers = 0;
  for (const row of rows) {
    if (!row.players.length) { skippedNoPlayers++; console.warn(`${row.season} ${row.tier}: no players found, skipping`); continue; }

    const seasonId = await getOrCreateSeason(row.seasonYear);
    const def = TAB_DEFS[row.tier];
    const tabId = await getOrCreateTab(seasonId, def);
    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);

    let rank = 1;
    for (const player of row.players) {
      if (!player.brefPlayerId) { console.warn(`  ${row.season} ${row.tier}: no bref id for "${player.name}", skipping`); continue; }
      const entityId = await resolvePlayerEntity(pool, player.brefPlayerId, player.name, careerInfo);
      const regStats = await getRegularSeasonStats(pool, COMPETITION_ID, entityId, row.seasonYear);
      const stats = {
        position: null, // not published on this era's All-League page
        pts_won: null, pts_max: null, share: null,
        first_team_votes: null, second_team_votes: null, third_team_votes: null,
        age: null,
        ...regStats,
      };
      await pool.query(
        `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [entityId, seasonId, tabId, rank, JSON.stringify(stats)]
      );
      rank++;
      inserted++;
    }
    console.log(`${row.season} ${def.tabName}: ${row.players.length} players`);
  }

  console.log(`\n${inserted} player_season_stats rows inserted, ${skippedNoPlayers} team-selections skipped (no players found)`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
