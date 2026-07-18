// Ingests NBA Awards (MVP/Finals MVP/DPOY/6MOY/MIP/ROY) from Player Award Shares.csv
// for one season year — per BASK-NAV-01 (the actual reference nav spec, see
// C:\DATA\RANKKS DOCS\04 - SPORT STRUCTURE AND DATA\NBA\nba.pdf), these are
// typology='players' (the Players template), NOT 'standings' — one result_tab
// per award, one player_season_stats row per candidate, scoped to that
// result_tab via result_tab_id so the 6 awards (sharing one Awards season row)
// don't bleed into each other the way plain season_id-only scoping would.
//
// Finals MVP has no data in any available source (checked Award Shares, End of
// Season Teams, All-Star Selections, TeamStatistics gameLabel) — its tab is
// still created every year, permanently empty, per BASK-NAV-01's nav order.
// Clutch POY is NOT in BASK-NAV-01 and is not ingested.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { loadCareerInfo, resolvePlayerEntity } = require('./nba-player-lookup');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'Player Award Shares.csv');
const COMPETITION_ID = 4828;
const AWARDS_EVENT_ID = 78;

const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-awards.js <seasonYear>');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// award CSV value (null = no source, permanent empty placeholder) -> { tabKey, tabName, displayOrder }
const AWARDS = [
  { csvAward: 'nba mvp',  tabKey: 'mvp',        tabName: 'MVP',        displayOrder: 1 },
  { csvAward: null,       tabKey: 'finals-mvp', tabName: 'Finals MVP', displayOrder: 2 },
  { csvAward: 'nba dpoy', tabKey: 'dpoy',       tabName: 'DPOY',       displayOrder: 3 },
  { csvAward: 'nba smoy', tabKey: 'smoy',       tabName: '6MOY',       displayOrder: 4 },
  { csvAward: 'nba mip',  tabKey: 'mip',        tabName: 'MIP',        displayOrder: 5 },
  { csvAward: 'nba roy',  tabKey: 'roy',        tabName: 'ROY',        displayOrder: 6 },
];

function numOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// club_entity_id can't live on the dedicated column for these rows —
// uq_player_season_club is UNIQUE(entity_id, season_id, club_entity_id), and
// every award shares one season_id per player, which would collide on that
// column the moment 2+ awards resolve to the same club. Pulled from the
// Regular Season Players tab (same year, same entity) and stored in stats
// jsonb instead — the /players route's club join already falls back there.
// Box-score shooting/counting stats (fgm/tpm/ftm/assists/rebounds/blocks)
// are pulled from that same row too, for the Awards page's condensed stat
// columns — Award Shares/EOST CSVs have no box-score data of their own.
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
    // Season totals for the columns shown on the Awards page's Total-mode
    // toggle — minutes/points aren't here since those already come from a
    // live join to the Regular Season row (see results.js's regularSeasonId
    // fallback), not a copy baked in at ingestion time.
    totals: {
      fgm: t.fgm ?? null, tpm: t.tpm ?? null, ftm: t.ftm ?? null,
      assists: t.assists ?? null, rebounds: t.rebounds ?? null, blocks: t.blocks ?? null,
    },
  };
}

async function getOrCreateSeason(year) {
  const existing = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, AWARDS_EVENT_ID, year]
  );
  if (existing.rows.length) return existing.rows[0].id;
  // Awards has no games of its own to derive dates from — uses Regular
  // Season's start/end_date (awards are decided/announced as of that
  // season's conclusion). Without this, calcAge.js silently returns null
  // for every player on these tabs (it requires both birth_date and a
  // reference date) — confirmed as the root cause of the Age column
  // showing blank everywhere on Awards/EOST despite birth_date being set.
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

  for (const def of AWARDS) {
    const tabId = await getOrCreateTab(seasonId, def);

    if (!def.csvAward) {
      console.log(`${def.tabName} ${seasonYearArg}: no data source — tab kept empty`);
      continue;
    }

    const rows = records
      .filter(r => r.season === String(seasonYearArg) && r.award === def.csvAward)
      .sort((a, b) => Number(b.share) - Number(a.share));

    if (!rows.length) {
      console.log(`${def.tabName} ${seasonYearArg}: no candidates in source, skipping`);
      continue;
    }

    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);

    let rank = 1;
    for (const row of rows) {
      const entityId = await resolvePlayerEntity(pool, row.player_id, row.player, careerInfo);
      const regStats = await getRegularSeasonStats(entityId, seasonYearArg);
      const stats = {
        pts_won: numOrNull(row.pts_won),
        pts_max: numOrNull(row.pts_max),
        share: numOrNull(row.share),
        first_place_votes: numOrNull(row.first),
        age: numOrNull(row.age),
        winner: row.winner === 'TRUE',
        ...regStats,
      };
      await pool.query(
        `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [entityId, seasonId, tabId, rank, JSON.stringify(stats)]
      );
      rank++;
    }
    console.log(`${def.tabName} ${seasonYearArg}: ${rows.length} candidates ingested`);
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
