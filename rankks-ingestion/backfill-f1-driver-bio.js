// backfill-f1-driver-bio.js
// Backfills entities.turned_pro_year, birth_date, country_id for F1 driver
// entities that are missing them (851 of 858 as of 2026-07-17).
//
// turned_pro_year — NOT from Wikidata. Computed purely from our own
// f1_session_results: MIN(season.year) across that driver's Race-session
// results. Verified against 5 known drivers (Alonso 2001, Hamilton 2007,
// Schumacher 1991, Verstappen 2015, Norris 2019 — all correct real debut
// years). Restricted to session_type='Race' specifically — a one-off FP1
// practice outing the year before a driver's real debut (common for junior
// F1 drivers, e.g. Verstappen's 2014 Toro Rosso FP1 appearances, Norris's
// 2017-2018 McLaren FP1 outings) would otherwise inflate this a year early.
//
// birth_date / country_id — from Wikidata, matched by NAME (occupation
// Q10841764 "Formula One driver"), not by a shared external ID. Unlike the
// NBA backfill (bref_player_id / nba_person_id are both Wikidata external-id
// properties), F1 driver entities only carry formula1.com's own internal
// driver code (external_ids.f1_driver, e.g. "MICSCH01") — not something
// Wikidata has any concept of. Matches against both the primary label and
// skos:altLabel (needed for e.g. "Kimi Antonelli" -> Wikidata's "Andrea
// Kimi Antonelli"). A name matching more than one distinct Wikidata item is
// skipped rather than guessed — same "only fill what's confidently known"
// rule as the NBA backfill, just with name-collision risk as the new
// failure mode instead of "no external id".
//
// Nationality: prefers P1532 (country represented in international
// competition) over P27 (citizenship) — same reasoning as the NBA backfill,
// confirmed necessary here too (e.g. Lando Norris carries both Belgian and
// British P27 citizenship, but P1532=GB is the unambiguous single value).
//
// Only fills columns that are currently NULL — never overwrites existing
// data — safe to re-run any time.
//
// Run with: node backfill-f1-driver-bio.js
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RANKKS-app-data-backfill/1.0 (mazzedd@gmail.com)';
const F1_DRIVER_OCCUPATION = 'wd:Q10841764'; // "Formula One driver"
const BATCH_SIZE = 100; // smaller than NBA's 250 — VALUES of quoted names is bulkier than VALUES of short ids

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
    // Wikidata's public endpoint occasionally 502s under load — transient,
    // not a query problem. Retry with backoff before giving up.
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

// Groups raw SPARQL bindings by the matched ?name literal. Tracks every
// distinct ?driver QID seen per name — more than one distinct QID for the
// same name means an unresolvable collision (two different real people
// with the same name), which callers must skip rather than guess between.
function mergeBindings(bindings) {
  const byName = new Map();
  for (const row of bindings) {
    const name = row.name.value;
    if (!byName.has(name)) {
      byName.set(name, { qids: new Set(), dob: null, sportIso2: null, citizenIso2: null });
    }
    const rec = byName.get(name);
    rec.qids.add(row.driver.value);
    if (row.dob && !rec.dob) rec.dob = row.dob.value.slice(0, 10);
    if (row.sportIso2 && !rec.sportIso2) rec.sportIso2 = row.sportIso2.value;
    if (row.citizenIso2 && !rec.citizenIso2) rec.citizenIso2 = row.citizenIso2.value;
  }
  return byName;
}

async function fetchByLabel(names, predicate) {
  const values = names.map(n => `"${escapeLabel(n)}"@en`).join(' ');
  const sparql = `
    SELECT ?name ?driver ?dob ?sportIso2 ?citizenIso2 WHERE {
      VALUES ?name { ${values} }
      ?driver ${predicate} ?name .
      ?driver wdt:P106 ${F1_DRIVER_OCCUPATION} .
      OPTIONAL { ?driver wdt:P569 ?dob . }
      OPTIONAL { ?driver wdt:P1532 ?sportCountry . ?sportCountry wdt:P297 ?sportIso2 . }
      OPTIONAL { ?driver wdt:P27 ?citizenCountry . ?citizenCountry wdt:P297 ?citizenIso2 . }
    }`;
  const bindings = await runSparql(sparql);
  return mergeBindings(bindings);
}

