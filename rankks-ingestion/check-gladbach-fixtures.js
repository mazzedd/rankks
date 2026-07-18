const API_KEY = '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/fixtures?league=2&season=2016&team=163', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const data = await res.json();
  console.log('Total fixtures found:', data.response?.length);
  data.response?.forEach(f => {
    console.log(`${f.fixture.date} | round: "${f.league.round}" | ${f.teams.home.name} vs ${f.teams.away.name} | status: ${f.fixture.status.short}`);
  });
}

main().catch(err => console.error('Error:', err));