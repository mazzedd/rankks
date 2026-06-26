const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();
const db      = require('../db');
const auth    = require('../middleware/auth');

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USERNAME;
  const validPass = process.env.ADMIN_PASSWORD;
  if (!validUser || !validPass) return res.status(500).json({ error: 'Admin credentials not configured' });
  if (username !== validUser || password !== validPass) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username }, process.env.ADMIN_JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username });
});

// ── Competitions ──────────────────────────────────────────────────────────────

router.get('/competitions', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        c.id,
        c.slug,
        c.name,
        c.surface,
        c.primary_color,
        c.secondary_color,
        c.third_color,
        c.founding_year,
        c.cancelled_years,
        c.logo_url,
        ec.canonical_name AS category_name,
        s.name            AS sport_name
      FROM competitions c
      LEFT JOIN event_categories ec ON ec.id = c.category_id
      LEFT JOIN sports s            ON s.id  = ec.sport_id
      ORDER BY s.name, c.name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin competitions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/competitions/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { primary_color, secondary_color, third_color, surface, founding_year, cancelled_years, logo_url } = req.body;
  const validSurfaces = ['grass', 'clay', 'hard', null, ''];
  if (surface !== undefined && !validSurfaces.includes(surface?.toLowerCase())) {
    return res.status(400).json({ error: 'Invalid surface value' });
  }
  try {
    const { rows } = await db.query(`
      UPDATE competitions
      SET
        primary_color   = $1,
        secondary_color = $2,
        third_color     = $3,
        surface         = NULLIF($4, ''),
        founding_year   = $5,
        cancelled_years = $6,
        logo_url        = $7,
        updated_at      = NOW()
      WHERE id = $8
      RETURNING id, slug, primary_color, secondary_color, third_color, surface, founding_year, cancelled_years, logo_url
    `, [primary_color, secondary_color, third_color, surface, founding_year || null, cancelled_years || [], logo_url ?? null, id]);
    if (!rows.length) return res.status(404).json({ error: 'Competition not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin update competition error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Seasons (start/end date editing) ─────────────────────────────────────────

router.get('/seasons', auth, async (req, res) => {
  const { competition_id, year } = req.query;
  if (!competition_id) return res.status(400).json({ error: 'competition_id required' });
  try {
    const params = [competition_id];
    let extra = '';
    if (year) { params.push(year); extra = `AND s.year = $${params.length}`; }
    const { rows } = await db.query(`
      SELECT id, year, gender, start_date, end_date, status, edition_number
      FROM seasons
      WHERE competition_id = $1 ${extra}
      ORDER BY year, gender
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('Admin seasons error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/seasons/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { start_date, end_date } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE seasons
      SET start_date = $1, end_date = $2, updated_at = NOW()
      WHERE id = $3
      RETURNING id, year, gender, start_date, end_date
    `, [start_date || null, end_date || null, id]);
    if (!rows.length) return res.status(404).json({ error: 'Season not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin update season error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Entities ──────────────────────────────────────────────────────────────────

router.get('/entities', auth, async (req, res) => {
  try {
    const { type } = req.query;
    const params = [];
    let whereClause = '';
    if (type) { params.push(type); whereClause = `WHERE e.type = $${params.length}`; }
    const { rows } = await db.query(`
      SELECT
        e.id, e.slug, e.type,
        e.primary_color, e.secondary_color, e.third_color,
        en.display_name AS name,
        el.logo_url
      FROM entities e
      LEFT JOIN entity_names en ON en.entity_id = e.id
      LEFT JOIN entity_logos el ON el.entity_id = e.id AND el.is_primary = true
      ${whereClause}
      ORDER BY e.type, en.display_name
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('Admin entities error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/entities/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { primary_color, secondary_color, third_color } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE entities
      SET primary_color=$1, secondary_color=$2, third_color=$3, updated_at=NOW()
      WHERE id=$4
      RETURNING id, slug, type, primary_color, secondary_color, third_color
    `, [primary_color, secondary_color, third_color, id]);
    if (!rows.length) return res.status(404).json({ error: 'Entity not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin update entity error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Athletes ─────────────────────────────────────────────────────────────────
// Source of truth: entities (birth_date, gender, turned_pro_year, sport_attributes)
// portrait_path: player_attributes
// position, nationality: player_attributes EAV

router.get('/athletes', auth, async (req, res) => {
  try {
    // Two separate queries — football players have player_attributes rows,
    // tennis players do not. We union them and tag sport_id manually.

    // ── Football (sport_id = 1): has player_attributes rows ──
    const { rows: football } = await db.query(`
      SELECT DISTINCT ON (e.id)
        e.id                  AS entity_id,
        e.canonical_name      AS name,
        e.slug,
        e.gender,
        e.birth_date,
        e.turned_pro_year,
        e.sport_attributes,
        1                     AS sport_id,
        pa.portrait_path,
        nat.attribute_value   AS nationality,
        pos.attribute_value   AS position
      FROM entities e
      JOIN player_attributes pa
        ON pa.entity_id = e.id AND pa.sport_id = 1
      LEFT JOIN player_attributes nat
        ON nat.entity_id = e.id AND nat.attribute_key = 'nationality'
      LEFT JOIN player_attributes pos
        ON pos.entity_id = e.id AND pos.attribute_key = 'position'
      WHERE e.entity_type = 'player'
      ORDER BY e.id, e.canonical_name
    `);

    // ── Tennis (sport_id = 2): no player_attributes row — entities only ──
    const { rows: tennis } = await db.query(`
      SELECT
        e.id                  AS entity_id,
        e.canonical_name      AS name,
        e.slug,
        e.gender,
        e.birth_date,
        e.turned_pro_year,
        e.sport_attributes,
        2                     AS sport_id,
        e.image_url           AS portrait_path,
        NULL                  AS nationality,
        NULL                  AS position
      FROM entities e
      WHERE e.entity_type = 'player'
        AND NOT EXISTS (
          SELECT 1 FROM player_attributes pa
          WHERE pa.entity_id = e.id
        )
      ORDER BY e.canonical_name
    `);

    // Sort each group A-Z and return
    const result = [
      ...football.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
      ...tennis.sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    ];

    res.json(result);
  } catch (err) {
    console.error('Admin athletes GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/athletes/:entity_id
// :id here is entity_id (from e.id), not pa.id
router.put('/athletes/:id', auth, async (req, res) => {
  const { id } = req.params; // entity_id
const {
  birth_date, turned_pro_year,
  hand, backhand, foot,       // sport_attributes fields
  position, portrait_path, profile_path,
  sport_id,
} = req.body;

  try {
    // 1. Update entities: birth_date, turned_pro_year, sport_attributes (merge)
    const { rows: entRows } = await db.query(`
      UPDATE entities
      SET
        birth_date       = COALESCE($1, birth_date),
        turned_pro_year  = COALESCE($2, turned_pro_year),
        sport_attributes = sport_attributes || $3::jsonb,
        updated_at       = NOW()
      WHERE id = $4
      RETURNING id, canonical_name, gender, birth_date, turned_pro_year, sport_attributes
    `, [
      birth_date      || null,
      turned_pro_year || null,
      JSON.stringify({
        ...(hand     !== undefined ? { hand }     : {}),
        ...(backhand !== undefined ? { backhand } : {}),
        ...(foot     !== undefined ? { foot }     : {}),
      }),
      id,
    ]);
    if (!entRows.length) return res.status(404).json({ error: 'Entity not found' });

     // 2. Update portrait_path on player_attributes (football only — tennis uses entities.image_url directly)
    if (portrait_path !== undefined && sport_id) {
      const isTennis = parseInt(sport_id) === 2
      if (!isTennis) {
        const existing = await db.query(
          `SELECT id FROM player_attributes WHERE entity_id = $1 AND sport_id = $2 LIMIT 1`,
          [id, sport_id]
        );
        if (existing.rows.length) {
          await db.query(
            `UPDATE player_attributes SET portrait_path = $1 WHERE entity_id = $2 AND sport_id = $3`,
            [portrait_path || null, id, sport_id]
          );
        }
      }
      // Always sync to entities.image_url — this is what EventBlock reads at runtime
      await db.query(
        `UPDATE entities SET image_url = $1 WHERE id = $2`,
        [portrait_path || null, id]
      );
    }
    if (profile_path !== undefined && sport_id && parseInt(sport_id) !== 2) {
      await db.query(`
        UPDATE player_attributes
        SET profile_path = $1
        WHERE entity_id = $2 AND sport_id = $3
      `, [profile_path || null, id, sport_id]);
    }

    // 3. Upsert position EAV row (football only — tennis has no position)
    if (position !== undefined && parseInt(sport_id) !== 2) {
      const existing = await db.query(
        `SELECT id FROM player_attributes WHERE entity_id = $1 AND attribute_key = 'position'`,
        [id]
      );
      if (existing.rows.length) {
        await db.query(
          `UPDATE player_attributes SET attribute_value = $1 WHERE entity_id = $2 AND attribute_key = 'position'`,
          [position || null, id]
        );
      } else if (position) {
        await db.query(
          `INSERT INTO player_attributes (entity_id, sport_id, attribute_key, attribute_value)
           VALUES ($1, $2, 'position', $3)`,
          [id, sport_id, position]  
        );
      }
    }

    res.json({ ...entRows[0], portrait_path, profile_path, position });
  } catch (err) {
    console.error('Admin athletes PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Clubs ─────────────────────────────────────────────────────────────────────

router.get('/clubs', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        e.id,
        e.canonical_name,
        e.slug,
        e.country_id,
        e.primary_color,
        e.secondary_color,
        e.third_color,
        e.founded_year,
        e.is_active,
        c.name               AS country_name,
        MIN(s.name)          AS sport_name,
        MIN(s.id)            AS sport_id,
        MAX(el.logo_url)     AS logo_url
      FROM entities e
      LEFT JOIN countries c          ON c.id = e.country_id
      LEFT JOIN club_competitions cc ON cc.club_id = e.id
      LEFT JOIN competitions comp    ON comp.id = cc.competition_id
      LEFT JOIN event_categories ec  ON ec.id = comp.category_id
      LEFT JOIN sports s             ON s.id = ec.sport_id
      LEFT JOIN entity_logos el      ON el.entity_id = e.id AND el.is_current = true
      WHERE e.entity_type = 'club'
      GROUP BY e.id, e.canonical_name, e.slug, e.country_id,
               e.primary_color, e.secondary_color, e.third_color,
               e.founded_year, e.is_active, c.name
      ORDER BY c.name, e.canonical_name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin clubs GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.put('/clubs/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { primary_color, secondary_color, third_color, founded_year, logo_url } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE entities SET
        primary_color   = $1,
        secondary_color = $2,
        third_color     = $3,
        founded_year    = $4,
        updated_at      = NOW()
      WHERE id = $5 AND entity_type = 'club'
      RETURNING id, canonical_name, primary_color, secondary_color, third_color, founded_year
    `, [primary_color || null, secondary_color || null, third_color || null, founded_year || null, id]);

    if (!rows.length) return res.status(404).json({ error: 'Club not found' });

    if (logo_url !== undefined) {
      const existing = await db.query(
        `SELECT id FROM entity_logos WHERE entity_id = $1 AND is_current = true`,
        [id]
      );
      if (existing.rows.length) {
        await db.query(
          `UPDATE entity_logos SET logo_url = $1, updated_at = NOW() WHERE entity_id = $2 AND is_current = true`,
          [logo_url || null, id]
        );
      } else if (logo_url) {
        await db.query(
          `INSERT INTO entity_logos (entity_id, logo_url, is_current, start_year)
           VALUES ($1, $2, true, EXTRACT(YEAR FROM NOW())::int)`,
          [id, logo_url]
        );
      }
      // Also keep entities.image_url in sync so all queries that join entities directly
      // get the correct logo path without needing an entity_logos join
      if (logo_url) {
        const mediaPath = logo_url.startsWith('/media/') ? logo_url : `/media/${logo_url}`
        await db.query(
          `UPDATE entities SET image_url = $1 WHERE id = $2`,
          [mediaPath, id]
        );
      }
    }

    res.json({ ...rows[0], logo_url: logo_url ?? null });
  } catch (err) {
    console.error('Admin clubs PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Media (Match Videos + Iconic Moments) ────────────────────────────────────

// GET /api/admin/media/games?season_id=X
// Lists games for a season so admin can pick which match gets a video attached.
// Includes any existing match_summary video already linked to each game.
router.get('/media/games', auth, async (req, res) => {
  const { season_id } = req.query;
  if (!season_id) return res.status(400).json({ error: 'season_id required' });
  try {
    const { rows } = await db.query(`
      SELECT
        g.id,
        g.round,
        g.match_date AS date,
        g.home_entity_id,
        g.away_entity_id,
        he.canonical_name AS home_name,
        ae.canonical_name AS away_name,
        g.score AS score_json,
        m.id              AS media_id,
        m.video_url,
        m.source,
        m.embeddable,
        m.title           AS media_title
      FROM games g
      JOIN result_tabs rt   ON rt.id = g.result_tab_id
      LEFT JOIN entities he ON he.id = g.home_entity_id
      LEFT JOIN entities ae ON ae.id = g.away_entity_id
      LEFT JOIN media m     ON m.game_id = g.id AND m.media_type = 'match_summary'
      WHERE rt.season_id = $1
      ORDER BY g.match_date ASC, g.id ASC
    `, [season_id]);
    res.json(rows);
  } catch (err) {
    console.error('Admin media/games error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/media/iconic?season_id=X
// Lists Iconic Moments videos for a season (gallery management list).
router.get('/media/iconic', auth, async (req, res) => {
  const { season_id } = req.query;
  if (!season_id) return res.status(400).json({ error: 'season_id required' });
  try {
    const { rows } = await db.query(`
      SELECT id, video_url, source, embeddable, title, category, tags,
             thumbnail_url, display_order, created_at
      FROM media
      WHERE season_id = $1 AND media_type = 'iconic_moment'
      ORDER BY display_order ASC, created_at ASC
    `, [season_id]);
    res.json(rows);
  } catch (err) {
    console.error('Admin media/iconic error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/media
// Creates a media row — match_summary (requires game_id) or iconic_moment (no game_id).
router.post('/media', auth, async (req, res) => {
  const {
    media_type, season_id, game_id, video_url, source,
    embeddable, title, category, tags, thumbnail_url, display_order,
  } = req.body;

  if (!media_type || !season_id || !video_url) {
    return res.status(400).json({ error: 'media_type, season_id, and video_url are required' });
  }
  if (media_type === 'match_summary' && !game_id) {
    return res.status(400).json({ error: 'game_id is required for match_summary' });
  }
  if (media_type === 'iconic_moment' && game_id) {
    return res.status(400).json({ error: 'iconic_moment must not have a game_id' });
  }

  try {
    const { rows } = await db.query(`
      INSERT INTO media
        (media_type, season_id, game_id, video_url, source, embeddable,
         title, category, tags, thumbnail_url, display_order)
      VALUES ($1, $2, $3, $4, COALESCE($5, 'youtube'), COALESCE($6, true),
              $7, $8, $9, $10, COALESCE($11, 0))
      RETURNING *
    `, [
      media_type, season_id, game_id || null, video_url, source || null,
      embeddable, title || null, category || null, tags || null,
      thumbnail_url || null, display_order,
    ]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin media POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/media/:id
// Edits an existing media row. media_type / season_id / game_id are fixed at creation —
// delete and recreate if the row needs to change type or link.
router.put('/media/:id', auth, async (req, res) => {
  const { id } = req.params;
  const {
    video_url, source, embeddable, title, category, tags,
    thumbnail_url, display_order,
  } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE media SET
        video_url     = COALESCE($1, video_url),
        source        = COALESCE($2, source),
        embeddable    = COALESCE($3, embeddable),
        title         = COALESCE($4, title),
        category      = COALESCE($5, category),
        tags          = COALESCE($6, tags),
        thumbnail_url = COALESCE($7, thumbnail_url),
        display_order = COALESCE($8, display_order)
      WHERE id = $9
      RETURNING *
    `, [video_url, source, embeddable, title, category, tags, thumbnail_url, display_order, id]);

    if (!rows.length) return res.status(404).json({ error: 'Media not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin media PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/media/:id
router.delete('/media/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('DELETE FROM media WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Media not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin media DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/media/tags
// Returns every distinct tag currently used across all media rows,
// so the admin UI can suggest existing tags and reduce near-duplicates
// (e.g. "Federer" vs "Federrer").
router.get('/media/tags', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT unnest(tags) AS tag
      FROM media
      WHERE tags IS NOT NULL
      ORDER BY tag ASC
    `);
    res.json(rows.map(r => r.tag));
  } catch (err) {
    console.error('Admin media/tags error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/media/iconic-by-competition?competition_id=X
// Lists every Iconic Moments video for a competition across ALL seasons/years,
// joined with season year + gender for display. Powers the new category
// drill-down admin view (Sport -> Competition -> Category -> flat table).
router.get('/media/iconic-by-competition', auth, async (req, res) => {
  const { competition_id } = req.query;
  if (!competition_id) return res.status(400).json({ error: 'competition_id required' });
  try {
    const { rows } = await db.query(`
      SELECT
        m.id, m.video_url, m.source, m.embeddable, m.title, m.category, m.tags,
        m.thumbnail_url, m.display_order, m.season_id,
        s.year, s.gender,
        c.name AS competition_name
      FROM media m
      JOIN seasons s ON s.id = m.season_id
      JOIN competitions c ON c.id = s.competition_id
      WHERE c.id = $1 AND m.media_type = 'iconic_moment'
      ORDER BY m.category ASC, s.year DESC, m.display_order ASC
    `, [competition_id]);
    res.json(rows);
  } catch (err) {
    console.error('Admin media/iconic-by-competition error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;