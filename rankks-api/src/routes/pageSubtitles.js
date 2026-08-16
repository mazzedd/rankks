// src/routes/pageSubtitles.js
const express = require('express');
const router  = express.Router();
const { queryOne } = require('../db');

// GET /api/page-subtitles/resolve?sport_slug=tennis&tour=atp&page_key=tennis-totals-tournaments
// Returns the admin-configured subtitle text for one specific Totals-style
// Line B item (e.g. Tournament Stats vs Player Stats each get their own
// text — 2026-08-10: previously shared across both, which was wrong), or
// null if nothing's configured — callers render nothing in that case
// rather than a placeholder. tour and page_key are both optional; an exact
// match on either wins over that dimension's shared '' fallback row (a
// sport with no tours, or a subtitle meant for every Line B item at once,
// just uses '' for that column). page_key exactness is weighted above tour
// exactness — matching a Line B item correctly matters more than matching
// the tour. Keyed by sport, not hardcoded to tennis, so a future sport's
// own Totals-style page reuses this with zero backend changes.
router.get('/resolve', async (req, res, next) => {
  try {
    const { sport_slug, tour, page_key } = req.query;
    if (!sport_slug) return res.status(400).json({ error: 'sport_slug is required' });

    const t = tour || '';
    const pk = page_key || '';

    const row = await queryOne(`
      SELECT ps.subtitle_text
      FROM page_subtitles ps
      JOIN sports s ON s.id = ps.sport_id
      WHERE s.slug = $1 AND ps.tour = ANY($2::text[]) AND ps.page_key = ANY($3::text[])
      ORDER BY (ps.page_key = $4) DESC, (ps.tour = $5) DESC
      LIMIT 1
    `, [sport_slug, [t, ''], [pk, ''], pk, t]);

    res.json({ data: { subtitle_text: row?.subtitle_text || null } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
