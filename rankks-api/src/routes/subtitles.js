// subtitles.js — public read endpoint for client-fetched pages (the
// All-Time templates, tennis Totals templates, etc. that resolve their own
// subtitle client-side rather than through results.js). Server-rendered
// pages (standings/games) call resolveSubtitle() directly instead.
//
// Accepts slugs, not raw ids — every existing frontend call site already
// has sport_slug/competition_slug on hand.
const express = require('express');
const router = express.Router();
const { queryOne } = require('../db');
const { resolveSubtitle } = require('./subtitle-resolver');

// GET /resolve?sport_slug=X&competition_slug=Y&item_a=A&item_b=B&year=2026&is_past=true
router.get('/resolve', async (req, res, next) => {
  try {
    const { sport_slug, competition_slug, item_a, item_b, year, is_past } = req.query;
    if (!item_a || !year) {
      return res.status(400).json({ error: 'item_a and year are required' });
    }

    let sportId = null, competitionId = null;
    if (sport_slug) {
      const sport = await queryOne('SELECT id FROM sports WHERE slug = $1', [sport_slug]);
      sportId = sport?.id || null;
    }
    if (competition_slug) {
      const comp = await queryOne('SELECT id FROM competitions WHERE slug = $1', [competition_slug]);
      competitionId = comp?.id || null;
    }

    const subtitle = await resolveSubtitle({
      sportId,
      competitionId,
      candidates: [{ itemA: item_a, itemB: item_b || null }],
      year: parseInt(year),
      isPast: is_past === undefined ? undefined : is_past === 'true',
    });

    res.json({ data: { subtitle } });
  } catch (err) { next(err); }
});

module.exports = router;
