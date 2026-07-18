// ucl-standings.js
// Derives a standings table from games rows attached to one or more
// result_tabs. UCL standings aren't pulled from an API endpoint — they're
// computed here from match data, the same underlying principle as
// Ligue 1's standings but built locally rather than provided ready-made.
//
// Tiebreak order matches UEFA's own rules closely enough for display
// purposes: points, then goal difference, then goals for. Head-to-head
// and disciplinary tiebreaks are NOT implemented — rare enough in
// practice that this is a reasonable v1 simplification, not silently
// wrong in the common case.
//
// Two competition shapes use this file:
//   - Pre-2024 group stage: 8 separate 4-team tables, one per group tab.
//     Each tab's games ARE that group's games — computeStandings(tabId)
//     used directly, one call per group. computeGroupStandings is kept
//     as a name-compatible alias so existing callers (ingest-ucl-fixtures.js)
//     don't need to change.
//   - 2024+ league phase: ONE 36-team table, but each team's 8 games are
//     spread across 8 separate round tabs (r1..r8), not one tab. The
//     standings live on their own tab (league-standings) that has no
//     games of its own — computeLeaguePhaseStandings(standingsTabId,
//     roundTabIds) reads games from all 8 round tabs and writes the
//     result onto the standings tab.
//
// aggregateStandings is now exported (previously module-private) so
// worldcup-standings.js can reuse the exact same entity-agnostic
// aggregation logic — it only reads home_entity_id/away_entity_id/score,
// no entity_type assumption — rather than duplicating it. Only the
// write step (writeStandings, which hardcodes entity_type='club') needs
// a separate implementation per competition's entity type.
const { queryAll, query } = require('./db');

// Core aggregator — entirely agnostic to where the games came from.
// Takes a flat list of {home_entity_id, away_entity_id, score} rows and
// returns sorted, ranked standings rows. Used by both call shapes below.
function aggregateStandings(games) {
  const table = {}; // entity_id -> stats accumulator

  function ensure(entityId) {
    if (!table[entityId]) {
      table[entityId] = { played: 0, won: 0, drawn: 0, lost: 0, goals_for: 0, goals_against: 0 };
    }
    return table[entityId];
  }

  for (const g of games) {
    const score = g.score; // jsonb, already parsed by pg
    if (score?.home == null || score?.away == null) continue; // not yet played

    const home = ensure(g.home_entity_id);
    const away = ensure(g.away_entity_id);

    home.played++; away.played++;
    home.goals_for += score.home; home.goals_against += score.away;
    away.goals_for += score.away; away.goals_against += score.home;

    if (score.home > score.away) { home.won++; away.lost++; }
    else if (score.away > score.home) { away.won++; home.lost++; }
    else { home.drawn++; away.drawn++; }
  }

  const rows = Object.entries(table).map(([entityId, s]) => ({
    entity_id: parseInt(entityId, 10),
    ...s,
    goal_diff: s.goals_for - s.goals_against,
    points: s.won * 3 + s.drawn,
  }));

  // Sort: points desc, goal_diff desc, goals_for desc
  rows.sort((a, b) =>
    b.points - a.points ||
    b.goal_diff - a.goal_diff ||
    b.goals_for - a.goals_for
  );

  return rows;
}

// Writes a sorted/ranked rows array to the standings table for the given
// tab, clearing first — simplest correct approach since position
// assignment depends on the full sorted set, not row-by-row upsert.
async function writeStandings(tabId, rows) {
  await query(`DELETE FROM standings WHERE result_tab_id = $1`, [tabId]);

  let position = 1;
  for (const row of rows) {
    const stats = {
      played: row.played, won: row.won, drawn: row.drawn, lost: row.lost,
      goals_for: row.goals_for, goals_against: row.goals_against,
      goal_diff: row.goal_diff, points: row.points,
    };
    await query(
      `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
       VALUES ($1, $2, $3, 'club', $4)`,
      [tabId, position, row.entity_id, JSON.stringify(stats)]
    );
    position++;
  }

  return rows.length;
}

// Single-tab case: this tab's own games ARE the full set to aggregate.
// Used by pre-2024 group stage (one tab per group, 4 teams play each
// other within that one tab) and by anything else where games and
// standings share the same result_tab_id.
async function computeStandings(tabId) {
  const games = await queryAll(
    `SELECT home_entity_id, away_entity_id, score
     FROM games
     WHERE result_tab_id = $1`,
    [tabId]
  );
  const rows = aggregateStandings(games);
  return writeStandings(tabId, rows);
}

// Name-compatible alias — pre-2024 ingestion code calls this name
// specifically. Kept as a separate export rather than renaming call
// sites, so nothing pre-2024 needs to change.
const computeGroupStandings = computeStandings;

// Multi-tab case: 2024+ league phase. The 36-team table has its own tab
// (league-standings, typology 'standings', no games attached to it
// directly) but the actual games live across 8 separate round tabs
// (r1..r8). Reads across all of them, writes the combined result onto
// the standings tab.
async function computeLeaguePhaseStandings(standingsTabId, roundTabIds) {
  if (!roundTabIds?.length) {
    console.log(`     ⚠️  computeLeaguePhaseStandings called with no round tabs — skipping`);
    return 0;
  }
  const games = await queryAll(
    `SELECT home_entity_id, away_entity_id, score
     FROM games
     WHERE result_tab_id = ANY($1::int[])`,
    [roundTabIds]
  );
  const rows = aggregateStandings(games);
  return writeStandings(standingsTabId, rows);
}

module.exports = { aggregateStandings, computeStandings, computeGroupStandings, computeLeaguePhaseStandings };
