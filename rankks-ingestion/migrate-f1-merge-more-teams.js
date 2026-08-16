// Second batch of the McLaren/Red Bull merge pattern (see
// migrate-f1-merge-team-engines.js for the original + full rationale) —
// same fix (engine partner is a per-season fact, not a separate team
// identity) applied to 11 more teams confirmed with Mohamed on 2026-07-26
// as unambiguous "same team, engine-suffix only" cases: Williams, Brabham,
// Tyrrell, Benetton, Arrows, March, Ligier, Cooper, Minardi, Jordan, BRM.
//
// Deliberately NOT touched (genuine ownership/rebrand chains, confirmed
// excluded): Lotus (three unrelated organizations reused the name across
// F1 history), Sauber (BMW fully owned + renamed it 2006-2009, sold back
// after), Renault/Honda/Toyota "works team" entities (each conflates
// multiple unrelated eras under one bare name), and the rebrand
// boundaries already respected in the original migration (Tyrrell stops
// at the BAR sale, Benetton stops at both the Toleman and 2002-Renault
// boundaries, Minardi stops at the Toro Rosso sale, Jordan stops at the
// Midland/MF1 sale).
//
// Re-runnable: every step is guarded (checks current state before acting).
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

// Each family: canonicalId (kept, may be renamed), rename (null if the
// canonical entity's name is already correct), engineMap (entity_id ->
// engine name for backfilling existing rows, keyed BEFORE repointing),
// conflicts (genuine same-season multi-engine rows — team_standings.id
// values, keep = highest points that year, drop = the rest summed in).
const FAMILIES = [
  {
    label: 'Williams',
    canonicalId: 76181, // already "Williams" (2026) — no rename needed
    rename: null,
    engineMap: {
      76181: 'Mercedes', // slug "atlassian-williams-mercedes" confirms 2026 engine
      74975: 'BMW', 75061: 'Cosworth', 75820: 'Ford', 75869: 'Honda',
      75930: 'Judd', 76047: 'Mecachrome', 76077: 'Mercedes', 75943: 'Renault',
      76051: 'Supertec', 75083: 'Toyota',
    },
    conflicts: [
      // 1983: Williams switched Ford->Honda mid-season. Ford dominant (36 vs 2).
      { year: 1983, keep: 640, drop: [647], engine: 'Ford' },
    ],
  },
  {
    label: 'Brabham',
    canonicalId: 75603, // "Brabham Ford" — most seasons (11)
    rename: { name: 'Brabham', slug: 'brabham' },
    engineMap: {
      75791: 'Alfa Romeo', 75861: 'BMW', 75606: 'BRM', 75561: 'Climax',
      75603: 'Ford', 75947: 'Judd', 75623: 'Repco', 75973: 'Yamaha',
    },
    conflicts: [
      { year: 1964, keep: 434, drop: [436], engine: 'Climax' },
      { year: 1965, keep: 441, drop: [445], engine: 'Climax' },
      // 1966: Brabham won the title on Repco (42pts) — BRM/Climax rows are
      // trivial one-off appearances (1pt each), not the season's real story.
      { year: 1966, keep: 447, drop: [458, 456], engine: 'Repco' },
      { year: 1967, keep: 459, drop: [469], engine: 'Repco' },
      { year: 1982, keep: 629, drop: [631], engine: 'BMW' },
    ],
  },
  {
    label: 'Tyrrell',
    canonicalId: 75685, // "Tyrrell Ford" — most seasons (19)
    rename: { name: 'Tyrrell', slug: 'tyrrell' },
    engineMap: {
      75685: 'Ford', 75970: 'Honda', 75988: 'Ilmor', 75899: 'Renault', 76009: 'Yamaha',
    },
    conflicts: [
      { year: 1985, keep: 670, drop: [671], engine: 'Ford' },
    ],
  },
  {
    label: 'Benetton',
    canonicalId: 75914, // "Benetton Ford" — most seasons (8)
    rename: { name: 'Benetton', slug: 'benetton' },
    engineMap: { 75907: 'BMW', 75914: 'Ford', 75008: 'Playlife', 75029: 'Renault' },
    conflicts: [],
  },
  {
    label: 'Arrows',
    canonicalId: 76048, // already "Arrows" (1998-1999) — no rename needed
    rename: null,
    engineMap: {
      76048: null, // own-badged engine 1998-1999, no separate manufacturer name
      75031: 'Asiatech', 75886: 'BMW', 75041: 'Cosworth', 75821: 'Ford',
      75915: 'Megatron', 75013: 'Supertec', 76041: 'Yamaha',
    },
    conflicts: [
      // 1984: exact tie on every stat (3pts each) — Mohamed's call: use
      // finishing position as the tiebreak (BMW 9th vs Ford 11th that year).
      { year: 1984, keep: 658, drop: [660], engine: 'BMW' },
    ],
  },
  {
    label: 'March',
    canonicalId: 75686, // "March Ford" — most seasons (8)
    rename: { name: 'March', slug: 'march' },
    engineMap: { 75686: 'Ford', 75990: 'Ilmor', 75929: 'Judd' },
    // 75700 "March Alfa Romeo" (0 team_standings rows, but 12 session_results
    // refs) has no engineMap entry — nothing to backfill, just needs its
    // session_results FKs repointed, handled generically below.
    conflicts: [],
    extraNoStandingsIds: [75700],
  },
  {
    label: 'Ligier',
    canonicalId: 75887, // "Ligier Renault" — most seasons (6)
    rename: { name: 'Ligier', slug: 'ligier' },
    engineMap: {
      75834: 'Ford', 75789: 'Matra', 75917: 'Megatron', 76030: 'Mugen Honda', 75887: 'Renault',
    },
    conflicts: [],
    extraNoStandingsIds: [75933, 75978], // Ligier Judd, Ligier Lamborghini — 0 team_standings, real session_results refs
  },
  {
    label: 'Cooper',
    canonicalId: 75435, // "Cooper Climax" — most seasons (9)
    rename: { name: 'Cooper', slug: 'cooper' },
    engineMap: { 75661: 'BRM', 75507: 'Castellotti', 75435: 'Climax', 75478: 'Maserati' },
    conflicts: [
      // 1960: Climax dominant (48pts vs 3pts each) — 3-way split season.
      { year: 1960, keep: 404, drop: [409, 408], engine: 'Climax' },
      { year: 1967, keep: 461, drop: [466], engine: 'Maserati' },
    ],
    extraNoStandingsIds: [75583, 75346, 75651, 75491, 75267, 75632, 75610, 75163, 75499],
  },
  {
    label: 'Minardi',
    canonicalId: 75902, // "Minardi Ford" — most seasons (6)
    rename: { name: 'Minardi', slug: 'minardi' },
    engineMap: {
      75037: 'Asiatech', 74996: 'Cosworth', 75971: 'Ferrari', 75902: 'Ford', 75994: 'Lamborghini',
    },
    conflicts: [],
    extraNoStandingsIds: [75032, 75019, 76044, 75904],
  },
  {
    label: 'Jordan',
    canonicalId: 74993, // "Jordan Ford"
    // slug 'jordan' is already taken by a national_team entity (id 32716,
    // the country Jordan) — entities.slug is globally unique across every
    // sport, not scoped per entity_type, so 'jordan-f1' disambiguates.
    rename: { name: 'Jordan', slug: 'jordan-f1' },
    engineMap: {
      74993: 'Ford', 76007: 'Hart', 75028: 'Honda', 75010: 'Mugen Honda',
      76032: 'Peugeot', 75047: 'Toyota', 75992: 'Yamaha',
    },
    conflicts: [],
  },
  {
    label: 'BRM',
    canonicalId: 75223, // already "BRM" (16 seasons) — no rename needed
    rename: null,
    engineMap: { 75223: null, 75534: 'Climax' },
    conflicts: [],
  },
];

