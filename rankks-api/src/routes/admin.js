const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();
const db      = require('../db');
const auth    = require('../middleware/auth');
const { triggerJob } = require('../scheduler');

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

// ── Countries ─────────────────────────────────────────────────────────────────
// Powers the searchable CountrySelect dropdown used by Clubs and Athletes
// (drivers). Cheap enough (~250 rows) to fetch once client-side and filter
// in the browser rather than round-tripping on every keystroke.

router.get('/countries', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, iso2, name
      FROM countries
      WHERE is_active = true
      ORDER BY name
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin countries error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Athletes ─────────────────────────────────────────────────────────────────
// Source of truth: entities (birth_date, gender, turned_pro_year, sport_attributes)
// portrait_path: player_attributes
// position, nationality: player_attributes EAV

router.get('/athletes', auth, async (req, res) => {
  try {
    const {
      sport_id,
      gender,
      country_id,
      search,
      page = '1',
      page_size = '100',
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(page_size) || 100));
    const offset   = (pageNum - 1) * pageSize;

    // Same 3-way union as before (football / tennis / drivers have
    // different underlying shapes), but now wrapped in a CTE so we can
    // filter, count, and paginate server-side instead of shipping the
    // full ~37k-row table to the browser on every page load.
    const { rows } = await db.query(`
      WITH all_athletes AS (
        SELECT * FROM (
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
            e.country_id,
            c.name                AS country_name,
            c.iso2                AS country_iso2,
            pos.attribute_value   AS position
          FROM entities e
          JOIN player_attributes pa
            ON pa.entity_id = e.id AND pa.sport_id = 1
          LEFT JOIN countries c
            ON c.id = e.country_id
          LEFT JOIN player_attributes pos
            ON pos.entity_id = e.id AND pos.attribute_key = 'position'
          WHERE e.entity_type = 'player'
          ORDER BY e.id, e.canonical_name
        ) football

        UNION ALL

        -- Tennis: entity-only, no player_attributes row at all. Basketball
        -- is ALSO entity-only (no player_attributes — position/nationality
        -- aren't tracked for it), so it must be excluded here explicitly or
        -- it silently falls into this branch mislabeled as sport_id=2 — the
        -- actual bug reported (Basketball missing from the sport dropdown,
        -- players appearing under Tennis instead).
        SELECT
          e.id, e.canonical_name, e.slug, e.gender, e.birth_date,
          e.turned_pro_year, e.sport_attributes, 2, e.image_url,
          e.country_id, c.name, c.iso2, NULL
        FROM entities e
        LEFT JOIN countries c ON c.id = e.country_id
        WHERE e.entity_type = 'player'
          AND NOT EXISTS (SELECT 1 FROM player_attributes pa WHERE pa.entity_id = e.id)
          AND NOT (e.external_ids ? 'nba_person_id' OR e.external_ids ? 'bref_player_id')

        UNION ALL

        SELECT
          e.id, e.canonical_name, e.slug, e.gender, e.birth_date,
          e.turned_pro_year, e.sport_attributes, 4, e.image_url,
          e.country_id, c.name, c.iso2, NULL
        FROM entities e
        LEFT JOIN countries c ON c.id = e.country_id
        WHERE e.entity_type = 'driver'

        UNION ALL

        -- Basketball: keyed via external_ids (not player_attributes-driven
        -- like football, since basketball has no player_attributes row for
        -- nationality — country lives on entities.country_id directly). It
        -- DOES have a position player_attributes row though, per onboarding
        -- notes (multi-position team sport, not entity-only like tennis/F1).
        SELECT
          e.id, e.canonical_name, e.slug, e.gender, e.birth_date,
          e.turned_pro_year, e.sport_attributes, 3, e.image_url,
          e.country_id, c.name, c.iso2, pos.attribute_value
        FROM entities e
        LEFT JOIN countries c ON c.id = e.country_id
        LEFT JOIN player_attributes pos
          ON pos.entity_id = e.id AND pos.sport_id = 3 AND pos.attribute_key = 'position'
        WHERE e.entity_type = 'player'
          AND (e.external_ids ? 'nba_person_id' OR e.external_ids ? 'bref_player_id')
      )
      SELECT *, COUNT(*) OVER() AS total_count
      FROM all_athletes
      WHERE ($1::int    IS NULL OR sport_id   = $1)
        AND ($2::text   IS NULL OR gender     = $2)
        AND ($3::int    IS NULL OR country_id = $3)
        AND ($4::text   IS NULL OR name ILIKE '%' || $4 || '%')
      ORDER BY name
      LIMIT $5 OFFSET $6
    `, [
      sport_id    ? parseInt(sport_id)    : null,
      gender      || null,
      country_id  ? parseInt(country_id)  : null,
      search      || null,
      pageSize,
      offset,
    ]);

    const total = rows.length ? parseInt(rows[0].total_count) : 0;
    const data  = rows.map(({ total_count, ...r }) => r);

    res.json({
      data,
      total,
      page: pageNum,
      page_size: pageSize,
      total_pages: Math.ceil(total / pageSize) || 1,
    });
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
  country_id,                  // drivers only — real FK, from the country picker
  sport_id,
} = req.body;

  // Football/tennis store nationality via the player_attributes EAV row
  // (see 'nationality' handling further down, football-only). Drivers
  // have no such row — never had player_attributes at all — so their
  // country lives directly on entities.country_id instead. Now a plain
  // integer FK supplied by the CountrySelect dropdown component, no
  // server-side name resolution needed (previously used a fragile
  // ILIKE-on-free-text match that silently no-op'd on any typo/mismatch).
  const isEntityOnlySport = [2, 3, 4].includes(parseInt(sport_id)); // tennis, basketball, drivers — portrait/profile_path live on entities.image_url, not player_attributes
  const supportsPosition  = [1, 3].includes(parseInt(sport_id));   // football, basketball — multi-position team sports; tennis/drivers have no position at all

  try {
    // 1. Update entities: birth_date, turned_pro_year, sport_attributes (merge), country
    const { rows: entRows } = await db.query(`
      UPDATE entities
      SET
        birth_date       = COALESCE($1, birth_date),
        turned_pro_year  = COALESCE($2, turned_pro_year),
        sport_attributes = sport_attributes || $3::jsonb,
        country_id       = COALESCE($5, country_id),
        updated_at       = NOW()
      WHERE id = $4
      RETURNING id, canonical_name, gender, birth_date, turned_pro_year, sport_attributes, country_id
    `, [
      birth_date      || null,
      turned_pro_year || null,
      JSON.stringify({
        ...(hand     !== undefined ? { hand }     : {}),
        ...(backhand !== undefined ? { backhand } : {}),
        ...(foot     !== undefined ? { foot }     : {}),
      }),
      id,
      country_id || null,
    ]);
    if (!entRows.length) return res.status(404).json({ error: 'Entity not found' });

     // 2. Update portrait_path on player_attributes (football only — tennis
     // and drivers use entities.image_url directly)
    if (portrait_path !== undefined && sport_id) {
      if (!isEntityOnlySport) {
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
    if (profile_path !== undefined && sport_id && !isEntityOnlySport) {
      await db.query(`
        UPDATE player_attributes
        SET profile_path = $1
        WHERE entity_id = $2 AND sport_id = $3
      `, [profile_path || null, id, sport_id]);
    }

    // 3. Upsert position EAV row (football only — tennis and drivers have no position)
    if (position !== undefined && supportsPosition) {
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
        c.name AS country_name,
        CASE WHEN e.entity_type = 'f1_team' THEN 'Car Racing' ELSE MIN(s.name) END AS sport_name,
        CASE WHEN e.entity_type = 'f1_team' THEN 4            ELSE MIN(s.id)   END AS sport_id,
        COALESCE(MAX(el.logo_url), e.image_url) AS logo_url
      FROM entities e
      LEFT JOIN countries c          ON c.id = e.country_id
      LEFT JOIN club_competitions cc ON cc.club_id = e.id
      LEFT JOIN competitions comp    ON comp.id = cc.competition_id
      LEFT JOIN event_categories ec  ON ec.id = comp.category_id
      LEFT JOIN sports s             ON s.id = ec.sport_id
      LEFT JOIN entity_logos el      ON el.entity_id = e.id AND el.is_current = true
      WHERE e.entity_type IN ('club', 'f1_team')
      GROUP BY e.id, e.canonical_name, e.slug, e.country_id,
               e.primary_color, e.secondary_color, e.third_color,
               e.founded_year, e.is_active, e.entity_type, e.image_url, c.name
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
  const { primary_color, secondary_color, third_color, founded_year, logo_url, country_id } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE entities SET
        primary_color   = $1,
        secondary_color = $2,
        third_color     = $3,
        founded_year    = $4,
        country_id      = COALESCE($5, country_id),
        updated_at      = NOW()
      WHERE id = $6 AND entity_type IN ('club', 'f1_team')
      RETURNING id, canonical_name, primary_color, secondary_color, third_color, founded_year, country_id
    `, [primary_color || null, secondary_color || null, third_color || null, founded_year || null, country_id || null, id]);

    if (!rows.length) return res.status(404).json({ error: 'Club not found' });

    if (logo_url !== undefined) {
      const existing = await db.query(
        `SELECT id FROM entity_logos WHERE entity_id = $1 AND is_current = true`,
        [id]
      );
      if (existing.rows.length) {
        await db.query(
          `UPDATE entity_logos SET logo_url = $1 WHERE entity_id = $2 AND is_current = true`,
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

// ── F1 Media (Match Videos + Iconic Moments) ────────────────────────────────
// F1 has its own dedicated tables (f1_seasons, f1_grands_prix) instead of
// the generic competitions/seasons schema the routes above use — see
// routes/f1.js header for why. These admin routes mirror the conventions
// of the /media block above exactly (auth middleware, error handling
// style, response shape) but read/write f1_race_videos and
// f1_iconic_moments instead. F1 currently has only one competition
// (Formula 1 World Championship), so there's no Sport -> Competition
// drill-down needed here — these are scoped directly to F1's own tables.

// GET /api/admin/f1/seasons
// All F1 seasons, newest first — feeds the Season column in both new
// admin pages, and the season picker in the Iconic Moments "new item" form.
router.get('/f1/seasons', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, year FROM f1_seasons ORDER BY year DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin f1/seasons error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/f1/races?season_id=X
// Lists races (grands_prix) for a season so admin can pick which race
// gets a video attached. Includes any existing f1_race_videos row already
// linked to each race. Mirrors GET /media/games?season_id=X above.
router.get('/f1/races', auth, async (req, res) => {
  const { season_id } = req.query;
  if (!season_id) return res.status(400).json({ error: 'season_id required' });
  try {
    const { rows } = await db.query(`
      SELECT
        gp.id, gp.name, gp.slug, gp.circuit_country, gp.event_date, gp.round_order,
        rv.id            AS video_id,
        rv.video_url,
        rv.source,
        rv.embeddable,
        rv.thumbnail_url
      FROM f1_grands_prix gp
      LEFT JOIN f1_race_videos rv ON rv.grand_prix_id = gp.id
      WHERE gp.f1_season_id = $1
      ORDER BY gp.round_order ASC
    `, [season_id]);
    res.json(rows);
  } catch (err) {
    console.error('Admin f1/races error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/f1/race-videos
// Creates a video for a race. grand_prix_id is UNIQUE (one video per race)
// — attempting a second insert for the same race returns 409 so the admin
// UI knows to edit the existing row instead.
router.post('/f1/race-videos', auth, async (req, res) => {
  const { grand_prix_id, video_url, source, embeddable, thumbnail_url } = req.body;
  if (!grand_prix_id || !video_url) {
    return res.status(400).json({ error: 'grand_prix_id and video_url are required' });
  }
  try {
    const { rows } = await db.query(`
      INSERT INTO f1_race_videos (grand_prix_id, video_url, source, embeddable, thumbnail_url)
      VALUES ($1, $2, COALESCE($3, 'youtube'), COALESCE($4, true), $5)
      RETURNING *
    `, [grand_prix_id, video_url, source || null, embeddable, thumbnail_url || null]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This race already has a video — edit the existing one instead' });
    }
    console.error('Admin f1/race-videos POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/f1/race-videos/:id
router.put('/f1/race-videos/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { video_url, source, embeddable, thumbnail_url } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE f1_race_videos SET
        video_url     = COALESCE($1, video_url),
        source        = COALESCE($2, source),
        embeddable    = COALESCE($3, embeddable),
        thumbnail_url = COALESCE($4, thumbnail_url)
      WHERE id = $5
      RETURNING *
    `, [video_url, source, embeddable, thumbnail_url, id]);
    if (!rows.length) return res.status(404).json({ error: 'Video not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin f1/race-videos PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/f1/race-videos/:id
router.delete('/f1/race-videos/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('DELETE FROM f1_race_videos WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Video not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin f1/race-videos DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/f1/iconic-moments
// Lists every F1 Iconic Moments video across ALL seasons, joined with
// year for display — mirrors GET /media/iconic-by-competition above,
// minus the competition join (F1 has only one competition, so nothing
// to filter by there). Powers the Category -> Season drill-down.
router.get('/f1/iconic-moments', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        im.id, im.video_url, im.source, im.embeddable, im.title, im.category,
        im.tags, im.thumbnail_url, im.display_order, im.season_id,
        s.year
      FROM f1_iconic_moments im
      JOIN f1_seasons s ON s.id = im.season_id
      ORDER BY im.category ASC, s.year DESC, im.display_order ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin f1/iconic-moments GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/f1/iconic-moments
router.post('/f1/iconic-moments', auth, async (req, res) => {
  const {
    season_id, video_url, source, embeddable, title, category,
    tags, thumbnail_url, display_order,
  } = req.body;
  if (!season_id || !video_url) {
    return res.status(400).json({ error: 'season_id and video_url are required' });
  }
  try {
    const { rows } = await db.query(`
      INSERT INTO f1_iconic_moments
        (season_id, video_url, source, embeddable, title, category, tags, thumbnail_url, display_order)
      VALUES ($1, $2, COALESCE($3, 'youtube'), COALESCE($4, true), $5, $6, $7, $8, COALESCE($9, 0))
      RETURNING *
    `, [
      season_id, video_url, source || null, embeddable, title || null,
      category || null, tags || null, thumbnail_url || null, display_order,
    ]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin f1/iconic-moments POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/f1/iconic-moments/:id
router.put('/f1/iconic-moments/:id', auth, async (req, res) => {
  const { id } = req.params;
  const {
    video_url, source, embeddable, title, category, tags,
    thumbnail_url, display_order,
  } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE f1_iconic_moments SET
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
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin f1/iconic-moments PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/f1/iconic-moments/:id
router.delete('/f1/iconic-moments/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('DELETE FROM f1_iconic_moments WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin f1/iconic-moments DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/f1/iconic-moments/tags
// Distinct tags across F1 iconic moments — same suggestion-list pattern
// as GET /media/tags above.
router.get('/f1/iconic-moments/tags', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT unnest(tags) AS tag
      FROM f1_iconic_moments
      WHERE tags IS NOT NULL
      ORDER BY tag ASC
    `);
    res.json(rows.map(r => r.tag));
  } catch (err) {
    console.error('Admin f1/iconic-moments/tags error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Providers / Coverage / Scheduling ────────────────────────────────────────

// GET /api/admin/providers/lookup-data
// Supporting dropdown data for the "add coverage" form: sports + competitions
// (with their sport_id, so the form can filter competition options by sport).
// NOTE: registered before /providers/:id so Express doesn't try to match
// "lookup-data" as an :id param.
router.get('/providers/lookup-data', auth, async (req, res) => {
  try {
    const { rows: sports } = await db.query(`SELECT id, name, slug FROM sports ORDER BY name`);
    const { rows: competitions } = await db.query(`
      SELECT c.id, c.name, ec.sport_id
      FROM competitions c
      LEFT JOIN event_categories ec ON ec.id = c.category_id
      ORDER BY c.name
    `);
    res.json({ sports, competitions });
  } catch (err) {
    console.error('Admin providers/lookup-data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/providers
// Returns the full provider -> coverage -> schedules tree in one call.
// The Providers admin page filters this client-side (Sport / Event / Provider)
// rather than re-querying per filter change, same pattern as the Iconic
// Moments drill-down (Sport -> Competition -> Category columns).
router.get('/providers', auth, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        p.id              AS provider_id,
        p.name            AS provider_name,
        p.display_name    AS provider_display_name,
        p.base_url        AS provider_base_url,
        p.enabled         AS provider_enabled,
        pc.id             AS coverage_id,
        pc.first_season_available,
        pc.coverage_notes,
        pc.script_path,
        pc.enabled        AS coverage_enabled,
        s.id              AS sport_id,
        s.name            AS sport_name,
        c.id              AS competition_id,
        c.name            AS competition_name,
        sch.id            AS schedule_id,
        sch.data_type,
        sch.frequency_minutes,
        sch.enabled       AS schedule_enabled,
        sch.last_run_at,
        sch.next_run_at,
        sch.last_run_status,
        sch.last_run_message
      FROM providers p
      LEFT JOIN provider_coverage pc ON pc.provider_id = p.id
      LEFT JOIN sports s             ON s.id = pc.sport_id
      LEFT JOIN competitions c       ON c.id = pc.competition_id
      LEFT JOIN ingestion_schedules sch ON sch.coverage_id = pc.id
      ORDER BY p.display_name, s.name, c.name, sch.data_type
    `);
    res.json(rows);
  } catch (err) {
    console.error('Admin providers GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/providers
// Creates a new provider (e.g. adding Sportradar or a tennis provider).
router.post('/providers', auth, async (req, res) => {
  const { name, display_name, base_url, enabled } = req.body;
  if (!name || !display_name) {
    return res.status(400).json({ error: 'name and display_name are required' });
  }
  try {
    const { rows } = await db.query(`
      INSERT INTO providers (name, display_name, base_url, enabled)
      VALUES ($1, $2, $3, COALESCE($4, true))
      RETURNING *
    `, [name, display_name, base_url || null, enabled]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin providers POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/providers/:id
// Used for the provider-level enable/disable switch, plus editing display info.
router.put('/providers/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { display_name, base_url, enabled } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE providers SET
        display_name = COALESCE($1, display_name),
        base_url     = COALESCE($2, base_url),
        enabled      = COALESCE($3, enabled),
        updated_at   = NOW()
      WHERE id = $4
      RETURNING *
    `, [display_name, base_url, enabled, id]);
    if (!rows.length) return res.status(404).json({ error: 'Provider not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin providers PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/providers/:id
// Cascades to provider_coverage and ingestion_schedules (ON DELETE CASCADE).
router.delete('/providers/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('DELETE FROM providers WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Provider not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin providers DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/provider-coverage
// Adds a new coverage row — a provider now covers a given competition.
router.post('/provider-coverage', auth, async (req, res) => {
  const { provider_id, sport_id, competition_id, first_season_available, coverage_notes, script_path, enabled } = req.body;
  if (!provider_id || !sport_id || !competition_id) {
    return res.status(400).json({ error: 'provider_id, sport_id, and competition_id are required' });
  }
  try {
    const { rows } = await db.query(`
      INSERT INTO provider_coverage
        (provider_id, sport_id, competition_id, first_season_available, coverage_notes, script_path, enabled)
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true))
      RETURNING *
    `, [provider_id, sport_id, competition_id, first_season_available || null, coverage_notes || null, script_path || null, enabled]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin provider-coverage POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/provider-coverage/:id
// Used for the competition-level enable/disable switch, and editing
// first_season_available / coverage_notes.
router.put('/provider-coverage/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { first_season_available, coverage_notes, script_path, enabled } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE provider_coverage SET
        first_season_available = COALESCE($1, first_season_available),
        coverage_notes          = COALESCE($2, coverage_notes),
        script_path             = COALESCE($3, script_path),
        enabled                 = COALESCE($4, enabled),
        updated_at              = NOW()
      WHERE id = $5
      RETURNING *
    `, [first_season_available, coverage_notes, script_path, enabled, id]);
    if (!rows.length) return res.status(404).json({ error: 'Coverage row not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin provider-coverage PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/provider-coverage/:id
// Cascades to ingestion_schedules (ON DELETE CASCADE).
router.delete('/provider-coverage/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('DELETE FROM provider_coverage WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Coverage row not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin provider-coverage DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/ingestion-schedules
// Adds a new schedule row (a data type) under an existing coverage row.
router.post('/ingestion-schedules', auth, async (req, res) => {
  const { coverage_id, data_type, frequency_minutes, enabled } = req.body;
  if (!coverage_id || !data_type) {
    return res.status(400).json({ error: 'coverage_id and data_type are required' });
  }
  try {
    const { rows } = await db.query(`
      INSERT INTO ingestion_schedules (coverage_id, data_type, frequency_minutes, enabled, next_run_at)
      VALUES ($1, $2, COALESCE($3, 1440), COALESCE($4, true), NOW())
      RETURNING *
    `, [coverage_id, data_type, frequency_minutes, enabled]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin ingestion-schedules POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/ingestion-schedules/:id
// Used for the data-type-level enable/disable switch and editing frequency.
// Changing frequency_minutes recomputes next_run_at from now, so a change
// takes effect on the new cadence immediately rather than waiting out the
// old interval first.
router.put('/ingestion-schedules/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { frequency_minutes, enabled } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE ingestion_schedules SET
        frequency_minutes = COALESCE($1, frequency_minutes),
        enabled           = COALESCE($2, enabled),
        next_run_at       = CASE WHEN $1 IS NOT NULL THEN NOW() + ($1 || ' minutes')::interval ELSE next_run_at END,
        updated_at        = NOW()
      WHERE id = $3
      RETURNING *
    `, [frequency_minutes, enabled, id]);
    if (!rows.length) return res.status(404).json({ error: 'Schedule not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Admin ingestion-schedules PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/ingestion-schedules/:id
router.delete('/ingestion-schedules/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('DELETE FROM ingestion_schedules WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin ingestion-schedules DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/ingestion-schedules/:id/trigger
// Manual "Run now" — runs the same script the scheduler would run for this
// job, on demand instead of waiting for next_run_at. Blocks until the script
// exits (same SCRIPT_TIMEOUT_MS cap as the scheduler) so the response carries
// the real result.
router.post('/ingestion-schedules/:id/trigger', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await triggerJob(id);
    if (!result) return res.status(404).json({ error: 'Schedule not found' });
    res.json(result);
  } catch (err) {
    console.error('Admin ingestion-schedules trigger error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Tab Titles (page-content titles per competition/tab/era) ────────────────
// Lets admin override the hardcoded page title standings_template.jsx and
// game_template.jsx would otherwise show (e.g. "Group standings" for UCL
// pre-2024 vs "League standings" 2024+, or per-group text via
// title_template's {group_name} placeholder). See tab_titles table schema.

// GET /api/admin/tab-titles?competition_id=X
router.get('/tab-titles', auth, async (req, res) => {
  const { competition_id } = req.query;
  if (!competition_id) return res.status(400).json({ error: 'competition_id required' });
  try {
    const { rows } = await db.query(`
      SELECT tt.*, c.name AS competition_name
      FROM tab_titles tt
      JOIN competitions c ON c.id = tt.competition_id
      WHERE tt.competition_id = $1
      ORDER BY COALESCE(tt.tab_key, tt.tab_group), tt.section, tt.valid_from DESC
    `, [competition_id]);
    res.json(rows);
  } catch (err) {
    console.error('Admin tab-titles GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/tab-titles/tab-options?competition_id=X
// Real distinct tab_key/tab_group values actually used across every season
// of this competition — drives the admin form's dropdowns so nobody has to
// free-type (and possibly typo) a tab_key string.
// NOTE: registered before nothing conflicting — no /:id route on this
// resource collides with "tab-options" the way /providers/:id could have.
router.get('/tab-titles/tab-options', auth, async (req, res) => {
  const { competition_id } = req.query;
  if (!competition_id) return res.status(400).json({ error: 'competition_id required' });
  try {
    const { rows } = await db.query(`
      SELECT DISTINCT rt.tab_key, rt.tab_name, rt.tab_group
      FROM result_tabs rt
      JOIN seasons s ON s.id = rt.season_id
      WHERE s.competition_id = $1
      ORDER BY rt.tab_group NULLS LAST, rt.tab_key
    `, [competition_id]);

    const tabKeys = rows
      .filter(r => r.tab_key)
      .map(r => ({ tab_key: r.tab_key, tab_name: r.tab_name }))
      .filter((r, i, arr) => arr.findIndex(x => x.tab_key === r.tab_key) === i);

    const tabGroups = [...new Set(rows.map(r => r.tab_group).filter(Boolean))];

    res.json({ tab_keys: tabKeys, tab_groups: tabGroups });
  } catch (err) {
    console.error('Admin tab-titles/tab-options error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/tab-titles
router.post('/tab-titles', auth, async (req, res) => {
  const { competition_id, tab_key, tab_group, section, title_template, valid_from, valid_to } = req.body;

  if (!competition_id || !title_template || !valid_from) {
    return res.status(400).json({ error: 'competition_id, title_template, and valid_from are required' });
  }
  if ((tab_key ? 1 : 0) + (tab_group ? 1 : 0) !== 1) {
    return res.status(400).json({ error: 'Provide exactly one of tab_key or tab_group, not both or neither' });
  }

  try {
    const { rows } = await db.query(`
      INSERT INTO tab_titles (competition_id, tab_key, tab_group, section, title_template, valid_from, valid_to)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [competition_id, tab_key || null, tab_group || null, section || 'default', title_template, valid_from, valid_to || null]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'This tab/section already has a title configured for an overlapping year range' });
    }
    console.error('Admin tab-titles POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/tab-titles/:id
router.put('/tab-titles/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { tab_key, tab_group, section, title_template, valid_from, valid_to } = req.body;

  if ((tab_key ? 1 : 0) + (tab_group ? 1 : 0) !== 1) {
    return res.status(400).json({ error: 'Provide exactly one of tab_key or tab_group, not both or neither' });
  }

  try {
    const { rows } = await db.query(`
      UPDATE tab_titles
      SET tab_key = $1, tab_group = $2, section = $3,
          title_template = $4, valid_from = $5, valid_to = $6
      WHERE id = $7
      RETURNING *
    `, [tab_key || null, tab_group || null, section || 'default', title_template, valid_from, valid_to || null, id]);

    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'This tab/section already has a title configured for an overlapping year range' });
    }
    console.error('Admin tab-titles PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/tab-titles/:id
router.delete('/tab-titles/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('DELETE FROM tab_titles WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin tab-titles DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Competition Logos (era-specific logo overrides) ─────────────────────────
// Lets admin set a different logo per year range for a competition (e.g.
// FIFA World Cup 2026 vs 2022's different design). competitions.logo_url
// remains the default/fallback for any year with no override configured.
// See competition_logos table schema — same versioned pattern as
// entity_logos, resolved via /api/competitions/:slug/logo/:year.

// GET /api/admin/competition-logos?competition_id=X
router.get('/competition-logos', auth, async (req, res) => {
  const { competition_id } = req.query;
  if (!competition_id) return res.status(400).json({ error: 'competition_id required' });
  try {
    const { rows } = await db.query(`
      SELECT cl.*, c.name AS competition_name
      FROM competition_logos cl
      JOIN competitions c ON c.id = cl.competition_id
      WHERE cl.competition_id = $1
      ORDER BY cl.start_year DESC
    `, [competition_id]);
    res.json(rows);
  } catch (err) {
    console.error('Admin competition-logos GET error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/competition-logos
router.post('/competition-logos', auth, async (req, res) => {
  const { competition_id, logo_url, start_year, end_year, is_current } = req.body;
  if (!competition_id || !logo_url || !start_year) {
    return res.status(400).json({ error: 'competition_id, logo_url, and start_year are required' });
  }
  try {
    const { rows } = await db.query(`
      INSERT INTO competition_logos (competition_id, logo_url, start_year, end_year, is_current)
      VALUES ($1, $2, $3, $4, COALESCE($5, false))
      RETURNING *
    `, [competition_id, logo_url, start_year, end_year || null, is_current]);
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'This competition already has a logo configured for an overlapping year range' });
    }
    console.error('Admin competition-logos POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/competition-logos/:id
router.put('/competition-logos/:id', auth, async (req, res) => {
  const { id } = req.params;
  const { logo_url, start_year, end_year, is_current } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE competition_logos
      SET logo_url = $1, start_year = $2, end_year = $3, is_current = $4
      WHERE id = $5
      RETURNING *
    `, [logo_url, start_year, end_year || null, is_current, id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23P01') {
      return res.status(409).json({ error: 'This competition already has a logo configured for an overlapping year range' });
    }
    console.error('Admin competition-logos PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/admin/competition-logos/:id
router.delete('/competition-logos/:id', auth, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query('DELETE FROM competition_logos WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error('Admin competition-logos DELETE error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;