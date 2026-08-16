// backfill-tennis-player-bio.js
// Backfills entities.birth_date, death_date, country_id, height_cm, weight_kg,
// turned_pro_year, and sport_attributes.hand for tennis 'player' entities,
// via Wikidata. Same name+occupation matching approach as
// backfill-tennis-death.js (tennis has no reliable external-id property on
// Wikidata the way NBA's bref_player_id/nba_person_id do, so name matching
// scoped to occupation=tennis player, Q10833314, is the best available
// signal) - extended here to pull every bio field in one query pass instead
// of death_date alone.
//
// Wikidata properties used:
//   P569  = date of birth
//   P570  = date of death
//   P1532 = country for sport (preferred over citizenship - dual citizens
//           like players who switched federations have one meaningful
//           "represents" value; same rationale as backfill-nba-player-bio.js)
//   P27   = country of citizenship (fallback when P1532 absent)
//   P2048 = height
//   P2067 = mass (weight)
//   P2031 = work period (start) - used as "turned pro" year for athletes,
//           same convention Wikidata uses across sports bios
//   P552  = handedness (right/left-handed) - "plays" side, stored into
//           sport_attributes.hand (R/L), NOT a dedicated column (matches
//           the ingestion scripts' existing convention)
//
// NOT attempted: one-handed vs two-handed backhand. No reliable source
// exists for this - it isn't in the TML/Sackmann match CSVs (checked: no
// such column) and Wikidata has no property for it. Would need a
// dedicated tennis stats provider (e.g. a scrape of ATP/WTA player
// profile pages), out of scope for a Wikidata-based backfill.
//
// Only fills columns that are currently NULL - never overwrites existing
// data - so this is safe to re-run any time.
//
// Run with: node backfill-tennis-player-bio.js [--limit=N]
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RANKKS-app-data-backfill/1.0 (mazzedd@gmail.com)';
const TENNIS_PLAYER_OCCUPATION = 'wd:Q10833314'; // "tennis player"
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

const HANDEDNESS_QID = { 'http://www.wikidata.org/entity/Q1315837': 'R', 'http://www.wikidata.org/entity/Q212659': 'L' };

// Groups raw bindings into one record per player NAME (not per qid - a
// single name can resolve to multiple distinct Wikidata people, which is
// exactly the ambiguity applyResults() below has to detect and skip).
function mergeBindings(bindings) {
  const byName = new Map();
  for (const row of bindings) {
    const name = row.name.value;
    if (!byName.has(name)) byName.set(name, { qids: new Set(), dob: null, dod: null, sportIso2: null, citizenIso2: null, heightCm: null, weightKg: null, turnedPro: null, hand: null });
    const rec = byName.get(name);
    rec.qids.add(row.player.value);
    if (row.dob && !rec.dob) rec.dob = row.dob.value.slice(0, 10);
    if (row.dod && !rec.dod) rec.dod = row.dod.value.slice(0, 10);
    if (row.sportIso2 && !rec.sportIso2) rec.sportIso2 = row.sportIso2.value;
    if (row.citizenIso2 && !rec.citizenIso2) rec.citizenIso2 = row.citizenIso2.value;
    if (row.heightVal && !rec.heightCm) rec.heightCm = Math.round(Number(row.heightVal.value));
    if (row.massVal && !rec.weightKg) rec.weightKg = Math.round(Number(row.massVal.value));
    if (row.workStart && !rec.turnedPro) rec.turnedPro = parseInt(row.workStart.value.slice(0, 4), 10);
    if (row.handQid && !rec.hand) rec.hand = HANDEDNESS_QID[row.handQid.value] || null;
  }
  return byName;
}

