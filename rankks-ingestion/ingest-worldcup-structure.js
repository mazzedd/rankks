// ingest-worldcup-structure.js
// Creates the season row (if missing) and seeds result_tabs for FIFA
// World Cup editions. Two formats, selected by year — same branching
// pattern ucl-structure.js uses for its pre/post-2024 split:
//
//   dbYear < FORMAT_CHANGE_YEAR (2014/2018/2022 — 32 teams):
//     8 groups (A-H), 5-round knockout: Final, 3rd Place, Semifinals,
//     Quarter Finals, Round of 16. Navigation: FOOT-NAV-05.
//
//   dbYear >= FORMAT_CHANGE_YEAR (2026+ — 48 teams):
//     12 groups (A-L), 6-round knockout: adds Round of 32 ahead of
//     Round of 16. Navigation: FOOT-NAV-04.
//
// "3rd Place" was discovered late (verified against real 2022 API data
// — API-Sports round string "3rd Place Final") and retroactively added
// to the already-ingested 2026 season via a one-time SQL fix; both
// format branches here include it going forward so no season created
// from this point on is ever missing it again.
//
// year_convention = 'end' for this competition (confirmed via the DB
// routing-bug fix earlier), so dbYear = season directly, no offset.
const { queryOne, query } = require('./db');

const FORMAT_CHANGE_YEAR = 2026;

const GROUPS_OLD = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const GROUPS_NEW = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

const FINAL_TOUR_OLD = [
  { tab_key: 'final',          tab_name: 'Final',          display_order: 10 },
  { tab_key: '3rd-place',      tab_name: '3rd Place',      display_order: 11 },
  { tab_key: 'semi-finals',    tab_name: 'Semifinals',     display_order: 12 },
  { tab_key: 'quarter-finals', tab_name: 'Quarter Finals', display_order: 13 },
  { tab_key: 'round-of-16',    tab_name: 'Round of 16',    display_order: 14 },
];

const FINAL_TOUR_NEW = [
  { tab_key: 'final',          tab_name: 'Final',          display_order: 10 },
  { tab_key: '3rd-place',      tab_name: '3rd Place',      display_order: 11 },
  { tab_key: 'semi-finals',    tab_name: 'Semifinals',     display_order: 12 },
  { tab_key: 'quarter-finals', tab_name: 'Quarter Finals', display_order: 13 },
  { tab_key: 'round-of-16',    tab_name: 'Round of 16',    display_order: 14 },
  { tab_key: 'round-of-32',    tab_name: 'Round of 32',    display_order: 15 },
];

const FLAT_TABS = [
  { tab_key: 'scorers',   tab_name: 'Scorers',   typology: 'players',        display_order: 200 },
  { tab_key: 'passers',   tab_name: 'Passers',   typology: 'players',        display_order: 201 },
  { tab_key: 'players',   tab_name: 'Players',   typology: 'players',        display_order: 202 },
  { tab_key: 'countries', tab_name: 'Countries', typology: 'countries',      display_order: 203 },
  { tab_key: 'videos',    tab_name: 'Videos',    typology: 'iconic_moments', display_order: 999 },
];

async function ingestStructure(season, config, callApi) {
  console.log(`  🏗️  Structure ${season}...`);

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.competitionSlug]);
  if (!comp) throw new Error(`Competition not found: ${config.competitionSlug}`);

  const dbYear = season; // year_convention = 'end' — no offset
  const isNewFormat = dbYear >= FORMAT_CHANGE_YEAR;

  let seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND event_id IS NULL`,
    [comp.id, dbYear]
  );
  if (!seasonRow) {
    seasonRow = await queryOne(
      `INSERT INTO seasons (competition_id, year, status, gender, sub_edition)
       VALUES ($1, $2, 'past', 'M', 1) RETURNING id`,
      [comp.id, dbYear]
    );
    console.log(`     ✅ Created season row for year ${dbYear} (format=${isNewFormat ? '2026+' : 'pre-2026'})`);
  } else {
    console.log(`     ↪ Season row already exists for year ${dbYear} (id ${seasonRow.id})`);
  }

  const seasonId = seasonRow.id;

  const groups = isNewFormat ? GROUPS_NEW : GROUPS_OLD;
  const groupTabs = groups.map((g, i) => ({
    tab_key: `group-${g.toLowerCase()}`,
    tab_name: `Group ${g}`,
    typology: 'standings_game',
    tab_group: 'group_stages',
    group_name: g,
    display_order: 100 + i,
  }));

  const finalTourRounds = isNewFormat ? FINAL_TOUR_NEW : FINAL_TOUR_OLD;
  const finalTourTabs = finalTourRounds.map(r => ({
    ...r,
    typology: 'game',
    tab_group: 'final_tour',
    group_name: null,
  }));

  const flatTabs = FLAT_TABS.map(t => ({ ...t, tab_group: null, group_name: null }));

  const allTabs = [...finalTourTabs, ...groupTabs, ...flatTabs];
  const expectedCount = finalTourRounds.length + groups.length + FLAT_TABS.length;

  let created = 0, skipped = 0;

  for (const t of allTabs) {
    const existing = await queryOne(
      `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
      [seasonId, t.tab_key]
    );
    if (existing) { skipped++; continue; }

    await query(
      `INSERT INTO result_tabs
         (season_id, tab_name, tab_key, typology, display_order, is_default, tab_group, group_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        seasonId, t.tab_name, t.tab_key, t.typology, t.display_order,
        t.tab_key === 'final',
        t.tab_group, t.group_name,
      ]
    );
    created++;
  }

  console.log(`     ✅ Tabs: ${created} created, ${skipped} already existed (${expectedCount} total expected, format=${isNewFormat ? '2026+' : 'pre-2026'})`);

  return { seasonId, dbYear, isNewFormat };
}

module.exports = { ingestStructure, GROUPS_OLD, GROUPS_NEW, FINAL_TOUR_OLD, FINAL_TOUR_NEW, FORMAT_CHANGE_YEAR };
