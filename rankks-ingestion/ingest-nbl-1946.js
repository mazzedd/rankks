// One-off: adds the 1945-46 National Basketball League season (year=1946
// under this DB's end-year convention) as Regular Season STANDINGS ONLY for
// competition_id=4828 ("NBA"). Requested to fill the Year Selector's empty
// "1946" tick — the BAA (this competition's actual first season) didn't
// exist yet; the NBL was the only real professional league playing that
// year, and three of its franchises are the direct ancestors of Sacramento
// Kings, Detroit Pistons, and (briefly) the 1950 "Sheboygan Red Skins"
// defunct entity already in this DB.
//
// Source: https://en.wikipedia.org/wiki/1945%E2%80%9346_National_Basketball_League_(United_States)_season
// Deliberately NOT populating Results/Playoffs/Finals: unlike basketball-
// reference's BAA pages, this source has no game-by-game schedule (no
// individual dates/scores) — only final standings, playoff series W-L
// tallies, and awards. Fabricating individual game dates to populate the
// games table would misrepresent unverified data as fact, so this stops at
// what's actually sourceable: real, final standings.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const COMPETITION_ID = 4828;
const YEAR = 1946;
const USA_COUNTRY_ID = 91;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Existing entities this season's teams resolve to, keyed by the exact name
// Wikipedia uses. Rochester Royals/Fort Wayne Zollner Pistons are ALREADY
// current-franchise entities (Sacramento Kings / Detroit Pistons lineage)
// whose entity_names era currently starts at 1949 (their BAA-entry year) —
// extended back to 1946 here since it's the same identity, not a rename.
// Sheboygan Red Skins is already one of the 15 defunct entities created for
// the BAA/NBL-merger backfill (1950 only) — same extension applies.
const EXISTING = {
  'Rochester Royals': { entityId: 76251, currentEraStart: 1949 },
  'Fort Wayne Zollner Pistons': { entityId: 76230, displayNameInDb: 'Ft. Wayne Zollner Pistons', currentEraStart: 1949 },
  'Sheboygan Red Skins': { entityId: 114586, currentEraStart: 1950 },
};

// New defunct-only entities: none of these ever joined the BAA/NBA (verified
// against the Wikipedia article — Cleveland folded outright in 1946,
// the others are not mentioned rejoining after the 1949 merger).
const NEW_TEAMS = ['Cleveland Allmen Transfers', 'Youngstown Bears', 'Chicago American Gears', 'Indianapolis Kautskys', 'Oshkosh All-Stars'];

const STANDINGS = [
  { team: 'Fort Wayne Zollner Pistons', division: 'Eastern Division', w: 26, l: 8 },
  { team: 'Rochester Royals', division: 'Eastern Division', w: 24, l: 10 },
  { team: 'Youngstown Bears', division: 'Eastern Division', w: 13, l: 20 },
  { team: 'Cleveland Allmen Transfers', division: 'Eastern Division', w: 4, l: 29 },
  { team: 'Sheboygan Red Skins', division: 'Western Division', w: 21, l: 13 },
  { team: 'Oshkosh All-Stars', division: 'Western Division', w: 19, l: 15 },
  { team: 'Chicago American Gears', division: 'Western Division', w: 17, l: 17 },
  { team: 'Indianapolis Kautskys', division: 'Western Division', w: 10, l: 22 },
];

