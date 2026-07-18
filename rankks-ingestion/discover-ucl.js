const API_KEY = '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/leagues?country=World', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const data = await res.json();
  const leagues = data.response?.map(x => ({
    id: x.league.id,
    name: x.league.name,
    type: x.league.type
  }));
  console.log(JSON.stringify(leagues, null, 2));
}

main().catch(err => console.error('Error:', err));