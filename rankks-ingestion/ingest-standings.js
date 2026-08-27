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
  const comp = await queryOne(`SELECT id, country_id FROM competitions WHERE slug = $1`, [config.leagueSlug]);
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

  // Get or create season. Status defaults to 'current' for the real
  // in-progress season (this competition's start-year convention — a
  // season labeled with this calendar year, e.g. 2026, spans Aug 2026-May
  // 2027 — so a season == the real current year is still being played),
  // 'past' for a genuine historical backfill year. Found 2026-08-26: Ligue
  // 1 2026/27 (just started) was created as 'past', showing a wrong "PAST"
  // badge everywhere in the app until fixed by hand — this heuristic
  // covers the same call for every league that shares this module (Serie
  // A/Bundesliga/La Liga/Premier League/Ligue 1) so it doesn't recur.
  const isLikelyCurrentSeason = season >= new Date().getFullYear();
  let seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2`,
    [comp.id, season]
  );
  if (!seasonRow) {
    // Real start/end dates, not left null (found live 2026-08-26 alongside
    // the status bug above: a null end_date broke EventBlock's own
    // "SCHEDULE 2025-2026" row — showed "—" instead of the real range —
    // and broke player age calculation on the All-Time page, which reads
    // the season's end_date as its "as of" reference date). One extra
    // /leagues call per new season only (existing seasons never hit this
    // branch again), not per standings refresh.
    let startDate = null, endDate = null;
    try {
      const leagueInfo = await callApi('leagues', { id: config.leagueId, season });
      const seasonInfo = leagueInfo?.[0]?.seasons?.[0];
      if (seasonInfo?.start) startDate = seasonInfo.start;
      if (seasonInfo?.end) endDate = seasonInfo.end;
    } catch (err) {
      console.log(`     ⚠️  Could not fetch season start/end dates: ${err.message}`);
    }
    seasonRow = await queryOne(
      `INSERT INTO seasons (competition_id, year, status, gender, start_date, end_date)
       VALUES ($1, $2, $3, 'M', $4, $5) RETURNING id`,
      [comp.id, season, isLikelyCurrentSeason ? 'current' : 'past', startDate, endDate]
    );
    console.log(`     ✅ Created season ${season} (status: ${isLikelyCurrentSeason ? 'current' : 'past'})`);
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
      // Create new club entity with slug. country_id comes from the
      // competition's own country (every league here is a single-country
      // domestic league) — was missing entirely before (Mohamed
      // 2026-08-26: "when u create clubs, u must assign them Portugal as
      // country, seems obvious"), so every club created through this path
      // across every league had a null country_id until backfilled by hand.
      const slug = row.team.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      entity = await queryOne(
        `INSERT INTO entities (canonical_name, slug, entity_type, country_id, is_active, is_verified)
         VALUES ($1, $2, 'club', $3, true, false) RETURNING id`,
        [row.team.name, slug, comp.country_id]
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

    // Upsert by position — handles both insert and update. Target must
    // match the DB's actual unique index (standings_tab_group_position_uidx:
    // result_tab_id, COALESCE(group_name, ''), position) — plain
    // (result_tab_id, position) doesn't match a real constraint on this
    // table (group_name is part of the key, for competitions with
    // multi-group standings like UCL's league phase), so Postgres rejects
    // it with "no unique or exclusion constraint matching ON CONFLICT
    // specification". This league has no group_name (single table), so it
    // stays NULL/absent here — the COALESCE in the index still applies.
    await query(
      `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
       VALUES ($1, $2, $3, 'club', $4)
       ON CONFLICT (result_tab_id, (COALESCE(group_name, '')), position) DO UPDATE SET
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