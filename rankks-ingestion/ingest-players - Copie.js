// ingest-players.js — matches actual RANKKS DB schema
// entities table has inline player fields (birth_date, height_cm, weight_kg etc.)
// player_season_stats has individual columns per stat + club_id
// player_attributes is key-value for extra attributes

const { queryOne, query } = require('./db');

async function ingestPlayers(season, config, callApi) {
  console.log(`  👤 Players ${season}...`);

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.leagueSlug]);
  if (!comp) throw new Error(`Competition not found`);

  const seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2`,
    [comp.id, season]
  );
  if (!seasonRow) throw new Error(`Season ${season} not found`);

  // Fetch all pages of players
  let page = 1;
  let totalPages = 1;
  let allPlayers = [];

  do {
    const res = await fetch(
      `${config.baseUrl}/players?league=${config.leagueId}&season=${season}&page=${page}`,
      { headers: { 'x-apisports-key': config.apiKey } }
    );
    const json = await res.json();
    totalPages = json.paging?.total || 1;
    allPlayers = allPlayers.concat(json.response || []);
    console.log(`     Page ${page}/${totalPages} (${json.response?.length || 0} players)`);
    page++;
    await sleep(350); // respect rate limit
  } while (page <= totalPages);

  console.log(`     Total: ${allPlayers.length} players`);

  let created = 0, updated = 0, statsUpserted = 0;

  for (const item of allPlayers) {
    const p    = item.player;
    const stats = item.statistics || [];
    if (!p?.id) continue;

    // ── 1. Find or create player entity ──────────────────────
    // First try by external_ids jsonb field
    let entity = await queryOne(
      `SELECT id FROM entities WHERE entity_type = 'player'
       AND external_ids->>'api_sports' = $1`,
      [String(p.id)]
    );

    if (!entity) {
  // Try by name
  entity = await queryOne(
    `SELECT id FROM entities WHERE entity_type = 'player'
     AND canonical_name ILIKE $1`,
    [p.name]
  );
}

if (!entity) {
  // Try by slug (catches players created before ID suffix was added)
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + p.id;
  entity = await queryOne(
    `SELECT id FROM entities WHERE slug = $1`,
    [slug]
  );
}

if (!entity) {
  // Create new player
      entity = await queryOne(
       `INSERT INTO entities (
   canonical_name, slug, entity_type,
   birth_date, height_cm, weight_kg,
   image_url, external_ids,
   is_active, is_verified
 ) VALUES ($1, $2, 'player', $3, $4, $5, $6, $7, true, false)
 RETURNING id`,
[
  p.name,
  p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + p.id,
  p.birth?.date  || null,
  parseHeight(p.height),
  parseWeight(p.weight),
  p.photo || null,
  JSON.stringify({ api_sports: String(p.id) }),
],
      );
      created++;
    } else {
      // Update existing player with latest info
      await query(
        `UPDATE entities SET
           birth_date  = COALESCE($1, birth_date),
           height_cm   = COALESCE($2, height_cm),
           weight_kg   = COALESCE($3, weight_kg),
           image_url   = COALESCE(image_url, $4),
           external_ids = COALESCE(external_ids, '{}'::jsonb) || $5::jsonb,
           updated_at  = NOW()
         WHERE id = $6`,
        [
          p.birth?.date  || null,
          parseHeight(p.height),
          parseWeight(p.weight),
          p.photo || null,
          JSON.stringify({ api_sports: String(p.id) }),
          entity.id,
        ]
      );
      updated++;
    }

    // Store nationality as player_attribute (key-value table)
    if (p.nationality) {
      const sportRow = await queryOne(`SELECT id FROM sports WHERE slug = 'football'`);
      await query(
        `INSERT INTO player_attributes (entity_id, sport_id, attribute_key, attribute_value)
         VALUES ($1, $2, 'nationality', $3)
         ON CONFLICT (entity_id, sport_id, attribute_key) DO UPDATE
         SET attribute_value = EXCLUDED.attribute_value`,
        [entity.id, sportRow?.id, p.nationality]
      ).catch(() => {}); // ignore if no unique constraint yet
    }

    // ── 2. Upsert player_season_stats per club ────────────────
    for (const s of stats) {
      if (!s.team?.id) continue;

      // Find club entity
      const club = await queryOne(
        `SELECT id FROM entities WHERE entity_type = 'club'
         AND canonical_name ILIKE $1`,
        [s.team.name]
      );
      if (!club) continue;

      // Upsert using actual column names
      await query(
        `INSERT INTO player_season_stats (
           entity_id, season_id, club_entity_id,
           games_played, goals, assists,
           yellow_cards, red_cards, minutes_played, stats
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (entity_id, season_id, club_entity_id) DO UPDATE SET
           games_played   = EXCLUDED.games_played,
           goals          = EXCLUDED.goals,
           assists        = EXCLUDED.assists,
           yellow_cards   = EXCLUDED.yellow_cards,
           red_cards      = EXCLUDED.red_cards,
           minutes_played = EXCLUDED.minutes_played,
           stats          = EXCLUDED.stats,
           updated_at     = NOW()`,
        [
          entity.id,
          seasonRow.id,
          club.id,
          s.games?.appearences || 0,
          s.goals?.total       || 0,
          s.goals?.assists     || 0,
          s.cards?.yellow      || 0,
          s.cards?.red         || 0,
          s.games?.minutes     || 0,
          JSON.stringify({
            shots_total:       s.shots?.total || 0,
            shots_on:          s.shots?.on || 0,
            passes_total:      s.passes?.total || 0,
            passes_key:        s.passes?.key || 0,
            pass_accuracy:     s.passes?.accuracy || null,
            dribbles_attempts: s.dribbles?.attempts || 0,
            dribbles_success:  s.dribbles?.success || 0,
            tackles:           s.tackles?.total || 0,
            blocks:            s.tackles?.blocks || 0,
            interceptions:     s.tackles?.interceptions || 0,
            fouls_drawn:       s.fouls?.drawn || 0,
            fouls_committed:   s.fouls?.committed || 0,
            yellow_red:        s.cards?.yellowred || 0,
            penalties_scored:  s.penalty?.scored || 0,
            penalties_missed:  s.penalty?.missed || 0,
            rating:            parseFloat(s.games?.rating) || null,
            position:          s.games?.position || null,
            captain:           s.games?.captain || false,
          }),
        ]
      );
      statsUpserted++;
    }
  }

  console.log(`     ✅ Players: ${created} created, ${updated} updated, ${statsUpserted} stat rows upserted`);
}

function parseHeight(h) {
  if (!h) return null;
  const m = h.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function parseWeight(w) {
  if (!w) return null;
  const m = w.match(/(\d+)/);
  return m ? parseInt(m[1]) : null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = { ingestPlayers };
