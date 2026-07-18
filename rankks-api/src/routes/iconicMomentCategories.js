// src/routes/iconicMomentCategories.js
const express = require('express');
const router  = express.Router();
const { queryAll } = require('../db');

// GET /api/iconic-moment-categories?sport_slug=football
// Returns the admin-managed category list for one sport, used to populate
// the Category dropdown in the Iconic Moments editor. One row set per
// sport — football, tennis, and any future sport each define their own
// taxonomy here instead of a hardcoded frontend list.
router.get('/', async (req, res, next) => {
  try {
    const { sport_slug } = req.query;

    if (!sport_slug) {
      return res.status(400).json({ error: 'sport_slug is required' });
    }

    const categories = await queryAll(`
      SELECT imc.value, imc.label, imc.display_order
      FROM iconic_moment_categories imc
      JOIN sports s ON s.id = imc.sport_id
      WHERE s.slug = $1
      ORDER BY imc.display_order
    `, [sport_slug]);

    res.json({ data: categories });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
