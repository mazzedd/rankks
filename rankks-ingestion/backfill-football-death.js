// backfill-football-death.js
// Backfills entities.death_date for football (soccer) 'player' entities
// via Wikidata P570 (date of death). Unlike basketball (backfill-
// basketball-death.js), there's no confirmed Wikidata external-id
// property for our stored api_sports player IDs, so this matches by
// name instead — same approach as backfill-f1-driver-death.js, scoped
// to Wikidata's "association football player" occupation (Q937857).
//
// Scope: entity_type='player' AND external_ids ? 'api_sports' — this is
// how football players are distinguished from basketball (bref_player_id/
// nba_person_id) and tennis (sackmann_id) within the same shared
// entity_type='player' pool (no per-sport column on entities itself).
//
// Only fills entities.death_date where it's currently NULL — safe to
// re-run any time. This is also the script the weekly "check for new
// deaths" job (check-new-deaths.js) runs for football.
//
// Run with: node backfill-football-death.js
require('dotenv').config();
const { queryAll, query, end } = require('./db');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'RANKKS-app-data-backfill/1.0 (mazzedd@gmail.com)';
const FOOTBALL_PLAYER_OCCUPATION = 'wd:Q937857'; // "association football player"
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

// Groups by matched ?name, tracking every distinct ?player QID seen —
// more than one distinct QID for the same name (very common for football
// given how many same-named players exist worldwide) means an
// unresolvable collision, skipped rather than guessed.
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
// confirmed by a real data-corruption case this caused before the fix
// ("Mark Wilson" born 1984 assigned a death date of 1982).
async function fetchByLabel(names, predicate) {
  const values = names.map(n => `"${escapeLabel(n)}"@en`).join(' ');
  const sparql = `
    SELECT ?name ?player ?dod WHERE {
      VALUES ?name { ${values} }
      ?player ${predicate} ?name .
      ?player wdt:P106 ${FOOTBALL_PLAYER_OCCUPATION} .
      OPTIONAL { ?player wdt:P570 ?dod . }
    }`;
  return mergeBindings(await runSparql(sparql));
}

// Even with the ambiguity check above, a single Wikidata name+occupation
// match can still be a coincidentally-same-named DIFFERENT real person —
// there's no way to detect that from the name alone. This is the last
// line of defense: reject any match that would be impossible or absurd
// given our own stored birth_date, rather than trust a lone name match
// unconditionally. Found via two real cases: "João Correia" (born 1996)
// name-matched a different João Correia who died in 1984 (before our
// player was even born — caught by the death<=birth check); and several
// entities with real match/box-score data got matched to same-named
// people who died as toddlers (age 0-4) — mathematically "after birth"
// so the original death<=birth-only check missed them, but no one has
// professional football stats at that age. 14 is a deliberately low
// floor (youngest realistic professional/semi-pro debut age), not a
// claim about typical career start.
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
      AND external_ids ? 'api_sports' AND birth_date IS NOT NULL
  `);
  console.log(`${players.length} football players missing death_date — querying Wikidata for known deaths (P570).\n`);

  let totals = { filled: 0, ambiguous: 0, noMatch: 0, implausible: 0 };

  let batchNum = 0;
  const totalBatches = Math.ceil(players.length / BATCH_SIZE);
  for (const batch of chunk(players, BATCH_SIZE)) {
    batchNum++;
    const byLabel = await fetchByLabel(batch.map(p => p.canonical_name), 'rdfs:label')
    const r1 = await applyResults(batch, byLabel)
    totals.filled += r1.filled; totals.ambiguous += r1.ambiguous; totals.noMatch += r1.noMatch; totals.implausible += r1.implausible

    const unmatched = batch.filter(p => !byLabel.get(p.canonical_name)?.dod)
    let r2 = { filled: 0, ambiguous: 0, noMatch: 0, implausible: 0 }
    if (unmatched.length) {
      await sleep(1000)
      const byAlt = await fetchByLabel(unmatched.map(p => p.canonical_name), 'skos:altLabel')
      r2 = await applyResults(unmatched, byAlt)
      totals.filled += r2.filled; totals.ambiguous += r2.ambiguous; totals.noMatch += r2.noMatch; totals.implausible += r2.implausible
    }

    console.log(`  batch ${batchNum}/${totalBatches}: ${r1.filled + r2.filled} filled, ${r1.ambiguous + r2.ambiguous} ambiguous, ${r1.implausible + r2.implausible} implausible`)

    await sleep(1000)
  }

  console.log(`\nfootball death_date: ${totals.filled} filled, ${totals.ambiguous} ambiguous (skipped), ${totals.implausible} implausible (skipped), ${totals.noMatch} no match.`)
  await end()
}

main().catch(err => { console.error(err); process.exit(1); });
