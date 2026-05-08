// src/routes/sports.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/sports
// Returns all active sports with their event categories
router.get('/', async (req, res, next) => {
  try {
    const sports = await queryAll(`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.display_pattern,
        s.icon_url,
        s.display_order,
        COALESCE(
          json_agg(
            json_build_object(
              'id',           ec.id,
              'canonical_name', ec.canonical_name,
              'short_name',   ec.short_name,
              'slug',         ec.slug,
              'level',        ec.level,
              'gender',       ec.gender,
              'localisation', ec.localisation,
              'confederation',ec.confederation,
              'display_order',ec.display_order
            ) ORDER BY ec.display_order
          ) FILTER (WHERE ec.id IS NOT NULL),
          '[]'
        ) AS categories
      FROM sports s
      LEFT JOIN event_categories ec ON ec.sport_id = s.id
      WHERE s.is_active = TRUE
      GROUP BY s.id
      ORDER BY s.display_order
    `);

    res.json({ data: sports });
  } catch (err) {
    next(err);
  }
});

// GET /api/sports/:slug
// Returns a single sport with full category and competition tree
router.get('/:slug', async (req, res, next) => {
  try {
    const sport = await queryOne(`
      SELECT id, name, slug, display_pattern, icon_url
      FROM sports
      WHERE slug = $1 AND is_active = TRUE
    `, [req.params.slug]);

    if (!sport) {
      return res.status(404).json({ error: 'Sport not found' });
    }

    // Get categories with competitions
    const categories = await queryAll(`
      SELECT
        ec.id,
        ec.canonical_name,
        ec.short_name,
        ec.slug,
        ec.level,
        ec.gender,
        ec.localisation,
        ec.confederation,
        ec.display_order,
        COALESCE(
          json_agg(
            json_build_object(
              'id',           c.id,
              'name',         c.name,
              'slug',         c.slug,
              'logo_url',     c.logo_url,
              'surface',      c.surface,
              'gender',       c.gender,
              'display_order',c.display_order,
              'founded_year', c.founded_year,
              'first_data_year', c.first_data_year
            ) ORDER BY c.display_order
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'
        ) AS competitions
      FROM event_categories ec
      LEFT JOIN competitions c ON c.category_id = ec.id AND c.is_active = TRUE
      WHERE ec.sport_id = $1
      GROUP BY ec.id
      ORDER BY ec.display_order
    `, [sport.id]);

    res.json({ data: { ...sport, categories } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
