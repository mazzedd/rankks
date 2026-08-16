// backfill-motogp-rider-death.js
// Backfills entities.death_date for MotoGP rider entities.
//
// Unlike backfill-f1-driver-bio.js (which needed birth_date AND country
// from Wikidata, since formula1.com doesn't expose either per-driver), the
// MotoGP source API (api.pulselive.motogp.com) already gives birth_date and
// country directly — confirmed and loaded in ingest-motogp.js. Wikidata is
// only needed here for death_date, which the source has NO field for at
// all (confirmed against Harold Daniell, raced 1949-1950, returning
// years_old:116 — the API computes live age with zero awareness he's
// deceased. See onboarding-motogp.md Section 5).
//
// Matched by NAME (occupation Q3014296 "motorcycle racer", confirmed via
// SPARQL against our own Umberto Masetti entity, not guessed) — same
// collision risk and same "skip rather than guess" rule as the F1 backfill:
// a name matching more than one distinct Wikidata item is left alone.
//
// Only fills death_date where currently NULL — never overwrites — safe to
// re-run any time.
//
// Run with: node backfill-motogp-rider-death.js
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RANKKS-app-data-backfill/1.0 (mazzedd@gmail.com)';
const MOTORCYCLE_RACER_OCCUPATION = 'wd:Q3014296';
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
  const json = await res.json();
  return json.results.bindings;
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
    rec.qids.add(row.person.value);
    if (row.dod && !rec.dod) rec.dod = row.dod.value.slice(0, 10);
  }
  return byName;
}

async function fetchByLabel(names, predicate) {
  const values = names.map(n => `"${escapeLabel(n)}"@en`).join(' ');
  const sparql = `
    SELECT ?name ?person ?dod WHERE {
      VALUES ?name { ${values} }
      ?person ${predicate} ?name .
      ?person wdt:P106 ${MOTORCYCLE_RACER_OCCUPATION} .
      ?person wdt:P570 ?dod .
    }`;
  const bindings = await runSparql(sparql);
  return mergeBindings(bindings);
}

async function applyResults(riders, resultsByName) {
  let filled = 0, ambiguous = 0, noMatch = 0, rejected = 0;
  for (const r of riders) {
    const rec = resultsByName.get(r.canonical_name);
    if (!rec) { noMatch++; continue; }
    if (rec.qids.size > 1) {
      console.warn(`  ⚠ ambiguous: "${r.canonical_name}" matches ${rec.qids.size} distinct Wikidata items — skipped`);
      ambiguous++;
      continue;
    }
    if (!rec.dod) { noMatch++; continue; }

    // Chronological sanity check — occupation-only filtering isn't always
    // enough to avoid a wrong match on a common name (confirmed the hard
    // way: a MotoGP rider named "Pedro Rodriguez", born 1994 per our own
    // source data, got matched to the famous 1940-1971 F1/sports-car racer
    // of the same name, who apparently also carries a "motorcycle racer"
    // occupation tag on Wikidata — a single, unambiguous QID match that
    // was still the wrong person). Cheap, high-confidence guard: reject
    // any match whose death date is before the rider's own already-known
    // birth date, since that's chronologically impossible.
    if (r.birth_date && new Date(rec.dod) < new Date(r.birth_date)) {
      console.warn(`  ⚠ rejected: "${r.canonical_name}" Wikidata death date ${rec.dod} is before our known birth date ${r.birth_date} — wrong-person match, skipped`);
      rejected++;
      continue;
    }

    await query(`UPDATE entities SET death_date = $1, updated_at = NOW() WHERE id = $2 AND death_date IS NULL`, [rec.dod, r.id]);
    filled++;
  }
  return { filled, ambiguous, noMatch, rejected };
}

async function main() {
  const riders = await queryAll(`
    SELECT id, canonical_name, birth_date FROM entities
    WHERE external_ids ? 'motogp_rider' AND death_date IS NULL
  `);
  console.log(`${riders.length} MotoGP riders missing death_date — matching by name against Wikidata (occupation: motorcycle racer).\n`);

  let totals = { filled: 0, ambiguous: 0, noMatch: 0, rejected: 0 };
  const stillMissing = [];

  for (const batch of chunk(riders, BATCH_SIZE)) {
    const byLabel = await fetchByLabel(batch.map(r => r.canonical_name), 'rdfs:label');
    const r1 = await applyResults(batch, byLabel);
    console.log(`  primary-label batch: ${r1.filled} filled, ${r1.ambiguous} ambiguous, ${r1.rejected} rejected (chronology), ${r1.noMatch} no match`);
    totals.filled += r1.filled; totals.ambiguous += r1.ambiguous; totals.noMatch += r1.noMatch; totals.rejected += r1.rejected;

    const unmatched = batch.filter(r => !byLabel.has(r.canonical_name));
    if (unmatched.length) {
      await sleep(1000);
      const byAlt = await fetchByLabel(unmatched.map(r => r.canonical_name), 'skos:altLabel');
      const r2 = await applyResults(unmatched, byAlt);
      console.log(`  alt-label retry:     ${r2.filled} filled, ${r2.ambiguous} ambiguous, ${r2.rejected} rejected (chronology), ${r2.noMatch} no match`);
      totals.filled += r2.filled; totals.ambiguous += r2.ambiguous; totals.noMatch += r2.noMatch; totals.rejected += r2.rejected;
      for (const r of unmatched) if (!byAlt.has(r.canonical_name)) stillMissing.push(r.canonical_name);
    }

    await sleep(1000);
  }

  console.log(`\ndeath_date done: ${totals.filled} filled, ${totals.ambiguous} ambiguous (skipped), ${totals.rejected} rejected on chronology (skipped), ${totals.noMatch} no Wikidata match.`);
  console.log(`(no match includes riders who are simply still alive — most of the ~2,540 total, this backfill only ever fills a minority)`);
  if (stillMissing.length) {
    console.log(`\nNo match at all (${stillMissing.length}), sample:`);
    console.log('  ' + stillMissing.slice(0, 30).join(', ') + (stillMissing.length > 30 ? `, ... +${stillMissing.length - 30} more` : ''));
  }

  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
