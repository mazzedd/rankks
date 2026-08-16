// ingest-motogp-update.js
// Lives in rankks-ingestion/ (required — scheduler.js resolves every
// script_path against INGESTION_DIR, same as ingest-f1.js).
//
// Invoked by scheduler.js exactly like every other ingestion script:
//   node ingest-motogp-update.js <data_type> <year>
// MotoGP's own pipeline scripts (rankks-scrap/motogp-scraper/scrape.js +
// rankks-ingestion/ingest-motogp*.js) already exist from the historical
// 1949-2026 backfill, but nothing chains them into one current-season
// command a scheduler can call — this wrapper is that missing piece,
// same role ingest-f1.js plays for F1. Five order-dependent steps:
//   1. motogp-scraper\scrape.js <year> <year>        (api.pulselive.motogp.com
//                                                       -> JSON: sessions,
//                                                       results, rider/team/
//                                                       constructor standings
//                                                       — all 3 categories,
//                                                       one call)
//   2. ingest-motogp.js <year> <year>                (JSON -> Postgres:
//                                                       seasons/GPs/sessions/
//                                                       results/riders)
//   3. ingest-motogp-standings.js <year> <year>      (JSON -> Postgres:
//                                                       rider standings)
//   4. ingest-motogp-team-standings.js <year> <year> (JSON -> Postgres:
//                                                       team/constructor
//                                                       standings)
//   5. fetch-riders.js                               (bios for any new
//                                                       riders debuting this
//                                                       season — no args,
//                                                       walks all scraped
//                                                       files and skips
//                                                       anyone already
//                                                       cached, so this stays
//                                                       cheap on every run)
// Steps 1-2 are the core pipeline and abort the whole run on failure — step
// 2 depends on step 1's output, same as F1's scrape.js -> load.js. Steps
// 3-5 are independent enrichment (standings/team/constructor/bios) and are
// non-fatal — a hiccup there shouldn't block session results that already
// loaded. A failure is reported with a ⚠️ marker instead, which
// scheduler.js's runScript already reads as a "partial" status rather than
// "error", same convention as ingest-f1.js's calendar steps.
//
// Unlike ingest-motogp.js/ingest-motogp-standings.js/
// ingest-motogp-team-standings.js (which each call require('dotenv').config()
// themselves and live in this same rankks-ingestion/ folder), no explicit
// DATABASE_URL/env forwarding is needed here — they're invoked with
// cwd: INGESTION_DIR, so their own dotenv.config() picks up
// rankks-ingestion/.env exactly as it would running standalone. This is
// simpler than F1's case (f1-loader/ is a separate folder that relies on
// the wrapper to forward DATABASE_URL).
//
// <year> is accepted (scheduler.js passes new Date().getFullYear(), same
// as F1) but not required — falls back to computing the same thing itself
// if run manually without it.

const { execFile } = require('child_process');
const path = require('path');
require('dotenv').config();
const { query, end } = require('./db');

// Sibling of rankks-ingestion/ under the project root — portable across
// OS/environments (was a hardcoded Windows path before; broke on the Linux
// production host).
const SCRAPER_DIR    = path.resolve(__dirname, '../rankks-scrap/motogp-scraper');
const INGESTION_DIR  = __dirname;
const COMPETITION_ID = 4829; // MotoGP World Championship — onboarding-motogp.md Section 4

