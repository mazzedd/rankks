// backfill-club-countries.js
// One-time backfill: populates entities.country_id for every club entity
// currently missing it, by calling API-Sports' /teams endpoint per club
// (which carries team.country, unlike /fixtures which only has id/name/logo)
// and resolving that name against the countries table.
//
// Run with: node backfill-club-countries.js
require('dotenv').config();
const { queryAll, queryOne, query } = require('./db');

const API_KEY = process.env.API_SPORTS_KEY;
const BASE_URL = 'https://v3.football.api-sports.io';

// Override map for known API-Sports ↔ countries-table name mismatches.
// Mirrors the same kind of mapping already used for player nationality
// in results.js — extend this if new mismatches surface during the run.
const COUNTRY_NAME_OVERRIDES = {
  'Türkiye': 'Turkey',
  'Korea Republic': 'South Korea',
  'Congo DR': 'DR Congo',
  'Cape Verde Islands': 'Cape Verde',
  'Central African Republic': 'Central African Rep.',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function resolveCountryId(apiCountryName) {
  if (!apiCountryName) return null;
  const lookupName = COUNTRY_NAME_OVERRIDES[apiCountryName] || apiCountryName;
  const row = await queryOne(
    `SELECT id FROM countries WHERE name ILIKE $1 LIMIT 1`,
    [lookupName]
  );
  return row?.id || null;
}

async function main() {
  if (!API_KEY) {
    console.error('Missing API_SPORTS_KEY in .env — aborting.');
    process.exit(1);
  }

  // Only clubs that are missing country_id AND have a stored API-Sports id
  // to look up — clubs created some other way (no external_ids) are
  // skipped and reported separately, since there's nothing to call.
  const clubs = await queryAll(`
    SELECT id, canonical_name, external_ids
    FROM entities
    WHERE entity_type = 'club'
      AND country_id IS NULL
  `);

  console.log(`Found ${clubs.length} club(s) with no country_id.`);

  let updated = 0, noApiId = 0, apiNotFound = 0, countryUnresolved = 0, failed = 0;

  for (const club of clubs) {
    const apiId = club.external_ids?.api_sports;
    if (!apiId) {
      console.log(`  ⚠️  ${club.canonical_name} — no stored api_sports id, skipping (needs manual lookup)`);
      noApiId++;
      continue;
    }

    try {
      await sleep(350); // respect rate limit, same throttle used elsewhere in this pipeline
      const res = await fetch(`${BASE_URL}/teams?id=${apiId}`, {
        headers: { 'x-apisports-key': API_KEY },
      });
      const json = await res.json();
      const team = json.response?.[0]?.team;

      if (!team) {
        console.log(`  ⚠️  ${club.canonical_name} (api id ${apiId}) — no /teams response`);
        apiNotFound++;
        continue;
      }

      const countryId = await resolveCountryId(team.country);
      if (!countryId) {
        console.log(`  ⚠️  ${club.canonical_name} — API country "${team.country}" not found in countries table`);
        countryUnresolved++;
        continue;
      }

      await query(`UPDATE entities SET country_id = $1, updated_at = NOW() WHERE id = $2`, [countryId, club.id]);
      console.log(`  ✅ ${club.canonical_name} → ${team.country}`);
      updated++;
    } catch (err) {
      console.log(`  ❌ ${club.canonical_name} — error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${noApiId} no-api-id (manual), ${apiNotFound} api-not-found, ${countryUnresolved} country-unresolved, ${failed} failed.`);
}

main();
