// subtitle-resolver.js
// Shared by every route that needs to resolve an admin-configurable
// subtitle line for a Line A/B item. One row = (sport, competition,
// item_a, item_b) -> subtitle_kind + is_totals_style. No era-scoping —
// rows are edited in place, never versioned by year (see rankks-admin's
// Subtitles page: edit-only, no add/delete).
//
// candidates: try in specificity order (e.g. [{itemA:'Awards', itemB:'MVP'},
// {itemA:'Standings'}] — a more specific (item_a, item_b) pair should be
// tried before a broader item_a-only fallback). For each candidate, try
// scope in specificity order: competition-specific row > sport-wide row >
// global default row. First match wins.
const { queryOne } = require('../db');

async function findRow({ sportId, competitionId, itemA, itemB }) {
  const scopes = [];
  if (competitionId) scopes.push({ sportId: sportId || null, competitionId });
  if (sportId) scopes.push({ sportId, competitionId: null });
  scopes.push({ sportId: null, competitionId: null });

  for (const scope of scopes) {
    const row = await queryOne(`
      SELECT subtitle_kind, is_totals_style
      FROM subtitles
      WHERE item_a = $1
        AND sport_id IS NOT DISTINCT FROM $2
        AND competition_id IS NOT DISTINCT FROM $3
        AND COALESCE(item_b, '') = COALESCE($4::text, '')
      LIMIT 1
    `, [itemA, scope.sportId, scope.competitionId, itemB || null]);
    if (row) return row;
  }
  return null;
}

// Totals-style items ("Player Stats", "Driver Career History", etc.)
// aggregate from the competition's own first INGESTED season through the
// browsed year — never literally "through <year>" alone, which implied a
// start point of zero (Mohamed 2026-08-26: same fix as the Totals pages'
// own breadcrumb pill). The admin only owns `kind` (the label) and the
// is_totals_style flag; this year-range extension is computed here so it
// can never drift from what the breadcrumb shows, and never needs
// per-row admin upkeep as new seasons get ingested.
//
// Deliberately NOT competitions.founded_year (verified wrong 2026-08-26:
// Saudi Pro League's founded_year is 1976, but only its 2027 season is
// actually ingested — MIN(seasons.year) correctly gives 2027, matching
// GET /competitions/:slug/year-range's own firstDataYear field). Never
// widened to sibling competitions sharing a category either, unlike that
// route's minYear/maxYear (a different question — "how far back should the
// year-selector strip scroll" — Totals pages never aggregate across
// sibling competitions). year_convention-aware, same toDisplayYear
// conversion every other All-Time template applies. sportId-only scope
// (tennis's tour-wide Totals, no single competition of its own) widens to
// the oldest ingested season across every competition in the sport —
// "take into account the oldest competition in ATP or WTA" (Mohamed
// 2026-08-26), not scoped to whichever tour is being viewed since this
// admin row and its resolved text are shared by both.
// F1 alone owns a dedicated f1_seasons table with no competition_id column
// (see f1.js's own comment) — the generic seasons-table query below finds
// nothing for it and would silently fall back to "through <year>". MotoGP
// has no such split (its seasons live in the generic `seasons` table like
// every other sport, just with an extra `category` column for Moto2/Moto3
// — verified 2026-08-26), so this is an F1-only exception, not a
// car-racing-wide one.
const F1_SLUG = 'formula-1-world-championship';

async function getMinYear({ sportId, competitionId }) {
  if (competitionId) {
    const comp = await queryOne('SELECT slug FROM competitions WHERE id = $1', [competitionId]);
    if (comp?.slug === F1_SLUG) {
      const row = await queryOne('SELECT MIN(year) AS min_year FROM f1_seasons');
      return row?.min_year ?? null;
    }
    const row = await queryOne(`
      SELECT MIN(CASE WHEN c.year_convention = 'start' THEN s.year + 1 ELSE s.year END) AS min_year
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      WHERE c.id = $1
    `, [competitionId]);
    return row?.min_year ?? null;
  }
  if (sportId) {
    // competitions has no sport_id column of its own — sport is reached via
    // category_id -> event_categories.sport_id (verified 2026-08-26: every
    // competition row has a category_id, so this join never silently drops
    // one). Same path GET /competitions/:slug/year-range's own category
    // lookup uses, just aggregated the other direction (sport -> every
    // competition under it, rather than one competition -> its category).
    const row = await queryOne(`
      SELECT MIN(CASE WHEN c.year_convention = 'start' THEN s.year + 1 ELSE s.year END) AS min_year
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      WHERE ec.sport_id = $1
    `, [sportId]);
    return row?.min_year ?? null;
  }
  return null;
}

async function applySuffix(kind, { isTotalsStyle, year, isPast, sportId, competitionId }) {
  if (isTotalsStyle) {
    const minYear = await getMinYear({ sportId, competitionId });
    // "from <minYear> to <year>" — words, not a dash range (Mohamed
    // 2026-08-26: "i said - from 2022 to 2026", correcting the dash format
    // this first shipped with). The breadcrumb PILL elsewhere stays dash
    // ("2022-2026") — only this subtitle text uses the spelled-out form.
    // Single-season coverage shows just the one year, not "from 2026 to
    // 2026" — same collapse convention football_teams_all_time_template.jsx's
    // own seasonRangeLabel() already uses for the per-player seasons column.
    if (minYear != null && minYear < year) return `${kind} - from ${minYear} to ${year}`;
    return `${kind} - through ${year}`;
  }
  const inProgress = isPast === false ? ' (season in progress)' : '';
  return `${kind} - ${year}${inProgress}`;
}

/**
 * @param {object} p
 * @param {number|null} p.sportId
 * @param {number|null} p.competitionId
 * @param {{itemA: string, itemB?: string|null}[]} p.candidates  tried in specificity order
 * @param {number} p.year
 * @param {boolean} [p.isPast]  pass false to get the "(season in progress)" suffix on non-Aggregate items
 * @returns {Promise<string|null>}
 */
async function resolveSubtitle({ sportId, competitionId, candidates, year, isPast }) {
  if (!year || !candidates?.length) return null;

  for (const { itemA, itemB } of candidates.filter(c => c?.itemA)) {
    const row = await findRow({ sportId, competitionId, itemA, itemB });
    if (row) return applySuffix(row.subtitle_kind, { isTotalsStyle: row.is_totals_style, year, isPast, sportId, competitionId });
  }
  return null;
}

module.exports = { resolveSubtitle };
