// backfill-motogp-rider-images.js
// Usage: node backfill-motogp-rider-images.js
//
// Downloads rider portrait images from photos.motogp.com (confirmed present
// for only 216 of 2,539 riders — mostly modern-era; historical riders have
// no digital photo at all in the source, not a scraping gap) and saves them
// to rankks-api/media/athletes/motorcycle/male/profile/{slug}.{ext}, per
// your explicit instruction on the folder convention. Updates
// entities.image_url to the local /media/-prefixed path, matching the
// project-wide rule (EventBlock reads image_url directly, never a raw
// external URL).
//
// Source priority per rider: biography.media.picture (a single canonical
// portrait) first, falling back to the most recent career entry's
// pictures.profile.main (a per-season photo) if no biography picture
// exists — same idea as picking one representative portrait, not one per
// season.
//
// Idempotent: skips any rider whose local file already exists.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { queryAll, query, end } = require('./db');

const RIDERS_DIR = path.join(__dirname, '..', 'rankks-scrap', 'motogp-scraper', 'motogp-raw', 'riders');
const MEDIA_DIR = path.join(__dirname, '..', 'rankks-api', 'media', 'athletes', 'motorcycle', 'male', 'profile');
const DELAY_MS = 400;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) RANKKS-data-import/1.0 (personal project, non-commercial)';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function readJson(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

function pickImageUrl(bio) {
  if (bio?.biography?.media?.picture) return bio.biography.media.picture;
  const lastCareer = bio?.career?.[bio.career.length - 1];
  return lastCareer?.pictures?.profile?.main || null;
}

function extFromUrl(url) {
  const m = url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i);
  return m ? m[1].toLowerCase() : 'jpg';
}

async function downloadImage(url, destPath, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return true;
  } catch (err) {
    if (attempt < 3) { await sleep(1000 * attempt); return downloadImage(url, destPath, attempt + 1); }
    console.warn(`  FAILED: ${url} (${err.message})`);
    return false;
  }
}

async function main() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  const riders = await queryAll(`
    SELECT id, slug, external_ids->>'motogp_rider' AS rider_uuid
    FROM entities WHERE external_ids ? 'motogp_rider'
  `);

  let downloaded = 0, skippedExisting = 0, noImage = 0, updated = 0, failed = 0;

  for (const r of riders) {
    const bio = readJson(path.join(RIDERS_DIR, `${r.rider_uuid}.json`));
    const imageUrl = pickImageUrl(bio);
    if (!imageUrl) { noImage++; continue; }

    const ext = extFromUrl(imageUrl);
    const filename = `${r.slug}.${ext}`;
    const destPath = path.join(MEDIA_DIR, filename);
    const publicPath = `/media/athletes/motorcycle/male/profile/${filename}`;

    if (!fs.existsSync(destPath)) {
      await sleep(DELAY_MS);
      const ok = await downloadImage(imageUrl, destPath);
      if (!ok) { failed++; continue; }
      downloaded++;
    } else {
      skippedExisting++;
    }

    await query(`UPDATE entities SET image_url = $1 WHERE id = $2`, [publicPath, r.id]);
    updated++;
  }

  console.log(`\nDone. ${downloaded} downloaded, ${skippedExisting} already cached, ${updated} entities.image_url updated, ${noImage} riders with no source image, ${failed} download failures.`);
  await end();
}

main().catch(err => { console.error(err); process.exit(1); });
