// ingest-f1.js
// Lives in rankks-ingestion/ (required — scheduler.js resolves every
// script_path against INGESTION_DIR, so this file's location is not
// optional even though the real work happens in sibling folders).
//
// Invoked by scheduler.js exactly like every other ingestion script:
//   node ingest-f1.js <data_type> <year>
// F1's actual pipeline doesn't match the fixtures/players/topscorers/
// standings/portraits shape every other sport uses — it's four
// order-dependent scripts across two folders:
//   1. rankks-scrap\scrape.js          (formula1.com results archive -> JSON)
//   2. f1-loader\load.js               (JSON -> Postgres: raced GPs + sessions)
//   3. rankks-scrap\scrape-calendar.js (formula1.com calendar/circuit -> JSON)
//   4. f1-loader\load-calendar.js      (JSON -> Postgres: every round's date/
//                                        laps/round order, including rounds
//                                        that haven't been raced yet)
// Steps 1-2 are the original pipeline (mirrors update-f1-live.bat) and can
// abort the whole run on failure — step 2 depends on step 1's output.
// Steps 3-4 are independent of 1-2 (different source, different concern:
// schedule/laps vs results) and are non-fatal — a hiccup there shouldn't
// block results that already succeeded. A failure is reported with a ⚠️
// marker instead, which scheduler.js's runScript already reads as a
// "partial" status rather than "error".
//
// <year> is accepted (scheduler.js now passes new Date().getFullYear()
// for F1, since it has no row in the generic `seasons` table to resolve
// a year from) but not required — if run manually without it, this
// falls back to computing the same thing itself.

const { execFile } = require('child_process');

const SCRAPER_DIR = 'C:\\DATA\\RANKKS APP\\rankks-scrap';
const LOADER_DIR  = 'C:\\DATA\\RANKKS APP\\f1-loader';

const DATABASE_URL = 'postgres://postgres:rankks123@localhost:5432/rankks';

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

  console.log(`[ingest-f1] step 1/4: scrape.js ${YEAR} ${YEAR}`);
  const scrape = await run('node', ['scrape.js', String(YEAR), String(YEAR)], { cwd: SCRAPER_DIR });
  if (scrape.stdout) process.stdout.write(scrape.stdout);
  if (scrape.error) {
    console.error(scrape.stderr || scrape.error.message);
    console.error('[ingest-f1] scrape.js failed — aborting before touching the database');
    process.exit(1);
  }

  console.log(`[ingest-f1] step 2/4: load.js ${YEAR} ${YEAR}`);
  const load = await run('node', ['load.js', String(YEAR), String(YEAR)], {
    cwd: LOADER_DIR,
    env: { ...process.env, DATABASE_URL },
  });
  if (load.stdout) process.stdout.write(load.stdout);
  if (load.error) {
    console.error(load.stderr || load.error.message);
    console.error('[ingest-f1] load.js failed');
    process.exit(1);
  }

  console.log(`[ingest-f1] step 3/4: scrape-calendar.js ${YEAR} ${YEAR}`);
  const scrapeCal = await run('node', ['scrape-calendar.js', String(YEAR), String(YEAR)], { cwd: SCRAPER_DIR });
  if (scrapeCal.stdout) process.stdout.write(scrapeCal.stdout);
  if (scrapeCal.error) {
    console.error('⚠️ [ingest-f1] scrape-calendar.js failed — schedule/laps for future rounds will stay stale this cycle:', scrapeCal.stderr || scrapeCal.error.message);
    hadWarning = true;
  } else {
    console.log(`[ingest-f1] step 4/4: load-calendar.js ${YEAR} ${YEAR}`);
    const loadCal = await run('node', ['load-calendar.js', String(YEAR), String(YEAR)], {
      cwd: LOADER_DIR,
      env: { ...process.env, DATABASE_URL },
    });
    if (loadCal.stdout) process.stdout.write(loadCal.stdout);
    if (loadCal.error) {
      console.error('⚠️ [ingest-f1] load-calendar.js failed:', loadCal.stderr || loadCal.error.message);
      hadWarning = true;
    }
  }

  console.log(`[ingest-f1] done: F1 ${YEAR} scrape + load complete${hadWarning ? ' (with warnings)' : ''}`);
  process.exit(0);
}

main();