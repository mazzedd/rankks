// Creates the seasons + result_tabs rows for NBA's Regular Season/Finals/
// Playoffs/Play-in events for one year, if they don't already exist —
// the piece ingest-nba-games.js/standings.js/player-boxscores.js all assume
// is already there (they only ever SELECT these rows, never INSERT them).
// For 2025 this was done as a one-off, uncaptured setup step; this script
// makes it repeatable for every future backfill year.
//
// ingest-nba-awards.js/eost.js self-create their own Awards/EOST seasons
// rows already — not duplicated here. ingest-nba-player-boxscores.js
// self-creates its own 'players' result_tab under Regular Season — also
// not duplicated here, only the tabs it doesn't create itself.
//
// Shape copied exactly from the existing 2025 rows (competition_id=4828):
//   Regular Season (event 74): Standings / Results  (Players self-created)
//   Finals         (event 75): NBA Finals / Eastern Finals / Western Finals
//   Playoffs       (event 76): Eastern Conf. / Western Conf.
//   Play-in        (event 77): Eastern Conf. / Western Conf.
//   All-Time       (event 81): Players All-Time / Teams All-Time
// NOTE: Regular Season's old 'Teams' Line B tab was deliberately dropped —
// team info moved to the "All-Time" Line A > Teams tab instead. Do not
// re-add it here (2014/2015 briefly regressed this — see fix).
//
// Event 81 (All-Time) was originally set up as a one-off for 2016-2026 and
// never folded into this script — every backfilled year before this fix
// (2013/2014/2015) got no All-Time season row at all, so the frontend's
// All-Time tab showed "No data available" for them even though the
// /results/teams and /results/players-all-time routes are pure computed
// views over existing games/standings/player_season_stats and need nothing
// else ingested. Shape copied exactly from season_id 6173's (2016) rows.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const COMPETITION_ID = 4828;

const EVENTS = [
  {
    eventId: 74, label: 'Regular Season',
    tabs: [
      { tab_name: 'Standings', tab_key: 'standings', typology: 'standings', display_order: 1 },
      { tab_name: 'Results',   tab_key: 'results',    typology: 'game',      display_order: 2 },
    ],
  },
  {
    eventId: 75, label: 'Finals',
    tabs: [
      { tab_name: 'NBA Finals',      tab_key: 'nba-finals',      typology: 'game', display_order: 1 },
      { tab_name: 'Eastern Finals',  tab_key: 'eastern-finals',  typology: 'game', display_order: 2 },
      { tab_name: 'Western Finals',  tab_key: 'western-finals',  typology: 'game', display_order: 3 },
    ],
  },
  {
    eventId: 76, label: 'Playoffs',
    tabs: [
      { tab_name: 'Eastern Conf.', tab_key: 'eastern-conference', typology: 'game', display_order: 1 },
      { tab_name: 'Western Conf.', tab_key: 'western-conference', typology: 'game', display_order: 2 },
    ],
  },
  {
    eventId: 77, label: 'Play-in',
    tabs: [
      { tab_name: 'Eastern Conf.', tab_key: 'eastern-conference', typology: 'game', display_order: 1 },
      { tab_name: 'Western Conf.', tab_key: 'western-conference', typology: 'game', display_order: 2 },
    ],
  },
  {
    eventId: 81, label: 'All-Time',
    tabs: [
      { tab_name: 'Player Stats',   tab_key: 'all-time-players',       typology: 'players',        display_order: 1 },
      { tab_name: 'Team Stats',     tab_key: 'all-time-teams',         typology: 'teams',           display_order: 2 },
      { tab_name: 'Player Awards',  tab_key: 'all-time-player-awards', typology: 'player_awards',   display_order: 3 },
      { tab_name: 'Team Honours',   tab_key: 'all-time-team-honours',  typology: 'team_honours',    display_order: 4 },
      { tab_name: 'Champion History', tab_key: 'all-time-champion-history', typology: 'champion_history', display_order: 5 },
    ],
  },
];

async function main() {
  const year = parseInt(process.argv[2], 10);
  if (!year) { console.error('Usage: node ensure-nba-season.js <year>'); process.exit(1); }

  for (const { eventId, label, tabs } of EVENTS) {
    let season = await pool.query(
      `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
      [COMPETITION_ID, eventId, year]
    );

    let seasonId;
    if (season.rows.length) {
      seasonId = season.rows[0].id;
      console.log(`${label} ${year}: season already exists (id ${seasonId})`);
    } else {
      const inserted = await pool.query(
        `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition)
         VALUES ($1, $2, $3, 'past', 'M', 1) RETURNING id`,
        [COMPETITION_ID, eventId, year]
      );
      seasonId = inserted.rows[0].id;
      console.log(`${label} ${year}: created season id ${seasonId}`);
    }

    for (const tab of tabs) {
      const existing = await pool.query(
        `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
        [seasonId, tab.tab_key]
      );
      if (existing.rows.length) continue;
      await pool.query(
        `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [seasonId, tab.tab_name, tab.tab_key, tab.typology, tab.display_order]
      );
      console.log(`  + result_tab '${tab.tab_key}'`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
