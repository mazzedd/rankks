// =============================================================
// RANKKS — FIFA World Cup Data Ingestion
// Run: node ingest-worldcup.js [command] [season]
// Commands: structure, fixtures, players, all
// Example: node ingest-worldcup.js all 2026
//
// Scope: 2026 ONLY. This is the live/current edition, ingested under
// FOOT-NAV-04 (12 groups + 5-round knockout with Round of 32).
// 2014/2018/2022 are explicitly NOT handled by this script — they will
// get their own navigation pattern and their own structure/fixtures
// scripts later, since they use a different group count (8) and
// knockout shape (4 rounds, no Round of 32).
// =============================================================

require('dotenv').config({ path: '../.env' });
const { ingestStructure } = require('./ingest-worldcup-structure');
const { ingestFixtures }  = require('./ingest-worldcup-fixtures');
const { ingestPlayers }   = require('./ingest-worldcup-players');
const { end } = require('./db');

// ── CONFIG ─────────────────────────────────────────────────────
const CONFIG = {
  apiKey:    process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7',
  baseUrl:   'https://v3.football.api-sports.io',
  leagueId:  1,                       // FIFA World Cup
  competitionSlug: 'fifa-world-cup-men',
  seasons:   [2026],                  // 2026 ONLY — see scope note above
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
  if (json.errors && (Array.isArray(json.errors) ? json.errors.length > 0 : Object.keys(json.errors).length > 0)) {
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

  console.log(`\n🚀 RANKKS Ingestion — FIFA World Cup`);
  console.log(`   Command : ${command}`);
  console.log(`   Seasons : ${seasons.join(', ')}\n`);

  for (const season of seasons) {
    console.log(`\n📅 World Cup ${season}`);
    try {
      // structure must run first — creates the season row + seeds all
      // 22 result_tabs that fixtures/players write into
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

  console.log('\n✅ World Cup ingestion complete.\n');
  await end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

module.exports = { CONFIG, callApi };
