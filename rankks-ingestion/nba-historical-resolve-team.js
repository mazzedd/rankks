// Shared entity resolver for the 1947-1955 historical backfill. Unlike
// ingest-nba-games.js's teamMap (keyed by nba_team_id, one row per entity),
// scraped game/standings rows only give a plain display name + a season
// year — the same lookup entity_names already supports for every OTHER
// era-aware NBA display (see results.js's entity_conference_history/
// sport_attributes fallback chain). ingest-nba-historical-teams.js adds the
// 15 defunct franchises into this same entity_names table, so one lookup
// covers both current-lineage historical names and defunct ones uniformly —
// no separate defunct-team map needed.
const { Pool } = require('pg');

// basketball-reference and the Kaggle CSV (TeamStatistics.csv, which
// entity_names was originally derived from via ingest-nba-teams.js) sometimes
// spell the exact same franchise-era differently. Confirmed case: Detroit
// Pistons' Fort Wayne era is stored as "Ft. Wayne Zollner Pistons" in
// entity_names (from the CSV) but basketball-reference's schedule/standings
// pages call it "Fort Wayne Pistons" — same entity, same years, different
// string. Add an entry here whenever a new resolution error surfaces one;
// never silently guess a fuzzy match instead.
const NAME_ALIASES = {
  'Fort Wayne Pistons': 'Ft. Wayne Zollner Pistons',
};

async function buildResolver(pool) {
  const rows = await pool.query(
    `SELECT entity_id, display_name, start_year, end_year FROM entity_names`
  );
  // display_name -> array of { startYear, endYear, entityId }, sorted so exact
  // single-match lookups fail loudly instead of picking silently between two
  // overlapping candidates (shouldn't happen, but never guess if it does).
  const byName = new Map();
  for (const r of rows.rows) {
    if (!byName.has(r.display_name)) byName.set(r.display_name, []);
    byName.get(r.display_name).push({
      startYear: r.start_year,
      endYear: r.end_year,
      entityId: r.entity_id,
    });
  }

  return function resolve(rawName, year) {
    const name = NAME_ALIASES[rawName] || rawName;
    const candidates = byName.get(name) || [];
    const matches = candidates.filter(c => c.startYear <= year && (c.endYear == null || c.endYear >= year));
    if (matches.length === 1) return matches[0].entityId;
    if (matches.length === 0) {
      throw new Error(`No entity_names match for "${rawName}" in year ${year} — check entity_names coverage before proceeding.`);
    }
    throw new Error(`Ambiguous entity_names match for "${rawName}" in year ${year}: ${matches.map(m => m.entityId).join(', ')}`);
  };
}

module.exports = { buildResolver };
