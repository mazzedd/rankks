// =============================================================
// RANKKS — Sync Club Logos From Folder
// Reads every .svg in media/logos/clubs/football/<country>/ and, for each
// file whose name (minus extension) matches a club entity's slug exactly,
// fills entities.image_url + entity_logos.logo_url from that filename —
// same convention as portrait paths (slug.png), same fields the admin
// panel's PUT /clubs/:id route writes.
//
// Run: node sync-club-logos.js <country-folder>
// Example: node sync-club-logos.js portugal
// Dry run: node sync-club-logos.js portugal --dry
// =============================================================

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { query, pool } = require('./db');

const country = process.argv[2];
const DRY_RUN = process.argv.includes('--dry');

if (!country) {
  console.error('Usage: node sync-club-logos.js <country-folder> [--dry]');
  process.exit(1);
}

const LOGO_DIR = path.resolve(__dirname, `../rankks-api/media/logos/clubs/football/${country}`);

const DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g');

function normalize(name) {
  return name
    .normalize('NFD').replace(DIACRITICS_RE, '') // strip accents
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function main() {
  if (!fs.existsSync(LOGO_DIR)) {
    console.error(`No such folder: ${LOGO_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(LOGO_DIR).filter(f => f.toLowerCase().endsWith('.svg'));
  console.log(`\n🖼️  Syncing club logos — ${country} (${files.length} file(s) found)\n`);

  let matched = 0, unmatched = 0, upToDate = 0;

  for (const file of files) {
    const slug = file.replace(/\.svg$/i, '');
    const logoUrl = `logos/clubs/football/${country}/${file}`;
    const mediaPath = `/media/${logoUrl}`;

    let { rows } = await query(
      `SELECT id, canonical_name, image_url FROM entities WHERE entity_type = 'club' AND slug = $1`,
      [slug]
    );

    // Fallback: some logo filenames use the club's full official name
    // (e.g. "academica-de-coimbra.svg") while canonical_name in the DB is
    // the shorter API-Sports form ("Academica") — match against
    // entity_aliases instead, normalizing both sides the same way (strip
    // diacritics, lowercase, hyphenate) so "Académica de Coimbra" lines up
    // with the accent-stripped filename.
    if (!rows.length) {
      const aliasRows = await query(
        `SELECT e.id, e.canonical_name, e.image_url, ea.alias
         FROM entities e JOIN entity_aliases ea ON ea.entity_id = e.id
         WHERE e.entity_type = 'club'`
      );
      const match = aliasRows.rows.find(r => normalize(r.alias) === slug);
      if (match) rows = [match];
    }

    if (!rows.length) {
      console.log(`  ⚠️  No club entity with slug "${slug}" — skipping ${file}`);
      unmatched++;
      continue;
    }

    const club = rows[0];
    if (club.image_url === mediaPath) {
      console.log(`  ✓  ${club.canonical_name} already up to date`);
      upToDate++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY] Would set ${club.canonical_name} (id ${club.id}) -> ${mediaPath}`);
      matched++;
      continue;
    }

    await query(`UPDATE entities SET image_url = $1, updated_at = NOW() WHERE id = $2`, [mediaPath, club.id]);

    const existing = await query(`SELECT id FROM entity_logos WHERE entity_id = $1 AND is_current = true`, [club.id]);
    if (existing.rows.length) {
      await query(`UPDATE entity_logos SET logo_url = $1 WHERE entity_id = $2 AND is_current = true`, [logoUrl, club.id]);
    } else {
      await query(
        `INSERT INTO entity_logos (entity_id, logo_url, is_current, start_year) VALUES ($1, $2, true, EXTRACT(YEAR FROM NOW())::int)`,
        [club.id, logoUrl]
      );
    }

    console.log(`  ✅ ${club.canonical_name} -> ${mediaPath}`);
    matched++;
  }

  console.log(`\n✅ Done. Matched: ${matched}, Up to date: ${upToDate}, Unmatched files: ${unmatched}\n`);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
