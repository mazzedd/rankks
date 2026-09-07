// =============================================================================
// RANKKS — NBA Automated Ingestion Scheduler
// Runs ingest-nba.js's ingestStandings() on a recurring cron schedule instead
// of requiring a manual `node ingest-nba.js` each time.
//
// Run:  node schedule-nba.js
// Stop: Ctrl+C (closes the DB pool cleanly)
//
// Config (optional, via rankks-api/.env):
//   NBA_SEASON        — season to keep re-ingesting, e.g. "2026-2027" (default)
//   NBA_CRON_SCHEDULE — cron expression, default "0 7 * * *" (daily at 07:00)
// =============================================================================

require('dotenv').config({ path: '../rankks-api/.env' });
const cron = require('node-cron');
const { ingestStandings, pool } = require('./ingest-nba');

const SEASON   = process.env.NBA_SEASON        || '2026-2027';
const SCHEDULE = process.env.NBA_CRON_SCHEDULE || '0 7 * * *'; // daily @ 07:00

if (!cron.validate(SCHEDULE)) {
  console.error(`❌ Invalid NBA_CRON_SCHEDULE: "${SCHEDULE}"`);
  process.exit(1);
}

async function runOnce() {
  const ts = new Date().toISOString();
  console.log(`\n⏰ [${ts}] Running NBA ingestion (season ${SEASON})...`);
  try {
    await ingestStandings(SEASON);
  } catch (err) {
    console.error(`❌ [${ts}] NBA ingestion run failed:`, err.message);
  }
}

// Keep the process alive; exit cleanly on Ctrl+C / service stop
async function shutdown() {
  console.log('\n👋 Stopping scheduler, closing DB pool...');
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async function start() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  RANKKS — NBA Ingestion Scheduler');
  console.log(`  Season   : ${SEASON}`);
  console.log(`  Schedule : ${SCHEDULE} (cron)`);
  console.log('═══════════════════════════════════════════════════');

  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  // Run immediately on startup, then on the cron schedule going forward
  await runOnce();
  cron.schedule(SCHEDULE, runOnce);
  console.log('\n🟢 Scheduler is live, waiting for next run\n');
})();
