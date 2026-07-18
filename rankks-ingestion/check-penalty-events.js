require('dotenv').config({ path: '../.env' });
const API_KEY = process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/fixtures/events?fixture=208386', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const json = await res.json();
  console.log('results:', json.results);
  console.log(JSON.stringify(json.response, null, 2));
}

main().catch(console.error);