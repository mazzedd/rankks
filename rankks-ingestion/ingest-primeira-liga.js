// =============================================================
// RANKKS — Primeira Liga (Portugal) Data Ingestion
// Run: node ingest-primeira-liga.js [command] [season]
// Commands: standings, players, fixtures, topscorers, all
// Example: node ingest-primeira-liga.js all 2026
// =============================================================

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { ingestStandings }  = require('./ingest-standings');
const { ingestPlayers }    = require('./ingest-players');
const { ingestFixtures }   = require('./ingest-fixtures');
const { ingestTopScorers } = require('./ingest-topscorers');

// ── CONFIG ─────────────────────────────────────────────────────
if (!process.env.API_SPORTS_KEY) {
  throw new Error('API_SPORTS_KEY environment variable is required (set it in rankks-ingestion/.env)');
}

const CONFIG = {
  apiKey:    process.env.API_SPORTS_KEY,
  baseUrl:   'https://v3.football.api-sports.io',
  leagueId:  94,      // Primeira Liga (Portugal) — verified via /leagues?search=Primeira
  leagueSlug: 'primeira-liga-portugal',
  // Seasons to backfill (start year of each season) — API-Sports has full
  // standings/fixtures/players coverage 2010-2026 for this league (verified
  // via /leagues?id=94).
  seasons:   [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026],
};

// ── HELPERS ────────────────────────────────────────────────────
async function callApi(endpoint, params = {}) {
  const qs = new URLSearchParams({ ...params }).toString();
  const url = `${CONFIG.baseUrl}/${endpoint}?${qs}`;
  const res = await fetch(url, {
    headers: { 'x-apisports-key': CONFIG.apiKey }
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API errors: ${JSON.stringify(json.errors)}`);
  }
  // Log remaining quota
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (remaining) process.stdout.write(` [quota: ${remaining} left]\n`);
  return json.response;
}

// ── MAIN ───────────────────────────────────────────────────────
async function main() {
  const [,, command = 'all', seasonArg] = process.argv;
  const seasons = seasonArg ? [parseInt(seasonArg)] : CONFIG.seasons;

  console.log(`\n🚀 RANKKS Ingestion — Primeira Liga`);
  console.log(`   Command : ${command}`);
  console.log(`   Seasons : ${seasons.join(', ')}\n`);

  for (const season of seasons) {
    console.log(`\n📅 Season ${season}/${season + 1}`);
    try {
      if (command === 'standings' || command === 'all') {
        await ingestStandings(season, CONFIG, callApi);
      }
      if (command === 'players' || command === 'all') {
        await ingestPlayers(season, CONFIG, callApi);
      }
      if (command === 'fixtures' || command === 'all') {
        await ingestFixtures(season, CONFIG, callApi);
      }
      if (command === 'topscorers' || command === 'all') {
        await ingestTopScorers(season, CONFIG, callApi);
      }
    } catch (err) {
      console.error(`❌ Error for season ${season}:`, err.message);
    }
  }

  console.log('\n✅ Ingestion complete.\n');
}

main().catch(console.error);

module.exports = { CONFIG, callApi };
