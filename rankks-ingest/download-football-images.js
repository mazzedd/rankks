// rankks-ingest/download-football-images.js
// Downloads football player images from entities.image_url
// to media/athletes/football/male/{slug}.png
//
// Usage: node download-football-images.js
// Run from rankks-api or rankks-ingest directory

const fs   = require('fs')
const path = require('path')
const https = require('https')
const http  = require('http')

// ── Config ────────────────────────────────────────────────────────────────
const { Pool } = require('pg')
require('dotenv').config({ path: path.join(__dirname, '../rankks-api/.env') })

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 5432,
  database: process.env.DB_NAME     || 'rankks',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
})

// Output folder — adjust path if needed
const OUTPUT_DIR = path.join(__dirname, '../rankks-api/media/athletes/football/male')

// Delay between requests (ms) — be polite to the source server
const DELAY_MS = 150

// ── Helpers ───────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    const file  = fs.createWriteStream(dest)

    const req = proto.get(url, { timeout: 10000 }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        fs.unlinkSync(dest)
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve() })
      file.on('error', err => { fs.unlinkSync(dest); reject(err) })
    })

    req.on('error', err => {
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      reject(err)
    })
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
  })
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  ensureDir(OUTPUT_DIR)

  // Fetch all football players with an image_url and a slug
  const { rows } = await pool.query(`
    SELECT DISTINCT e.id, e.slug, e.canonical_name, e.image_url
    FROM entities e
    JOIN player_season_stats pss ON pss.entity_id = e.id
    WHERE e.entity_type = 'player'
      AND e.image_url IS NOT NULL
      AND e.image_url != ''
      AND e.slug IS NOT NULL
    ORDER BY e.slug
  `)

  console.log(`Found ${rows.length} players with images`)

  let downloaded = 0
  let skipped    = 0
  let failed     = 0

  for (let i = 0; i < rows.length; i++) {
    const { slug, canonical_name, image_url } = rows[i]
    const dest = path.join(OUTPUT_DIR, `${slug}.png`)

    // Skip if already downloaded
    if (fs.existsSync(dest)) {
      skipped++
      continue
    }

    try {
      await downloadFile(image_url, dest)
      downloaded++
      if (downloaded % 50 === 0) {
        console.log(`[${i+1}/${rows.length}] Downloaded ${downloaded}, skipped ${skipped}, failed ${failed}`)
      }
    } catch (err) {
      failed++
      console.warn(`  ✗ ${canonical_name} (${slug}): ${err.message}`)
    }

    await delay(DELAY_MS)
  }

  console.log(`\nDone — downloaded: ${downloaded}, skipped: ${skipped}, failed: ${failed}`)
  await pool.end()
}

main().catch(err => { console.error(err); process.exit(1) })
