const express = require('express');
const router  = express.Router();
const { queryAll } = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const { seasonId, round, matchday, type } = req.query;
    if (!seasonId) return res.status(400).json({ error: 'seasonId is required' });

    const params = [seasonId];
    const filters = [];
    if (round)    { params.push(round);              filters.push(`m.round = $${params.length}`); }
    if (matchday) { params.push(parseInt(matchday)); filters.push(`m.matchday = $${params.length}`); }
    if (type)     { params.push(type);               filters.push(`m.media_type = $${params.length}`); }

    const media = await queryAll(`
      SELECT id, media_type, title, video_url, youtube_id,
             thumbnail_url, duration_seconds, source,
             round, matchday, display_order
      FROM media m
      WHERE m.season_id = $1 AND m.is_active = TRUE
      ${filters.length ? 'AND ' + filters.join(' AND ') : ''}
      ORDER BY m.display_order, m.id
    `, params);

    res.json({ data: media });
  } catch (err) { next(err); }
});

module.exports = router;