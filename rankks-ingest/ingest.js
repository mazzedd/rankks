// =============================================================================
// RANKKS — Data Ingestion Script
// Source: TheSportsDB (free tier)
// Run: node ingest.js
// =============================================================================

require('dotenv').config({ path: '../rankks-api/.env' });
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'rankks',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json/3';

// ── Config ───────────────────────────────────────────────────────────────────
const COMPETITIONS = [
  {
    slug:        'ligue-1-france',
    tsdb_id:     '4334',
    sport_slug:  'football',
    seasons:     [
      '2015-2016','2016-2017','2017-2018','2018-2019','2019-2020',
      '2020-2021','2021-2022','2022-2023','2023-2024','2024-2025'
    ],
  },
  {
    slug:        'champions-league-uefa',
    tsdb_id:     '4480',
    sport_slug:  'football',
    seasons:     [
      '2015-2016','2016-2017','2017-2018','2018-2019','2019-2020',
      '2020-2021','2021-2022','2022-2023','2023-2024','2024-2025'
    ],
  },
  {
    slug:        'nba',
    tsdb_id:     '4387',
    sport_slug:  'basketball',
    seasons:     ['2026-2027'],
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

function extractYear(season) {
  // "2023-2024" → 2024 (end year)
  return parseInt(season.split('-')[1]);
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôõö]/g, 'o')
    .replace(/[ùúûü]/g, 'u').replace(/[ñ]/g, 'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── DB helpers ───────────────────────────────────────────────────────────────
async function getCompetitionId(slug) {
  const res = await pool.query(
    'SELECT id FROM competitions WHERE slug = $1', [slug]
  );
  if (!res.rows[0]) throw new Error(`Competition not found: ${slug}`);
  return res.rows[0].id;
}

async function upsertEntity(client, { canonical_name, slug, entity_type, image_url, external_id }) {
  // Check alias first
  const aliasRes = await client.query(
    'SELECT entity_id FROM entity_aliases WHERE alias = $1 AND source = $2',
    [canonical_name, 'thesportsdb']
  );
  if (aliasRes.rows[0]) return aliasRes.rows[0].entity_id;

  // Check canonical name
  const nameRes = await client.query(
    'SELECT id FROM entities WHERE canonical_name = $1 AND entity_type = $2',
    [canonical_name, entity_type]
  );

  let entityId;
  if (nameRes.rows[0]) {
    entityId = nameRes.rows[0].id;
    // Update image if missing
    await client.query(
      'UPDATE entities SET image_url = COALESCE(image_url, $1), external_ids = external_ids || $2 WHERE id = $3',
      [image_url, JSON.stringify({ thesportsdb: external_id }), entityId]
    );
  } else {
    // Create new entity
    const insertRes = await client.query(`
      INSERT INTO entities (canonical_name, slug, entity_type, image_url, external_ids, is_active, is_verified)
      VALUES ($1, $2, $3, $4, $5, true, false)
      ON CONFLICT (slug) DO UPDATE SET
        image_url = COALESCE(entities.image_url, EXCLUDED.image_url),
        external_ids = entities.external_ids || EXCLUDED.external_ids
      RETURNING id
    `, [
      canonical_name,
      slug,
      entity_type,
      image_url,
      JSON.stringify({ thesportsdb: external_id }),
    ]);
    entityId = insertRes.rows[0].id;
    console.log(`  ✦ Created entity: ${canonical_name}`);
  }

  // Store alias
  await client.query(`
    INSERT INTO entity_aliases (entity_id, alias, source)
    VALUES ($1, $2, $3)
    ON CONFLICT (alias, source) DO NOTHING
  `, [entityId, canonical_name, 'thesportsdb']);

  return entityId;
}

async function upsertSeason(client, { competition_id, year, status }) {
  const res = await client.query(`
    INSERT INTO seasons (competition_id, year, status)
    VALUES ($1, $2, $3)
    ON CONFLICT (competition_id, event_id, year, gender)
    DO UPDATE SET status = EXCLUDED.status
    RETURNING id
  `, [competition_id, year, status]);
  return res.rows[0].id;
}

async function upsertResultTab(client, { season_id, tab_name, tab_key, typology, is_default }) {
  const res = await client.query(`
    INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
    VALUES ($1, $2, $3, $4, 0, $5)
    ON CONFLICT (season_id, tab_key) DO UPDATE SET
      tab_name = EXCLUDED.tab_name,
      is_default = EXCLUDED.is_default
    RETURNING id
  `, [season_id, tab_name, tab_key, typology, is_default]);
  return res.rows[0].id;
}

// ── Ingest standings ──────────────────────────────────────────────────────────
async function ingestStandings(competition, season_str) {
  const year = extractYear(season_str);
  const currentYear = new Date().getFullYear();
  const status = year < currentYear ? 'past' : year === currentYear ? 'current' : 'future';

  console.log(`\n  📅 Season ${season_str} (${year}) — ${status}`);

  const url = `${BASE_URL}/lookuptable.php?l=${competition.tsdb_id}&s=${season_str}`;
  const data = await fetchJSON(url);

  if (!data.table || !data.table.length) {
    console.log(`  ⚠️  No standings data for ${season_str}`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const competition_id = await getCompetitionId(competition.slug);

    // Create or update season
    const season_id = await upsertSeason(client, { competition_id, year, status });

    // Create standings result tab
    const tab_id = await upsertResultTab(client, {
      season_id,
      tab_name: 'Standings',
      tab_key: 'standings',
      typology: 'standings',
      is_default: true,
    });

    // Clear existing standings for this tab
    await client.query('DELETE FROM standings WHERE result_tab_id = $1', [tab_id]);

    // Insert each club
    for (const row of data.table) {
      const clubSlug = slugify(row.strTeam);

      const entityId = await upsertEntity(client, {
        canonical_name: row.strTeam,
        slug:           clubSlug,
        entity_type:    'club',
        image_url:      row.strBadge?.replace('/tiny', '') || null,
        external_id:    row.idTeam,
      });

      // Store entity logo
      if (row.strBadge) {
        await client.query(`
          INSERT INTO entity_logos (entity_id, logo_url, start_year, is_current)
          VALUES ($1, $2, $3, true)
          ON CONFLICT DO NOTHING
        `, [entityId, row.strBadge.replace('/tiny', ''), year]);
      }

      const stats = {
        played:         parseInt(row.intPlayed)         || 0,
        won:            parseInt(row.intWin)            || 0,
        drawn:          parseInt(row.intDraw)           || 0,
        lost:           parseInt(row.intLoss)           || 0,
        goals_for:      parseInt(row.intGoalsFor)       || 0,
        goals_against:  parseInt(row.intGoalsAgainst)   || 0,
        goal_diff:      parseInt(row.intGoalDifference) || 0,
        points:         parseInt(row.intPoints)         || 0,
        form:           row.strForm                     || null,
      };

      await client.query(`
        INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
        VALUES ($1, $2, $3, 'club', $4)
        ON CONFLICT (result_tab_id, position) DO UPDATE SET
          entity_id = EXCLUDED.entity_id,
          stats = EXCLUDED.stats
      `, [tab_id, parseInt(row.intRank), entityId, JSON.stringify(stats)]);

      process.stdout.write(`    ${row.intRank}. ${row.strTeam} (${row.intPoints}pts)\n`);
    }

    // Log ingestion
    await client.query(`
      INSERT INTO ingestion_log
        (source, competition_id, year, records_total, records_created, status, started_at, completed_at)
      VALUES ('thesportsdb', $1, $2, $3, $3, 'success', NOW(), NOW())
    `, [competition_id, year, data.table.length]);

    await client.query('COMMIT');
    console.log(`  ✅ ${data.table.length} clubs loaded for ${season_str}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ❌ Error for ${season_str}:`, err.message);
  } finally {
    client.release();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  RANKKS — TheSportsDB Data Ingestion');
  console.log('═══════════════════════════════════════════════════\n');

  // Test DB connection
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected\n');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  for (const competition of COMPETITIONS) {
    console.log(`\n🏆 ${competition.slug.toUpperCase()}`);
    console.log('─'.repeat(50));

    for (const season of competition.seasons) {
      await ingestStandings(competition, season);
      await sleep(500); // be nice to the API — 500ms between requests
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Ingestion complete!');
  console.log('═══════════════════════════════════════════════════\n');

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