const REF_TABLES = ['f1_driver_standings', 'f1_session_results', 'f1_team_standings'];
const ALL_REF_COLUMNS = [
  { table: 'f1_driver_standings', column: 'team_entity_id' },
  { table: 'f1_session_results', column: 'team_entity_id' },
  { table: 'f1_team_standings', column: 'team_entity_id' },
  { table: 'f1_fastest_laps', column: 'team_entity_id' },
  { table: 'entity_aliases', column: 'entity_id' },
  { table: 'entity_logos', column: 'entity_id' },
];

async function backfillEngineNames(client, engineMap, label) {
  for (const [entityId, engine] of Object.entries(engineMap)) {
    if (!engine) continue;
    const r = await client.query(
      `UPDATE f1_team_standings SET engine_name = $1 WHERE team_entity_id = $2 AND engine_name IS NULL`,
      [engine, entityId]
    );
    if (r.rowCount) console.log(`${label}: backfilled engine_name='${engine}' for entity ${entityId} (${r.rowCount} row(s))`);
  }
}

// Generalized N-way version of the same-season merge from the original
// migration — sums every `drop` row's stats into `keep`, sets engine_name
// to the given dominant engine, deletes the `drop` rows. No-op if already
// merged (drop rows gone).
async function mergeSameSeasonRow(client, year, keepId, dropIds, engine, label) {
  for (const dropId of dropIds) {
    const drop = await client.query(`SELECT * FROM f1_team_standings WHERE id = $1`, [dropId]);
    if (!drop.rows.length) {
      console.log(`${label} ${year}: row ${dropId} already merged/removed — skipping`);
      continue;
    }
    const d = drop.rows[0];
    await client.query(`
      UPDATE f1_team_standings SET
        points = points + $1, wins = wins + $2, p2 = p2 + $3, p3 = p3 + $4,
        sprint_wins = sprint_wins + $5, engine_name = $6
      WHERE id = $7
    `, [d.points, d.wins, d.p2, d.p3, d.sprint_wins, engine, keepId]);
    await client.query(`DELETE FROM f1_team_standings WHERE id = $1`, [dropId]);
    console.log(`${label} ${year}: merged team_standings row ${dropId} into ${keepId}, engine_name='${engine}'`);
  }
  // Ensure engine_name is set even when there was nothing to merge in
  // (e.g. already merged on a prior run) — keep row might still be null.
  await client.query(
    `UPDATE f1_team_standings SET engine_name = $1 WHERE id = $2 AND engine_name IS NULL`,
    [engine, keepId]
  );
}

