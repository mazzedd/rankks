// =============================================================
// RANKKS — UEFA Champions League Data Ingestion
// Run: node ingest-ucl.js [command] [season]
// Commands: structure, fixtures, players, all
// Example: node ingest-ucl.js all 2022
//
// Scope (this version): classic group-stage format, 2015–2023.
// 2024+ (Swiss model / single 36-team league phase) is NOT handled
// here — different standings logic, separate script later.
//
// IMPORTANT — round terminology used by API-Sports for league=2:
//   Group A - 1 ... Group H - 6   → group stage, 8 groups x 6 matchdays
//   Round of 16 / Quarter-finals / Semi-finals / Final → knockout
//   Preliminary Round / 1st-3rd Qualifying Round / Play-offs → SKIPPED
//     (these are pre-tournament-proper qualifying, not part of the
//     competition as RANKKS models it)
// =============================================================

require('dotenv').config({ path: '../.env' });
const { ingestStructure }  = require('./ingest-ucl-structure');
const { ingestFixtures }   = require('./ingest-ucl-fixtures');
const { ingestPlayers }    = require('./ingest-ucl-players');
const { end } = require('./db');

// ── CONFIG ─────────────────────────────────────────────────────
const CONFIG = {
  apiKey:    process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7',
  baseUrl:   'https://v3.football.api-sports.io',
  leagueId:  2,                       // UEFA Champions League (NOT 525 = Women's)
  competitionSlug: 'champions-league-uefa',
  // Classic group-stage era only. 2024+ is Swiss model — separate script.
  seasons:   [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
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
  if (json.errors && Array.isArray(json.errors) ? json.errors.length > 0 : Object.keys(json.errors || {}).length > 0) {
    throw new Error(`API errors: ${JSON.stringify(json.errors)}`);
  }
  const remaining = res.headers.get('x-ratelimit-requests-remaining');
  if (remaining) process.stdout.write(` [quota: ${remaining} left]\n`);
  return json.response;
}

// ── MAIN ───────────────────────────────────────────────────────
async function main() {
  const [,, command = 'all', seasonArg] = process.argv;
  const seasons = seasonArg ? [parseInt(seasonArg)] : CONFIG.seasons;

  console.log(`\n🚀 RANKKS Ingestion — UEFA Champions League`);
  console.log(`   Command : ${command}`);
  console.log(`   Seasons : ${seasons.join(', ')}\n`);

  for (const season of seasons) {
    console.log(`\n📅 Season ${season}/${season + 1}`);
    try {
      // structure must run first — it creates the season row + seeds
      // all 16 result_tabs that fixtures/players write into
      if (command === 'structure' || command === 'all') {
        await ingestStructure(season, CONFIG, callApi);
      }
      if (command === 'fixtures' || command === 'all') {
        await ingestFixtures(season, CONFIG, callApi);
      }
      if (command === 'players' || command === 'all') {
        await ingestPlayers(season, CONFIG, callApi);
      }
    } catch (err) {
      console.error(`❌ Error for season ${season}:`, err.message);
    }
  }

  console.log('\n✅ UCL ingestion complete.\n');
  await end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

module.exports = { CONFIG, callApi };
