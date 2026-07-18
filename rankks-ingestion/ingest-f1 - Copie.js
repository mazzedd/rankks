/**
 * RANKKS - F1 Data Ingestion Script
 * Run from CMD: node ingest_f1.js
 * 
 * Prerequisites:
 *   npm install pg axios dotenv
 *   .env file with DB_* vars (same as your Ligue 1 script)
 * 
 * Free plan limit: 100 req/day, seasons 2022-2024 only
 * PRO plan: 7500 req/day, all seasons 2012-2026
 * 
 * Call sequence per season:
 *   1. /races?season=X        -> f1_circuits, competitions (GPs), f1_sessions
 *   2. /drivers (all)         -> entities (drivers)
 *   3. /teams?search=X        -> entities (f1_teams)  [called per team from rankings]
 *   4. /rankings/drivers      -> standings (driver championship)
 *   5. /rankings/teams        -> standings (constructor championship)
 *   6. /rankings/races?race=X -> f1_session_results   [one call per session]
 */

require('dotenv').config();
const axios = require('axios');
const { pool } = require('./db');

const API_KEY  = '22cd67b58e2bf36c5d66e5e9d7b7bff7';
const BASE_URL = 'https://v1.formula-1.api-sports.io';
const SEASONS  = [2022]; // run one season at a time — change to [2023], [2024] after each completes

const F1_CHAMPIONSHIP_COMPETITION_ID = 3234;
const F1_CATEGORY_ID                 = 1209;

const RESULT_TABS = {
  2022: { drivers: 19149, teams: 19150 },
  2023: { drivers: 19151, teams: 19152 },
  2024: { drivers: 19153, teams: 19154 },
};

// Display order mapping for session types
const DISPLAY_ORDER = {
  'Race':                1,
  '1st Qualifying':      2,
  '2nd Qualifying':      2,
  '3rd Qualifying':      2,
  'Sprint':              3,
  '1st Sprint Shootout': 4,
  '2nd Sprint Shootout': 4,
  '3rd Sprint Shootout': 4,
  '3rd Practice':        5,
  '2nd Practice':        6,
  '1st Practice':        7,
};

// Sprint weekend detection: these session types only appear on sprint weekends
const SPRINT_SESSION_TYPES = new Set([
  'Sprint', '1st Sprint Shootout', '2nd Sprint Shootout', '3rd Sprint Shootout'
]);

const delay = ms => new Promise(r => setTimeout(r, ms));

// Retry with backoff on rate limit. Free plan = 10 req/min = 1 req/6s minimum.
async function apiGet(endpoint, params = {}, retries = 3) {
  await delay(6500); // 6.5s between calls = safe under 10/min limit
  const res = await axios.get(`${BASE_URL}${endpoint}`, {
    headers: { 'x-apisports-key': API_KEY },
    params,
  });

  // Rate limit hit — wait 65s and retry
  if (res.data.errors?.rateLimit) {
    if (retries > 0) {
      console.warn(`  Rate limit hit on ${endpoint}, waiting 65s before retry (${retries} left)...`);
      await delay(65000);
      return apiGet(endpoint, params, retries - 1);
    } else {
      console.error(`  Rate limit exceeded on ${endpoint}, giving up`);
      return [];
    }
  }

  if (res.data.errors && Object.keys(res.data.errors).length > 0) {
    console.warn(`  API warning on ${endpoint}:`, res.data.errors);
  }
  return res.data.response;
}

// ─── SLUGIFY ────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── COUNTRY LOOKUP ─────────────────────────────────────────
async function getCountryId(client, code) {
  if (!code) return null;
  const r = await client.query(
    `SELECT id FROM countries WHERE iso2 = $1 OR iso3 = $1 LIMIT 1`,
    [code.toUpperCase()]
  );
  return r.rows[0]?.id || null;
}

// Extract country from base string e.g. "Milton Keynes, United Kingdom"
async function getCountryIdFromBase(client, base) {
  if (!base) return null;
  const parts = base.split(',');
  const countryName = parts[parts.length - 1].trim();
  const r = await client.query(
    `SELECT id FROM countries WHERE name ILIKE $1 LIMIT 1`,
    [countryName]
  );
  return r.rows[0]?.id || null;
}

