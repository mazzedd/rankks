// backfill-mma-fighter-bio.js
// Backfills entities.country_id, birth_date, height_cm, weight_kg for MMA
// 'fighter' entities via Wikidata. Name+occupation matching (same approach
// as backfill-tennis-player-bio.js) — checked 2026-08-17: Wikidata has no
// UFCStats.com or ufc-fr.com external-id property (searched, zero results),
// unlike NBA's bref_player_id/nba_person_id, so there's no exact-ID join
// available here the way backfill-nba-player-bio.js has.
//
// Wikidata properties used:
//   P106  = occupation, filtered to Q11607585 ("mixed martial arts fighter")
//   P569  = date of birth
//   P1532 = country for sport (preferred over citizenship — dual-citizen
//           fighters like Israel Adesanya (NZ+Nigeria) should resolve to
//           whichever country they actually compete for, same rationale as
//           backfill-nba-player-bio.js/backfill-tennis-player-bio.js)
//   P27   = country of citizenship (fallback when P1532 absent)
//   P2048 = height, P2067 = mass (weight) — both fully unpopulated for
//           every one of the 2725 fighter entities as of writing (not a
//           gap in Mohamed's original ask, but free to fill from the same
//           query pass, same convention as the NBA/tennis scripts)
//
// NOT attempted: death_date. MMA has no death-backfill script yet the way
// tennis/football/basketball/F1/MotoGP do (backfill-*-death.js) — that's a
// separate, not-yet-requested piece of work, left out here on purpose
// rather than silently bundled in.
//
// Ambiguity guard: skipped when a name matches more than one distinct
// Wikidata QID (exact-name collision — can't tell which one is "our"
// fighter). This is a real risk specific to MMA more than tennis: regional
// promotions (Bellator/ONE/Rizin/etc.) share the same P106 occupation, so a
// common name could plausibly collide with a non-UFC fighter. The
// ambiguity guard only catches same-name collisions, not a lone wrong
// match — accepted trade-off, consistent with this project's "visible gap
// over fabricated correction" convention (see ingest-ufc-rankings-history.js,
// ufc-fr-source.js's findOrCreateFighter for the same call made elsewhere).
//
// Only fills columns that are currently NULL — never overwrites existing
// data — so this is safe to re-run any time.
//
// Run with: node backfill-mma-fighter-bio.js [--limit=N]
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RANKKS-app-data-backfill/1.0 (mazzedd@gmail.com)';
const MMA_FIGHTER_OCCUPATION = 'wd:Q11607585'; // "mixed martial arts fighter"
const BATCH_SIZE = 100;

// Wikidata's P2048 (height) is NOT reliably stored in centimetres — some
// entries use metres instead (found live 2026-08-17: Amir Albazi's height
// claim is "1.65" with unit "metre", which a naive Math.round() would have
// written as height_cm=2). P2067 (mass) checked too — every sample came
// back in kilograms, but converted/guarded anyway rather than assumed.
// Unrecognized units are dropped (logged), never guessed at.
const METRE_QID = 'http://www.wikidata.org/entity/Q11573';
const CENTIMETRE_QID = 'http://www.wikidata.org/entity/Q174728';
const KILOGRAM_QID = 'http://www.wikidata.org/entity/Q11570';
const GRAM_QID = 'http://www.wikidata.org/entity/Q41803';

function normalizeHeightCm(rawVal, unitUri, who) {
  const n = Number(rawVal);
  if (unitUri === CENTIMETRE_QID) return Math.round(n);
  if (unitUri === METRE_QID) return Math.round(n * 100);
  console.warn(`    ? Unrecognized height unit for "${who}" (${unitUri}) — skipped, not guessed at`);
  return null;
}

function normalizeWeightKg(rawVal, unitUri, who) {
  const n = Number(rawVal);
  if (unitUri === KILOGRAM_QID) return Math.round(n);
  if (unitUri === GRAM_QID) return Math.round(n / 1000);
  console.warn(`    ? Unrecognized weight unit for "${who}" (${unitUri}) — skipped, not guessed at`);
  return null;
}

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

// Groups raw bindings into one record per fighter NAME (not per qid — a
// single name can resolve to multiple distinct Wikidata people, which is
// exactly the ambiguity applyResults() below has to detect and skip).
function mergeBindings(bindings) {
  const byName = new Map();
  for (const row of bindings) {
    const name = row.name.value;
    if (!byName.has(name)) byName.set(name, { qids: new Set(), dob: null, sportIso2: null, citizenIso2: null, heightCm: null, weightKg: null });
    const rec = byName.get(name);
    rec.qids.add(row.player.value);
    if (row.dob && !rec.dob) rec.dob = row.dob.value.slice(0, 10);
    if (row.sportIso2 && !rec.sportIso2) rec.sportIso2 = row.sportIso2.value;
    if (row.citizenIso2 && !rec.citizenIso2) rec.citizenIso2 = row.citizenIso2.value;
    if (row.heightVal && row.heightUnit && !rec.heightCm) rec.heightCm = normalizeHeightCm(row.heightVal.value, row.heightUnit.value, name);
    if (row.massVal && row.massUnit && !rec.weightKg) rec.weightKg = normalizeWeightKg(row.massVal.value, row.massUnit.value, name);
  }
  return byName;
}

