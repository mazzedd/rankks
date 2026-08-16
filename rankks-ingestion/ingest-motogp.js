// ingest-motogp.js
// Usage: node ingest-motogp.js <fromYear> [toYear]
//   node ingest-motogp.js 1949 2026
//
// Reads ./../rankks-scrap/motogp-scraper/motogp-raw/** (produced by
// scrape.js + fetch-riders.js) and loads into:
//   seasons (3 rows/year: category = motogp/moto2/moto3, sharing one
//     competition_id 4829 — see onboarding-motogp.md Section 4)
//   motogp_circuits / motogp_grands_prix / motogp_sessions /
//     motogp_session_results
//   entities (entity_type='rider'), resolved by external_ids->>'motogp_rider'
//     (the riders_api_uuid field — NOT rider.id, see fetch-riders.js's own
//     header comment about that exact bug already caught once this session)
//
// Idempotent, but NOT via ON CONFLICT everywhere — deliberately so.
// motogp_grands_prix (source_event_id UNIQUE, never null) and
// motogp_session_results (session_id, rider_entity_id UNIQUE, added this
// session specifically so this table could be idempotent at all) use real
// ON CONFLICT. seasons and motogp_sessions do NOT — their unique
// constraints include a nullable column (event_id, session_number) that's
// always NULL for MotoGP, and Postgres never treats NULL = NULL as a
// conflict, so ON CONFLICT on those would silently insert duplicates on
// every re-run. Both use an explicit SELECT-first check instead. Entities
// use a plain cache + SELECT-first too, same reasoning, avoiding the need
// for a new partial unique index just for this.
//
// Run a small range first (e.g. 2026 2026) and inspect real rows before
// scaling to the full 1949-2026 backfill.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query, queryOne, queryAll, end } = require('./db');

const RAW_DIR = path.join(__dirname, '..', 'rankks-scrap', 'motogp-scraper', 'motogp-raw');
const COMPETITION_ID = 4829; // MotoGP World Championship — onboarding-motogp.md Section 4
const CATEGORIES = ['motogp', 'moto2', 'moto3'];

// Mirrors F1's own DISPLAY_ORDER convention (f1-loader/lib/sessionType.js:
// Race=1, Qualifying=2, Sprint=3, ... Practice 1=8) — latest-in-time-first,
// already the established Line B ordering rule, not invented fresh here.
// Matches the reversed order the user asked for on the live mockup too.
// Latest-in-time-first, same convention as F1's own DISPLAY_ORDER
// (f1-loader/lib/sessionType.js). Confirmed the hard way that the modern
// vocabulary (FP1/FP2/PR/Q1/Q2/SPR/WUP/RAC) does NOT cover every era —
// checking actual session_type/session_number combos across all 78 years
// turned up P1-3 and QP1-2 (older equivalents of FP1-3/Q1-2, presumably a
// different site-internal naming convention in some period), FP3/FP4
// (eras with 4 practice sessions instead of 2), and one TTS (single
// occurrence, meaning unconfirmed). 1,906 sessions — not a handful — were
// silently landing on the 99 fallback before this was caught.
const BASE_ORDER = {
  RAC: 1, WUP: 2, SPR: 3,
  Q2: 4, QP2: 4,
  Q1: 5, QP1: 5, QP: 5,
  FP4: 6, P4: 6,
  FP3: 7, P3: 7,
  FP2: 8, P2: 8,
  PR: 9,
  FP1: 10, P1: 10,
};
// Type-only fallback (no number, or a number this map doesn't have an
// exact entry for — e.g. a red-flag-restart "RAC" numbered 2) — groups
// with its base type rather than falling to 99, which read as
// "unimportant" for what's still e.g. a real race session.
const TYPE_ORDER = { RAC: 1, WUP: 2, SPR: 3, Q: 5, QP: 5, FP: 8, P: 8, PR: 9 };
function displayOrderFor(type, number) {
  const key = number != null ? `${type}${number}` : type;
  if (BASE_ORDER[key] != null) return BASE_ORDER[key];
  return TYPE_ORDER[type] ?? 99;
}

