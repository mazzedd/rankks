const express  = require('express');
const router   = express.Router();
const { queryAll, queryOne } = require('../db');
const userAuth = require('../middleware/userAuth');
const { FAVOURITE_CAPS } = require('../config/favouriteCaps');

// f1_race_video/motogp_race_video are the F1/MotoGP equivalent of 'media'
// (a race-weekend "Watch" video, not an Iconic Moment — those are a
// separate, competition/season-tied feature with their own tables and no
// favouriting) — kept as their own entity_type rather than reusing 'media'
// since f1_race_videos.id/motogp_race_videos.id are independent PK spaces
// that would otherwise collide with media.id under the same entity_type.
const VALID_TYPES = ['sport', 'competition', 'club', 'athlete', 'media', 'f1_race_video', 'motogp_race_video'];

router.use(userAuth);

// GET /api/favourites — grouped by entity_type, scoped to the authenticated user
router.get('/', async (req, res, next) => {
  try {
    const rows = await queryAll(`
      SELECT
        f.id, f.entity_type, f.entity_id, f.display_order, f.created_at,
        CASE f.entity_type
          WHEN 'competition'      THEN c.name
          WHEN 'sport'             THEN s.name
          WHEN 'media'             THEN m.title
          WHEN 'f1_race_video'     THEN f1gp.name
          WHEN 'motogp_race_video' THEN mgp.name
          ELSE e.canonical_name
        END AS name,
        CASE f.entity_type
          WHEN 'competition'      THEN c.slug
          WHEN 'sport'             THEN s.slug
          WHEN 'f1_race_video'     THEN f1gp.slug
          WHEN 'motogp_race_video' THEN mgp.slug
          ELSE e.slug
        END AS slug,
        CASE WHEN f.entity_type IN ('athlete', 'club') THEN e.entity_type END AS sub_type,
        CASE f.entity_type
          WHEN 'competition'      THEN c.logo_url
          WHEN 'sport'             THEN s.icon_url
          WHEN 'media'             THEN m.thumbnail_url
          WHEN 'f1_race_video'     THEN frv.thumbnail_url
          WHEN 'motogp_race_video' THEN mrv.thumbnail_url
          ELSE e.image_url
        END AS image_url,
        CASE WHEN f.entity_type = 'competition' THEN comp_sport.slug END AS sport_slug,
        CASE WHEN f.entity_type = 'competition' THEN comp_cat.slug END AS category_slug,
        m.video_url, m.youtube_id
      FROM user_favourites f
      LEFT JOIN competitions c            ON f.entity_type = 'competition' AND c.id = f.entity_id
      LEFT JOIN event_categories comp_cat ON f.entity_type = 'competition' AND comp_cat.id = c.category_id
      LEFT JOIN sports comp_sport         ON f.entity_type = 'competition' AND comp_sport.id = comp_cat.sport_id
      LEFT JOIN sports s       ON f.entity_type = 'sport'       AND s.id = f.entity_id
      LEFT JOIN entities e     ON f.entity_type IN ('athlete', 'club') AND e.id = f.entity_id
      LEFT JOIN media m        ON f.entity_type = 'media'       AND m.id = f.entity_id
      LEFT JOIN f1_race_videos frv     ON f.entity_type = 'f1_race_video'     AND frv.id = f.entity_id
      LEFT JOIN f1_grands_prix f1gp    ON f1gp.id = frv.grand_prix_id
      LEFT JOIN motogp_race_videos mrv ON f.entity_type = 'motogp_race_video' AND mrv.id = f.entity_id
      LEFT JOIN motogp_grands_prix mgp ON mgp.id = mrv.grand_prix_id
      WHERE f.user_id = $1
      ORDER BY f.entity_type, f.display_order, f.created_at
    `, [req.user.id]);

    const grouped = { sport: [], competition: [], club: [], athlete: [], media: [], f1_race_video: [], motogp_race_video: [] };
    for (const row of rows) grouped[row.entity_type].push(row);

    res.json({ data: grouped });
  } catch (err) {
    next(err);
  }
});

// POST /api/favourites — body: { entity_type, entity_id }
router.post('/', async (req, res, next) => {
  try {
    const { entity_type, entity_id } = req.body;

    if (!VALID_TYPES.includes(entity_type)) {
      return res.status(400).json({ error: `entity_type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!Number.isInteger(entity_id)) {
      return res.status(400).json({ error: 'entity_id is required and must be an integer' });
    }

    // Idempotent: already-favourited is a no-op success, not a cap violation.
    const existing = await queryOne(`
      SELECT id, entity_type, entity_id, display_order, created_at
      FROM user_favourites WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
    `, [req.user.id, entity_type, entity_id]);
    if (existing) {
      return res.json({ data: existing });
    }

    const user = await queryOne(`SELECT subscription_tier FROM users WHERE id = $1`, [req.user.id]);
    if (user.subscription_tier === 'free') {
      const capCheck = await getCapCheck(entity_type, req.user.id);
      if (capCheck && capCheck.count >= capCheck.cap) {
        return res.status(409).json({
          error: 'FAVOURITE_CAP_REACHED',
          cap_type: capCheck.capType,
          cap: capCheck.cap,
          message: `You've reached the ${capCheck.cap} ${capCheck.label} favourites limit on the free plan. Upgrade to add more.`,
        });
      }
    }

    const favourite = await queryOne(`
      INSERT INTO user_favourites (user_id, entity_type, entity_id)
      VALUES ($1, $2, $3)
      RETURNING id, entity_type, entity_id, display_order, created_at
    `, [req.user.id, entity_type, entity_id]);

    res.status(201).json({ data: favourite });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/favourites/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await queryOne(`
      DELETE FROM user_favourites WHERE id = $1 AND user_id = $2 RETURNING id
    `, [req.params.id, req.user.id]);

    if (!deleted) return res.status(404).json({ error: 'Favourite not found' });
    res.json({ data: { id: deleted.id } });
  } catch (err) {
    next(err);
  }
});

async function getCapCheck(entity_type, userId) {
  if (entity_type === 'competition') {
    const { count } = await queryOne(`
      SELECT count(*) FROM user_favourites WHERE user_id = $1 AND entity_type = 'competition'
    `, [userId]);
    return { count: parseInt(count), cap: FAVOURITE_CAPS.competition, capType: 'competition', label: 'competition' };
  }
  if (entity_type === 'athlete' || entity_type === 'club') {
    const { count } = await queryOne(`
      SELECT count(*) FROM user_favourites WHERE user_id = $1 AND entity_type IN ('athlete', 'club')
    `, [userId]);
    return { count: parseInt(count), cap: FAVOURITE_CAPS.athleteClub, capType: 'athlete_club', label: 'athlete/club' };
  }
  if (entity_type === 'media' || entity_type === 'f1_race_video' || entity_type === 'motogp_race_video') {
    // All three are "Watch" game/race videos (Iconic Moments don't have a
    // favourite feature) — one shared cap across the group, same as
    // athlete/club sharing one combined pool above.
    const { count } = await queryOne(`
      SELECT count(*) FROM user_favourites
      WHERE user_id = $1 AND entity_type IN ('media', 'f1_race_video', 'motogp_race_video')
    `, [userId]);
    return { count: parseInt(count), cap: FAVOURITE_CAPS.media, capType: 'media', label: 'saved video' };
  }
  return null; // 'sport' — uncapped
}

module.exports = router;