async function fetchByLabel(names, predicate) {
  const values = names.map(n => `"${escapeLabel(n)}"@en`).join(' ');
  const sparql = `
    SELECT ?name ?player ?dob ?dod ?sportIso2 ?citizenIso2 ?heightVal ?massVal ?workStart ?handQid WHERE {
      VALUES ?name { ${values} }
      ?player ${predicate} ?name .
      ?player wdt:P106 ${TENNIS_PLAYER_OCCUPATION} .
      OPTIONAL { ?player wdt:P569 ?dob . }
      OPTIONAL { ?player wdt:P570 ?dod . }
      OPTIONAL { ?player wdt:P1532 ?sportCountry . ?sportCountry wdt:P297 ?sportIso2 . }
      OPTIONAL { ?player wdt:P27 ?citizenCountry . ?citizenCountry wdt:P297 ?citizenIso2 . }
      OPTIONAL { ?player p:P2048 ?hs . ?hs psv:P2048 ?hv . ?hv wikibase:quantityAmount ?heightVal . }
      OPTIONAL { ?player p:P2067 ?ms . ?ms psv:P2067 ?mv . ?mv wikibase:quantityAmount ?massVal . }
      OPTIONAL { ?player wdt:P2031 ?workStart . }
      OPTIONAL { ?player wdt:P552 ?handQid . }
    }`;
  return mergeBindings(await runSparql(sparql));
}

// Same "don't trust a lone name match blindly" guard as backfill-tennis-death.js.
function isPlausibleBirth(dobStr) {
  const y = parseInt(dobStr.slice(0, 4), 10);
  return y >= 1850 && y <= new Date().getFullYear() - 10;
}
function isPlausibleDeath(dobStr, dodStr) {
  const birth = new Date(dobStr), death = new Date(dodStr);
  if (isNaN(birth) || isNaN(death)) return false;
  const age = (death - birth) / (365.25 * 24 * 60 * 60 * 1000);
  return age >= 14 && age <= 110;
}
function isPlausibleTurnedPro(dobStr, year) {
  if (!dobStr) return year >= 1900 && year <= new Date().getFullYear();
  const birthYear = parseInt(dobStr.slice(0, 4), 10);
  const age = year - birthYear;
  return age >= 12 && age <= 45;
}

async function applyResults(players, resultsByName, countryByIso2) {
  let fullyFilled = 0, touched = 0, noMatch = 0, ambiguous = 0;
  for (const p of players) {
    const rec = resultsByName.get(p.canonical_name);
    if (!rec) { noMatch++; continue; }
    if (rec.qids.size > 1) { ambiguous++; continue; }

    // p.birth_date comes back from pg as a Date object when already set in
    // the DB, but rec.dob (from Wikidata) is a 'YYYY-MM-DD' string - the
    // helpers below all expect a string, so normalize here once rather
    // than at each call site (crashed on dobStr.slice() mid-run otherwise).
    const effectiveDob = p.birth_date
      ? (p.birth_date instanceof Date ? p.birth_date.toISOString().slice(0, 10) : p.birth_date)
      : (rec.dob && isPlausibleBirth(rec.dob) ? rec.dob : null);

    const setBirthDate = p.birth_date === null && rec.dob && isPlausibleBirth(rec.dob) ? rec.dob : null;
    const setDeathDate = p.death_date === null && rec.dod && effectiveDob && isPlausibleDeath(effectiveDob, rec.dod) ? rec.dod : null;
    const iso2 = rec.sportIso2 || rec.citizenIso2 || null;
    const countryId = iso2 ? countryByIso2.get(iso2) || null : null;
    const setCountryId = p.country_id === null && countryId ? countryId : null;
    const setHeightCm = p.height_cm === null && rec.heightCm ? rec.heightCm : null;
    const setWeightKg = p.weight_kg === null && rec.weightKg ? rec.weightKg : null;
    const setTurnedPro = p.turned_pro_year === null && rec.turnedPro && isPlausibleTurnedPro(effectiveDob, rec.turnedPro) ? rec.turnedPro : null;
    const setHand = !p.has_hand && rec.hand ? rec.hand : null;

    if (!setBirthDate && !setDeathDate && !setCountryId && !setHeightCm && !setWeightKg && !setTurnedPro && !setHand) {
      noMatch++;
      continue;
    }

    await query(
      `UPDATE entities SET
         birth_date       = COALESCE(birth_date, $1),
         death_date        = COALESCE(death_date, $2),
         country_id        = COALESCE(country_id, $3),
         height_cm          = COALESCE(height_cm, $4),
         weight_kg          = COALESCE(weight_kg, $5),
         turned_pro_year    = COALESCE(turned_pro_year, $6),
         sport_attributes   = CASE WHEN $7::text IS NOT NULL THEN sport_attributes || jsonb_build_object('hand', $7::text) ELSE sport_attributes END,
         updated_at         = NOW()
       WHERE id = $8`,
      [setBirthDate, setDeathDate, setCountryId, setHeightCm, setWeightKg, setTurnedPro, setHand, p.id]
    );

    const stillMissing = (p.birth_date === null && !setBirthDate)
      || (p.country_id === null && !setCountryId)
      || (p.height_cm === null && !setHeightCm)
      || (p.weight_kg === null && !setWeightKg)
      || (p.turned_pro_year === null && !setTurnedPro);
    if (stillMissing) touched++; else fullyFilled++;
  }
  return { fullyFilled, touched, noMatch, ambiguous };
}

