// ingest-ucl-structure.js
// Creates the season row (if missing) and seeds all 17 result_tabs:
//   - 4 Final Tour rounds   (tab_group = 'final_tour')
//   - 8 Group Stage groups  (tab_group = 'group_stages', group_name = 'A'..'H')
//   - 4 player/club-stat tabs (tab_group = NULL: scorers, passers, players, clubs)
//   - 1 Videos tab          (tab_group = NULL, typology 'iconic_moments',
//                             per the conditional-visibility pattern —
//                             omitted from API output until content exists,
//                             so seeding it here is safe and consistent)
const { queryOne, query } = require('./db');

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const FINAL_TOUR_ROUNDS = [
  { tab_key: 'final',          tab_name: 'Final',          display_order: 10 },
  { tab_key: 'semi-finals',    tab_name: 'Semifinals',     display_order: 11 },
  { tab_key: 'quarter-finals', tab_name: 'Quarter Finals', display_order: 12 },
  { tab_key: 'round-of-16',    tab_name: 'Round of 16',    display_order: 13 },
];

async function ingestStructure(season, config, callApi) {
  console.log(`  🏗️  Structure ${season}...`);

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.competitionSlug]);
  if (!comp) throw new Error(`Competition not found: ${config.competitionSlug}`);

  // UCL stores year as END year (year_convention = 'end'). API-Sports
  // season=2022 means the 2022/23 campaign, which RANKKS stores as year=2023.
  const dbYear = season + 1;

  let seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND event_id IS NULL`,
    [comp.id, dbYear]
  );
  if (!seasonRow) {
    seasonRow = await queryOne(
      `INSERT INTO seasons (competition_id, year, status, gender, sub_edition)
       VALUES ($1, $2, 'past', NULL, 1) RETURNING id`,
      [comp.id, dbYear]
    );
    console.log(`     ✅ Created season row for DB year ${dbYear} (API season ${season})`);
  } else {
    console.log(`     ↪ Season row already exists for DB year ${dbYear} (id ${seasonRow.id})`);
  }

  const seasonId = seasonRow.id;

  // Group Stage tabs — one per group, typology standings_game since each
  // shows a standings table AND that group's results together
  const groupTabs = GROUPS.map((g, i) => ({
    tab_key: `group-${g.toLowerCase()}`,
    tab_name: `Group ${g}`,
    typology: 'standings_game',
    tab_group: 'group_stages',
    group_name: g,
    display_order: 100 + i,
  }));

  // Final Tour tabs — knockout rounds, typology game (results only, no table)
  const finalTourTabs = FINAL_TOUR_ROUNDS.map(r => ({
    ...r,
    typology: 'game',
    tab_group: 'final_tour',
    group_name: null,
  }));

  // Flat season-wide tabs — same pattern as Ligue 1
  const flatTabs = [
    { tab_key: 'scorers', tab_name: 'Scorers', typology: 'players', tab_group: null, group_name: null, display_order: 200 },
    { tab_key: 'passers', tab_name: 'Passers', typology: 'players', tab_group: null, group_name: null, display_order: 201 },
    { tab_key: 'players', tab_name: 'Players', typology: 'players', tab_group: null, group_name: null, display_order: 202 },
    { tab_key: 'clubs',   tab_name: 'Clubs',   typology: 'clubs',   tab_group: null, group_name: null, display_order: 203 },
    { tab_key: 'videos',  tab_name: 'Videos',  typology: 'iconic_moments', tab_group: null, group_name: null, display_order: 999 },
  ];

  const allTabs = [...finalTourTabs, ...groupTabs, ...flatTabs];
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
        t.tab_key === 'final', // 'final' is the default tab for Final Tour
        t.tab_group, t.group_name,
      ]
    );
    created++;
  }

  console.log(`     ✅ Tabs: ${created} created, ${skipped} already existed (17 total expected)`);

  return { seasonId, dbYear };
}

module.exports = { ingestStructure, GROUPS, FINAL_TOUR_ROUNDS };