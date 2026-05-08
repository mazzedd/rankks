// src/routes/entities.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/entities/search?q=federer&type=player
router.get('/search', async (req, res, next) => {
  try {
    const { q, type, limit = 10 } = req.query;
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const params = [`%${q}%`, parseInt(limit)];
    const typeFilter = type ? `AND e.entity_type = $3` : '';
    if (type) params.push(type);

    // Search canonical names and aliases
    const results = await queryAll(`
      SELECT DISTINCT
        e.id, e.canonical_name, e.slug, e.entity_type, e.image_url,
        co.iso2 AS country_iso2, co.name AS country_name
      FROM entities e
      LEFT JOIN countries co ON co.id = e.country_id
      WHERE (
        e.canonical_name ILIKE $1
        OR EXISTS (
          SELECT 1 FROM entity_aliases ea
          WHERE ea.entity_id = e.id AND ea.alias ILIKE $1
        )
      )
      AND e.is_active = TRUE
      ${typeFilter}
      ORDER BY e.canonical_name
      LIMIT $2
    `, params);

    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

// GET /api/entities/:slug
router.get('/:slug', async (req, res, next) => {
  try {
    const entity = await queryOne(`
      SELECT e.*, co.iso2 AS country_iso2, co.name AS country_name
      FROM entities e
      LEFT JOIN countries co ON co.id = e.country_id
      WHERE e.slug = $1 AND e.is_active = TRUE
    `, [req.params.slug]);

    if (!entity) return res.status(404).json({ error: 'Entity not found' });

    // Get partnerships
    const partnerships = await queryAll(`
      SELECT partner_type, partner_name, start_year, end_year
      FROM entity_partnerships
      WHERE entity_id = $1
      ORDER BY start_year
    `, [entity.id]);

    // Get KPI cache (titles, participations etc.)
    const kpis = await queryAll(`
      SELECT metric_key, metric_value, metric_text
      FROM kpi_cache
      WHERE entity_id = $1
    `, [entity.id]);

    res.json({ data: { ...entity, partnerships, kpis } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