async function getOrCreateEntity(teamName) {
  if (EXISTING[teamName]) {
    const { entityId, displayNameInDb, currentEraStart } = EXISTING[teamName];
    const dbName = displayNameInDb || teamName;
    await pool.query(
      `UPDATE entity_names SET start_year = $1 WHERE entity_id = $2 AND display_name = $3 AND start_year = $4`,
      [YEAR, entityId, dbName, currentEraStart]
    );
    return entityId;
  }

  const existing = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'club' AND external_ids->>'nba_team_id' = $1`,
    [`legacy-${slugify(teamName)}`]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const slug = slugify(teamName);
  const ins = await pool.query(
    `INSERT INTO entities (entity_type, canonical_name, slug, country_id, external_ids, is_active)
     VALUES ('club', $1, $2, $3, $4::jsonb, false) RETURNING id`,
    [teamName, slug, USA_COUNTRY_ID, JSON.stringify({ nba_team_id: `legacy-${slug}` })]
  );
  const entityId = ins.rows[0].id;
  await pool.query(
    `INSERT INTO entity_names (entity_id, display_name, short_name, start_year, end_year, change_reason)
     VALUES ($1, $2, $2, $3, $3, 'Pre-BAA NBL franchise, never joined the BAA/NBA')`,
    [entityId, teamName, YEAR]
  );
  return entityId;
}

async function ensureConferenceHistory(entityId, division) {
  const existing = await pool.query(
    `SELECT id FROM entity_conference_history WHERE entity_id = $1 AND start_year = $2`,
    [entityId, YEAR]
  );
  if (existing.rows.length) return;
  await pool.query(
    `INSERT INTO entity_conference_history (entity_id, conference, division, start_year, end_year)
     VALUES ($1, NULL, $2, $3, $3)`,
    [entityId, division, YEAR]
  );
}

async function main() {
  console.log(`Adding entities for ${NEW_TEAMS.length} new + ${Object.keys(EXISTING).length} existing franchises...`);
  const entityIdByTeam = {};
  for (const row of STANDINGS) {
    const entityId = await getOrCreateEntity(row.team);
    entityIdByTeam[row.team] = entityId;
    await ensureConferenceHistory(entityId, row.division);
  }
  console.log('Entities ready:', entityIdByTeam);

  // Regular Season season + Standings tab only (no Results — see header).
  let season = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = 74 AND year = $2`,
    [COMPETITION_ID, YEAR]
  );
  let seasonId;
  if (season.rows.length) {
    seasonId = season.rows[0].id;
  } else {
    const ins = await pool.query(
      `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition, start_date, end_date)
       VALUES ($1, 74, $2, 'past', 'M', 1, '1945-11-22', '1946-03-11') RETURNING id`,
      [COMPETITION_ID, YEAR]
    );
    seasonId = ins.rows[0].id;
    console.log(`Created Regular Season ${YEAR} (id ${seasonId})`);
  }

  let tab = await pool.query(`SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = 'standings'`, [seasonId]);
  let tabId;
  if (tab.rows.length) {
    tabId = tab.rows[0].id;
  } else {
    const ins = await pool.query(
      `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
       VALUES ($1, 'Standings', 'standings', 'standings', 1, true) RETURNING id`,
      [seasonId]
    );
    tabId = ins.rows[0].id;
  }

  // Compute rank/GB league-wide (same convention as ingest-nba-standings.js —
  // consolidates both divisions into one ranked list, division is an
  // in-template filter attribute, not a separate table).
  const sorted = [...STANDINGS].sort((a, b) => (b.w / (b.w + b.l)) - (a.w / (a.w + a.l)));
  const leader = sorted[0];

  await pool.query('DELETE FROM standings WHERE result_tab_id = $1', [tabId]);
  let position = 1;
  for (const row of sorted) {
    const pct = row.w / (row.w + row.l);
    const gb = ((leader.w - row.w) + (row.l - leader.l)) / 2;
    const stats = { w: row.w, l: row.l, pct: Number(pct.toFixed(3)), gb: Number(gb.toFixed(1)) };
    await pool.query(
      `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats) VALUES ($1,$2,$3,'club',$4::jsonb)`,
      [tabId, position, entityIdByTeam[row.team], JSON.stringify(stats)]
    );
    position++;
  }
  console.log(`${position - 1} standings rows written to result_tab ${tabId}`);

  // All-Time season + its standard 5 tabs, for nav consistency with every
  // other backfilled year (computed views — no ingested data needed).
  const allTime = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = 81 AND year = $2`,
    [COMPETITION_ID, YEAR]
  );
  let allTimeSeasonId;
  if (allTime.rows.length) {
    allTimeSeasonId = allTime.rows[0].id;
  } else {
    const ins = await pool.query(
      `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition, start_date, end_date)
       VALUES ($1, 81, $2, 'past', 'M', 1, '1945-11-22', '1946-03-11') RETURNING id`,
      [COMPETITION_ID, YEAR]
    );
    allTimeSeasonId = ins.rows[0].id;
    console.log('Created All-Time season row for nav consistency');
  }
  const ALL_TIME_TABS = [
    { tab_name: 'Player Stats', tab_key: 'all-time-players', typology: 'players', display_order: 1 },
    { tab_name: 'Team Stats', tab_key: 'all-time-teams', typology: 'teams', display_order: 2 },
    { tab_name: 'Player Awards', tab_key: 'all-time-player-awards', typology: 'player_awards', display_order: 3 },
    { tab_name: 'Team Honours', tab_key: 'all-time-team-honours', typology: 'team_honours', display_order: 4 },
    { tab_name: 'Champion History', tab_key: 'all-time-champion-history', typology: 'champion_history', display_order: 5 },
  ];
  for (const t of ALL_TIME_TABS) {
    const existing = await pool.query(`SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`, [allTimeSeasonId, t.tab_key]);
    if (existing.rows.length) continue;
    await pool.query(
      `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [allTimeSeasonId, t.tab_name, t.tab_key, t.typology, t.display_order]
    );
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
