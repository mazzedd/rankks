const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

router.get('/standings/:seasonId/:tabKey', async (req, res, next) => {
  try {
    const { seasonId, tabKey } = req.params
    const tab = await queryOne(`
      SELECT id, tab_name, tab_key, typology, display_order
      FROM result_tabs WHERE season_id = $1 AND tab_key = $2
    `, [seasonId, tabKey])
    if (!tab) return res.status(404).json({ error: 'Result tab not found' })
    const standings = await queryAll(`
      SELECT st.position, st.stats, st.entity_type,
        e.id AS entity_id, e.canonical_name,
        e.slug AS entity_slug,
        e.canonical_name AS display_name,
        e.canonical_name AS short_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e.id AND is_current = true LIMIT 1), e.image_url) AS logo_url,
        co.iso2 AS country_iso2, co.name AS country_name, co.flag_url
      FROM standings st
      JOIN entities e ON e.id = st.entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      WHERE st.result_tab_id = $1
      ORDER BY st.position
    `, [tab.id])
    res.json({ data: { tab, standings, count: standings.length } })
  } catch (err) { next(err) }
})

router.get('/games/:seasonId/:tabKey', async (req, res, next) => {
  try {
    const { seasonId, tabKey } = req.params
    const { round } = req.query
    const tab = await queryOne(`
      SELECT id, tab_name, tab_key, typology
      FROM result_tabs WHERE season_id = $1 AND tab_key = $2
    `, [seasonId, tabKey])
    if (!tab) return res.status(404).json({ error: 'Result tab not found' })
    const params = [tab.id]
    let roundFilter = ''
    if (round) { params.push(round); roundFilter = `AND g.round = $${params.length}` }
    const games = await queryAll(`
      SELECT g.id, g.round, g.match_number, g.leg_number, g.match_date,
        g.venue, g.venue_city, g.home_seed, g.away_seed, g.score,
        g.stats, g.scorers, g.duration_minutes, g.is_walkover, g.is_retirement, g.home_won,
        he.id AS home_id, he.canonical_name AS home_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = he.id AND is_current = true LIMIT 1), he.image_url) AS home_logo,
        he.slug AS home_slug, he.canonical_name AS home_display_name,
        hco.iso2 AS home_country_iso2, hco.flag_url AS home_flag,
        ae.id AS away_id, ae.canonical_name AS away_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = ae.id AND is_current = true LIMIT 1), ae.image_url) AS away_logo,
        ae.slug AS away_slug, ae.canonical_name AS away_display_name,
        aco.iso2 AS away_country_iso2, aco.flag_url AS away_flag,
        we.id AS winner_id, we.canonical_name AS winner_name
      FROM games g
      JOIN entities he ON he.id = g.home_entity_id
      LEFT JOIN countries hco ON hco.id = he.country_id
      JOIN entities ae ON ae.id = g.away_entity_id
      LEFT JOIN countries aco ON aco.id = ae.country_id
      LEFT JOIN entities we ON we.id = g.winner_entity_id
      WHERE g.result_tab_id = $1 ${roundFilter}
      ORDER BY CASE g.round
        WHEN 'Final' THEN 1 WHEN 'Semi-Final' THEN 2 WHEN 'Quarter-Final' THEN 3
        WHEN 'Round of 16' THEN 4 WHEN 'Round of 32' THEN 5 WHEN 'Round of 64' THEN 6 WHEN 'Round of 128' THEN 7 WHEN 'Round Robin' THEN 8 ELSE 9 END,
        g.match_number, g.leg_number
    `, params)
    const grouped = games.reduce((acc, g) => {
      const r = g.round || 'unknown'
      if (!acc[r]) acc[r] = []
      acc[r].push(g)
      return acc
    }, {})
    const rounds = await queryAll(`
      SELECT DISTINCT round, COUNT(*) as match_count
      FROM games WHERE result_tab_id = $1 GROUP BY round
    `, [tab.id])
    res.json({ data: { tab, rounds, games_by_round: grouped, total: games.length } })
  } catch (err) { next(err) }
})

