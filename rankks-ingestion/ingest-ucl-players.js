// ingest-ucl-players.js
// Adapted directly from the real, working ingest-players.js (Ligue 1).
// Same entities/player_season_stats/player_attributes schema and upsert
// logic — only the season lookup differs, since UCL stores year as the
// END year (year_convention='end') with event_id always NULL for the
// main competition row, vs Ligue 1's simpler start-year lookup.
const { queryOne, query } = require('./db');

async function ingestPlayers(season, config, callApi) {
  console.log(`  👤 Players ${season}...`);

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.competitionSlug]);
  if (!comp) throw new Error(`Competition not found`);

  const dbYear = season + 1;
  const seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND event_id IS NULL`,
    [comp.id, dbYear]
  );
  if (!seasonRow) throw new Error(`Season ${dbYear} not found — run 'structure' first`);

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

  let created = 0, updated = 0, statsUpserted = 0, clubSkipped = 0, qualifyingSkipped = 0;

  for (const item of allPlayers) {
    const p     = item.player;
    const stats = item.statistics || [];
    if (!p?.id) continue;

    // ── 1. Find or create player entity ──────────────────────
    let entity = await queryOne(
      `SELECT id FROM entities WHERE entity_type = 'player'
       AND external_ids->>'api_sports' = $1`,
      [String(p.id)]
    );

    if (!entity) {
      entity = await queryOne(
        `SELECT id FROM entities WHERE entity_type = 'player'
         AND canonical_name ILIKE $1`,
        [p.name]
      );
    }

    if (!entity) {
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + p.id;
      entity = await queryOne(
        `SELECT id FROM entities WHERE slug = $1`,
        [slug]
      );
    }

    if (!entity) {
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
          safeDate(p.birth?.date),
          parseHeight(p.height),
          parseWeight(p.weight),
          p.photo || null,
          JSON.stringify({ api_sports: String(p.id) }),
        ]
      );
      created++;
    } else {
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
          safeDate(p.birth?.date),
          parseHeight(p.height),
          parseWeight(p.weight),
          p.photo || null,
          JSON.stringify({ api_sports: String(p.id) }),
          entity.id,
        ]
      );
      updated++;
    }

    if (p.nationality) {
      const sportRow = await queryOne(`SELECT id FROM sports WHERE slug = 'football'`);
      await query(
        `INSERT INTO player_attributes (entity_id, sport_id, attribute_key, attribute_value)
         VALUES ($1, $2, 'nationality', $3)
         ON CONFLICT (entity_id, sport_id, attribute_key) DO UPDATE
         SET attribute_value = EXCLUDED.attribute_value`,
        [entity.id, sportRow?.id, p.nationality]
      ).catch(() => {});
    }

    // ── 2. Upsert player_season_stats per club ────────────────
    for (const s of stats) {
      if (!s.team?.id) continue;

      let club = await queryOne(
        `SELECT id FROM entities WHERE entity_type = 'club'
         AND canonical_name ILIKE $1`,
        [s.team.name]
      );
      if (!club) {
        club = await queryOne(
          `SELECT e.id FROM entities e
           JOIN entity_aliases ea ON ea.entity_id = e.id
           WHERE e.entity_type = 'club' AND ea.alias ILIKE $1`,
          [s.team.name]
        );
      }
      if (!club) {
        console.log(`     ⚠️  Club not found: ${s.team.name} (player: ${p.name})`);
        clubSkipped++;
        continue;
      }

      // Skip clubs with no real-competition games this season — these
      // only appear in /players data because they played qualifying
      // rounds, which RANKKS deliberately excludes everywhere else.
      // league_phase added alongside the original group_stages/final_tour
      // pair: pre-2024 seasons use group_stages, 2024+ seasons use
      // league_phase instead — a club's real games live in exactly one
      // of the two depending on season format, never both, so listing
      // all three here is always correct regardless of which season is
      // being ingested.
      const hasRealGames = await queryOne(
        `SELECT 1 FROM games g
         JOIN result_tabs rt ON rt.id = g.result_tab_id
         WHERE rt.season_id = $1
           AND rt.tab_group IN ('group_stages', 'final_tour', 'league_phase')
           AND (g.home_entity_id = $2 OR g.away_entity_id = $2)
         LIMIT 1`,
        [seasonRow.id, club.id]
      );
      if (!hasRealGames) {
        qualifyingSkipped++;
        continue;
      }

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

  console.log(`     ✅ Players: ${created} created, ${updated} updated, ${statsUpserted} stat rows upserted, ${clubSkipped} club-skipped, ${qualifyingSkipped} qualifying-only-skipped`);
}

function safeDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const [y, m, day] = dateStr.split('-').map(Number)
  if (m < 1 || m > 12 || day < 1 || day > 31) return null
  return dateStr
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
