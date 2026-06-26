// =============================================================
// RANKKS — Download Player Portrait Images
// Downloads missing player photos from API-Sports CDN
// and saves them to /media/athletes/football/male/profile/
//
// Run: node download-portraits.js
// Run dry: node download-portraits.js --dry
// =============================================================

require('dotenv').config({ path: '../.env' });
const fs   = require('fs');
const path = require('path');
const { query } = require('./db');

// ── CONFIG ─────────────────────────────────────────────────────
const PORTRAIT_DIR = path.resolve(
  __dirname,
  '../rankks-api/media/athletes/football/male/profile'
);
const DRY_RUN  = process.argv.includes('--dry');
const DELAY_MS = 150; // ms between downloads — be polite to the CDN

// ── HELPERS ────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

// ── MAIN ───────────────────────────────────────────────────────
async function main() {
  console.log(`\n🖼️  RANKKS — Download Player Portraits`);
  console.log(`   Target dir : ${PORTRAIT_DIR}`);
  console.log(`   Dry run    : ${DRY_RUN}\n`);

  // Ensure target directory exists
  if (!DRY_RUN) {
    fs.mkdirSync(PORTRAIT_DIR, { recursive: true });
  }

  // Get all football players with an external image_url and a slug
  const { rows } = await query(`
    SELECT id, canonical_name, slug, image_url
    FROM entities
    WHERE entity_type = 'player'
      AND image_url IS NOT NULL
      AND image_url LIKE 'http%'
      AND slug IS NOT NULL
    ORDER BY canonical_name
  `);

  console.log(`Found ${rows.length} players with CDN images\n`);

  let downloaded = 0;
  let skipped    = 0;
  let errors     = 0;

  for (const player of rows) {
    const destFile = path.join(PORTRAIT_DIR, `${player.slug}.png`);

    // Skip if local file already exists
    if (fs.existsSync(destFile)) {
      skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY] Would download: ${player.canonical_name} → ${player.slug}.png`);
      downloaded++;
      continue;
    }

    try {
      await downloadImage(player.image_url, destFile);
      downloaded++;
      if (downloaded % 50 === 0) {
        console.log(`  ✅ ${downloaded} downloaded, ${skipped} skipped, ${errors} errors...`);
      }
      await sleep(DELAY_MS);
    } catch (err) {
      errors++;
      console.log(`  ⚠️  Failed: ${player.canonical_name} (${player.image_url}) — ${err.message}`);
    }
  }

  console.log(`\n✅ Done.`);
  console.log(`   Downloaded : ${downloaded}`);
  console.log(`   Skipped    : ${skipped} (already exist)`);
  console.log(`   Errors     : ${errors}\n`);

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});