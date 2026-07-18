// backfill-basketball-death.js
// Backfills entities.death_date for basketball 'player' entities via
// Wikidata P570 (date of death). Companion to backfill-nba-player-bio.js
// — reuses its exact ID-based matching approach (bref_player_id -> P2685,
// nba_person_id -> P3647), which is far more reliable than name matching
// since these are exact external-id joins, not fuzzy name lookups.
//
// Only fills entities.death_date where it's currently NULL — safe to
// re-run any time. This is also the script the weekly "check for new
// deaths" job (check-new-deaths.js) runs for basketball.
//
// Run with: node backfill-basketball-death.js
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RANKKS-app-data-backfill/1.0 (mazzedd@gmail.com)';
const BATCH_SIZE = 250;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toBrefValue(bref) {
  return `${bref[0]}/${bref}`;
}

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

function mergeBindings(bindings, idVar) {
  const byId = new Map();
  for (const row of bindings) {
    const id = row[idVar].value;
    if (row.dod && !byId.has(id)) byId.set(id, row.dod.value.slice(0, 10));
  }
  return byId;
}

async function fetchByBref(brefIds) {
  const values = brefIds.map(b => `"${toBrefValue(b)}"`).join(' ');
  const sparql = `
    SELECT ?bref ?dod WHERE {
      VALUES ?bref { ${values} }
      ?player wdt:P2685 ?bref .
      ?player wdt:P570 ?dod .
    }`;
  const merged = mergeBindings(await runSparql(sparql), 'bref');
  const byRawId = new Map();
  for (const [prefixed, dod] of merged) byRawId.set(prefixed.slice(2), dod);
  return byRawId;
}

async function fetchByNbaId(nbaIds) {
  const values = nbaIds.map(n => `"${n}"`).join(' ');
  const sparql = `
    SELECT ?nbaId ?dod WHERE {
      VALUES ?nbaId { ${values} }
      ?player wdt:P3647 ?nbaId .
      ?player wdt:P570 ?dod .
    }`;
  return mergeBindings(await runSparql(sparql), 'nbaId');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function applyResults(players, idKey, resultsById) {
  let filled = 0;
  for (const p of players) {
    const dod = resultsById.get(p[idKey]);
    if (!dod) continue;
    await query(
      `UPDATE entities SET death_date = $1, updated_at = NOW() WHERE id = $2 AND death_date IS NULL`,
      [dod, p.id]
    );
    filled++;
  }
  return filled;
}

async function main() {
  const withBref = await queryAll(`
    SELECT id, external_ids->>'bref_player_id' AS bref_player_id
    FROM entities
    WHERE entity_type = 'player' AND death_date IS NULL
      AND external_ids ? 'bref_player_id'
  `);
  const withNbaOnly = await queryAll(`
    SELECT id, external_ids->>'nba_person_id' AS nba_person_id
    FROM entities
    WHERE entity_type = 'player' AND death_date IS NULL
      AND external_ids ? 'nba_person_id'
      AND NOT (external_ids ? 'bref_player_id')
  `);
  console.log(`${withBref.length} players to check via bref_player_id, ${withNbaOnly.length} via nba_person_id only.\n`);

  let totalFilled = 0;

  for (const batch of chunk(withBref, BATCH_SIZE)) {
    const resultsById = await fetchByBref(batch.map(p => p.bref_player_id));
    const filled = await applyResults(batch, 'bref_player_id', resultsById);
    console.log(`  bref_player_id batch: ${filled} filled`);
    totalFilled += filled;
    await sleep(1000);
  }

  for (const batch of chunk(withNbaOnly, BATCH_SIZE)) {
    const resultsById = await fetchByNbaId(batch.map(p => p.nba_person_id));
    const filled = await applyResults(batch, 'nba_person_id', resultsById);
    console.log(`  nba_person_id batch: ${filled} filled`);
    totalFilled += filled;
    await sleep(1000);
  }

  console.log(`\nbasketball death_date: ${totalFilled} filled.`);
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
