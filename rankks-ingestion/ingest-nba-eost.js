// Ingests NBA End of Season Teams (All-NBA 1st/2nd/3rd, All-Defense 1st/2nd) from
// "End of Season Teams (Voting).csv" for one season year — per BASK-NAV-01 (the
// reference nav spec), typology='players' (the Players template), one result_tab
// per team tier, one player_season_stats row per selected player ranked by share
// desc, scoped via result_tab_id same as ingest-nba-awards.js. All-Rookie Team and
// "ORV" (Others Receiving Votes, i.e. candidates NOT selected) rows are excluded —
// not in the confirmed BASK-NAV-01 nav scope.
//
// The old standalone "End of Season Teams" Line A event (id 79) was deactivated
// after the nav restructure — its 5 tabs live under the Awards event (id 78,
// same as ingest-nba-awards.js's AWARDS_EVENT_ID) instead. This script targets
// event 78 directly so it writes into the same live tabs Awards uses.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { loadCareerInfo, resolvePlayerEntity } = require('./nba-player-lookup');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'End of Season Teams (Voting).csv');
const COMPETITION_ID = 4828;
const EOST_EVENT_ID = 78;

const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-eost.js <seasonYear>');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// (csvType, csvNumberTm) -> { tabKey, tabName, displayOrder }
// displayOrder continues from ingest-nba-awards.js's AWARDS array (1-6) so
// the two scripts' self-created tabs interleave correctly under the same
// Awards season instead of colliding on the same 1-5 range (caught live:
// 2010-2015 rendered as MVP/All-NBA1st/All-NBA2nd/FinalsMVP/... instead of
// the canonical MVP/FinalsMVP/DPOY/6MOY/MIP/ROY/All-NBA1st-3rd/All-Def1st-2nd
// order every 2016+ season uses).
const TEAMS = [
  { csvType: 'all_nba',     csvNumberTm: '1T',  tabKey: 'all-nba-1st',      tabName: 'All-NBA 1st',      displayOrder: 7 },
  { csvType: 'all_nba',     csvNumberTm: '2T',  tabKey: 'all-nba-2nd',      tabName: 'All-NBA 2nd',      displayOrder: 8 },
  { csvType: 'all_nba',     csvNumberTm: '3T',  tabKey: 'all-nba-3rd',      tabName: 'All-NBA 3rd',      displayOrder: 9 },
  { csvType: 'all_defense', csvNumberTm: '1st', tabKey: 'all-defense-1st',  tabName: 'All-Defense 1st',  displayOrder: 10 },
  { csvType: 'all_defense', csvNumberTm: '2nd', tabKey: 'all-defense-2nd',  tabName: 'All-Defense 2nd',  displayOrder: 11 },
];

// 2016-2021 label All-NBA tiers "1st"/"2nd"/"3rd" (same as All-Defense);
// 2022+ switched to "1T"/"2T"/"3T" — normalizing here means the TEAMS
// filter below matches every season regardless of era. All-Defense's own
// "1st"/"2nd" values are untouched (already consistent across all years).
function normalizeNumberTm(type, numberTm) {
  if (type !== 'all_nba') return numberTm;
  const map = { '1st': '1T', '2nd': '2T', '3rd': '3T' };
  return map[numberTm] || numberTm;
}

function numOrNull(v) {
  if (v === '' || v === undefined || v === null || v === 'NA') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// See ingest-nba-awards.js's identical helper — same uq_player_season_club
// collision reason (multiple team tiers share one EOST season_id per player),
// plus box-score stats for the Awards/EOST page's condensed stat columns.
async function getRegularSeasonStats(entityId, year) {
  const row = await pool.query(`
    SELECT reg.club_entity_id, reg.stats
    FROM player_season_stats reg
    JOIN result_tabs rt ON rt.id = reg.result_tab_id
    JOIN seasons s ON s.id = rt.season_id
    WHERE rt.tab_key = 'players' AND s.competition_id = $1 AND s.event_id = 74 AND s.year = $2
      AND reg.entity_id = $3
    LIMIT 1
  `, [COMPETITION_ID, year, entityId]);
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
    // Season totals for the Total-mode toggle — minutes/points aren't here
    // since those already come from a live join to the Regular Season row
    // (see results.js's regularSeasonId fallback), not a copy baked in at
    // ingestion time.
    totals: {
      fgm: t.fgm ?? null, tpm: t.tpm ?? null, ftm: t.ftm ?? null,
      assists: t.assists ?? null, rebounds: t.rebounds ?? null, blocks: t.blocks ?? null,
    },
  };
}

async function getOrCreateSeason(year) {
  const existing = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, EOST_EVENT_ID, year]
  );
  if (existing.rows.length) return existing.rows[0].id;
  // End of Season Teams has no games of its own — uses Regular Season's
  // start/end_date, same reasoning as ingest-nba-awards.js's getOrCreateSeason.
  const regSeason = await pool.query(
    `SELECT start_date, end_date FROM seasons WHERE competition_id = $1 AND event_id = 74 AND year = $2`,
    [COMPETITION_ID, year]
  );
  const { start_date, end_date } = regSeason.rows[0] || {};
  const inserted = await pool.query(
    `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition, start_date, end_date)
     VALUES ($1, $2, $3, 'past', 'M', 1, $4, $5) RETURNING id`,
    [COMPETITION_ID, EOST_EVENT_ID, year, start_date || null, end_date || null]
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
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  const careerInfo = loadCareerInfo();

  const seasonId = await getOrCreateSeason(seasonYearArg);

  for (const def of TEAMS) {
    const rows = records
      .filter(r => r.season === String(seasonYearArg) && r.type === def.csvType
        && normalizeNumberTm(r.type, r.number_tm) === def.csvNumberTm)
      .sort((a, b) => Number(b.share) - Number(a.share));

    if (!rows.length) {
      console.log(`${def.tabName} ${seasonYearArg}: no candidates in source, skipping`);
      continue;
    }

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
        third_team_votes: numOrNull(row.x3rd_tm),
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
