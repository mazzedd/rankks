// load.js
// Usage: node load.js <fromYear> [toYear]
//   set DATABASE_URL=postgres://user:pass@localhost:5432/dbname   (Windows CMD, set once per terminal session)
//   node load.js 2004 2004
//
// Reads ./f1-raw/{year}/** (produced by the scraper) and loads into
// f1_seasons / f1_grands_prix / f1_sessions / f1_session_results /
// f1_fastest_laps / f1_driver_standings / f1_team_standings.
//
// Idempotent: every insert uses ON CONFLICT ... DO UPDATE keyed on the
// table's unique constraint, so re-running for a year you've already
// loaded updates rather than duplicates.
//
// NOT YET RUN AGAINST A LIVE DATABASE — same caveat as the scraper had
// on its first run. Test on 2004 only first, inspect the actual rows
// in pgAdmin, THEN scale up. Expect at least one round of fixes.

const fs = require('fs');
const path = require('path');
const { pool } = require('./lib/db');
const { loadCache, getOrCreateEntity } = require('./lib/entities');
const { classifyByLabel, mergeQualifyingFiles, DISPLAY_ORDER } = require('./lib/sessionType');

// Points at rankks-scrap's output, NOT a local f1-raw folder — scrape.js
// (in rankks-scrap/) is the only thing that ever writes this data. A
// leftover f1-loader/f1-raw/ existed from an early manual test run and
// silently shadowed this for every load since — load.js was reprocessing
// a stale July 5 snapshot on every run, undetectable because the handful
// of already-raced rounds it covered don't change once final.
const RAW_DIR = path.join(__dirname, '..', 'rankks-scrap', 'f1-raw');

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function parseDate(dateStr, year) {
  if (!dateStr) return null;
  // scraped format: "07 Mar" -> combine with year
  const parsed = new Date(`${dateStr} ${year}`);
  if (isNaN(parsed)) return null;
  // Build the date string from LOCAL components, not toISOString() — that
  // reads the local-midnight Date back out in UTC, which silently rolls it
  // back a day on any machine east of UTC (confirmed: this shifted every
  // event_date in the table back by exactly one day).
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function upsertSeason(year) {
  const { rows } = await pool.query(
    `INSERT INTO f1_seasons (year) VALUES ($1)
     ON CONFLICT (year) DO UPDATE SET year = EXCLUDED.year
     RETURNING id`,
    [year]
  );
  return rows[0].id;
}

async function resolveDriver(cache, driverCell) {
  if (!driverCell?.driverCode) return null;
  const { name } = splitNameCode(driverCell.text);
  return getOrCreateEntity(pool, cache, {
    entityType: 'driver',
    externalKey: driverCell.driverCode,
    canonicalName: name,
    slug: driverCell.slug || driverCell.driverCode.toLowerCase(),
  });
}

async function resolveTeam(cache, teamCell) {
  if (!teamCell?.teamSlug) return null;
  return getOrCreateEntity(pool, cache, {
    entityType: 'f1_team',
    externalKey: teamCell.teamSlug,
    canonicalName: teamCell.text,
    slug: teamCell.teamSlug.toLowerCase(),
  });
}

// Duplicated intentionally from lib/parse.js (scraper side) — loader
// runs as a separate project/process, keeping it dependency-free of
// the scraper folder rather than reaching across into it.
function splitNameCode(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*[a-zà-ÿ.'])([A-Z]{3})$/);
  if (m) return { name: m[1].trim(), code: m[2] };
  return { name: t, code: null };
}

async function loadYear(year) {
  console.log(`\n=== ${year} ===`);
  const yearDir = path.join(RAW_DIR, String(year));
  const racesRaw = readJson(path.join(yearDir, 'races.json'));
  if (!racesRaw) { console.warn(`  no races.json for ${year}, skipping`); return; }

  const cache = await loadCache(pool);
  const seasonId = await upsertSeason(year);

  // Per-season name -> entity id maps. Session-result rows (race-result,
  // qualifying, practice) have NO href on the driver/team cell — confirmed
  // against real scraped JSON, only the standings page has one. So those
  // rows can't be resolved by code at all; they're resolved by name
  // against entities already created from THIS season's standings pages,
  // which is why standings must load first, not last.
  const driverNameMap = new Map(); // normalized name -> entity id
  const teamNameMap = new Map();

  function normalize(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // ── Driver standings (loads first — establishes this season's named drivers) ──
  const dsRaw = readJson(path.join(yearDir, 'drivers-standings.json'));
  if (dsRaw?.rows) {
    for (const row of dsRaw.rows) {
      const driverId = await resolveDriver(cache, row['driver']);
      const teamId = await resolveTeam(cache, row['team']);
      if (!driverId) continue;
      if (row['driver']?.text) {
        const { name } = splitNameCode(row['driver'].text);
        driverNameMap.set(normalize(name), driverId);
      }
      await pool.query(
        `INSERT INTO f1_driver_standings (f1_season_id, driver_entity_id, team_entity_id, position, points)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (f1_season_id, driver_entity_id) DO UPDATE SET
          team_entity_id=EXCLUDED.team_entity_id, position=EXCLUDED.position, points=EXCLUDED.points`,
        [seasonId, driverId, teamId, row['pos']?.text || null, row['pts']?.text ? parseFloat(row['pts'].text) : null]
      );
    }
  }

  // ── Team standings (also loads first, same reason) ──
  const tsRaw = readJson(path.join(yearDir, 'team-standings.json'));
  if (tsRaw?.rows) {
    for (const row of tsRaw.rows) {
      const teamCell = row['team'] || row['constructor'] || Object.values(row)[1];
      const teamId = await resolveTeam(cache, teamCell);
      if (!teamId) continue;
      if (teamCell?.text) teamNameMap.set(normalize(teamCell.text), teamId);
      await pool.query(
        `INSERT INTO f1_team_standings (f1_season_id, team_entity_id, position, points, country_name)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (f1_season_id, team_entity_id) DO UPDATE SET
          position=EXCLUDED.position, points=EXCLUDED.points, country_name=EXCLUDED.country_name`,
        [seasonId, teamId, row['position']?.text || row['pos']?.text || null,
         row['points']?.text ? parseFloat(row['points'].text) : (row['pts']?.text ? parseFloat(row['pts'].text) : null),
         row['country']?.text || null]
      );
    }
  }

  // Resolves a session-result row's driver/team cell (no href available)
  // by name against this season's standings-derived map. Falls back to
  // creating a name-only entity for the rare case of a driver who appears
  // in a session but never in the final standings (e.g. a one-off
  // substitute who scored no points and might not be listed) — accepting
  // a small duplicate-entity risk for that edge case rather than
  // dropping the row entirely.
  async function resolveByName(map, text, entityType) {
    if (!text) return null;
    const { name } = splitNameCode(text);
    const key = normalize(name);
    if (map.has(key)) return map.get(key);

    // Not seen yet THIS season — before creating a new entity, check
    // globally (any season) for an exact name match. Without this, a
    // team/driver missing from one particular season's final standings
    // page (mid-season change, early retirement, etc.) but present in
    // that season's session results would get a second, duplicate
    // entity created under a 'nameonly:' key even though a real,
    // href-based entity for them already exists from another year —
    // confirmed happening with "Prost Peugeot" in 2000.
    const existing = await pool.query(
      `SELECT id FROM entities WHERE entity_type = $1 AND canonical_name = $2 LIMIT 1`,
      [entityType, name]
    );
    if (existing.rows.length) {
      map.set(key, existing.rows[0].id);
      return existing.rows[0].id;
    }

    const id = await getOrCreateEntity(pool, cache, {
      entityType,
      externalKey: `nameonly:${key}`,
      canonicalName: name,
      slug: key,
    });
    map.set(key, id);
    return id;
  }

  // Loads every session file listed in a race dir's _session-nav.json,
  // classifies each, and upserts f1_sessions + f1_session_results for the
  // given gpId. Pure extraction from the old inline loop body — same
  // behavior, just reusable so the "in-progress round" loop below (rounds
  // not yet in races.json but with some sessions already published, e.g.
  // Practice 1 live before the race itself) can share it instead of
  // duplicating the qualifying-merge/classify/insert logic.
  async function processSessionsForGp(gpId, raceDir, driverNameMap, teamNameMap) {
    const navPath = path.join(raceDir, '_session-nav.json');
    const sessionLinks = readJson(navPath) || [];

    const sessionFiles = [];
    for (const link of sessionLinks) {
      const fname = link.session_key.replace(/\//g, '-') + '.json';
      const data = readJson(path.join(raceDir, fname));
      if (!data) continue;
      const type = classifyByLabel(link.label, fname);
      if (!type) continue; // starting-grid, pit-stop-summary — intentionally skipped
      sessionFiles.push({ filename: fname, label: link.label, type, headers: data.headers || [], rows: data.rows || [] });
    }

    const isSprintWeekend = sessionFiles.some(f => f.type === 'Sprint');

    const qualifyingRaw = sessionFiles.filter(f => f.type === 'Qualifying_RAW');
    const nonQualifying = sessionFiles.filter(f => f.type !== 'Qualifying_RAW');

    const sessionsToInsert = nonQualifying.map(f => ({ type: f.type, rows: f.rows }));
    if (qualifyingRaw.length) {
      sessionsToInsert.push({ type: 'Qualifying', rows: mergeQualifyingFiles(qualifyingRaw) });
    }

    for (const s of sessionsToInsert) {
      const sessResult = await pool.query(
        `INSERT INTO f1_sessions (grand_prix_id, session_type, display_order)
         VALUES ($1,$2,$3)
         ON CONFLICT (grand_prix_id, session_type) DO UPDATE SET display_order = EXCLUDED.display_order
         RETURNING id`,
        [gpId, s.type, DISPLAY_ORDER[s.type] || 99]
      );
      const sessionId = sessResult.rows[0].id;
      const isQualifying = s.type === 'Qualifying' || s.type === 'Sprint Qualifying';

      for (const row of s.rows) {
        const driverId = await resolveByName(driverNameMap, row['driver']?.text, 'driver');
        const teamId = await resolveByName(teamNameMap, row['team']?.text, 'f1_team');
        if (!driverId) continue; // row we can't attribute to a driver isn't useful — skip rather than insert a null-driver row

        await pool.query(
          `INSERT INTO f1_session_results
            (session_id, position, car_number, driver_entity_id, team_entity_id, laps, time_result, points, q1_time, q2_time, q3_time, grid_position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (session_id, driver_entity_id) DO UPDATE SET
            position = EXCLUDED.position, time_result = EXCLUDED.time_result, points = EXCLUDED.points,
            q1_time = EXCLUDED.q1_time, q2_time = EXCLUDED.q2_time, q3_time = EXCLUDED.q3_time`,
          [
            sessionId,
            row['pos']?.text || null,
            row['no']?.text || null,
            driverId,
            teamId,
            row['laps']?.text ? parseInt(row['laps'].text, 10) || null : null,
            isQualifying ? null : (row['time_retired']?.text || row['time_gap']?.text || row['time']?.text || null),
            row['pts']?.text ? parseFloat(row['pts'].text) : null,
            isQualifying ? (row['q1']?.text || null) : null,
            isQualifying ? (row['q2']?.text || null) : null,
            isQualifying ? (row['q3']?.text || null) : null,
            row['grid']?.text || null,
          ]
        );
      }
    }
    return isSprintWeekend;
  }

  // ── Grands Prix + sessions + results ──
  const processedSlugs = new Set();
  for (let i = 0; i < racesRaw.length; i++) {
    const race = racesRaw[i];
    const raceDir = path.join(yearDir, `race-${race.race_id}-${race.slug}`);

    // Conflict target is (f1_season_id, slug), not source_race_id — a round
    // may already exist as a calendar-only placeholder row (see
    // load-calendar.js), inserted before it was ever raced, keyed by slug
    // since it had no real source_race_id yet (source_race_id was a
    // synthetic "cal-N" placeholder). This upsert is the authoritative one
    // once real results exist, so it overwrites source_race_id/name/
    // circuit_country/event_date unconditionally, merging into that same
    // row instead of creating a duplicate.
    const gpResult = await pool.query(
      `INSERT INTO f1_grands_prix
        (f1_season_id, source_race_id, slug, name, circuit_country, event_date, round_order, is_sprint_weekend)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (f1_season_id, slug) DO UPDATE SET
        source_race_id = EXCLUDED.source_race_id,
        name = EXCLUDED.name, circuit_country = EXCLUDED.circuit_country,
        event_date = EXCLUDED.event_date, round_order = EXCLUDED.round_order,
        updated_at = now()
       RETURNING id`,
      [seasonId, race.race_id, race.slug, race.gp_name, race.circuit_country, parseDate(race.date, year), i + 1, false]
    );
    const gpId = gpResult.rows[0].id;

    const isSprintWeekend = await processSessionsForGp(gpId, raceDir, driverNameMap, teamNameMap);
    if (isSprintWeekend) {
      await pool.query(`UPDATE f1_grands_prix SET is_sprint_weekend = true WHERE id = $1`, [gpId]);
    }
    processedSlugs.add(race.slug);
  }

  // ── In-progress rounds ── not yet in races.json (no completed Race
  // result), but scrape.js may have found some sessions already published
  // mid-weekend (e.g. Practice 1) via its race-filter probe. The GP row
  // itself already exists from load-calendar.js (real event_date/round_order/
  // slug) — this only needs to attach whatever session results are
  // available, not touch the GP's own fields.
  const yearEntries = fs.existsSync(yearDir) ? fs.readdirSync(yearDir, { withFileTypes: true }) : [];
  for (const entry of yearEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith('race-')) continue;
    const m = entry.name.match(/^race-(\d+)-(.+)$/);
    if (!m) continue;
    const [, , slug] = m;
    if (processedSlugs.has(slug)) continue; // already handled above
    const raceDir = path.join(yearDir, entry.name);
    if (!fs.existsSync(path.join(raceDir, '_session-nav.json'))) continue; // nothing published yet

    const gpRow = await pool.query(`SELECT id FROM f1_grands_prix WHERE f1_season_id = $1 AND slug = $2`, [seasonId, slug]);
    if (!gpRow.rows.length) {
      console.warn(`  [${slug}] session data found but no f1_grands_prix row exists yet — run load-calendar.js first`);
      continue;
    }
    const isSprintWeekend = await processSessionsForGp(gpRow.rows[0].id, raceDir, driverNameMap, teamNameMap);
    if (isSprintWeekend) {
      await pool.query(`UPDATE f1_grands_prix SET is_sprint_weekend = true WHERE id = $1`, [gpRow.rows[0].id]);
    }
    console.log(`  [${slug}] in-progress round — session results loaded`);
  }

  // ── Fastest laps ──
  const flRaw = readJson(path.join(yearDir, 'fastest-laps.json'));
  if (flRaw?.rows) {
    for (const row of flRaw.rows) {
      const raceCell = row['races'] || row['race'] || Object.values(row)[0];
      const raceId = raceCell?.raceId;
      if (!raceId) continue;
      const gpRow = await pool.query(`SELECT id FROM f1_grands_prix WHERE f1_season_id=$1 AND source_race_id=$2`, [seasonId, raceId]);
      if (!gpRow.rows.length) continue;
      const driverId = (await resolveDriver(cache, row['winner'])) || (await resolveByName(driverNameMap, row['winner']?.text, 'driver'));
      const teamId = null; // fastest-laps.json has no team column (headers: Grand Prix | Winner | Time)
      if (!driverId) continue;
      await pool.query(
        `INSERT INTO f1_fastest_laps (grand_prix_id, driver_entity_id, team_entity_id, time_result)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (grand_prix_id) DO UPDATE SET driver_entity_id=EXCLUDED.driver_entity_id, team_entity_id=EXCLUDED.team_entity_id, time_result=EXCLUDED.time_result`,
        [gpRow.rows[0].id, driverId, teamId, row['time']?.text || null]
      );
    }
  }

  // ── Driver standings ── (loaded earlier, before races — see top of function)

  // ── Computed aggregates: wins/2nd/3rd/sprint-wins/car-number ──
  // NOT on F1.com's standings pages — derived from session results here,
  // per the approach confirmed earlier in this session.
  await pool.query(`
    WITH agg AS (
      SELECT sr.driver_entity_id AS driver_id,
        COUNT(*) FILTER (WHERE s.session_type='Race' AND sr.position='1') AS wins,
        COUNT(*) FILTER (WHERE s.session_type='Race' AND sr.position='2') AS p2,
        COUNT(*) FILTER (WHERE s.session_type='Race' AND sr.position='3') AS p3,
        COUNT(*) FILTER (WHERE s.session_type='Sprint' AND sr.position='1') AS sprint_wins,
        (ARRAY_AGG(sr.car_number ORDER BY g.round_order DESC) FILTER (WHERE sr.car_number IS NOT NULL))[1] AS car_number
      FROM f1_session_results sr
      JOIN f1_sessions s ON s.id = sr.session_id
      JOIN f1_grands_prix g ON g.id = s.grand_prix_id
      WHERE g.f1_season_id = $1
      GROUP BY sr.driver_entity_id
    )
    UPDATE f1_driver_standings ds
    SET wins = agg.wins, p2 = agg.p2, p3 = agg.p3, sprint_wins = agg.sprint_wins, car_number = agg.car_number
    FROM agg WHERE ds.f1_season_id = $1 AND ds.driver_entity_id = agg.driver_id
  `, [seasonId]);

  await pool.query(`
    WITH agg AS (
      SELECT sr.team_entity_id AS team_id,
        COUNT(*) FILTER (WHERE s.session_type='Race' AND sr.position='1') AS wins,
        COUNT(*) FILTER (WHERE s.session_type='Race' AND sr.position='2') AS p2,
        COUNT(*) FILTER (WHERE s.session_type='Race' AND sr.position='3') AS p3,
        COUNT(*) FILTER (WHERE s.session_type='Sprint' AND sr.position='1') AS sprint_wins
      FROM f1_session_results sr
      JOIN f1_sessions s ON s.id = sr.session_id
      JOIN f1_grands_prix g ON g.id = s.grand_prix_id
      WHERE g.f1_season_id = $1
      GROUP BY sr.team_entity_id
    )
    UPDATE f1_team_standings ts
    SET wins = agg.wins, p2 = agg.p2, p3 = agg.p3, sprint_wins = agg.sprint_wins
    FROM agg WHERE ts.f1_season_id = $1 AND ts.team_entity_id = agg.team_id
  `, [seasonId]);

  console.log(`  done: ${year}`);
}

async function main() {
  const [, , fromArg, toArg] = process.argv;
  if (!fromArg) { console.error('Usage: node load.js <fromYear> [toYear]'); process.exit(1); }
  const from = parseInt(fromArg, 10);
  const to = toArg ? parseInt(toArg, 10) : from;

  for (let year = from; year <= to; year++) {
    await loadYear(year);
  }
  console.log('\nAll done.');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
