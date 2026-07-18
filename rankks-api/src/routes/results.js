const express = require('express');
const router  = express.Router();
const { queryAll, queryOne, pool } = require('../db');
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
      SELECT st.position, st.stats, st.entity_type, st.group_name,
        e.id AS entity_id, e.canonical_name,
        e.slug AS entity_slug,
        COALESCE(en.display_name, e.canonical_name) AS display_name,
        COALESCE(en.short_name, e.canonical_name) AS short_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e.id AND is_current = true LIMIT 1), e.image_url) AS logo_url,
        co.iso2 AS country_iso2, co.name AS country_name, co.flag_url,
        -- Conference/division resolved for the season's own year via
        -- entity_conference_history where available (NBA teams have moved
        -- conferences repeatedly without relocating — e.g. St. Louis/Atlanta
        -- Hawks was Western through 1970, Eastern since) — falls back to the
        -- static sport_attributes field for entities with no era history
        -- loaded (every other sport, plus any gaps). Pre-1970 NBA seasons
        -- have no real "conference," only a division — derived Eastern/
        -- Western from the division name so the standings filter still has
        -- something sensible to bucket by.
        COALESCE(
          ech.conference,
          CASE WHEN ech.division ILIKE '%western%' THEN 'Western'
               WHEN ech.division ILIKE '%eastern%' THEN 'Eastern' END,
          e.sport_attributes->>'conference'
        ) AS conference,
        COALESCE(ech.division, e.sport_attributes->>'division') AS division
      FROM standings st
      JOIN entities e ON e.id = st.entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      LEFT JOIN entity_names en ON en.entity_id = e.id
        AND $2::int BETWEEN en.start_year AND COALESCE(en.end_year, 9999)
      LEFT JOIN entity_conference_history ech ON ech.entity_id = e.id
        AND $2::int BETWEEN ech.start_year AND COALESCE(ech.end_year, 9999)
      WHERE st.result_tab_id = $1
      ORDER BY st.position
    `, [tab.id, season?.year ?? null])
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
        he.slug AS home_slug, COALESCE(hen.display_name, he.canonical_name) AS home_display_name,
        hco.iso2 AS home_country_iso2, hco.flag_url AS home_flag,
        ae.id AS away_id, ae.canonical_name AS away_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = ae.id AND is_current = true LIMIT 1), ae.image_url) AS away_logo,
        ae.slug AS away_slug, COALESCE(aen.display_name, ae.canonical_name) AS away_display_name,
        aco.iso2 AS away_country_iso2, aco.flag_url AS away_flag,
        we.id AS winner_id, COALESCE(wen.display_name, we.canonical_name) AS winner_name,
        m.video_url AS video_url,
        m.source AS video_source,
        m.embeddable AS video_embeddable,
        m.thumbnail_url AS video_thumbnail_url
      FROM games g
      JOIN entities he ON he.id = g.home_entity_id
      LEFT JOIN countries hco ON hco.id = he.country_id
      LEFT JOIN entity_names hen ON hen.entity_id = he.id
        AND $2::int BETWEEN hen.start_year AND COALESCE(hen.end_year, 9999)
      JOIN entities ae ON ae.id = g.away_entity_id
      LEFT JOIN countries aco ON aco.id = ae.country_id
      LEFT JOIN entity_names aen ON aen.entity_id = ae.id
        AND $2::int BETWEEN aen.start_year AND COALESCE(aen.end_year, 9999)
      LEFT JOIN entities we ON we.id = g.winner_entity_id
      LEFT JOIN entity_names wen ON wen.entity_id = we.id
        AND $2::int BETWEEN wen.start_year AND COALESCE(wen.end_year, 9999)
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
    `, [tabIds, season?.year ?? null])

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

    const params = [tab.id, season?.year ?? null]
    let roundFilter = ''
    if (round) { params.push(round); roundFilter = `AND g.round = $${params.length}` }
    const games = await queryAll(`
      SELECT g.id, g.round, g.match_number, g.leg_number, g.match_date,
        g.venue, g.venue_city, g.home_seed, g.away_seed, g.score,
        g.stats, g.scorers, g.duration_minutes, g.is_walkover, g.is_retirement, g.home_won,
        he.id AS home_id, he.canonical_name AS home_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = he.id AND is_current = true LIMIT 1), he.image_url) AS home_logo,
        he.slug AS home_slug, COALESCE(hen.display_name, he.canonical_name) AS home_display_name,
        hco.iso2 AS home_country_iso2, hco.flag_url AS home_flag,
        ae.id AS away_id, ae.canonical_name AS away_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = ae.id AND is_current = true LIMIT 1), ae.image_url) AS away_logo,
        ae.slug AS away_slug, COALESCE(aen.display_name, ae.canonical_name) AS away_display_name,
        aco.iso2 AS away_country_iso2, aco.flag_url AS away_flag,
        we.id AS winner_id, COALESCE(wen.display_name, we.canonical_name) AS winner_name,
        m.video_url AS video_url,
        m.source AS video_source,
        m.embeddable AS video_embeddable,
        m.thumbnail_url AS video_thumbnail_url
      FROM games g
      JOIN entities he ON he.id = g.home_entity_id
      LEFT JOIN countries hco ON hco.id = he.country_id
      LEFT JOIN entity_names hen ON hen.entity_id = he.id
        AND $2::int BETWEEN hen.start_year AND COALESCE(hen.end_year, 9999)
      JOIN entities ae ON ae.id = g.away_entity_id
      LEFT JOIN countries aco ON aco.id = ae.country_id
      LEFT JOIN entity_names aen ON aen.entity_id = ae.id
        AND $2::int BETWEEN aen.start_year AND COALESCE(aen.end_year, 9999)
      LEFT JOIN entities we ON we.id = g.winner_entity_id
      LEFT JOIN entity_names wen ON wen.entity_id = we.id
        AND $2::int BETWEEN wen.start_year AND COALESCE(wen.end_year, 9999)
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
    const { tabKey, type } = req.query

    // Regular Season Players tab's Regular Season/Playoffs toggle — same
    // per-year sibling-season resolution the Awards fallback below already
    // does, just swapped: given the Regular Season's own seasonId, resolve
    // that year's Playoffs season instead and read its 'players' tab
    // (ingest-nba-playoff-player-boxscores.js writes there). Scoped to
    // tabKey === 'players' only — this toggle doesn't apply to football's
    // Scorers/Passers or basketball's Awards tabs.
    let effectiveSeasonId = seasonId
    if (type === 'playoffs' && tabKey === 'players') {
      const seasonRow = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
      if (seasonRow) {
        const playoffSeason = await queryOne(`
          SELECT s2.id FROM seasons s2
          JOIN events ev ON ev.id = s2.event_id
          WHERE s2.competition_id = $1 AND s2.year = $2 AND ev.slug LIKE 'playoffs%'
          LIMIT 1
        `, [seasonRow.competition_id, seasonRow.year])
        if (playoffSeason) effectiveSeasonId = playoffSeason.id
      }
    }

    // Optional tab-scoping: football's Scorers/Passers/Players/Clubs tabs all
    // read the same full-squad row set for a season (result_tab_id always
    // NULL on those rows) — filtering by a resolved tab there would exclude
    // every row and break every existing football page. Basketball's Awards
    // tabs (MVP/DPOY/6MOY/MIP/ROY) share one Awards season across 6 genuinely
    // different candidate lists and DO populate result_tab_id, so the filter
    // only actually applies when this season's rows are tab-scoped at all.
    let tabId = null
    if (tabKey) {
      const tab = await queryOne(`SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`, [effectiveSeasonId, tabKey])
      if (tab) {
        const scoped = await queryOne(
          `SELECT 1 FROM player_season_stats WHERE season_id = $1 AND result_tab_id IS NOT NULL LIMIT 1`,
          [effectiveSeasonId]
        )
        if (scoped) tabId = tab.id
      }
    }

    // Basketball's Awards/EOST tabs list vote candidates (shooting splits +
    // vote counts) — their stats jsonb has no minutes/points, that's only
    // on the Regular Season box-score rows (tab_key='players'). Resolve
    // that season by event slug (never a raw id) so Min/Pts on the Awards
    // tables can fall back to it for any competition/year, no per-sport
    // code change needed.
    const AWARD_TAB_KEYS = ['mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy', 'nba-cup-mvp', 'nba-cup-teams',
      'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd']
    let regularSeasonId = null
    // Awards/EOST Regular Season/Playoffs toggle: when type=playoffs, also
    // resolve that year's Playoffs 'players' box scores (same ingestion
    // shape as Regular Season, see ingest-nba-playoff-player-boxscores.js)
    // so the query below can swap the box-score fields sourced from it.
    let playoffSeasonId = null
    if (tabId && AWARD_TAB_KEYS.includes(tabKey)) {
      const seasonRow = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
      if (seasonRow) {
        const regSeason = await queryOne(`
          SELECT s2.id FROM seasons s2
          JOIN events ev ON ev.id = s2.event_id
          WHERE s2.competition_id = $1 AND s2.year = $2 AND ev.slug LIKE 'regular-season%'
          LIMIT 1
        `, [seasonRow.competition_id, seasonRow.year])
        if (regSeason) regularSeasonId = regSeason.id

        if (type === 'playoffs') {
          const poSeason = await queryOne(`
            SELECT s2.id FROM seasons s2
            JOIN events ev ON ev.id = s2.event_id
            WHERE s2.competition_id = $1 AND s2.year = $2 AND ev.slug LIKE 'playoffs%'
            LIMIT 1
          `, [seasonRow.competition_id, seasonRow.year])
          if (poSeason) playoffSeasonId = poSeason.id
        }
      }
    }

    const players = await queryAll(`
      SELECT DISTINCT ON (e.id)
        e.id,
        e.canonical_name,
        e.slug,
        e.canonical_name  AS display_name,
        e.image_url,
        e.birth_date,
        e.death_date,

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
          nat_co.iso2,
          -- Final fallback: entities.country_id directly — the admin panel's
          -- Country field writes there (a real FK), not to player_attributes.
          -- Sports with no 'nationality' player_attributes rows at all (e.g.
          -- basketball, which has no player_attributes rows whatsoever) would
          -- otherwise never show a country regardless of what's set here.
          ent_co.iso2
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
          nat_co.name,
          ent_co.name
        ) AS country_name,
        COALESCE(nat_co.flag_url, ent_co.flag_url) AS flag_url,

        -- Position from player_attributes key-value
        pa_pos.attribute_value AS position,

        -- Stats — pick row with most games played
        -- GP for Awards/EOST tabs — same regularSeasonId fallback as Min/Pts
        -- above (these rows never carry their own games_played).
        COALESCE(pss.games_played, reg_pss.games_played) AS games_played,
        pss.goals,
        pss.assists,
        pss.yellow_cards,
        pss.red_cards,
        COALESCE(pss.minutes_played, CASE WHEN $4::text = 'playoffs' THEN playoff_pss.minutes_played ELSE reg_pss.minutes_played END) AS minutes_played,
        pss.ranking_at_event,
        -- Awards/EOST box-score fields (fgm/tpm/ftm/assists/rebounds/blocks
        -- + their totals) are baked into this row's own stats at ingestion
        -- time (Regular Season only) — when viewing Playoffs, overlay the
        -- Playoffs-sourced equivalents on top instead of the baked-in ones.
        -- Falls back to the baked-in (Regular Season) values for any
        -- candidate who didn't play in that year's playoffs.
        CASE
          WHEN $4::text = 'playoffs' AND playoff_pss.id IS NOT NULL
          THEN pss.stats || jsonb_build_object(
                 'fgm', playoff_pss.stats->'fgm', 'fg_pct', playoff_pss.stats->'fg_pct',
                 'tpm', playoff_pss.stats->'tpm', 'tp_pct', playoff_pss.stats->'tp_pct',
                 'ftm', playoff_pss.stats->'ftm', 'ft_pct', playoff_pss.stats->'ft_pct',
                 'assists', playoff_pss.stats->'assists',
                 'rebounds', playoff_pss.stats->'rebounds',
                 'blocks', playoff_pss.stats->'blocks',
                 'totals', jsonb_build_object(
                   'fgm', playoff_pss.stats->'totals'->'fgm',
                   'tpm', playoff_pss.stats->'totals'->'tpm',
                   'ftm', playoff_pss.stats->'totals'->'ftm',
                   'assists', playoff_pss.stats->'totals'->'assists',
                   'rebounds', playoff_pss.stats->'totals'->'rebounds',
                   'blocks', playoff_pss.stats->'totals'->'blocks'
                 )
               )
          ELSE pss.stats
        END AS stats,
        -- Min/Pts for Awards/EOST tabs — see regularSeasonId comment above
        COALESCE((pss.stats->>'points')::numeric, CASE WHEN $4::text = 'playoffs' THEN (playoff_pss.stats->>'points')::numeric ELSE (reg_pss.stats->>'points')::numeric END) AS points,
        -- Total-mode counterparts of the two lines above — same fallback,
        -- reading each row's stats->totals instead of the per-game fields.
        COALESCE((pss.stats->'totals'->>'minutes')::numeric, CASE WHEN $4::text = 'playoffs' THEN (playoff_pss.stats->'totals'->>'minutes')::numeric ELSE (reg_pss.stats->'totals'->>'minutes')::numeric END) AS total_minutes,
        COALESCE((pss.stats->'totals'->>'points')::numeric, CASE WHEN $4::text = 'playoffs' THEN (playoff_pss.stats->'totals'->>'points')::numeric ELSE (reg_pss.stats->'totals'->>'points')::numeric END) AS total_points,

        -- Club name + slug + type (club vs national_team — drives
        -- whether the frontend shows one merged Country filter or
        -- separate Club/Country filters)
        club_e.canonical_name AS club_name,
        club_e.slug           AS club_slug,
        club_e.entity_type    AS club_entity_type,
        club_e.sport_attributes->>'team_code' AS club_code,

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

      -- Country fallback via entities.country_id direct FK (see COALESCE above)
      LEFT JOIN countries ent_co ON ent_co.id = e.country_id

      -- Position from player_attributes
      LEFT JOIN player_attributes pa_pos
        ON pa_pos.entity_id = pss.entity_id
        AND pa_pos.attribute_key = 'position'

      -- Club — basketball's Awards/EOST rows can't populate the dedicated
      -- club_entity_id column: uq_player_season_club is UNIQUE(entity_id,
      -- season_id, club_entity_id), and multiple award tabs legitimately
      -- share one season_id per player (see the tab-scoping comment above),
      -- which would collide on that column. Stored in stats jsonb instead
      -- for those rows — falls back there when the column itself is null.
      LEFT JOIN entities club_e
        ON club_e.id = COALESCE(pss.club_entity_id, (pss.stats->>'club_entity_id')::int)

      -- Club logo
      LEFT JOIN entity_logos club_logo
        ON club_logo.entity_id = pss.club_entity_id
        AND club_logo.is_current = true

      -- Regular Season box-score row for the same player, for Min/Pts
      -- fallback on Awards/EOST tabs (regularSeasonId is null otherwise,
      -- so this LEFT JOIN simply matches nothing for every other query)
      LEFT JOIN player_season_stats reg_pss
        ON reg_pss.entity_id = pss.entity_id AND reg_pss.season_id = $3

      -- Playoffs box-score row for the same player — only populated (and
      -- only ever joined against) when the Awards/EOST Playoffs toggle is
      -- active; see playoffSeasonId comment above.
      LEFT JOIN player_season_stats playoff_pss
        ON playoff_pss.entity_id = pss.entity_id AND playoff_pss.season_id = $5

      WHERE pss.season_id = $1 AND ($2::int IS NULL OR pss.result_tab_id = $2)
      ORDER BY e.id, pss.games_played DESC NULLS LAST
    `, [effectiveSeasonId, tabId, regularSeasonId, type || null, playoffSeasonId])

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
    // Two separate search fragments: countSql has no ageRefDate slot, so its
    // search placeholder is one position earlier than the main query's.
    const searchWhereMain  = hasSearch ? `AND e.canonical_name ILIKE $9` : ''
    const searchWhereCount = hasSearch ? `AND e.canonical_name ILIKE $8` : ''
    // Kept as an alias so the main sql template below (which references
    // ${searchWhere}) doesn't need touching.
    const searchWhere = searchWhereMain

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

    // countSql has no age column at all, so it must NOT receive ageRefDate —
    // Postgres infers a query's required parameter count from the highest
    // $n actually referenced in ITS OWN text (max $7, or $8 if searching),
    // and errors if the supplied array doesn't match exactly. Passing the
    // 8/9-element `params` array (sized for the main query, which does
    // reference $8) here caused a hard 500 on every request — this was the
    // actual bug, not a data issue.
    const countParams = [
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
        e.death_date,
        -- age_at_event is capped at death_date when the player has died
        -- before the cutoff date — same "frozen age" rule calcAge.js
        -- applies client-side elsewhere, done here in SQL since this
        -- route computes age server-side rather than sending birth_date
        -- to the frontend for calcAge() to use.
        DATE_PART('year', AGE(LEAST($8::date, COALESCE(e.death_date, $8::date)), e.birth_date::date))::int AS age_at_event,
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
        ${searchWhereCount}
        ${filterWhere}
    `

    const [rows, countRow] = await Promise.all([
      queryAll(sql, params),
      queryOne(countSql, countParams),
    ])

    const players = rows.map((p, idx) => ({
      rank:          offset + idx + 1,
      entity_id:     p.entity_id,
      slug:          p.slug,
      canonical_name: p.canonical_name,
      country_iso2:  p.country_iso2,
      birth_date:    p.birth_date,
      death_date:    p.death_date,
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
    let { seasonId } = req.params

    // Basketball: Teams/Players (and the rest of this block) should always
    // reflect the season's overall Regular Season totals — "this season
    // had 30 teams, 580 players" — identically on every event's EventBlock
    // (Finals/Playoffs/Play-in/All-Time/etc), not whatever the currently
    // active event's own season_id happens to carry (most have zero
    // player_season_stats rows of their own). Resolve to the Regular
    // Season event's season_id for this competition+year before querying,
    // regardless of which event's seasonId was actually passed in. Football
    // has no such multi-event-per-year season split, so this is scoped to
    // basketball only — every other sport's behavior is unchanged.
    const seasonSport = await queryOne(`
      SELECT s.competition_id, s.year, sp.slug AS sport_slug
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN sports sp ON sp.id = ec.sport_id
      WHERE s.id = $1
    `, [seasonId])
    if (seasonSport?.sport_slug === 'basketball') {
      const regSeason = await queryOne(`
        SELECT s2.id FROM seasons s2
        JOIN events ev ON ev.id = s2.event_id
        WHERE s2.competition_id = $1 AND s2.year = $2 AND ev.slug LIKE 'regular-season%'
        LIMIT 1
      `, [seasonSport.competition_id, seasonSport.year]);
      if (regSeason) seasonId = regSeason.id;
    }

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

// GET /results/teams/:seasonId
//
// All-time cumulative team stats (NBA Titles/Seasons/Conf. Titles/Reg. Season
// W-L/Playoffs W-L), "through <year>" — BASK-NAV-01 page 10's Teams Template.
// Genuinely different shape from the existing /clubs route (built around
// UCL's tab_group knockout format: group_stages/final_tour, participations +
// titles + played/won/drawn/lost from a single competition-wide games scan).
// Basketball has no tab_group at all — its events (Regular Season/Playoffs/
// Finals) are separate `events` rows each with their own result_tabs, so
// cumulative stats here are built by scanning each event's own known tab_keys
// directly rather than reusing /clubs' tab_group-based CTEs.
router.get('/teams/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const { search } = req.query

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    // Only teams with a Regular Season standings row in the CURRENTLY
    // SELECTED year appear on the page — same "who's active this year"
    // scoping /clubs uses — even though every stat shown is cumulative
    // through this year, not just this season's numbers.
    const currentTeams = await queryAll(`
      SELECT DISTINCT st.entity_id
      FROM standings st
      JOIN result_tabs rt ON rt.id = st.result_tab_id
      JOIN seasons s ON s.id = rt.season_id
      WHERE s.competition_id = $1 AND s.year = $2 AND rt.tab_key = 'standings'
    `, [competition_id, year])
    const teamIds = currentTeams.map(t => t.entity_id)
    if (!teamIds.length) return res.json({ data: { teams: [], count: 0 } })

    const params = [teamIds, competition_id, year]
    let searchWhere = ''
    if (search) { params.push(`%${search}%`); searchWhere = ` AND e.canonical_name ILIKE $${params.length}` }

    const teams = await queryAll(`
      WITH reg_season_games AS (
        SELECT g.id, g.winner_entity_id, g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'regular-season%'
          AND rt.tab_key = 'results' AND g.home_entity_id = ANY($1)
        UNION ALL
        SELECT g.id, g.winner_entity_id, g.away_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'regular-season%'
          AND rt.tab_key = 'results' AND g.away_entity_id = ANY($1)
      ),
      reg_season AS (
        SELECT team_id,
          COUNT(*) AS played,
          COUNT(*) FILTER (WHERE winner_entity_id = team_id) AS won,
          COUNT(*) FILTER (WHERE winner_entity_id IS NOT NULL AND winner_entity_id != team_id) AS lost
        FROM reg_season_games GROUP BY team_id
      ),
      playoff_games AS (
        SELECT g.id, g.winner_entity_id, g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'playoffs%'
          AND rt.tab_key IN ('eastern-conference', 'western-conference') AND g.home_entity_id = ANY($1)
        UNION ALL
        SELECT g.id, g.winner_entity_id, g.away_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'playoffs%'
          AND rt.tab_key IN ('eastern-conference', 'western-conference') AND g.away_entity_id = ANY($1)
      ),
      playoffs AS (
        SELECT team_id,
          COUNT(*) AS played,
          COUNT(*) FILTER (WHERE winner_entity_id = team_id) AS won,
          COUNT(*) FILTER (WHERE winner_entity_id IS NOT NULL AND winner_entity_id != team_id) AS lost
        FROM playoff_games GROUP BY team_id
      ),
      seasons_played AS (
        SELECT st.entity_id AS team_id, COUNT(DISTINCT s.year) AS seasons
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND rt.tab_key = 'standings'
          AND st.entity_id = ANY($1)
        GROUP BY st.entity_id
      ),
      -- NBA Finals and Conference Finals are best-of-7 series decided by
      -- game-win count, not by whether a team won any single game — both
      -- finalists always win at least one game, so "winner_entity_id appears
      -- in a game that year" (the naive version of this query) credits BOTH
      -- participants with a title, including the loser. The real winner per
      -- year/series is whichever team has the most game-wins in that tab.
      nba_champions_by_year AS (
        SELECT s.year, g.winner_entity_id AS team_id, COUNT(*) AS game_wins
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'finals%'
          AND rt.tab_key = 'nba-finals' AND g.winner_entity_id IS NOT NULL
        GROUP BY s.year, g.winner_entity_id
      ),
      nba_champions AS (
        SELECT DISTINCT ON (year) year, team_id
        FROM nba_champions_by_year
        ORDER BY year, game_wins DESC
      ),
      nba_titles AS (
        SELECT team_id, COUNT(*) AS titles FROM nba_champions
        WHERE team_id = ANY($1) GROUP BY team_id
      ),
      -- Finals appearance = reached the Finals that season (either side of
      -- the series), same "home OR away, one row per year" rule /seasons/
      -- entity-history uses for a single team — a title is always also an
      -- appearance, this is the broader count.
      nba_finalists AS (
        SELECT DISTINCT s.year, g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'finals%' AND rt.tab_key = 'nba-finals'
        UNION
        SELECT DISTINCT s.year, g.away_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'finals%' AND rt.tab_key = 'nba-finals'
      ),
      nba_finals_appearances AS (
        SELECT team_id, COUNT(*) AS appearances FROM nba_finalists
        WHERE team_id = ANY($1) GROUP BY team_id
      ),
      -- NBA Cup Finals/Titles — same shape as NBA Finals/Titles above, just
      -- keyed off the Cup's own 'final' tab (unique tab_key across the
      -- whole competition, event 'nba-cup-4828') instead of 'nba-finals'.
      -- The Cup Final is always a single game, but this still counts
      -- game-wins rather than assuming winner_entity_id alone is safe, for
      -- the same reason the NBA Finals CTE does.
      nba_cup_champions_by_year AS (
        SELECT s.year, g.winner_entity_id AS team_id, COUNT(*) AS game_wins
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug = 'nba-cup-4828'
          AND rt.tab_key = 'final' AND g.winner_entity_id IS NOT NULL
        GROUP BY s.year, g.winner_entity_id
      ),
      nba_cup_champions AS (
        SELECT DISTINCT ON (year) year, team_id
        FROM nba_cup_champions_by_year
        ORDER BY year, game_wins DESC
      ),
      nba_cup_titles AS (
        SELECT team_id, COUNT(*) AS titles FROM nba_cup_champions
        WHERE team_id = ANY($1) GROUP BY team_id
      ),
      nba_cup_finalists AS (
        SELECT DISTINCT s.year, g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug = 'nba-cup-4828' AND rt.tab_key = 'final'
        UNION
        SELECT DISTINCT s.year, g.away_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug = 'nba-cup-4828' AND rt.tab_key = 'final'
      ),
      nba_cup_finals_appearances AS (
        SELECT team_id, COUNT(*) AS appearances FROM nba_cup_finalists
        WHERE team_id = ANY($1) GROUP BY team_id
      ),
      conf_champions_by_year AS (
        SELECT s.year, rt.tab_key AS conference, g.winner_entity_id AS team_id, COUNT(*) AS game_wins
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'finals%'
          AND rt.tab_key IN ('eastern-finals', 'western-finals') AND g.winner_entity_id IS NOT NULL
        GROUP BY s.year, rt.tab_key, g.winner_entity_id
      ),
      conf_champions AS (
        SELECT DISTINCT ON (year, conference) year, conference, team_id
        FROM conf_champions_by_year
        ORDER BY year, conference, game_wins DESC
      ),
      conf_titles AS (
        SELECT team_id, COUNT(*) AS titles FROM conf_champions
        WHERE team_id = ANY($1) GROUP BY team_id
      ),
      conf_finalists AS (
        SELECT DISTINCT s.year, rt.tab_key AS conference, g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'finals%'
          AND rt.tab_key IN ('eastern-finals', 'western-finals')
        UNION
        SELECT DISTINCT s.year, rt.tab_key AS conference, g.away_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND ev.slug LIKE 'finals%'
          AND rt.tab_key IN ('eastern-finals', 'western-finals')
      ),
      conf_finals_appearances AS (
        SELECT team_id, COUNT(*) AS appearances FROM conf_finalists
        WHERE team_id = ANY($1) GROUP BY team_id
      ),
      -- MVPs won by players while on this roster — club comes from the
      -- award row's own stats jsonb (see ingest-nba-awards.js's
      -- getRegularSeasonStats: club_entity_id is never a real column on
      -- these rows, only ever stored in stats, unlike Regular Season rows).
      mvp_winners AS (
        SELECT COALESCE(pss.club_entity_id, (pss.stats->>'club_entity_id')::int) AS team_id, COUNT(*) AS mvps
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'mvp' AND s.competition_id = $2 AND s.year <= $3
          AND (pss.stats->>'winner')::boolean = true
        GROUP BY 1
      ),
      -- Distinct players who ever suited up for this team, from Regular
      -- Season box-score rows (club_entity_id IS a real column there).
      distinct_players AS (
        SELECT pss.club_entity_id AS team_id, COUNT(DISTINCT pss.entity_id) AS players
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $2 AND s.year <= $3
          AND pss.club_entity_id = ANY($1)
        GROUP BY pss.club_entity_id
      ),
      -- Same distinct-players roster, split American vs international by
      -- the player's own entities.country_id. Players with no country on
      -- file fall into neither bucket (silently excluded, not guessed).
      distinct_players_nat AS (
        SELECT pss.club_entity_id AS team_id,
          COUNT(DISTINCT pss.entity_id) FILTER (WHERE co.iso2 = 'US') AS american,
          COUNT(DISTINCT pss.entity_id) FILTER (WHERE co.iso2 IS NOT NULL AND co.iso2 != 'US') AS international
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN entities pe ON pe.id = pss.entity_id
        LEFT JOIN countries co ON co.id = pe.country_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $2 AND s.year <= $3
          AND pss.club_entity_id = ANY($1)
        GROUP BY pss.club_entity_id
      ),
      -- Regular Season standings, one row per team per year, with the
      -- team's conference resolved for THAT year (same era-aware lookup
      -- /standings uses — conferences have changed over NBA history
      -- without a relocation, e.g. Atlanta Hawks Western->Eastern 1970).
      season_standings AS (
        SELECT st.entity_id AS team_id, s.year, st.position,
          COALESCE(
            ech.conference,
            CASE WHEN ech.division ILIKE '%western%' THEN 'Western'
                 WHEN ech.division ILIKE '%eastern%' THEN 'Eastern' END,
            e.sport_attributes->>'conference'
          ) AS conference
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN entities e ON e.id = st.entity_id
        LEFT JOIN entity_conference_history ech ON ech.entity_id = e.id
          AND s.year BETWEEN ech.start_year AND COALESCE(ech.end_year, 9999)
        WHERE rt.tab_key = 'standings' AND s.competition_id = $2 AND s.year <= $3
      ),
      -- "All NBA": seasons this team finished #1 in the OVERALL league
      -- standings (position is the whole-league rank, not conference-scoped
      -- — see /standings' identical ORDER BY st.position).
      league_leaders AS (
        SELECT team_id, COUNT(*) AS all_nba_leader
        FROM season_standings
        WHERE position = 1 AND team_id = ANY($1)
        GROUP BY team_id
      ),
      -- "Conf.": seasons this team had the best position among just its
      -- own conference that year (best-in-conference, not necessarily
      -- best in the league).
      conf_leader_rows AS (
        SELECT year, conference, team_id,
          ROW_NUMBER() OVER (PARTITION BY year, conference ORDER BY position ASC) AS rk
        FROM season_standings
        WHERE conference IS NOT NULL
      ),
      conf_leaders AS (
        SELECT team_id, COUNT(*) AS conf_leader
        FROM conf_leader_rows
        WHERE rk = 1 AND team_id = ANY($1)
        GROUP BY team_id
      ),
      -- Prior franchise names (relocations/rebrands — e.g. Seattle
      -- SuperSonics -> Oklahoma City Thunder), oldest first, excluding
      -- whatever the entity's current canonical_name already is. Same
      -- CTE as /team-honours — franchise continuity means one entity
      -- spans every name it's ever had (see [[nba-franchise-continuity]]).
      former_names AS (
        SELECT entity_id, STRING_AGG(display_name, ', ' ORDER BY first_year) AS names
        FROM (
          SELECT en.entity_id, en.display_name, MIN(en.start_year) AS first_year
          FROM entity_names en
          JOIN entities e2 ON e2.id = en.entity_id
          WHERE en.display_name IS DISTINCT FROM e2.canonical_name
          GROUP BY en.entity_id, en.display_name
        ) x
        GROUP BY entity_id
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug,
        e.sport_attributes->>'conference' AS conference,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e.id AND is_current = true LIMIT 1), e.image_url) AS logo_url,
        former_names.names AS former_names,
        COALESCE(nba_finals_appearances.appearances, 0) AS nba_finals,
        COALESCE(nba_titles.titles, 0) AS nba_titles,
        COALESCE(nba_cup_finals_appearances.appearances, 0) AS nba_cup_finals,
        COALESCE(nba_cup_titles.titles, 0) AS nba_cup_titles,
        COALESCE(seasons_played.seasons, 0) AS seasons,
        COALESCE(conf_finals_appearances.appearances, 0) AS conf_finals,
        COALESCE(conf_titles.titles, 0) AS conf_titles,
        COALESCE(mvp_winners.mvps, 0) AS mvps,
        COALESCE(distinct_players.players, 0) AS players,
        COALESCE(distinct_players_nat.american, 0) AS players_american,
        COALESCE(distinct_players_nat.international, 0) AS players_international,
        COALESCE(league_leaders.all_nba_leader, 0) AS standings_all_nba,
        COALESCE(conf_leaders.conf_leader, 0) AS standings_conf,
        COALESCE(reg_season.played, 0) AS reg_season_played,
        COALESCE(reg_season.won, 0) AS reg_season_won,
        COALESCE(reg_season.lost, 0) AS reg_season_lost,
        COALESCE(playoffs.played, 0) AS playoffs_played,
        COALESCE(playoffs.won, 0) AS playoffs_won,
        COALESCE(playoffs.lost, 0) AS playoffs_lost
      FROM entities e
      LEFT JOIN reg_season ON reg_season.team_id = e.id
      LEFT JOIN playoffs ON playoffs.team_id = e.id
      LEFT JOIN seasons_played ON seasons_played.team_id = e.id
      LEFT JOIN nba_finals_appearances ON nba_finals_appearances.team_id = e.id
      LEFT JOIN nba_titles ON nba_titles.team_id = e.id
      LEFT JOIN nba_cup_finals_appearances ON nba_cup_finals_appearances.team_id = e.id
      LEFT JOIN nba_cup_titles ON nba_cup_titles.team_id = e.id
      LEFT JOIN conf_finals_appearances ON conf_finals_appearances.team_id = e.id
      LEFT JOIN conf_titles ON conf_titles.team_id = e.id
      LEFT JOIN mvp_winners ON mvp_winners.team_id = e.id
      LEFT JOIN distinct_players ON distinct_players.team_id = e.id
      LEFT JOIN distinct_players_nat ON distinct_players_nat.team_id = e.id
      LEFT JOIN league_leaders ON league_leaders.team_id = e.id
      LEFT JOIN conf_leaders ON conf_leaders.team_id = e.id
      LEFT JOIN former_names ON former_names.entity_id = e.id
      WHERE e.id = ANY($1)
        ${searchWhere}
      ORDER BY COALESCE(nba_titles.titles, 0) DESC,
               COALESCE(seasons_played.seasons, 0) DESC,
               e.canonical_name ASC
    `, params)

    res.json({
      data: {
        teams: teams.map(t => ({
          entity_id:         t.entity_id,
          canonical_name:    t.canonical_name,
          slug:              t.slug,
          conference:        t.conference,
          logo_url:          t.logo_url,
          former_names:      t.former_names,
          nba_finals:        parseInt(t.nba_finals)        || 0,
          nba_titles:        parseInt(t.nba_titles)        || 0,
          nba_cup_finals:    parseInt(t.nba_cup_finals)    || 0,
          nba_cup_titles:    parseInt(t.nba_cup_titles)    || 0,
          conf_finals:       parseInt(t.conf_finals)       || 0,
          conf_titles:       parseInt(t.conf_titles)       || 0,
          mvps:              parseInt(t.mvps)              || 0,
          players:           parseInt(t.players)           || 0,
          players_american:     parseInt(t.players_american)     || 0,
          players_international: parseInt(t.players_international) || 0,
          standings_all_nba: parseInt(t.standings_all_nba) || 0,
          standings_conf:    parseInt(t.standings_conf)    || 0,
          seasons:           parseInt(t.seasons)           || 0,
          reg_season_played: parseInt(t.reg_season_played) || 0,
          reg_season_won:    parseInt(t.reg_season_won)    || 0,
          reg_season_lost:   parseInt(t.reg_season_lost)   || 0,
          playoffs_played:   parseInt(t.playoffs_played)   || 0,
          playoffs_won:      parseInt(t.playoffs_won)      || 0,
          playoffs_lost:     parseInt(t.playoffs_lost)     || 0,
        })),
        count: teams.length,
      }
    })
  } catch (err) { next(err) }
})

// GET /results/team-honours/:seasonId?search=...
//
// All-time cumulative INDIVIDUAL AWARDS credited to the team a player was
// on when they won them (MVP/Finals MVP/DPOY/6MOY/MIP/ROY/NBA Cup MVP/
// All-NBA 1st-2nd-3rd/All-Defense 1st-2nd) — "through <year>". Same club
// attribution rule /teams' mvp_winners CTE uses: award rows never carry a
// real club_entity_id column, only stats->>'club_entity_id' (see
// ingest-nba-awards.js). All-Star selections/MVP have no data source yet
// (all-star-4828 event has zero seasons ingested) — those two fields ship
// as null placeholders until that backfill happens.
router.get('/team-honours/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const { search } = req.query

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    // Same "who's active this year" scoping /teams and /clubs use — every
    // stat shown is cumulative through this year, but only teams playing
    // in the currently selected season appear on the page.
    const currentTeams = await queryAll(`
      SELECT DISTINCT st.entity_id
      FROM standings st
      JOIN result_tabs rt ON rt.id = st.result_tab_id
      JOIN seasons s ON s.id = rt.season_id
      WHERE s.competition_id = $1 AND s.year = $2 AND rt.tab_key = 'standings'
    `, [competition_id, year])
    const teamIds = currentTeams.map(t => t.entity_id)
    if (!teamIds.length) return res.json({ data: { teams: [], count: 0 } })

    const params = [teamIds, competition_id, year]
    let searchWhere = ''
    if (search) { params.push(`%${search}%`); searchWhere = ` AND e.canonical_name ILIKE $${params.length}` }

    const teams = await queryAll(`
      WITH award_rows AS (
        SELECT
          (pss.stats->>'club_entity_id')::int AS team_id,
          rt.tab_key,
          COALESCE((pss.stats->>'winner')::boolean, false) AS is_winner
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.year <= $3
          AND rt.tab_key IN ('mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy', 'nba-cup-mvp',
                              'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd',
                              'all-defense-1st', 'all-defense-2nd')
          AND pss.stats->>'club_entity_id' IS NOT NULL
      ),
      honours AS (
        SELECT
          team_id,
          COUNT(*) FILTER (WHERE tab_key = 'mvp' AND is_winner)        AS mvp,
          COUNT(*) FILTER (WHERE tab_key = 'finals-mvp' AND is_winner) AS finals_mvp,
          COUNT(*) FILTER (WHERE tab_key = 'dpoy' AND is_winner)       AS dpoy,
          COUNT(*) FILTER (WHERE tab_key = 'smoy' AND is_winner)       AS smoy,
          COUNT(*) FILTER (WHERE tab_key = 'mip' AND is_winner)        AS mip,
          COUNT(*) FILTER (WHERE tab_key = 'roy' AND is_winner)        AS roy,
          COUNT(*) FILTER (WHERE tab_key = 'nba-cup-mvp' AND is_winner) AS nba_cup_mvp,
          COUNT(*) FILTER (WHERE tab_key = 'all-nba-1st')              AS all_nba_1,
          COUNT(*) FILTER (WHERE tab_key = 'all-nba-2nd')              AS all_nba_2,
          COUNT(*) FILTER (WHERE tab_key = 'all-nba-3rd')              AS all_nba_3,
          COUNT(*) FILTER (WHERE tab_key = 'all-defense-1st')          AS all_def_1,
          COUNT(*) FILTER (WHERE tab_key = 'all-defense-2nd')          AS all_def_2
        FROM award_rows
        WHERE team_id = ANY($1)
        GROUP BY team_id
      ),
      -- Prior franchise names (relocations/rebrands — e.g. Seattle
      -- SuperSonics -> Oklahoma City Thunder), oldest first, excluding
      -- whatever the entity's current canonical_name already is. Franchise
      -- continuity means one entity spans every name it's ever had (see
      -- [[nba-franchise-continuity]] memory) — entity_names is the existing
      -- name-over-time ledger (same convention entity_logos uses).
      former_names AS (
        SELECT entity_id, STRING_AGG(display_name, ', ' ORDER BY first_year) AS names
        FROM (
          SELECT en.entity_id, en.display_name, MIN(en.start_year) AS first_year
          FROM entity_names en
          JOIN entities e2 ON e2.id = en.entity_id
          WHERE en.display_name IS DISTINCT FROM e2.canonical_name
          GROUP BY en.entity_id, en.display_name
        ) x
        GROUP BY entity_id
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug,
        e.sport_attributes->>'conference' AS conference,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e.id AND is_current = true LIMIT 1), e.image_url) AS logo_url,
        former_names.names AS former_names,
        COALESCE(honours.mvp, 0)        AS mvp,
        COALESCE(honours.finals_mvp, 0) AS finals_mvp,
        COALESCE(honours.dpoy, 0)       AS dpoy,
        COALESCE(honours.smoy, 0)       AS smoy,
        COALESCE(honours.mip, 0)        AS mip,
        COALESCE(honours.roy, 0)        AS roy,
        COALESCE(honours.nba_cup_mvp, 0) AS nba_cup_mvp,
        COALESCE(honours.all_nba_1, 0)  AS all_nba_1,
        COALESCE(honours.all_nba_2, 0)  AS all_nba_2,
        COALESCE(honours.all_nba_3, 0)  AS all_nba_3,
        COALESCE(honours.all_def_1, 0)  AS all_def_1,
        COALESCE(honours.all_def_2, 0)  AS all_def_2
      FROM entities e
      LEFT JOIN honours ON honours.team_id = e.id
      LEFT JOIN former_names ON former_names.entity_id = e.id
      WHERE e.id = ANY($1)
        ${searchWhere}
      ORDER BY COALESCE(honours.mvp, 0) DESC,
               COALESCE(honours.finals_mvp, 0) DESC,
               COALESCE(honours.dpoy, 0) DESC,
               e.canonical_name ASC
    `, params)

    res.json({
      data: {
        teams: teams.map(t => ({
          entity_id:      t.entity_id,
          canonical_name: t.canonical_name,
          slug:           t.slug,
          conference:     t.conference,
          logo_url:       t.logo_url,
          former_names:   t.former_names,
          mvp:            parseInt(t.mvp)        || 0,
          finals_mvp:     parseInt(t.finals_mvp) || 0,
          dpoy:           parseInt(t.dpoy)       || 0,
          smoy:           parseInt(t.smoy)       || 0,
          mip:            parseInt(t.mip)        || 0,
          roy:            parseInt(t.roy)        || 0,
          nba_cup_mvp:    parseInt(t.nba_cup_mvp) || 0,
          all_nba_1:      parseInt(t.all_nba_1)  || 0,
          all_nba_2:      parseInt(t.all_nba_2)  || 0,
          all_nba_3:      parseInt(t.all_nba_3)  || 0,
          all_def_1:      parseInt(t.all_def_1)  || 0,
          all_def_2:      parseInt(t.all_def_2)  || 0,
          // No All-Star data ingested yet — placeholder until it is.
          all_star:       null,
          all_star_mvp:   null,
        })),
        count: teams.length,
      }
    })
  } catch (err) { next(err) }
})

