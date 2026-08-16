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

function applySuffix(kind, { isTotalsStyle, year, isPast }) {
  if (isTotalsStyle) return `${kind} - through ${year}`;
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
    if (row) return applySuffix(row.subtitle_kind, { isTotalsStyle: row.is_totals_style, year, isPast });
  }
  return null;
}

module.exports = { resolveSubtitle };
