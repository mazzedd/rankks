// One-off ingestion for the 2025/26 NBA All-Rookie Team (DB year 2026, event
// 79 Team of the Year — same season row that already holds all-nba/all-defense/
// nba-cup-teams for 2026, display_order 6/7 filling the gap ingest-nba-all-rookie.js
// already reserves between All-Defense 2nd (5) and NBA Cup Team (8)).
//
// ingest-nba-all-rookie.js can't be reused directly: its source CSV ("End of
// Season Teams (Voting).csv") is a historical Kaggle dump that stops at season
// 2025, same gap that forced ingest-nba-awards-2026-manual.js to exist for the
// other 2026 awards. Data below is hand-compiled from the official NBA.com/
// Hoops Rumors announcement (100-media-voter panel, 2 pts per 1st-team vote,
// 1 pt per 2nd-team vote, pts_max 200 — same scale as every prior season).
//
// Player resolution is name-based against entities.canonical_name (NOT
// resolvePlayerEntity()'s bref-id path) for the same reason as the sibling
// manual script: every 2025-26 rookie here was ingested via the nba_person_id-
// keyed box-score pipeline and has no bref id, so bref-id resolution would
// create duplicate entities. All 10 names matched exactly, no diacritic cases.
//
// Only the 3 unanimous 1st-team picks (Flagg/Knueppel/Edgecombe) have a known
// first_team_votes split (100/100, confirmed by "unanimous" + pts_won=200 at
// 2 pts/vote) — the other 7 players' 1st/2nd-team vote split was not published,
// so first_team_votes/second_team_votes are left null for them rather than
// guessed. pts_won/pts_max/share are known for all 10 and always populated.
require('dotenv').config();
const { Pool } = require('pg');

const COMPETITION_ID = 4828;
const TOTY_EVENT_ID = 79;
const SEASON_YEAR = 2026;
const PTS_MAX = 200;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const TEAMS = [
  {
    tabKey: 'all-rookie-1st', tabName: 'All-Rookie 1st', displayOrder: 6,
    players: [
      { name: 'Cooper Flagg',   pts_won: 200, first_team_votes: 100, second_team_votes: 0 },
      { name: 'Kon Knueppel',   pts_won: 200, first_team_votes: 100, second_team_votes: 0 },
      { name: 'VJ Edgecombe',   pts_won: 200, first_team_votes: 100, second_team_votes: 0 },
      { name: 'Dylan Harper',   pts_won: 193, first_team_votes: null, second_team_votes: null },
      { name: 'Cedric Coward',  pts_won: 125, first_team_votes: null, second_team_votes: null },
    ],
  },
  {
    tabKey: 'all-rookie-2nd', tabName: 'All-Rookie 2nd', displayOrder: 7,
    players: [
      { name: 'Derik Queen',            pts_won: 110, first_team_votes: null, second_team_votes: null },
      { name: 'Maxime Raynaud',         pts_won: 110, first_team_votes: null, second_team_votes: null },
      { name: 'Jeremiah Fears',         pts_won: 109, first_team_votes: null, second_team_votes: null },
      { name: 'Ace Bailey',             pts_won: 107, first_team_votes: null, second_team_votes: null },
      { name: 'Collin Murray-Boyles',   pts_won: 66,  first_team_votes: null, second_team_votes: null },
    ],
  },
];

async function resolveByName(name) {
  const r = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND canonical_name = $1`,
    [name]
  );
  if (r.rows.length !== 1) throw new Error(`No unique entity match for player "${name}" (${r.rows.length} candidates)`);
  return r.rows[0].id;
}

// See ingest-nba-all-rookie.js's identical helper for the uq_player_season_club
// collision reason.
async function getRegularSeasonStats(entityId) {
  const row = await pool.query(`
    SELECT reg.club_entity_id, reg.stats
    FROM player_season_stats reg
    JOIN result_tabs rt ON rt.id = reg.result_tab_id
    JOIN seasons s ON s.id = rt.season_id
    WHERE rt.tab_key = 'players' AND s.competition_id = $1 AND s.event_id = 74 AND s.year = $2
      AND reg.entity_id = $3
    LIMIT 1
  `, [COMPETITION_ID, SEASON_YEAR, entityId]);
  const r = row.rows[0];
  if (!r) return { club_entity_id: null };
  const s = r.stats || {};
  const t = s.totals || {};
  return {
    club_entity_id: r.club_entity_id,
    fgm: s.fgm ?? null, fg_pct: s.fg_pct ?? null,
    tpm: s.tpm ?? null, tp_pct: s.tp_pct ?? null,
    ftm: s.ftm ?? null, ft_pct: s.ft_pct ?? null,
    assists: s.assists ?? null, rebounds: s.rebounds ?? null, blocks: s.blocks ?? null,
    totals: {
      fgm: t.fgm ?? null, tpm: t.tpm ?? null, ftm: t.ftm ?? null,
      assists: t.assists ?? null, rebounds: t.rebounds ?? null, blocks: t.blocks ?? null,
    },
  };
}

async function getToySeasonId() {
  const row = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, TOTY_EVENT_ID, SEASON_YEAR]
  );
  if (!row.rows.length) throw new Error(`Team of the Year season row not found for year ${SEASON_YEAR}`);
  return row.rows[0].id;
}

async function getOrCreateTab(seasonId, def) {
  const existing = await pool.query(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
    [seasonId, def.tabKey]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
     VALUES ($1, $2, $3, 'players', $4, false) RETURNING id`,
    [seasonId, def.tabName, def.tabKey, def.displayOrder]
  );
  return inserted.rows[0].id;
}

async function main() {
  const seasonId = await getToySeasonId();

  for (const def of TEAMS) {
    const tabId = await getOrCreateTab(seasonId, def);
    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);

    let rank = 1;
    for (const p of def.players) {
      const entityId = await resolveByName(p.name);
      const regStats = await getRegularSeasonStats(entityId);
      const stats = {
        position: null,
        pts_won: p.pts_won,
        pts_max: PTS_MAX,
        share: p.pts_won / PTS_MAX,
        first_team_votes: p.first_team_votes,
        second_team_votes: p.second_team_votes,
        age: null,
        ...regStats,
      };
      await pool.query(
        `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [entityId, seasonId, tabId, rank, JSON.stringify(stats)]
      );
      rank++;
    }
    console.log(`${def.tabName} ${SEASON_YEAR}: ${def.players.length} selections ingested`);
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
