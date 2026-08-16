// One-off migration: merge McLaren's and Red Bull's engine-era team
// entities into one canonical entity per team, moving the engine name
// into a new per-season f1_team_standings.engine_name column instead.
// See conversation with Mohamed (2026-07-26) — confirmed scope (McLaren +
// Red Bull only, other teams deferred) and 1966/1968 dual-engine-season
// resolution (sum stats, keep the dominant engine's name — Ford in both
// cases, confirmed by points: 1966 Ford 2.0 > Serenissima 1.0; 1968 Ford
// 49.0 > BRM 3.0).
//
// Re-runnable: every step is guarded (checks current state before acting)
// so running this twice is a no-op the second time, not a double-merge.
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

// entity_id -> engine name (manually mapped from each entity's own
// canonical_name — see audit in conversation history, not re-derived by
// string parsing since prefixes are inconsistent: "RBR" vs "Red Bull" vs
// "Red Bull Racing"). Canonical entity's own mapping entry is unused (its
// per-season engine_name comes from whichever row already IS canonical,
// handled separately below) but kept here for completeness/audit.
const MCLAREN_CANONICAL_ID = 74979; // "McLaren Mercedes" -> renamed "McLaren"
const MCLAREN_ENGINE_MAP = {
  75694: 'Alfa Romeo',
  75665: 'BRM',
  75643: 'BRM',
  75627: 'Ford',
  75928: 'Honda',
  74979: 'Mercedes',
  76014: 'Peugeot',
  76115: 'Renault',
  75628: 'Serenissima',
  75870: 'TAG',
};

const REDBULL_CANONICAL_ID = 76177; // "Red Bull Racing" — already correctly named, already has logo/colors
const REDBULL_ENGINE_MAP = {
  // 76177's canonical_name itself carries no engine suffix, but its slug
  // ("red-bull-racing-red-bull-ford") does — Red Bull's own 2026 in-house
  // engine, badged "Red Bull Ford" (Red Bull Powertrains/Ford).
  76177: 'Red Bull Ford',
  76121: 'Honda',
  76151: 'Honda RBPT',
  76137: 'RBPT',
  76054: 'Renault',
  76098: 'TAG Heuer',
  75084: 'Renault',
  75045: 'Cosworth',
  75060: 'Ferrari',
  75095: 'Renault',
};

const REF_TABLES = ['f1_driver_standings', 'f1_session_results', 'f1_team_standings'];
// Every table+column found (via a full-DB FK audit against entities(id))
// that could hold a reference to these entity IDs. f1_fastest_laps
// carried zero rows for both families at audit time — checked anyway,
// not assumed. entity_aliases/entity_logos are handled (repointed/
// dropped) separately in repointAliasesAndDropDuplicateLogos() before
// this verification runs, so by the time it runs they should already
// read zero — checked here too as the final safety net regardless.
const ALL_REF_COLUMNS = [
  { table: 'f1_driver_standings', column: 'team_entity_id' },
  { table: 'f1_session_results', column: 'team_entity_id' },
  { table: 'f1_team_standings', column: 'team_entity_id' },
  { table: 'f1_fastest_laps', column: 'team_entity_id' },
  { table: 'entity_aliases', column: 'entity_id' },
  { table: 'entity_logos', column: 'entity_id' },
];

// Full-DB audit (every FK pointing at entities(id)) found two more tables
// with rows for these entities beyond the f1_* ones above:
//   - entity_aliases: each old entity's own scraped name, stored as an
//     alias of itself. ON DELETE CASCADE, so repointing (not deleting)
//     preserves old-name lookup against the merged entity — e.g.
//     searching "McLaren Honda" still resolves to the merged "McLaren".
//   - entity_logos: Red Bull only (McLaren has none) — every variant
//     entity was already given an identical logo row (same URL,
//     start_year 2026, is_current true), apparently a prior workaround
//     for this exact fragmentation. Repointing would create duplicate
//     rows on the canonical entity, so these are deleted instead — the
//     canonical entity (76177) already carries its own equivalent row.
async function repointAliasesAndDropDuplicateLogos(client, canonicalId, otherIds, label) {
  for (const oldId of otherIds) {
    if (oldId === canonicalId) continue;
    const r = await client.query(
      `UPDATE entity_aliases SET entity_id = $1 WHERE entity_id = $2`,
      [canonicalId, oldId]
    );
    if (r.rowCount) console.log(`${label}: repointed ${r.rowCount} entity_aliases row(s) from ${oldId} -> ${canonicalId}`);

    const del = await client.query(`DELETE FROM entity_logos WHERE entity_id = $1`, [oldId]);
    if (del.rowCount) console.log(`${label}: deleted ${del.rowCount} duplicate entity_logos row(s) for ${oldId}`);
  }
}