const argYear = parseInt(process.argv[3], 10);
const YEAR = Number.isFinite(argYear) ? argYear : new Date().getFullYear();

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function main() {
  let hadWarning = false;

  console.log(`[ingest-motogp-update] step 1/5: scrape.js ${YEAR} ${YEAR}`);
  const scrape = await run('node', ['scrape.js', String(YEAR), String(YEAR)], { cwd: SCRAPER_DIR });
  if (scrape.stdout) process.stdout.write(scrape.stdout);
  if (scrape.error) {
    console.error(scrape.stderr || scrape.error.message);
    console.error('[ingest-motogp-update] scrape.js failed — aborting before touching the database');
    process.exit(1);
  }

  console.log(`[ingest-motogp-update] step 2/5: ingest-motogp.js ${YEAR} ${YEAR}`);
  const load = await run('node', ['ingest-motogp.js', String(YEAR), String(YEAR)], { cwd: INGESTION_DIR });
  if (load.stdout) process.stdout.write(load.stdout);
  if (load.error) {
    console.error(load.stderr || load.error.message);
    console.error('[ingest-motogp-update] ingest-motogp.js failed');
    await end();
    process.exit(1);
  }

  // ingest-motogp.js's own getOrCreateSeason always hardcodes status='past'
  // (correct for the 1949-2025 historical backfill this loader was built
  // for, since none of those seasons is ever "current" by the time they're
  // loaded) — but this wrapper is the one place that DOES load an
  // in-progress season, so it self-corrects here instead of changing that
  // shared, already-tested backfill function. Needed for a real reason:
  // scheduler.js's getCurrentSeasonYear() looks up
  // `seasons WHERE competition_id = $1 AND status = 'current'` to resolve
  // which year to run for — without this, every scheduled MotoGP run would
  // silently skip with "no current season for this competition" forever
  // (confirmed: F1 sidesteps this entirely by having zero rows in the
  // generic `seasons` table for its competition_id, so its fallback branch
  // always fires instead). Purely a scheduler-lookup concern — the app's
  // own rendering logic never trusts this column (see motogp.js's own
  // getSeasonContext comment: "seasons.status is a stale/unmaintained
  // column here ... never trust it").
  await query(`UPDATE seasons SET status = 'past', updated_at = now() WHERE competition_id = $1 AND year <> $2 AND status <> 'past'`, [COMPETITION_ID, YEAR]);
  await query(`UPDATE seasons SET status = 'current', updated_at = now() WHERE competition_id = $1 AND year = $2 AND status <> 'current'`, [COMPETITION_ID, YEAR]);

  console.log(`[ingest-motogp-update] step 3/5: ingest-motogp-standings.js ${YEAR} ${YEAR}`);
  const standings = await run('node', ['ingest-motogp-standings.js', String(YEAR), String(YEAR)], { cwd: INGESTION_DIR });
  if (standings.stdout) process.stdout.write(standings.stdout);
  if (standings.error) {
    console.error('⚠️ [ingest-motogp-update] ingest-motogp-standings.js failed — rider standings will stay stale this cycle:', standings.stderr || standings.error.message);
    hadWarning = true;
  }

  console.log(`[ingest-motogp-update] step 4/5: ingest-motogp-team-standings.js ${YEAR} ${YEAR}`);
  const teamStandings = await run('node', ['ingest-motogp-team-standings.js', String(YEAR), String(YEAR)], { cwd: INGESTION_DIR });
  if (teamStandings.stdout) process.stdout.write(teamStandings.stdout);
  if (teamStandings.error) {
    console.error('⚠️ [ingest-motogp-update] ingest-motogp-team-standings.js failed — team/constructor standings will stay stale this cycle:', teamStandings.stderr || teamStandings.error.message);
    hadWarning = true;
  }

  console.log('[ingest-motogp-update] step 5/5: fetch-riders.js');
  const riders = await run('node', ['fetch-riders.js'], { cwd: SCRAPER_DIR });
  if (riders.stdout) process.stdout.write(riders.stdout);
  if (riders.error) {
    console.error('⚠️ [ingest-motogp-update] fetch-riders.js failed — any new riders this season will stay bio-less this cycle:', riders.stderr || riders.error.message);
    hadWarning = true;
  }

  console.log(`[ingest-motogp-update] done: MotoGP ${YEAR} scrape + load complete${hadWarning ? ' (with warnings)' : ''}`);
  await end();
  process.exit(0);
}

main();