function readJson(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------- countries
async function loadCountryMap() {
  const rows = await queryAll(`SELECT id, iso2 FROM countries`);
  const map = new Map(rows.map(r => [r.iso2, r.id]));
  console.log(`  country map loaded: ${map.size} countries`);
  return map;
}

// ---------------------------------------------------------------- riders
const riderCache = new Map(); // riders_api_uuid -> entity id

async function preloadRiderCache() {
  const rows = await queryAll(
    `SELECT id, external_ids->>'motogp_rider' AS rid FROM entities WHERE external_ids ? 'motogp_rider'`
  );
  for (const r of rows) riderCache.set(r.rid, r.id);
  console.log(`  rider entity cache preloaded: ${riderCache.size} existing MotoGP riders`);
}

async function getOrCreateRider(riderObj, countryByIso2) {
  const uuid = riderObj?.riders_api_uuid || riderObj?.riders_id;
  if (!uuid) return null;
  if (riderCache.has(uuid)) return riderCache.get(uuid);

  const existing = await queryOne(`SELECT id FROM entities WHERE external_ids->>'motogp_rider' = $1`, [uuid]);
  if (existing) { riderCache.set(uuid, existing.id); return existing.id; }

  const bio = readJson(path.join(RAW_DIR, 'riders', `${uuid}.json`));
  const canonicalName = bio ? `${bio.name || ''} ${bio.surname || ''}`.trim() : riderObj.full_name;
  const countryIso = bio?.country?.iso || riderObj.country?.iso || null;
  const countryId = countryIso ? countryByIso2.get(countryIso) || null : null;
  const slug = `${slugify(canonicalName)}-${uuid.slice(0, 8)}`;
  const nickname = bio?.short_nickname || null;

  // entity_type is CHECK-constrained to a fixed list (player/club/
  // national_team/person/driver/f1_team/all_star_team) — no 'rider' value.
  // Reusing 'driver' since a MotoGP rider is the same kind of individual
  // athlete entity as an F1 driver, confirmed against the live constraint
  // rather than guessed.
  const row = await queryOne(
    `INSERT INTO entities
      (entity_type, canonical_name, slug, country_id, gender, birth_date, birth_city,
       height_cm, weight_kg, turned_pro_year, retired_year, external_ids, sport_attributes)
     VALUES ('driver', $1, $2, $3, 'M', $4, $5, $6, $7, $8, $9,
       jsonb_build_object('motogp_rider', $10::text),
       $11::jsonb)
     RETURNING id`,
    [
      canonicalName || 'Unknown Rider', slug, countryId,
      bio?.birth_date || null, bio?.birth_city || null,
      bio?.physical_attributes?.height || null, bio?.physical_attributes?.weight || null,
      bio?.start_year || null, bio?.retired_year || null,
      uuid,
      JSON.stringify(nickname ? { nickname } : {}),
    ]
  );
  riderCache.set(uuid, row.id);
  return row.id;
}

// ---------------------------------------------------------------- circuits
const circuitCache = new Map(); // name -> id

async function getOrCreateCircuit(circuit, countryByIso2, countryIso) {
  if (!circuit?.name) return null;
  if (circuitCache.has(circuit.name)) return circuitCache.get(circuit.name);

  const existing = await queryOne(`SELECT id FROM motogp_circuits WHERE name = $1`, [circuit.name]);
  if (existing) { circuitCache.set(circuit.name, existing.id); return existing.id; }

  const countryId = countryIso ? countryByIso2.get(countryIso) || null : null;
  const row = await queryOne(
    `INSERT INTO motogp_circuits (name, city, country_id) VALUES ($1, $2, $3) RETURNING id`,
    [circuit.name, circuit.place || null, countryId]
  );
  circuitCache.set(circuit.name, row.id);
  return row.id;
}

// ---------------------------------------------------------------- seasons
const seasonCache = new Map(); // `${year}:${category}` -> id

async function getOrCreateSeason(year, category) {
  const key = `${year}:${category}`;
  if (seasonCache.has(key)) return seasonCache.get(key);

  // Explicit SELECT-first, not ON CONFLICT — see file header (event_id is
  // always NULL for MotoGP, which breaks the live unique constraint's
  // ability to detect a duplicate via ON CONFLICT).
  const existing = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id IS NULL AND year = $2 AND gender = 'M' AND sub_edition = 1 AND category = $3`,
    [COMPETITION_ID, year, category]
  );
  if (existing) { seasonCache.set(key, existing.id); return existing.id; }

  const row = await queryOne(
    `INSERT INTO seasons (competition_id, year, status, gender, sub_edition, category)
     VALUES ($1, $2, 'past', 'M', 1, $3) RETURNING id`,
    [COMPETITION_ID, year, category]
  );
  seasonCache.set(key, row.id);
  return row.id;
}

// ---------------------------------------------------------------- grands prix
async function upsertGrandPrix(event, year, roundOrder, circuitId, countryByIso2) {
  const countryId = event.country?.iso ? countryByIso2.get(event.country.iso) || null : null;
  const row = await queryOne(
    `INSERT INTO motogp_grands_prix
      (year, source_event_id, slug, name, full_title, circuit_id, country_id, event_date_start, event_date_end, round_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (source_event_id) DO UPDATE SET
      name = EXCLUDED.name, full_title = EXCLUDED.full_title, circuit_id = EXCLUDED.circuit_id,
      country_id = EXCLUDED.country_id, event_date_start = EXCLUDED.event_date_start,
      event_date_end = EXCLUDED.event_date_end, round_order = EXCLUDED.round_order, updated_at = now()
     RETURNING id`,
    [
      year, event.id, event.short_name?.toLowerCase() || slugify(event.name), event.name,
      event.sponsored_name || null, circuitId, countryId,
      event.date_start || null, event.date_end || null, roundOrder,
    ]
  );
  return row.id;
}

// ---------------------------------------------------------------- sessions
async function getOrCreateSession(gpId, category, sessionType, sessionNumber, sessionDate) {
  // Explicit SELECT-first, not ON CONFLICT — see file header (session_number
  // is NULL for PR/SPR/WUP/RAC, same NULL-vs-unique-constraint issue as seasons).
  const existing = sessionNumber == null
    ? await queryOne(
        `SELECT id FROM motogp_sessions WHERE grand_prix_id = $1 AND category = $2 AND session_type = $3 AND session_number IS NULL`,
        [gpId, category, sessionType]
      )
    : await queryOne(
        `SELECT id FROM motogp_sessions WHERE grand_prix_id = $1 AND category = $2 AND session_type = $3 AND session_number = $4`,
        [gpId, category, sessionType, sessionNumber]
      );
  if (existing) return existing.id;

  const row = await queryOne(
    `INSERT INTO motogp_sessions (grand_prix_id, category, session_type, session_number, display_order, session_date)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [gpId, category, sessionType, sessionNumber, displayOrderFor(sessionType, sessionNumber), sessionDate || null]
  );
  return row.id;
}

// ---------------------------------------------------------------- results
async function upsertSessionResult(sessionId, row, riderId) {
  const isRaceShaped = 'points' in row;
  await query(
    `INSERT INTO motogp_session_results
      (session_id, position, car_number, rider_entity_id, team_name, constructor_name,
       laps, time_result, gap_to_first, points, best_lap_time, top_speed, average_speed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (session_id, rider_entity_id) DO UPDATE SET
      position = EXCLUDED.position, team_name = EXCLUDED.team_name, constructor_name = EXCLUDED.constructor_name,
      laps = EXCLUDED.laps, time_result = EXCLUDED.time_result, gap_to_first = EXCLUDED.gap_to_first,
      points = EXCLUDED.points, best_lap_time = EXCLUDED.best_lap_time, top_speed = EXCLUDED.top_speed,
      average_speed = EXCLUDED.average_speed`,
    [
      sessionId,
      row.position ?? null,
      row.rider?.number ?? null,
      riderId,
      row.team?.name || null,
      row.constructor?.name || null,
      row.total_laps ?? null,
      isRaceShaped ? (row.time || null) : null,
      row.gap?.first ?? null,
      isRaceShaped ? (row.points ?? null) : null,
      !isRaceShaped ? (row.best_lap?.time || null) : null,
      !isRaceShaped ? (row.top_speed ?? null) : null,
      isRaceShaped ? (row.average_speed ?? null) : null,
    ]
  );
}

// ---------------------------------------------------------------- per-year
async function loadYear(year, countryByIso2) {
  console.log(`\n=== ${year} ===`);
  const yearDir = path.join(RAW_DIR, String(year));
  const events = readJson(path.join(yearDir, 'events.json'));
  if (!events) { console.warn(`  no events.json for ${year} — skipping`); return; }

  // Season row per category actually present this year (skips e.g. moto2
  // for 1960, moto3 for 1990 — no row created for a class that never raced).
  const categoriesThisYear = new Set();

  const realEvents = events.filter(e => !e.test);
  let roundOrder = 0;
  let gpCount = 0, sessionCount = 0, resultCount = 0;

  for (const event of realEvents) {
    roundOrder++;
    const dirName = event.short_name ? event.short_name.toUpperCase() : slugify(event.name);
    const eventDir = path.join(yearDir, dirName);
    const categories = readJson(path.join(eventDir, 'categories.json'));
    if (!categories) continue;

    const circuitId = await getOrCreateCircuit(event.circuit, countryByIso2, event.country?.iso);
    const gpId = await upsertGrandPrix(event, year, roundOrder, circuitId, countryByIso2);
    gpCount++;

    for (const catSlug of CATEGORIES) {
      const catDir = path.join(eventDir, catSlug);
      const sessions = readJson(path.join(catDir, 'sessions.json'));
      if (!sessions) continue; // this class didn't race at this event
      categoriesThisYear.add(catSlug);

      for (const s of sessions) {
        // Session shell created unconditionally (type/number/date, no
        // results) — scrape.js already fetches sessions.json's schedule
        // for every event regardless of whether classification is
        // published yet (confirmed: a future round's sessions.json exists
        // with real dates, only the -classification.json files are
        // missing). Without this, a not-yet-raced round would have zero
        // motogp_sessions rows at all, so the Home page / GP page session
        // list and the results route's "fall back to current standings"
        // placeholder (see routes/motogp.js) would have no session_id to
        // anchor to — same role F1's load-calendar.js's session-shell
        // upsert plays, except MotoGP already has this schedule data in
        // the same file as the results, so no separate calendar scraper
        // is needed.
        const sessionId = await getOrCreateSession(gpId, catSlug, s.type, s.number ?? null, s.date || null);
        sessionCount++;

        const classification = readJson(path.join(catDir, `${s.type}${s.number ?? ''}-classification.json`));
        if (!classification?.classification?.length) continue; // not raced yet / not published — shell stays empty

        for (const row of classification.classification) {
          const riderId = await getOrCreateRider(row.rider, countryByIso2);
          if (!riderId) continue;
          await upsertSessionResult(sessionId, row, riderId);
          resultCount++;
        }
      }
    }
  }

  for (const catSlug of categoriesThisYear) {
    await getOrCreateSeason(year, catSlug);
  }

  console.log(`  ${year} done — ${gpCount} GPs, ${sessionCount} sessions, ${resultCount} results, categories: ${[...categoriesThisYear].join(', ') || '(none)'}`);
}

async function main() {
  const [, , fromArg, toArg] = process.argv;
  if (!fromArg) { console.error('Usage: node ingest-motogp.js <fromYear> [toYear]'); process.exit(1); }
  const from = parseInt(fromArg, 10);
  const to = toArg ? parseInt(toArg, 10) : from;

  const countryByIso2 = await loadCountryMap();
  await preloadRiderCache();

  for (let year = from; year <= to; year++) {
    await loadYear(year, countryByIso2);
  }

  console.log('\nAll done.');
  await end();
}

// Only auto-run when invoked directly (node ingest-motogp.js ...) — required
// as a module by ingest-motogp-standings.js, which reuses loadCountryMap/
// preloadRiderCache/getOrCreateRider/getOrCreateSeason rather than
// duplicating rider/season resolution logic.
if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { loadCountryMap, preloadRiderCache, getOrCreateRider, getOrCreateSeason, RAW_DIR, CATEGORIES };