async function fetchByLabel(names, predicate) {
  const values = names.map(n => `"${escapeLabel(n)}"@en`).join(' ');
  const sparql = `
    SELECT ?name ?player ?dob ?sportIso2 ?citizenIso2 ?heightVal ?heightUnit ?massVal ?massUnit WHERE {
      VALUES ?name { ${values} }
      ?player ${predicate} ?name .
      ?player wdt:P106 ${MMA_FIGHTER_OCCUPATION} .
      OPTIONAL { ?player wdt:P569 ?dob . }
      OPTIONAL { ?player wdt:P1532 ?sportCountry . ?sportCountry wdt:P297 ?sportIso2 . }
      OPTIONAL { ?player wdt:P27 ?citizenCountry . ?citizenCountry wdt:P297 ?citizenIso2 . }
      OPTIONAL { ?player p:P2048 ?hs . ?hs psv:P2048 ?hv . ?hv wikibase:quantityAmount ?heightVal . ?hv wikibase:quantityUnit ?heightUnit . }
      OPTIONAL { ?player p:P2067 ?ms . ?ms psv:P2067 ?mv . ?mv wikibase:quantityAmount ?massVal . ?mv wikibase:quantityUnit ?massUnit . }
    }`;
  return mergeBindings(await runSparql(sparql));
}

// Same "don't trust a lone name match blindly" guard as
// backfill-tennis-player-bio.js / backfill-tennis-death.js.
function isPlausibleBirth(dobStr) {
  const y = parseInt(dobStr.slice(0, 4), 10);
  return y >= 1950 && y <= new Date().getFullYear() - 16;
}

async function applyResults(fighters, resultsByName, countryByIso2) {
  let fullyFilled = 0, touched = 0, noMatch = 0, ambiguous = 0;
  for (const f of fighters) {
    const rec = resultsByName.get(f.canonical_name);
    if (!rec) { noMatch++; continue; }
    if (rec.qids.size > 1) { ambiguous++; continue; }

    const setBirthDate = f.birth_date === null && rec.dob && isPlausibleBirth(rec.dob) ? rec.dob : null;
    const iso2 = rec.sportIso2 || rec.citizenIso2 || null;
    const countryId = iso2 ? countryByIso2.get(iso2) || null : null;
    const setCountryId = f.country_id === null && countryId ? countryId : null;
    const setHeightCm = f.height_cm === null && rec.heightCm ? rec.heightCm : null;
    const setWeightKg = f.weight_kg === null && rec.weightKg ? rec.weightKg : null;

    if (!setBirthDate && !setCountryId && !setHeightCm && !setWeightKg) {
      noMatch++;
      continue;
    }

    await query(
      `UPDATE entities SET
         birth_date = COALESCE(birth_date, $1),
         country_id = COALESCE(country_id, $2),
         height_cm  = COALESCE(height_cm, $3),
         weight_kg  = COALESCE(weight_kg, $4),
         updated_at = NOW()
       WHERE id = $5`,
      [setBirthDate, setCountryId, setHeightCm, setWeightKg, f.id]
    );

    const stillMissing = (f.birth_date === null && !setBirthDate)
      || (f.country_id === null && !setCountryId)
      || (f.height_cm === null && !setHeightCm)
      || (f.weight_kg === null && !setWeightKg);
    if (stillMissing) touched++; else fullyFilled++;
  }
  return { fullyFilled, touched, noMatch, ambiguous };
}

async function main() {
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  const countries = await queryAll(`SELECT id, iso2 FROM countries`);
  const countryByIso2 = new Map(countries.map(c => [c.iso2, c.id]));

  const fighters = await queryAll(`
    SELECT id, canonical_name, birth_date, country_id, height_cm, weight_kg
    FROM entities
    WHERE entity_type = 'fighter'
      AND (birth_date IS NULL OR country_id IS NULL OR height_cm IS NULL OR weight_kg IS NULL)
    ${limit ? `LIMIT ${limit}` : ''}
  `);
  console.log(`${fighters.length} MMA fighters missing at least one bio field — querying Wikidata.\n`);

  let totals = { fullyFilled: 0, touched: 0, noMatch: 0, ambiguous: 0 };
  const batches = chunk(fighters, BATCH_SIZE);
  let batchNum = 0;

  for (const batch of batches) {
    batchNum++;
    const byLabel = await fetchByLabel(batch.map(f => f.canonical_name), 'rdfs:label');
    const r1 = await applyResults(batch, byLabel, countryByIso2);

    const unmatched = batch.filter(f => !byLabel.get(f.canonical_name));
    let r2 = { fullyFilled: 0, touched: 0, noMatch: 0, ambiguous: 0 };
    if (unmatched.length) {
      await sleep(1000);
      const byAlt = await fetchByLabel(unmatched.map(f => f.canonical_name), 'skos:altLabel');
      r2 = await applyResults(unmatched, byAlt, countryByIso2);
    }

    for (const k of Object.keys(totals)) totals[k] += r1[k] + r2[k];
    console.log(`  batch ${batchNum}/${batches.length}: ${r1.fullyFilled + r2.fullyFilled} fully filled, ${r1.touched + r2.touched} partial, ${r1.ambiguous + r2.ambiguous} ambiguous, ${r1.noMatch + r2.noMatch} no match`);
    await sleep(1000);
  }

  console.log(`\nDone: ${totals.fullyFilled} fully complete, ${totals.touched} partially improved, ${totals.ambiguous} ambiguous (skipped — exact-name collision), ${totals.noMatch} no Wikidata match.`);
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