async function ensureEngineColumn(client) {
  const check = await client.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'f1_team_standings' AND column_name = 'engine_name'
  `);
  if (check.rows.length) {
    console.log('engine_name column already exists — skipping ADD COLUMN');
    return;
  }
  await client.query(`ALTER TABLE f1_team_standings ADD COLUMN engine_name VARCHAR(50)`);
  console.log('Added f1_team_standings.engine_name');
}

// Backfills engine_name for every existing team_standings row belonging
// to this family, BEFORE any entity repointing — keyed off the row's
// current (pre-merge) team_entity_id, which still reflects which engine
// era it belongs to at this point.
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

// Merges two team_standings rows for the same season (a genuine
// mid-season engine change) into one: sums the numeric stats into
// `keepId`, sets engine_name to the dominant (higher-points) engine, then
// deletes the losing row. No-op if already merged (losing row gone).
async function mergeSameSeasonRow(client, year, keepStandingsId, dropStandingsId, dominantEngine) {
  const drop = await client.query(`SELECT * FROM f1_team_standings WHERE id = $1`, [dropStandingsId]);
  if (!drop.rows.length) {
    console.log(`${year}: row ${dropStandingsId} already merged/removed — skipping`);
    return;
  }
  const d = drop.rows[0];
  await client.query(`
    UPDATE f1_team_standings SET
      points = points + $1,
      wins = wins + $2,
      p2 = p2 + $3,
      p3 = p3 + $4,
      sprint_wins = sprint_wins + $5,
      engine_name = $6
    WHERE id = $7
  `, [d.points, d.wins, d.p2, d.p3, d.sprint_wins, dominantEngine, keepStandingsId]);
  await client.query(`DELETE FROM f1_team_standings WHERE id = $1`, [dropStandingsId]);
  console.log(`${year}: merged team_standings row ${dropStandingsId} into ${keepStandingsId}, engine_name='${dominantEngine}'`);
}

async function repointAndDelete(client, canonicalId, otherIds, label) {
  for (const oldId of otherIds) {
    if (oldId === canonicalId) continue;
    for (const table of REF_TABLES) {
      const r = await client.query(
        `UPDATE ${table} SET team_entity_id = $1 WHERE team_entity_id = $2`,
        [canonicalId, oldId]
      );
      if (r.rowCount) console.log(`${label}: repointed ${r.rowCount} row(s) in ${table} from ${oldId} -> ${canonicalId}`);
    }
  }

  // Verify zero remaining references anywhere before deleting.
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

    await ensureEngineColumn(client);

    // ── McLaren ──
    await backfillEngineNames(client, MCLAREN_ENGINE_MAP, 'McLaren');
    // 1966: keep McLaren Ford row (id 455), drop McLaren Serenissima (id 457)
    await mergeSameSeasonRow(client, 1966, 455, 457, 'Ford');
    // 1968: keep McLaren Ford row (id 471), drop Mclaren BRM (id 479)
    await mergeSameSeasonRow(client, 1968, 471, 479, 'Ford');
    const mclarenOtherIds = Object.keys(MCLAREN_ENGINE_MAP).map(Number).filter(id => id !== MCLAREN_CANONICAL_ID);
    await repointAliasesAndDropDuplicateLogos(client, MCLAREN_CANONICAL_ID, mclarenOtherIds, 'McLaren');
    await repointAndDelete(client, MCLAREN_CANONICAL_ID, mclarenOtherIds, 'McLaren');
    await client.query(
      `UPDATE entities SET canonical_name = 'McLaren', slug = 'mclaren' WHERE id = $1`,
      [MCLAREN_CANONICAL_ID]
    );
    console.log('Renamed entity 74979 -> "McLaren" (slug: mclaren)');

    // ── Red Bull ──
    await backfillEngineNames(client, REDBULL_ENGINE_MAP, 'RedBull');
    const redbullOtherIds = Object.keys(REDBULL_ENGINE_MAP).map(Number).filter(id => id !== REDBULL_CANONICAL_ID);
    await repointAliasesAndDropDuplicateLogos(client, REDBULL_CANONICAL_ID, redbullOtherIds, 'RedBull');
    await repointAndDelete(client, REDBULL_CANONICAL_ID, redbullOtherIds, 'RedBull');
    // No rename needed — 76177 is already "Red Bull Racing".

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
