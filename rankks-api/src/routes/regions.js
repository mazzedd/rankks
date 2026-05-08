// src/routes/regions.js
const express = require('express');
const router  = express.Router();
const { queryOne, queryAll } = require('../db');

// GET /api/regions?country=FR
router.get('/', async (req, res, next) => {
  try {
    const { country } = req.query;
    let profile = null;

    if (country) {
      profile = await queryOne(`
        SELECT id, region_name, shortcuts, country_codes
        FROM region_profiles
        WHERE $1 = ANY(country_codes)
        LIMIT 1
      `, [country.toUpperCase()]);
    }

    if (!profile) {
      profile = await queryOne(`
        SELECT id, region_name, shortcuts, country_codes
        FROM region_profiles
        WHERE is_default = TRUE
        LIMIT 1
      `, []);
    }

    res.json({ data: profile });
  } catch (err) {
    next(err);
  }
});

// GET /api/regions/all
router.get('/all', async (req, res, next) => {
  try {
    const profiles = await queryAll(`
      SELECT id, region_name, country_codes, shortcuts, is_default, display_order
      FROM region_profiles
      ORDER BY display_order
    `, []);
    res.json({ data: profiles });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
