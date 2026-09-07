// =============================================================================
// RANKKS — NBA Data Ingestion
// Source: TheSportsDB (free tier) — https://www.thesportsdb.com/league/4387-nba
// Run: node ingest-nba.js [season]
// Example: node ingest-nba.js 2026-2027
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

const COMPETITION_SLUG = 'nba';
const TSDB_LEAGUE_ID   = '4387';

// ── Helpers ──────────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const text = await res.text();
  if (!text || !text.trim()) throw new Error('Empty response');
  return JSON.parse(text);
}

function extractYear(season) {
  // "2026-2027" → 2027 (end year)
  return parseInt(season.split('-')[1]);
}

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ── DB helpers ───────────────────────────────────────────────────────────────
async function getCompetitionId(slug) {
  const res = await pool.query('SELECT id FROM competitions WHERE slug = $1', [slug]);
  if (!res.rows[0]) throw new Error(`Competition not found: ${slug} — create it first (see pgAdmin setup)`);
  return res.rows[0].id;
}

async function upsertEntity(client, { canonical_name, slug, image_url, external_id }) {
  const aliasRes = await client.query(
    'SELECT entity_id FROM entity_aliases WHERE alias = $1 AND source = $2',
    [canonical_name, 'thesportsdb']
  );
  if (aliasRes.rows[0]) return aliasRes.rows[0].entity_id;

  const nameRes = await client.query(
    "SELECT id FROM entities WHERE canonical_name = $1 AND entity_type = 'club'",
    [canonical_name]
  );

  let entityId;
  if (nameRes.rows[0]) {
    entityId = nameRes.rows[0].id;
    await client.query(
      'UPDATE entities SET image_url = COALESCE(image_url, $1), external_ids = external_ids || $2 WHERE id = $3',
      [image_url, JSON.stringify({ thesportsdb: external_id }), entityId]
    );
  } else {
    const insertRes = await client.query(`
      INSERT INTO entities (canonical_name, slug, entity_type, image_url, external_ids, is_active, is_verified)
      VALUES ($1, $2, 'club', $3, $4, true, false)
      ON CONFLICT (slug) DO UPDATE SET
        image_url = COALESCE(entities.image_url, EXCLUDED.image_url),
        external_ids = entities.external_ids || EXCLUDED.external_ids
      RETURNING id
    `, [canonical_name, slug, image_url, JSON.stringify({ thesportsdb: external_id })]);
    entityId = insertRes.rows[0].id;
    console.log(`  ✦ Created team: ${canonical_name}`);
  }

  await client.query(`
    INSERT INTO entity_aliases (entity_id, alias, source)
    VALUES ($1, $2, 'thesportsdb')
    ON CONFLICT (alias, source) DO NOTHING
  `, [entityId, canonical_name]);

  return entityId;
}

async function upsertSeason(client, { competition_id, year, status }) {
  const res = await client.query(`
    INSERT INTO seasons (competition_id, year, status, gender)
    VALUES ($1, $2, $3, 'M')
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

// ── Ingest standings ─────────────────────────────────────────────────────────
async function ingestStandings(season_str) {
  const year = extractYear(season_str);
  const currentYear = new Date().getFullYear();
  const status = year < currentYear ? 'past' : year === currentYear ? 'current' : 'future';

  console.log(`\n📅 Season ${season_str} (${year}) — ${status}`);

  const url = `${BASE_URL}/lookuptable.php?l=${TSDB_LEAGUE_ID}&s=${season_str}`;
  const data = await fetchJSON(url);

  if (!data.table || !data.table.length) {
    console.log(`⚠️  No standings data yet for ${season_str} (season may not have tipped off)`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const competition_id = await getCompetitionId(COMPETITION_SLUG);
    const season_id = await upsertSeason(client, { competition_id, year, status });
    const tab_id = await upsertResultTab(client, {
      season_id,
      tab_name: 'Standings',
      tab_key: 'standings',
      typology: 'standings',
      is_default: true,
    });

    await client.query('DELETE FROM standings WHERE result_tab_id = $1', [tab_id]);

    for (const row of data.table) {
      const teamSlug = slugify(row.strTeam);

      const entityId = await upsertEntity(client, {
        canonical_name: row.strTeam,
        slug:           teamSlug,
        image_url:      row.strBadge?.replace('/tiny', '') || null,
        external_id:    row.idTeam,
      });

      if (row.strBadge) {
        await client.query(`
          INSERT INTO entity_logos (entity_id, logo_url, start_year, is_current)
          VALUES ($1, $2, $3, true)
          ON CONFLICT DO NOTHING
        `, [entityId, row.strBadge.replace('/tiny', ''), year]);
      }

      // Basketball has no draws — wins/losses only
      const stats = {
        played:      parseInt(row.intPlayed)         || 0,
        won:         parseInt(row.intWin)             || 0,
        lost:        parseInt(row.intLoss)             || 0,
        points_for:  parseInt(row.intGoalsFor)         || 0,
        points_against: parseInt(row.intGoalsAgainst)  || 0,
        win_pct:     parseInt(row.intPlayed) ? +(parseInt(row.intWin) / parseInt(row.intPlayed)).toFixed(3) : 0,
        form:        row.strForm                       || null,
        conference:  row.strConference                 || null,
        division:    row.strDivision                   || null,
      };

      await client.query(`
        INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
        VALUES ($1, $2, $3, 'club', $4)
        ON CONFLICT (result_tab_id, position) DO UPDATE SET
          entity_id = EXCLUDED.entity_id,
          stats = EXCLUDED.stats
      `, [tab_id, parseInt(row.intRank), entityId, JSON.stringify(stats)]);

      process.stdout.write(`  ${row.intRank}. ${row.strTeam} (${row.intWin}-${row.intLoss})\n`);
    }

    await client.query(`
      INSERT INTO ingestion_log
        (source, competition_id, year, records_total, records_created, status, started_at, completed_at)
      VALUES ('thesportsdb', $1, $2, $3, $3, 'success', NOW(), NOW())
    `, [competition_id, year, data.table.length]);

    await client.query('COMMIT');
    console.log(`✅ ${data.table.length} teams loaded for ${season_str}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ Error for ${season_str}:`, err.message);
  } finally {
    client.release();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const season = process.argv[2] || '2026-2027';

  console.log('═══════════════════════════════════════════════════');
  console.log('  RANKKS — NBA Ingestion (TheSportsDB)');
  console.log('═══════════════════════════════════════════════════');

  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  await ingestStandings(season);

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  NBA ingestion complete!');
  console.log('═══════════════════════════════════════════════════\n');

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
