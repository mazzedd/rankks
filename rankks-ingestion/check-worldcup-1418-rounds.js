require('dotenv').config({ path: '../.env' });
const API_KEY = process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function checkSeason(season) {
  const res = await fetch(`https://v3.football.api-sports.io/fixtures?league=1&season=${season}`, {
    headers: { 'x-apisports-key': API_KEY }
  });
  const json = await res.json();
  console.log(`\n=== ${season} — results: ${json.results} ===`);
  const rounds = new Map();
  for (const item of json.response || []) {
    const r = item.league.round;
    rounds.set(r, (rounds.get(r) || 0) + 1);
  }
  for (const [round, count] of rounds) console.log(`  "${round}": ${count} fixtures`);
}

async function main() {
  await checkSeason(2014);
  await checkSeason(2018);
}
main().catch(console.error);