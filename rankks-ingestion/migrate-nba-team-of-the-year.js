// One-off migration: reactivates the dormant "End of Season Teams" Line A
// event (id 79, deactivated during an earlier restructure that folded its
// tabs into Awards — see ingest-nba-eost.js's header comment) as a new
// "Team of the Year" event, and re-homes the existing All-NBA/All-Defense/
// NBA Cup Team tabs (currently nested under Awards, event 78) onto it —
// per year, preserving all existing player_season_stats data (UPDATE, not
// re-ingest). Also adds a new empty "NBA All-Rookie" tab per year for
// future backfill.
//
// Run with: node migrate-nba-team-of-the-year.js
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const COMPETITION_ID = 4828;
const AWARDS_EVENT_ID = 74 + 4; // 78, kept explicit below for clarity
const REGULAR_SEASON_EVENT_ID = 74;
const TOTY_EVENT_ID = 79;

const TAB_RENAMES = [
  { tabKey: 'all-nba-1st',     tabName: 'All NBA 1st',   displayOrder: 1 },
  { tabKey: 'all-nba-2nd',     tabName: 'All NBA 2nd',   displayOrder: 2 },
  { tabKey: 'all-nba-3rd',     tabName: 'All NBA 3rd',   displayOrder: 3 },
  { tabKey: 'all-defense-1st', tabName: 'All Def. 1st',  displayOrder: 4 },
  { tabKey: 'all-defense-2nd', tabName: 'All Def. 2nd',  displayOrder: 5 },
  { tabKey: 'nba-cup-teams',   tabName: 'NBA Cup Team',  displayOrder: 7 },
];
const ALL_ROOKIE_DISPLAY_ORDER = 6;

async function main() {
  await query(
    `UPDATE events SET name = 'Team of the Year', slug = 'team-of-the-year-4828', is_active = true WHERE id = $1`,
    [TOTY_EVENT_ID]
  );
  console.log('Event 79 reactivated as "Team of the Year"');

  const years = await queryAll(`
    SELECT DISTINCT s.year
    FROM result_tabs rt
    JOIN seasons s ON s.id = rt.season_id
    WHERE s.event_id = 78 AND rt.tab_key = ANY($1)
    ORDER BY s.year
  `, [TAB_RENAMES.map(t => t.tabKey)]);
  console.log(`${years.length} years to migrate: ${years.map(y => y.year).join(', ')}`);

  let movedCount = 0;
  let rookieAdded = 0;

  for (const { year } of years) {
    // get-or-create Team of the Year season for this year
    let seasonRow = await queryAll(
      `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
      [COMPETITION_ID, TOTY_EVENT_ID, year]
    );
    let seasonId;
    if (seasonRow.length) {
      seasonId = seasonRow[0].id;
    } else {
      const regSeason = await queryAll(
        `SELECT start_date, end_date FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
        [COMPETITION_ID, REGULAR_SEASON_EVENT_ID, year]
      );
      const { start_date, end_date } = regSeason[0] || {};
      const inserted = await queryAll(
        `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition, start_date, end_date)
         VALUES ($1, $2, $3, 'past', 'M', 1, $4, $5) RETURNING id`,
        [COMPETITION_ID, TOTY_EVENT_ID, year, start_date || null, end_date || null]
      );
      seasonId = inserted[0].id;
    }

    // Which of the 6 tabs actually exist for this year under Awards
    const existingTabs = await queryAll(`
      SELECT rt.id, rt.tab_key FROM result_tabs rt
      JOIN seasons s ON s.id = rt.season_id
      WHERE s.event_id = 78 AND s.year = $1 AND rt.tab_key = ANY($2)
    `, [year, TAB_RENAMES.map(t => t.tabKey)]);
    const presentKeys = new Set(existingTabs.map(t => t.tab_key));
    const firstPresent = TAB_RENAMES.find(t => presentKeys.has(t.tabKey));

    for (const t of existingTabs) {
      const def = TAB_RENAMES.find(d => d.tabKey === t.tab_key);
      await query(
        `UPDATE result_tabs SET season_id = $1, tab_name = $2, display_order = $3, is_default = $4 WHERE id = $5`,
        [seasonId, def.tabName, def.displayOrder, def.tabKey === firstPresent?.tabKey, t.id]
      );
      movedCount++;
    }

    // Add empty NBA All-Rookie tab if not already present
    const existingRookie = await queryAll(
      `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = 'nba-all-rookie'`,
      [seasonId]
    );
    if (!existingRookie.length) {
      await query(
        `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
         VALUES ($1, 'NBA All-Rookie', 'nba-all-rookie', 'players', $2, false)`,
        [seasonId, ALL_ROOKIE_DISPLAY_ORDER]
      );
      rookieAdded++;
    }
  }

  console.log(`Moved ${movedCount} tabs, added ${rookieAdded} empty NBA All-Rookie tabs`);
  await end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
