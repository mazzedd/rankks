// src/routes/entities.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/entities/search?q=federer&type=player&gender=M
router.get('/search', async (req, res, next) => {
  try {
    const { q, type, gender, limit = 10 } = req.query;
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const params = [`%${q}%`, parseInt(limit)];
    let extraFilter = '';
    if (type) { params.push(type); extraFilter += ` AND e.entity_type = $${params.length}`; }
    if (gender) { params.push(gender); extraFilter += ` AND e.gender = $${params.length}`; }

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
      ${extraFilter}
      ORDER BY e.canonical_name
      LIMIT $2
    `, params);

    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

// GET /api/entities/:slug/logo/:year — era-resolved logo, same pattern as
// /api/competitions/:slug/logo/:year (see that route's comment). Used by
// the tennis Home hub banner (ATP/WTA entity rows, entity_type='tour')
// instead of a hardcoded shortcut icon.
router.get('/:slug/logo/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;

    const override = await queryOne(`
      SELECT el.logo_url
      FROM entity_logos el
      JOIN entities e ON e.id = el.entity_id
      WHERE e.slug = $1
        AND el.start_year <= $2
        AND (el.end_year IS NULL OR el.end_year >= $2)
      ORDER BY el.start_year DESC
      LIMIT 1
    `, [slug, parseInt(year)]);

    if (override) {
      return res.json({ data: { logo_url: override.logo_url, source: 'era_override' } });
    }

    const entity = await queryOne(`SELECT image_url FROM entities WHERE slug = $1`, [slug]);
    res.json({ data: { logo_url: entity?.image_url ?? null, source: 'default' } });
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
      SELECT p.name AS partner_name, p.logo_url AS partner_logo_url,
        pt.slug AS tier_slug, pt.name AS tier_name,
        ps.start_year, ps.end_year, ps.displayed_in_name
      FROM partnerships ps
      JOIN partners p ON p.id = ps.partner_id
      JOIN partnership_tiers pt ON pt.id = ps.tier_id
      WHERE ps.subject_type = 'entity' AND ps.entity_id = $1
      ORDER BY ps.start_year
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
