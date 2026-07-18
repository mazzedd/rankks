// One-time reconciliation pass for the duplicate-entity gap documented in
// nba-player-lookup.js: PlayerStatisticsExtended.csv (personId-keyed, used
// by ingest-nba-player-boxscores.js) and Player Award Shares/EOST/Career
// Info (bref_player_id-keyed, used by ingest-nba-awards.js/eost.js) have no
// shared join key, so every award/EOST candidate who wasn't already in the
// box-score set got a SECOND entity created for them — same real player,
// two rows. Effect: Awards-tab pages show that player with no photo, no
// Min/Pts (the box-score fallback join in results.js keys on entity_id,
// which now differs), since their award data lives on the "wrong" entity.
//
// Matches by accent-normalized canonical_name — the box-score dataset
// stores names without diacritics ("Luka Doncic"), the bref-sourced
// dataset keeps them ("Luka Dončić"), so an exact-match pass alone missed
// every accented player (Dončić, Bogdanović, Vučević, Porziņģis, Schröder,
// Şengün, Šarić, Bertāns, Dragić, Hernangómez, Satoranský, Mirotić,
// Teletović, Nurkić — 15 found on the first run of this normalized
// version). Assumes anyone genuinely sharing a full name would be a rare,
// checkable exception — confirmed exactly one such case: "Jason Smith",
// two different real players, correctly left alone since person_cnt=2/
// bref_cnt=0 doesn't match the merge shape.
function normalizeName(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    // Third mismatch class found: "Robert Williams III" (box scores) vs
    // "Robert Williams" (bref-sourced, no suffix). Safe to strip since this
    // only merges when the normalized group has exactly one person-row and
    // one bref-row — a real Jr./Sr. pair of different players would show up
    // as an ambiguous 2-person or 2-bref group instead, and get skipped.
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '');
}

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // Scoped to basketball entities only (nba_person_id or bref_player_id) —
  // entities is shared across every sport, and other sports' name-collision
  // patterns (accented vs non-accented api_sports players, e.g. football's
  // "M. Diaz"/"M. Díaz") aren't this script's concern.
  const rows = await pool.query(`
    SELECT id, canonical_name, external_ids FROM entities
    WHERE entity_type = 'player' AND (external_ids ? 'nba_person_id' OR external_ids ? 'bref_player_id')
  `);
  const byName = new Map();
  for (const r of rows.rows) {
    const key = normalizeName(r.canonical_name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }

  const clean = [];
  const skippedAmbiguous = [];
  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const personRows = group.filter(r => r.external_ids?.nba_person_id && !r.external_ids?.bref_player_id);
    const brefRows = group.filter(r => r.external_ids?.bref_player_id && !r.external_ids?.nba_person_id);
    if (group.length === 2 && personRows.length === 1 && brefRows.length === 1) {
      clean.push({ canonical_name: name, person_id: personRows[0].id, bref_id: brefRows[0].id });
    } else {
      skippedAmbiguous.push({ canonical_name: name, person_cnt: personRows.length, bref_cnt: brefRows.length, total: group.length });
    }
  }

  console.log(`${byName.size} normalized-name groups checked — ${clean.length} clean pairs, ${skippedAmbiguous.length} ambiguous (left alone)`);
  skippedAmbiguous.forEach(g => console.log(`  ambiguous, skipped: ${g.canonical_name} (person=${g.person_cnt}, bref=${g.bref_cnt}, total=${g.total})`));

  let merged = 0, conflicts = 0;

  for (const g of clean) {
    const { person_id: personId, bref_id: brefId, canonical_name: name } = g;

    // Guard against uq_player_season_club (entity_id, season_id, club_entity_id) —
    // NULLs never collide (award rows always have club_entity_id NULL, real
    // value lives in stats jsonb instead per the existing convention), so this
    // only fires if the two entities somehow share a real club_entity_id row
    // for the same season, which would mean they aren't actually the same
    // player after all.
    const conflict = await pool.query(`
      SELECT 1 FROM player_season_stats a
      JOIN player_season_stats b
        ON a.season_id = b.season_id
        AND a.club_entity_id IS NOT NULL
        AND a.club_entity_id = b.club_entity_id
      WHERE a.entity_id = $1 AND b.entity_id = $2
      LIMIT 1
    `, [personId, brefId]);
    if (conflict.rows.length) {
      console.log(`  CONFLICT, skipped: ${name} (person=${personId}, bref=${brefId})`);
      conflicts++;
      continue;
    }

    if (dryRun) { merged++; continue; }

    await pool.query('BEGIN');
    try {
      // Backfill whatever the person-entity is missing from the bref-entity
      // (birth_date/height/weight come from Career Info CSV via bref lookup;
      // the box-score entity never sets those) and merge external_ids so the
      // surviving row carries both source ids.
      await pool.query(`
        UPDATE entities e SET
          birth_date = COALESCE(e.birth_date, b.birth_date),
          height_cm  = COALESCE(e.height_cm, b.height_cm),
          weight_kg  = COALESCE(e.weight_kg, b.weight_kg),
          image_url  = COALESCE(e.image_url, b.image_url),
          external_ids = e.external_ids || b.external_ids
        FROM entities b
        WHERE e.id = $1 AND b.id = $2
      `, [personId, brefId]);

      await pool.query(`UPDATE player_season_stats SET entity_id = $1 WHERE entity_id = $2`, [personId, brefId]);

      // player_attributes has its own UNIQUE(entity_id, sport_id, attribute_key) —
      // if the person-entity already has that attribute, drop the bref-entity's
      // duplicate instead of updating into a collision.
      await pool.query(`
        DELETE FROM player_attributes pa_b
        USING player_attributes pa_p
        WHERE pa_b.entity_id = $2 AND pa_p.entity_id = $1
          AND pa_b.sport_id = pa_p.sport_id AND pa_b.attribute_key = pa_p.attribute_key
      `, [personId, brefId]);
      await pool.query(`UPDATE player_attributes SET entity_id = $1 WHERE entity_id = $2`, [personId, brefId]);

      await pool.query(`DELETE FROM entities WHERE id = $1`, [brefId]);

      await pool.query('COMMIT');
      merged++;
    } catch (e) {
      await pool.query('ROLLBACK');
      console.log(`  ERROR merging ${name} (person=${personId}, bref=${brefId}): ${e.message}`);
    }
  }

  console.log(`${dryRun ? '[DRY RUN] would merge' : 'Merged'}: ${merged}, conflicts skipped: ${conflicts}`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
