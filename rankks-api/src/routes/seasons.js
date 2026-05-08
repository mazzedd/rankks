// src/routes/seasons.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/seasons?competition=:slug&year=:year&event=:eventSlug
router.get('/', async (req, res, next) => {
  try {
    const { competition, year, event } = req.query;

    if (!competition || !year) {
      return res.status(400).json({
        error: 'competition slug and year are required'
      });
    }

    const yearInt = parseInt(year);

    const comp = await queryOne(`
      SELECT c.id, c.name, c.slug, c.competition_type,
             c.edition_years, c.founded_year, c.dissolved_year,
             c.first_data_year, c.logo_url, c.bg_image_url, c.column_config,
             c.year_convention,
             s.display_pattern
      FROM competitions c
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN sports s ON s.id = ec.sport_id
      WHERE c.slug = $1
    `, [competition]);

    if (!comp) {
      return res.status(404).json({ error: 'Competition not found' });
    }

    // Resolve the DB year from the UI year based on convention
    // 'start' → DB stores start year (e.g. Ligue 1: 2020-21 stored as 2020) → UI shows end year → subtract 1
    // 'end'   → DB stores end year   (e.g. UCL: 2022-23 stored as 2023)     → UI shows end year → no change
    const dbYear = comp.year_convention === 'start' ? yearInt - 1 : yearInt;
    console.log('DEBUG:', comp.slug, 'yearInt:', yearInt, 'dbYear:', dbYear, 'convention:', comp.year_convention, 'comp.id:', comp.id);

    if (comp.founded_year && dbYear < comp.founded_year) {
      return res.json({
        data: null,
        empty_state: {
          type: 'not_founded',
          message: `${comp.name} was founded in ${comp.founded_year}. Select a later year.`,
          founded_year: comp.founded_year,
        }
      });
    }

    if (comp.dissolved_year && dbYear > comp.dissolved_year) {
      return res.json({
        data: null,
        empty_state: {
          type: 'dissolved',
          message: `${comp.name} ceased in ${comp.dissolved_year}. Select an earlier year.`,
          dissolved_year: comp.dissolved_year,
        }
      });
    }

    if (comp.competition_type === 'quadrennial' && comp.edition_years) {
      const editionYears = comp.edition_years;
      if (!editionYears.includes(dbYear)) {
        const prev = editionYears.filter(y => y < dbYear).pop();
        const next = editionYears.find(y => y > dbYear);
        return res.json({
          data: null,
          empty_state: {
            type: 'no_edition',
            message: `No ${comp.name} in ${yearInt}.`,
            previous_edition: prev || null,
            next_edition: next || null,
          }
        });
      }
    }

    let seasonQuery = `
      SELECT
        s.id,
        s.year,
        s.status,
        s.gender,
        s.start_date,
        s.end_date,
        s.current_matchday,
        s.current_round,
        s.edition_number,
        s.cancellation_reason,
        s.prize_money,
        s.bg_image_url,
        e.id    AS event_id,
        e.name  AS event_name,
        e.slug  AS event_slug
      FROM seasons s
      LEFT JOIN events e ON e.id = s.event_id
      WHERE s.competition_id = $1
        AND s.year = $2
    `;

    const params = [comp.id, dbYear];

    if (event) {
      seasonQuery += ` AND (e.slug = $3 OR s.event_id IS NULL)`;
      params.push(event);
    }

    seasonQuery += ` ORDER BY s.gender, e.display_order`;

    const seasons = await queryAll(seasonQuery, params);

    if (seasons.length === 0) {
      return res.json({
        data: null,
        empty_state: {
          type: 'no_data',
          message: `No data available for ${comp.name} ${yearInt}.`,
        }
      });
    }

    const seasonsWithTabs = await Promise.all(
      seasons.map(async (season) => {
        const tabs = await queryAll(`
          SELECT id, tab_name, tab_key, typology, display_order, is_default
          FROM result_tabs
          WHERE season_id = $1
          ORDER BY display_order
        `, [season.id]);

        return { ...season, result_tabs: tabs };
      })
    );

    // Detect sport for winner query strategy
    const sportRow = await queryOne(`
      SELECT sp.slug FROM sports sp
      JOIN event_categories ec ON ec.sport_id = sp.id
      JOIN competitions c2 ON c2.category_id = ec.id
      WHERE c2.id = $1
    `, [comp.id]);
    const isTennis = sportRow?.slug === 'tennis';

    const winners = await Promise.all(
      seasons.map(async (season) => {
        if (isTennis) {
          // Tennis: winner = entity who won the Final game in this season
          // Must use a draw tab (not players tab) to find the Final game
          const genderKey = season.gender === 'F' ? 'draw-singles-f' : 'draw-singles-m'
          const finalTab = await queryOne(`
            SELECT id FROM result_tabs
            WHERE season_id = $1
              AND tab_key = $2
            LIMIT 1
          `, [season.id, genderKey]);
          if (!finalTab) return null;

          const winner = await queryOne(`
            SELECT
              e.id          AS entity_id,
              e.canonical_name,
              e.slug        AS entity_slug,
              e.entity_type,
              e.image_url,
              co.iso2       AS country_iso2,
              co.name       AS country_name
            FROM games g
            JOIN entities e ON e.id = g.winner_entity_id
            LEFT JOIN countries co ON co.id = e.country_id
            WHERE g.result_tab_id = $1
              AND g.round = 'Final'
            LIMIT 1
          `, [finalTab.id]);

          return { season_id: season.id, winner };
        }

        // Football: winner from standings position 1
        const defaultTab = await queryOne(`
          SELECT id FROM result_tabs
          WHERE season_id = $1 AND is_default = TRUE
          LIMIT 1
        `, [season.id]);

        if (!defaultTab) return null;

        const winner = await queryOne(`
          SELECT
            st.position,
            e.id          AS entity_id,
            e.canonical_name,
            e.entity_type,
            COALESCE(el.logo_url, e.image_url) AS image_url,
            co.iso2       AS country_iso2,
            co.name       AS country_name,
            st.stats
          FROM standings st
          JOIN entities e ON e.id = st.entity_id
          LEFT JOIN countries co ON co.id = e.country_id
          LEFT JOIN entity_logos el ON el.entity_id = e.id AND el.is_current = true
          WHERE st.result_tab_id = $1
            AND st.position = 1
        `, [defaultTab.id]);

        return { season_id: season.id, winner };
      })
    );

    const naming = await queryOne(`
      SELECT official_name, title_sponsor, partner, prize_money
      FROM competition_naming
      WHERE competition_id = $1
        AND start_year <= $2
        AND (end_year IS NULL OR end_year >= $2)
      ORDER BY start_year DESC
      LIMIT 1
    `, [comp.id, dbYear]);

    res.json({
      data: {
        competition: {
          ...comp,
          naming_this_year: naming,
        },
        seasons: seasonsWithTabs,
        winners,
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/entity-history?entity_id=X&competition_id=Y&year=Z
// Returns participations and titles up to and including the selected year
router.get('/entity-history', async (req, res, next) => {
  try {
    const { entity_id, competition_id, year } = req.query;

    if (!entity_id || !competition_id || !year) {
      return res.status(400).json({ error: 'entity_id, competition_id and year are required' });
    }

    // Detect sport
    const sportCheck = await queryOne(`
      SELECT sp.slug FROM sports sp
      JOIN event_categories ec ON ec.sport_id = sp.id
      JOIN competitions c2 ON c2.category_id = ec.id
      WHERE c2.id = $1
    `, [competition_id]);
    const isTennis = sportCheck?.slug === 'tennis';

    let participationsResult, titlesResult;

    if (isTennis) {
      participationsResult = await queryOne(`
        SELECT COUNT(DISTINCT s.id) AS participations
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE (g.home_entity_id = $1 OR g.away_entity_id = $1)
          AND s.competition_id = $2
          AND s.year <= $3
      `, [entity_id, competition_id, year]);

      titlesResult = await queryOne(`
        SELECT COUNT(DISTINCT s.id) AS titles
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE g.winner_entity_id = $1
          AND g.round = 'Final'
          AND s.competition_id = $2
          AND s.year <= $3
      `, [entity_id, competition_id, year]);
    } else {
      participationsResult = await queryOne(`
        SELECT COUNT(DISTINCT rt.season_id) AS participations
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE st.entity_id = $1
          AND s.competition_id = $2
          AND s.year <= $3
      `, [entity_id, competition_id, year]);

      titlesResult = await queryOne(`
        SELECT COUNT(DISTINCT rt.season_id) AS titles
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE st.entity_id = $1
          AND s.competition_id = $2
          AND s.year <= $3
          AND st.position = 1
      `, [entity_id, competition_id, year]);
    }

    res.json({
      data: {
        participations: parseInt(participationsResult?.participations ?? 0),
        titles:         parseInt(titlesResult?.titles ?? 0),
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/:id
router.get('/:id', async (req, res, next) => {
  try {
    const season = await queryOne(`
      SELECT s.*, c.name AS competition_name, c.slug AS competition_slug,
             c.logo_url, c.bg_image_url, c.column_config,
             e.name AS event_name, e.slug AS event_slug
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      LEFT JOIN events e ON e.id = s.event_id
      WHERE s.id = $1
    `, [req.params.id]);

    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const tabs = await queryAll(`
      SELECT id, tab_name, tab_key, typology, display_order, is_default
      FROM result_tabs
      WHERE season_id = $1
      ORDER BY display_order
    `, [season.id]);

    res.json({ data: { ...season, result_tabs: tabs } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;