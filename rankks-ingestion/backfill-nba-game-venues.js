// Backfills games.venue/venue_city/venue_country_id for every NBA game that
// doesn't already have one (Regular Season/Playoffs/Finals/Play-in/NBA Cup —
// All-Star already has real per-game venue data from
// ingest-nba-all-star-results.js and is left untouched here).
//
// A regular home game is played at the home team's arena for that season's
// year — resolved from entity_venues (see ingest-nba-arenas.js), which must
// be populated first. NBA Cup is the one exception: Quarterfinals are played
// at the home team's arena like any other game, but Semifinals and the
// Final are played at a fixed neutral Las Vegas venue regardless of which
// team is "home" in the bracket sense — see NEUTRAL_SITE below.
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const COMPETITION_ID = 4828;

// T-Mobile Arena, Las Vegas has hosted every NBA Cup semifinal/final for
// all three seasons run so far (2023-24 through 2025-26). Starting 2026-27
// the semifinals move to the higher-seeded team's home arena (only the
// final stays at a neutral site) — this constant will need updating once
// that season is ingested.
const NEUTRAL_SITE = { venue: 'T-Mobile Arena', venue_city: 'Las Vegas, NV', countryId: 91 };

async function main() {
  const games = await pool.query(`
    SELECT g.id, g.home_entity_id, g.round, e.slug AS event_slug, s.year
    FROM games g
    JOIN result_tabs rt ON rt.id = g.result_tab_id
    JOIN seasons s ON s.id = rt.season_id
    JOIN events e ON e.id = s.event_id
    WHERE s.competition_id = $1
      AND e.slug IN ('regular-season-4828', 'playoffs-4828', 'finals-4828', 'play-in-4828', 'nba-cup-4828')
      AND g.venue IS NULL
      AND g.home_entity_type = 'club'
  `, [COMPETITION_ID]);

  let updated = 0;
  let skippedNoArena = 0;
  const missingArenaEntities = new Set();

  for (const g of games.rows) {
    const isNeutral = g.event_slug === 'nba-cup-4828' && (g.round === 'Semifinal' || g.round === 'Final');

    if (isNeutral) {
      await pool.query(
        `UPDATE games SET venue = $1, venue_city = $2, venue_country_id = $3 WHERE id = $4`,
        [NEUTRAL_SITE.venue, NEUTRAL_SITE.venue_city, NEUTRAL_SITE.countryId, g.id]
      );
      updated++;
      continue;
    }

    const arena = await pool.query(`
      SELECT venue, venue_city, venue_country_id
      FROM entity_venues
      WHERE entity_id = $1 AND start_year <= $2 AND (end_year IS NULL OR end_year >= $2)
      ORDER BY start_year DESC
      LIMIT 1
    `, [g.home_entity_id, g.year]);

    if (!arena.rows.length) {
      skippedNoArena++;
      missingArenaEntities.add(`${g.home_entity_id}@${g.year}`);
      continue;
    }

    const { venue, venue_city, venue_country_id } = arena.rows[0];
    await pool.query(
      `UPDATE games SET venue = $1, venue_city = $2, venue_country_id = $3 WHERE id = $4`,
      [venue, venue_city, venue_country_id, g.id]
    );
    updated++;
  }

  console.log(`Updated ${updated} games.`);
  if (skippedNoArena) {
    console.log(`Skipped ${skippedNoArena} games — no matching entity_venues row (entity@year): ${[...missingArenaEntities].slice(0, 20).join(', ')}${missingArenaEntities.size > 20 ? ', ...' : ''}`);
  }
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
