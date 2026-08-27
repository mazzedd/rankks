// One-off migration: moves the All-Star MVP tab (currently its own Line B
// tab under the All-Star event, tab_key='mvp', display_order=99) into the
// Awards event instead, as the last tab before NBA Cup MVP — per Mohamed's
// nav cleanup request: All-Star MVP conceptually belongs with the season's
// other individual awards, not mixed in with All-Star roster tabs.
//
// Renamed to tab_key='all-star-mvp' while moving — Awards already has its
// own 'mvp' tab (the real season MVP award) under the SAME event, so
// keeping the old tab_key would collide on (season_id, tab_key).
// display_order=11 — sits after ROY (6) and before NBA Cup MVP (12), the
// two real neighbors confirmed live in the DB before this migration ran.
//
// player_season_stats.season_id is a separate stored column (not derived
// from result_tab_id) — must be updated alongside the tab's own season_id
// move, or the row would point at the old All-Star season while its tab
// points at the new Awards one.
require('dotenv').config();
const { Pool } = require('pg');

const COMPETITION_ID = 4828;
const ALL_STAR_EVENT_ID = 80;
const AWARDS_EVENT_ID = 78;
const NEW_TAB_KEY = 'all-star-mvp';
const NEW_TAB_NAME = 'All-Star MVP';
const NEW_DISPLAY_ORDER = 11;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

async function getOrCreateAwardsSeason(year) {
  const existing = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, AWARDS_EVENT_ID, year]
  );
  if (existing.rows.length) return { id: existing.rows[0].id, created: false };

  const regSeason = await pool.query(
    `SELECT start_date, end_date FROM seasons WHERE competition_id = $1 AND event_id = 74 AND year = $2`,
    [COMPETITION_ID, year]
  );
  const { start_date, end_date } = regSeason.rows[0] || {};
  const inserted = await pool.query(
    `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition, start_date, end_date)
     VALUES ($1, $2, $3, 'past', 'M', 1, $4, $5) RETURNING id`,
    [COMPETITION_ID, AWARDS_EVENT_ID, year, start_date || null, end_date || null]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function main() {
  const tabs = await pool.query(`
    SELECT rt.id AS tab_id, s.year, s.id AS old_season_id
    FROM seasons s
    JOIN result_tabs rt ON rt.season_id = s.id AND rt.tab_key = 'mvp'
    WHERE s.competition_id = $1 AND s.event_id = $2
    ORDER BY s.year
  `, [COMPETITION_ID, ALL_STAR_EVENT_ID]);

  console.log(`Found ${tabs.rows.length} All-Star MVP tabs to migrate`);

  let moved = 0, seasonsCreated = 0;
  for (const { tab_id, year, old_season_id } of tabs.rows) {
    const statsCount = await pool.query(`SELECT COUNT(*) c FROM player_season_stats WHERE result_tab_id = $1`, [tab_id]);
    if (Number(statsCount.rows[0].c) === 0) { console.log(`${year}: mvp tab exists but has no data, skipping`); continue; }

    const { id: awardsSeasonId, created } = await getOrCreateAwardsSeason(year);
    if (created) { seasonsCreated++; console.log(`${year}: created Awards season (id ${awardsSeasonId})`); }

    await pool.query(
      `UPDATE result_tabs SET season_id = $1, tab_key = $2, tab_name = $3, display_order = $4, is_default = false WHERE id = $5`,
      [awardsSeasonId, NEW_TAB_KEY, NEW_TAB_NAME, NEW_DISPLAY_ORDER, tab_id]
    );
    await pool.query(`UPDATE player_season_stats SET season_id = $1 WHERE result_tab_id = $2`, [awardsSeasonId, tab_id]);
    moved++;
  }

  console.log(`\nMoved ${moved} All-Star MVP tabs into Awards; created ${seasonsCreated} new Awards seasons.`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
