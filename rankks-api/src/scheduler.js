// =============================================================
// RANKKS — Ingestion Scheduler
//
// Always-on cron loop, started once when rankks-api boots.
// Every minute, checks ingestion_schedules for jobs that are due
// AND allowed to run (provider enabled, coverage enabled, schedule
// enabled — all three must be true), resolves the competition's
// current season, and spawns the ingestion script as a subprocess
// exactly as you'd run it by hand from the CLI.
//
// Wire-up (in rankks-api/src/index.js, after the DB connection is ready):
//   const { startScheduler } = require('./scheduler');
//   startScheduler();
// =============================================================

const cron = require('node-cron');
const { execFile } = require('child_process');
const path = require('path');
const db = require('./db');

// Folder where ingestion scripts live, relative to this file's location.
// Adjust if your actual folder structure differs —
// e.g. if scheduler.js lives in rankks-api/src/ and scripts live in
// a sibling rankks-ingestion/ folder at the project root.
const INGESTION_DIR = path.resolve(__dirname, '../../rankks-ingestion');

// How often the scheduler wakes up to check for due jobs.
// Once a minute is granular enough for daily/hourly schedules without
// meaningfully taxing the DB or API process.
const TICK_CRON = '* * * * *';

// Hard safety cap — a single ingestion run should never legitimately
// take this long. If it does, we kill it rather than let a hung
// subprocess block that job's row from ever being marked failed.
const SCRIPT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

let running = false; // re-entrancy guard — prevents overlapping ticks if a tick runs long
let tickCount = 0;
const HEARTBEAT_EVERY_N_TICKS = 60; // ticks run every minute, so 60 ticks ≈ once an hour

async function getDueJobs() {
  const { rows } = await db.query(`
    SELECT
      sch.id            AS schedule_id,
      sch.data_type,
      sch.frequency_minutes,
      pc.id             AS coverage_id,
      pc.competition_id,
      pc.script_path,
      p.display_name    AS provider_display_name
    FROM ingestion_schedules sch
    JOIN provider_coverage pc ON pc.id = sch.coverage_id
    JOIN providers p          ON p.id = pc.provider_id
    WHERE sch.enabled = true
      AND pc.enabled  = true
      AND p.enabled   = true
      AND sch.next_run_at <= NOW()
  `);
  return rows;
}

async function getCurrentSeasonYear(competitionId) {
  const { rows } = await db.query(
    `SELECT year FROM seasons WHERE competition_id = $1 AND status = 'current' LIMIT 1`,
    [competitionId]
  );
  if (rows.length) return rows[0].year;

  const { rows: anyRows } = await db.query(
    `SELECT 1 FROM seasons WHERE competition_id = $1 LIMIT 1`,
    [competitionId]
  );
  if (anyRows.length === 0) return new Date().getFullYear();

  return null;
}

function runScript(scriptPath, dataType, year) {
  return new Promise((resolve) => {
    const fullPath = path.join(INGESTION_DIR, scriptPath);
    execFile(
      'node',
      [fullPath, dataType, String(year)],
      { cwd: INGESTION_DIR, timeout: SCRIPT_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          // error.killed is true if we hit SCRIPT_TIMEOUT_MS
          const reason = error.killed ? 'timed out' : `exit code ${error.code}`;
          resolve({
            status: 'error',
            message: `${reason}: ${(stderr || stdout || error.message).slice(0, 500)}`,
          });
          return;
        }
        // Scripts print clear markers (✅ / ⚠️ / ❌) — surface a short
        // tail of stdout as the message so the admin page shows something
        // useful without needing full log storage.
        const hasWarning = /⚠️/.test(stdout);
        resolve({
          status: hasWarning ? 'partial' : 'success',
          message: stdout.trim().split('\n').slice(-3).join(' | ').slice(0, 500),
        });
      }
    );
  });
}

async function markResult(scheduleId, frequencyMinutes, status, message) {
  await db.query(
    `UPDATE ingestion_schedules SET
       last_run_at      = NOW(),
       last_run_status  = $1,
       last_run_message = $2,
       next_run_at      = NOW() + ($3 || ' minutes')::interval,
       updated_at       = NOW()
     WHERE id = $4`,
    [status, message, frequencyMinutes, scheduleId]
  );
}

async function processJob(job) {
  if (!job.script_path) {
    await markResult(job.schedule_id, job.frequency_minutes, 'error', 'no script_path configured for this competition');
    return;
  }

  const year = await getCurrentSeasonYear(job.competition_id);
  if (!year) {
    await markResult(job.schedule_id, job.frequency_minutes, 'partial', 'no current season for this competition — skipped');
    return;
  }

  console.log(`[scheduler] running ${job.script_path} ${job.data_type} ${year} (${job.provider_display_name})`);
  const result = await runScript(job.script_path, job.data_type, year);
  await markResult(job.schedule_id, job.frequency_minutes, result.status, result.message);
  console.log(`[scheduler] ${job.script_path} ${job.data_type} ${year} -> ${result.status}`);
}

