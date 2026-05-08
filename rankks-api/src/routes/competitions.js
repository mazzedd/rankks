// src/routes/competitions.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/competitions
// Returns all competitions, optionally filtered by sport or category
router.get('/', async (req, res, next) => {
  try {
    const { sport, category, gender } = req.query;

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
        c.display_order,
        c.column_config,
        ec.id           AS category_id,
        ec.canonical_name AS category_name,
        ec.short_name   AS category_short,
        ec.slug         AS category_slug,
        ec.level,
        s.id            AS sport_id,
        s.name          AS sport_name,
        s.slug          AS sport_slug,
        s.display_pattern,
        co.iso2         AS country_iso2,
        co.name         AS country_name
      FROM competitions c
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN sports s ON s.id = ec.sport_id
      LEFT JOIN countries co ON co.id = c.country_id
      WHERE c.is_active = TRUE
        AND s.is_active = TRUE
        ${sport    ? 'AND s.slug = $1'    : ''}
        ${category ? `AND ec.slug = $${sport ? 2 : 1}` : ''}
        ${gender   ? `AND (c.gender = $${[sport,category].filter(Boolean).length + 1} OR c.gender = 'X')` : ''}
      ORDER BY ec.display_order, c.display_order
    `, [sport, category, gender].filter(Boolean));

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug
// Returns full competition detail with events (Line A) and available years
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
        c.column_config,
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
      WHERE c.slug = $1 AND c.is_active = TRUE
    `, [req.params.slug]);

    if (!competition) {
      return res.status(404).json({ error: 'Competition not found' });
    }

    // Get sub-events (Line A — for A+B pattern sports)
    const events = await queryAll(`
      SELECT id, name, slug, display_order
      FROM events
      WHERE competition_id = $1 AND is_active = TRUE
      ORDER BY display_order
    `, [competition.id]);

    // Get available years (from seasons table)
    const years = await queryAll(`
      SELECT DISTINCT year, status
      FROM seasons
      WHERE competition_id = $1
      ORDER BY year DESC
    `, [competition.id]);

    // Get current naming (title sponsor, official name)
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

// GET /api/competitions/:slug/naming/:year
// Returns the official name and sponsor for a specific year
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

module.exports = router;
