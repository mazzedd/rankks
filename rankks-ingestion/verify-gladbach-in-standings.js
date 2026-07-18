const API_KEY = '22cd67b58e2bf36c5d66e5e9d7b7bff7';

async function main() {
  const res = await fetch('https://v3.football.api-sports.io/standings?league=2&season=2016', {
    headers: { 'x-apisports-key': API_KEY }
  });
  const data = await res.json();
  const groups = data.response?.[0]?.league?.standings || [];
  console.log('Number of groups:', groups.length);
  let found = false;
  groups.forEach((group, gi) => {
    group.forEach(row => {
      if (row.team.id === 163 || row.team.name.includes('Gladbach') || row.team.name.includes('gladbach')) {
        found = true;
        console.log(`FOUND in group index ${gi}:`, JSON.stringify({ id: row.team.id, name: row.team.name, group: row.group }));
      }
    });
  });
  if (!found) console.log('NOT FOUND in any group standings row.');

  // Also print total team count across all groups
  const totalTeams = groups.reduce((sum, g) => sum + g.length, 0);
  console.log('Total teams across all groups:', totalTeams);
}

main().catch(err => console.error('Error:', err));