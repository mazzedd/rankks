// backfill-nba-player-bio.js
// Backfills entities.country_id, birth_date, height_cm, weight_kg for NBA player
// entities that are missing them, by matching our stored bref_player_id /
// nba_person_id (external_ids) against Wikidata, which carries both as
// external-id properties:
//   P2685 = Basketball Reference NBA player ID (value is "x/xxxxxxNN", the
//           bref URL path — first letter of the id + "/" + the id itself)
//   P3647 = NBA.com player ID (matches our nba_person_id exactly, numeric)
//
// Nationality: prefers P1532 (country represented in international
// competition) over P27 (citizenship) — dual citizens like Giannis
// Antetokounmpo (Nigeria + Greece citizenship) have exactly one P1532
// value (Greece), which is the meaningful "nationality" for a sports stats
// site. Falls back to the first P27 value when P1532 is absent.
//
// Only fills columns that are currently NULL — never overwrites existing
// data — so this is safe to re-run any time (e.g. after a fresh player
// ingestion pass) to pick up newly added players.
//
// Run with: node backfill-nba-player-bio.js
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RANKKS-app-data-backfill/1.0 (mazzedd@gmail.com)';
const BATCH_SIZE = 250;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toBrefValue(bref) {
  return `${bref[0]}/${bref}`;
}

