// One-off migration: basketball player images currently live flat at
// media/athletes/basketball/male/{slug}.jpg (actually PNG bytes under a
// .jpg name — a quirk of import-nba-portraits.js's download step). Splits
// them into the profile/portrait subfolder convention already used by
// football/tennis (see players_template.jsx's `/profile/${slug}.png` and
// EventBlock.jsx's getPortraitPath `/portrait/${slug}.png`), so those
// conventional paths resolve on the first request instead of falling
// through to entities.image_url every time.
//
// profile/{slug}.png — 150x150, white background, cover-cropped on the
//   face/head (top of the source image) to match football's avatar chip.
// portrait/{slug}.png — fit within 1000x1000, transparent background
//   preserved, matching football's banner portrait treatment. Same source
//   photo for both crops — NBA CDN only provides one headshot per player.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC_DIR      = path.join(__dirname, '..', 'rankks-api', 'media', 'athletes', 'basketball', 'male');
const PROFILE_DIR  = path.join(SRC_DIR, 'profile');
const PORTRAIT_DIR = path.join(SRC_DIR, 'portrait');

async function main() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.mkdirSync(PORTRAIT_DIR, { recursive: true });

  const files = fs.readdirSync(SRC_DIR).filter(f => fs.statSync(path.join(SRC_DIR, f)).isFile());
  console.log(`${files.length} source images found`);

  let ok = 0, failed = 0;
  for (const file of files) {
    const slug = file.replace(/\.[^.]+$/, '');
    const srcPath = path.join(SRC_DIR, file);
    try {
      await sharp(srcPath)
        .resize(150, 150, { fit: 'cover', position: 'top', background: '#ffffff' })
        .flatten({ background: '#ffffff' })
        .png()
        .toFile(path.join(PROFILE_DIR, `${slug}.png`));

      await sharp(srcPath)
        .resize(1000, 1000, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(path.join(PORTRAIT_DIR, `${slug}.png`));

      ok++;
    } catch (e) {
      failed++;
      console.log(`  FAILED: ${file} — ${e.message}`);
    }
  }

  console.log(`Done: ${ok} converted, ${failed} failed`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
