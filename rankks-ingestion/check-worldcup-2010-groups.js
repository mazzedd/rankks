// check-worldcup-2010-groups.js
require('dotenv').config({ path: '../.env' });
const API_KEY = process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/fixtures?league=1&season=2010', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const json = await res.json();
  const groupFixtures = (json.response || []).filter(f => f.league.round.toLowerCase().includes('group'));
  for (const f of groupFixtures) {
    console.log(`${f.teams.home.id}\t${f.teams.home.name}\tvs\t${f.teams.away.id}\t${f.teams.away.name}`);
  }
}
main().catch(console.error);