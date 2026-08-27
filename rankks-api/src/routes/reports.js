// src/routes/reports.js — Tennis player comparison reports (Mohamed
// 2026-08-20: "multi-criteria / multi-player comparison" feature). A saved
// report only stores the INPUTS (players/gender/filters), never computed
// numbers — GET /compare is the one computation path, used both for the
// live "try before you save" builder and for reopening a saved report, so
// there's exactly one place the stats logic lives (per Mohamed: "both
// query and PDF" — the query is always live, the PDF is just an export of
// whatever it currently returns).
const express  = require('express');
const router   = express.Router();
const { queryAll, queryOne } = require('../db');
const userAuth = require('../middleware/userAuth');

const TENNIS_SPORT_ID = 2;

// Mirrors competitions.js's own TOUR_CATEGORY_SLUGS convention (grand-slam
// is one shared category row across both tours; the tiers below are
// gender-split rows sharing a tier concept) — confirmed against
// event_categories, not guessed.
const CATEGORY_TIER_SLUGS = {
  grand_slam:   { M: 'grand-slam',        F: 'grand-slam' },
  masters_1000: { M: 'atp-masters-1000',  F: 'wta-1000' },
  masters_500:  { M: 'atp-masters-500',   F: 'wta-500' },
  masters_250:  { M: 'atp-masters-250',   F: 'wta-250' },
  challenger:   { M: 'atp-challenger',    F: 'wta-125' },
};
const VALID_SURFACES = ['Hard', 'Clay', 'Grass', 'Carpet'];

function resolveCategorySlugs(tierKeys, gender) {
  const slugs = tierKeys.filter(k => CATEGORY_TIER_SLUGS[k]).map(k => CATEGORY_TIER_SLUGS[k][gender]);
  return slugs.length ? slugs : null; // null = no (recognized) filter = All
}
function resolveSurfaces(values) {
  const valid = values.filter(v => VALID_SURFACES.includes(v));
  return valid.length ? valid : null; // null = no filter = All
}

