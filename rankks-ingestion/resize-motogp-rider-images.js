// resize-motogp-rider-images.js
// One-off fix: the 216 rider images just downloaded from photos.motogp.com
// turned out to be unoptimized original press photos (some 5-6MB each,
// 393MB total for the folder — vs F1's own profile folder at 548KB for a
// similar rider count). No CDN resize param exists (confirmed: ?w=/
// ?width=/?resize=/?size= all ignored, same content-length every time).
//
// Reprocesses each file in place to match the established "profile" image
// convention (same settings as migrate-nba-portrait-folders.js: 150x150,
// cover-crop from the top, white background, PNG) — mirroring the existing
// convention rather than inventing new sizing rules. Renames to .png and
// updates entities.image_url to match, since sharp re-encodes everyone to
// PNG regardless of source format.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { queryAll, query, end } = require('./db');

const DIR = path.join(__dirname, '..', 'rankks-api', 'media', 'athletes', 'motorcycle', 'male', 'profile');

async function main() {
  const files = fs.readdirSync(DIR).filter(f => fs.statSync(path.join(DIR, f)).isFile());
  console.log(`${files.length} files to reprocess`);

  let ok = 0, failed = 0;
  for (const file of files) {
    const slug = file.replace(/\.[^.]+$/, '');
    const srcPath = path.join(DIR, file);
    const tmpPath = path.join(DIR, `${slug}.tmp.png`);
    const finalPath = path.join(DIR, `${slug}.png`);
    try {
      const buf = fs.readFileSync(srcPath);
      await sharp(buf)
        .resize(150, 150, { fit: 'cover', position: 'top', background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .png()
        .toFile(tmpPath);

      if (srcPath !== finalPath) fs.unlinkSync(srcPath);
      fs.renameSync(tmpPath, finalPath);

      await query(
        `UPDATE entities SET image_url = $1 WHERE image_url = $2`,
        [`/media/athletes/motorcycle/male/profile/${slug}.png`, `/media/athletes/motorcycle/male/profile/${file}`]
      );
      ok++;
    } catch (e) {
      failed++;
      console.log(`  FAILED: ${file} — ${e.message}`);
    }
  }

  console.log(`\nDone. ${ok} resized, ${failed} failed.`);
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
