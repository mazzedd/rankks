// check-new-deaths.js
// Weekly maintenance job — checks Wikidata for any athlete across every
// sport who has since died but isn't reflected in our entities.death_date
// yet. Runs each sport-specific script in sequence (same "wrap several
// steps, one entry point" pattern as ingest-f1.js):
//   1. backfill-f1-driver-death.js   (name+occupation match)
//   2. backfill-basketball-death.js  (ID match — bref_player_id/nba_person_id)
//   3. backfill-football-death.js    (name+occupation match)
//   4. backfill-tennis-death.js      (name+occupation match)
//
// All four scripts are idempotent and only ever fill death_date where
// it's currently NULL (never overwrite), so running this weekly is safe
// — most weeks it'll find nothing new. Each script has its own ambiguous-
// match and implausible-match (age-at-death vs our stored birth_date)
// safety checks; a skip there just means "no confident match found",
// never a wrong write.
//
// Run with: node check-new-deaths.js
// Scheduled: registered as a weekly cron in rankks-api/src/scheduler.js
// (separate from the per-competition provider_coverage system, since
// this is a cross-sport maintenance job, not a data provider ingestion).
const { execFile } = require('child_process');
const path = require('path');

const SCRIPTS = [
  'backfill-f1-driver-death.js',
  'backfill-basketball-death.js',
  'backfill-football-death.js',
  'backfill-tennis-death.js',
];

function runScript(scriptName) {
  return new Promise((resolve) => {
    const fullPath = path.join(__dirname, scriptName);
    execFile('node', [fullPath], { cwd: __dirname, timeout: 30 * 60 * 1000 }, (error, stdout, stderr) => {
      if (error) {
        const reason = error.killed ? 'timed out' : `exit code ${error.code}`;
        resolve({ script: scriptName, status: 'error', message: `${reason}: ${(stderr || stdout || error.message).slice(0, 500)}` });
        return;
      }
      const lastLines = stdout.trim().split('\n').filter(Boolean).slice(-2).join(' | ');
      resolve({ script: scriptName, status: 'ok', message: lastLines });
    });
  });
}

async function main() {
  console.log(`[check-new-deaths] starting weekly death-date check — ${new Date().toISOString()}\n`);
  const results = [];
  for (const script of SCRIPTS) {
    console.log(`--- ${script} ---`);
    const result = await runScript(script);
    console.log(result.status === 'ok' ? result.message : `⚠️ ${result.message}`);
    console.log('');
    results.push(result);
  }

  const failed = results.filter(r => r.status === 'error');
  console.log('=== summary ===');
  for (const r of results) console.log(`${r.status === 'ok' ? '✅' : '⚠️'} ${r.script}: ${r.message}`);

  if (failed.length) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
