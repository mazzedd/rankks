// Resolves/creates NBA player entities keyed by Basketball-Reference player_id
// (e.g. 'jokicni01') — the id system shared by Player Award Shares.csv, End of
// Season Teams files, All-Star Selections.csv, and Draft Pick History.csv.
//
// PlayerStatisticsExtended.csv's numeric personId (used by
// ingest-nba-player-boxscores.js) has no shared join key with this dataset
// and no crosswalk file exists in 00-nba/ — so this falls back to an exact
// canonical_name match against existing player entities before creating a
// new one, backfilling the bref_player_id onto whatever it finds. This is
// the same reconciliation merge-nba-duplicate-players.js does after the
// fact for rows that already went to a duplicate entity (129 found on
// 2010-2015 alone before this fix) — doing it here prevents new duplicates
// for every remaining backfill year instead of just cleaning up afterward.
// Known limitation: two different real players sharing an exact full name
// would incorrectly collide here — merge-nba-duplicate-players.js's own
// ambiguous-group skip logic is the safety net for that rare case, not this
// function; if a name genuinely appears twice for different people, treat
// that as a real data issue to fix manually, not something to code around.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const CAREER_INFO_PATH = path.join(__dirname, '..', '00-nba', 'Player Career Info.csv');

const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

function slugify(name) {
  return name
    .normalize('NFD').replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function numOrNull(v) {
  if (v === '' || v === undefined || v === null || v === 'NA') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function loadCareerInfo() {
  const raw = fs.readFileSync(CAREER_INFO_PATH, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true });
  return new Map(rows.map(r => [r.player_id, r]));
}

async function resolvePlayerEntity(pool, breferId, playerName, careerInfoMap) {
  const existing = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND external_ids->>'bref_player_id' = $1`,
    [breferId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  // Fall back to an exact-name match against any other player entity
  // (typically one created by ingest-nba-player-boxscores.js, keyed by
  // nba_person_id) before creating a fresh one — see file header.
  const byName = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND canonical_name = $1
     AND NOT (external_ids ? 'bref_player_id') LIMIT 1`,
    [playerName]
  );
  if (byName.rows.length) {
    const id = byName.rows[0].id;
    await pool.query(
      `UPDATE entities SET external_ids = external_ids || $2::jsonb WHERE id = $1`,
      [id, JSON.stringify({ bref_player_id: breferId })]
    );
    return id;
  }

  const info = careerInfoMap.get(breferId);
  const heightIn = numOrNull(info?.ht_in_in);
  const weightLb = numOrNull(info?.wt);
  const heightCm = heightIn != null ? Math.round(heightIn * 2.54) : null;
  const weightKg = weightLb != null ? Math.round(weightLb * 0.453592) : null;
  const birthDate = info?.birth_date && info.birth_date !== 'NA' ? info.birth_date.slice(0, 10) : null;

  let slug = slugify(playerName);
  const slugTaken = await pool.query(`SELECT 1 FROM entities WHERE slug = $1`, [slug]);
  if (slugTaken.rows.length) slug = `${slug}-${breferId}`;

  const inserted = await pool.query(
    `INSERT INTO entities (entity_type, canonical_name, slug, birth_date, height_cm, weight_kg, external_ids, is_active)
     VALUES ('player', $1, $2, $3, $4, $5, $6::jsonb, true) RETURNING id`,
    [playerName, slug, birthDate, heightCm, weightKg, JSON.stringify({ bref_player_id: breferId })]
  );
  return inserted.rows[0].id;
}

// club_entity_id can't live on the dedicated column for rows that share one
// season_id across multiple result_tabs (Awards' 6 candidate lists, All-Star's
// roster) — uq_player_season_club is UNIQUE(entity_id, season_id,
// club_entity_id), and any player appearing under 2+ tabs in the same season
// would collide on that column. Pulled from the Regular Season Players tab
// (same year, same entity) and stored in stats jsonb instead — the /players
// route's club join already falls back there. Box-score shooting/counting
// stats (fgm/tpm/ftm/assists/rebounds/blocks) are pulled from that same row
// too, for these pages' condensed stat columns — none of Awards/EOST/All-Star
// Selections CSVs carry box-score data of their own.
async function getRegularSeasonStats(pool, competitionId, entityId, year) {
  const row = await pool.query(`
    SELECT reg.club_entity_id, reg.stats
    FROM player_season_stats reg
    JOIN result_tabs rt ON rt.id = reg.result_tab_id
    JOIN seasons s ON s.id = rt.season_id
    WHERE rt.tab_key = 'players' AND s.competition_id = $1 AND s.event_id = 74 AND s.year = $2
      AND reg.entity_id = $3
    LIMIT 1
  `, [competitionId, year, entityId]);
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
    // Season totals for pages with a Per Game/Total toggle — minutes/points
    // aren't here since those already come from a live join to the Regular
    // Season row (see results.js's regularSeasonId fallback), not a copy
    // baked in at ingestion time.
    totals: {
      fgm: t.fgm ?? null, tpm: t.tpm ?? null, ftm: t.ftm ?? null,
      assists: t.assists ?? null, rebounds: t.rebounds ?? null, blocks: t.blocks ?? null,
    },
  };
}

module.exports = { loadCareerInfo, resolvePlayerEntity, getRegularSeasonStats };