// GET /results/players-all-time/:seasonId?type=regular|playoffs&search=...
//
// Career cumulative player stats "through <year>" — the Players All-Time
// counterpart of /teams above. type selects which event's box scores to
// aggregate (Regular Season event 74 vs Playoffs event 76, backed by
// ingest-nba-player-boxscores.js / ingest-nba-playoff-player-boxscores.js
// respectively — both write the same stats.totals shape). NBA Finals/Titles
// and NBA Cup Finals/Titles are properties of the player's Regular Season
// roster membership regardless of which type is selected (see the
// /seasons/award-winner route's identical single-player version of this
// same roster-membership join).
router.get('/players-all-time/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const { search, type } = req.query
    const isPlayoffs = type === 'playoffs'
    const EVENT_ID = isPlayoffs ? 76 : 74
    const gameTabKeys = isPlayoffs ? ['eastern-conference', 'western-conference'] : ['results']

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    // Every player with a box-score row through the selected year (for the
    // selected type) appears on the page — career-wide, NOT scoped to the
    // currently active roster. This was previously filtered to s.year = $3
    // (the exact selected year only), which silently dropped every retired
    // legend — Jordan, Bird, etc. — from what's supposed to be an all-time
    // leaderboard, even though every stat shown is already computed
    // cumulative through this year regardless. Same bug class as the
    // player-awards route's identical "current roster" scoping mistake
    // (see /player-awards/:seasonId's comment) — fixed the same way here.
    const allPlayers = await queryAll(`
      SELECT DISTINCT pss.entity_id
      FROM player_season_stats pss
      JOIN result_tabs rt ON rt.id = pss.result_tab_id
      JOIN seasons s ON s.id = rt.season_id
      WHERE s.competition_id = $1 AND s.event_id = $2 AND s.year <= $3 AND rt.tab_key = 'players'
    `, [competition_id, EVENT_ID, year])
    const playerIds = allPlayers.map(p => p.entity_id)
    if (!playerIds.length) return res.json({ data: { players: [], count: 0 } })

    const params = [playerIds, competition_id, year, EVENT_ID, gameTabKeys]
    let searchWhere = ''
    if (search) { params.push(`%${search}%`); searchWhere = ` AND e.canonical_name ILIKE $${params.length}` }

    // Postgres badly underestimates row counts coming out of MATERIALIZED
    // CTEs (team_year_record/player_wl below are each estimated at ~1-2
    // rows regardless of actual size), which makes the planner pick a
    // Nested Loop to join them — fine at the old ~580-player (current
    // roster only) scale, but O(n×m) at the full ~4600-player all-time
    // scale: ~40M wasted comparisons, 13+ seconds. Forcing a Hash Join via
    // enable_nestloop=off drops that to <1s (verified via EXPLAIN ANALYZE).
    // Scoped to just this query's own transaction (SET LOCAL, not SET) so
    // it can't leak onto other requests sharing this pooled connection.
    const client = await pool.connect()
    let players
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL enable_nestloop = off')
      const result = await client.query(`
      WITH career_totals AS MATERIALIZED (
        SELECT pss.entity_id AS player_id,
          SUM(pss.games_played) AS games_played,
          SUM((pss.stats->'totals'->>'minutes')::numeric)   AS total_minutes,
          SUM((pss.stats->'totals'->>'points')::numeric)    AS total_points,
          SUM((pss.stats->'totals'->>'fgm')::numeric)       AS total_fgm,
          SUM((pss.stats->'totals'->>'fga')::numeric)       AS total_fga,
          SUM((pss.stats->'totals'->>'tpm')::numeric)       AS total_tpm,
          SUM((pss.stats->'totals'->>'tpa')::numeric)       AS total_tpa,
          SUM((pss.stats->'totals'->>'ftm')::numeric)       AS total_ftm,
          SUM((pss.stats->'totals'->>'fta')::numeric)       AS total_fta,
          SUM((pss.stats->'totals'->>'rebounds')::numeric)  AS total_rebounds,
          SUM((pss.stats->'totals'->>'assists')::numeric)   AS total_assists,
          SUM((pss.stats->'totals'->>'steals')::numeric)    AS total_steals,
          SUM((pss.stats->'totals'->>'blocks')::numeric)    AS total_blocks,
          SUM((pss.stats->'totals'->>'turnovers')::numeric) AS total_turnovers
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $2 AND s.event_id = $4 AND s.year <= $3
          AND pss.entity_id = ANY($1)
        GROUP BY pss.entity_id
      ),
      -- Team win/loss record summed over every season+club the player
      -- appears with (for the selected type) — the closest this data model
      -- can get to a personal W/L record without per-game player logs.
      -- MATERIALIZED: without it, Postgres inlines these and re-runs the
      -- games UNION+GROUP BY once per player_club_seasons row (hundreds of
      -- times) instead of once — a 60s+ query collapses to ~2s forced to
      -- compute each of these exactly once.
      player_club_seasons AS MATERIALIZED (
        SELECT DISTINCT pss.entity_id AS player_id, pss.club_entity_id AS team_id, s.year
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $2 AND s.event_id = $4 AND s.year <= $3
          AND pss.entity_id = ANY($1) AND pss.club_entity_id IS NOT NULL
      ),
      game_team_year AS MATERIALIZED (
        SELECT s.year, g.winner_entity_id, g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.event_id = $4 AND s.year <= $3 AND rt.tab_key = ANY($5)
        UNION ALL
        SELECT s.year, g.winner_entity_id, g.away_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $2 AND s.event_id = $4 AND s.year <= $3 AND rt.tab_key = ANY($5)
      ),
      team_year_record AS MATERIALIZED (
        SELECT team_id, year,
          COUNT(*) FILTER (WHERE winner_entity_id = team_id) AS won,
          COUNT(*) FILTER (WHERE winner_entity_id IS NOT NULL AND winner_entity_id != team_id) AS lost
        FROM game_team_year GROUP BY team_id, year
      ),
      player_wl AS MATERIALIZED (
        SELECT pcs.player_id, SUM(tyr.won) AS won, SUM(tyr.lost) AS lost
        FROM player_club_seasons pcs
        JOIN team_year_record tyr ON tyr.team_id = pcs.team_id AND tyr.year = pcs.year
        GROUP BY pcs.player_id
      ),
      -- Finals/Titles are Regular Season roster-membership facts regardless
      -- of the selected type — identical join shape to /seasons/award-winner's
      -- single-player version, just grouped across every player at once.
      nba_champions AS MATERIALIZED (
        SELECT DISTINCT ON (s.year) s.year, g.winner_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'nba-finals' AND s.competition_id = $2 AND s.year <= $3
          AND g.winner_entity_id IS NOT NULL
        GROUP BY s.year, g.winner_entity_id
        ORDER BY s.year, COUNT(*) DESC
      ),
      nba_finalists AS MATERIALIZED (
        SELECT DISTINCT s.year, g.home_entity_id AS team_id
        FROM games g JOIN result_tabs rt ON rt.id = g.result_tab_id JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'nba-finals' AND s.competition_id = $2 AND s.year <= $3
        UNION
        SELECT DISTINCT s.year, g.away_entity_id
        FROM games g JOIN result_tabs rt ON rt.id = g.result_tab_id JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'nba-finals' AND s.competition_id = $2 AND s.year <= $3
      ),
      player_titles AS MATERIALIZED (
        SELECT pss2.entity_id AS player_id, COUNT(*) AS titles
        FROM nba_champions c
        JOIN seasons rs ON rs.competition_id = $2 AND rs.event_id = 74 AND rs.year = c.year
        JOIN result_tabs rt2 ON rt2.season_id = rs.id AND rt2.tab_key = 'players'
        JOIN player_season_stats pss2 ON pss2.result_tab_id = rt2.id AND pss2.entity_id = ANY($1)
        WHERE COALESCE(pss2.club_entity_id, (pss2.stats->>'club_entity_id')::int) = c.team_id
        GROUP BY pss2.entity_id
      ),
      player_finals AS MATERIALIZED (
        SELECT pss2.entity_id AS player_id, COUNT(*) AS finals
        FROM nba_finalists f
        JOIN seasons rs ON rs.competition_id = $2 AND rs.event_id = 74 AND rs.year = f.year
        JOIN result_tabs rt2 ON rt2.season_id = rs.id AND rt2.tab_key = 'players'
        JOIN player_season_stats pss2 ON pss2.result_tab_id = rt2.id AND pss2.entity_id = ANY($1)
        WHERE COALESCE(pss2.club_entity_id, (pss2.stats->>'club_entity_id')::int) = f.team_id
        GROUP BY pss2.entity_id
      ),
      -- NBA Cup Finals/Titles — same roster-membership join as NBA
      -- Finals/Titles above, just keyed off the Cup's own 'final' tab
      -- (unique tab_key across the whole competition) instead of
      -- 'nba-finals'. No event_id filter needed for that reason.
      nba_cup_champions AS MATERIALIZED (
        SELECT DISTINCT ON (s.year) s.year, g.winner_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'final' AND s.competition_id = $2 AND s.year <= $3
          AND g.winner_entity_id IS NOT NULL
        GROUP BY s.year, g.winner_entity_id
        ORDER BY s.year, COUNT(*) DESC
      ),
      nba_cup_finalists AS MATERIALIZED (
        SELECT DISTINCT s.year, g.home_entity_id AS team_id
        FROM games g JOIN result_tabs rt ON rt.id = g.result_tab_id JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'final' AND s.competition_id = $2 AND s.year <= $3
        UNION
        SELECT DISTINCT s.year, g.away_entity_id
        FROM games g JOIN result_tabs rt ON rt.id = g.result_tab_id JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'final' AND s.competition_id = $2 AND s.year <= $3
      ),
      player_cup_titles AS MATERIALIZED (
        SELECT pss2.entity_id AS player_id, COUNT(*) AS titles
        FROM nba_cup_champions c
        JOIN seasons rs ON rs.competition_id = $2 AND rs.event_id = 74 AND rs.year = c.year
        JOIN result_tabs rt2 ON rt2.season_id = rs.id AND rt2.tab_key = 'players'
        JOIN player_season_stats pss2 ON pss2.result_tab_id = rt2.id AND pss2.entity_id = ANY($1)
        WHERE COALESCE(pss2.club_entity_id, (pss2.stats->>'club_entity_id')::int) = c.team_id
        GROUP BY pss2.entity_id
      ),
      player_cup_finals AS MATERIALIZED (
        SELECT pss2.entity_id AS player_id, COUNT(*) AS finals
        FROM nba_cup_finalists f
        JOIN seasons rs ON rs.competition_id = $2 AND rs.event_id = 74 AND rs.year = f.year
        JOIN result_tabs rt2 ON rt2.season_id = rs.id AND rt2.tab_key = 'players'
        JOIN player_season_stats pss2 ON pss2.result_tab_id = rt2.id AND pss2.entity_id = ANY($1)
        WHERE COALESCE(pss2.club_entity_id, (pss2.stats->>'club_entity_id')::int) = f.team_id
        GROUP BY pss2.entity_id
      ),
      -- Most recent team through the selected year — NOT an exact-year
      -- match. Retired players (Jordan, Bird, etc.) have no row in the
      -- exact selected year at all; s.year = $3 here was an INNER JOIN
      -- target below, so it silently dropped them from the whole page a
      -- second time even after the playerIds fix above. ORDER BY year DESC
      -- picks each player's last known team, same "most recent row ≤
      -- selected year" fix already applied to /player-awards/:seasonId.
      current_row AS MATERIALIZED (
        SELECT DISTINCT ON (pss.entity_id) pss.entity_id AS player_id, pss.club_entity_id, pss.stats->>'club_entity_id' AS stats_club_entity_id
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $2 AND s.event_id = $4 AND s.year <= $3
          AND pss.entity_id = ANY($1)
        ORDER BY pss.entity_id, s.year DESC
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug, e.image_url, e.birth_date,
        pa_pos.attribute_value AS position,
        ent_co.iso2 AS country_iso2, ent_co.name AS country_name,
        club_e.canonical_name AS club_name,
        club_e.sport_attributes->>'team_code' AS club_code,
        COALESCE(club_logo.logo_url, club_e.image_url) AS club_logo,
        COALESCE(ct.games_played, 0)      AS games_played,
        COALESCE(pw.won, 0)               AS wins,
        COALESCE(pw.lost, 0)              AS losses,
        COALESCE(pf.finals, 0)            AS nba_finals,
        COALESCE(pt.titles, 0)            AS nba_titles,
        COALESCE(cpf.finals, 0)           AS nba_cup_finals,
        COALESCE(cpt.titles, 0)           AS nba_cup_titles,
        ct.total_minutes, ct.total_points, ct.total_fgm, ct.total_fga,
        ct.total_tpm, ct.total_tpa, ct.total_ftm, ct.total_fta,
        ct.total_rebounds, ct.total_assists, ct.total_steals, ct.total_blocks, ct.total_turnovers
      FROM entities e
      JOIN current_row cr ON cr.player_id = e.id
      LEFT JOIN career_totals ct ON ct.player_id = e.id
      LEFT JOIN player_wl pw ON pw.player_id = e.id
      LEFT JOIN player_finals pf ON pf.player_id = e.id
      LEFT JOIN player_titles pt ON pt.player_id = e.id
      LEFT JOIN player_cup_finals cpf ON cpf.player_id = e.id
      LEFT JOIN player_cup_titles cpt ON cpt.player_id = e.id
      LEFT JOIN player_attributes pa_pos ON pa_pos.entity_id = e.id AND pa_pos.attribute_key = 'position'
      LEFT JOIN countries ent_co ON ent_co.id = e.country_id
      LEFT JOIN entities club_e ON club_e.id = COALESCE(cr.club_entity_id, (cr.stats_club_entity_id)::int)
      LEFT JOIN entity_logos club_logo ON club_logo.entity_id = club_e.id AND club_logo.is_current = true
      WHERE e.id = ANY($1)
        ${searchWhere}
      ORDER BY COALESCE(ct.total_points, 0) DESC, e.canonical_name ASC
    `, params)
      players = result.rows
      await client.query('COMMIT')
    } catch (queryErr) {
      await client.query('ROLLBACK')
      throw queryErr
    } finally {
      client.release()
    }

    res.json({
      data: {
        players: players.map(p => {
          const gp = parseInt(p.games_played) || 0
          const div = (total) => gp > 0 && total != null ? Math.round((Number(total) / gp) * 10) / 10 : null
          const pct = (made, att) => (made != null && att) ? Math.round((Number(made) / Number(att)) * 1000) / 1000 : null
          return {
            entity_id: p.entity_id,
            canonical_name: p.canonical_name,
            slug: p.slug,
            image_url: p.image_url,
            birth_date: p.birth_date,
            position: p.position,
            country_iso2: p.country_iso2,
            country_name: p.country_name,
            club_name: p.club_name,
            club_code: p.club_code,
            club_logo: p.club_logo,
            games_played: gp,
            wins: parseInt(p.wins) || 0,
            losses: parseInt(p.losses) || 0,
            nba_finals: parseInt(p.nba_finals) || 0,
            nba_titles: parseInt(p.nba_titles) || 0,
            nba_cup_finals: parseInt(p.nba_cup_finals) || 0,
            nba_cup_titles: parseInt(p.nba_cup_titles) || 0,
            stats: {
              minutes: div(p.total_minutes), points: div(p.total_points),
              fgm: div(p.total_fgm), tpm: div(p.total_tpm), ftm: div(p.total_ftm),
              rebounds: div(p.total_rebounds), assists: div(p.total_assists),
              steals: div(p.total_steals), blocks: div(p.total_blocks), turnovers: div(p.total_turnovers),
              fg_pct: pct(p.total_fgm, p.total_fga), tp_pct: pct(p.total_tpm, p.total_tpa), ft_pct: pct(p.total_ftm, p.total_fta),
              totals: {
                minutes: p.total_minutes != null ? Math.round(Number(p.total_minutes)) : null,
                points: p.total_points != null ? Number(p.total_points) : null,
                fgm: p.total_fgm != null ? Number(p.total_fgm) : null,
                tpm: p.total_tpm != null ? Number(p.total_tpm) : null,
                ftm: p.total_ftm != null ? Number(p.total_ftm) : null,
                rebounds: p.total_rebounds != null ? Number(p.total_rebounds) : null,
                assists: p.total_assists != null ? Number(p.total_assists) : null,
                steals: p.total_steals != null ? Number(p.total_steals) : null,
                blocks: p.total_blocks != null ? Number(p.total_blocks) : null,
                turnovers: p.total_turnovers != null ? Number(p.total_turnovers) : null,
              },
            },
          }
        }),
        count: players.length,
      }
    })
  } catch (err) { next(err) }
})

