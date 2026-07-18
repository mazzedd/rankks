require('dotenv').config({ path: '../.env' });

const API_KEY = process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/fixtures?league=1&season=2022', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const json = await res.json();

  console.log('HTTP status:', res.status);
  console.log('results:', json.results);
  console.log('paging:', JSON.stringify(json.paging));
  console.log('errors:', JSON.stringify(json.errors));
  console.log('quota remaining:', res.headers.get('x-ratelimit-requests-remaining'));

  const rounds = new Map();
  for (const item of json.response || []) {
    const r = item.league.round;
    rounds.set(r, (rounds.get(r) || 0) + 1);
  }
  console.log(`Total fixtures: ${json.response?.length || 0}`);
  for (const [round, count] of rounds) console.log(`  "${round}": ${count} fixtures`);
}

main().catch(console.error);