router.get('/players/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const players = await queryAll(`
      SELECT DISTINCT ON (e.id)
        e.id,
        e.canonical_name,
        e.slug,
        e.canonical_name  AS display_name,
        e.image_url,
        e.birth_date,

        -- Country from player_attributes nationality -> countries table
        nat_co.iso2     AS country_iso2,
        nat_co.name     AS country_name,
        nat_co.flag_url AS flag_url,

        -- Position from player_attributes key-value
        pa_pos.attribute_value AS position,

        -- Stats — pick row with most games played
        pss.games_played,
        pss.goals,
        pss.assists,
        pss.yellow_cards,
        pss.red_cards,
        pss.minutes_played,
        pss.ranking_at_event,

        -- Club name + slug
        club_e.canonical_name AS club_name,
        club_e.slug           AS club_slug,

        -- Club logo
        club_logo.logo_url    AS club_logo

      FROM player_season_stats pss
      JOIN entities e ON e.id = pss.entity_id

      -- Nationality from player_attributes
      LEFT JOIN player_attributes pa_nat
        ON pa_nat.entity_id = pss.entity_id
        AND pa_nat.attribute_key = 'nationality'
      LEFT JOIN countries nat_co
        ON nat_co.name = pa_nat.attribute_value
        OR nat_co.name_fr = pa_nat.attribute_value

      -- Position from player_attributes
      LEFT JOIN player_attributes pa_pos
        ON pa_pos.entity_id = pss.entity_id
        AND pa_pos.attribute_key = 'position'

      -- Club
      LEFT JOIN entities club_e ON club_e.id = pss.club_entity_id

      -- Club logo
      LEFT JOIN entity_logos club_logo
        ON club_logo.entity_id = pss.club_entity_id
        AND club_logo.is_current = true

      WHERE pss.season_id = $1
      ORDER BY e.id, pss.games_played DESC NULLS LAST
    `, [seasonId])

    // Sort alphabetically after dedup
    players.sort((a, b) => (a.canonical_name || '').localeCompare(b.canonical_name || ''))

    res.json({ data: { players, total: players.length } })
  } catch (err) { next(err) }
})

router.get('/clubs/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const tab = await queryOne(`
      SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = 'clubs'
    `, [seasonId])
    if (!tab) return res.status(404).json({ error: 'Clubs tab not found' })
    const clubs = await queryAll(`
      SELECT st.position, st.stats, e.id AS entity_id,
        e.canonical_name, e.slug, e.canonical_name AS display_name,
        e.image_url AS logo_url,
        co.iso2 AS country_iso2, co.name AS country_name, co.flag_url
      FROM standings st
      JOIN entities e ON e.id = st.entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      WHERE st.result_tab_id = $1
      ORDER BY st.position
    `, [tab.id])
    res.json({ data: { clubs, total: clubs.length } })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /results/tennis-players
// ?seasonId=145&gender=M&search=fed&filters=gs,m1000&page=1&limit=50
//
// Schema facts:
//   games.result_tab_id  → result_tabs.id → result_tabs.season_id → seasons
//   games.home_entity_id = winner, games.away_entity_id = loser
//   games.id             = unique match identifier (used as final_key)
//   competitions.category_id = event category (GS=11, M1000=12, etc.)
//
// Rules:
//   1. WHO        — players in ≥1 match in this seasonId
//   2. RANK       — best (lowest) w_rank/l_rank within this season's matches
//   3. CAREER STATS — Finals in seasons whose start_date < this event's start_date
//   4. AGE        — at event start_date
//   5. FILTERS    — cumulative: ≥1 final in each selected category (career)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tennis-players', async (req, res, next) => {
  try {
    const {
      seasonId,
      gender  = 'M',
      search  = '',
      filters = '',
      page    = 1,
      limit   = 50,
    } = req.query

    if (!seasonId) return res.status(400).json({ error: 'seasonId is required' })

    const offset        = (parseInt(page) - 1) * parseInt(limit)
    const activeFilters = filters ? filters.split(',').filter(Boolean) : []
    const genderFilter  = gender === 'M' ? 'M' : 'F'

    // category_id values per gender
    const gsCategories    = [11]
    const m1000Categories = gender === 'M' ? [12] : [13]
    const a500Categories  = gender === 'M' ? [14] : [15]
    const a250Categories  = gender === 'M' ? [16] : [17]

    // ── Cutoff date: start_date of this season ─────────────────────────────
    const seasonRow = await queryOne(`
      SELECT
        COALESCE(
          s.start_date,
          (SELECT MIN(g.match_date)
           FROM games g
           JOIN result_tabs rt ON g.result_tab_id = rt.id
           WHERE rt.season_id = $1)
        ) AS cutoff_date
      FROM seasons s
      WHERE s.id = $1
    `, [seasonId])

    if (!seasonRow?.cutoff_date)
      return res.status(404).json({ error: 'Season not found or has no matches' })

    const cutoffDate = seasonRow.cutoff_date

    // ── Filter / search WHERE fragments ───────────────────────────────────
    const filterClauses = []
    if (activeFilters.includes('gs'))     filterClauses.push('COALESCE(cs.gs_finals,    0) > 0')
    if (activeFilters.includes('m1000'))  filterClauses.push('COALESCE(cs.m1000_finals, 0) > 0')
    if (activeFilters.includes('atp500')) filterClauses.push('COALESCE(cs.atp500_finals,0) > 0')
    if (activeFilters.includes('atp250')) filterClauses.push('COALESCE(cs.atp250_finals,0) > 0')
    const filterWhere = filterClauses.length ? 'AND ' + filterClauses.join(' AND ') : ''

    const hasSearch   = search.trim().length > 0
    const searchWhere = hasSearch
      ? `AND e.canonical_name ILIKE $8`
      : ''

    // $1=seasonId $2=cutoff $3=gs $4=m1000 $5=a500 $6=a250 $7=gender [$8=search]
    const params = [
      seasonId,        // $1
      cutoffDate,      // $2
      gsCategories,    // $3
      m1000Categories, // $4
      a500Categories,  // $5
      a250Categories,  // $6
      genderFilter,    // $7
      ...(hasSearch ? [`%${search.trim()}%`] : []),  // $8
    ]

    // ── Main SQL ───────────────────────────────────────────────────────────
    const sql = `
      WITH

      -- 1. All result_tab ids belonging to this season
      season_tabs AS (
        SELECT id AS tab_id FROM result_tabs WHERE season_id = $1
      ),

      -- 2. Players who appeared in any match in this season
      season_players AS (
        SELECT DISTINCT g.home_entity_id AS entity_id
        FROM games g
        JOIN season_tabs st ON g.result_tab_id = st.tab_id
        WHERE g.home_entity_id IS NOT NULL

        UNION

        SELECT DISTINCT g.away_entity_id
        FROM games g
        JOIN season_tabs st ON g.result_tab_id = st.tab_id
        WHERE g.away_entity_id IS NOT NULL
      ),

      -- 3. Best ranking for each player within this season's matches
      --    home = winner (w_rank), away = loser (l_rank)
      season_ranks AS (
        SELECT entity_id, MIN(rank_val)::int AS event_rank
        FROM (
          SELECT g.home_entity_id AS entity_id,
                 (g.stats->>'w_rank')::int AS rank_val
          FROM games g
          JOIN season_tabs st ON g.result_tab_id = st.tab_id
          WHERE (g.stats->>'w_rank') ~ '^[0-9]+$'

          UNION ALL

          SELECT g.away_entity_id,
                 (g.stats->>'l_rank')::int
          FROM games g
          JOIN season_tabs st ON g.result_tab_id = st.tab_id
          WHERE (g.stats->>'l_rank') ~ '^[0-9]+$'
        ) ranked
        GROUP BY entity_id
      ),

      -- 4. All Finals in seasons that started BEFORE our cutoff date
      --    Join: games → result_tabs → seasons → competitions (for category_id)
      career_finals AS (
        SELECT
          g.home_entity_id    AS winner_id,
          g.away_entity_id    AS loser_id,
          c.category_id,
          g.id::text          AS final_key
        FROM games g
        JOIN result_tabs rt ON g.result_tab_id = rt.id
        JOIN seasons s      ON rt.season_id    = s.id
        JOIN competitions c ON s.competition_id = c.id
        WHERE g.round = 'Final'
          AND s.gender = $7
          AND COALESCE(
                s.start_date,
                (SELECT MIN(g2.match_date)
                 FROM games g2
                 JOIN result_tabs rt2 ON g2.result_tab_id = rt2.id
                 WHERE rt2.season_id = s.id)
              ) < $2
      ),

      -- 5. One row per finalist (winner + runner-up)
      player_finals AS (
        SELECT winner_id AS entity_id, category_id, final_key, TRUE  AS is_winner
        FROM career_finals
        UNION ALL
        SELECT loser_id,               category_id, final_key, FALSE AS is_winner
        FROM career_finals
      ),

      -- 6. Aggregate career stats per player (up to cutoff)
      career_stats AS (
        SELECT
          entity_id,
          COUNT(DISTINCT CASE WHEN category_id = ANY($3) THEN final_key END)::int               AS gs_finals,
          COUNT(DISTINCT CASE WHEN category_id = ANY($3) AND is_winner THEN final_key END)::int AS gs_wins,
          COUNT(DISTINCT CASE WHEN category_id = ANY($4) THEN final_key END)::int               AS m1000_finals,
          COUNT(DISTINCT CASE WHEN category_id = ANY($4) AND is_winner THEN final_key END)::int AS m1000_wins,
          COUNT(DISTINCT CASE WHEN category_id = ANY($5) THEN final_key END)::int               AS atp500_finals,
          COUNT(DISTINCT CASE WHEN category_id = ANY($5) AND is_winner THEN final_key END)::int AS atp500_wins,
          COUNT(DISTINCT CASE WHEN category_id = ANY($6) THEN final_key END)::int               AS atp250_finals,
          COUNT(DISTINCT CASE WHEN category_id = ANY($6) AND is_winner THEN final_key END)::int AS atp250_wins,
          -- Total = only GS + M1000 + 500 + 250 (not challengers or other categories)
          COUNT(DISTINCT CASE WHEN (category_id = ANY($3) OR category_id = ANY($4) OR category_id = ANY($5) OR category_id = ANY($6)) AND is_winner THEN final_key END)::int AS total_wins,
          COUNT(DISTINCT CASE WHEN (category_id = ANY($3) OR category_id = ANY($4) OR category_id = ANY($5) OR category_id = ANY($6)) THEN final_key END)::int              AS total_finals
        FROM player_finals
        GROUP BY entity_id
      )

      -- 7. Final SELECT
      SELECT
        e.id               AS entity_id,
        e.slug,
        e.canonical_name,
        co.iso2            AS country_iso2,
        e.birth_date,
        DATE_PART('year', AGE($2::date, e.birth_date::date))::int AS age_at_event,
        sr.event_rank,
        COALESCE(cs.gs_wins,      0) AS gs_wins,
        COALESCE(cs.gs_finals,    0) AS gs_finals,
        COALESCE(cs.m1000_wins,   0) AS m1000_wins,
        COALESCE(cs.m1000_finals, 0) AS m1000_finals,
        COALESCE(cs.atp500_wins,  0) AS atp500_wins,
        COALESCE(cs.atp500_finals,0) AS atp500_finals,
        COALESCE(cs.atp250_wins,  0) AS atp250_wins,
        COALESCE(cs.atp250_finals,0) AS atp250_finals,
        COALESCE(cs.total_wins,   0) AS total_wins,
        COALESCE(cs.total_finals, 0) AS total_finals
      FROM season_players sp
      JOIN entities e           ON e.id = sp.entity_id
      LEFT JOIN career_stats cs ON cs.entity_id = e.id
      LEFT JOIN season_ranks sr ON sr.entity_id = e.id
      LEFT JOIN countries co     ON co.id = e.country_id
      WHERE e.entity_type = 'player'
        ${searchWhere}
        ${filterWhere}
      ORDER BY
        sr.event_rank            ASC NULLS LAST,
        COALESCE(cs.gs_wins, 0)  DESC,
        e.canonical_name         ASC
      LIMIT  ${parseInt(limit)}
      OFFSET ${offset}
    `

    const countSql = `
      WITH
      season_tabs AS (
        SELECT id AS tab_id FROM result_tabs WHERE season_id = $1
      ),
      season_players AS (
        SELECT DISTINCT g.home_entity_id AS entity_id
        FROM games g JOIN season_tabs st ON g.result_tab_id = st.tab_id
        WHERE g.home_entity_id IS NOT NULL
        UNION
        SELECT DISTINCT g.away_entity_id
        FROM games g JOIN season_tabs st ON g.result_tab_id = st.tab_id
        WHERE g.away_entity_id IS NOT NULL
      ),
      career_finals AS (
        SELECT g.home_entity_id AS winner_id, g.away_entity_id AS loser_id,
               c.category_id, g.id::text AS final_key
        FROM games g
        JOIN result_tabs rt ON g.result_tab_id = rt.id
        JOIN seasons s      ON rt.season_id    = s.id
        JOIN competitions c ON s.competition_id = c.id
        WHERE g.round = 'Final'
          AND s.gender = $7
          AND COALESCE(s.start_date,
                (SELECT MIN(g2.match_date) FROM games g2
                 JOIN result_tabs rt2 ON g2.result_tab_id = rt2.id
                 WHERE rt2.season_id = s.id)
              ) < $2
      ),
      player_finals AS (
        SELECT winner_id AS entity_id, category_id, final_key, TRUE  AS is_winner FROM career_finals
        UNION ALL
        SELECT loser_id,               category_id, final_key, FALSE AS is_winner FROM career_finals
      ),
      career_stats AS (
        SELECT entity_id,
          COUNT(DISTINCT CASE WHEN category_id = ANY($3) THEN final_key END)::int AS gs_finals,
          COUNT(DISTINCT CASE WHEN category_id = ANY($4) THEN final_key END)::int AS m1000_finals,
          COUNT(DISTINCT CASE WHEN category_id = ANY($5) THEN final_key END)::int AS atp500_finals,
          COUNT(DISTINCT CASE WHEN category_id = ANY($6) THEN final_key END)::int AS atp250_finals
        FROM player_finals GROUP BY entity_id
      )
      SELECT COUNT(*) AS total
      FROM season_players sp
      JOIN entities e           ON e.id = sp.entity_id
      LEFT JOIN career_stats cs ON cs.entity_id = e.id
      WHERE e.entity_type = 'player'
        ${searchWhere}
        ${filterWhere}
    `

    const [rows, countRow] = await Promise.all([
      queryAll(sql, params),
      queryOne(countSql, params),
    ])

    const players = rows.map((p, idx) => ({
      rank:          offset + idx + 1,
      entity_id:     p.entity_id,
      slug:          p.slug,
      canonical_name: p.canonical_name,
      country_iso2:  p.country_iso2,
      birth_date:    p.birth_date,
      age_at_event:  p.age_at_event != null ? parseInt(p.age_at_event) : null,
      event_rank:    p.event_rank   != null ? parseInt(p.event_rank)   : null,
      gs_wins:       parseInt(p.gs_wins)       || 0,
      gs_finals:     parseInt(p.gs_finals)     || 0,
      m1000_wins:    parseInt(p.m1000_wins)    || 0,
      m1000_finals:  parseInt(p.m1000_finals)  || 0,
      atp500_wins:   parseInt(p.atp500_wins)   || 0,
      atp500_finals: parseInt(p.atp500_finals) || 0,
      atp250_wins:   parseInt(p.atp250_wins)   || 0,
      atp250_finals: parseInt(p.atp250_finals) || 0,
      total_wins:    parseInt(p.total_wins)     || 0,
      total_finals:  parseInt(p.total_finals)   || 0,
    }))

    res.json({
      players,
      total:  parseInt(countRow?.total) || 0,
      page:   parseInt(page),
      limit:  parseInt(limit),
      cutoff: cutoffDate,
    })

  } catch (err) { next(err) }
})

module.exports = router;