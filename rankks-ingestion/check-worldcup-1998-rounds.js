// check-worldcup-1998-rounds.js — same script as before, pointed at 1998
require('dotenv').config({ path: '../.env' });
const API_KEY = process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/fixtures?league=1&season=1998', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const json = await res.json();
  console.log('results:', json.results);
  console.log('errors:', JSON.stringify(json.errors));
  const rounds = new Map();
  for (const item of json.response || []) {
    const r = item.league.round;
    rounds.set(r, (rounds.get(r) || 0) + 1);
  }
  for (const [round, count] of rounds) console.log(`  "${round}": ${count} fixtures`);
}
main().catch(console.error);