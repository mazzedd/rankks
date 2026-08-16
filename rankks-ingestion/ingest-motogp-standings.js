// ingest-motogp-standings.js
// Usage: node ingest-motogp-standings.js <fromYear> [toYear]
//
// Separate from ingest-motogp.js on purpose — reads only
// motogp-raw/{year}/standings-{category}.json (234 files total, one per
// year/category) rather than re-scanning all 10,545 session classification
// files, since the season/rider resolution machinery is identical and
// reused via require(), not duplicated.
//
// Loads the season-long Riders' Championship into motogp_rider_standings —
// close to F1's own f1_driver_standings, not the generic standings/
// result_tabs mechanism (F1 itself doesn't use that either, and everything
// else in this pipeline already mirrors F1's dedicated-table approach).
//
// Idempotent via ON CONFLICT (season_id, rider_entity_id) — safe to re-run.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const { loadCountryMap, preloadRiderCache, getOrCreateRider, getOrCreateSeason, RAW_DIR, CATEGORIES } = require('./ingest-motogp');

function readJson(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

async function upsertRiderStanding(seasonId, row, riderId) {
  await query(
    `INSERT INTO motogp_rider_standings
      (season_id, rider_entity_id, team_name, constructor_name, position, points, wins, podiums, sprint_wins, sprint_podiums)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (season_id, rider_entity_id) DO UPDATE SET
      team_name = EXCLUDED.team_name, constructor_name = EXCLUDED.constructor_name,
      position = EXCLUDED.position, points = EXCLUDED.points, wins = EXCLUDED.wins,
      podiums = EXCLUDED.podiums, sprint_wins = EXCLUDED.sprint_wins, sprint_podiums = EXCLUDED.sprint_podiums,
      updated_at = now()`,
    [
      seasonId, riderId,
      row.team?.name || null, row.constructor?.name || null,
      row.position ?? null, row.points ?? null,
      row.race_wins ?? null, row.podiums ?? null,
      row.sprint_wins ?? null, row.sprint_podiums ?? null,
    ]
  );
}

async function loadYear(year, countryByIso2) {
  const yearDir = path.join(RAW_DIR, String(year));
  let totalRows = 0;
  const done = [];

  for (const catSlug of CATEGORIES) {
    const data = readJson(path.join(yearDir, `standings-${catSlug}.json`));
    if (!data?.classification?.length) continue;

    const seasonId = await getOrCreateSeason(year, catSlug);
    for (const row of data.classification) {
      const riderId = await getOrCreateRider(row.rider, countryByIso2);
      if (!riderId) continue;
      await upsertRiderStanding(seasonId, row, riderId);
      totalRows++;
    }
    done.push(`${catSlug} (${data.classification.length})`);
  }

  console.log(`  ${year}: ${done.join(', ') || '(no standings files)'} — ${totalRows} rows`);
}

async function main() {
  const [, , fromArg, toArg] = process.argv;
  if (!fromArg) { console.error('Usage: node ingest-motogp-standings.js <fromYear> [toYear]'); process.exit(1); }
  const from = parseInt(fromArg, 10);
  const to = toArg ? parseInt(toArg, 10) : from;

  const countryByIso2 = await loadCountryMap();
  await preloadRiderCache();

  for (let year = from; year <= to; year++) {
    await loadYear(year, countryByIso2);
  }

  console.log('\nAll done.');
  const { end } = require('./db');
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
