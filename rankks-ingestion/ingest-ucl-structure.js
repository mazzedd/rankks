// ingest-ucl-structure.js
// Creates the season row (if missing) and seeds result_tabs.
//
// Two competition shapes, selected by dbYear (the season's END year):
//
//   dbYear < 2025 (API season < 2024, i.e. pre-2024/25):
//     Original format — 4-team groups A-H, knockout Final/Semis/QF/R16.
//     17 tabs total: 4 final_tour + 8 group_stages + 5 flat (incl. videos).
//     UNCHANGED from the original script — this branch is byte-for-byte
//     the same seeding logic as before the 2024+ format existed.
//
//   dbYear >= 2025 (API season >= 2024, i.e. 2024/25 onward):
//     New UEFA "Swiss model" format — single 36-team league phase (8
//     rounds, one combined table) instead of 8 four-team groups, plus a
//     5th knockout round (Playoffs) ahead of Round of 16.
//     19 tabs total: 5 final_tour + 9 league_phase + 5 flat (incl. videos).
//
// Both shapes coexist permanently, season by season — older UCL seasons
// keep the original tab_group ('group_stages') forever; nothing about
// this change touches already-ingested pre-2024 data.
const { queryOne, query } = require('./db');

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Pre-2024 format — UNCHANGED
const FINAL_TOUR_ROUNDS = [
  { tab_key: 'final',          tab_name: 'Final',          display_order: 10 },
  { tab_key: 'semi-finals',    tab_name: 'Semifinals',     display_order: 11 },
  { tab_key: 'quarter-finals', tab_name: 'Quarter Finals', display_order: 12 },
  { tab_key: 'round-of-16',    tab_name: 'Round of 16',    display_order: 13 },
];

// 2024+ format — Final Tour gains a 5th round (Playoffs) ahead of R16.
// Note this is a SEPARATE constant from FINAL_TOUR_ROUNDS above, not a
// mutation of it — pre-2024 seasons must never see a Playoffs tab.
const FINAL_TOUR_ROUNDS_2024PLUS = [
  { tab_key: 'final',          tab_name: 'Final',          display_order: 10 },
  { tab_key: 'semi-finals',    tab_name: 'Semifinals',     display_order: 11 },
  { tab_key: 'quarter-finals', tab_name: 'Quarter Finals', display_order: 12 },
  { tab_key: 'round-of-16',    tab_name: 'Round of 16',    display_order: 13 },
  { tab_key: 'playoffs',       tab_name: 'Playoffs',       display_order: 14 },
];

// 2024+ league phase — 1 standings tab + 8 round tabs. Standings tab has
// typology 'standings' (table only, no games of its own — games live on
// the round tabs and get aggregated across them by
// computeLeaguePhaseStandings). Round tabs have typology 'game' (fixture
// list only, no table) — this mirrors Final Tour's existing single-
// typology-per-tab pattern, just under a different tab_group.
const LEAGUE_PHASE_TABS = [
  { tab_key: 'league-standings', tab_name: 'Standings', typology: 'standings', display_order: 100 },
  ...Array.from({ length: 8 }, (_, i) => ({
    tab_key: `r${i + 1}`,
    tab_name: `R${i + 1}`,
    typology: 'game',
    display_order: 101 + i,
  })),
];

const FORMAT_CHANGE_DB_YEAR = 2025; // first season under the new format

async function ingestStructure(season, config, callApi) {
  console.log(`  🏗️  Structure ${season}...`);

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.competitionSlug]);
  if (!comp) throw new Error(`Competition not found: ${config.competitionSlug}`);

  // UCL stores year as END year (year_convention = 'end'). API-Sports
  // season=2022 means the 2022/23 campaign, which RANKKS stores as year=2023.
  const dbYear = season + 1;
  const isNewFormat = dbYear >= FORMAT_CHANGE_DB_YEAR;

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

  // Flat season-wide tabs — same pattern as Ligue 1. Unchanged across
  // both formats; only the knockout/group-phase tabs above differ.
  const flatTabs = [
    { tab_key: 'scorers', tab_name: 'Scorers', typology: 'players', tab_group: null, group_name: null, display_order: 200 },
    { tab_key: 'passers', tab_name: 'Passers', typology: 'players', tab_group: null, group_name: null, display_order: 201 },
    { tab_key: 'players', tab_name: 'Players', typology: 'players', tab_group: null, group_name: null, display_order: 202 },
    { tab_key: 'clubs',   tab_name: 'Clubs',   typology: 'clubs',   tab_group: null, group_name: null, display_order: 203 },
    { tab_key: 'videos',  tab_name: 'Videos',  typology: 'iconic_moments', tab_group: null, group_name: null, display_order: 999 },
    // All-Time group — pinned in LineA next to Iconic Moments. typology
    // 'coming_soon' until the real Player/Team/Champion History columns
    // are spec'd — see rankks-frontend's coming_soon_template.jsx.
    { tab_key: 'all-time-players',          tab_name: 'Player Stats',     typology: 'players_all_time_fb', tab_group: 'all_time', group_name: null, display_order: 300 },
    { tab_key: 'all-time-teams',            tab_name: 'Team Stats',       typology: 'teams_all_time', tab_group: 'all_time', group_name: null, display_order: 301 },
    { tab_key: 'all-time-champion-history', tab_name: 'Champion History', typology: 'champion_history_fb', tab_group: 'all_time', group_name: null, display_order: 302 },
  ];

  let allTabs;
  let expectedCount;

  if (isNewFormat) {
    const finalTourTabs = FINAL_TOUR_ROUNDS_2024PLUS.map(r => ({
      ...r,
      typology: 'game',
      tab_group: 'final_tour',
      group_name: null,
    }));
    const leaguePhaseTabs = LEAGUE_PHASE_TABS.map(t => ({
      ...t,
      tab_group: 'league_phase',
      group_name: null,
    }));
    allTabs = [...finalTourTabs, ...leaguePhaseTabs, ...flatTabs];
    expectedCount = 19; // 5 final_tour + 9 league_phase + 5 flat
  } else {
    // Original pre-2024 shape — byte-identical to the script before this change
    const groupTabs = GROUPS.map((g, i) => ({
      tab_key: `group-${g.toLowerCase()}`,
      tab_name: `Group ${g}`,
      typology: 'standings_game',
      tab_group: 'group_stages',
      group_name: g,
      display_order: 100 + i,
    }));
    const finalTourTabs = FINAL_TOUR_ROUNDS.map(r => ({
      ...r,
      typology: 'game',
      tab_group: 'final_tour',
      group_name: null,
    }));
    allTabs = [...finalTourTabs, ...groupTabs, ...flatTabs];
    expectedCount = 17; // 4 final_tour + 8 group_stages + 5 flat
  }

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

  console.log(`     ✅ Tabs: ${created} created, ${skipped} already existed (${expectedCount} total expected, format=${isNewFormat ? '2024+' : 'pre-2024'})`);

  return { seasonId, dbYear, isNewFormat };
}

module.exports = { ingestStructure, GROUPS, FINAL_TOUR_ROUNDS, FINAL_TOUR_ROUNDS_2024PLUS, LEAGUE_PHASE_TABS, FORMAT_CHANGE_DB_YEAR };
