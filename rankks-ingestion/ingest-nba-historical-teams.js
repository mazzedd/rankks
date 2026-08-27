// Creates entities for the 15 NBA/BAA franchises that folded outright between
// 1946-1955 (see nba-franchise-continuity memory / 00-nba/conference-division-history.md's
// "Defunct/folded franchises" table) — the piece ingest-nba-teams.js never covers, since it
// only derives entities from TeamStatistics.csv, which has no rows at all for a team with no
// current-franchise nba_team_id.
//
// Season/division ranges below are NOT copied from the doc's shorthand summary — they're
// read directly off basketball-reference.com's own division-standings tables (scraped into
// nba-historical-raw/{year}/season-summary.json), which caught two real discrepancies the
// doc's summary missed:
//   - Washington Capitols were briefly in the WESTERN Division for 1947-48 only, not
//     Eastern the whole time (Eastern 1947, Western 1948, Eastern 1949-1951).
//   - Baltimore Bullets' 1954-55 stint (folded Nov 1954) has a standings row with blank
//     W/L and zero games in the Oct/Nov 1955 schedule — basketball-reference vacated that
//     partial season entirely, so this entity's real range stops at 1954, not 1955.
// Also disambiguates "Denver Nuggets" (BAA/NBL-era team, 1950 only) from the entity_type
// clash it would otherwise create with today's Denver Nuggets (ABA merger, 1976-) — same
// canonical franchise-name collision called out in nba-franchise-continuity memory.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const USA_COUNTRY_ID = 91;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// displayName: exact string as it appears in scraped standings/schedule pages (used by the
// resolver to match games/standings rows) — kept separate from canonicalName, which is what
// disambiguates the Denver Nuggets collision without touching the matching string.
const TEAMS = [
  {
    displayName: 'Toronto Huskies', minYear: 1947, maxYear: 1947,
    divisions: [[1947, 1947, 'Eastern Division']],
  },
  {
    displayName: 'Cleveland Rebels', minYear: 1947, maxYear: 1947,
    divisions: [[1947, 1947, 'Western Division']],
  },
  {
    displayName: 'Detroit Falcons', minYear: 1947, maxYear: 1947,
    divisions: [[1947, 1947, 'Western Division']],
  },
  {
    displayName: 'Pittsburgh Ironmen', minYear: 1947, maxYear: 1947,
    divisions: [[1947, 1947, 'Western Division']],
  },
  {
    displayName: 'Providence Steamrollers', minYear: 1947, maxYear: 1949,
    divisions: [[1947, 1949, 'Eastern Division']],
  },
  {
    displayName: 'Washington Capitols', minYear: 1947, maxYear: 1951,
    divisions: [[1947, 1947, 'Eastern Division'], [1948, 1948, 'Western Division'], [1949, 1951, 'Eastern Division']],
  },
  {
    displayName: 'Chicago Stags', minYear: 1947, maxYear: 1950,
    divisions: [[1947, 1949, 'Western Division'], [1950, 1950, 'Central']],
  },
  {
    displayName: 'St. Louis Bombers', minYear: 1947, maxYear: 1950,
    divisions: [[1947, 1949, 'Western Division'], [1950, 1950, 'Central']],
  },
  {
    displayName: 'Baltimore Bullets', minYear: 1948, maxYear: 1954,
    divisions: [[1948, 1948, 'Western Division'], [1949, 1954, 'Eastern Division']],
  },
  {
    displayName: 'Indianapolis Jets', minYear: 1949, maxYear: 1949,
    divisions: [[1949, 1949, 'Western Division']],
  },
  {
    displayName: 'Indianapolis Olympians', minYear: 1950, maxYear: 1953,
    divisions: [[1950, 1953, 'Western Division']],
  },
  {
    displayName: 'Denver Nuggets', canonicalName: 'Denver Nuggets (1950)', minYear: 1950, maxYear: 1950,
    divisions: [[1950, 1950, 'Western Division']],
  },
  {
    displayName: 'Anderson Packers', minYear: 1950, maxYear: 1950,
    divisions: [[1950, 1950, 'Western Division']],
  },
  {
    displayName: 'Sheboygan Red Skins', minYear: 1950, maxYear: 1950,
    divisions: [[1950, 1950, 'Western Division']],
  },
  {
    displayName: 'Waterloo Hawks', minYear: 1950, maxYear: 1950,
    divisions: [[1950, 1950, 'Western Division']],
  },
];

async function main() {
  let entitiesCreated = 0, entitiesSkipped = 0, namesInserted = 0, historyInserted = 0;

  for (const t of TEAMS) {
    const canonicalName = t.canonicalName || t.displayName;
    const slug = slugify(canonicalName);
    const nbaTeamId = 'legacy-' + slug;

    let entity = await pool.query(
      `SELECT id FROM entities WHERE entity_type = 'club' AND external_ids->>'nba_team_id' = $1`,
      [nbaTeamId]
    );
    let entityId;
    if (entity.rows.length) {
      entityId = entity.rows[0].id;
      entitiesSkipped++;
      console.log(`${canonicalName}: entity already exists (id ${entityId})`);
    } else {
      const ins = await pool.query(
        `INSERT INTO entities (entity_type, canonical_name, slug, country_id, external_ids, is_active)
         VALUES ('club', $1, $2, $3, $4::jsonb, false)
         RETURNING id`,
        [canonicalName, slug, USA_COUNTRY_ID, JSON.stringify({ nba_team_id: nbaTeamId })]
      );
      entityId = ins.rows[0].id;
      entitiesCreated++;
      console.log(`${canonicalName}: created entity id ${entityId}`);
    }

    const existingName = await pool.query(
      `SELECT id FROM entity_names WHERE entity_id = $1 AND start_year = $2 AND display_name = $3`,
      [entityId, t.minYear, t.displayName]
    );
    if (!existingName.rows.length) {
      await pool.query(
        `INSERT INTO entity_names (entity_id, display_name, short_name, start_year, end_year, change_reason)
         VALUES ($1, $2, $2, $3, $4, 'Defunct BAA/NBL-era franchise')`,
        [entityId, t.displayName, t.minYear, t.maxYear]
      );
      namesInserted++;
    }

    for (const [startYear, endYear, division] of t.divisions) {
      const existingHist = await pool.query(
        `SELECT id FROM entity_conference_history WHERE entity_id = $1 AND start_year = $2`,
        [entityId, startYear]
      );
      if (existingHist.rows.length) continue;
      await pool.query(
        `INSERT INTO entity_conference_history (entity_id, conference, division, start_year, end_year)
         VALUES ($1, NULL, $2, $3, $4)`,
        [entityId, division, startYear, endYear]
      );
      historyInserted++;
    }
  }

  console.log(`\nEntities: ${entitiesCreated} created, ${entitiesSkipped} already existed`);
  console.log(`entity_names: ${namesInserted} inserted`);
  console.log(`entity_conference_history: ${historyInserted} inserted`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
