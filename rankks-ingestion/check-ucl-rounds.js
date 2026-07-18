// check-ucl-rounds.js
// ONE-OFF DIAGNOSTIC — run this once, paste the output back, then delete it.
// Does NOT touch the DB. Just prints every distinct round string API-Sports
// returns for the 2024/25 and 2025/26 UCL seasons, so we can write parseRound()
// against real data instead of guessing.
//
// Run from rankks-ingestion folder:
//   node check-ucl-rounds.js

require('dotenv').config();

const API_KEY = process.env.API_SPORTS_KEY;
const BASE_URL = 'https://v3.football.api-sports.io';
const LEAGUE_ID = 2; // UEFA Champions League

async function callApi(endpoint, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE_URL}/${endpoint}?${qs}`, {
    headers: { 'x-apisports-key': API_KEY },
  });
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.response;
}

async function checkSeason(apiSeason) {
  console.log(`\n=== API season=${apiSeason} (${apiSeason}/${apiSeason + 1}) ===`);
  let data;
  try {
    data = await callApi('fixtures', { league: LEAGUE_ID, season: apiSeason });
  } catch (err) {
    console.log(`  ⚠️  API error: ${err.message}`);
    return;
  }

  if (!data?.length) {
    console.log('  ⚠️  No fixtures returned at all.');
    return;
  }

  console.log(`  Total fixtures: ${data.length}`);

  // Group by round string, count, and show one sample fixture per round
  const byRound = new Map();
  for (const item of data) {
    const round = item.league.round;
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(item);
  }

  console.log(`  Distinct round strings: ${byRound.size}`);
  for (const [round, items] of byRound) {
    const sample = items[0];
    console.log(`\n  ROUND STRING: "${round}"  (${items.length} fixtures)`);
    console.log(`    sample fixture: ${sample.teams.home.name} vs ${sample.teams.away.name}`);
    console.log(`    fixture.status.short: ${sample.fixture.status?.short}`);
    console.log(`    fixture.date: ${sample.fixture.date}`);
  }
}

(async () => {
  if (!API_KEY) {
    console.log('❌ API_SPORTS_KEY not found in .env');
    process.exit(1);
  }
  await checkSeason(2024); // 2024/25 season — should show League Stage R1-R8 + new knockout structure
  await checkSeason(2025); // 2025/26 season — confirm same naming carries forward
  console.log('\n✅ Done. Paste this entire output back to Claude.');
})();