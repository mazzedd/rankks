// One-off backfill: populate f1_team_standings.engine_name for every team
// entity that was NOT part of the McLaren/Red Bull/Williams/etc. merge
// migrations (migrate-f1-merge-team-engines.js, migrate-f1-merge-more-teams.js).
// Those 13 teams got engine_name from their own scraped name fragments
// during the merge. Every other F1 team entity is still a single,
// unmerged entity per name-era, so this is a plain UPDATE — no entity
// merging, no FK repointing, no deletes.
//
// Mapping was derived from real F1 engine-supplier history (verified via
// web search for the ambiguous/sponsor-badged cases — see conversation
// with Mohamed, 2026-07-26). Three entities are renamed first because
// their canonical_name currently bakes in a SPONSOR badge rather than the
// real engine manufacturer (Sauber Petronas, Prost Acer, Force India
// Sahara) — left as-is, combineTeamEngine() in rankks-api/src/routes/f1.js
// would append the real engine and produce a nonsense double name like
// "Sauber Petronas Ferrari".
//
// Re-runnable: only touches engine_name where NULL, only renames if the
// current name still matches the old sponsor-badged string.
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

// entity_id -> real engine manufacturer for every row of that entity that
// currently has engine_name IS NULL.
const ENGINE_MAP = {
  74968: 'Ferrari',
  74971: 'Honda',
  74973: 'Renault',
  74977: 'Toyota',
  74984: 'Ferrari',       // "Sauber Petronas" — Ferrari 046 V10, badged Petronas as sponsor
  74987: 'Cosworth',
  75021: 'Peugeot',
  75030: 'Ferrari',       // "Prost Acer" — year-old Ferrari 049, badged Acer as sponsor
  75058: 'Honda',
  75059: 'BMW',
  75064: 'Cosworth',
  75066: 'Toyota',
  75067: 'Honda',
  75086: 'Ferrari',
  75088: 'Ferrari',
  75093: 'Ferrari',
  75094: 'Mercedes',
  75097: 'Mercedes',
  75102: 'Mercedes',
  75103: 'Ferrari',
  75106: 'Cosworth',
  75108: 'Cosworth',
  75111: 'Cosworth',
  75116: 'Alfa Romeo',
  75127: 'Maserati',
  75223: 'BRM',
  75389: 'Vanwall',
  75455: 'Climax',
  75457: 'Porsche',
  75487: 'Honda',         // Aston Martin 2026 works partnership
  75560: 'Climax',
  75562: 'BRM',
  75584: 'BRM',
  75600: 'Ford',
  75625: 'Climax',
  75626: 'Weslake',
  75648: 'Ford',
  75660: 'Matra',
  75690: 'Ford',
  75721: 'Tecno',
  75728: 'Ford',
  75730: 'Ford',
  75735: 'Ford',
  75740: 'Ford',
  75742: 'Ford',
  75761: 'Ford',
  75763: 'Ford',
  75766: 'Ford',
  75768: 'Ford',
  75771: 'Ford',
  75808: 'Ford',
  75824: 'Ford',
  75828: 'Ford',
  75845: 'Ford',
  75859: 'Hart',
  75871: 'Renault',
  75879: 'Alfa Romeo',
  75903: 'Zakspeed',
  75913: 'Honda',
  75919: 'Ford',
  75932: 'Ford',
  75939: 'Ford',
  75944: 'Judd',
  75945: 'Ford',
  75946: 'Lamborghini',
  75961: 'Judd',
  75962: 'Lamborghini',
  75972: 'Judd',
  75974: 'Ilmor',
  75989: 'Mugen Honda',
  75991: 'Ferrari',
  75995: 'Lamborghini',
  76005: 'Ilmor',         // "Sauber" 1993, bare name — Ilmor-built, only rebadged Mercedes-Benz from 1994
  76006: 'Lamborghini',
  76015: 'Mercedes',
  76016: 'Ford',
  76018: 'Ford',
  76031: 'Ford',
  76033: 'Hart',
  76040: 'Mugen Honda',
  76042: 'Ford',
  76048: 'Arrows',        // 1998-99 in-house Hart-derived engine, produced under Arrows' own name
  76063: 'Renault',
  76064: 'Cosworth',
  76079: 'Renault',
  76080: 'Ferrari',
  76093: 'Mercedes',
  76099: 'Ferrari',
  76100: 'Ferrari',
  76102: 'Mercedes',
  76109: 'Renault',       // 2017 "Toro Rosso" bare — Renault, badge dropped for political reasons
  76116: 'Honda',
  76117: 'Mercedes',      // "Force India Sahara" — Sahara was the title sponsor, engine was Mercedes
  76123: 'Mercedes',
  76124: 'Ferrari',
  76126: 'Honda',
  76131: 'Renault',
  76132: 'Mercedes',
  76138: 'Ferrari',
  76139: 'Mercedes',
  76140: 'RBPT',
  76153: 'Honda RBPT',
  76159: 'Honda RBPT',
  76161: 'Ferrari',
  76167: 'Honda RBPT',    // Racing Bulls 2025
  76178: 'Mercedes',      // Alpine 2026 — Renault shut down its own engine program
  76179: 'Red Bull Ford', // Racing Bulls 2026
  76180: 'Audi',
  76182: 'Ferrari',       // Cadillac 2026 — customer Ferrari deal for its first 3 seasons
};

// entity_id -> {from, to} — rename canonical_name where the current name
// carries a sponsor badge, not the engine, so the display doesn't become
// a nonsense double name once combineTeamEngine() appends the real engine.
const RENAMES = {
  74984: { from: 'Sauber Petronas', to: 'Sauber' },
  75030: { from: 'Prost Acer', to: 'Prost' },
  76117: { from: 'Force India Sahara', to: 'Force India' },
};

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [entityId, { from, to }] of Object.entries(RENAMES)) {
      const r = await client.query(
        `UPDATE entities SET canonical_name = $1 WHERE id = $2 AND canonical_name = $3`,
        [to, entityId, from]
      );
      if (r.rowCount) console.log(`Renamed entity ${entityId}: "${from}" -> "${to}"`);
      else console.log(`Entity ${entityId} already renamed or name mismatch — skipping`);
    }

    let totalUpdated = 0;
    for (const [entityId, engine] of Object.entries(ENGINE_MAP)) {
      const r = await client.query(
        `UPDATE f1_team_standings SET engine_name = $1 WHERE team_entity_id = $2 AND engine_name IS NULL`,
        [engine, entityId]
      );
      if (r.rowCount) {
        console.log(`Entity ${entityId}: backfilled engine_name='${engine}' (${r.rowCount} row(s))`);
        totalUpdated += r.rowCount;
      }
    }

    const remaining = await client.query(`SELECT COUNT(*) AS n FROM f1_team_standings WHERE engine_name IS NULL`);
    console.log(`\nTotal rows updated: ${totalUpdated}`);
    console.log(`Remaining NULL engine_name rows: ${remaining.rows[0].n}`);

    await client.query('COMMIT');
    console.log('Migration committed successfully.');
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
