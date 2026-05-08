// src/routes/analytics.js
const express = require('express');
const router  = express.Router();
const { query } = require('../db');

// POST /api/analytics/event
router.post('/event', async (req, res, next) => {
  try {
    const {
      session_id, event_type, sport_id, competition_id,
      season_id, year, tab_key, duration_ms, metadata,
      country_code, device_type
    } = req.body;

    if (!session_id || !event_type) {
      return res.status(400).json({ error: 'session_id and event_type are required' });
    }

    await query(`
      INSERT INTO analytics_events
        (session_id, event_type, sport_id, competition_id, season_id,
         year, tab_key, duration_ms, metadata, country_code, device_type)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      session_id, event_type,
      sport_id     || null,
      competition_id || null,
      season_id    || null,
      year         || null,
      tab_key      || null,
      duration_ms  || null,
      JSON.stringify(metadata || {}),
      country_code || null,
      device_type  || null,
    ]);

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
