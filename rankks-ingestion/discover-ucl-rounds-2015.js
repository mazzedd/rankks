const API_KEY = '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/fixtures/rounds?league=2&season=2015', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const data = await res.json();
  console.log(JSON.stringify(data.response, null, 2));
}

main().catch(err => console.error('Error:', err));