// ─── STEP 1: INGEST RACES (circuits + GP competitions + sessions) ────────────
async function ingestRaces(client, season) {
  console.log(`\n[STEP 1] Ingesting races for season ${season}...`);
  const races = await apiGet('/races', { season });

  // Group sessions by competition_id to detect sprint weekends
  const byCompetition = {};
  for (const r of races) {
    const cid = r.competition.id;
    if (!byCompetition[cid]) byCompetition[cid] = [];
    byCompetition[cid].push(r);
  }

  // Mark sprint weekends
  const sprintCompetitions = new Set();
  for (const [cid, sessions] of Object.entries(byCompetition)) {
    if (sessions.some(s => SPRINT_SESSION_TYPES.has(s.type))) {
      sprintCompetitions.add(parseInt(cid));
    }
  }

  // Get season_id from DB
  const seasonRow = await client.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2`,
    [F1_CHAMPIONSHIP_COMPETITION_ID, season]
  );
  const seasonId = seasonRow.rows[0]?.id;
  if (!seasonId) {
    console.error(`No season row found for F1 ${season}. Create it first.`);
    return;
  }

  for (const race of races) {
    // 1a. Upsert circuit
    const circuitResult = await client.query(`
      INSERT INTO f1_circuits (api_circuit_id, name, image_url)
      VALUES ($1, $2, $3)
      ON CONFLICT (api_circuit_id) DO UPDATE SET
        name = EXCLUDED.name,
        image_url = EXCLUDED.image_url,
        updated_at = now()
      RETURNING id
    `, [race.circuit.id, race.circuit.name, race.circuit.image]);
    const circuitId = circuitResult.rows[0].id;

    // 1b. Upsert Grand Prix as a competition
    const gpSlug = slugify(race.competition.name + '-' + season);
    const gpResult = await client.query(`
      INSERT INTO competitions (category_id, name, slug, city, competition_type, year_convention)
      VALUES ($1, $2, $3, $4, 'seasonal', 'calendar')
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = now()
      RETURNING id
    `, [F1_CATEGORY_ID, race.competition.name, gpSlug, race.competition.location.city]);
    const gpCompetitionId = gpResult.rows[0].id;

    // 1c. Upsert session
    const isSprintWeekend = sprintCompetitions.has(race.competition.id);
    const displayOrder = DISPLAY_ORDER[race.type] ?? 99;

    await client.query(`
      INSERT INTO f1_sessions (
        api_session_id, competition_id, season_id, circuit_id,
        session_type, session_date, laps_total,
        fastest_lap_driver_id, fastest_lap_time, distance, status,
        is_sprint_weekend, display_order
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (api_session_id) DO UPDATE SET
        status = EXCLUDED.status,
        fastest_lap_time = EXCLUDED.fastest_lap_time,
        updated_at = now()
    `, [
      race.id,
      gpCompetitionId,
      seasonId,
      circuitId,
      race.type,
      race.date,
      race.laps?.total || null,
      null, // fastest_lap_driver_id resolved separately after drivers are loaded
      race.fastest_lap?.time || null,
      race.distance || null,
      race.status,
      isSprintWeekend,
      displayOrder,
    ]);
  }

  console.log(`  ✓ ${races.length} sessions processed for ${season}`);
}

// ─── STEP 2: INGEST ALL DRIVERS ─────────────────────────────
async function ingestDrivers(client) {
  console.log('\n[STEP 2] Ingesting drivers (career-level, no season filter)...');

  // The API doesn't have a "get all drivers" endpoint without a param.
  // Strategy: pull driver list from rankings for each season, deduplicate by api_id.
  const driverMap = new Map(); // api_driver_id -> driver object

  for (const season of SEASONS) {
    const rankings = await apiGet('/rankings/drivers', { season });
    for (const row of rankings) {
      if (!driverMap.has(row.driver.id)) {
        // Fetch full driver profile
        const drivers = await apiGet('/drivers', { id: row.driver.id });
        if (drivers.length > 0) driverMap.set(row.driver.id, drivers[0]);
      }
    }
  }

  console.log(`  Found ${driverMap.size} unique drivers`);

  for (const driver of driverMap.values()) {
    const countryId = await getCountryId(client, driver.country?.code);
    const nameParts = driver.name.split(' ');
    const slug = slugify(driver.name);

    // Parse birthdate
    let birthDate = null;
    if (driver.birthdate) {
      birthDate = driver.birthdate; // format: "1997-09-30"
    }

    await client.query(`
      INSERT INTO entities (
        entity_type, canonical_name, slug, country_id, image_url,
        birth_date, birth_city, gender, external_ids, is_active, is_verified
      )
      VALUES ('driver', $1, $2, $3, $4, $5, $6, 'M', $7, true, false)
      ON CONFLICT (slug) DO UPDATE SET
        image_url   = EXCLUDED.image_url,
        country_id  = COALESCE(EXCLUDED.country_id, entities.country_id),
        birth_date  = COALESCE(EXCLUDED.birth_date, entities.birth_date),
        birth_city  = COALESCE(EXCLUDED.birth_city, entities.birth_city),
        external_ids = entities.external_ids || EXCLUDED.external_ids,
        updated_at  = now()
      RETURNING id
    `, [
      driver.name,
      slug,
      countryId,
      driver.image,
      birthDate,
      driver.birthplace || null,
      JSON.stringify({ f1_api: driver.id }),
    ]);
  }

  console.log('  ✓ Drivers upserted into entities');
}

// ─── STEP 3: INGEST TEAMS ───────────────────────────────────
async function ingestTeams(client, season) {
  console.log(`\n[STEP 3] Ingesting teams for season ${season}...`);
  const rankings = await apiGet('/rankings/teams', { season });

  for (const row of rankings) {
    // API search only allows alphanumeric + spaces — strip special chars
    const searchName = row.team.name.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const teams = await apiGet('/teams', { search: searchName });
    if (!teams.length) continue;
    const team = teams[0];

    const countryId = await getCountryIdFromBase(client, team.base);
    const slug = slugify(team.name);

    await client.query(`
      INSERT INTO entities (
        entity_type, canonical_name, slug, country_id, image_url,
        founded_year, external_ids, sport_attributes, is_active, is_verified
      )
      VALUES ('f1_team', $1, $2, $3, $4, $5, $6, $7, true, false)
      ON CONFLICT (slug) DO UPDATE SET
        image_url        = EXCLUDED.image_url,
        sport_attributes = EXCLUDED.sport_attributes,
        updated_at       = now()
      RETURNING id
    `, [
      team.name,
      slug,
      countryId,
      team.logo,
      team.first_team_entry || null,
      JSON.stringify({ f1_api: team.id }),
      JSON.stringify({
        world_championships: team.world_championships,
        pole_positions:      team.pole_positions,
        fastest_laps:        team.fastest_laps,
        chassis:             team.chassis,
        engine:              team.engine,
        president:           team.president,
        director:            team.director,
        technical_manager:   team.technical_manager,
      }),
    ]);
  }

  console.log('  ✓ Teams upserted into entities');
}

// ─── STEP 4: DRIVER CHAMPIONSHIP STANDINGS ──────────────────
async function ingestDriverStandings(client, season) {
  console.log(`\n[STEP 4] Ingesting driver standings for ${season}...`);
  const resultTabId = RESULT_TABS[season]?.drivers;
  if (!resultTabId) {
    console.warn(`  No result_tab configured for drivers ${season}, skipping`);
    return;
  }

  const rankings = await apiGet('/rankings/drivers', { season });
  await client.query(`DELETE FROM standings WHERE result_tab_id = $1`, [resultTabId]);

  for (const row of rankings) {
    // Resolve driver entity_id via external_ids
    const driverEntity = await client.query(
      `SELECT id FROM entities WHERE external_ids->>'f1_api' = $1 AND entity_type = 'driver' LIMIT 1`,
      [String(row.driver.id)]
    );
    const driverEntityId = driverEntity.rows[0]?.id;
    if (!driverEntityId) continue;

    const teamEntity = await client.query(
      `SELECT id FROM entities WHERE external_ids->>'f1_api' = $1 AND entity_type = 'f1_team' LIMIT 1`,
      [String(row.team.id)]
    );

    await client.query(`
      INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
      VALUES ($1, $2, $3, 'driver', $4)
    `, [
      resultTabId,
      row.position,
      driverEntityId,
      JSON.stringify({
        points:  row.points,
        wins:    row.wins,
        behind:  row.behind,
        team_id: teamEntity.rows[0]?.id || null,
        abbr:    row.driver.abbr,
        number:  row.driver.number,
      }),
    ]);
  }

  console.log(`  ✓ ${rankings.length} driver standings rows inserted`);
}

// ─── STEP 5: CONSTRUCTOR STANDINGS ──────────────────────────
async function ingestTeamStandings(client, season) {
  console.log(`\n[STEP 5] Ingesting constructor standings for ${season}...`);
  const resultTabId = RESULT_TABS[season]?.teams;
  if (!resultTabId) {
    console.warn(`  No result_tab configured for teams ${season}, skipping`);
    return;
  }

  const rankings = await apiGet('/rankings/teams', { season });
  await client.query(`DELETE FROM standings WHERE result_tab_id = $1`, [resultTabId]);

  for (const row of rankings) {
    const teamEntity = await client.query(
      `SELECT id FROM entities WHERE external_ids->>'f1_api' = $1 AND entity_type = 'f1_team' LIMIT 1`,
      [String(row.team.id)]
    );
    const teamEntityId = teamEntity.rows[0]?.id;
    if (!teamEntityId) continue;

    await client.query(`
      INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats)
      VALUES ($1, $2, $3, 'f1_team', $4)
    `, [
      resultTabId,
      row.position,
      teamEntityId,
      JSON.stringify({ points: row.points }),
    ]);
  }

  console.log(`  ✓ ${rankings.length} constructor standings rows inserted`);
}

// ─── STEP 6: SESSION RESULTS (commits per session) ───────────
async function ingestSessionResults(client, season) {
  console.log(`\n[STEP 6] Ingesting session results for ${season}...`);

  // Get all session ids for this season using a fresh connection (outside caller transaction)
  const { rows: sessions } = await pool.query(
    `SELECT id, api_session_id, session_type, status FROM f1_sessions WHERE season_id = (
       SELECT id FROM seasons WHERE competition_id = $1 AND year = $2
     ) ORDER BY session_date ASC`,
    [F1_CHAMPIONSHIP_COMPETITION_ID, season]
  );

  let processed = 0;
  let skipped = 0;
  let quotaExceeded = false;

  for (const session of sessions) {
    if (quotaExceeded) break;
    if (session.status === 'Cancelled') { skipped++; continue; }

    // Skip if already ingested (check outside transaction)
    const existing = await pool.query(
      `SELECT 1 FROM f1_session_results WHERE session_id = $1 LIMIT 1`,
      [session.id]
    );
    if (existing.rows.length > 0) { skipped++; continue; }

    const results = await apiGet('/rankings/races', { race: session.api_session_id });

    // Detect daily quota exceeded
    if (!results.length) { skipped++; continue; }

    // Commit each session individually
    const sc = await pool.connect();
    try {
      await sc.query('BEGIN');

      for (const r of results) {
        const driverEntity = await sc.query(
          `SELECT id FROM entities WHERE external_ids->>'f1_api' = $1 AND entity_type = 'driver' LIMIT 1`,
          [String(r.driver.id)]
        );
        const driverEntityId = driverEntity.rows[0]?.id;
        if (!driverEntityId) continue;

        const teamEntity = await sc.query(
          `SELECT id FROM entities WHERE external_ids->>'f1_api' = $1 AND entity_type = 'f1_team' LIMIT 1`,
          [String(r.team.id)]
        );

        const grid = r.grid ? parseInt(r.grid) : null;

        await sc.query(`
          INSERT INTO f1_session_results (
            session_id, driver_id, team_id, position, time_result, laps, grid_position, pits
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (session_id, driver_id) DO UPDATE SET
            position      = EXCLUDED.position,
            time_result   = EXCLUDED.time_result,
            laps          = EXCLUDED.laps,
            grid_position = EXCLUDED.grid_position,
            pits          = EXCLUDED.pits,
            updated_at    = now()
        `, [
          session.id,
          driverEntityId,
          teamEntity.rows[0]?.id || null,
          r.position,
          r.time,
          r.laps,
          grid,
          r.pits,
        ]);
      }

      await sc.query('COMMIT');
      processed++;
      if (processed % 20 === 0) {
        console.log(`  ... ${processed} sessions committed`);
      }
    } catch (err) {
      await sc.query('ROLLBACK');
      console.error(`  ❌ Failed on session ${session.api_session_id}:`, err.message);
    } finally {
      sc.release();
    }
  }

  console.log(`  ✓ ${processed} sessions ingested, ${skipped} skipped`);
  if (quotaExceeded) console.log('  ⚠ Daily quota exceeded — re-run tomorrow to continue');
}

// ─── HELPER: run a step in its own transaction ───────────────
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('  ❌ Step failed, rolled back:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ─── MAIN ─────────────────────────────────────────────────────
async function main() {
  try {
    for (const season of SEASONS) {
      console.log(`\n${'='.repeat(50)}`);
      console.log(`  SEASON ${season}`);
      console.log('='.repeat(50));

      await withTransaction(c => ingestRaces(c, season));
      await withTransaction(c => ingestTeams(c, season));
      await withTransaction(c => ingestDriverStandings(c, season));
      await withTransaction(c => ingestTeamStandings(c, season));
      await ingestSessionResults(null, season); // manages own transactions per session
    }

    // Drivers ingested once (career-level, not per season)
    await withTransaction(c => ingestDrivers(c));

    console.log('\n✅ F1 ingestion complete');

  } catch (err) {
    console.error('\n❌ Ingestion stopped:', err.message);
    process.exit(1);
  }
}

main();