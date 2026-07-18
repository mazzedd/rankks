require('dotenv').config();
const API_KEY = process.env.API_SPORTS_KEY || '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/leagues?id=1', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const d = await res.json();
  const target = [1998, 2002, 2006, 2010, 2014, 2018];
  const seasons = d.response?.[0]?.seasons?.filter(s => target.includes(s.year));
  console.log(JSON.stringify(seasons, null, 2));
}

main().catch(console.error);