// One player's full stat set — PROFILE bio, TOURNAMENTS (scoped by the
// category/surface filters), RANKINGS (career-wide, never filtered — a
// ranking isn't category/surface-scoped, per the confirmed section-scoping
// rule). "my rank" in any match = w_rank if this player is the winner, else
// l_rank — confirmed the dataset's home_entity_id always equals
// winner_entity_id (checked 3 real Finals rows), so this holds regardless
// of home/away.
async function computePlayerStats(entityId, gender, categorySlugs, surfaces) {
  const catFilter  = categorySlugs ? `AND ec.slug = ANY($3::text[])` : '';
  const surfFilter = categorySlugs
    ? (surfaces ? `AND g.surface = ANY($4::text[])` : '')
    : (surfaces ? `AND g.surface = ANY($3::text[])` : '');
  const scopedParams = [TENNIS_SPORT_ID, entityId];
  if (categorySlugs) scopedParams.push(categorySlugs);
  if (surfaces) scopedParams.push(surfaces);

  const seasonsRow = await queryOne(`
    SELECT COUNT(DISTINCT se.year) AS n
    FROM games g
    JOIN result_tabs rt ON rt.id = g.result_tab_id
    JOIN seasons se ON se.id = rt.season_id
    JOIN competitions c ON c.id = se.competition_id
    JOIN event_categories ec ON ec.id = c.category_id
    WHERE ec.sport_id = $1 AND rt.tab_key LIKE 'draw-singles%'
      AND (g.home_entity_id = $2 OR g.away_entity_id = $2)
  `, [TENNIS_SPORT_ID, entityId]);

  const tournamentsRow = await queryOne(`
    SELECT
      COUNT(DISTINCT se.id) AS played,
      COUNT(*) FILTER (
        WHERE g.round ILIKE '%final%' AND g.round NOT ILIKE '%semi%' AND g.round NOT ILIKE '%quarter%'
          AND g.winner_entity_id = $2
      ) AS titles,
      COUNT(*) FILTER (
        WHERE g.round ILIKE '%final%' AND g.round NOT ILIKE '%semi%' AND g.round NOT ILIKE '%quarter%'
      ) AS finals_reached
    FROM games g
    JOIN result_tabs rt ON rt.id = g.result_tab_id
    JOIN seasons se ON se.id = rt.season_id
    JOIN competitions c ON c.id = se.competition_id
    JOIN event_categories ec ON ec.id = c.category_id
    WHERE ec.sport_id = $1 AND rt.tab_key LIKE 'draw-singles%'
      AND (g.home_entity_id = $2 OR g.away_entity_id = $2)
      ${catFilter} ${surfFilter}
  `, scopedParams);

  const rankRow = await queryOne(`
    WITH my_ranks AS (
      SELECT se.year, g.match_date,
        (CASE WHEN g.winner_entity_id = $2 THEN g.stats->>'w_rank' ELSE g.stats->>'l_rank' END) AS rnk_txt
      FROM games g
      JOIN result_tabs rt ON rt.id = g.result_tab_id
      JOIN seasons se ON se.id = rt.season_id
      JOIN competitions c ON c.id = se.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      WHERE ec.sport_id = $1 AND rt.tab_key LIKE 'draw-singles%'
        AND (g.home_entity_id = $2 OR g.away_entity_id = $2)
        AND se.status IN ('past', 'ongoing')
    ),
    valid AS (
      SELECT year, match_date, rnk_txt::int AS rnk FROM my_ranks WHERE rnk_txt ~ '^[0-9]+$'
    ),
    year_end_snapshot AS (
      SELECT DISTINCT ON (year) year, rnk FROM valid ORDER BY year, match_date DESC NULLS LAST
    )
    SELECT
      (SELECT MIN(rnk) FROM valid) AS best_ranking,
      (SELECT COUNT(*) FROM year_end_snapshot WHERE rnk = 1) AS times_no1,
      (SELECT COUNT(*) FROM valid) AS rank_data_points
  `, [TENNIS_SPORT_ID, entityId]);

  return {
    seasons: Number(seasonsRow.n),
    tournaments_played: Number(tournamentsRow.played),
    titles: Number(tournamentsRow.titles),
    finals_reached: Number(tournamentsRow.finals_reached),
    finals_won_pct: Number(tournamentsRow.finals_reached) > 0
      ? Math.round((Number(tournamentsRow.titles) / Number(tournamentsRow.finals_reached)) * 100)
      : null,
    // No rank data at all for this player (common pre-1990, per the
    // decade-coverage check done during planning) — show "—", not a
    // falsely-precise number.
    best_ranking: Number(rankRow.rank_data_points) > 0 ? Number(rankRow.best_ranking) : null,
    times_no1: Number(rankRow.rank_data_points) > 0 ? Number(rankRow.times_no1) : null,
  };
}

async function getDebutDate(entityId) {
  const row = await queryOne(`
    SELECT MIN(g.match_date) AS d
    FROM games g
    JOIN result_tabs rt ON rt.id = g.result_tab_id
    WHERE rt.tab_key LIKE 'draw-singles%' AND (g.home_entity_id = $1 OR g.away_entity_id = $1)
  `, [entityId]);
  return row.d;
}

function ageAt(birthDate, atDate) {
  if (!birthDate || !atDate) return null;
  const b = new Date(birthDate), a = new Date(atDate);
  let age = a.getFullYear() - b.getFullYear();
  if (a.getMonth() < b.getMonth() || (a.getMonth() === b.getMonth() && a.getDate() < b.getDate())) age--;
  return age;
}
function daysBetween(from, to) {
  if (!from || !to) return null;
  return Math.round((new Date(to) - new Date(from)) / 86400000);
}

// RECORD FIRSTS — Rankings' "first reached No.1" + one "first title" per
// category tier (Grand Slam down to Masters 250 — Challenger excluded per
// Mohamed: "starting from Rankings, Grand Slam to Master 250"). Career-wide,
// never filtered by the Category/Surface builder filters (these are
// historical milestones, not scoped stats). Verified against real facts
// during planning (Federer: first Slam = Wimbledon 2003, first M1000 =
// Hamburg 2002 — both correct).
const RECORD_FIRSTS_TIERS = [
  { key: 'grand_slam',   label: 'Grand Slam' },
  { key: 'masters_1000', label: '1000' },
  { key: 'masters_500',  label: '500' },
  { key: 'masters_250',  label: '250' },
];

