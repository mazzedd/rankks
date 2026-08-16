// Ingests NBA All-Rookie Team (1st since 1962-63, 2nd since 1988-89) from
// "End of Season Teams (Voting).csv" for one season year — deliberately
// excluded from ingest-nba-eost.js's scope when that script was built (see
// its header comment); now added per Mohamed's request, same shape as the
// All-NBA/All-Defense tiers it sits alongside. Targets event 79 (Team of
// the Year) directly rather than staging under Awards (event 78) and
// relying on migrate-nba-team-of-the-year.js to re-home it — that two-hop
// path was a one-off migration for tabs that already existed under Awards
// before event 79 was reactivated, not a pattern to repeat for new tabs.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { loadCareerInfo, resolvePlayerEntity } = require('./nba-player-lookup');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'End of Season Teams (Voting).csv');
const COMPETITION_ID = 4828;
const REGULAR_SEASON_EVENT_ID = 74;
const TOTY_EVENT_ID = 79;

const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-all-rookie.js <seasonYear>');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// displayOrder 6/7 sit between All-Defense 2nd (5) and NBA Cup Team (8,
// bumped from 7 by the one-off migration that made room for these).
const TEAMS = [
  { csvNumberTm: '1st', tabKey: 'all-rookie-1st', tabName: 'All-Rookie 1st', displayOrder: 6 },
  { csvNumberTm: '2nd', tabKey: 'all-rookie-2nd', tabName: 'All-Rookie 2nd', displayOrder: 7 },
];

function numOrNull(v) {
  if (v === '' || v === undefined || v === null || v === 'NA') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Same uq_player_season_club collision reason as ingest-nba-eost.js's
// identical helper — multiple team tiers share one TOTY season_id per player.
async function getRegularSeasonStats(entityId, year) {
  const row = await pool.query(`
    SELECT reg.club_entity_id, reg.stats
    FROM player_season_stats reg
    JOIN result_tabs rt ON rt.id = reg.result_tab_id
    JOIN seasons s ON s.id = rt.season_id
    WHERE rt.tab_key = 'players' AND s.competition_id = $1 AND s.event_id = $2 AND s.year = $3
      AND reg.entity_id = $4
    LIMIT 1
  `, [COMPETITION_ID, REGULAR_SEASON_EVENT_ID, year, entityId]);
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
     VALUES ($1, $2, $3, 'players', $4, false) RETURNING id`,
    [seasonId, def.tabName, def.tabKey, def.displayOrder]
  );
  return inserted.rows[0].id;
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  const careerInfo = loadCareerInfo();

  for (const def of TEAMS) {
    const rows = records
      .filter(r => r.season === String(seasonYearArg) && r.type === 'all_rookie' && r.number_tm === def.csvNumberTm)
      .sort((a, b) => Number(b.share) - Number(a.share));

    if (!rows.length) {
      console.log(`${def.tabName} ${seasonYearArg}: no candidates in source, skipping`);
      continue;
    }

    const seasonId = await getOrCreateSeason(seasonYearArg);
    const tabId = await getOrCreateTab(seasonId, def);
    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);

    let rank = 1;
    for (const row of rows) {
      const entityId = await resolvePlayerEntity(pool, row.player_id, row.player, careerInfo);
      const regStats = await getRegularSeasonStats(entityId, seasonYearArg);
      const stats = {
        position: row.position !== 'NA' ? row.position : null,
        pts_won: numOrNull(row.pts_won),
        pts_max: numOrNull(row.pts_max),
        share: numOrNull(row.share),
        first_team_votes: numOrNull(row.x1st_tm),
        second_team_votes: numOrNull(row.x2nd_tm),
        age: numOrNull(row.age),
        ...regStats,
      };
      await pool.query(
        `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [entityId, seasonId, tabId, rank, JSON.stringify(stats)]
      );
      rank++;
    }
    console.log(`${def.tabName} ${seasonYearArg}: ${rows.length} selections ingested`);
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
