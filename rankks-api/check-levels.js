const https = require('https');
const readline = require('readline');
const url = 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2023.csv';
const levels = new Set();
https.get(url, res => {
  const rl = readline.createInterface({ input: res });
  let first = true, idx = -1;
  rl.on('line', line => {
    const cols = line.split(',');
    if (first) { idx = cols.indexOf('tourney_level'); first = false; return; }
    if (idx >= 0) levels.add(cols[idx]);
  });
  rl.on('close', () => console.log([...levels]));
});