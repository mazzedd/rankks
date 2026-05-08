// import-positions.js
// Run from your backend folder: node import-positions.js
// Fetches player positions from API-Football and inserts into player_attributes

require('dotenv').config()
const { Pool } = require('pg')

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
})

const API_KEY    = process.env.API_SPORTS_KEY
const API_BASE   = 'https://v3.football.api-sports.io'
const LEAGUE_ID  = 61   // Ligue 1
const SEASON     = 2021 // Change per season

async function fetchPlayers(page = 1) {
  const res = await fetch(`${API_BASE}/players?league=${LEAGUE_ID}&season=${SEASON}&page=${page}`, {
    headers: {
      'x-apisports-key': API_KEY,
    }
  })
  const json = await res.json()
  return json
}

async function run() {
  const client = await pool.connect()
  try {
    // Get total pages first
    const first = await fetchPlayers(1)
console.log('API response:', JSON.stringify(first, null, 2))
const totalPages = first.paging?.total || 1
console.log(`Total pages: ${totalPages}`)

    let inserted = 0
    let skipped  = 0

    const allPlayers = [...first.response]

    // Fetch remaining pages
    for (let page = 2; page <= totalPages; page++) {
      console.log(`Fetching page ${page}/${totalPages}...`)
      await new Promise(r => setTimeout(r, 300)) // rate limit
      const data = await fetchPlayers(page)
      allPlayers.push(...data.response)
    }

    console.log(`Total players fetched: ${allPlayers.length}`)

    for (const item of allPlayers) {
      const player   = item.player
      const stats    = item.statistics?.[0]
      const position = stats?.games?.position || null

      if (!position) { skipped++; continue }

      // Find entity by API-Sports image URL or name match
      const nameMatch = await client.query(`
        SELECT id FROM entities
        WHERE canonical_name ILIKE $1
        LIMIT 1
      `, [player.name])

      if (!nameMatch.rows.length) { skipped++; continue }

      const entityId = nameMatch.rows[0].id

      // Check if position already exists
const existing = await client.query(`
  SELECT id FROM player_attributes
  WHERE entity_id = $1 AND attribute_key = 'position'
  LIMIT 1
`, [entityId])

if (existing.rows.length) {
  await client.query(`
    UPDATE player_attributes SET attribute_value = $1
    WHERE entity_id = $2 AND attribute_key = 'position'
  `, [position, entityId])
} else {
  await client.query(`
    INSERT INTO player_attributes (entity_id, attribute_key, attribute_value, sport_id, start_year, created_at)
    VALUES ($1, 'position', $2, 1, $3, NOW())
  `, [entityId, position, SEASON])
}

      inserted++
    }

    console.log(`Done. Inserted/updated: ${inserted}, Skipped: ${skipped}`)
  } catch (err) {
    console.error('Error:', err)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
