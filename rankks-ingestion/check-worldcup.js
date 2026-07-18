require('dotenv').config();

fetch('https://v3.football.api-sports.io/leagues?id=1', {
  headers: { 'x-apisports-key': process.env.API_SPORTS_KEY }
})
  .then(r => r.json())
  .then(d => {
    const seasons = d.response?.[0]?.seasons?.filter(s => [2014, 2018, 2022, 2026].includes(s.year));
    console.log(JSON.stringify(seasons, null, 2));
  })
  .catch(err => console.error('Error:', err));