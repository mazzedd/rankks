// Ingests NBA player positions (PG/SG/SF/PF/C) from Player Season Info.csv for
// one season year into player_attributes (sport_id=3, attribute_key='position') —
// per onboarding-nba.md Section 5 ("basketball is a multi-position team sport
// like football, not entity-only like tennis/F1").
//
// Player Season Info.csv is bref-keyed (player_id like 'jokicni01'), the same
// system as Award Shares/EOST — NOT personId, which most of our 565 box-score
// entities are keyed by (no crosswalk file exists between the two, confirmed
// earlier). Resolution: exact bref_player_id match first (the ~51 entities
// already merged during Awards/EOST ingestion), then accent-normalized exact
// canonical_name match against personId-only entities for everyone else.
//
// Traded players have a combined "2TM"/"3TM" aggregate row plus one row per
// team — the aggregate row is preferred when present (represents the whole
// season, not just one stint).
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'Player Season Info.csv');
const BASKETBALL_SPORT_ID = 3;

const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-positions.js <seasonYear>');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
function normaliseName(name) {
  return name.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase().trim();
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true })
    .filter(r => r.season === String(seasonYearArg) && r.lg === 'NBA');

  const byPlayerId = new Map();
  for (const r of rows) {
    if (!byPlayerId.has(r.player_id)) byPlayerId.set(r.player_id, []);
    byPlayerId.get(r.player_id).push(r);
  }
  const seasonRows = [...byPlayerId.values()].map(group =>
    group.find(r => /^\dTM$/.test(r.team)) || group[0]
  );
  console.log(`${seasonRows.length} unique players in source for ${seasonYearArg}`);

  // Preload entities for both resolution paths
  const brefEntities = await pool.query(
    `SELECT id, external_ids->>'bref_player_id' AS bref_id FROM entities WHERE entity_type='player' AND external_ids ? 'bref_player_id'`
  );
  const brefMap = new Map(brefEntities.rows.map(r => [r.bref_id, r.id]));

  const nameEntities = await pool.query(
    `SELECT id, canonical_name FROM entities WHERE entity_type='player' AND external_ids ? 'nba_person_id'`
  );
  const nameMap = new Map(nameEntities.rows.map(r => [normaliseName(r.canonical_name), r.id]));

  let matchedByBref = 0, matchedByName = 0, unmatched = [];

  for (const r of seasonRows) {
    let entityId = brefMap.get(r.player_id);
    if (entityId) matchedByBref++;
    else {
      entityId = nameMap.get(normaliseName(r.player));
      if (entityId) matchedByName++;
    }
    if (!entityId) { unmatched.push(r.player); continue; }

    const existing = await pool.query(
      `SELECT id FROM player_attributes WHERE entity_id = $1 AND sport_id = $2 AND attribute_key = 'position'`,
      [entityId, BASKETBALL_SPORT_ID]
    );
    if (existing.rows.length) {
      await pool.query(
        `UPDATE player_attributes SET attribute_value = $1 WHERE id = $2`,
        [r.pos, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO player_attributes (entity_id, sport_id, attribute_key, attribute_value) VALUES ($1, $2, 'position', $3)`,
        [entityId, BASKETBALL_SPORT_ID, r.pos]
      );
    }
  }

  console.log(`Matched by bref_player_id: ${matchedByBref}, by name: ${matchedByName}, unmatched: ${unmatched.length}`);
  if (unmatched.length) console.log('Unmatched names:', unmatched.join(', '));

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
