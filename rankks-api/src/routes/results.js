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
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e.id AND $2::int BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e.image_url) AS logo_url,
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
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = he.id AND $2::int BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), he.image_url) AS home_logo,
        he.slug AS home_slug, COALESCE(hen.display_name, he.canonical_name) AS home_display_name,
        hco.iso2 AS home_country_iso2, hco.name AS home_country_name, hco.flag_url AS home_flag,
        ae.id AS away_id, ae.canonical_name AS away_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = ae.id AND $2::int BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), ae.image_url) AS away_logo,
        ae.slug AS away_slug, COALESCE(aen.display_name, ae.canonical_name) AS away_display_name,
        aco.iso2 AS away_country_iso2, aco.name AS away_country_name, aco.flag_url AS away_flag,
        we.id AS winner_id, COALESCE(wen.display_name, we.canonical_name) AS winner_name,
        m.id AS video_id,
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

    // Built from memberTabs (already ORDER BY display_order — e.g. Final,
    // 3rd Place, Semifinals, Quarter Finals, Round of 16, Round of 32 for a
    // knockout final_tour) rather than a bare DISTINCT round query, so the
    // frontend can render rounds in their real bracket order instead of
    // guessing from game dates — display_order is the single source of
    // truth for "which round comes first", stable even before every round
    // has been played/dated yet. g.round always equals the owning tab's
    // tab_key (verified against real data), so this join is exact.
    const rounds = memberTabs
      .filter(t => grouped[t.tab_key]?.length)
      .map(t => ({ round: t.tab_key, match_count: grouped[t.tab_key].length, display_order: t.display_order }))

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
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = he.id AND $2::int BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), he.image_url) AS home_logo,
        he.slug AS home_slug, COALESCE(hen.display_name, he.canonical_name) AS home_display_name,
        hco.iso2 AS home_country_iso2, hco.name AS home_country_name, hco.flag_url AS home_flag,
        ae.id AS away_id, ae.canonical_name AS away_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = ae.id AND $2::int BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), ae.image_url) AS away_logo,
        ae.slug AS away_slug, COALESCE(aen.display_name, ae.canonical_name) AS away_display_name,
        aco.iso2 AS away_country_iso2, aco.name AS away_country_name, aco.flag_url AS away_flag,
        we.id AS winner_id, COALESCE(wen.display_name, we.canonical_name) AS winner_name,
        m.id AS video_id,
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

    // Fetched unconditionally (unlike the seasonRow further below, which
    // only resolves inside the tabId branch) — needed for the club logo
    // join's year-scoping, and the real-club lookup below, regardless of
    // which branch this request takes.
    const baseSeasonRow = await queryOne(`SELECT year FROM seasons WHERE id = $1`, [seasonId])
    const seasonYear = baseSeasonRow?.year ?? null

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

    // Basketball's Awards/EOST/All-Star tabs list vote candidates or roster
    // picks (shooting splits, no minutes/points of their own) — Min/Pts only
    // live on the Regular Season box-score rows (tab_key='players'). Resolve
    // that season by event slug (never a raw id) so Min/Pts can fall back to
    // it for any competition/year, no per-sport code change needed.
    // All-Star's own tab_keys vary every year (fixed 'eastern-conference'/
    // 'western-conference' for conference-format years, a dynamic per-team
    // slug like 'team-lebron' otherwise — see ingest-nba-all-star.js), so
    // it's matched by event slug below rather than listed by tab_key.
    const AWARD_TAB_KEYS = ['mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy', 'nba-cup-mvp', 'nba-cup-teams',
      'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd',
      'all-rookie-1st', 'all-rookie-2nd']
    let regularSeasonId = null
    // Awards/EOST Regular Season/Playoffs toggle: when type=playoffs, also
    // resolve that year's Playoffs 'players' box scores (same ingestion
    // shape as Regular Season, see ingest-nba-playoff-player-boxscores.js)
    // so the query below can swap the box-score fields sourced from it.
    let playoffSeasonId = null
    if (tabId) {
      const seasonRow = await queryOne(`
        SELECT s.competition_id, s.year, ev.slug AS event_slug
        FROM seasons s JOIN events ev ON ev.id = s.event_id
        WHERE s.id = $1
      `, [seasonId])
      if (seasonRow && (AWARD_TAB_KEYS.includes(tabKey) || seasonRow.event_slug?.startsWith('all-star'))) {
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

        -- Club name + slug + type (club vs national_team — the Club column
        -- on national-team pages (World Cup) shows real_club_* below
        -- instead of this national-team name)
        club_e.canonical_name AS club_name,
        club_e.slug           AS club_slug,
        club_e.entity_type    AS club_entity_type,
        club_e.sport_attributes->>'team_code' AS club_code,

        -- Club logo
        club_logo.logo_url    AS club_logo,

        -- Real domestic club "at the time of" a national-team competition
        -- (World Cup) — this player's own most recent player_season_stats
        -- row, in ANY OTHER competition, whose club is a genuine
        -- entity_type='club' (not another national team), through this
        -- season's year. Only ever populated for national_team rows (the
        -- lateral's own WHERE is correlated on club_e.entity_type) — '-'
        -- on the frontend when null, which is common: most historical
        -- (1930-2006) and many 2010+ players have no ingested club-league
        -- data at all, so there's nothing to find.
        real_club.name  AS real_club_name,
        real_club.slug  AS real_club_slug,
        real_club.logo  AS real_club_logo

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
        AND $6::int BETWEEN club_logo.start_year AND COALESCE(club_logo.end_year, 9999)

      -- Real domestic club (see real_club_name comment above) — correlated
      -- WHERE, not a plain join condition, so it's a genuine no-op (0 rows,
      -- no wasted lookup) for every row that isn't a national_team one.
      LEFT JOIN LATERAL (
        SELECT club2.canonical_name AS name, club2.slug AS slug,
               COALESCE(el2.logo_url, club2.image_url) AS logo
        FROM player_season_stats pss2
        JOIN seasons s2 ON s2.id = pss2.season_id
        JOIN entities club2 ON club2.id = pss2.club_entity_id AND club2.entity_type = 'club'
        LEFT JOIN entity_logos el2
          ON el2.entity_id = club2.id
          AND s2.year BETWEEN el2.start_year AND COALESCE(el2.end_year, 9999)
        WHERE club_e.entity_type = 'national_team'
          AND pss2.entity_id = pss.entity_id
          AND s2.year <= $6::int
        ORDER BY s2.year DESC
        LIMIT 1
      ) real_club ON true

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
    `, [effectiveSeasonId, tabId, regularSeasonId, type || null, playoffSeasonId, seasonYear])

    // Sort alphabetically after dedup
    players.sort((a, b) => (a.canonical_name || '').localeCompare(b.canonical_name || ''))

    res.json({ data: { players, total: players.length } })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /results/tennis-players
// ?seasonId=145&gender=M&search=fed&player=Roger+Federer&country=Switzerland&page=1&limit=50
//
// Schema facts:
//   games.result_tab_id  → result_tabs.id → result_tabs.season_id → seasons
//   games.home_entity_id = winner, games.away_entity_id = loser
//   games.id             = unique match identifier (used as final_key)
//   games.winner_entity_id = the match winner (for round_reached below)
//
// Rules:
//   1. WHO         — players in ≥1 match in this seasonId
//   2. RANK        — best (lowest) w_rank/l_rank within this season's matches
//   3. TITLES/FINALS — at THIS competition specifically (career, every
//                      edition), in seasons whose start_date < this event's
//                      start_date — same "don't count the event being
//                      viewed" cutoff rule as everything else here
//   4. AGE         — at event end_date (unified RANKKS-wide rule — see
//                     src/utils/calcAge.js)
//
// All optional filters (player/country/search) are ALWAYS-present nullable
// params using `($n::text IS NULL OR ...)` rather than conditionally
// renumbering placeholders — the previous conditional-placeholder scheme
// caused two separate "bind message provides N params, statement requires
// M" 500s (2026-08-10) because countSql and sql have different max
// placeholder references. Fixed params per query eliminates that class of
// bug entirely.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tennis-players', async (req, res, next) => {
  try {
    const {
      seasonId,
      gender  = 'M',
      search  = '',
      player  = '',
      country = '',
      sort    = '',
      page    = 1,
      limit   = 50,
    } = req.query

    if (!seasonId) return res.status(400).json({ error: 'seasonId is required' })

    const offset       = (parseInt(page) - 1) * parseInt(limit)
    const genderFilter = gender === 'M' ? 'M' : 'F'

    // "Sort by:" dropdown — whitelist map, not string-interpolated user
    // input, so this can't be used for SQL injection despite building the
    // ORDER BY as a template string below.
    const SORT_CLAUSES = {
      participation: 'COALESCE(pt.participation_count, 0) DESC',
      round:         'COALESCE(fr.round_ord, 999) ASC',
      seasons:       'COALESCE(cse.season_count, 0) DESC',
      titles:        'COALESCE(cst.comp_titles, 0) DESC',
      finals:        'COALESCE(cst.comp_finals, 0) DESC',
      // Arithmetic on a NULL operand (missing event_points or prior_points
      // — see prior_points CTE) yields NULL automatically; NULLS LAST
      // pushes those un-comparable rows to the bottom regardless of DESC.
      gained:        '(sr.event_points - pp.prior_points) DESC NULLS LAST',
    }
    const orderByClause = SORT_CLAUSES[sort]
      ? `${SORT_CLAUSES[sort]}, sr.event_rank ASC NULLS LAST, e.canonical_name ASC`
      : `sr.event_rank ASC NULLS LAST, COALESCE(cst.comp_titles, 0) DESC, e.canonical_name ASC`
    const searchTerm    = search.trim()  || null
    const playerFilter  = player.trim()  || null
    const countryFilter = country.trim() || null

    // ── Cutoff date: start_date of this season ─────────────────────────────
    // No longer gates any CTE below (2026-08-10 — see the params comment
    // further down) — kept only as the ageRefDate fallback and the raw
    // `cutoff` field in the JSON response.
    const seasonRow = await queryOne(`
      SELECT
        COALESCE(
          s.start_date,
          (SELECT MIN(g.match_date)
           FROM games g
           JOIN result_tabs rt ON g.result_tab_id = rt.id
           WHERE rt.season_id = $1)
        ) AS cutoff_date,
        s.year AS season_year,
        s.competition_id AS competition_id
      FROM seasons s
      WHERE s.id = $1
    `, [seasonId])

    if (!seasonRow?.cutoff_date)
      return res.status(404).json({ error: 'Season not found or has no matches' })

    const cutoffDate    = seasonRow.cutoff_date
    const seasonYear    = seasonRow.season_year
    const competitionId = seasonRow.competition_id

    // ── Age reference date: end_date of this event ──────────────────────────
    // Unified RANKKS-wide rule (see src/utils/calcAge.js, applied identically
    // to football and F1): age is always computed as of the event's END, not
    // its start.
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

    // Shared filter fragment — identical text in both sql and countSql,
    // always referencing the same $n positions in each (see param arrays
    // below). NULL-check means "no filter applied" rather than omitting
    // the clause/placeholder entirely.
    const playerCountrySearchWhere = (searchIdx, playerIdx, countryIdx) => `
      AND ($${searchIdx}::text  IS NULL OR e.canonical_name ILIKE $${searchIdx})
      AND ($${playerIdx}::text  IS NULL OR e.canonical_name = $${playerIdx})
      AND ($${countryIdx}::text IS NULL OR co.name = $${countryIdx})
    `

    // ── Main SQL ───────────────────────────────────────────────────────────
    // $1=seasonId $2=gender $3=ageRefDate $4=competitionId $5=viewedYear
    // $6=search(%term%, nullable) $7=player(nullable) $8=country(nullable)
    // $9=cutoffDate (Gained Pts. only — see prior_points CTE)
    //
    // Titles/Finals and Best Perf. are scoped to editions whose YEAR is <=
    // the one being viewed (2026-08-10, corrected same day: "count should
    // be at the time of the event and including the event itself" — Nadal
    // viewed from Miami Open 2005, his first final there, must show 0/1,
    // not his full 0/5 career tally counting finals from 2006-2024 that
    // hadn't happened yet as of that page). This is a rolling per-viewed-
    // year cutoff, NOT "exclude the current edition" (that was the
    // previous, wrong behavior) and NOT "no cutoff at all" (also wrong —
    // that's what produced the Nadal bug by counting future editions too).
    const params = [
      seasonId, genderFilter, ageRefDate, competitionId, seasonYear,
      searchTerm ? `%${searchTerm}%` : null,
      playerFilter,
      countryFilter,
      cutoffDate,
    ]

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

      -- 3. Best ranking (+ its paired points) for each player within this
      --    season's matches. home = winner (w_rank/w_rank_pts), away =
      --    loser (l_rank/l_rank_pts). Points are taken from the SAME match
      --    row as the best rank (DISTINCT ON), not an independent MIN, so
      --    the two numbers never come from two different weeks.
      season_ranks AS (
        SELECT DISTINCT ON (entity_id)
               entity_id, rank_val::int AS event_rank, pts_val::int AS event_points
        FROM (
          SELECT g.home_entity_id AS entity_id,
                 (g.stats->>'w_rank')::int AS rank_val,
                 (g.stats->>'w_rank_pts')::int AS pts_val
          FROM games g
          JOIN season_tabs st ON g.result_tab_id = st.tab_id
          WHERE (g.stats->>'w_rank') ~ '^[0-9]+$'

          UNION ALL

          SELECT g.away_entity_id,
                 (g.stats->>'l_rank')::int,
                 (g.stats->>'l_rank_pts')::int
          FROM games g
          JOIN season_tabs st ON g.result_tab_id = st.tab_id
          WHERE (g.stats->>'l_rank') ~ '^[0-9]+$'
        ) ranked
        ORDER BY entity_id, rank_val ASC
      ),

      -- 3b. "Gained Pts." — the OBSERVED points swing since this player's
      --     most recent prior tournament entry, career-wide (any
      --     competition), not the official ATP "points earned this event
      --     minus points defended from last year's same event" formula —
      --     we don't have the points-by-round-per-era reference table that
      --     needs, and our rank/points data is a snapshot per tournament
      --     entered (not a continuous weekly series — confirmed via DB
      --     check, real gaps exist between a player's tournament weeks).
      --     Gained Pts. = this event's points minus points at whichever
      --     match (any competition, any round) is their closest prior
      --     snapshot before this event started ($9). NULL when there's no
      --     earlier snapshot at all (their first-ever recorded entry).
      prior_points AS (
        SELECT DISTINCT ON (entity_id) entity_id, pts_val::int AS prior_points
        FROM (
          SELECT g.home_entity_id AS entity_id, g.match_date, (g.stats->>'w_rank_pts')::int AS pts_val
          FROM games g
          JOIN season_players sp2 ON sp2.entity_id = g.home_entity_id
          WHERE g.match_date IS NOT NULL AND g.match_date < $9 AND (g.stats->>'w_rank_pts') ~ '^[0-9]+$'
          UNION ALL
          SELECT g.away_entity_id, g.match_date, (g.stats->>'l_rank_pts')::int
          FROM games g
          JOIN season_players sp2 ON sp2.entity_id = g.away_entity_id
          WHERE g.match_date IS NOT NULL AND g.match_date < $9 AND (g.stats->>'l_rank_pts') ~ '^[0-9]+$'
        ) x
        ORDER BY entity_id, match_date DESC
      ),

      -- 4. Titles/Finals at THIS specific competition — every edition up
      --    to and including the one being viewed (see params comment for
      --    why this is a <= viewedYear bound, not "every edition ever").
      competition_finals AS (
        SELECT g.home_entity_id AS winner_id, g.away_entity_id AS loser_id,
               g.id::text AS final_key
        FROM games g
        JOIN result_tabs rt ON g.result_tab_id = rt.id
        JOIN seasons s      ON rt.season_id    = s.id
        WHERE g.round = 'Final'
          AND g.winner_entity_id IS NOT NULL
          AND s.competition_id = $4
          AND s.gender = $2
          AND s.year <= $5
      ),
      competition_player_finals AS (
        SELECT winner_id AS entity_id, final_key, TRUE  AS is_winner FROM competition_finals
        UNION ALL
        SELECT loser_id,               final_key, FALSE AS is_winner FROM competition_finals
      ),
      competition_stats AS (
        SELECT entity_id,
          COUNT(DISTINCT final_key)::int                                    AS comp_finals,
          COUNT(DISTINCT CASE WHEN is_winner THEN final_key END)::int       AS comp_titles
        FROM competition_player_finals
        GROUP BY entity_id
      ),

      -- 5. Career seasons — distinct years this player has appeared in ANY
      --    match, career-wide (every competition), UP TO AND INCLUDING the
      --    year being viewed — RANKKS' core "as of this point in time"
      --    rule (2026-08-10). debut_year is the earliest of those;
      --    season_count their total as of the viewed year.
      career_seasons AS (
        SELECT entity_id, MIN(yr)::int AS debut_year, COUNT(DISTINCT yr)::int AS season_count
        FROM (
          SELECT g.home_entity_id AS entity_id, EXTRACT(YEAR FROM g.match_date) AS yr
          FROM games g
          JOIN season_players sp2 ON sp2.entity_id = g.home_entity_id
          WHERE g.match_date IS NOT NULL AND EXTRACT(YEAR FROM g.match_date) <= $5
          UNION ALL
          SELECT g.away_entity_id, EXTRACT(YEAR FROM g.match_date)
          FROM games g
          JOIN season_players sp2 ON sp2.entity_id = g.away_entity_id
          WHERE g.match_date IS NOT NULL AND EXTRACT(YEAR FROM g.match_date) <= $5
        ) yrs
        GROUP BY entity_id
      ),

      -- 6. Participation — distinct years this player has played THIS
      --    specific competition, across every one of its editions UP TO
      --    AND INCLUDING the year being viewed (same as-of-viewed-year
      --    rule as everything else here).
      participation AS (
        SELECT entity_id, COUNT(DISTINCT yr)::int AS participation_count
        FROM (
          SELECT g.home_entity_id AS entity_id, s.year AS yr
          FROM games g
          JOIN result_tabs rt ON g.result_tab_id = rt.id
          JOIN seasons s      ON rt.season_id    = s.id
          JOIN season_players sp2 ON sp2.entity_id = g.home_entity_id
          WHERE s.competition_id = $4 AND s.year <= $5
          UNION ALL
          SELECT g.away_entity_id, s.year
          FROM games g
          JOIN result_tabs rt ON g.result_tab_id = rt.id
          JOIN seasons s      ON rt.season_id    = s.id
          JOIN season_players sp2 ON sp2.entity_id = g.away_entity_id
          WHERE s.competition_id = $4 AND s.year <= $5
        ) yrs
        GROUP BY entity_id
      ),

      -- 7. Furthest round reached this edition — the round of the LAST
      --    match they played (smallest round-order = latest stage they
      --    appeared in). Rendered 'W' when that match is the Final and
      --    they're its winner, else the round name they were eliminated
      --    in — same round-order precedence as the draw page's ROUND_ORDER.
      furthest_round AS (
        SELECT DISTINCT ON (entity_id)
          entity_id, round, winner_entity_id, round_ord
        FROM (
          SELECT g.home_entity_id AS entity_id, g.round, g.winner_entity_id,
            CASE g.round
              WHEN 'Final' THEN 1 WHEN 'Semi-Final' THEN 2 WHEN 'Quarter-Final' THEN 3
              WHEN 'Round of 16' THEN 4 WHEN 'Round of 32' THEN 5 WHEN 'Round of 64' THEN 6
              WHEN 'Round of 128' THEN 7 WHEN 'Round Robin' THEN 8 WHEN 'Bronze Match' THEN 9
              ELSE 99
            END AS round_ord
          FROM games g JOIN season_tabs st ON g.result_tab_id = st.tab_id
          WHERE g.home_entity_id IS NOT NULL
          UNION ALL
          SELECT g.away_entity_id, g.round, g.winner_entity_id,
            CASE g.round
              WHEN 'Final' THEN 1 WHEN 'Semi-Final' THEN 2 WHEN 'Quarter-Final' THEN 3
              WHEN 'Round of 16' THEN 4 WHEN 'Round of 32' THEN 5 WHEN 'Round of 64' THEN 6
              WHEN 'Round of 128' THEN 7 WHEN 'Round Robin' THEN 8 WHEN 'Bronze Match' THEN 9
              ELSE 99
            END
          FROM games g JOIN season_tabs st ON g.result_tab_id = st.tab_id
          WHERE g.away_entity_id IS NOT NULL
        ) x(entity_id, round, winner_entity_id, round_ord)
        ORDER BY entity_id, round_ord ASC
      ),

      -- 8. Best-ever performance at THIS competition — furthest round
      --    reached in any edition UP TO AND INCLUDING the one being
      --    viewed (same as-of-viewed-year rule as everything else here),
      --    plus how many editions reached that exact round.
      history_rounds AS (
        SELECT DISTINCT ON (entity_id, season_id)
          entity_id, season_id, round, round_ord
        FROM (
          SELECT g.home_entity_id AS entity_id, rt.season_id, g.round,
            CASE g.round
              WHEN 'Final' THEN 1 WHEN 'Semi-Final' THEN 2 WHEN 'Quarter-Final' THEN 3
              WHEN 'Round of 16' THEN 4 WHEN 'Round of 32' THEN 5 WHEN 'Round of 64' THEN 6
              WHEN 'Round of 128' THEN 7 WHEN 'Round Robin' THEN 8 WHEN 'Bronze Match' THEN 9
              ELSE 99
            END AS round_ord
          FROM games g
          JOIN result_tabs rt ON g.result_tab_id = rt.id
          JOIN seasons s2     ON rt.season_id    = s2.id
          WHERE s2.competition_id = $4 AND s2.year <= $5
            AND g.home_entity_id IS NOT NULL
          UNION ALL
          SELECT g.away_entity_id, rt.season_id, g.round,
            CASE g.round
              WHEN 'Final' THEN 1 WHEN 'Semi-Final' THEN 2 WHEN 'Quarter-Final' THEN 3
              WHEN 'Round of 16' THEN 4 WHEN 'Round of 32' THEN 5 WHEN 'Round of 64' THEN 6
              WHEN 'Round of 128' THEN 7 WHEN 'Round Robin' THEN 8 WHEN 'Bronze Match' THEN 9
              ELSE 99
            END
          FROM games g
          JOIN result_tabs rt ON g.result_tab_id = rt.id
          JOIN seasons s2     ON rt.season_id    = s2.id
          WHERE s2.competition_id = $4 AND s2.year <= $5
            AND g.away_entity_id IS NOT NULL
        ) x(entity_id, season_id, round, round_ord)
        ORDER BY entity_id, season_id, round_ord ASC
      ),
      best_ord AS (
        SELECT entity_id, MIN(round_ord) AS best_round_ord
        FROM history_rounds
        GROUP BY entity_id
      ),
      best_perf AS (
        SELECT hr.entity_id, MIN(hr.round) AS best_round, COUNT(*)::int AS best_count
        FROM history_rounds hr
        JOIN best_ord bo ON bo.entity_id = hr.entity_id AND hr.round_ord = bo.best_round_ord
        GROUP BY hr.entity_id
      )

      -- 9. Final SELECT
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
        DATE_PART('year', AGE(LEAST($3::date, COALESCE(e.death_date, $3::date)), e.birth_date::date))::int AS age_at_event,
        sr.event_rank,
        sr.event_points,
        cse.debut_year,
        COALESCE(cse.season_count, 0)        AS season_count,
        COALESCE(pt.participation_count, 0)  AS participation_count,
        COALESCE(cst.comp_titles, 0)         AS comp_titles,
        COALESCE(cst.comp_finals, 0)         AS comp_finals,
        CASE WHEN fr.round = 'Final' AND fr.winner_entity_id = e.id THEN 'W' ELSE fr.round END AS round_reached,
        bp.best_round,
        COALESCE(bp.best_count, 0) AS best_count,
        pp.prior_points
      FROM season_players sp
      JOIN entities e              ON e.id = sp.entity_id
      LEFT JOIN season_ranks sr    ON sr.entity_id = e.id
      LEFT JOIN countries co       ON co.id = e.country_id
      LEFT JOIN career_seasons cse ON cse.entity_id = e.id
      LEFT JOIN participation pt   ON pt.entity_id = e.id
      LEFT JOIN competition_stats cst ON cst.entity_id = e.id
      LEFT JOIN furthest_round fr  ON fr.entity_id = e.id
      LEFT JOIN best_perf bp       ON bp.entity_id = e.id
      LEFT JOIN prior_points pp    ON pp.entity_id = e.id
      WHERE e.entity_type = 'player'
        ${playerCountrySearchWhere(6, 7, 8)}
      ORDER BY ${orderByClause}
      LIMIT  ${parseInt(limit)}
      OFFSET ${offset}
    `

    // countSql gets its OWN minimal, tightly-numbered param set — gender/
    // ageRefDate/competitionId/viewedYear aren't referenced anywhere in
    // this query's text, and Postgres errors ("could not determine data
    // type of parameter") on any placeholder number that never actually
    // appears in the query, even if an array element is supplied for it.
    // Padding doesn't work here; every $n must be textually present. params
    // here is [seasonId, gender, ageRefDate, competitionId, viewedYear,
    // search, player, country] — search/player/country are indices 5/6/7.
    const countParams = [seasonId, params[5], params[6], params[7]]
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
      )
      SELECT COUNT(*) AS total
      FROM season_players sp
      JOIN entities e     ON e.id = sp.entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      WHERE e.entity_type = 'player'
        AND ($2::text IS NULL OR e.canonical_name ILIKE $2)
        AND ($3::text IS NULL OR e.canonical_name = $3)
        AND ($4::text IS NULL OR co.name = $4)
    `

    // ── Filter options (unpaginated) — every player name + country/count
    // for this season, independent of the current page/search/filters, so
    // the "All Players"/"All Countries" dropdowns always list the full set.
    const optionsSql = `
      WITH
      season_tabs AS (SELECT id AS tab_id FROM result_tabs WHERE season_id = $1),
      season_players AS (
        SELECT DISTINCT g.home_entity_id AS entity_id
        FROM games g JOIN season_tabs st ON g.result_tab_id = st.tab_id
        WHERE g.home_entity_id IS NOT NULL
        UNION
        SELECT DISTINCT g.away_entity_id
        FROM games g JOIN season_tabs st ON g.result_tab_id = st.tab_id
        WHERE g.away_entity_id IS NOT NULL
      )
      SELECT e.canonical_name, co.name AS country_name
      FROM season_players sp
      JOIN entities e ON e.id = sp.entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      WHERE e.entity_type = 'player'
    `

    const [rows, countRow, optionRows] = await Promise.all([
      queryAll(sql, params),
      queryOne(countSql, countParams),
      queryAll(optionsSql, [seasonId]),
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
      event_points:  p.event_points != null ? parseInt(p.event_points) : null,
      // Gained Pts. — see prior_points CTE comment: the observed swing
      // since this player's closest prior tournament entry, not the
      // official ATP defending-points formula. Null when either snapshot
      // is missing (no ranked result this event, or no earlier one to
      // compare against — their first-ever recorded entry).
      gained_pts: (p.event_points != null && p.prior_points != null)
        ? parseInt(p.event_points) - parseInt(p.prior_points)
        : null,
      season_count:  parseInt(p.season_count) || 0,
      // "Seasons" range shown as debut_year-seasonYear (career-wide span
      // through the year currently being viewed) — null when we have no
      // dated match at all for this player (debut_year null).
      seasons_range: p.debut_year != null ? `${p.debut_year}-${seasonYear}` : null,
      participation_count: parseInt(p.participation_count) || 0,
      comp_titles:   parseInt(p.comp_titles) || 0,
      comp_finals:   parseInt(p.comp_finals) || 0,
      round_reached: p.round_reached ?? null,
      // Best-ever performance: MIN(round_ord) only tracks the ROUND
      // reached, so a career-best Final loss and a career-best Final WIN
      // both came back as plain 'Final' — same Champion/runner-up mixup
      // fixed for football's Best Perf. (2026-08-13). If they ever won a
      // Final at this competition, that's the Champion tier: show 'W' with
      // the title count, not the raw Finals-reached count.
      best_round: p.best_round === 'Final' && (parseInt(p.comp_titles) || 0) > 0 ? 'W' : (p.best_round ?? null),
      best_count: p.best_round === 'Final' && (parseInt(p.comp_titles) || 0) > 0
        ? (parseInt(p.comp_titles) || 0)
        : (parseInt(p.best_count) || 0),
    }))

    const playerOptions = [...new Set(optionRows.map(r => r.canonical_name).filter(Boolean))].sort()
    const countryCounts = new Map()
    optionRows.forEach(r => {
      if (r.country_name) countryCounts.set(r.country_name, (countryCounts.get(r.country_name) || 0) + 1)
    })
    const countryOptions = [...countryCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))

    res.json({
      players,
      total:  parseInt(countRow?.total) || 0,
      page:   parseInt(page),
      limit:  parseInt(limit),
      cutoff: cutoffDate,
      player_options:  playerOptions,
      country_options: countryOptions,
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

    // Tennis: player_season_stats has no rows for this sport, so the
    // generic query below always returns 0 players — draw size (active
    // gender's singles draw only, since a tennis season row is already
    // per-gender) is computed directly from games instead. Backs
    // EventBlock.jsx's bottom-bar "Players" stat.
    if (seasonSport?.sport_slug === 'tennis') {
      const tennisRow = await queryOne(`
        SELECT COUNT(DISTINCT entity_id) AS players
        FROM (
          SELECT g.home_entity_id AS entity_id
          FROM games g JOIN result_tabs rt ON rt.id = g.result_tab_id
          WHERE rt.season_id = $1 AND rt.tab_key LIKE 'draw-singles-%'
          UNION
          SELECT g.away_entity_id
          FROM games g JOIN result_tabs rt ON rt.id = g.result_tab_id
          WHERE rt.season_id = $1 AND rt.tab_key LIKE 'draw-singles-%'
        ) x
      `, [seasonId]);
      return res.json({ data: {
        teams: 0, players: parseInt(tennisRow?.players || 0), goals: 0, matches: 0,
        goals_per_match: null, assists_per_match: null, scorers: 0, assists: 0, passers: 0,
      }})
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
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e.id AND $3::int BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e.image_url) AS logo_url,
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
// GET /results/teams-all-time/:seasonId
// Football All-Time > Team Stats — cumulative "through <year>" totals for
// every club that has ever appeared in this competition's standings, not
// just this season's roster (unlike /clubs/:seasonId above, which is
// UCL-specific and scopes to the current season's participants). Built
// off the standings table directly (works for any standings-based league:
// Ligue 1/Premier League/Bundesliga/La Liga/Serie A, plus UCL's own
// league-phase 'standings' tab) rather than the games table UCL's Clubs
// route uses — competitions with no plain 'standings' tab (World Cup,
// pre-2024 UCL group stage) simply return no rows here, same "sparse for
// non-standings competitions" tradeoff as every other all-time cumulative
// route in this file.
//
// Cup/League Cup/Champions Trophy have no ingested data yet (no French
// Cup/Coupe de la Ligue/Trophée des Champions competition rows exist) —
// omitted from the response entirely; the frontend renders its own
// placeholder dash for those columns.
router.get('/teams-all-time/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    const teams = await queryAll(`
      WITH base AS (
        SELECT st.entity_id, s.id AS season_id, st.position,
          (st.stats->>'played')::int         AS played,
          (st.stats->>'won')::int            AS won,
          (st.stats->>'drawn')::int          AS drawn,
          (st.stats->>'lost')::int           AS lost,
          (st.stats->>'goals_for')::int      AS goals_for,
          (st.stats->>'goals_against')::int  AS goals_against
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id AND rt.tab_key = 'standings'
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
      ),
      totals AS (
        SELECT entity_id,
          COUNT(DISTINCT season_id)               AS seasons,
          COUNT(*) FILTER (WHERE position = 1)    AS titles,
          COALESCE(SUM(played), 0)                AS played,
          COALESCE(SUM(won), 0)                   AS won,
          COALESCE(SUM(drawn), 0)                 AS drawn,
          COALESCE(SUM(lost), 0)                  AS lost,
          COALESCE(SUM(goals_for), 0)             AS goals_for,
          COALESCE(SUM(goals_against), 0)         AS goals_against
        FROM base
        GROUP BY entity_id
      ),
      season_max_goals AS (
        SELECT pss.season_id, MAX(pss.goals) AS max_goals
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
        GROUP BY pss.season_id
      ),
      scorer_titles AS (
        SELECT pss2.club_entity_id AS entity_id, COUNT(DISTINCT smg.season_id) AS titles
        FROM season_max_goals smg
        JOIN player_season_stats pss2 ON pss2.season_id = smg.season_id AND pss2.goals = smg.max_goals
        WHERE smg.max_goals > 0
        GROUP BY pss2.club_entity_id
      ),
      season_max_assists AS (
        SELECT pss.season_id, MAX(pss.assists) AS max_assists
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
        GROUP BY pss.season_id
      ),
      assist_titles AS (
        SELECT pss2.club_entity_id AS entity_id, COUNT(DISTINCT sma.season_id) AS titles
        FROM season_max_assists sma
        JOIN player_season_stats pss2 ON pss2.season_id = sma.season_id AND pss2.assists = sma.max_assists
        WHERE sma.max_assists > 0
        GROUP BY pss2.club_entity_id
      )
      SELECT
        t.entity_id, e.canonical_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e.id AND $2::int BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e.image_url) AS logo_url,
        t.seasons, t.titles, t.played, t.won, t.drawn, t.lost, t.goals_for, t.goals_against,
        COALESCE(sct.titles, 0) AS top_scorer_titles,
        COALESCE(ast.titles, 0) AS top_assist_titles
      FROM totals t
      JOIN entities e ON e.id = t.entity_id
      LEFT JOIN scorer_titles sct ON sct.entity_id = t.entity_id
      LEFT JOIN assist_titles ast ON ast.entity_id = t.entity_id
      ORDER BY t.titles DESC, t.seasons DESC, e.canonical_name ASC
    `, [competition_id, year])

    res.json({
      data: {
        year,
        teams: teams.map(t => ({
          entity_id:          t.entity_id,
          canonical_name:     t.canonical_name,
          logo_url:           t.logo_url,
          seasons:             parseInt(t.seasons)             || 0,
          titles:              parseInt(t.titles)              || 0,
          played:              parseInt(t.played)              || 0,
          won:                 parseInt(t.won)                 || 0,
          drawn:               parseInt(t.drawn)                || 0,
          lost:                parseInt(t.lost)                 || 0,
          goals_for:           parseInt(t.goals_for)            || 0,
          goals_against:       parseInt(t.goals_against)        || 0,
          top_scorer_titles:   parseInt(t.top_scorer_titles)    || 0,
          top_assist_titles:   parseInt(t.top_assist_titles)    || 0,
        })),
      }
    })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /results/players-all-time-football/:seasonId
// Football's "All-Time > Player Stats" page — cumulative "through <year>"
// career totals for every player who has ever appeared in this
// competition's 'players' rows (full squad, not just Scorers/Passers who
// filter out 0s — see /players/:seasonId's own comment on why 'players'
// rows exist unscoped by result_tab).
//
// No per-player match log exists in this schema (unlike NBA's per-game
// box scores), so:
//   - Apps      = SUM(games_played) across every season+club row.
//   - Won/Drawn/Lost = the player's CLUB's own standings record for every
//     season they appeared in that club's squad (same "closest proxy to a
//     personal record" approach as NBA's players-all-time route uses for
//     its own Win/Loss column, just sourced from standings instead of a
//     games table).
//   - Champion  = count of seasons where the player's club that season was
//     the standings champion (position = 1) — identical definition to
//     /seasons/player-leaders' champion_titles, just computed for every
//     player at once instead of one at a time.
//   - Top Scorer/Assist Leader titles reuse the same season-wide max(goals)/
//     max(assists) pattern as /teams-all-time and /seasons/player-leaders.
//
// Cup/League Cup/Champions Trophy have no ingested data yet — the frontend
// shows a permanent "—/—" placeholder for those, same convention as the
// Team Stats page and EventBlock's stat blocs.
router.get('/players-all-time-football/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    const players = await queryAll(`
      WITH base AS (
        SELECT pss.entity_id AS player_id, pss.season_id, s.year AS season_year, pss.club_entity_id,
          COALESCE(pss.games_played, 0) AS games_played,
          COALESCE(pss.goals, 0)        AS goals,
          COALESCE(pss.assists, 0)      AS assists,
          COALESCE(pss.yellow_cards, 0) AS yellow_cards,
          COALESCE(pss.red_cards, 0)    AS red_cards
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
      ),
      club_standing AS (
        SELECT st.entity_id AS club_entity_id, s.id AS season_id, st.position,
          (st.stats->>'won')::int   AS won,
          (st.stats->>'drawn')::int AS drawn,
          (st.stats->>'lost')::int  AS lost
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id AND rt.tab_key = 'standings'
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
      ),
      totals AS (
        SELECT b.player_id,
          COUNT(DISTINCT b.season_id)                          AS seasons,
          COUNT(DISTINCT b.season_id) FILTER (WHERE cs.position = 1) AS titles,
          COALESCE(SUM(b.games_played), 0)                     AS apps,
          COALESCE(SUM(cs.won), 0)                             AS won,
          COALESCE(SUM(cs.drawn), 0)                           AS drawn,
          COALESCE(SUM(cs.lost), 0)                            AS lost,
          COALESCE(SUM(b.goals), 0)                            AS goals,
          COALESCE(SUM(b.assists), 0)                          AS assists,
          COALESCE(SUM(b.yellow_cards), 0)                     AS yellow_cards,
          COALESCE(SUM(b.red_cards), 0)                        AS red_cards
        FROM base b
        LEFT JOIN club_standing cs ON cs.club_entity_id = b.club_entity_id AND cs.season_id = b.season_id
        GROUP BY b.player_id
      ),
      season_max_goals AS (
        SELECT pss.season_id, MAX(pss.goals) AS max_goals
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
        GROUP BY pss.season_id
      ),
      scorer_titles AS (
        SELECT pss2.entity_id AS player_id, COUNT(DISTINCT smg.season_id) AS titles
        FROM season_max_goals smg
        JOIN player_season_stats pss2 ON pss2.season_id = smg.season_id AND pss2.goals = smg.max_goals
        WHERE smg.max_goals > 0
        GROUP BY pss2.entity_id
      ),
      season_max_assists AS (
        SELECT pss.season_id, MAX(pss.assists) AS max_assists
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
        GROUP BY pss.season_id
      ),
      assist_titles AS (
        SELECT pss2.entity_id AS player_id, COUNT(DISTINCT sma.season_id) AS titles
        FROM season_max_assists sma
        JOIN player_season_stats pss2 ON pss2.season_id = sma.season_id AND pss2.assists = sma.max_assists
        WHERE sma.max_assists > 0
        GROUP BY pss2.entity_id
      ),
      -- Most recent club through the selected year — powers the "All teams"
      -- filter only (the table itself shows country per the spec, not
      -- club). Same "last known row, not exact-year match" rule as NBA's
      -- own current_row — a retired player has no row in the exact
      -- selected year at all.
      current_row AS (
        SELECT DISTINCT ON (b.player_id) b.player_id, b.club_entity_id, b.season_year
        FROM base b
        ORDER BY b.player_id, b.season_year DESC
      ),
      -- Active tag: has a row in the exact selected year specifically —
      -- same rule as NBA's is_active.
      last_season AS (
        SELECT DISTINCT ON (b.player_id) b.player_id, b.season_year AS last_year
        FROM base b
        ORDER BY b.player_id, b.season_year DESC
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug, e.image_url, e.birth_date, e.death_date,
        ls.last_year = $2 AS is_active,
        ent_co.iso2 AS country_iso2, ent_co.name AS country_name,
        club_e.canonical_name AS club_name,
        pa_pos.attribute_value AS position,
        t.seasons, t.titles, t.apps, t.won, t.drawn, t.lost,
        t.goals, t.assists, t.yellow_cards, t.red_cards,
        COALESCE(sct.titles, 0) AS top_scorer_titles,
        COALESCE(ast.titles, 0) AS top_assist_titles
      FROM totals t
      JOIN entities e ON e.id = t.player_id
      LEFT JOIN current_row cr ON cr.player_id = t.player_id
      LEFT JOIN entities club_e ON club_e.id = cr.club_entity_id
      LEFT JOIN last_season ls ON ls.player_id = t.player_id
      LEFT JOIN countries ent_co ON ent_co.id = e.country_id
      LEFT JOIN player_attributes pa_pos ON pa_pos.entity_id = e.id AND pa_pos.attribute_key = 'position'
      LEFT JOIN scorer_titles sct ON sct.player_id = t.player_id
      LEFT JOIN assist_titles ast ON ast.player_id = t.player_id
      ORDER BY t.titles DESC, t.seasons DESC, e.canonical_name ASC
    `, [competition_id, year])

    res.json({
      data: {
        year,
        players: players.map(p => ({
          entity_id:          p.entity_id,
          canonical_name:     p.canonical_name,
          slug:               p.slug,
          image_url:          p.image_url,
          birth_date:         p.birth_date,
          death_date:         p.death_date,
          is_active:          p.is_active,
          country_iso2:       p.country_iso2,
          country_name:       p.country_name,
          club_name:          p.club_name,
          position:           p.position,
          seasons:             parseInt(p.seasons)             || 0,
          titles:              parseInt(p.titles)              || 0,
          apps:                parseInt(p.apps)                || 0,
          won:                 parseInt(p.won)                 || 0,
          drawn:               parseInt(p.drawn)               || 0,
          lost:                parseInt(p.lost)                || 0,
          goals:               parseInt(p.goals)               || 0,
          assists:             parseInt(p.assists)              || 0,
          yellow_cards:        parseInt(p.yellow_cards)         || 0,
          red_cards:           parseInt(p.red_cards)            || 0,
          top_scorer_titles:   parseInt(p.top_scorer_titles)    || 0,
          top_assist_titles:   parseInt(p.top_assist_titles)    || 0,
        })),
      }
    })
  } catch (err) { next(err) }
})

// GET /results/players-all-time-football-knockout/:seasonId
// Player Stats for a KNOCKOUT-final competition (World Cup, and any future
// quadrennial/biennial one with the same shape) — sibling to
// /players-all-time-football (standings-based, for domestic leagues) which
// doesn't apply here for the same reason teams-all-time-football-knockout
// exists: no 'standings' tab, no league table to read a Champion flag or
// W/D/L off of.
//
// No per-game player log exists in this schema (confirmed 2026-08-13 —
// player_season_stats.result_tab_id is NULL for every World Cup row, so
// there is no way to split a player's OWN apps into Group Stages vs
// Knockout; only a single season-wide total exists per player). That's why
// this page has no Group Stages/Knockout pill, unlike Team Stats.
//
//   - Played/Goals/Assists = SUM(player_season_stats) across every season
//     the player has a row for, career total (season-wide, not split).
//   - Titles/Finals = whether the player's TEAM that season (club_entity_id,
//     which is the national-team entity for this competition) won or
//     reached that year's Final — same "final"/"3rd-place" tab_key games
//     teams-all-time-football-knockout reads, just joined onto the player's
//     own season+team instead of aggregated per team.
//   - Won/Drawn/Lost (sort-only, no dedicated column — same convention as
//     the "Won"/"Drawn"/"Lost" Sort-by options that exist without their own
//     column) = the player's TEAM's own game-by-game record (group_stages +
//     knockout combined, same as Team Stats' default aggregate) for every
//     edition the player appeared in — the same "closest proxy to a
//     personal record" reasoning /players-all-time-football already uses
//     for its own Won/Drawn/Lost (there, sourced from standings; here, from
//     games, since standings doesn't reliably exist for this competition
//     type).
router.get('/players-all-time-football-knockout/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    // NOTE (2026-08-13): the obvious version of this query — five small
    // per-player aggregate CTEs (participations/totals/player_trophy/
    // player_record/current_row) LEFT JOINed together at the end, mirroring
    // teams-all-time-football-knockout's own shape — times out. EXPLAIN
    // showed Postgres picking Nested-Loop-with-Join-Filter (not Hash Join)
    // to chain those aggregates together, because it couldn't estimate
    // their output cardinality; five ~200-row nested loops compound into
    // billions of comparisons. Fix: do ONE join pass over `base` (LEFT JOIN
    // finals + team_year_record directly onto every player-season row) and
    // GROUP BY once at the end (`enriched`/`agg` below) — no multi-way join
    // of small aggregated CTEs at all. Confirmed: 12k `base` rows, ~800ms.
    const players = await queryAll(`
      WITH base AS (
        SELECT pss.entity_id AS player_id, pss.season_id, s.year AS season_year, pss.club_entity_id,
          COALESCE(pss.games_played, 0) AS games_played,
          COALESCE(pss.goals, 0)        AS goals,
          COALESCE(pss.assists, 0)      AS assists
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
      ),
      finals AS (
        SELECT g.winner_entity_id AS winner,
          CASE WHEN g.winner_entity_id = g.home_entity_id THEN g.away_entity_id ELSE g.home_entity_id END AS loser,
          s.year
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id AND rt.tab_key = 'final'
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
      ),
      -- Team's own per-edition W/D/L (group_stages + knockout combined,
      -- same scope Team Stats' default view aggregates) — reused here as
      -- the player's personal-record proxy.
      team_games AS (
        SELECT s.year, g.home_entity_id, g.away_entity_id, g.home_won
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND rt.tab_group IN ('group_stages', 'final_tour')
      ),
      team_perspective AS (
        SELECT year, home_entity_id AS entity_id,
          CASE WHEN home_won = true THEN 'W' WHEN home_won = false THEN 'L' ELSE 'D' END AS result
        FROM team_games
        UNION ALL
        SELECT year, away_entity_id AS entity_id,
          CASE WHEN home_won = false THEN 'W' WHEN home_won = true THEN 'L' ELSE 'D' END AS result
        FROM team_games
      ),
      team_year_record AS (
        SELECT entity_id, year,
          COUNT(*) FILTER (WHERE result = 'W') AS won,
          COUNT(*) FILTER (WHERE result = 'D') AS drawn,
          COUNT(*) FILTER (WHERE result = 'L') AS lost
        FROM team_perspective
        GROUP BY entity_id, year
      ),
      -- One row per player-season, enriched with that edition's Final
      -- outcome and the player's team's game record — no aggregation yet.
      enriched AS (
        SELECT b.player_id, b.season_id, b.season_year, b.club_entity_id,
          b.games_played, b.goals, b.assists,
          (f.winner = b.club_entity_id)                               AS won_final,
          (f.winner = b.club_entity_id OR f.loser = b.club_entity_id) AS reached_final,
          COALESCE(tyr.won, 0) AS t_won, COALESCE(tyr.drawn, 0) AS t_drawn, COALESCE(tyr.lost, 0) AS t_lost
        FROM base b
        LEFT JOIN finals f ON f.year = b.season_year
        LEFT JOIN team_year_record tyr ON tyr.entity_id = b.club_entity_id AND tyr.year = b.season_year
      ),
      agg AS (
        SELECT player_id,
          COUNT(DISTINCT season_id) AS participations,
          MIN(season_year) AS first_year, MAX(season_year) AS last_year,
          COALESCE(SUM(games_played), 0) AS played,
          COALESCE(SUM(goals), 0)        AS goals,
          COALESCE(SUM(assists), 0)      AS assists,
          COUNT(*) FILTER (WHERE won_final)     AS titles,
          COUNT(*) FILTER (WHERE reached_final) AS finals_n,
          COALESCE(SUM(t_won), 0)   AS won,
          COALESCE(SUM(t_drawn), 0) AS drawn,
          COALESCE(SUM(t_lost), 0)  AS lost
        FROM enriched
        GROUP BY player_id
      ),
      -- Most recent team through the selected year — powers the "All
      -- Teams" filter only (same "last known row" convention
      -- /players-all-time-football's own current_row CTE uses for club).
      current_row AS (
        SELECT DISTINCT ON (b.player_id) b.player_id, b.club_entity_id
        FROM base b
        ORDER BY b.player_id, b.season_year DESC
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug, e.image_url, e.birth_date, e.death_date,
        ent_co.iso2 AS country_iso2, ent_co.name AS country_name, ent_co.confederation,
        team_e.canonical_name AS team_name,
        pa_pos.attribute_value AS position,
        a.participations, a.first_year, a.last_year,
        a.titles, a.finals_n, a.played, a.goals, a.assists, a.won, a.drawn, a.lost
      FROM agg a
      JOIN entities e ON e.id = a.player_id
      LEFT JOIN countries ent_co ON ent_co.id = e.country_id
      LEFT JOIN current_row cr ON cr.player_id = a.player_id
      LEFT JOIN entities team_e ON team_e.id = cr.club_entity_id
      LEFT JOIN player_attributes pa_pos ON pa_pos.entity_id = e.id AND pa_pos.attribute_key = 'position'
      -- Default sort cascade: Participations, then Titles, then Finals,
      -- then Played (2026-08-13: "change default sorting: participation,
      -- titles, finals, played").
      ORDER BY a.participations DESC,
        a.titles DESC,
        a.finals_n DESC,
        a.played DESC,
        e.canonical_name ASC
    `, [competition_id, year])

    res.json({
      data: {
        rows: players.map(p => ({
          entity_id: p.entity_id,
          canonical_name: p.canonical_name,
          slug: p.slug,
          image_url: p.image_url,
          birth_date: p.birth_date,
          death_date: p.death_date,
          country_iso2: p.country_iso2,
          country_name: p.country_name,
          confederation: p.confederation,
          team_name: p.team_name,
          position: p.position,
          participations: parseInt(p.participations) || 0,
          first_year: p.first_year,
          last_year: p.last_year,
          titles: parseInt(p.titles) || 0,
          finals: parseInt(p.finals_n) || 0,
          played: parseInt(p.played) || 0,
          goals: parseInt(p.goals) || 0,
          assists: parseInt(p.assists) || 0,
          won: parseInt(p.won) || 0,
          drawn: parseInt(p.drawn) || 0,
          lost: parseInt(p.lost) || 0,
        })),
        count: players.length,
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
// All-NBA 1st-2nd-3rd/All-Defense 1st-2nd/All-Rookie 1st-2nd) — "through
// <year>". Same club
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
                              'all-defense-1st', 'all-defense-2nd',
                              'all-rookie-1st', 'all-rookie-2nd', 'nba-cup-teams')
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
          COUNT(*) FILTER (WHERE tab_key = 'all-defense-2nd')          AS all_def_2,
          COUNT(*) FILTER (WHERE tab_key = 'all-rookie-1st')           AS all_rookie_1,
          COUNT(*) FILTER (WHERE tab_key = 'all-rookie-2nd')           AS all_rookie_2,
          COUNT(*) FILTER (WHERE tab_key = 'nba-cup-teams')            AS nba_cup_team
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
        COALESCE(honours.all_def_2, 0)  AS all_def_2,
        COALESCE(honours.all_rookie_1, 0) AS all_rookie_1,
        COALESCE(honours.all_rookie_2, 0) AS all_rookie_2,
        COALESCE(honours.nba_cup_team, 0) AS nba_cup_team
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
          all_rookie_1:   parseInt(t.all_rookie_1)  || 0,
          all_rookie_2:   parseInt(t.all_rookie_2)  || 0,
          nba_cup_team:   parseInt(t.nba_cup_team)  || 0,
          // No All-Star data ingested yet — placeholder until it is.
          all_star:       null,
          all_star_mvp:   null,
        })),
        count: teams.length,
      }
    })
  } catch (err) { next(err) }
})

// GET /results/champion-history/:seasonId
//
// Year-by-year Palmares: one row per completed NBA Finals (season <= the
// selected year, same "through <year>" cutoff every other All-Time route
// uses), not a per-entity cumulative table like /teams or /team-honours
// above. Champion/Runner-Up come from the Finals series game-win count
// (same nba_champions_by_year pattern as /teams, extended to also keep the
// losing finalist's own game count). East/West Standing Leader are that
// year's Regular Season conference #1 by standings position — independent
// of who actually won the championship. MVP/Finals MVP ordinal counts are
// a running "Nth time" as of that row's year (window function over the
// full history), for both the player and the team they were on, per
// Mohamed's spec (e.g. "Lebron James (10)" / "Los Angeles Lakers (10)").
router.get('/champion-history/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params

    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    const rows = await queryAll(`
      WITH nba_champions_by_year AS (
        SELECT s.year, g.winner_entity_id AS team_id, COUNT(*) AS game_wins
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND ev.slug LIKE 'finals%'
          AND rt.tab_key = 'nba-finals' AND g.winner_entity_id IS NOT NULL
        GROUP BY s.year, g.winner_entity_id
      ),
      finals_participants AS (
        SELECT DISTINCT s.year, g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND ev.slug LIKE 'finals%' AND rt.tab_key = 'nba-finals'
        UNION
        SELECT DISTINCT s.year, g.away_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events ev ON ev.id = s.event_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND ev.slug LIKE 'finals%' AND rt.tab_key = 'nba-finals'
      ),
      champion AS (
        SELECT DISTINCT ON (year) year, team_id AS champion_id, game_wins AS champion_wins
        FROM nba_champions_by_year
        ORDER BY year, game_wins DESC
      ),
      runner_up AS (
        SELECT fp.year, fp.team_id AS runner_up_id, COALESCE(nb.game_wins, 0) AS runner_up_wins
        FROM finals_participants fp
        JOIN champion c ON c.year = fp.year AND fp.team_id != c.champion_id
        LEFT JOIN nba_champions_by_year nb ON nb.year = fp.year AND nb.team_id = fp.team_id
      ),
      champion_ordinal AS (
        SELECT year, champion_id,
          ROW_NUMBER() OVER (PARTITION BY champion_id ORDER BY year) AS title_no
        FROM champion
      ),
      -- Regular Season standings, one row per team per year, with the
      -- team's conference resolved for THAT year (era-aware — see /teams'
      -- identical season_standings CTE). w/l pulled straight from the
      -- stored stats jsonb (already computed at ingestion), not recounted
      -- from games.
      season_standings AS (
        SELECT st.entity_id AS team_id, s.year, st.position,
          (st.stats->>'w')::int AS wins, (st.stats->>'l')::int AS losses,
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
        WHERE rt.tab_key = 'standings' AND s.competition_id = $1 AND s.year <= $2
      ),
      conf_leader_rows AS (
        SELECT year, conference, team_id, wins, losses,
          ROW_NUMBER() OVER (PARTITION BY year, conference ORDER BY position ASC) AS rk
        FROM season_standings
        WHERE conference IS NOT NULL
      ),
      -- Season Standing Leader: the single best record league-wide that
      -- year (by overall position, not conference-scoped), plus whichever
      -- conference it's NOT in, so the "other side" leader always fills
      -- line 2 regardless of whether East or West had the better record
      -- that season.
      top_standing AS (
        SELECT DISTINCT ON (year) year, team_id, conference, wins, losses
        FROM season_standings
        WHERE conference IS NOT NULL
        ORDER BY year, position ASC
      ),
      other_conf_leader AS (
        SELECT clr.year, clr.team_id, clr.wins, clr.losses
        FROM conf_leader_rows clr
        JOIN top_standing ts ON ts.year = clr.year AND clr.conference != ts.conference
        WHERE clr.rk = 1
      ),
      -- MVP/Finals MVP winner-by-year, plus a running "Nth time" ordinal for
      -- both the player and whichever team they were on when they won —
      -- club never lives in the real column on award rows, only in stats
      -- jsonb (see ingest-nba-awards.js).
      mvp_by_year AS (
        -- All-Star reuses tab_key='mvp' for its own single-winner MVP tab
        -- (see ingest-nba-all-star-results.js) — scoped to the Awards event
        -- (event_id=78) so this stays the real season MVP, not fanned out
        -- into 2 rows/year (Awards + All-Star) once both exist for a year.
        SELECT s.year, pss.entity_id AS player_id,
          COALESCE(pss.club_entity_id, (pss.stats->>'club_entity_id')::int) AS team_id
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'mvp' AND s.competition_id = $1 AND s.year <= $2 AND s.event_id = 78
          AND (pss.stats->>'winner')::boolean = true
      ),
      mvp_ordinal AS (
        SELECT year, player_id, team_id,
          ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY year) AS player_no,
          ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY year) AS team_no
        FROM mvp_by_year
      ),
      finals_mvp_by_year AS (
        SELECT s.year, pss.entity_id AS player_id,
          COALESCE(pss.club_entity_id, (pss.stats->>'club_entity_id')::int) AS team_id
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'finals-mvp' AND s.competition_id = $1 AND s.year <= $2
          AND (pss.stats->>'winner')::boolean = true
      ),
      finals_mvp_ordinal AS (
        SELECT year, player_id, team_id,
          ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY year) AS player_no,
          ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY year) AS team_no
        FROM finals_mvp_by_year
      )
      SELECT
        c.year,
        ROW_NUMBER() OVER (ORDER BY c.year ASC) AS edition,

        c.champion_id, COALESCE(hn_champ.display_name, e_champ.canonical_name) AS champion_name, e_champ.slug AS champion_slug,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e_champ.id AND c.year BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e_champ.image_url) AS champion_logo,
        co.title_no AS champion_title_no, c.champion_wins,

        ru.runner_up_id, COALESCE(hn_runner.display_name, e_runner.canonical_name) AS runner_up_name, e_runner.slug AS runner_up_slug,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e_runner.id AND c.year BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e_runner.image_url) AS runner_up_logo,
        ru.runner_up_wins,

        ts.team_id AS top_standing_id, COALESCE(hn_top.display_name, e_top.canonical_name) AS top_standing_name, e_top.slug AS top_standing_slug,
        ts.wins AS top_standing_wins, ts.losses AS top_standing_losses,

        ocl.team_id AS other_standing_id, COALESCE(hn_other.display_name, e_other.canonical_name) AS other_standing_name, e_other.slug AS other_standing_slug,
        ocl.wins AS other_standing_wins, ocl.losses AS other_standing_losses,

        mo.player_id AS mvp_id, e_mvp.canonical_name AS mvp_name, e_mvp.slug AS mvp_slug, e_mvp.image_url AS mvp_image, e_mvp.death_date AS mvp_death_date,
        mo.player_no AS mvp_player_no,
        mo.team_id AS mvp_team_id, COALESCE(hn_mvp_team.display_name, e_mvp_team.canonical_name) AS mvp_team_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e_mvp_team.id AND c.year BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e_mvp_team.image_url) AS mvp_team_logo,
        mo.team_no AS mvp_team_no,

        fo.player_id AS finals_mvp_id, e_fmvp.canonical_name AS finals_mvp_name, e_fmvp.slug AS finals_mvp_slug, e_fmvp.image_url AS finals_mvp_image, e_fmvp.death_date AS finals_mvp_death_date,
        fo.player_no AS finals_mvp_player_no,
        fo.team_id AS finals_mvp_team_id, COALESCE(hn_fmvp_team.display_name, e_fmvp_team.canonical_name) AS finals_mvp_team_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e_fmvp_team.id AND c.year BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e_fmvp_team.image_url) AS finals_mvp_team_logo,
        fo.team_no AS finals_mvp_team_no

      FROM champion c
      JOIN champion_ordinal co ON co.year = c.year
      LEFT JOIN runner_up ru ON ru.year = c.year
      LEFT JOIN top_standing ts ON ts.year = c.year
      LEFT JOIN other_conf_leader ocl ON ocl.year = c.year
      LEFT JOIN mvp_ordinal mo ON mo.year = c.year
      LEFT JOIN finals_mvp_ordinal fo ON fo.year = c.year
      LEFT JOIN entities e_champ ON e_champ.id = c.champion_id
      LEFT JOIN entities e_runner ON e_runner.id = ru.runner_up_id
      LEFT JOIN entities e_top ON e_top.id = ts.team_id
      LEFT JOIN entities e_other ON e_other.id = ocl.team_id
      LEFT JOIN entities e_mvp ON e_mvp.id = mo.player_id
      LEFT JOIN entities e_mvp_team ON e_mvp_team.id = mo.team_id
      LEFT JOIN entities e_fmvp ON e_fmvp.id = fo.player_id
      LEFT JOIN entities e_fmvp_team ON e_fmvp_team.id = fo.team_id
      -- Team name AS OF that row's year (e.g. "Seattle SuperSonics" for
      -- pre-2008 rows, not today's "Oklahoma City Thunder") — franchise
      -- continuity means one entity_id spans every name it's ever had
      -- (see entity_names, same convention /teams' former_names CTE
      -- reads), so the current canonical_name alone would be historically
      -- wrong for relocated/rebranded franchises on older rows.
      LEFT JOIN LATERAL (
        SELECT display_name FROM entity_names en
        WHERE en.entity_id = e_champ.id AND c.year BETWEEN en.start_year AND COALESCE(en.end_year, 9999)
        ORDER BY en.start_year DESC LIMIT 1
      ) hn_champ ON true
      LEFT JOIN LATERAL (
        SELECT display_name FROM entity_names en
        WHERE en.entity_id = e_runner.id AND c.year BETWEEN en.start_year AND COALESCE(en.end_year, 9999)
        ORDER BY en.start_year DESC LIMIT 1
      ) hn_runner ON true
      LEFT JOIN LATERAL (
        SELECT display_name FROM entity_names en
        WHERE en.entity_id = e_top.id AND c.year BETWEEN en.start_year AND COALESCE(en.end_year, 9999)
        ORDER BY en.start_year DESC LIMIT 1
      ) hn_top ON true
      LEFT JOIN LATERAL (
        SELECT display_name FROM entity_names en
        WHERE en.entity_id = e_other.id AND c.year BETWEEN en.start_year AND COALESCE(en.end_year, 9999)
        ORDER BY en.start_year DESC LIMIT 1
      ) hn_other ON true
      LEFT JOIN LATERAL (
        SELECT display_name FROM entity_names en
        WHERE en.entity_id = e_mvp_team.id AND c.year BETWEEN en.start_year AND COALESCE(en.end_year, 9999)
        ORDER BY en.start_year DESC LIMIT 1
      ) hn_mvp_team ON true
      LEFT JOIN LATERAL (
        SELECT display_name FROM entity_names en
        WHERE en.entity_id = e_fmvp_team.id AND c.year BETWEEN en.start_year AND COALESCE(en.end_year, 9999)
        ORDER BY en.start_year DESC LIMIT 1
      ) hn_fmvp_team ON true
      ORDER BY c.year DESC
    `, [competition_id, year])

    res.json({
      data: {
        rows: rows.map(r => ({
          year: r.year,
          edition: parseInt(r.edition),
          champion: r.champion_id ? {
            entity_id: r.champion_id, canonical_name: r.champion_name, slug: r.champion_slug,
            logo_url: r.champion_logo, title_no: parseInt(r.champion_title_no) || null,
            wins: parseInt(r.champion_wins) || 0,
          } : null,
          runner_up: r.runner_up_id ? {
            entity_id: r.runner_up_id, canonical_name: r.runner_up_name, slug: r.runner_up_slug,
            logo_url: r.runner_up_logo, wins: parseInt(r.runner_up_wins) || 0,
          } : null,
          standing_leader: r.top_standing_id ? {
            top: {
              entity_id: r.top_standing_id, canonical_name: r.top_standing_name, slug: r.top_standing_slug,
              wins: r.top_standing_wins, losses: r.top_standing_losses,
            },
            other: r.other_standing_id ? {
              entity_id: r.other_standing_id, canonical_name: r.other_standing_name, slug: r.other_standing_slug,
              wins: r.other_standing_wins, losses: r.other_standing_losses,
            } : null,
          } : null,
          mvp: r.mvp_id ? {
            entity_id: r.mvp_id, canonical_name: r.mvp_name, slug: r.mvp_slug, image_url: r.mvp_image, death_date: r.mvp_death_date,
            player_no: parseInt(r.mvp_player_no) || null,
            club: r.mvp_team_id ? {
              entity_id: r.mvp_team_id, canonical_name: r.mvp_team_name, logo_url: r.mvp_team_logo,
              team_no: parseInt(r.mvp_team_no) || null,
            } : null,
          } : null,
          finals_mvp: r.finals_mvp_id ? {
            entity_id: r.finals_mvp_id, canonical_name: r.finals_mvp_name, slug: r.finals_mvp_slug, image_url: r.finals_mvp_image, death_date: r.finals_mvp_death_date,
            player_no: parseInt(r.finals_mvp_player_no) || null,
            club: r.finals_mvp_team_id ? {
              entity_id: r.finals_mvp_team_id, canonical_name: r.finals_mvp_team_name, logo_url: r.finals_mvp_team_logo,
              team_no: parseInt(r.finals_mvp_team_no) || null,
            } : null,
          } : null,
        })),
        count: rows.length,
      }
    })
  } catch (err) { next(err) }
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /results/champion-history-football/:seasonId
// Football's own Champion History — one row per season, "Last season top"
// order (ORDER BY year DESC, same convention as NBA's /champion-history).
// Unlike NBA (Finals-game-based, needs a separate Regular Season standing
// leader column), a domestic-league football season's Champion/Runner-Up
// ARE the standings.position = 1/2 rows directly — no Final game exists for
// these competitions, so there's no equivalent "wins" score to show.
//
// Cup/Champion Trophy/League Cup have no ingested data yet — the frontend
// shows a permanent "—" placeholder for those, same convention as the Team
// Stats/Player Stats All-Time pages.
//
// Top Scorer / Assist Leader: the league's outright leader that season (ties
// broken deterministically by lowest entity_id — same "pick one"
// simplification a compact Palmares row requires; the club/player
// trophy-case AGGREGATE counts elsewhere on the site still credit every
// tied player, this is only about which single name appears in this one
// historical row) — plus a running "Nth time" ordinal for both the player
// and whichever club they were on, same ordinal convention as NBA's
// champion/MVP columns. Assist Leader is the identical shape one column
// over, keyed off assists instead of goals.
router.get('/champion-history-football/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    const rows = await queryAll(`
      WITH
      -- DISTINCT ON (year): Ligue 1's very first season (1932/33) was played
      -- in two groups (Group A / Group B), each with its own position-1 AND
      -- position-2 — a real historical fact (group_name distinguishes them),
      -- not a data bug. Without this, that one season would join 2 champion
      -- rows against 2 runner-up rows (a 4-row cross-fan-out for a single
      -- year), so exactly one of each is picked deterministically (lowest
      -- entity_id) — same "pick one for a compact Palmares row" simplification
      -- already used for Top Scorer ties below, not a claim about which
      -- group's winner "really" was champion that year.
      season_champion AS (
        SELECT DISTINCT ON (s.year) st.entity_id AS champion_id, s.year
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id AND rt.tab_key = 'standings'
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND st.position = 1
        ORDER BY s.year, st.entity_id
      ),
      season_runner_up AS (
        SELECT DISTINCT ON (s.year) st.entity_id AS runner_up_id, s.year
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id AND rt.tab_key = 'standings'
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND st.position = 2
        ORDER BY s.year, st.entity_id
      ),
      champion_ordinal AS (
        SELECT year, champion_id,
          ROW_NUMBER() OVER (PARTITION BY champion_id ORDER BY year) AS title_no
        FROM season_champion
      ),
      season_max_goals AS (
        SELECT pss.season_id, s.year, MAX(pss.goals) AS max_goals
        FROM player_season_stats pss JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
        GROUP BY pss.season_id, s.year
      ),
      top_scorer_by_year AS (
        SELECT DISTINCT ON (smg.year) smg.year, pss2.entity_id AS player_id, pss2.club_entity_id, pss2.goals
        FROM season_max_goals smg
        JOIN player_season_stats pss2 ON pss2.season_id = smg.season_id AND pss2.goals = smg.max_goals
        WHERE smg.max_goals > 0
        ORDER BY smg.year, pss2.entity_id
      ),
      scorer_ordinal AS (
        SELECT year, player_id, club_entity_id, goals,
          ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY year) AS player_no,
          ROW_NUMBER() OVER (PARTITION BY club_entity_id ORDER BY year) AS team_no
        FROM top_scorer_by_year
      ),
      season_max_assists AS (
        SELECT pss.season_id, s.year, MAX(pss.assists) AS max_assists
        FROM player_season_stats pss JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
        GROUP BY pss.season_id, s.year
      ),
      assist_leader_by_year AS (
        SELECT DISTINCT ON (sma.year) sma.year, pss2.entity_id AS player_id, pss2.club_entity_id, pss2.assists
        FROM season_max_assists sma
        JOIN player_season_stats pss2 ON pss2.season_id = sma.season_id AND pss2.assists = sma.max_assists
        WHERE sma.max_assists > 0
        ORDER BY sma.year, pss2.entity_id
      ),
      assist_ordinal AS (
        SELECT year, player_id, club_entity_id, assists,
          ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY year) AS player_no,
          ROW_NUMBER() OVER (PARTITION BY club_entity_id ORDER BY year) AS team_no
        FROM assist_leader_by_year
      )
      SELECT
        sc.year,
        ROW_NUMBER() OVER (ORDER BY sc.year ASC) AS edition,

        co.champion_id, e_champ.canonical_name AS champion_name, e_champ.slug AS champion_slug,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e_champ.id AND sc.year BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e_champ.image_url) AS champion_logo,
        co.title_no AS champion_title_no,

        ru.runner_up_id, e_runner.canonical_name AS runner_up_name, e_runner.slug AS runner_up_slug,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e_runner.id AND sc.year BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e_runner.image_url) AS runner_up_logo,

        so.player_id AS scorer_id, e_scorer.canonical_name AS scorer_name, e_scorer.slug AS scorer_slug,
        e_scorer.image_url AS scorer_image, e_scorer.death_date AS scorer_death_date,
        so.goals AS scorer_goals, so.player_no AS scorer_player_no,

        so.club_entity_id AS scorer_club_id, e_scorer_club.canonical_name AS scorer_club_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e_scorer_club.id AND sc.year BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e_scorer_club.image_url) AS scorer_club_logo,
        so.team_no AS scorer_team_no,

        ao.player_id AS assist_id, e_assist.canonical_name AS assist_name, e_assist.slug AS assist_slug,
        e_assist.image_url AS assist_image, e_assist.death_date AS assist_death_date,
        ao.assists AS assist_assists, ao.player_no AS assist_player_no,

        ao.club_entity_id AS assist_club_id, e_assist_club.canonical_name AS assist_club_name,
        COALESCE((SELECT logo_url FROM entity_logos WHERE entity_id = e_assist_club.id AND sc.year BETWEEN start_year AND COALESCE(end_year, 9999) LIMIT 1), e_assist_club.image_url) AS assist_club_logo,
        ao.team_no AS assist_team_no

      FROM season_champion sc
      JOIN champion_ordinal co ON co.year = sc.year AND co.champion_id = sc.champion_id
      LEFT JOIN season_runner_up ru ON ru.year = sc.year
      LEFT JOIN scorer_ordinal so ON so.year = sc.year
      LEFT JOIN assist_ordinal ao ON ao.year = sc.year
      LEFT JOIN entities e_champ ON e_champ.id = sc.champion_id
      LEFT JOIN entities e_runner ON e_runner.id = ru.runner_up_id
      LEFT JOIN entities e_scorer ON e_scorer.id = so.player_id
      LEFT JOIN entities e_scorer_club ON e_scorer_club.id = so.club_entity_id
      LEFT JOIN entities e_assist ON e_assist.id = ao.player_id
      LEFT JOIN entities e_assist_club ON e_assist_club.id = ao.club_entity_id
      ORDER BY sc.year DESC
    `, [competition_id, year])

    res.json({
      data: {
        rows: rows.map(r => ({
          year: r.year,
          edition: parseInt(r.edition),
          champion: r.champion_id ? {
            entity_id: r.champion_id, canonical_name: r.champion_name, slug: r.champion_slug,
            logo_url: r.champion_logo, title_no: parseInt(r.champion_title_no) || null,
          } : null,
          runner_up: r.runner_up_id ? {
            entity_id: r.runner_up_id, canonical_name: r.runner_up_name, slug: r.runner_up_slug,
            logo_url: r.runner_up_logo,
          } : null,
          top_scorer: r.scorer_id ? {
            entity_id: r.scorer_id, canonical_name: r.scorer_name, slug: r.scorer_slug,
            image_url: r.scorer_image, death_date: r.scorer_death_date,
            goals: parseInt(r.scorer_goals) || 0, player_no: parseInt(r.scorer_player_no) || null,
            club: r.scorer_club_id ? {
              entity_id: r.scorer_club_id, canonical_name: r.scorer_club_name,
              logo_url: r.scorer_club_logo, team_no: parseInt(r.scorer_team_no) || null,
            } : null,
          } : null,
          assist_leader: r.assist_id ? {
            entity_id: r.assist_id, canonical_name: r.assist_name, slug: r.assist_slug,
            image_url: r.assist_image, death_date: r.assist_death_date,
            assists: parseInt(r.assist_assists) || 0, player_no: parseInt(r.assist_player_no) || null,
            club: r.assist_club_id ? {
              entity_id: r.assist_club_id, canonical_name: r.assist_club_name,
              logo_url: r.assist_club_logo, team_no: parseInt(r.assist_team_no) || null,
            } : null,
          } : null,
        })),
        count: rows.length,
      }
    })
  } catch (err) { next(err) }
})

// GET /results/champion-history-football-knockout/:seasonId
// Football's Champion History for a KNOCKOUT-final competition (World Cup
// and any future quadrennial/biennial competition with the same Final Tour
// shape) — the knockout-tournament counterpart of champion-history-football
// above, which is standings-based and doesn't apply here (no league table).
// Same "through <year>" convention as every other All-Time page: keyed by
// seasonId, resolves competition_id + that season's own year, and only
// shows editions with year <= that cutoff — so browsing any real edition
// never shows a scheduled-but-not-yet-played one (2030/2034 today) in its
// own history, not just a hardcoded exclusion of those two years.
//
// Winner/Runner-up/Third are derived from the Final Tour's actual games
// (round='final' winner/loser, round='3rd-place' winner) — NOT standings,
// since a knockout tournament has no league table. An edition whose Final
// Tour hasn't been ingested with that exact shape (1930 has no 3rd-place
// match — historically there wasn't one; 1950 was decided by a final
// round-robin group, not a single match, so it has neither a 'final' nor
// a '3rd-place' result_tabs row at all) simply comes back with those
// fields null via the LEFT JOINs below — the frontend shows "—", same
// "don't fabricate a result" convention as HomeTennisTemplate's team-event
// rows.
// GET /results/home-football-knockout/:seasonId
// "Home of <competition>" (World Cup, and any future quadrennial/biennial
// one with the same shape) — the FULL match schedule for THIS ONE browsed
// edition only (unlike every other football-knockout route in this file,
// there's no "through <year>" cutoff here — Home is about the season
// you're looking at, not career/all-time totals). Group Stages + Knockout
// games in one flat list, sorted latest-first (2026-08-13: "latest game on
// top") so a live/recently-finished game surfaces immediately.
//
// Group/Round label — result_tabs.tab_name already reads correctly for
// BOTH stages with zero special-casing ("Group A".."Group H" for group
// games, "Round of 16"/"Quarter Finals"/etc for knockout — confirmed live
// 2026-08-13), unlike g.round which is "Matchday 1/2/3" for group games
// and the raw round slug for knockout — tab_name is the one consistent
// source for this column.
router.get('/home-football-knockout/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const games = await queryAll(`
      SELECT g.id, g.match_date, g.venue, g.venue_city, g.score, g.home_won,
        rt.tab_name AS round_label, rt.tab_key, rt.tab_group,
        he.id AS home_id, he.canonical_name AS home_name, hco.iso2 AS home_iso2,
        ae.id AS away_id, ae.canonical_name AS away_name, aco.iso2 AS away_iso2,
        vco.name AS host_country_name, vco.iso2 AS host_country_iso2,
        m.id AS video_id, m.video_url, m.source AS video_source,
        m.embeddable AS video_embeddable, m.thumbnail_url AS video_thumbnail_url
      FROM games g
      JOIN result_tabs rt ON rt.id = g.result_tab_id
      JOIN entities he ON he.id = g.home_entity_id
      LEFT JOIN countries hco ON hco.id = he.country_id
      JOIN entities ae ON ae.id = g.away_entity_id
      LEFT JOIN countries aco ON aco.id = ae.country_id
      LEFT JOIN countries vco ON vco.id = g.venue_country_id
      LEFT JOIN media m ON m.game_id = g.id AND m.media_type = 'match_summary'
      WHERE rt.season_id = $1 AND rt.tab_group IN ('group_stages', 'final_tour')
      ORDER BY g.match_date DESC, g.id DESC
    `, [seasonId])

    res.json({
      data: {
        rows: games.map(g => ({
          id: g.id,
          match_date: g.match_date,
          venue: g.venue,
          venue_city: g.venue_city,
          score: g.score,
          home_won: g.home_won,
          round_label: g.round_label,
          tab_key: g.tab_key,
          tab_group: g.tab_group,
          host_country_name: g.host_country_name,
          host_country_iso2: g.host_country_iso2,
          home: { id: g.home_id, name: g.home_name, iso2: g.home_iso2 },
          away: { id: g.away_id, name: g.away_name, iso2: g.away_iso2 },
          video: g.video_id ? {
            id: g.video_id, url: g.video_url, source: g.video_source,
            embeddable: g.video_embeddable, thumbnail_url: g.video_thumbnail_url,
          } : null,
        })),
        count: games.length,
      }
    })
  } catch (err) { next(err) }
})

router.get('/champion-history-football-knockout/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    // Top Scorer — same "outright leader, ties broken by lowest entity_id"
    // simplification champion_history_fb's ScorerCell uses (a compact
    // history row shows one name, the club/player trophy-case AGGREGATE
    // elsewhere still credits every tied player). club_entity_id here is
    // the player's national team for that edition (World Cup ingestion
    // convention), so its country_id resolves the same flag Winner/
    // Runner-up/Third use.
    const rows = await queryAll(`
      WITH season_max_goals AS (
        SELECT pss.season_id, s2.year, MAX(pss.goals) AS max_goals
        FROM player_season_stats pss JOIN seasons s2 ON s2.id = pss.season_id
        WHERE s2.competition_id = $1 AND s2.year <= $2
        GROUP BY pss.season_id, s2.year
      ),
      top_scorer_by_year AS (
        SELECT DISTINCT ON (smg.year) smg.year, pss2.entity_id AS player_id, pss2.club_entity_id, pss2.goals
        FROM season_max_goals smg
        JOIN player_season_stats pss2 ON pss2.season_id = smg.season_id AND pss2.goals = smg.max_goals
        WHERE smg.max_goals > 0
        ORDER BY smg.year, pss2.entity_id
      )
      SELECT
        s.id AS season_id, s.year, s.status, s.start_date, s.end_date, s.host_countries,
        ROW_NUMBER() OVER (ORDER BY s.year ASC) AS edition,

        w.id AS winner_id, w.canonical_name AS winner_name, w.slug AS winner_slug, wco.iso2 AS winner_iso2,
        -- Nth title for this winner through this edition — same running-
        -- ordinal convention as champion_history_fb's TeamCell (title_no),
        -- partitioned by the (already-merged, e.g. West Germany/Germany)
        -- entity id so a continuation entity's earlier titles count too.
        ROW_NUMBER() OVER (PARTITION BY w.id ORDER BY s.year ASC) AS winner_title_no,
        l.id AS runner_up_id, l.canonical_name AS runner_up_name, l.slug AS runner_up_slug, lco.iso2 AS runner_up_iso2,
        t.id AS third_id, t.canonical_name AS third_name, t.slug AS third_slug, tco.iso2 AS third_iso2,

        e_scorer.id AS scorer_id, e_scorer.canonical_name AS scorer_name, e_scorer.slug AS scorer_slug,
        sco.iso2 AS scorer_iso2, ts.goals AS scorer_goals,
        e_scorer_club.canonical_name AS scorer_country_name

      FROM seasons s

      LEFT JOIN result_tabs rt_final ON rt_final.season_id = s.id AND rt_final.tab_key = 'final'
      LEFT JOIN LATERAL (
        SELECT g.winner_entity_id,
          CASE WHEN g.winner_entity_id = g.home_entity_id THEN g.away_entity_id ELSE g.home_entity_id END AS loser_entity_id
        FROM games g WHERE g.result_tab_id = rt_final.id
        ORDER BY g.id LIMIT 1
      ) fin ON true
      LEFT JOIN entities w ON w.id = fin.winner_entity_id
      LEFT JOIN countries wco ON wco.id = w.country_id
      LEFT JOIN entities l ON l.id = fin.loser_entity_id
      LEFT JOIN countries lco ON lco.id = l.country_id

      LEFT JOIN result_tabs rt_third ON rt_third.season_id = s.id AND rt_third.tab_key = '3rd-place'
      LEFT JOIN LATERAL (
        SELECT g.winner_entity_id
        FROM games g WHERE g.result_tab_id = rt_third.id
        ORDER BY g.id LIMIT 1
      ) third ON true
      LEFT JOIN entities t ON t.id = third.winner_entity_id
      LEFT JOIN countries tco ON tco.id = t.country_id

      LEFT JOIN top_scorer_by_year ts ON ts.year = s.year
      LEFT JOIN entities e_scorer ON e_scorer.id = ts.player_id
      LEFT JOIN entities e_scorer_club ON e_scorer_club.id = ts.club_entity_id
      LEFT JOIN countries sco ON sco.id = e_scorer_club.country_id

      WHERE s.competition_id = $1 AND s.year <= $2
      ORDER BY s.year ASC
    `, [competition_id, year])

    res.json({
      data: {
        rows: rows.map(r => ({
          season_id: r.season_id,
          year: r.year,
          edition: parseInt(r.edition),
          status: r.status,
          start_date: r.start_date,
          end_date: r.end_date,
          host_countries: r.host_countries || [],
          winner: r.winner_id ? { entity_id: r.winner_id, canonical_name: r.winner_name, slug: r.winner_slug, iso2: r.winner_iso2, title_no: parseInt(r.winner_title_no) || null } : null,
          runner_up: r.runner_up_id ? { entity_id: r.runner_up_id, canonical_name: r.runner_up_name, slug: r.runner_up_slug, iso2: r.runner_up_iso2 } : null,
          third: r.third_id ? { entity_id: r.third_id, canonical_name: r.third_name, slug: r.third_slug, iso2: r.third_iso2 } : null,
          top_scorer: r.scorer_id ? { entity_id: r.scorer_id, canonical_name: r.scorer_name, slug: r.scorer_slug, iso2: r.scorer_iso2, goals: parseInt(r.scorer_goals) || 0, country_name: r.scorer_country_name } : null,
        })),
        count: rows.length,
      }
    })
  } catch (err) { next(err) }
})

// GET /results/teams-all-time-football-knockout/:seasonId
// Team Stats for a KNOCKOUT-final competition (World Cup, any future
// quadrennial/biennial one with the same Final Tour/Group Stages shape) —
// the knockout counterpart of /teams-all-time above, which is
// standings-based (`WHERE tab_key = 'standings'`) and returns ZERO rows
// for the World Cup (no plain standings tab exists — verified live).
// Same "through <year>" cutoff every other All-Time page uses.
//
// PARTICIPATIONS — derived from DISTINCT (team, year) pairs across ALL
// games (group_stages UNION final_tour), not from `standings` — that
// table is missing entirely for 1950/1982 and partially populated for
// 1974/1978 (verified live), so it undercounts. games.home_entity_id/
// away_entity_id has zero gaps across all 23 editions.
//
// GROUP STAGES vs KNOCKOUT — 1934 and 1938 were pure single-elimination
// (no group stage ever existed those years, not a data gap) — those two
// editions only ever contribute to `final_tour` numbers; a team whose
// entire history is 1934/1938 will have null group_stages stats, shown as
// "—" by the frontend, same "don't fabricate" convention as elsewhere.
//
// W/D/L — games.home_won is `true`/`false`/NULL, where NULL means a draw
// (verified: every home_won IS NULL row has score.home = score.away,
// exactly). Both stat scopes are computed together in one query — the
// frontend's Group Stages/Knockout pill just switches which of the two
// pre-computed objects it displays, no re-fetch needed.
// tier 1 ('F') is overridden to 'W' below when the team has ever won the
// final — Best Perf. distinguishes Champion from "reached the Final but
// never won". Tier 2 is 'SF' not '3rd' — reaching the 3rd-place match
// means you were eliminated in the Semifinal (the 3rd-place match is a
// consolation game, not an advancement); labeling it '3rd' was wrong for
// teams who then LOST that match and finished 4th (2026-08-13: Morocco
// finished 4th in 2026, exposing the mislabel).
const TIER_LABEL = { 1: 'F', 2: 'SF', 3: 'SF', 4: 'QF', 5: 'R16', 6: 'R32', 7: 'R64', 8: 'GS' }

router.get('/teams-all-time-football-knockout/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params
    const season = await queryOne(`SELECT competition_id, year FROM seasons WHERE id = $1`, [seasonId])
    if (!season) return res.status(404).json({ error: 'Season not found' })
    const { competition_id, year } = season

    const rows = await queryAll(`
      WITH team_games AS (
        SELECT rt.tab_group, s.year, g.home_entity_id, g.away_entity_id, g.home_won, g.score
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND rt.tab_group IN ('group_stages', 'final_tour')
      ),
      team_editions AS (
        SELECT DISTINCT entity_id, year FROM (
          SELECT home_entity_id AS entity_id, year FROM team_games
          UNION
          SELECT away_entity_id AS entity_id, year FROM team_games
        ) x
      ),
      participations AS (
        SELECT entity_id, COUNT(*) AS participations,
          MIN(year) AS first_year, MAX(year) AS last_year
        FROM team_editions GROUP BY entity_id
      ),
      -- Former country names (Soviet Union -> Russia, Yugoslavia/Serbia and
      -- Montenegro -> Serbia, Zaire -> Congo DR — merged 2026-08-12) —
      -- identical convention to NBA's franchise-continuity former_names
      -- CTE (results.js ~line 2069): any entity_names row whose
      -- display_name differs from the entity's current canonical_name.
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
      ),
      finals AS (
        SELECT g.winner_entity_id AS winner,
          CASE WHEN g.winner_entity_id = g.home_entity_id THEN g.away_entity_id ELSE g.home_entity_id END AS loser
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id AND rt.tab_key = 'final'
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
      ),
      third_place AS (
        SELECT g.winner_entity_id AS winner,
          CASE WHEN g.winner_entity_id = g.home_entity_id THEN g.away_entity_id ELSE g.home_entity_id END AS loser
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id AND rt.tab_key = '3rd-place'
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
      ),
      titles AS (SELECT winner AS entity_id, COUNT(*) AS titles FROM finals GROUP BY winner),
      runner_ups AS (SELECT loser AS entity_id, COUNT(*) AS runner_ups FROM finals GROUP BY loser),
      finals_count AS (
        SELECT entity_id, COUNT(*) AS finals_n FROM (
          SELECT winner AS entity_id FROM finals
          UNION ALL
          SELECT loser AS entity_id FROM finals
        ) x GROUP BY entity_id
      ),
      thirds AS (SELECT winner AS entity_id, COUNT(*) AS thirds FROM third_place GROUP BY winner),
      -- 4th place = the LOSER of the 3rd-place match (2026-08-12: "Add
      -- column 3rd/4th").
      fourths AS (SELECT loser AS entity_id, COUNT(*) AS fourths FROM third_place GROUP BY loser),
      -- Best Perf. (2026-08-12, filled in for EVERY team incl. Final/3rd
      -- place peaks 2026-08-12) — the deepest knockout round a team has
      -- ever reached, in every edition through the current cutoff.
      -- "R32 (3)" means their best career run stopped at Round of 32,
      -- achieved 3 separate times.
      round_tier AS (
        SELECT rt.tab_key, s.year, g.home_entity_id, g.away_entity_id,
          CASE rt.tab_key
            WHEN 'final' THEN 1 WHEN '3rd-place' THEN 2 WHEN 'semi-finals' THEN 3
            WHEN 'quarter-finals' THEN 4 WHEN 'round-of-16' THEN 5
            WHEN 'round-of-32' THEN 6 WHEN 'round-of-64' THEN 7 ELSE 99
          END AS tier
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id AND rt.tab_group = 'final_tour'
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2
      ),
      team_round_tier AS (
        SELECT year, home_entity_id AS entity_id, tier FROM round_tier
        UNION ALL
        SELECT year, away_entity_id AS entity_id, tier FROM round_tier
      ),
      edition_best_tier AS (
        SELECT entity_id, year, MIN(tier) AS best_tier FROM team_round_tier GROUP BY entity_id, year
      ),
      team_best_tier AS (
        SELECT entity_id, MIN(best_tier) AS overall_best_tier FROM edition_best_tier GROUP BY entity_id
      ),
      -- Teams that never won a single knockout game in ANY edition have no
      -- row in team_round_tier at all, so team_best_tier skips them
      -- entirely — that's the "missing for a lot of countries" bug
      -- (2026-08-12). Their real Best Perf. is Group Stage: tier 8 ('GS'),
      -- times = how many editions they were eliminated at that stage
      -- (= every edition they played, since they made zero knockout runs).
      knockout_editions AS (
        SELECT DISTINCT entity_id, year FROM team_round_tier
      ),
      gs_only_editions AS (
        SELECT te.entity_id, COUNT(*) AS gs_only_count
        FROM team_editions te
        LEFT JOIN knockout_editions ke ON ke.entity_id = te.entity_id AND ke.year = te.year
        WHERE ke.entity_id IS NULL
        GROUP BY te.entity_id
      ),
      best_perf AS (
        SELECT eb.entity_id, tb.overall_best_tier AS tier,
          COUNT(*) FILTER (WHERE eb.best_tier = tb.overall_best_tier) AS times_reached
        FROM edition_best_tier eb
        JOIN team_best_tier tb ON tb.entity_id = eb.entity_id
        GROUP BY eb.entity_id, tb.overall_best_tier
        UNION ALL
        SELECT go.entity_id, 8 AS tier, go.gs_only_count AS times_reached
        FROM gs_only_editions go
        WHERE NOT EXISTS (SELECT 1 FROM team_best_tier tb WHERE tb.entity_id = go.entity_id)
      ),
      team_perspective AS (
        SELECT tab_group, home_entity_id AS entity_id,
          CASE WHEN home_won = true THEN 'W' WHEN home_won = false THEN 'L' ELSE 'D' END AS result,
          (score->>'home')::int AS gf, (score->>'away')::int AS ga
        FROM team_games
        UNION ALL
        SELECT tab_group, away_entity_id AS entity_id,
          CASE WHEN home_won = false THEN 'W' WHEN home_won = true THEN 'L' ELSE 'D' END AS result,
          (score->>'away')::int AS gf, (score->>'home')::int AS ga
        FROM team_games
      ),
      scope_stats AS (
        SELECT entity_id, tab_group,
          COUNT(*) AS games_played,
          COUNT(*) FILTER (WHERE result = 'W') AS won,
          COUNT(*) FILTER (WHERE result = 'D') AS drawn,
          COUNT(*) FILTER (WHERE result = 'L') AS lost,
          SUM(gf) AS gf, SUM(ga) AS ga
        FROM team_perspective
        GROUP BY entity_id, tab_group
      )
      SELECT
        e.id, e.canonical_name, e.slug, co.iso2, co.confederation,
        COALESCE(p.participations, 0) AS participations,
        p.first_year, p.last_year,
        fn.names AS former_names,
        COALESCE(t.titles, 0) AS titles,
        COALESCE(fc.finals_n, 0) AS finals_n,
        COALESCE(ru.runner_ups, 0) AS runner_ups,
        COALESCE(th.thirds, 0) AS thirds,
        COALESCE(fo.fourths, 0) AS fourths,
        bp.tier AS best_perf_tier, bp.times_reached AS best_perf_times,
        gs.games_played AS gs_games_played, gs.won AS gs_won, gs.drawn AS gs_drawn, gs.lost AS gs_lost, gs.gf AS gs_gf, gs.ga AS gs_ga,
        ko.games_played AS ko_games_played, ko.won AS ko_won, ko.drawn AS ko_drawn, ko.lost AS ko_lost, ko.gf AS ko_gf, ko.ga AS ko_ga
      FROM participations p
      JOIN entities e ON e.id = p.entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      LEFT JOIN former_names fn ON fn.entity_id = e.id
      LEFT JOIN titles t ON t.entity_id = e.id
      LEFT JOIN runner_ups ru ON ru.entity_id = e.id
      LEFT JOIN finals_count fc ON fc.entity_id = e.id
      LEFT JOIN thirds th ON th.entity_id = e.id
      LEFT JOIN fourths fo ON fo.entity_id = e.id
      LEFT JOIN best_perf bp ON bp.entity_id = e.id
      LEFT JOIN scope_stats gs ON gs.entity_id = e.id AND gs.tab_group = 'group_stages'
      LEFT JOIN scope_stats ko ON ko.entity_id = e.id AND ko.tab_group = 'final_tour'
      -- Default sort cascade: Titles, then Runner-up (2nd), then 3rd, then
      -- 4th, then Participations (2026-08-12) — the frontend's "Sort by"
      -- dropdown re-sorts client-side but falls back to this SAME cascade
      -- for ties, rather than alphabetical.
      ORDER BY t.titles DESC NULLS LAST, ru.runner_ups DESC NULLS LAST, th.thirds DESC NULLS LAST, fo.fourths DESC NULLS LAST, p.participations DESC, e.canonical_name ASC
    `, [competition_id, year])

    res.json({
      data: {
        rows: rows.map(r => ({
          entity_id: r.id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          iso2: r.iso2,
          confederation: r.confederation,
          participations: parseInt(r.participations) || 0,
          first_year: r.first_year,
          last_year: r.last_year,
          former_names: r.former_names,
          titles: parseInt(r.titles) || 0,
          finals: parseInt(r.finals_n) || 0,
          runner_up: parseInt(r.runner_ups) || 0,
          third: parseInt(r.thirds) || 0,
          fourth: parseInt(r.fourths) || 0,
          best_perf: r.best_perf_tier != null ? (
            r.best_perf_tier === 1 && parseInt(r.titles) > 0
              ? { round: 'W', times: parseInt(r.titles) || 0 }
              : { round: TIER_LABEL[r.best_perf_tier] || null, times: parseInt(r.best_perf_times) || 0 }
          ) : null,
          group_stages: r.gs_games_played != null ? {
            games_played: parseInt(r.gs_games_played) || 0,
            won: parseInt(r.gs_won) || 0, drawn: parseInt(r.gs_drawn) || 0, lost: parseInt(r.gs_lost) || 0,
            gf: parseInt(r.gs_gf) || 0, ga: parseInt(r.gs_ga) || 0,
          } : null,
          knockout: r.ko_games_played != null ? {
            games_played: parseInt(r.ko_games_played) || 0,
            won: parseInt(r.ko_won) || 0, drawn: parseInt(r.ko_drawn) || 0, lost: parseInt(r.ko_lost) || 0,
            gf: parseInt(r.ko_gf) || 0, ga: parseInt(r.ko_ga) || 0,
          } : null,
        })),
        count: rows.length,
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
      ),
      -- Active/Retired — always keyed off Regular Season (event 74)
      -- regardless of the selected type=regular|playoffs, since not every
      -- player who's still active suits up for the Playoffs every year.
      -- "Active" = has a Regular Season row in the exact selected year;
      -- anything earlier means they'd already stopped playing by then.
      last_regular_season AS MATERIALIZED (
        SELECT DISTINCT ON (pss.entity_id) pss.entity_id AS player_id, s.year AS last_year
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $2 AND s.event_id = 74 AND s.year <= $3
          AND pss.entity_id = ANY($1)
        ORDER BY pss.entity_id, s.year DESC
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug, e.image_url, e.birth_date, e.death_date,
        lrs.last_year = $3 AS is_active,
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
      LEFT JOIN last_regular_season lrs ON lrs.player_id = e.id
      LEFT JOIN career_totals ct ON ct.player_id = e.id
      LEFT JOIN player_wl pw ON pw.player_id = e.id
      LEFT JOIN player_finals pf ON pf.player_id = e.id
      LEFT JOIN player_titles pt ON pt.player_id = e.id
      LEFT JOIN player_cup_finals cpf ON cpf.player_id = e.id
      LEFT JOIN player_cup_titles cpt ON cpt.player_id = e.id
      LEFT JOIN player_attributes pa_pos ON pa_pos.entity_id = e.id AND pa_pos.attribute_key = 'position'
      LEFT JOIN countries ent_co ON ent_co.id = e.country_id
      LEFT JOIN entities club_e ON club_e.id = COALESCE(cr.club_entity_id, (cr.stats_club_entity_id)::int)
      LEFT JOIN entity_logos club_logo ON club_logo.entity_id = club_e.id
        AND $3::int BETWEEN club_logo.start_year AND COALESCE(club_logo.end_year, 9999)
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
            death_date: p.death_date,
            is_active: p.is_active === true,
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
              fgm: div(p.total_fgm), fga: div(p.total_fga),
              tpm: div(p.total_tpm), tpa: div(p.total_tpa),
              ftm: div(p.total_ftm), fta: div(p.total_fta),
              rebounds: div(p.total_rebounds), assists: div(p.total_assists),
              steals: div(p.total_steals), blocks: div(p.total_blocks), turnovers: div(p.total_turnovers),
              fg_pct: pct(p.total_fgm, p.total_fga), tp_pct: pct(p.total_tpm, p.total_tpa), ft_pct: pct(p.total_ftm, p.total_fta),
              totals: {
                minutes: p.total_minutes != null ? Math.round(Number(p.total_minutes)) : null,
                points: p.total_points != null ? Number(p.total_points) : null,
                fgm: p.total_fgm != null ? Number(p.total_fgm) : null,
                fga: p.total_fga != null ? Number(p.total_fga) : null,
                tpm: p.total_tpm != null ? Number(p.total_tpm) : null,
                tpa: p.total_tpa != null ? Number(p.total_tpa) : null,
                ftm: p.total_ftm != null ? Number(p.total_ftm) : null,
                fta: p.total_fta != null ? Number(p.total_fta) : null,
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
// 6MOY/MIP/ROY/All-NBA 1st-2nd-3rd/All-Defense 1st-2nd/All-Star
// selections/All-Star MVP — "through <year>". The player list is every
// player with at least one qualifying award row through the selected year
// (career-wide, NOT scoped to this year's active roster like the Player
// Stats tab is) — scoping to "current roster" silently dropped every
// retired legend (Jordan, Kareem, etc.) from what's supposed to be an
// all-time leaderboard.
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
        -- Two cleanly-indexable branches (each hits
        -- seasons_competition_id_event_id_year... directly via a constant
        -- event_id, same index every other CTE in this query already uses)
        -- UNION'd instead of one OR-heavy WHERE across a joined events
        -- table — the OR version defeats the planner's row estimates badly
        -- enough to pick a nested-loop plan over a hash join further down
        -- (6-figure-ms query times on the full unfiltered player list).
        SELECT pss.entity_id AS player_id, rt.tab_key,
          false AS is_all_star,
          COALESCE((pss.stats->>'winner')::boolean, false) AS is_winner
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND s.event_id = 78 -- Awards
          AND rt.tab_key IN ('mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy', 'nba-cup-mvp',
                              'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd',
                              'all-defense-1st', 'all-defense-2nd')
        UNION ALL
        -- All-Star's own typology='players' tabs: its 'mvp' tab (reuses
        -- that tab_key — disambiguated below via is_all_star, not by tab_key,
        -- so it can't double-count into Awards' regular MVP total) plus
        -- every roster tab, whose tab_key varies by year (fixed
        -- 'eastern-conference'/'western-conference' for 1951-2017/2024, a
        -- dynamic per-team slug like 'team-lebron' otherwise — see
        -- ingest-nba-all-star.js) — no fixed tab_key list possible, so every
        -- 'players' tab under this event qualifies.
        SELECT pss.entity_id, rt.tab_key,
          true AS is_all_star,
          COALESCE((pss.stats->>'winner')::boolean, false) AS is_winner
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year <= $2 AND s.event_id = 80 -- All-Star
          AND rt.typology = 'players'
      ),
      -- Bucket All-Star rows into 'all_star' (any roster selection) / 'all_star_mvp'
      -- (that tab's own winner=true row) so the honours CTE below can
      -- COUNT(*) FILTER on one flat category regardless of which specific
      -- (possibly year-varying) tab_key the row actually came from.
      categorized AS (
        SELECT *,
          CASE
            WHEN is_all_star AND tab_key = 'mvp' THEN 'all_star_mvp'
            WHEN is_all_star THEN 'all_star'
            ELSE tab_key
          END AS category
        FROM award_rows
      ),
      -- Only rows that actually count as a title/selection: winner=true
      -- for the single-winner tabs (mvp/finals-mvp/dpoy/smoy/mip/roy/
      -- nba-cup-mvp/all_star_mvp list every candidate, not just the
      -- winner), any row at all for the roster tabs (all-nba/all-defense/
      -- all_star — every row there IS a selection).
      qualifying AS (
        SELECT * FROM categorized
        WHERE category IN ('all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd', 'all_star')
           OR is_winner
      ),
      honours AS (
        SELECT
          player_id,
          COUNT(*) FILTER (WHERE category = 'mvp')        AS mvp,
          COUNT(*) FILTER (WHERE category = 'finals-mvp') AS finals_mvp,
          COUNT(*) FILTER (WHERE category = 'dpoy')       AS dpoy,
          COUNT(*) FILTER (WHERE category = 'smoy')       AS smoy,
          COUNT(*) FILTER (WHERE category = 'mip')        AS mip,
          COUNT(*) FILTER (WHERE category = 'roy')        AS roy,
          COUNT(*) FILTER (WHERE category = 'nba-cup-mvp') AS nba_cup_mvp,
          COUNT(*) FILTER (WHERE category = 'all-nba-1st')     AS all_nba_1,
          COUNT(*) FILTER (WHERE category = 'all-nba-2nd')     AS all_nba_2,
          COUNT(*) FILTER (WHERE category = 'all-nba-3rd')     AS all_nba_3,
          COUNT(*) FILTER (WHERE category = 'all-defense-1st') AS all_def_1,
          COUNT(*) FILTER (WHERE category = 'all-defense-2nd') AS all_def_2,
          COUNT(*) FILTER (WHERE category = 'all_star')        AS all_star,
          COUNT(*) FILTER (WHERE category = 'all_star_mvp')    AS all_star_mvp
        FROM qualifying
        GROUP BY player_id
      ),
      -- Active/Retired — always keyed off Regular Season (event 74)
      -- regardless of which award tabs the player qualifies through —
      -- same convention /players-all-time uses. "Active" = has a Regular
      -- Season row in the exact selected year.
      -- One-row-per-player list of who actually qualifies, joined (not
      -- "entity_id IN (subquery)") against below — the IN-subquery form
      -- made Postgres pick a nested-loop-with-manual-equality-check plan
      -- here (millions of row comparisons against every Regular Season
      -- player-row, instead of a hash join), turning this endpoint's query
      -- time from milliseconds into over a minute once All-Star nearly
      -- doubled the qualifying-player count.
      qualifying_players AS (
        SELECT DISTINCT player_id FROM qualifying
      ),
      last_regular_season AS (
        SELECT DISTINCT ON (pss.entity_id) pss.entity_id AS player_id, s.year AS last_year
        FROM player_season_stats pss
        JOIN result_tabs rt ON rt.id = pss.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN qualifying_players qp ON qp.player_id = pss.entity_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $1 AND s.event_id = 74 AND s.year <= $2
        ORDER BY pss.entity_id, s.year DESC
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
        JOIN qualifying_players qp ON qp.player_id = pss.entity_id
        WHERE rt.tab_key = 'players' AND s.competition_id = $1 AND s.event_id = 74 AND s.year <= $2
        ORDER BY pss.entity_id, s.year DESC
      )
      SELECT
        e.id AS entity_id, e.canonical_name, e.slug, e.image_url, e.birth_date, e.death_date,
        lrs.last_year = $2 AS is_active,
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
        COALESCE(honours.all_def_2, 0)  AS all_def_2,
        COALESCE(honours.all_star, 0)     AS all_star,
        COALESCE(honours.all_star_mvp, 0) AS all_star_mvp
      FROM entities e
      JOIN current_row cr ON cr.player_id = e.id
      LEFT JOIN last_regular_season lrs ON lrs.player_id = e.id
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
          death_date:     p.death_date,
          is_active:      p.is_active === true,
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
          all_star:       parseInt(p.all_star)     || 0,
          all_star_mvp:   parseInt(p.all_star_mvp) || 0,
        })),
        count: players.length,
      }
    })
  } catch (err) { next(err) }
})

module.exports = router;