async function repointAliasesAndDropDuplicateLogos(client, canonicalId, otherIds, label) {
  for (const oldId of otherIds) {
    if (oldId === canonicalId) continue;
    const r = await client.query(`UPDATE entity_aliases SET entity_id = $1 WHERE entity_id = $2`, [canonicalId, oldId]);
    if (r.rowCount) console.log(`${label}: repointed ${r.rowCount} entity_aliases row(s) from ${oldId} -> ${canonicalId}`);
    const del = await client.query(`DELETE FROM entity_logos WHERE entity_id = $1`, [oldId]);
    if (del.rowCount) console.log(`${label}: deleted ${del.rowCount} duplicate entity_logos row(s) for ${oldId}`);
  }
}

async function repointAndDelete(client, canonicalId, otherIds, label) {
  for (const oldId of otherIds) {
    if (oldId === canonicalId) continue;
    for (const table of REF_TABLES) {
      const r = await client.query(`UPDATE ${table} SET team_entity_id = $1 WHERE team_entity_id = $2`, [canonicalId, oldId]);
      if (r.rowCount) console.log(`${label}: repointed ${r.rowCount} row(s) in ${table} from ${oldId} -> ${canonicalId}`);
    }
  }

  for (const oldId of otherIds) {
    if (oldId === canonicalId) continue;
    for (const { table, column } of ALL_REF_COLUMNS) {
      const check = await client.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = $1`, [oldId]);
      const n = parseInt(check.rows[0].n, 10);
      if (n > 0) throw new Error(`Refusing to delete entity ${oldId} (${label}) — still ${n} reference(s) in ${table}.${column}`);
    }
  }

  for (const oldId of otherIds) {
    if (oldId === canonicalId) continue;
    const del = await client.query(`DELETE FROM entities WHERE id = $1`, [oldId]);
    if (del.rowCount) console.log(`${label}: deleted orphaned entity ${oldId}`);
    else console.log(`${label}: entity ${oldId} already deleted — skipping`);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const family of FAMILIES) {
      console.log(`\n--- ${family.label} ---`);
      await backfillEngineNames(client, family.engineMap, family.label);
      for (const c of family.conflicts) {
        await mergeSameSeasonRow(client, c.year, c.keep, c.drop, c.engine, family.label);
      }
      const otherIds = [
        ...Object.keys(family.engineMap).map(Number),
        ...(family.extraNoStandingsIds || []),
      ].filter(id => id !== family.canonicalId);
      await repointAliasesAndDropDuplicateLogos(client, family.canonicalId, otherIds, family.label);
      await repointAndDelete(client, family.canonicalId, otherIds, family.label);
      if (family.rename) {
        await client.query(`UPDATE entities SET canonical_name = $1, slug = $2 WHERE id = $3`,
          [family.rename.name, family.rename.slug, family.canonicalId]);
        console.log(`${family.label}: renamed entity ${family.canonicalId} -> "${family.rename.name}"`);
      }
    }

    await client.query('COMMIT');
    console.log('\nMigration committed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FATAL — rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
