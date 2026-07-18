// check-worldcup-2010-standings.js
require('dotenv').config({ path: '../.env' });
const API_KEY = process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/standings?league=1&season=2010', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const json = await res.json();
  console.log('results:', json.results);
  console.log('errors:', JSON.stringify(json.errors));
  console.log(JSON.stringify(json.response, null, 2)?.slice(0, 1500));
}
main().catch(console.error);