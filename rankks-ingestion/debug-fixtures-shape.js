// debug-fixtures-shape.js — run with: node debug-fixtures-shape.js
const API_KEY = '22cd67b58e2bf36c5d66e5e9d7b7bff7'; // paste your real key

async function main() {
  try {
    const url = `https://v3.football.api-sports.io/fixtures?league=2&season=2017`;
    console.log('Fetching:', url);

    const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
    console.log('HTTP status:', res.status, res.statusText);

    const json = await res.json();
    console.log('results:', json.results);
    console.log('errors:', JSON.stringify(json.errors));
    console.log('paging:', JSON.stringify(json.paging));

    if (json.response && json.response.length > 0) {
      console.log('First fixture teams object:');
      console.log(JSON.stringify(json.response[0].teams, null, 2));
    } else {
      console.log('response array is empty or missing.');
    }
  } catch (err) {
    console.error('SCRIPT ERROR:', err);
  }
}

main();