// backfill-tennis-death.js
// Backfills entities.death_date for tennis 'player' entities via
// Wikidata P570 (date of death). Same name+occupation matching approach
// as backfill-football-death.js, scoped to Wikidata's "tennis player"
// occupation (Q10833314).
//
// Scope: entity_type='player' AND external_ids ? 'sackmann_id' — this is
// how tennis players are distinguished from basketball/football within
// the shared entity_type='player' pool. NOTE: as of writing, only ~41 of
// 8127 tennis player entities have birth_date populated at all (a
// separate, pre-existing data gap unrelated to this script) — so this
// currently has very little to work with. Re-running after a future
// tennis birth_date backfill will pick up newly matchable players
// automatically (nothing to change here).
//
// Only fills entities.death_date where it's currently NULL — safe to
// re-run any time. This is also the script the weekly "check for new
// deaths" job (check-new-deaths.js) runs for tennis.
//
// Run with: node backfill-tennis-death.js
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

function mergeBindings(bindings) {
  const byName = new Map();
  for (const row of bindings) {
    const name = row.name.value;
    if (!byName.has(name)) byName.set(name, { qids: new Set(), dod: null });
    const rec = byName.get(name);
    rec.qids.add(row.player.value);
    if (row.dod && !rec.dod) rec.dod = row.dod.value.slice(0, 10);
  }
  return byName;
}

// P570 is OPTIONAL — deliberately. See backfill-f1-driver-death.js's
// comment on this same pattern: if P570 were mandatory, a same-named
// LIVING player would never appear in the result set at all, so the
// ambiguity check (qids.size > 1) would never catch the collision —
// confirmed by a real data-corruption case this caused before the fix.
async function fetchByLabel(names, predicate) {
  const values = names.map(n => `"${escapeLabel(n)}"@en`).join(' ');
  const sparql = `
    SELECT ?name ?player ?dod WHERE {
      VALUES ?name { ${values} }
      ?player ${predicate} ?name .
      ?player wdt:P106 ${TENNIS_PLAYER_OCCUPATION} .
      OPTIONAL { ?player wdt:P570 ?dod . }
    }`;
  return mergeBindings(await runSparql(sparql));
}

// Last line of defense against a lone Wikidata name+occupation match
// being a coincidentally-same-named DIFFERENT real person — see
// backfill-football-death.js's identical helper for the real case that
// motivated this (a name matched a death date that predated the
// player's own stored birth_date by over a decade).
function isPlausibleDeath(birthDate, deathDateStr) {
  const birth = new Date(birthDate);
  const death = new Date(deathDateStr);
  if (isNaN(birth) || isNaN(death)) return false;
  const ageAtDeath = (death - birth) / (365.25 * 24 * 60 * 60 * 1000);
  return ageAtDeath >= 14 && ageAtDeath <= 110;
}

async function applyResults(players, resultsByName) {
  let filled = 0, ambiguous = 0, noMatch = 0, implausible = 0;
  for (const p of players) {
    const rec = resultsByName.get(p.canonical_name);
    if (!rec || !rec.dod) { noMatch++; continue; }
    if (rec.qids.size > 1) { ambiguous++; continue; }
    if (!isPlausibleDeath(p.birth_date, rec.dod)) {
      console.warn(`  ⚠ implausible: "${p.canonical_name}" birth=${new Date(p.birth_date).toISOString().slice(0,10)} matched death=${rec.dod} — skipped`);
      implausible++;
      continue;
    }
    await query(
      `UPDATE entities SET death_date = $1, updated_at = NOW() WHERE id = $2 AND death_date IS NULL`,
      [rec.dod, p.id]
    );
    filled++;
  }
  return { filled, ambiguous, noMatch, implausible };
}

async function main() {
  const players = await queryAll(`
    SELECT id, canonical_name, birth_date FROM entities
    WHERE entity_type = 'player' AND death_date IS NULL
      AND external_ids ? 'sackmann_id' AND birth_date IS NOT NULL
  `);
  console.log(`${players.length} tennis players missing death_date — querying Wikidata for known deaths (P570).\n`);

  let totals = { filled: 0, ambiguous: 0, noMatch: 0, implausible: 0 };
  let batchNum = 0;
  const totalBatches = Math.ceil(players.length / BATCH_SIZE) || 1;

  for (const batch of chunk(players, BATCH_SIZE)) {
    batchNum++;
    const byLabel = await fetchByLabel(batch.map(p => p.canonical_name), 'rdfs:label');
    const r1 = await applyResults(batch, byLabel);
    totals.filled += r1.filled; totals.ambiguous += r1.ambiguous; totals.noMatch += r1.noMatch; totals.implausible += r1.implausible;

    const unmatched = batch.filter(p => !byLabel.get(p.canonical_name)?.dod);
    let r2 = { filled: 0, ambiguous: 0, noMatch: 0, implausible: 0 };
    if (unmatched.length) {
      await sleep(1000);
      const byAlt = await fetchByLabel(unmatched.map(p => p.canonical_name), 'skos:altLabel');
      r2 = await applyResults(unmatched, byAlt);
      totals.filled += r2.filled; totals.ambiguous += r2.ambiguous; totals.noMatch += r2.noMatch; totals.implausible += r2.implausible;
    }

    console.log(`  batch ${batchNum}/${totalBatches}: ${r1.filled + r2.filled} filled, ${r1.ambiguous + r2.ambiguous} ambiguous, ${r1.implausible + r2.implausible} implausible`);
    await sleep(1000);
  }

  console.log(`\ntennis death_date: ${totals.filled} filled, ${totals.ambiguous} ambiguous (skipped), ${totals.implausible} implausible (skipped), ${totals.noMatch} no match.`);
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
