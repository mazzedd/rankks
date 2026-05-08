// src/test.js — RANKKS API endpoint tester
// Run with: node src/test.js

const BASE = 'http://localhost:3000';

const tests = [
  { name: 'Health check',           url: '/health' },
  { name: 'Get all sports',         url: '/api/sports' },
  { name: 'Get football sport',     url: '/api/sports/football' },
  { name: 'Get tennis sport',       url: '/api/sports/tennis' },
  { name: 'Get all competitions',   url: '/api/competitions' },
  { name: 'Get football comps',     url: '/api/competitions?sport=football' },
  { name: 'Get tennis comps',       url: '/api/competitions?sport=tennis' },
  { name: 'Get Ligue 1 detail',     url: '/api/competitions/ligue-1-france' },
  { name: 'Get UCL detail',         url: '/api/competitions/champions-league-uefa' },
  { name: 'Get Roland Garros',      url: '/api/competitions/roland-garros' },
  { name: 'Get Indian Wells',       url: '/api/competitions/indian-wells' },
  { name: 'Ligue 1 naming 1998',    url: '/api/competitions/ligue-1-france/naming/1998' },
  { name: 'UCL naming 1960',        url: '/api/competitions/champions-league-uefa/naming/1960' },
  { name: 'Season (no data yet)',   url: '/api/seasons?competition=ligue-1-france&year=2024' },
  { name: 'Region: France',         url: '/api/regions?country=FR' },
  { name: 'Region: UK',             url: '/api/regions?country=GB' },
  { name: 'Region: USA',            url: '/api/regions?country=US' },
  { name: 'Region: unknown',        url: '/api/regions?country=ZZ' },
  { name: 'All regions',            url: '/api/regions/all' },
  { name: 'Entity search',          url: '/api/entities/search?q=real' },
  { name: 'Media (no data yet)',    url: '/api/media?seasonId=1' },
];

async function runTests() {
  console.log('═══════════════════════════════════════════');
  console.log('  RANKKS API — Endpoint Tests');
  console.log('═══════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const res = await fetch(`${BASE}${test.url}`);
      const data = await res.json();

      if (res.ok) {
        const preview = JSON.stringify(data).substring(0, 80);
        console.log(`✅ ${test.name.padEnd(30)} ${res.status} — ${preview}...`);
        passed++;
      } else {
        console.log(`⚠️  ${test.name.padEnd(30)} ${res.status} — ${data.error || 'error'}`);
        failed++;
      }
    } catch (err) {
      console.log(`❌ ${test.name.padEnd(30)} FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════\n');
}

runTests();
