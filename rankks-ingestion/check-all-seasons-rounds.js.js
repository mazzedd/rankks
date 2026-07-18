const API_KEY = '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function checkSeason(season) {
  const res = await fetch(`https://v3.football.api-sports.io/fixtures/rounds?league=2&season=${season}`, {
    headers: { 'x-apisports-key': API_KEY }
  });
  const data = await res.json();
  const rounds = data.response || [];
  // Just show the non-group rounds (qualifying + knockout), since group
  // format we already know varies; this tells us the knockout label set
  const knockoutLike = rounds.filter(r => !r.toLowerCase().includes('group'));
  console.log(`Season ${season}:`, JSON.stringify(knockoutLike));
}

async function main() {
  for (const season of [2016, 2017, 2018, 2019, 2020, 2021]) {
    await checkSeason(season);
    await new Promise(r => setTimeout(r, 400));
  }
}

main().catch(err => console.error('Error:', err));