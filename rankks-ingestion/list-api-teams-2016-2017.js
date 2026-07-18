const API_KEY = '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function getApiTeams(season) {
  const res = await fetch(`https://v3.football.api-sports.io/standings?league=2&season=${season}`, {
    headers: { 'x-apisports-key': API_KEY }
  });
  const data = await res.json();
  const groups = data.response?.[0]?.league?.standings || [];
  const teams = [];
  for (const group of groups) {
    for (const row of group) {
      teams.push({ id: row.team.id, name: row.team.name, group: row.group });
    }
  }
  return teams;
}

async function main() {
  for (const season of [2016, 2017]) {
    const teams = await getApiTeams(season);
    console.log(`\n=== Season ${season}: ${teams.length} teams expected from API ===`);
    teams.forEach(t => console.log(`  ${t.name} (id ${t.id}) - ${t.group}`));
    await new Promise(r => setTimeout(r, 400));
  }
}

main().catch(err => console.error('Error:', err));