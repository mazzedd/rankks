// One-off ingestion for the 2025/26 NBA awards (DB year 2026, year_convention
// 'end'). The Kaggle "Player Award Shares.csv" / "End of Season Teams
// (Voting).csv" sources that ingest-nba-awards.js / ingest-nba-eost.js read
// from are historical dumps and don't cover the current season — this reads
// a manually-compiled results sheet instead (parsed to
// scratchpad/awards_2026.json, see parse_awards.py) and writes into the same
// 11 result_tabs (mvp/finals-mvp/dpoy/smoy/mip/roy + the 5 EOST tiers) under
// the Awards season row that already exists for 2026 (id resolved below).
//
// Player resolution is name-based against the entities table (NOT the
// bref_player_id-keyed resolvePlayerEntity() the CSV scripts use) because
// every player in this sheet is a current/recent player already ingested via
// the box-score pipeline (keyed by nba_person_id, which has no bref id for
// several 2025-26 rookies) — creating new bref-keyed entities here would
// duplicate them. Exact canonical_name match first, diacritic-stripped
// fallback second (only mismatch found: "Luka Dončić" vs stored "Luka
// Doncic"). No unmatched name is silently skipped — the script fails loud on
// first miss to force an explicit resolution.
//
// Source sheet has no pts_max/share/age columns (unlike the Kaggle CSVs) and
// no per-slot vote counts for the 5 EOST tiers (just player+team) — those
// fields are left null rather than fabricated. ranking_at_event uses row
// order within each section (matches ties correctly since the sheet already
// groups them), not the sheet's own "7T"/"11T" rank text (column is integer).
const fs = require('fs');
const { Pool } = require('pg');

const DATA_PATH = 'C:\\Users\\mohamed\\AppData\\Local\\Temp\\claude\\C--DATA-RANKKS-APP\\1c5a71ae-466d-48d7-9fb0-ff066c07d69d\\scratchpad\\awards_2026.json';
const COMPETITION_ID = 4828;
const SEASON_YEAR = 2026;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// display_order continues the same 1-11 sequence every other Awards season
// already uses (verified across 2016-2025) — mvp/finals-mvp/dpoy/smoy/mip/roy
// take 1-6, the 5 EOST tiers take 7-11. The two source scripts used to number
// these independently (1-6 and 1-5) back when EOST was its own event; reusing
// that standalone 1-5 numbering here collided with the individual awards'
// order once both live under one Awards event, breaking sort order on the
// frontend Line B tab bar.
const RANKED_TABS = [
  { key: 'mvp',   tabName: 'MVP',  displayOrder: 1 },
  { key: 'dpoy',  tabName: 'DPOY', displayOrder: 3 },
  { key: 'smoy',  tabName: '6MOY', displayOrder: 4 },
  { key: 'mip',   tabName: 'MIP',  displayOrder: 5 },
  { key: 'roy',   tabName: 'ROY',  displayOrder: 6 },
];
const TEAM_TABS = [
  { key: 'all-nba-1st',     tabName: 'All-NBA 1st',     displayOrder: 7 },
  { key: 'all-nba-2nd',     tabName: 'All-NBA 2nd',     displayOrder: 8 },
  { key: 'all-nba-3rd',     tabName: 'All-NBA 3rd',     displayOrder: 9 },
  { key: 'all-defense-1st', tabName: 'All-Defense 1st', displayOrder: 10 },
  { key: 'all-defense-2nd', tabName: 'All-Defense 2nd', displayOrder: 11 },
];

const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
function stripDiacritics(s) {
  return s.normalize('NFD').replace(DIACRITICS_RE, '');
}

async function resolveByName(name) {
  const exact = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND canonical_name = $1`,
    [name]
  );
  if (exact.rows.length) return exact.rows[0].id;

  const stripped = stripDiacritics(name);
  const fuzzy = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND (
       regexp_replace(canonical_name, '[̀-ͯ]', '', 'g') = $1
       OR canonical_name = $1
     )`,
    [stripped]
  );
  if (fuzzy.rows.length === 1) return fuzzy.rows[0].id;

  throw new Error(`No unique entity match for player "${name}" (${fuzzy.rows.length} candidates)`);
}

// See ingest-nba-awards.js's identical helper for the uq_player_season_club
// collision reason. club_entity_id and box-score stats pulled from the
// Regular Season row for the same entity/year.
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

async function getAwardsSeasonId() {
  const row = await pool.query(
    `SELECT s.id FROM seasons s JOIN events e ON e.id = s.event_id
     WHERE s.competition_id = $1 AND e.slug = 'awards-4828' AND s.year = $2`,
    [COMPETITION_ID, SEASON_YEAR]
  );
  if (!row.rows.length) throw new Error(`Awards season row not found for year ${SEASON_YEAR}`);
  return row.rows[0].id;
}

async function getOrCreateTab(seasonId, def) {
  const existing = await pool.query(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
    [seasonId, def.key]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
     VALUES ($1, $2, $3, 'players', $4, $5) RETURNING id`,
    [seasonId, def.tabName, def.key, def.displayOrder, def.displayOrder === 1]
  );
  return inserted.rows[0].id;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const seasonId = await getAwardsSeasonId();

  for (const def of RANKED_TABS) {
    const candidates = data[def.key];
    if (!candidates || !candidates.length) {
      console.log(`${def.tabName}: no rows in source, skipping`);
      continue;
    }
    const tabId = await getOrCreateTab(seasonId, def);
    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);

    // Rank by points won, not sheet row order — the sheet happens to already
    // be sorted this way, but ranking_at_event should reflect the actual
    // numbers, not an assumption about the source's row order.
    const ranked = [...candidates].sort((a, b) => (b.pts_won ?? 0) - (a.pts_won ?? 0));

    let rank = 1;
    for (const c of ranked) {
      const entityId = await resolveByName(c.player);
      const regStats = await getRegularSeasonStats(entityId);
      const stats = {
        pts_won: c.pts_won ?? null,
        pts_max: null,
        share: null,
        first_place_votes: c.first_place_votes ?? null,
        age: null,
        winner: rank === 1,
        ...regStats,
      };
      await pool.query(
        `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [entityId, seasonId, tabId, rank, JSON.stringify(stats)]
      );
      rank++;
    }
    console.log(`${def.tabName}: ${candidates.length} candidates ingested`);
  }

  for (const def of TEAM_TABS) {
    const candidates = data[def.key];
    if (!candidates || !candidates.length) {
      console.log(`${def.tabName}: no rows in source, skipping`);
      continue;
    }
    const tabId = await getOrCreateTab(seasonId, def);
    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);

    // Rank by points won (column E in the source sheet), same as the
    // ranked-award tabs above. first_team_votes (column D) is present for
    // All-NBA but not All-Defense in this sheet — left null where absent
    // rather than assumed zero.
    const ranked = [...candidates].sort((a, b) => (b.pts_won ?? 0) - (a.pts_won ?? 0));

    let rank = 1;
    for (const c of ranked) {
      const entityId = await resolveByName(c.player);
      const regStats = await getRegularSeasonStats(entityId);
      const stats = {
        position: null,
        pts_won: c.pts_won ?? null,
        pts_max: null,
        share: null,
        first_team_votes: c.first_team_votes ?? null,
        second_team_votes: null,
        third_team_votes: null,
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
    console.log(`${def.tabName}: ${candidates.length} selections ingested`);
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
