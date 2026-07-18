// backfill-f1-driver-death.js
// Backfills entities.death_date for F1 driver entities that have died,
// via Wikidata P570 (date of death). Companion to
// backfill-f1-driver-bio.js (birth_date/country_id/turned_pro_year) —
// kept as a separate script rather than folding into that one since it's
// a distinct, independently-rerunnable field with its own match logic,
// not part of that script's original scope.
//
// Same matching approach as backfill-f1-driver-bio.js: match by name
// (primary label, then skos:altLabel fallback) against Wikidata's
// "Formula One driver" occupation (Q10841764), skip on ambiguous
// (>1 distinct QID) name collisions. Only fills entities.death_date
// where it's currently NULL — safe to re-run any time.
//
// Run with: node backfill-f1-driver-death.js
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RANKKS-app-data-backfill/1.0 (mazzedd@gmail.com)';
const F1_DRIVER_OCCUPATION = 'wd:Q10841764';
const BATCH_SIZE = 100;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runSparql(sparql, attempt = 1) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ query: sparql }),
  });
  if (!res.ok) {
    if (attempt < 4) {
      const backoff = 2000 * attempt;
      console.warn(`  SPARQL ${res.status}, retry ${attempt}/3 in ${backoff}ms`);
      await sleep(backoff);
      return runSparql(sparql, attempt + 1);
    }
    throw new Error(`SPARQL request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()).results.bindings;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function escapeLabel(name) {
  return name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function mergeBindings(bindings) {
  const byName = new Map();
  for (const row of bindings) {
    const name = row.name.value;
    if (!byName.has(name)) byName.set(name, { qids: new Set(), dod: null });
    const rec = byName.get(name);
    rec.qids.add(row.driver.value);
    if (row.dod && !rec.dod) rec.dod = row.dod.value.slice(0, 10);
  }
  return byName;
}

// P570 is OPTIONAL — deliberately. If it were a mandatory triple, a
// same-named driver who is still alive (no P570 at all) would simply
// never appear in the result set, so qids.size would never reflect the
// real collision risk — this was a real bug (found via a data audit:
// "Mark Wilson" born 1984 got assigned a death date of 1982, because our
// living Mark Wilson matched a DIFFERENT, deceased Mark Wilson who
// happened to be the only same-named person WITH a recorded death).
// Fetching every name+occupation match regardless of death status, and
// only trusting a death date when exactly one such match exists overall,
// is what actually makes the ambiguity check meaningful.
async function fetchByLabel(names, predicate) {
  const values = names.map(n => `"${escapeLabel(n)}"@en`).join(' ');
  const sparql = `
    SELECT ?name ?driver ?dod WHERE {
      VALUES ?name { ${values} }
      ?driver ${predicate} ?name .
      ?driver wdt:P106 ${F1_DRIVER_OCCUPATION} .
      OPTIONAL { ?driver wdt:P570 ?dod . }
    }`;
  const bindings = await runSparql(sparql);
  return mergeBindings(bindings);
}

// Last line of defense against a lone Wikidata name+occupation match
// being a coincidentally-same-named DIFFERENT real person — see
// backfill-football-death.js's identical helper for the real case that
// motivated this. Only applied when we have our own birth_date to check
// against; drivers still missing birth_date fall through unchecked, same
// as before (no signal to catch a bad match with, but also no worse than
// the pre-existing behavior for those).
function isPlausibleDeath(birthDate, deathDateStr) {
  if (!birthDate) return true;
  const birth = new Date(birthDate);
  const death = new Date(deathDateStr);
  if (isNaN(birth) || isNaN(death)) return true;
  const ageAtDeath = (death - birth) / (365.25 * 24 * 60 * 60 * 1000);
  return ageAtDeath >= 14 && ageAtDeath <= 110;
}

async function applyResults(drivers, resultsByName) {
  let filled = 0, ambiguous = 0, noMatch = 0, implausible = 0;
  for (const d of drivers) {
    const rec = resultsByName.get(d.canonical_name);
    if (!rec || !rec.dod) { noMatch++; continue; }
    if (rec.qids.size > 1) {
      console.warn(`  ⚠ ambiguous: "${d.canonical_name}" matches ${rec.qids.size} distinct Wikidata items — skipped`);
      ambiguous++;
      continue;
    }
    if (!isPlausibleDeath(d.birth_date, rec.dod)) {
      console.warn(`  ⚠ implausible: "${d.canonical_name}" birth=${d.birth_date} matched death=${rec.dod} — skipped`);
      implausible++;
      continue;
    }
    await query(
      `UPDATE entities SET death_date = $1, updated_at = NOW() WHERE id = $2 AND death_date IS NULL`,
      [rec.dod, d.id]
    );
    filled++;
  }
  return { filled, ambiguous, noMatch, implausible };
}

async function main() {
  const drivers = await queryAll(`
    SELECT id, canonical_name, birth_date FROM entities
    WHERE entity_type = 'driver' AND death_date IS NULL
  `);
  console.log(`${drivers.length} drivers missing death_date — querying Wikidata for known deaths (P570).\n`);

  let totals = { filled: 0, ambiguous: 0, noMatch: 0, implausible: 0 };
  const stillMissing = [];

  for (const batch of chunk(drivers, BATCH_SIZE)) {
    const byLabel = await fetchByLabel(batch.map(d => d.canonical_name), 'rdfs:label');
    const r1 = await applyResults(batch, byLabel);
    console.log(`  primary-label batch: ${r1.filled} filled, ${r1.ambiguous} ambiguous, ${r1.implausible} implausible, ${r1.noMatch} no match`);
    totals.filled += r1.filled; totals.ambiguous += r1.ambiguous; totals.noMatch += r1.noMatch; totals.implausible += r1.implausible;

    const unmatched = batch.filter(d => !byLabel.get(d.canonical_name)?.dod);
    if (unmatched.length) {
      await sleep(1000);
      const byAlt = await fetchByLabel(unmatched.map(d => d.canonical_name), 'skos:altLabel');
      const r2 = await applyResults(unmatched, byAlt);
      console.log(`  alt-label retry:     ${r2.filled} filled, ${r2.ambiguous} ambiguous, ${r2.implausible} implausible, ${r2.noMatch} no match`);
      totals.filled += r2.filled; totals.ambiguous += r2.ambiguous; totals.noMatch += r2.noMatch; totals.implausible += r2.implausible;
      for (const d of unmatched) if (!byAlt.get(d.canonical_name)?.dod) stillMissing.push(d.canonical_name);
    }

    await sleep(1000);
  }

  console.log(`\ndeath_date done: ${totals.filled} filled, ${totals.ambiguous} ambiguous (skipped).`);
  console.log(`Note: most of the remaining ${stillMissing.length} are simply still alive (no Wikidata P570) — this is expected, not a gap.`);

  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
