// ingest-standings.js — matches actual RANKKS DB schema
const { queryOne, query } = require('./db');

// Default column_config for a standard football league standings table.
// Applied automatically (see below) whenever a competition has no
// column_config set yet, so new competitions never silently inherit
// the jsonb default '{}' and crash StandingsTemplate's cols.map().
const DEFAULT_FOOTBALL_COLUMN_CONFIG = JSON.stringify([
  { key: 'played',        type: 'integer',  label: 'Played', sortable: true },
  { key: 'won',            type: 'integer',  label: 'Won',    sortable: true },
  { key: 'drawn',          type: 'integer',  label: 'Drawn',  sortable: true },
  { key: 'lost',           type: 'integer',  label: 'Lost',   sortable: true },
  { key: 'goals_for',      type: 'integer',  label: 'GF',     sortable: true },
  { key: 'goals_against',  type: 'integer',  label: 'GA',     sortable: true },
  { key: 'goal_diff',      type: 'computed', label: 'GD', formula: 'goals_for-goals_against', sortable: true },
  { key: 'points',         type: 'integer',  label: 'Points', sortable: true, bold: true },
]);

async function ingestStandings(season, config, callApi) {
  console.log(`  📊 Standings ${season}...`);

  const data = await callApi('standings', { league: config.leagueId, season });
  if (!data?.length) { console.log(`     ⚠️  No data`); return; }

  const standing = data[0].league.standings[0]; // array of 20 clubs

  // Get competition
  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.leagueSlug]);
  if (!comp) throw new Error(`Competition not found: ${config.leagueSlug}`);

  // Ensure column_config is a real array before any season/standings work.
  // jsonb columns with no explicit value on INSERT can silently take on a
  // default like '{}' (an object, not an array) — truthy enough to bypass
  // the frontend's `columnConfig || [...]` fallback, but not array-shaped,
  // which crashes StandingsTemplate's cols.map(). Only fixed when missing
  // or non-array, so an already-configured competition (custom columns,
  // different sport) is never overwritten.
  const compConfig = await queryOne(
    `SELECT column_config, jsonb_typeof(column_config) AS config_type
     FROM competitions WHERE id = $1`,
    [comp.id]
  );
  if (compConfig.config_type !== 'array') {
    await query(
      `UPDATE competitions SET column_config = $1::jsonb WHERE id = $2`,
      [DEFAULT_FOOTBALL_COLUMN_CONFIG, comp.id]
    );
    console.log(`     🔧 column_config was '${compConfig.config_type}' — set to default football array`);
  }

  // Get or create season
  let seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2`,
    [comp.id, season]
  );
  if (!seasonRow) {
    seasonRow = await queryOne(
      `INSERT INTO seasons (competition_id, year, status, gender)
       VALUES ($1, $2, 'past', 'M') RETURNING id`,
      [comp.id, season]
    );
    console.log(`     ✅ Created season ${season}`);
  }

  // Get or create standings result_tab — and seed all 5 tabs if none exist yet
  let tab = await queryOne(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = 'standings'`,
    [seasonRow.id]
  );
  if (!tab) {
    tab = await queryOne(
      `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
       VALUES ($1, 'Standings', 'standings', 'standings', 0, true) RETURNING id`,
      [seasonRow.id]
    );
    // Seed the remaining tabs so scorers/passers/players/results/videos are always available
    await query(
      `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default, tab_group) VALUES
       ($1, 'Results', 'final_tour', 'game',           2, false, NULL),
       ($1, 'Scorers', 'scorers',    'players',         3, false, NULL),
       ($1, 'Passers', 'passers',    'players',         4, false, NULL),
       ($1, 'Players', 'players',    'players',         5, false, NULL),
       ($1, 'Videos',  'videos',     'iconic_moments', 99, false, NULL),
       ($1, 'Player Stats',      'all-time-players',            'players_all_time_fb', 300, false, 'all_time'),
       ($1, 'Team Stats',        'all-time-teams',              'teams_all_time', 301, false, 'all_time'),
       ($1, 'Champion History',  'all-time-champion-history',   'champion_history_fb', 302, false, 'all_time')`,
      [seasonRow.id]
    );
    console.log(`     ✅ Created season ${season} with all 9 tabs`);
  }

  let inserted = 0;

  for (const row of standing) {
    // Find club entity by name (case-insensitive)
    let entity = await queryOne(
      `SELECT id FROM entities WHERE entity_type = 'club' AND canonical_name ILIKE $1`,
      [row.team.name]
    );

    if (!entity) {
      // Try aliases
      entity = await queryOne(
        `SELECT e.id FROM entities e
         JOIN entity_aliases ea ON ea.entity_id = e.id
         WHERE e.entity_type = 'club' AND ea.alias ILIKE $1`,
        [row.team.name]
      );
    }

    if (!entity) {
      // Create new club entity with slug
      const slug = row.team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      entity = await queryOne(
        `INSERT INTO entities (canonical_name, slug, entity_type, is_active, is_verified)
         VALUES ($1, $2, 'club', true, false) RETURNING id`,
        [row.team.name, slug]
      );
      console.log(`     ➕ Created club: ${row.team.name}`);
    }

    // Build stats JSON (full home/away breakdown)
    const stats = {
      played:        row.all.played,
      won:           row.all.win,
      drawn:         row.all.draw,
      lost:          row.all.lose,
      goals_for:     row.all.goals.for,
      goals_against: row.all.goals.against,
      goal_diff:     row.goalsDiff,
      points:        row.points,
      form:          row.form || null,
      home: {
        played: row.home.played, won: row.home.win, drawn: row.home.draw, lost: row.home.lose,
        goals_for: row.home.goals.for, goals_against: row.home.goals.against,
      },
      away: {
        played: row.away.played, won: row.away.win, drawn: row.away.draw, lost: row.away.lose,
        goals_for: row.away.goals.for, goals_against: row.away.goals.against,
      },
      description: row.description || null,
    };

    // Upsert by position — handles both insert and update
    await query(
      `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
       VALUES ($1, $2, $3, 'club', $4)
       ON CONFLICT (result_tab_id, position) DO UPDATE SET
         entity_id = EXCLUDED.entity_id,
         stats     = EXCLUDED.stats,
         updated_at = NOW()`,
      [tab.id, row.rank, entity.id, JSON.stringify(stats)]
    );
    inserted++;
  }

  console.log(`     ✅ ${inserted} upserted (${standing.length} clubs total)`);
}

module.exports = { ingestStandings };