async function getFirstNo1(entityId, gender) {
  return queryOne(`
    WITH my_ranks AS (
      SELECT g.match_date,
        (CASE WHEN g.winner_entity_id = $1 THEN g.stats->>'w_rank' ELSE g.stats->>'l_rank' END) AS rnk_txt
      FROM games g
      JOIN result_tabs rt ON rt.id = g.result_tab_id
      WHERE rt.tab_key = ('draw-singles-' || lower($2))
        AND (g.home_entity_id = $1 OR g.away_entity_id = $1)
    )
    SELECT match_date FROM my_ranks WHERE rnk_txt = '1' ORDER BY match_date ASC NULLS LAST LIMIT 1
  `, [entityId, gender]);
}

async function getFirstTitle(entityId, slugs) {
  return queryOne(`
    SELECT g.match_date, c.name AS competition_name, se.year
    FROM games g
    JOIN result_tabs rt ON rt.id = g.result_tab_id
    JOIN seasons se ON se.id = rt.season_id
    JOIN competitions c ON c.id = se.competition_id
    JOIN event_categories ec ON ec.id = c.category_id
    WHERE ec.sport_id = $1 AND rt.tab_key LIKE 'draw-singles%'
      AND g.round ILIKE '%final%' AND g.round NOT ILIKE '%semi%' AND g.round NOT ILIKE '%quarter%'
      AND g.winner_entity_id = $2 AND ec.slug = ANY($3::text[])
    ORDER BY g.match_date ASC NULLS LAST
    LIMIT 1
  `, [TENNIS_SPORT_ID, entityId, slugs]);
}

async function computeRecordFirsts(entityId, gender, birthDate) {
  const debutDate = await getDebutDate(entityId);

  const [no1Row, ...titleRows] = await Promise.all([
    getFirstNo1(entityId, gender),
    ...RECORD_FIRSTS_TIERS.map(t => getFirstTitle(entityId, [CATEGORY_TIER_SLUGS[t.key][gender]])),
  ]);

  const out = {
    rankings: no1Row?.match_date ? {
      label: null,
      date: no1Row.match_date,
      age: ageAt(birthDate, no1Row.match_date),
      days_after_debut: daysBetween(debutDate, no1Row.match_date),
    } : null,
  };
  RECORD_FIRSTS_TIERS.forEach((t, i) => {
    const row = titleRows[i];
    out[t.key] = row?.match_date ? {
      label: `${row.competition_name} ${row.year}`,
      date: row.match_date,
      age: ageAt(birthDate, row.match_date),
      days_after_debut: daysBetween(debutDate, row.match_date),
    } : null;
  });
  return out;
}

async function getPlayerYears(entityId) {
  const rows = await queryAll(`
    SELECT DISTINCT se.year
    FROM games g
    JOIN result_tabs rt ON rt.id = g.result_tab_id
    JOIN seasons se ON se.id = rt.season_id
    JOIN competitions c ON c.id = se.competition_id
    JOIN event_categories ec ON ec.id = c.category_id
    WHERE ec.sport_id = $1 AND rt.tab_key LIKE 'draw-singles%'
      AND (g.home_entity_id = $2 OR g.away_entity_id = $2)
  `, [TENNIS_SPORT_ID, entityId]);
  return new Set(rows.map(r => r.year));
}

