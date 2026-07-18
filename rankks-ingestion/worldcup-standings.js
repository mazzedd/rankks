// worldcup-standings.js
// World Cup group standings aren't pulled from an API endpoint — same
// approach as UCL: computed locally from games rows. Reuses the exact
// aggregateStandings logic from ucl-standings.js (it's entity-agnostic,
// only reads home_entity_id/away_entity_id/score) rather than
// duplicating it. Only the write step differs, since writeStandings in
// ucl-standings.js hardcodes entity_type='club' and World Cup needs
// 'national_team'.
//
// Single shape only — 12 groups (A-L), each group's own tab holds its
// own games directly (same as UCL's pre-2024 shape), so only the
// single-tab compute path is needed. No league-phase equivalent exists
// for World Cup.
const { queryAll, query } = require('./db');
const { aggregateStandings } = require('./ucl-standings');

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
       VALUES ($1, $2, $3, 'national_team', $4)`,
      [tabId, position, row.entity_id, JSON.stringify(stats)]
    );
    position++;
  }

  return rows.length;
}

// Single-tab case: this group's own games ARE the full set to aggregate.
// Called once per group (A-L) after fixtures ingestion touches that group.
async function computeGroupStandings(tabId) {
  const games = await queryAll(
    `SELECT home_entity_id, away_entity_id, score
     FROM games
     WHERE result_tab_id = $1`,
    [tabId]
  );
  const rows = aggregateStandings(games);
  return writeStandings(tabId, rows);
}

module.exports = { computeGroupStandings };
