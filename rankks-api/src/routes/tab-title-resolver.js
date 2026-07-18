// tab-title-resolver.js
// Shared by every results.js route that renders a page title. Given a
// competition + tab context + year, returns the admin-configured title
// override if one exists for that year, or null if nothing's configured
// (callers fall back to their own hardcoded default in that case).
//
// Match priority when multiple tab_titles rows could apply:
//   1. Exact tab_key match beats a tab_group (template) match
//   2. A section-specific override (standings/game) beats 'default'
//   3. Most recent valid_from wins any remaining tie
const { queryAll } = require('../db');

async function resolveTabTitle({ competitionId, tabKey, tabGroup, groupName, section, year }) {
  if (!competitionId || !year) return null;

  const rows = await queryAll(`
    SELECT tab_key, tab_group, section, title_template, valid_from
    FROM tab_titles
    WHERE competition_id = $1
      AND (tab_key = $2 OR (tab_group IS NOT NULL AND tab_group = $3))
      AND section = ANY($4::text[])
      AND valid_from <= $5
      AND (valid_to IS NULL OR valid_to >= $5)
  `, [competitionId, tabKey || null, tabGroup || null, [section, 'default'], year]);

  if (!rows.length) return null;

  rows.sort((a, b) => {
    const aKeyMatch = a.tab_key ? 0 : 1;
    const bKeyMatch = b.tab_key ? 0 : 1;
    if (aKeyMatch !== bKeyMatch) return aKeyMatch - bKeyMatch;

    const aSec = a.section === section ? 0 : 1;
    const bSec = b.section === section ? 0 : 1;
    if (aSec !== bSec) return aSec - bSec;

    return b.valid_from - a.valid_from;
  });

  let title = rows[0].title_template;
  if (groupName) title = title.replace('{group_name}', groupName);
  return title;
}

module.exports = { resolveTabTitle };