// GET /api/reports/compare?gender=M&players=8151,3008&category=grand_slam,masters_1000&surface=Clay
router.get('/compare', async (req, res, next) => {
  try {
    const { gender, players, category, surface } = req.query;
    if (gender !== 'M' && gender !== 'F') {
      return res.status(400).json({ error: 'gender must be M or F' });
    }
    const playerIds = String(players || '').split(',').map(s => parseInt(s.trim())).filter(Number.isInteger);
    if (playerIds.length < 2 || playerIds.length > 4) {
      return res.status(400).json({ error: 'players must be 2 to 4 entity ids' });
    }
    const categoryFilter = category ? category.split(',').map(s => s.trim()).filter(Boolean) : [];
    const surfaceFilter  = surface  ? surface.split(',').map(s => s.trim()).filter(Boolean)  : [];
    const categorySlugs = resolveCategorySlugs(categoryFilter, gender);
    const surfaces      = resolveSurfaces(surfaceFilter);

    const bioRows = await queryAll(`
      SELECT e.id, e.canonical_name, e.slug, e.image_url, e.gender, e.sport_attributes, e.birth_date,
        co.iso2 AS country_iso2, co.name AS country_name
      FROM entities e
      LEFT JOIN countries co ON co.id = e.country_id
      WHERE e.id = ANY($1::int[]) AND e.entity_type = 'player'
    `, [playerIds]);
    if (bioRows.length !== playerIds.length) {
      return res.status(404).json({ error: 'One or more players not found' });
    }
    const wrongGender = bioRows.find(r => r.gender !== gender);
    if (wrongGender) {
      return res.status(400).json({ error: `${wrongGender.canonical_name} is not on the selected tour` });
    }

    const yearSets = await Promise.all(playerIds.map(getPlayerYears));
    const seasonsInCommon = [...yearSets[0]].filter(y => yearSets.every(set => set.has(y))).length;

    const stats = await Promise.all(playerIds.map(id => computePlayerStats(id, gender, categorySlugs, surfaces)));
    const recordFirsts = await Promise.all(playerIds.map(id => {
      const bio = bioRows.find(r => r.id === id);
      return computeRecordFirsts(id, gender, bio.birth_date);
    }));

    const players_out = playerIds.map((id, i) => {
      const bio = bioRows.find(r => r.id === id);
      const attrs = bio.sport_attributes || {};
      return {
        entity_id: id,
        name: bio.canonical_name,
        slug: bio.slug,
        image_url: bio.image_url,
        country_iso2: bio.country_iso2,
        hand: attrs.hand === 'L' ? 'Left-handed' : attrs.hand === 'R' ? 'Right-handed' : null,
        backhand: attrs.backhand === 'one' ? 'One-handed' : attrs.backhand === 'two' ? 'Two-handed' : null,
        seasons: stats[i].seasons,
        seasons_in_common: seasonsInCommon,
        tournaments_played: stats[i].tournaments_played,
        titles: stats[i].titles,
        finals_reached: stats[i].finals_reached,
        finals_won_pct: stats[i].finals_won_pct,
        best_ranking: stats[i].best_ranking,
        times_no1: stats[i].times_no1,
        record_firsts: recordFirsts[i],
      };
    });

    res.json({ data: { gender, category_filter: categoryFilter, surface_filter: surfaceFilter, players: players_out } });
  } catch (err) {
    next(err);
  }
});

router.use(userAuth);

// GET /api/reports — current user's saved reports
router.get('/', async (req, res, next) => {
  try {
    const rows = await queryAll(`
      SELECT r.id, r.name, r.sport_slug, r.gender, r.player_entity_ids,
        r.category_filter, r.surface_filter, r.created_at, r.updated_at,
        ARRAY(
          SELECT e.canonical_name FROM entities e
          WHERE e.id = ANY(r.player_entity_ids)
          ORDER BY array_position(r.player_entity_ids, e.id)
        ) AS player_names
      FROM user_reports r
      WHERE r.user_id = $1
      ORDER BY r.updated_at DESC
    `, [req.user.id]);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports — body: { name, gender, player_ids[], category_filter[], surface_filter[] }
router.post('/', async (req, res, next) => {
  try {
    const { name, gender, player_ids, category_filter = [], surface_filter = [] } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (gender !== 'M' && gender !== 'F') {
      return res.status(400).json({ error: 'gender must be M or F' });
    }
    if (!Array.isArray(player_ids) || player_ids.length < 2 || player_ids.length > 4 || !player_ids.every(Number.isInteger)) {
      return res.status(400).json({ error: 'player_ids must be 2 to 4 integers' });
    }

    const report = await queryOne(`
      INSERT INTO user_reports (user_id, name, gender, player_entity_ids, category_filter, surface_filter)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, name, sport_slug, gender, player_entity_ids, category_filter, surface_filter, created_at, updated_at
    `, [req.user.id, String(name).trim(), gender, player_ids, category_filter, surface_filter]);

    res.status(201).json({ data: report });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/reports/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await queryOne(`
      DELETE FROM user_reports WHERE id = $1 AND user_id = $2 RETURNING id
    `, [req.params.id, req.user.id]);
    if (!deleted) return res.status(404).json({ error: 'Report not found' });
    res.json({ data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
