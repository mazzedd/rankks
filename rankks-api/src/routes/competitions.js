// src/routes/competitions.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/competitions
router.get('/', async (req, res, next) => {
  try {
    const { sport, category, gender, year } = req.query;
    const params = [sport, category, gender].filter(Boolean);
    const yearIdx = params.length + 1;

    const rows = await queryAll(`
      SELECT
        c.id,
        c.name,
        c.slug,
        c.logo_url,
        c.bg_image_url,
        c.city,
        c.surface,
        c.gender,
        c.competition_type,
        c.organiser,
        c.website,
        c.founded_year,
        c.first_data_year,
        c.valid_from,
        c.valid_to,
        c.display_order,
        c.column_config,
        c.primary_color,
        c.secondary_color,
        c.third_color,
        c.cancelled_years,
        c.cancelled_editions,
        c.year_convention,
        ec.id             AS category_id,
        ec.canonical_name AS category_name,
        ec.short_name     AS category_short,
        ec.slug           AS category_slug,
        ec.level,
        ec.localisation,
        s.id              AS sport_id,
        s.name            AS sport_name,
        s.slug            AS sport_slug,
        s.display_pattern,
        co.iso2           AS country_iso2,
        co.name           AS country_name
      FROM competitions c
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN sports s ON s.id = ec.sport_id
      LEFT JOIN countries co ON co.id = c.country_id
      WHERE s.is_active = TRUE
        AND (c.is_active = TRUE OR c.valid_to IS NOT NULL)
        ${sport    ? 'AND s.slug = $1'    : ''}
        ${category ? `AND ec.slug = $${sport ? 2 : 1}` : ''}
        ${gender   ? `AND (c.gender = $${[sport,category].filter(Boolean).length + 1} OR c.gender = 'X')` : ''}
        ${year     ? `AND (c.valid_from IS NULL OR c.valid_from <= $${yearIdx})` : ''}
        ${year     ? `AND (c.valid_to   IS NULL OR c.valid_to   >= $${yearIdx})` : ''}
      ORDER BY ec.display_order, c.display_order
    `, year ? [...params, parseInt(year)] : params);

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug
router.get('/:slug', async (req, res, next) => {
  try {
    const competition = await queryOne(`
      SELECT
        c.id,
        c.name,
        c.slug,
        c.logo_url,
        c.bg_image_url,
        c.city,
        c.surface,
        c.gender,
        c.competition_type,
        c.edition_years,
        c.organiser,
        c.owner,
        c.website,
        c.founded_year,
        c.dissolved_year,
        c.first_data_year,
        c.valid_from,
        c.valid_to,
        c.column_config,
        c.primary_color,
        c.secondary_color,
        c.third_color,
        c.cancelled_years,
        c.cancelled_editions,
        c.year_convention,
        ec.id             AS category_id,
        ec.canonical_name AS category_name,
        ec.short_name     AS category_short,
        ec.slug           AS category_slug,
        ec.level,
        ec.localisation,
        ec.confederation,
        s.id              AS sport_id,
        s.name            AS sport_name,
        s.slug            AS sport_slug,
        s.display_pattern,
        co.iso2           AS country_iso2,
        co.name           AS country_name
      FROM competitions c
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN sports s ON s.id = ec.sport_id
      LEFT JOIN countries co ON co.id = c.country_id
      WHERE c.slug = $1 AND (c.is_active = TRUE OR c.valid_to IS NOT NULL)
    `, [req.params.slug]);

    if (!competition) {
      return res.status(404).json({ error: 'Competition not found' });
    }

    const events = await queryAll(`
      SELECT e.id, e.name, e.slug, e.display_order,
        EXISTS (
          SELECT 1 FROM seasons s
          JOIN result_tabs rt ON rt.season_id = s.id
          WHERE s.event_id = e.id AND rt.typology = 'iconic_moments'
        ) AS is_gallery
      FROM events e
      WHERE e.competition_id = $1 AND e.is_active = TRUE
      ORDER BY e.display_order
    `, [competition.id]);

    const years = await queryAll(`
      SELECT DISTINCT year, status
      FROM seasons
      WHERE competition_id = $1
      ORDER BY year DESC
    `, [competition.id]);

    const naming = await queryOne(`
      SELECT official_name, title_sponsor, partner, prize_money
      FROM competition_naming
      WHERE competition_id = $1
        AND (end_year IS NULL OR end_year >= EXTRACT(YEAR FROM NOW()))
      ORDER BY start_year DESC
      LIMIT 1
    `, [competition.id]);

    res.json({
      data: {
        ...competition,
        current_naming: naming,
        events,
        available_years: years,
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/logo/:year
router.get('/:slug/logo/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;

    const override = await queryOne(`
      SELECT cl.logo_url
      FROM competition_logos cl
      JOIN competitions c ON c.id = cl.competition_id
      WHERE c.slug = $1
        AND cl.start_year <= $2
        AND (cl.end_year IS NULL OR cl.end_year >= $2)
      ORDER BY cl.start_year DESC
      LIMIT 1
    `, [slug, parseInt(year)]);

    if (override) {
      return res.json({ data: { logo_url: override.logo_url, source: 'era_override' } });
    }

    const comp = await queryOne(`SELECT logo_url FROM competitions WHERE slug = $1`, [slug]);
    res.json({ data: { logo_url: comp?.logo_url ?? null, source: 'default' } });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/events/:year
// Year-scoped variant of the plain :slug events list. Most Line A events are
// always shown regardless of data (Awards/End of Season Teams show even
// uningested) — two exceptions:
//   1. Any event whose season carries an 'iconic_moments' result_tab
//      (currently just NBA's Iconic Moments event): gated on actual video
//      content existing for the requested year, so the button only appears
//      once a video has been added for that season. Detected generically
//      via typology rather than by name/slug, so any future sport reusing
//      this event-per-gallery pattern gets the same behavior for free.
//   2. NBA's Play-in event (slug 'play-in-4828'): didn't exist before the
//      2019-20 bubble season — gated on at least one game existing for the
//      requested year's Play-in season. This is the route that actually
//      drives the Line A nav bar (the /api/seasons route drives the page
//      content below it and needed the identical, independent fix).
//   3. NBA's Cup event (slug 'nba-cup-4828'): started in 2023-24 — gated
//      on at least one game OR standings row existing for the requested
//      year (its tabs mix typology='game' and typology='standings').
router.get('/:slug/events/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;

    const comp = await queryOne(`SELECT id, year_convention FROM competitions WHERE slug = $1`, [slug]);
    if (!comp) return res.status(404).json({ error: 'Competition not found' });

    const yearInt = parseInt(year);
    const dbYear = comp.year_convention === 'start' ? yearInt - 1 : yearInt;

    const events = await queryAll(`
      SELECT e.id, e.name, e.slug, e.display_order,
        EXISTS (
          SELECT 1 FROM seasons s
          JOIN result_tabs rt ON rt.season_id = s.id
          WHERE s.event_id = e.id AND rt.typology = 'iconic_moments'
        ) AS is_gallery
      FROM events e
      WHERE e.competition_id = $1 AND e.is_active = TRUE
        AND (
          NOT EXISTS (
            SELECT 1 FROM seasons s
            JOIN result_tabs rt ON rt.season_id = s.id
            WHERE s.event_id = e.id AND rt.typology = 'iconic_moments'
          )
          OR EXISTS (
            SELECT 1 FROM seasons s
            JOIN result_tabs rt ON rt.season_id = s.id
            JOIN media m ON m.season_id = s.id AND m.media_type = 'iconic_moment' AND m.is_active = TRUE
            WHERE s.event_id = e.id AND rt.typology = 'iconic_moments' AND s.year = $2
          )
        )
        AND (
          e.slug != 'play-in-4828'
          OR EXISTS (
            SELECT 1 FROM seasons s
            JOIN result_tabs rt ON rt.season_id = s.id
            JOIN games g ON g.result_tab_id = rt.id
            WHERE s.event_id = e.id AND s.year = $2
          )
        )
        AND (
          e.slug != 'nba-cup-4828'
          OR EXISTS (
            SELECT 1 FROM seasons s
            JOIN result_tabs rt ON rt.season_id = s.id
            WHERE s.event_id = e.id AND s.year = $2
              AND (
                EXISTS (SELECT 1 FROM games g WHERE g.result_tab_id = rt.id)
                OR EXISTS (SELECT 1 FROM standings st WHERE st.result_tab_id = rt.id)
              )
          )
        )
      ORDER BY e.display_order
    `, [comp.id, dbYear]);

    res.json({ data: events });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/naming/:year
router.get('/:slug/naming/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;

    const naming = await queryOne(`
      SELECT cn.official_name, cn.title_sponsor, cn.partner, cn.prize_money,
             cn.start_year, cn.end_year
      FROM competition_naming cn
      JOIN competitions c ON c.id = cn.competition_id
      WHERE c.slug = $1
        AND cn.start_year <= $2
        AND (cn.end_year IS NULL OR cn.end_year >= $2)
      ORDER BY cn.start_year DESC
      LIMIT 1
    `, [slug, parseInt(year)]);

    res.json({ data: naming });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/event-naming/:year
router.get('/:slug/event-naming/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;
    const naming = await queryOne(`
      SELECT en.official_name, en.short_name, en.start_year, en.end_year
      FROM event_naming en
      JOIN competitions c ON c.id = en.competition_id
      WHERE c.slug = $1
        AND en.start_year <= $2
        AND (en.end_year IS NULL OR en.end_year >= $2)
      ORDER BY en.start_year DESC
      LIMIT 1
    `, [slug, parseInt(year)]);
    res.json({ data: naming });
  } catch (err) {
    next(err);
  }
});

// PUT /api/competitions/:id
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const {
      logo_url,
      primary_color,
      secondary_color,
      third_color,
      surface,
      founding_year,
      cancelled_editions,  // [{year, reason}]
    } = req.body;

    const cancelledYears = Array.isArray(cancelled_editions)
      ? cancelled_editions.map(e => e.year)
      : [];

    const row = await queryOne(`
      UPDATE competitions SET
        logo_url           = COALESCE($1, logo_url),
        primary_color      = COALESCE($2, primary_color),
        secondary_color    = COALESCE($3, secondary_color),
        third_color        = COALESCE($4, third_color),
        surface            = COALESCE($5, surface),
        founded_year       = COALESCE($6, founded_year),
        cancelled_editions = $7::jsonb,
        cancelled_years    = $8
      WHERE id = $9
      RETURNING
        id, name, slug, logo_url,
        primary_color, secondary_color, third_color,
        surface, founded_year,
        cancelled_years, cancelled_editions
    `, [
      logo_url        ?? null,
      primary_color   ?? null,
      secondary_color ?? null,
      third_color     ?? null,
      surface         ?? null,
      founding_year   ? parseInt(founding_year) : null,
      JSON.stringify(cancelled_editions ?? []),
      cancelledYears,
      id,
    ]);

    if (!row) return res.status(404).json({ error: 'Competition not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

module.exports = router;