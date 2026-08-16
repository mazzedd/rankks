// ingest-motogp-team-standings.js
// Usage: node ingest-motogp-team-standings.js <fromYear> [toYear]
//
// Loads Team and Constructor championship standings, scraped separately
// from rider standings (motogp-raw/{year}/standings-team-{cat}.json and
// standings-constructor-{cat}.json — a v2 API endpoint, only populated
// from 2002 onward for the premier class; self-describing per year/
// category, same as everything else in this pipeline, no fixed rule
// assumed).
//
// Text-only (team_name/constructor_name), no entity resolution needed —
// the source itself gives no stable id for either, only points and
// position per season. Idempotent via ON CONFLICT (season_id, name).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('./db');
const { getOrCreateSeason, RAW_DIR, CATEGORIES } = require('./ingest-motogp');

function readJson(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

async function upsertTeamStanding(seasonId, row) {
  await query(
    `INSERT INTO motogp_team_standings (season_id, team_name, position, points)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (season_id, team_name) DO UPDATE SET position = EXCLUDED.position, points = EXCLUDED.points, updated_at = now()`,
    [seasonId, row.team, row.position ?? null, row.points ?? null]
  );
}

async function upsertConstructorStanding(seasonId, row) {
  await query(
    `INSERT INTO motogp_constructor_standings (season_id, constructor_name, position, points)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (season_id, constructor_name) DO UPDATE SET position = EXCLUDED.position, points = EXCLUDED.points, updated_at = now()`,
    [seasonId, row.constructor?.name, row.position ?? null, row.points ?? null]
  );
}

async function loadYear(year) {
  const yearDir = path.join(RAW_DIR, String(year));
  const done = [];

  for (const catSlug of CATEGORIES) {
    let seasonId = null; // resolved lazily — only if this year/category actually has team or constructor data

    const teamRows = readJson(path.join(yearDir, `standings-team-${catSlug}.json`));
    if (teamRows?.length) {
      seasonId = seasonId || await getOrCreateSeason(year, catSlug);
      for (const row of teamRows) await upsertTeamStanding(seasonId, row);
      done.push(`${catSlug} team (${teamRows.length})`);
    }

    const constructorRows = readJson(path.join(yearDir, `standings-constructor-${catSlug}.json`));
    if (constructorRows?.length) {
      seasonId = seasonId || await getOrCreateSeason(year, catSlug);
      for (const row of constructorRows) await upsertConstructorStanding(seasonId, row);
      done.push(`${catSlug} constructor (${constructorRows.length})`);
    }
  }

  if (done.length) console.log(`  ${year}: ${done.join(', ')}`);
}

async function main() {
  const [, , fromArg, toArg] = process.argv;
  if (!fromArg) { console.error('Usage: node ingest-motogp-team-standings.js <fromYear> [toYear]'); process.exit(1); }
  const from = parseInt(fromArg, 10);
  const to = toArg ? parseInt(toArg, 10) : from;

  for (let year = from; year <= to; year++) {
    await loadYear(year);
  }

  console.log('\nAll done.');
  const { end } = require('./db');
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
