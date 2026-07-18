// lib/entities.js
// Resolves F1 drivers/teams to entities.id, creating rows as needed.
//
// Stable external key: for drivers, F1.com's own driver code from the
// URL (e.g. 'MICSCH01') — confirmed stable across all years for the
// same person. For teams, the URL slug (e.g. 'Ferrari', 'BAR-Honda') —
// per the locked decision, one entity per exact team-name string, so
// this slug already IS the correct uniqueness key.
//
// Cache is preloaded once at startup so we don't hit Postgres per row
// across ~9,000 files.

async function loadCache(pool) {
  const cache = new Map(); // `${entityType}:${externalKey}` -> entity id
  const { rows } = await pool.query(
    `SELECT id, entity_type, external_ids FROM entities WHERE external_ids ? 'f1_driver' OR external_ids ? 'f1_team'`
  );
  for (const r of rows) {
    const key = r.external_ids.f1_driver
      ? `driver:${r.external_ids.f1_driver}`
      : `f1_team:${r.external_ids.f1_team}`;
    cache.set(key, r.id);
  }
  console.log(`  entity cache preloaded: ${cache.size} existing F1 entities`);
  return cache;
}

async function getOrCreateEntity(pool, cache, { entityType, externalKey, canonicalName, slug }) {
  const cacheKey = `${entityType}:${externalKey}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const field = entityType === 'driver' ? 'f1_driver' : 'f1_team';
  const isRealCode = !externalKey.startsWith('nameonly:');

  // If this is a real code (not a nameonly fallback) and a placeholder
  // entity already exists with this exact name, UPGRADE that row rather
  // than creating a new one. This is the gap that let e.g. Sebastian
  // Vettel (one-off 2006 practice session, no standings entry that year
  // → nameonly placeholder created) get duplicated in 2007 when his real
  // driver code appeared for the first time on that year's standings page.
  if (isRealCode) {
    const placeholder = await pool.query(
      `SELECT id FROM entities WHERE entity_type = $1 AND canonical_name = $2 AND external_ids->>'${field}' LIKE 'nameonly:%' LIMIT 1`,
      [entityType, canonicalName]
    );
    if (placeholder.rows.length) {
      const id = placeholder.rows[0].id;
      await pool.query(
        `UPDATE entities SET external_ids = jsonb_set(external_ids, '{${field}}', to_jsonb($1::text)), slug = $2 WHERE id = $3`,
        [externalKey, slug, id]
      );
      cache.set(cacheKey, id);
      return id;
    }
  }

  let trySlug = slug;
  for (let attempt = 0; attempt < 3; attempt++) {
    let insertResult;
    try {
      insertResult = await pool.query(
        `INSERT INTO entities (entity_type, canonical_name, slug, external_ids)
         VALUES ($1, $2, $3, jsonb_build_object('${field}', $4::text))
         ON CONFLICT ((external_ids->>'${field}')) WHERE (external_ids ? '${field}') DO NOTHING
         RETURNING id`,
        [entityType, canonicalName, trySlug, externalKey]
      );
    } catch (err) {
      if (err.code === '23505') {
        // Some OTHER unique constraint fired (most likely entities.slug,
        // a separate constraint from the external_ids index above, so
        // ON CONFLICT here didn't suppress it). Retry with a modified slug.
        trySlug = `${slug}-f1${attempt > 0 ? attempt + 1 : ''}`;
        continue;
      }
      throw err;
    }

    if (insertResult.rows.length) {
      // We won the race — genuinely new row.
      const id = insertResult.rows[0].id;
      cache.set(cacheKey, id);
      await pool.query(
        `INSERT INTO entity_aliases (entity_id, alias, source, alias_type) VALUES ($1, $2, 'f1_scrape', 'name')
         ON CONFLICT (alias, source) DO NOTHING`,
        [id, canonicalName]
      );
      return id;
    }

    // ON CONFLICT DO NOTHING fired on the external_ids index — the row
    // already exists (created by an earlier call or an earlier run).
    // Fetch it; this is the DB-level source of truth now, not the cache.
    const existing = await pool.query(
      `SELECT id FROM entities WHERE external_ids->>'${field}' = $1 LIMIT 1`,
      [externalKey]
    );
    if (existing.rows.length) {
      cache.set(cacheKey, existing.rows[0].id);
      return existing.rows[0].id;
    }
    // Row disappeared between conflict and select (shouldn't happen in
    // practice) — fall through and retry.
  }
  throw new Error(`Could not create entity for ${canonicalName} after 3 attempts`);
}

module.exports = { loadCache, getOrCreateEntity };
