// Downloads NBA player headshots from cdn.nba.com (the sanctioned portrait
// source per onboarding-nba.md Section 6) into rankks-api/media/athletes/
// basketball/male/, named by firstname-lastname slug (duplicates suffixed
// -1, -2, ...), then updates entities.image_url to the new local path —
// per explicit instruction, so the platform stops depending on the external
// CDN staying up for these images.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MEDIA_DIR = path.join(__dirname, '..', 'rankks-api', 'media', 'athletes', 'basketball', 'male');
const CONCURRENCY = 10;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

function slugify(name) {
  const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
  return name.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

async function main() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const players = await pool.query(`
    SELECT id, canonical_name, external_ids->>'nba_person_id' AS person_id
    FROM entities
    WHERE entity_type = 'player' AND external_ids ? 'nba_person_id'
    ORDER BY id
  `);
  console.log(`${players.rows.length} basketball players with a CDN-sourced personId`);

  // Base slug per player, then number every member of any collision group
  // -1, -2, ... (not "first stays bare") — per explicit instruction.
  const bySlug = new Map();
  for (const p of players.rows) {
    const base = slugify(p.canonical_name);
    if (!bySlug.has(base)) bySlug.set(base, []);
    bySlug.get(base).push(p);
  }
  const filenames = new Map(); // entity id -> filename (no extension)
  for (const [base, group] of bySlug) {
    if (group.length === 1) {
      filenames.set(group[0].id, base);
    } else {
      group.forEach((p, i) => filenames.set(p.id, `${base}-${i + 1}`));
    }
  }

  let ok = 0, failed = 0;
  const queue = [...players.rows];

  async function worker() {
    while (queue.length) {
      const p = queue.shift();
      const filename = filenames.get(p.id);
      const url = `https://cdn.nba.com/headshots/nba/latest/1040x760/${p.person_id}.png`;
      try {
        const buf = await downloadImage(url);
        fs.writeFileSync(path.join(MEDIA_DIR, `${filename}.jpg`), buf);
        await pool.query(
          `UPDATE entities SET image_url = $1 WHERE id = $2`,
          [`media/athletes/basketball/male/${filename}.jpg`, p.id]
        );
        ok++;
      } catch (e) {
        failed++;
        console.log(`  FAILED: ${p.canonical_name} (personId ${p.person_id}) — ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`Done: ${ok} downloaded and linked, ${failed} failed (likely retired-before-CDN players — silhouette fallback applies)`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
