const express = require('express');
const router  = express.Router();
const { queryOne } = require('../db');

// GET /api/followers?entity_type=competition&entity_id=1
// Public follower count for anything favouritable at the "league" level
// (competitions, tour entities like ATP/WTA). total = real user_favourites
// rows + the admin-set base_count from follower_overrides (see admin.js's
// /admin/followers/leagues, which manages that base_count).
router.get('/', async (req, res, next) => {
  try {
    const { entity_type, entity_id } = req.query;
    const entityId = parseInt(entity_id);
    if (!entity_type || !Number.isInteger(entityId)) {
      return res.status(400).json({ error: 'entity_type and entity_id (integer) are required' });
    }

    const { count: realCount } = await queryOne(`
      SELECT count(*) FROM user_favourites WHERE entity_type = $1 AND entity_id = $2
    `, [entity_type, entityId]);

    const override = await queryOne(`
      SELECT base_count FROM follower_overrides WHERE entity_type = $1 AND entity_id = $2
    `, [entity_type, entityId]);

    const real = parseInt(realCount);
    const base = override ? override.base_count : 0;

    res.json({ data: { entity_type, entity_id: entityId, total: real + base } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
