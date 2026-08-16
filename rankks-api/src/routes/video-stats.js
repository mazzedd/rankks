// src/routes/video-stats.js
// Shared views/favourited stats for the 3 "Watch" video tables — game
// result videos, not Iconic Moments (a different, competition/season-tied
// feature backed by its own tables, out of scope here). Public read/write:
// view counts include unregistered users, so no auth on either route.
const express = require('express');
const router  = express.Router();
const { queryOne } = require('../db');

// Maps the public videoType (also the entity_type used in user_favourites —
// see favourites.js) to its backing table. Table names are never taken
// from user input directly — only ever this whitelisted literal.
const VIDEO_TYPES = {
  media:              'media',
  f1_race_video:       'f1_race_videos',
  motogp_race_video:   'motogp_race_videos',
};

// GET /api/video-stats/:videoType/:id
router.get('/:videoType/:id', async (req, res, next) => {
  try {
    const table = VIDEO_TYPES[req.params.videoType];
    const id = parseInt(req.params.id);
    if (!table) return res.status(400).json({ error: `videoType must be one of: ${Object.keys(VIDEO_TYPES).join(', ')}` });
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be an integer' });

    const video = await queryOne(`SELECT view_count FROM ${table} WHERE id = $1`, [id]);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    const fav = await queryOne(`
      SELECT count(*) FROM user_favourites WHERE entity_type = $1 AND entity_id = $2
    `, [req.params.videoType, id]);

    res.json({ data: { views: video.view_count, favourited: parseInt(fav.count) } });
  } catch (err) { next(err); }
});

// POST /api/video-stats/:videoType/:id/view — increments and returns the
// new count. Called once per drawer-open (see MatchVideo.jsx), not
// deduplicated by session/IP — a simple raw counter, same as the "views"
// figure on any public video page.
router.post('/:videoType/:id/view', async (req, res, next) => {
  try {
    const table = VIDEO_TYPES[req.params.videoType];
    const id = parseInt(req.params.id);
    if (!table) return res.status(400).json({ error: `videoType must be one of: ${Object.keys(VIDEO_TYPES).join(', ')}` });
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be an integer' });

    const video = await queryOne(`
      UPDATE ${table} SET view_count = view_count + 1 WHERE id = $1 RETURNING view_count
    `, [id]);
    if (!video) return res.status(404).json({ error: 'Video not found' });

    res.json({ data: { views: video.view_count } });
  } catch (err) { next(err); }
});

module.exports = router;