async function runSparql(query) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ query }),
  });
  if (!res.ok) throw new Error(`SPARQL request failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.results.bindings;
}

// Groups raw SPARQL bindings (one row per id-value combination, which can
// fan out across multiple citizenships/heights) into one merged record per id.
function mergeBindings(bindings, idVar) {
  const byId = new Map();
  for (const row of bindings) {
    const id = row[idVar].value;
    if (!byId.has(id)) {
      byId.set(id, { dob: null, heightCm: null, weightKg: null, sportIso2: null, citizenIso2: null });
    }
    const rec = byId.get(id);
    if (row.dob && !rec.dob) rec.dob = row.dob.value.slice(0, 10);
    if (row.heightVal && !rec.heightCm) rec.heightCm = Math.round(Number(row.heightVal.value));
    if (row.massVal && !rec.weightKg) rec.weightKg = Math.round(Number(row.massVal.value));
    if (row.sportIso2 && !rec.sportIso2) rec.sportIso2 = row.sportIso2.value;
    if (row.citizenIso2 && !rec.citizenIso2) rec.citizenIso2 = row.citizenIso2.value;
  }
  return byId;
}

async function fetchByBref(brefIds) {
  const values = brefIds.map(b => `"${toBrefValue(b)}"`).join(' ');
  const sparql = `
    SELECT ?bref ?dob ?heightVal ?massVal ?sportIso2 ?citizenIso2 WHERE {
      VALUES ?bref { ${values} }
      ?player wdt:P2685 ?bref .
      OPTIONAL { ?player wdt:P569 ?dob . }
      OPTIONAL { ?player p:P2048 ?hs . ?hs psv:P2048 ?hv . ?hv wikibase:quantityAmount ?heightVal . }
      OPTIONAL { ?player p:P2067 ?ms . ?ms psv:P2067 ?mv . ?mv wikibase:quantityAmount ?massVal . }
      OPTIONAL { ?player wdt:P1532 ?sportCountry . ?sportCountry wdt:P297 ?sportIso2 . }
      OPTIONAL { ?player wdt:P27 ?citizenCountry . ?citizenCountry wdt:P297 ?citizenIso2 . }
    }`;
  const bindings = await runSparql(sparql);
  const merged = mergeBindings(bindings, 'bref');
  // Strip the "x/" prefix back off so callers can key by raw bref_player_id.
  const byRawId = new Map();
  for (const [prefixed, rec] of merged) byRawId.set(prefixed.slice(2), rec);
  return byRawId;
}

async function fetchByNbaId(nbaIds) {
  const values = nbaIds.map(n => `"${n}"`).join(' ');
  const sparql = `
    SELECT ?nbaId ?dob ?heightVal ?massVal ?sportIso2 ?citizenIso2 WHERE {
      VALUES ?nbaId { ${values} }
      ?player wdt:P3647 ?nbaId .
      OPTIONAL { ?player wdt:P569 ?dob . }
      OPTIONAL { ?player p:P2048 ?hs . ?hs psv:P2048 ?hv . ?hv wikibase:quantityAmount ?heightVal . }
      OPTIONAL { ?player p:P2067 ?ms . ?ms psv:P2067 ?mv . ?mv wikibase:quantityAmount ?massVal . }
      OPTIONAL { ?player wdt:P1532 ?sportCountry . ?sportCountry wdt:P297 ?sportIso2 . }
      OPTIONAL { ?player wdt:P27 ?citizenCountry . ?citizenCountry wdt:P297 ?citizenIso2 . }
    }`;
  const bindings = await runSparql(sparql);
  return mergeBindings(bindings, 'nbaId');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function applyResults(players, resultsById, idField, countryByIso2) {
  let fullyFilled = 0, touched = 0, noMatch = 0;
  for (const p of players) {
    const rec = resultsById.get(p[idField]);
    if (!rec) { noMatch++; continue; }

    const iso2 = rec.sportIso2 || rec.citizenIso2 || null;
    const countryId = iso2 ? countryByIso2.get(iso2) || null : null;

    const setBirthDate = p.birth_date === null && rec.dob ? rec.dob : null;
    const setCountryId = p.country_id === null && countryId ? countryId : null;
    const setHeightCm = p.height_cm === null && rec.heightCm ? rec.heightCm : null;
    const setWeightKg = p.weight_kg === null && rec.weightKg ? rec.weightKg : null;

    if (!setBirthDate && !setCountryId && !setHeightCm && !setWeightKg) {
      noMatch++;
      continue;
    }

    await query(
      `UPDATE entities SET
         birth_date = COALESCE(birth_date, $1),
         country_id = COALESCE(country_id, $2),
         height_cm = COALESCE(height_cm, $3),
         weight_kg = COALESCE(weight_kg, $4),
         updated_at = NOW()
       WHERE id = $5`,
      [setBirthDate, setCountryId, setHeightCm, setWeightKg, p.id]
    );

    const stillMissing = (p.birth_date === null && !setBirthDate)
      || (p.country_id === null && !setCountryId)
      || (p.height_cm === null && !setHeightCm)
      || (p.weight_kg === null && !setWeightKg);
    if (stillMissing) touched++;
    else fullyFilled++;
  }
  return { fullyFilled, touched, noMatch };
}

async function main() {
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  const countries = await queryAll(`SELECT id, iso2 FROM countries`);
  const countryByIso2 = new Map(countries.map(c => [c.iso2, c.id]));

  const withBref = await queryAll(`
    SELECT id, canonical_name, birth_date, country_id, height_cm, weight_kg,
           external_ids->>'bref_player_id' AS bref_player_id
    FROM entities
    WHERE entity_type = 'player'
      AND external_ids ? 'bref_player_id'
      AND (country_id IS NULL OR birth_date IS NULL OR height_cm IS NULL OR weight_kg IS NULL)
    ${limit ? `LIMIT ${limit}` : ''}
  `);

  const withNbaOnly = limit ? [] : await queryAll(`
    SELECT id, canonical_name, birth_date, country_id, height_cm, weight_kg,
           external_ids->>'nba_person_id' AS nba_person_id
    FROM entities
    WHERE entity_type = 'player'
      AND external_ids ? 'nba_person_id'
      AND NOT (external_ids ? 'bref_player_id')
      AND (country_id IS NULL OR birth_date IS NULL OR height_cm IS NULL OR weight_kg IS NULL)
  `);

  console.log(`${withBref.length} players to try via bref_player_id, ${withNbaOnly.length} via nba_person_id only.\n`);

  let totals = { fullyFilled: 0, touched: 0, noMatch: 0 };

  for (const batch of chunk(withBref, BATCH_SIZE)) {
    const resultsById = await fetchByBref(batch.map(p => p.bref_player_id));
    const r = await applyResults(batch, resultsById, 'bref_player_id', countryByIso2);
    totals.fullyFilled += r.fullyFilled; totals.touched += r.touched; totals.noMatch += r.noMatch;
    console.log(`  bref batch: ${r.fullyFilled} fully filled, ${r.touched} partially filled, ${r.noMatch} no match`);
    await sleep(1000);
  }

  for (const batch of chunk(withNbaOnly, BATCH_SIZE)) {
    const resultsById = await fetchByNbaId(batch.map(p => p.nba_person_id));
    const r = await applyResults(batch, resultsById, 'nba_person_id', countryByIso2);
    totals.fullyFilled += r.fullyFilled; totals.touched += r.touched; totals.noMatch += r.noMatch;
    console.log(`  nba_person_id batch: ${r.fullyFilled} fully filled, ${r.touched} partially filled, ${r.noMatch} no match`);
    await sleep(1000);
  }

  console.log(`\nDone: ${totals.fullyFilled} now fully complete (country+birth_date+height+weight), ${totals.touched} improved but still missing something, ${totals.noMatch} no Wikidata match (likely no Wikidata entry — pre-1956/defunct-franchise players expected here).`);
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
