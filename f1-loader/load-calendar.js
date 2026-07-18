// load-calendar.js
// Usage: node load-calendar.js <fromYear> [toYear]
//
// Reads ./../rankks-scrap/f1-calendar-raw/{year}/*.json (produced by
// scrape-calendar.js) and upserts f1_grands_prix keyed on
// (f1_season_id, slug) — NOT source_race_id, since a round that hasn't
// been raced yet has no results-archive id. This is what makes future GPs
// (date, round order, lap count) show up before formula1.com's results
// archive ever lists them.
//
// load.js (the results loader) targets the SAME (f1_season_id, slug) key
// for its own upsert, so once a round is actually raced, its row merges
// into this same placeholder rather than duplicating — see load.js's own
// upsert comment for the other half of that contract.

const fs = require('fs');
const path = require('path');
const { pool } = require('./lib/db');
const { DISPLAY_ORDER } = require('./lib/sessionType');

const RAW_DIR = path.join(__dirname, '..', 'rankks-scrap', 'f1-calendar-raw');

// The ld+json session names scrape-calendar.js captures ("Practice 1 -
// Belgian Grand Prix", "Sprint Qualifying - Chinese Grand Prix", ...)
// start with exactly the same canonical session_type strings load.js's
// classifyByLabel() produces from the results archive — confirmed against
// a real sprint-weekend page (China 2026). Longest/most-specific prefixes
// first so "Sprint Qualifying" doesn't get matched as "Sprint".
const SESSION_TYPES = Object.keys(DISPLAY_ORDER).sort((a, b) => b.length - a.length);
function classifySessionName(name) {
  if (!name) return null;
  return SESSION_TYPES.find(type => name.startsWith(type)) || null;
}

// Known slug mismatches between the calendar site (/en/racing/...) and the
// results archive (/en/results/...) — confirmed for Abu Dhabi, whose
// calendar URL uses the country name while the results archive (and every
// existing f1_grands_prix row) uses the city name. Add to this map if a
// future season introduces another mismatch.
const SLUG_ALIASES = {
  'united-arab-emirates': 'abu-dhabi',
};

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// Deterministic fallback matching the existing naming convention exactly
// (confirmed against live data: slug "barcelona-catalunya" -> name
// "Barcelona-Catalunya", "great-britain" -> "Great Britain"). Only used
// when no row exists yet at all — COALESCE in the upsert below keeps
// whatever real name a row already has.
function nameFromSlug(slug) {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
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

async function loadCalendarYear(year) {
  console.log(`\n=== calendar load ${year} ===`);
  const yearDir = path.join(RAW_DIR, String(year));
  const index = readJson(path.join(yearDir, 'calendar.json'));
  if (!index) { console.warn(`  no calendar.json for ${year}, skipping`); return; }

  const seasonId = await upsertSeason(year);
  let written = 0;

  for (const round of index) {
    const slug = SLUG_ALIASES[round.slug] || round.slug;
    const roundData = readJson(path.join(yearDir, `round-${round.slug}.json`));
    if (!roundData?.race_date) { console.warn(`  [${round.slug}] no race_date parsed, skipping`); continue; }

    const { rows: [gp] } = await pool.query(`
      INSERT INTO f1_grands_prix
        (f1_season_id, slug, name, circuit_country, event_date, round_order, is_sprint_weekend, scheduled_laps, source_race_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (f1_season_id, slug) DO UPDATE SET
        name              = COALESCE(f1_grands_prix.name, EXCLUDED.name),
        circuit_country   = COALESCE(f1_grands_prix.circuit_country, EXCLUDED.circuit_country),
        event_date        = EXCLUDED.event_date,
        round_order       = EXCLUDED.round_order,
        is_sprint_weekend = EXCLUDED.is_sprint_weekend OR f1_grands_prix.is_sprint_weekend,
        scheduled_laps    = EXCLUDED.scheduled_laps,
        updated_at        = now()
      RETURNING id
    `, [
      // source_race_id is NOT NULL (varchar(20)) and has no real value until
      // the round is actually raced — "cal-{round_order}" is a short
      // placeholder the results loader (load.js) overwrites with the true
      // formula1.com id once available. Not part of the DO UPDATE SET above
      // on purpose: never clobber a real id that's already there.
      seasonId, slug, nameFromSlug(slug), roundData.circuit_country || null,
      roundData.race_date, round.round_order, roundData.is_sprint_weekend, roundData.laps, `cal-${round.round_order}`,
    ]);

    // Session shells — no results, just enough for the frontend to have a
    // real session_id/date to anchor "Schedule"/tab rendering to before the
    // round is raced. ON CONFLICT DO NOTHING: never touch a session row
    // that already exists (real or otherwise), only fill in gaps.
    for (const s of (roundData.sessions || [])) {
      const sessionType = classifySessionName(s.name);
      if (!sessionType) continue; // unrecognized session name — skip rather than guess
      await pool.query(`
        INSERT INTO f1_sessions (grand_prix_id, session_type, display_order)
        VALUES ($1, $2, $3)
        ON CONFLICT (grand_prix_id, session_type) DO NOTHING
      `, [gp.id, sessionType, DISPLAY_ORDER[sessionType] || 99]);
    }

    written++;
  }

  console.log(`  done: calendar load ${year} (${written}/${index.length} rounds written)`);
}

async function main() {
  const [, , fromArg, toArg] = process.argv;
  if (!fromArg) { console.error('Usage: node load-calendar.js <fromYear> [toYear]'); process.exit(1); }
  const from = parseInt(fromArg, 10);
  const to = toArg ? parseInt(toArg, 10) : from;

  for (let year = from; year <= to; year++) {
    await loadCalendarYear(year);
  }
  console.log('\nAll done.');
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