async function getJobById(scheduleId) {
  const { rows } = await db.query(`
    SELECT
      sch.id            AS schedule_id,
      sch.data_type,
      sch.frequency_minutes,
      pc.id             AS coverage_id,
      pc.competition_id,
      pc.script_path,
      p.display_name    AS provider_display_name
    FROM ingestion_schedules sch
    JOIN provider_coverage pc ON pc.id = sch.coverage_id
    JOIN providers p          ON p.id = pc.provider_id
    WHERE sch.id = $1
  `, [scheduleId]);
  return rows[0] || null;
}

// Manual "Run now" — runs the exact same processJob path a due tick would,
// just on demand instead of waiting for next_run_at. Updates last_run_*
// and next_run_at identically to an automatic run.
async function triggerJob(scheduleId) {
  const job = await getJobById(scheduleId);
  if (!job) return null;
  await processJob(job);
  const { rows } = await db.query(
    `SELECT last_run_at, last_run_status, last_run_message, next_run_at FROM ingestion_schedules WHERE id = $1`,
    [scheduleId]
  );
  return rows[0] || null;
}

async function tick() {
  if (running) {
    console.log('[scheduler] previous tick still running, skipping this tick');
    return;
  }
  running = true;
  tickCount++;
  try {
    const jobs = await getDueJobs();
    if (jobs.length === 0) {
      // Quiet heartbeat — confirms the scheduler is alive and ticking
      // without printing on every single "nothing to do" minute.
      if (tickCount % HEARTBEAT_EVERY_N_TICKS === 0) {
        console.log(`[scheduler] heartbeat — alive, ${tickCount} ticks so far, nothing due right now`);
      }
      return;
    }
    console.log(`[scheduler] ${jobs.length} job(s) due`);
    // Sequential, not parallel — these all shell out to the same Ligue 1
    // API-Sports key/quota today, so running them one at a time avoids
    // burning quota faster than necessary or hammering one provider's
    // rate limit with simultaneous requests. Revisit if/when providers
    // and quotas are independent enough that parallelizing is safe.
    for (const job of jobs) {
      try {
        await processJob(job);
      } catch (err) {
        console.error(`[scheduler] unexpected error processing job ${job.schedule_id}:`, err.message);
        await markResult(job.schedule_id, job.frequency_minutes, 'error', err.message.slice(0, 500));
      }
    }
  } catch (err) {
    console.error('[scheduler] tick failed:', err.message);
  } finally {
    running = false;
  }
}

// Weekly "check for new deaths" job — cross-sport (F1/basketball/football/
// tennis), so it doesn't fit the provider_coverage system above (that
// table is scoped to one competition + one current season year per row,
// and runScript() always calls `node script dataType year`; this job
// takes no arguments and isn't tied to any single competition). Kept as
// its own independent cron registration instead of a fake coverage row.
// Sunday 3am — low-traffic time, and there's no urgency (a death getting
// reflected a few hours late is fine).
const DEATH_CHECK_CRON = '0 3 * * 0';
const DEATH_CHECK_SCRIPT = 'check-new-deaths.js';
const DEATH_CHECK_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour — football alone can take ~15-20 min

function runDeathCheck() {
  const fullPath = path.join(INGESTION_DIR, DEATH_CHECK_SCRIPT);
  console.log(`[scheduler] running weekly death check: ${DEATH_CHECK_SCRIPT}`);
  execFile('node', [fullPath], { cwd: INGESTION_DIR, timeout: DEATH_CHECK_TIMEOUT_MS }, (error, stdout, stderr) => {
    if (error) {
      const reason = error.killed ? 'timed out' : `exit code ${error.code}`;
      console.error(`[scheduler] death check failed (${reason}):`, (stderr || stdout || error.message).slice(0, 1000));
      return;
    }
    console.log(`[scheduler] death check complete:\n${stdout.trim().split('\n').slice(-10).join('\n')}`);
  });
}

function startScheduler() {
  console.log(`[scheduler] starting, checking every minute. Ingestion dir: ${INGESTION_DIR}`);
  cron.schedule(TICK_CRON, tick);
  cron.schedule(DEATH_CHECK_CRON, runDeathCheck);
  console.log(`[scheduler] weekly death check scheduled (${DEATH_CHECK_CRON})`);
}

module.exports = { startScheduler, tick, triggerJob, runDeathCheck };