async function main() {
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  const countries = await queryAll(`SELECT id, iso2 FROM countries`);
  const countryByIso2 = new Map(countries.map(c => [c.iso2, c.id]));

  const players = await queryAll(`
    SELECT id, canonical_name, birth_date, death_date, country_id, height_cm, weight_kg, turned_pro_year,
           (sport_attributes ? 'hand') AS has_hand
    FROM entities
    WHERE entity_type = 'player'
      AND (external_ids ? 'sackmann_id' OR external_ids ? 'tml_id')
      AND (birth_date IS NULL OR death_date IS NULL OR country_id IS NULL OR height_cm IS NULL
           OR weight_kg IS NULL OR turned_pro_year IS NULL OR NOT (sport_attributes ? 'hand'))
      AND id IN (
        SELECT winner_entity_id FROM games
        UNION SELECT home_entity_id FROM games
        UNION SELECT away_entity_id FROM games
      )
    ${limit ? `LIMIT ${limit}` : ''}
  `);
  console.log(`${players.length} tennis players missing at least one bio field — querying Wikidata.\n`);

  let totals = { fullyFilled: 0, touched: 0, noMatch: 0, ambiguous: 0 };
  const batches = chunk(players, BATCH_SIZE);
  let batchNum = 0;

  for (const batch of batches) {
    batchNum++;
    const byLabel = await fetchByLabel(batch.map(p => p.canonical_name), 'rdfs:label');
    const r1 = await applyResults(batch, byLabel, countryByIso2);

    const unmatched = batch.filter(p => !byLabel.get(p.canonical_name));
    let r2 = { fullyFilled: 0, touched: 0, noMatch: 0, ambiguous: 0 };
    if (unmatched.length) {
      await sleep(1000);
      const byAlt = await fetchByLabel(unmatched.map(p => p.canonical_name), 'skos:altLabel');
      r2 = await applyResults(unmatched, byAlt, countryByIso2);
    }

    for (const k of Object.keys(totals)) totals[k] += r1[k] + r2[k];
    console.log(`  batch ${batchNum}/${batches.length}: ${r1.fullyFilled + r2.fullyFilled} fully filled, ${r1.touched + r2.touched} partial, ${r1.ambiguous + r2.ambiguous} ambiguous, ${r1.noMatch + r2.noMatch} no match`);
    await sleep(1000);
  }

  console.log(`\nDone: ${totals.fullyFilled} fully complete, ${totals.touched} partially improved, ${totals.ambiguous} ambiguous (skipped), ${totals.noMatch} no Wikidata match.`);
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