// GET /results/player-awards/:seasonId?search=...
//
// All-time cumulative individual awards per player — MVP/Finals MVP/DPOY/
// 6MOY/MIP/ROY/All-NBA 1st-2nd-3rd/All-Defense 1st-2nd — "through <year>".
// The player list is every player with at least one qualifying award row
// through the selected year (career-wide, NOT scoped to this year's
// active roster like the Player Stats tab is) — scoping to "current
// roster" silently dropped every retired legend (Jordan, Kareem, etc.)
// from what's supposed to be an all-time leaderboard. All-Star
// selections/MVP have no data source yet — those two ship as null
// placeholders, same as Team Honours.
router.get('/player-awards/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const { search } = req.query

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    const params = [competition_id, year]
    let searchWhere = ''
    if (search) { params.push(`%${search}%`); searchWhere = ` AND e.canonical_name ILIKE $${params.length}` }

    const players = await queryAll(`
      WITH award_rows AS (
        SELECT
          pss.entity_id AS player_id,
          rt.tab_key,
          COALESCE((pss.stats->>'winner')::boolean, false) AS is_winner
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
          AND rt.tab_key IN ('mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy', 'nba-cup-mvp',
                              'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd',
                              'all-defense-1st', 'all-defense-2nd')
      ),
      -- Only rows that actually count as a title/selection: winner=true
      -- for the single-winner tabs (mvp/finals-mvp/dpoy/smoy/mip/roy/
      -- nba-cup-mvp list every candidate, not just the winner), any row at
      -- all for the roster tabs (all-nba/all-defense — every row there IS
      -- a selection).
      qualifying AS (
        SELECT * FROM award_rows
        WHERE tab_key IN ('all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd')
           OR is_winner
      ),
      honours AS (
        SELECT
          player_id,
          COUNT(*) FILTER (WHERE tab_key = 'mvp')        AS mvp,
          COUNT(*) FILTER (WHERE tab_key = 'finals-mvp') AS finals_mvp,
          COUNT(*) FILTER (WHERE tab_key = 'dpoy')       AS dpoy,
          COUNT(*) FILTER (WHERE tab_key = 'smoy')       AS smoy,
          COUNT(*) FILTER (WHERE tab_key = 'mip')        AS mip,
          COUNT(*) FILTER (WHERE tab_key = 'roy')        AS roy,
          COUNT(*) FILTER (WHERE tab_key = 'nba-cup-mvp') AS nba_cup_mvp,
          COUNT(*) FILTER (WHERE tab_key = 'all-nba-1st')     AS all_nba_1,
          COUNT(*) FILTER (WHERE tab_key = 'all-nba-2nd')     AS all_nba_2,
          COUNT(*) FILTER (WHERE tab_key = 'all-nba-3rd')     AS all_nba_3,
          COUNT(*) FILTER (WHERE tab_key = 'all-defense-1st') AS all_def_1,
          COUNT(*) FILTER (WHERE tab_key = 'all-defense-2nd') AS all_def_2
        FROM qualifying
        GROUP BY player_id
      ),
      -- Last known team — their most recent Regular Season roster row
      -- through the selected year, NOT the exact selected year (a retired
      -- player has no row in, say, 2026, but still has a real last team).
      current_row AS (
        SELECT DISTINCT ON (pss.entity_id) pss.entity_id AS player_id,
          pss.club_entity_id, pss.stats->>'club_entity_id' AS stats_club_entity_id
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $1 AND s.event_id = 74 AND s.year <= $2
          AND pss.entity_id IN (SELECT DISTINCT player_id FROM qualifying)
        ORDER BY pss.entity_id, s.year DESC
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug, e.image_url, e.birth_date,
        pa_pos.attribute_value AS position,
        ent_co.iso2 AS country_iso2, ent_co.name AS country_name,
        club_e.canonical_name AS club_name,
        club_e.sport_attributes->>'team_code' AS club_code,
        COALESCE(honours.mvp, 0)        AS mvp,
        COALESCE(honours.finals_mvp, 0) AS finals_mvp,
        COALESCE(honours.dpoy, 0)       AS dpoy,
        COALESCE(honours.smoy, 0)       AS smoy,
        COALESCE(honours.mip, 0)        AS mip,
        COALESCE(honours.roy, 0)        AS roy,
        COALESCE(honours.nba_cup_mvp, 0) AS nba_cup_mvp,
        COALESCE(honours.all_nba_1, 0)  AS all_nba_1,
        COALESCE(honours.all_nba_2, 0)  AS all_nba_2,
        COALESCE(honours.all_nba_3, 0)  AS all_nba_3,
        COALESCE(honours.all_def_1, 0)  AS all_def_1,
        COALESCE(honours.all_def_2, 0)  AS all_def_2
      FROM entities e
      JOIN current_row cr ON cr.player_id = e.id
      LEFT JOIN honours ON honours.player_id = e.id
      LEFT JOIN player_attributes pa_pos ON pa_pos.entity_id = e.id AND pa_pos.attribute_key = 'position'
      LEFT JOIN countries ent_co ON ent_co.id = e.country_id
      LEFT JOIN entities club_e ON club_e.id = COALESCE(cr.club_entity_id, (cr.stats_club_entity_id)::int)
      WHERE TRUE
        ${searchWhere}
      ORDER BY COALESCE(honours.mvp, 0) DESC,
               COALESCE(honours.finals_mvp, 0) DESC,
               COALESCE(honours.dpoy, 0) DESC,
               e.canonical_name ASC
    `, params)

    res.json({
      data: {
        players: players.map(p => ({
          entity_id:      p.entity_id,
          canonical_name: p.canonical_name,
          slug:           p.slug,
          image_url:      p.image_url,
          birth_date:     p.birth_date,
          position:       p.position,
          country_iso2:   p.country_iso2,
          country_name:   p.country_name,
          club_name:      p.club_name,
          club_code:      p.club_code,
          mvp:            parseInt(p.mvp)        || 0,
          finals_mvp:     parseInt(p.finals_mvp) || 0,
          dpoy:           parseInt(p.dpoy)       || 0,
          smoy:           parseInt(p.smoy)       || 0,
          mip:            parseInt(p.mip)        || 0,
          roy:            parseInt(p.roy)        || 0,
          nba_cup_mvp:    parseInt(p.nba_cup_mvp) || 0,
          all_nba_1:      parseInt(p.all_nba_1)  || 0,
          all_nba_2:      parseInt(p.all_nba_2)  || 0,
          all_nba_3:      parseInt(p.all_nba_3)  || 0,
          all_def_1:      parseInt(p.all_def_1)  || 0,
          all_def_2:      parseInt(p.all_def_2)  || 0,
          // No All-Star data ingested yet — placeholder until it is.
          all_star:       null,
          all_star_mvp:   null,
        })),
        count: players.length,
      }
    })
  } catch (err) { next(err) }
})

module.exports = router;