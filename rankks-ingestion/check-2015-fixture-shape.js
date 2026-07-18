const API_KEY = '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/standings?league=2&season=2015', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const data = await res.json();
  const standings = data.response?.[0]?.league?.standings;
  console.log('Number of groups:', standings?.length);
  console.log(JSON.stringify(standings?.[0], null, 2)); // first group only, to keep output manageable
}

main().catch(err => console.error('Error:', err));