async function applyResults(drivers, resultsByName, countryByIso2) {
  let fullyFilled = 0, touched = 0, ambiguous = 0, noMatch = 0;
  for (const d of drivers) {
    const rec = resultsByName.get(d.canonical_name);
    if (!rec) { noMatch++; continue; }
    if (rec.qids.size > 1) {
      console.warn(`  ⚠ ambiguous: "${d.canonical_name}" matches ${rec.qids.size} distinct Wikidata items — skipped`);
      ambiguous++;
      continue;
    }

    const iso2 = rec.sportIso2 || rec.citizenIso2 || null;
    const countryId = iso2 ? countryByIso2.get(iso2) || null : null;

    const setBirthDate = d.birth_date === null && rec.dob ? rec.dob : null;
    const setCountryId = d.country_id === null && countryId ? countryId : null;

    if (!setBirthDate && !setCountryId) { noMatch++; continue; }

    await query(
      `UPDATE entities SET
         birth_date = COALESCE(birth_date, $1),
         country_id = COALESCE(country_id, $2),
         updated_at = NOW()
       WHERE id = $3`,
      [setBirthDate, setCountryId, d.id]
    );

    const stillMissing = (d.birth_date === null && !setBirthDate) || (d.country_id === null && !setCountryId);
    if (stillMissing) touched++; else fullyFilled++;
  }
  return { fullyFilled, touched, ambiguous, noMatch };
}

async function backfillTurnedProYear() {
  const result = await query(`
    UPDATE entities e SET
      turned_pro_year = sub.first_year,
      updated_at = NOW()
    FROM (
      SELECT sr.driver_entity_id AS id, MIN(s.year) AS first_year
      FROM f1_session_results sr
      JOIN f1_sessions se ON se.id = sr.session_id AND se.session_type = 'Race'
      JOIN f1_grands_prix gp ON gp.id = se.grand_prix_id
      JOIN f1_seasons s ON s.id = gp.f1_season_id
      GROUP BY sr.driver_entity_id
    ) sub
    WHERE e.id = sub.id AND e.entity_type = 'driver' AND e.turned_pro_year IS NULL
  `);
  console.log(`turned_pro_year: ${result.rowCount} drivers filled (from our own Race-session results, no Wikidata needed)`);
}

async function backfillBirthDateAndCountry(countryByIso2) {
  const drivers = await queryAll(`
    SELECT id, canonical_name, birth_date, country_id
    FROM entities
    WHERE entity_type = 'driver' AND (birth_date IS NULL OR country_id IS NULL)
  `);
  console.log(`\n${drivers.length} drivers missing birth_date/country_id — matching by name against Wikidata.\n`);

  let totals = { fullyFilled: 0, touched: 0, ambiguous: 0, noMatch: 0 };
  const stillMissing = [];

  for (const batch of chunk(drivers, BATCH_SIZE)) {
    const byLabel = await fetchByLabel(batch.map(d => d.canonical_name), 'rdfs:label');
    const r1 = await applyResults(batch, byLabel, countryByIso2);
    console.log(`  primary-label batch: ${r1.fullyFilled} filled, ${r1.touched} partial, ${r1.ambiguous} ambiguous, ${r1.noMatch} no match`);
    totals.fullyFilled += r1.fullyFilled; totals.touched += r1.touched;
    totals.ambiguous += r1.ambiguous; totals.noMatch += r1.noMatch;

    // Names that matched nothing via primary label — retry via altLabel
    // (catches cases like our "Kimi Antonelli" vs Wikidata's primary label
    // "Andrea Kimi Antonelli").
    const unmatched = batch.filter(d => !byLabel.has(d.canonical_name));
    if (unmatched.length) {
      await sleep(1000);
      const byAlt = await fetchByLabel(unmatched.map(d => d.canonical_name), 'skos:altLabel');
      const r2 = await applyResults(unmatched, byAlt, countryByIso2);
      console.log(`  alt-label retry:     ${r2.fullyFilled} filled, ${r2.touched} partial, ${r2.ambiguous} ambiguous, ${r2.noMatch} no match`);
      totals.fullyFilled += r2.fullyFilled; totals.touched += r2.touched;
      totals.ambiguous += r2.ambiguous; totals.noMatch += r2.noMatch;
      for (const d of unmatched) if (!byAlt.has(d.canonical_name)) stillMissing.push(d.canonical_name);
    }

    await sleep(1000);
  }

  console.log(`\nbirth_date/country_id done: ${totals.fullyFilled} fully filled, ${totals.touched} partially filled, ${totals.ambiguous} ambiguous (skipped), ${totals.noMatch} no Wikidata match.`);
  if (stillMissing.length) {
    console.log(`No Wikidata match at all (${stillMissing.length}) — likely pre-Wikidata-coverage era drivers or name-formatting mismatches:`);
    console.log('  ' + stillMissing.slice(0, 30).join(', ') + (stillMissing.length > 30 ? `, ... +${stillMissing.length - 30} more` : ''));
  }
}

async function main() {
  await backfillTurnedProYear();

  const countries = await queryAll(`SELECT id, iso2 FROM countries`);
  const countryByIso2 = new Map(countries.map(c => [c.iso2, c.id]));
  await backfillBirthDateAndCountry(countryByIso2);

  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
