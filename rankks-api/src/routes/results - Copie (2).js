const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');
const { resolveTabTitle } = require('./tab-title-resolver');

router.get('/standings/:seasonId/:tabKey', async (req, res, next) => {
  try {
    const { seasonId, tabKey } = req.params
    const tab = await queryOne(`
      SELECT id, tab_name, tab_key, typology, display_order, tab_group, group_name
      FROM result_tabs WHERE season_id = $1 AND tab_key = $2
    `, [seasonId, tabKey])
    if (!tab) return res.status(404).json({ error: 'Result tab not found' })

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    tab.page_title = await resolveTabTitle({
      competitionId: season?.competition_id,
      tabKey: tab.tab_key,
      tabGroup: tab.tab_group,
      groupName: tab.group_name,
      section: 'standings',
      year: season?.year,
    })

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

router.get('/games-by-group/:seasonId/:tabGroup', async (req, res, next) => {
  try {
    const { seasonId, tabGroup } = req.params

    const memberTabs = await queryAll(`
      SELECT id, tab_name, tab_key, typology, display_order
      FROM result_tabs
      WHERE season_id = $1 AND tab_group = $2 AND typology = 'game'
      ORDER BY display_order
    `, [seasonId, tabGroup])

    if (!memberTabs.length) return res.status(404).json({ error: 'No game tabs found for this group' })

    const tabIds = memberTabs.map(t => t.id)

    const tab = {
      id: null,
      tab_name: 'Results',
      tab_key: 'results',
      typology: 'game',
      tab_group: tabGroup,
      group_name: null,
    }

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    tab.page_title = await resolveTabTitle({
      competitionId: season?.competition_id,
      tabKey: tab.tab_key,
      tabGroup: tab.tab_group,
      groupName: tab.group_name,
      section: 'game',
      year: season?.year,
    })

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
        we.id AS winner_id, we.canonical_name AS winner_name,
        m.video_url AS video_url,
        m.source AS video_source,
        m.embeddable AS video_embeddable,
        m.thumbnail_url AS video_thumbnail_url
      FROM games g
      JOIN entities he ON he.id = g.home_entity_id
      LEFT JOIN countries hco ON hco.id = he.country_id
      JOIN entities ae ON ae.id = g.away_entity_id
      LEFT JOIN countries aco ON aco.id = ae.country_id
      LEFT JOIN entities we ON we.id = g.winner_entity_id
      LEFT JOIN media m ON m.game_id = g.id AND m.media_type = 'match_summary'
      WHERE g.result_tab_id = ANY($1)
      ORDER BY
        COALESCE(
          (regexp_match(g.round, '(\\d+)$'))[1]::int,
          CASE g.round
            WHEN 'Final' THEN 1 WHEN 'Semi-Final' THEN 2 WHEN 'Quarter-Final' THEN 3
            WHEN 'Round of 16' THEN 4 WHEN 'Round of 32' THEN 5 WHEN 'Round of 64' THEN 6 WHEN 'Round of 128' THEN 7 WHEN 'Round Robin' THEN 8 ELSE 99 END
        ),
        g.match_number, g.leg_number
    `, [tabIds])

    const grouped = games.reduce((acc, g) => {
      const r = g.round || 'unknown'
      if (!acc[r]) acc[r] = []
      acc[r].push(g)
      return acc
    }, {})

    const rounds = await queryAll(`
      SELECT DISTINCT round, COUNT(*) as match_count
      FROM games WHERE result_tab_id = ANY($1) GROUP BY round
    `, [tabIds])

    res.json({ data: { tab, rounds, games_by_round: grouped, total: games.length } })
  } catch (err) { next(err) }
})

router.get('/games/:seasonId/:tabKey', async (req, res, next) => {
  try {
    const { seasonId, tabKey } = req.params
    const { round } = req.query
    const tab = await queryOne(`
      SELECT id, tab_name, tab_key, typology, tab_group, group_name
      FROM result_tabs WHERE season_id = $1 AND tab_key = $2
    `, [seasonId, tabKey])
    if (!tab) return res.status(404).json({ error: 'Result tab not found' })

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    tab.page_title = await resolveTabTitle({
      competitionId: season?.competition_id,
      tabKey: tab.tab_key,
      tabGroup: tab.tab_group,
      groupName: tab.group_name,
      section: 'game',
      year: season?.year,
    })

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
        we.id AS winner_id, we.canonical_name AS winner_name,
        m.video_url AS video_url,
        m.source AS video_source,
        m.embeddable AS video_embeddable,
        m.thumbnail_url AS video_thumbnail_url
      FROM games g
      JOIN entities he ON he.id = g.home_entity_id
      LEFT JOIN countries hco ON hco.id = he.country_id
      JOIN entities ae ON ae.id = g.away_entity_id
      LEFT JOIN countries aco ON aco.id = ae.country_id
      LEFT JOIN entities we ON we.id = g.winner_entity_id
      LEFT JOIN media m ON m.game_id = g.id AND m.media_type = 'match_summary'
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

        -- Country: map known mismatches, fallback to countries table
        COALESCE(
          CASE pa_nat.attribute_value
            WHEN 'England'                   THEN 'gb-eng'
            WHEN 'Scotland'                  THEN 'gb-sct'
            WHEN 'Wales'                     THEN 'gb-wls'
            WHEN 'Northern Ireland'          THEN 'gb-nir'
            WHEN 'Republic of Ireland'       THEN 'ie'
            WHEN 'Côte d''Ivoire'            THEN 'ci'
            WHEN 'Guinea'                    THEN 'gn'
            WHEN 'Congo DR'                  THEN 'cd'
            WHEN 'Congo'                     THEN 'cg'
            WHEN 'Comoros'                   THEN 'km'
            WHEN 'Guadeloupe'                THEN 'gp'
            WHEN 'Gabon'                     THEN 'ga'
            WHEN 'Burkina Faso'              THEN 'bf'
            WHEN 'Türkiye'                   THEN 'tr'
            WHEN 'Martinique'                THEN 'mq'
            WHEN 'Benin'                     THEN 'bj'
            WHEN 'USA'                       THEN 'us'
            WHEN 'Togo'                      THEN 'tg'
            WHEN 'Cape Verde'                THEN 'cv'
            WHEN 'Cape Verde Islands'        THEN 'cv'
            WHEN 'Haiti'                     THEN 'ht'
            WHEN 'Central African Republic'  THEN 'cf'
            WHEN 'Guinea-Bissau'             THEN 'gw'
            WHEN 'Madagascar'                THEN 'mg'
            WHEN 'French Guiana'             THEN 'gf'
            WHEN 'Mauritania'                THEN 'mr'
            WHEN 'Korea Republic'            THEN 'kr'
            WHEN 'Gambia'                    THEN 'gm'
            WHEN 'Burundi'                   THEN 'bi'
            WHEN 'Mozambique'                THEN 'mz'
            WHEN 'Niger'                     THEN 'ne'
            ELSE NULL
          END,
          nat_co.iso2
        ) AS country_iso2,
        COALESCE(
          CASE pa_nat.attribute_value
            WHEN 'England'                   THEN 'England'
            WHEN 'Scotland'                  THEN 'Scotland'
            WHEN 'Wales'                     THEN 'Wales'
            WHEN 'Northern Ireland'          THEN 'Northern Ireland'
            WHEN 'Republic of Ireland'       THEN 'Ireland'
            WHEN 'Côte d''Ivoire'            THEN 'Ivory Coast'
            WHEN 'Congo DR'                  THEN 'DR Congo'
            WHEN 'Congo'                     THEN 'Congo'
            WHEN 'Türkiye'                   THEN 'Turkey'
            WHEN 'USA'                       THEN 'United States'
            WHEN 'Cape Verde Islands'        THEN 'Cape Verde'
            WHEN 'Korea Republic'            THEN 'South Korea'
            WHEN 'Central African Republic'  THEN 'Central African Rep.'
            ELSE pa_nat.attribute_value
          END,
          nat_co.name
        ) AS country_name,
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

        -- Club name + slug + type (club vs national_team — drives
        -- whether the frontend shows one merged Country filter or
        -- separate Club/Country filters)
        club_e.canonical_name AS club_name,
        club_e.slug           AS club_slug,
        club_e.entity_type    AS club_entity_type,

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
//   4. AGE        — at event end_date (unified RANKKS-wide rule — see
//                    src/utils/calcAge.js; was previously computed at
//                    start_date, same variable as the stats cutoff below —
//                    now split into its own ageRefDate, see inline comments)
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
    // Used ONLY to gate the career-stats CTEs below (rule 3: a player's own
    // performance in the event currently being viewed must not count toward
    // their own "prior career" totals). This is intentionally NOT the same
    // date used for age — see ageRefDate below.
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

    // ── Age reference date: end_date of this event ──────────────────────────
    // Unified RANKKS-wide rule (see src/utils/calcAge.js, applied identically
    // to football and F1): age is always computed as of the event's END, not
    // its start. Separate from cutoffDate above on purpose — this previously
    // reused cutoffDate (start_date), meaning a player's displayed age here
    // could be a year off from the same player's age shown elsewhere (e.g.
    // the tennis EventBlock, which already used event_end_date correctly).
    const seasonEndRow = await queryOne(`
      SELECT
        COALESCE(
          s.end_date,
          (SELECT MAX(g.match_date)
           FROM games g
           JOIN result_tabs rt ON g.result_tab_id = rt.id
           WHERE rt.season_id = $1),
          s.start_date
        ) AS age_ref_date
      FROM seasons s
      WHERE s.id = $1
    `, [seasonId])

    const ageRefDate = seasonEndRow?.age_ref_date || cutoffDate

    // ── Filter / search WHERE fragments ───────────────────────────────────
    const filterClauses = []
    if (activeFilters.includes('gs'))     filterClauses.push('COALESCE(cs.gs_finals,    0) > 0')
    if (activeFilters.includes('m1000'))  filterClauses.push('COALESCE(cs.m1000_finals, 0) > 0')
    if (activeFilters.includes('atp500')) filterClauses.push('COALESCE(cs.atp500_finals,0) > 0')
    if (activeFilters.includes('atp250')) filterClauses.push('COALESCE(cs.atp250_finals,0) > 0')
    const filterWhere = filterClauses.length ? 'AND ' + filterClauses.join(' AND ') : ''

    const hasSearch   = search.trim().length > 0
    const searchWhere = hasSearch
      ? `AND e.canonical_name ILIKE $9`
      : ''

    // $1=seasonId $2=cutoff(start_date, stats-only) $3=gs $4=m1000 $5=a500
    // $6=a250 $7=gender $8=ageRefDate(end_date, age-only) [$9=search]
    const params = [
      seasonId,        // $1
      cutoffDate,      // $2 — career-stats cutoff only, see comment above
      gsCategories,    // $3
      m1000Categories, // $4
      a500Categories,  // $5
      a250Categories,  // $6
      genderFilter,    // $7
      ageRefDate,      // $8 — age-at-event only, see comment above
      ...(hasSearch ? [`%${search.trim()}%`] : []),  // $9
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
        DATE_PART('year', AGE($8::date, e.birth_date::date))::int AS age_at_event,
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


router.get('/stats/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const row = await queryOne(`
      SELECT
        COUNT(DISTINCT pss.club_entity_id)                             AS teams,
        COUNT(DISTINCT pss.entity_id)                                  AS players,
        COALESCE(SUM(pss.goals), 0)                                    AS goals,
        COUNT(DISTINCT CASE WHEN pss.goals > 0 THEN pss.entity_id END) AS scorers,
        COALESCE(SUM(pss.assists), 0)                                  AS assists,
        COUNT(DISTINCT CASE WHEN pss.assists > 0 THEN pss.entity_id END) AS passers,
        (SELECT COUNT(*) FROM games g
         JOIN result_tabs rt ON rt.id = g.result_tab_id
         WHERE rt.season_id = $1)                                    AS matches
      FROM player_season_stats pss
      WHERE pss.season_id = $1
    `, [seasonId])
    res.json({ data: {
      teams:   parseInt(row?.teams   || 0),
      players: parseInt(row?.players || 0),
      goals:   parseInt(row?.goals   || 0),
      matches: parseInt(row?.matches || 0),
      goals_per_match:   row?.matches > 0 ? (parseFloat(row.goals)   / parseFloat(row.matches)).toFixed(2) : null,
      assists_per_match: row?.matches > 0 ? (parseFloat(row.assists) / parseFloat(row.matches)).toFixed(2) : null,
      scorers: parseInt(row?.scorers || 0),
      assists: parseInt(row?.assists || 0),
      passers: parseInt(row?.passers || 0),
    }})
  } catch (err) { next(err) }
})

router.get('/iconic-moments/:seasonId', async (req, res, next) => {
  try {
    // seasonId may be a single id or comma-separated list (e.g. "4332,5406")
    // so the Videos tab can show M + F (+ future doubles) in one shared gallery.
    const seasonIds = req.params.seasonId.split(',').map(s => parseInt(s.trim())).filter(Boolean)
    if (!seasonIds.length) return res.status(400).json({ error: 'Invalid seasonId' })

    const { category, tag } = req.query
    const params = [seasonIds]
    let extra = ''
    if (category) { params.push(category); extra += ` AND m.category = $${params.length}` }
    if (tag)      { params.push(tag);      extra += ` AND $${params.length} = ANY(m.tags)` }
    const items = await queryAll(`
      SELECT id, video_url, source, embeddable, title, category, tags,
             thumbnail_url, display_order
      FROM media
      WHERE season_id = ANY($1) AND media_type = 'iconic_moment' ${extra}
      ORDER BY display_order ASC, id ASC
    `, params)
    res.json({ data: { items, total: items.length } })
  } catch (err) { next(err) }
})

router.get('/clubs/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const { search, country } = req.query

    // Resolve this season's competition_id + year, since the page is
    // anchored to one season but the stats shown are cumulative across
    // every prior season of the same competition (same pattern as
    // /api/seasons/entity-history).
    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    // Only clubs with a standings row in the CURRENTLY SELECTED season
    // appear on the page — i.e. clubs that actually reached the group
    // stage this year — even though every stat shown for them is the
    // cumulative total through this year, not just this season's numbers.
    const currentClubs = await queryAll(`
      SELECT DISTINCT st.entity_id
      FROM standings st
      JOIN result_tabs rt ON rt.id = st.result_tab_id
      WHERE rt.season_id = $1
    `, [seasonId])
    const clubIds = currentClubs.map(c => c.entity_id)
    if (!clubIds.length) return res.json({ data: { clubs: [], count: 0 } })

    // Same Final-game-vs-standings-position detection already used for
    // /entity-history — UCL champions are the games.winner_entity_id of
    // the final_tour/final tab, never a group-stage position=1 finish.
    const usesFinalTour = await queryOne(`
      SELECT 1 FROM result_tabs rt
      JOIN seasons s ON s.id = rt.season_id
      WHERE s.competition_id = $1 AND rt.tab_group = 'final_tour' AND rt.tab_key = 'final'
      LIMIT 1
    `, [competition_id])

    const params = [clubIds, competition_id, year]
    let searchWhere = ''
    let countryWhere = ''
    if (search) { params.push(`%${search}%`); searchWhere = ` AND e.canonical_name ILIKE $${params.length}` }
    if (country) { params.push(country); countryWhere = ` AND co.iso2 = $${params.length}` }

    const clubs = await queryAll(`
      WITH cumulative_games AS (
        -- One row per (club, game) the club played in, across every
        -- real-competition tab_group, for every season of this
        -- competition up to and including the selected year.
        -- league_phase added alongside the original pair: pre-2024
        -- seasons use group_stages, 2024+ seasons use league_phase
        -- instead of it — never both in the same season — so including
        -- all three here is always correct regardless of format era.
        SELECT g.id AS game_id, g.winner_entity_id,
               g.home_entity_id AS club_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND rt.tab_group IN ('group_stages', 'final_tour', 'league_phase')
          AND g.home_entity_id = ANY($1)
        UNION ALL
        SELECT g.id, g.winner_entity_id, g.away_entity_id AS club_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND rt.tab_group IN ('group_stages', 'final_tour', 'league_phase')
          AND g.away_entity_id = ANY($1)
      ),
      pld AS (
        SELECT club_id,
          COUNT(*)                                                          AS played,
          COUNT(*) FILTER (WHERE winner_entity_id = club_id)                AS won,
          COUNT(*) FILTER (WHERE winner_entity_id IS NULL)                  AS drawn,
          COUNT(*) FILTER (WHERE winner_entity_id IS NOT NULL
                                  AND winner_entity_id != club_id)          AS lost
        FROM cumulative_games
        GROUP BY club_id
      ),
      participations AS (
        SELECT st.entity_id AS club_id, COUNT(DISTINCT rt.season_id) AS participations
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND st.entity_id = ANY($1)
        GROUP BY st.entity_id
      ),
      titles AS (
        SELECT g.winner_entity_id AS club_id, COUNT(DISTINCT s.id) AS titles
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND rt.tab_group = 'final_tour' AND rt.tab_key = 'final'
          AND g.winner_entity_id = ANY($1)
        GROUP BY g.winner_entity_id
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e.id AND is_current = true LIMIT 1), e.image_url) AS logo_url,
        co.iso2 AS country_iso2, co.name AS country_name, co.flag_url,
        COALESCE(participations.participations, 0) AS participations,
        COALESCE(titles.titles, 0) AS titles,
        COALESCE(pld.played, 0) AS played,
        COALESCE(pld.won, 0) AS won,
        COALESCE(pld.drawn, 0) AS drawn,
        COALESCE(pld.lost, 0) AS lost
      FROM entities e
      LEFT JOIN countries co ON co.id = e.country_id
      LEFT JOIN pld ON pld.club_id = e.id
      LEFT JOIN participations ON participations.club_id = e.id
      LEFT JOIN titles ON titles.club_id = e.id
      WHERE e.id = ANY($1)
        ${searchWhere}
        ${countryWhere}
      ORDER BY COALESCE(participations.participations, 0) DESC,
               COALESCE(titles.titles, 0) DESC,
               e.canonical_name ASC
    `, params)

    res.json({
      data: {
        clubs: clubs.map(c => ({
          entity_id:      c.entity_id,
          canonical_name: c.canonical_name,
          slug:           c.slug,
          logo_url:       c.logo_url,
          country_iso2:   c.country_iso2,
          country_name:   c.country_name,
          flag_url:       c.flag_url,
          participations: parseInt(c.participations) || 0,
          titles:         parseInt(c.titles)         || 0,
          played:         parseInt(c.played)         || 0,
          won:            parseInt(c.won)            || 0,
          drawn:          parseInt(c.drawn)           || 0,
          lost:           parseInt(c.lost)            || 0,
        })),
        count: clubs.length,
      }
    })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /results/countries/:seasonId
// Same shape as /clubs/:seasonId above, reused as-is — that route turned
// out to be entirely entity-agnostic (it derives the entity list purely
// from standings.entity_id for the season, no `entity_type = 'club'`
// filter anywhere), so the identical query works for national_team
// entities (World Cup) without modification. Only real addition:
// `confederation` in the SELECT and as a filter param — filtering
// countries BY country would be redundant (that's the clubs route's
// `country` param), so confederation (AFC/CAF/CONCACAF/CONMEBOL/OFC/UEFA,
// already on the countries table per Spec §17) is the natural equivalent
// filter dimension for a countries list.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/countries/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const { search, confederation } = req.query

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    // Only countries with a standings row in the CURRENTLY SELECTED season
    // appear on the page — i.e. teams that actually reached the group
    // stage this edition — even though every stat shown is the cumulative
    // total through this year, not just this season's numbers.
    const currentCountries = await queryAll(`
      SELECT DISTINCT st.entity_id
      FROM standings st
      JOIN result_tabs rt ON rt.id = st.result_tab_id
      WHERE rt.season_id = $1
    `, [seasonId])
    const countryEntityIds = currentCountries.map(c => c.entity_id)
    if (!countryEntityIds.length) return res.json({ data: { countries: [], count: 0 } })

    const params = [countryEntityIds, competition_id, year]
    let searchWhere = ''
    let confederationWhere = ''
    if (search) { params.push(`%${search}%`); searchWhere = ` AND e.canonical_name ILIKE $${params.length}` }
    if (confederation) { params.push(confederation); confederationWhere = ` AND co.confederation = $${params.length}` }

    const countries = await queryAll(`
      WITH cumulative_games AS (
        SELECT g.id AS game_id, g.winner_entity_id,
               g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND rt.tab_group IN ('group_stages', 'final_tour')
          AND g.home_entity_id = ANY($1)
        UNION ALL
        SELECT g.id, g.winner_entity_id, g.away_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND rt.tab_group IN ('group_stages', 'final_tour')
          AND g.away_entity_id = ANY($1)
      ),
      pld AS (
        SELECT team_id,
          COUNT(*)                                                          AS played,
          COUNT(*) FILTER (WHERE winner_entity_id = team_id)                AS won,
          COUNT(*) FILTER (WHERE winner_entity_id IS NULL)                  AS drawn,
          COUNT(*) FILTER (WHERE winner_entity_id IS NOT NULL
                                  AND winner_entity_id != team_id)          AS lost
        FROM cumulative_games
        GROUP BY team_id
      ),
      participations AS (
        SELECT st.entity_id AS team_id, COUNT(DISTINCT rt.season_id) AS participations
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND st.entity_id = ANY($1)
        GROUP BY st.entity_id
      ),
      titles AS (
        SELECT g.winner_entity_id AS team_id, COUNT(DISTINCT s.id) AS titles
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND rt.tab_group = 'final_tour' AND rt.tab_key = 'final'
          AND g.winner_entity_id = ANY($1)
        GROUP BY g.winner_entity_id
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug,
        co.iso2 AS country_iso2, co.name AS country_name,
        co.confederation AS confederation, co.flag_url,
        COALESCE(participations.participations, 0) AS participations,
        COALESCE(titles.titles, 0) AS titles,
        COALESCE(pld.played, 0) AS played,
        COALESCE(pld.won, 0) AS won,
        COALESCE(pld.drawn, 0) AS drawn,
        COALESCE(pld.lost, 0) AS lost
      FROM entities e
      LEFT JOIN countries co ON co.id = e.country_id
      LEFT JOIN pld ON pld.team_id = e.id
      LEFT JOIN participations ON participations.team_id = e.id
      LEFT JOIN titles ON titles.team_id = e.id
      WHERE e.id = ANY($1)
        ${searchWhere}
        ${confederationWhere}
      ORDER BY COALESCE(participations.participations, 0) DESC,
               COALESCE(titles.titles, 0) DESC,
               e.canonical_name ASC
    `, params)

    res.json({
      data: {
        countries: countries.map(c => ({
          entity_id:      c.entity_id,
          canonical_name: c.canonical_name,
          slug:           c.slug,
          country_iso2:   c.country_iso2,
          country_name:   c.country_name,
          confederation:  c.confederation,
          flag_url:       c.flag_url,
          participations: parseInt(c.participations) || 0,
          titles:         parseInt(c.titles)         || 0,
          played:         parseInt(c.played)         || 0,
          won:            parseInt(c.won)            || 0,
          drawn:          parseInt(c.drawn)           || 0,
          lost:           parseInt(c.lost)            || 0,
        })),
        count: countries.length,
      }
    })
  } catch (err) { next(err) }
})

module.exports = router;
