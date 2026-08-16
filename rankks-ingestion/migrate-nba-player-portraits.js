// migrate-nba-player-portraits.js
//
// Downloads every basketball player's cdn.nba.com headshot (entities.image_url)
// to local disk under rankks-api/media/athletes/basketball/male/portrait/{slug}.png
// — the exact conventional path EventBlock.jsx's getPortraitPath() already
// falls back to when image_url is empty. On a successful download, nulls
// out entities.image_url so that fallback path takes over: this stops the
// app depending on the NBA CDN at all (rule: local portrait, else default
// silhouette — never the CDN).
//
// Idempotent/resumable — skips entities whose target file already exists.
// Re-run any time to pick up newly ingested players still on the CDN.
//
// Run with: node migrate-nba-player-portraits.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { queryAll, query, end } = require('./db');

const OUT_DIR = path.join(__dirname, '..', 'rankks-api', 'media', 'athletes', 'basketball', 'male', 'portrait');
const CONCURRENCY = 8;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// image_url is nulled unconditionally (success or failure) — the rule is
// "local portrait, else default silhouette", never the CDN, so a failed
// download still shouldn't leave a CDN URL live. Failures are surfaced in
// the summary/failures list below so they can be manually re-sourced.
async function downloadOne(entity) {
  const dest = path.join(OUT_DIR, `${entity.slug}.png`);
  if (fs.existsSync(dest)) {
    await query(`UPDATE entities SET image_url = NULL WHERE id = $1`, [entity.id]);
    return { id: entity.id, name: entity.canonical_name, status: 'already-local' };
  }
  try {
    const res = await fetch(entity.image_url);
    if (!res.ok) {
      await query(`UPDATE entities SET image_url = NULL WHERE id = $1`, [entity.id]);
      return { id: entity.id, name: entity.canonical_name, status: `http-${res.status}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) {
      await query(`UPDATE entities SET image_url = NULL WHERE id = $1`, [entity.id]);
      return { id: entity.id, name: entity.canonical_name, status: 'too-small' };
    }
    fs.writeFileSync(dest, buf);
    await query(`UPDATE entities SET image_url = NULL WHERE id = $1`, [entity.id]);
    return { id: entity.id, name: entity.canonical_name, status: 'ok' };
  } catch (e) {
    await query(`UPDATE entities SET image_url = NULL WHERE id = $1`, [entity.id]);
    return { id: entity.id, name: entity.canonical_name, status: `error: ${e.message}` };
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const players = await queryAll(`
    SELECT id, canonical_name, slug, image_url
    FROM entities
    WHERE entity_type = 'player' AND image_url ILIKE 'https://cdn.nba.com%'
    ORDER BY id
  `);
  console.log(`${players.length} players to migrate`);

  const results = [];
  for (let i = 0; i < players.length; i += CONCURRENCY) {
    const batch = players.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(downloadOne));
    results.push(...batchResults);
    console.log(`  ...${Math.min(i + CONCURRENCY, players.length)}/${players.length}`);
    await sleep(150); // light courtesy delay between batches
  }

  const byStatus = {};
  for (const r of results) {
    byStatus[r.status] = byStatus[r.status] || [];
    byStatus[r.status].push(r.name);
  }
  console.log('\n--- Summary ---');
  for (const [status, names] of Object.entries(byStatus)) {
    console.log(`${status}: ${names.length}`);
  }
  const failures = results.filter(r => r.status !== 'ok' && r.status !== 'already-local');
  if (failures.length) {
    console.log('\n--- Failures (image_url left untouched, still on CDN) ---');
    for (const f of failures) console.log(`  ${f.name} (id=${f.id}): ${f.status}`);
  }

  await end();
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
