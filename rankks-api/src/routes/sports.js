// src/routes/sports.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/sports
// Returns all active sports with their event categories
router.get('/', async (req, res, next) => {
  try {
    const sports = await queryAll(`
      SELECT
        s.id,
        s.name,
        s.slug,
        s.display_pattern,
        s.icon_url,
        s.display_order,
        (
          SELECT dc.slug
          FROM competitions dc
          JOIN event_categories dec ON dec.id = dc.category_id
          WHERE dec.sport_id = s.id AND dc.is_default = TRUE
          LIMIT 1
        ) AS default_competition_slug,
        (
          SELECT dec.slug
          FROM competitions dc
          JOIN event_categories dec ON dec.id = dc.category_id
          WHERE dec.sport_id = s.id AND dc.is_default = TRUE
          LIMIT 1
        ) AS default_competition_category_slug,
        COALESCE(
          json_agg(
            json_build_object(
              'id',           ec.id,
              'canonical_name', ec.canonical_name,
              'short_name',   ec.short_name,
              'slug',         ec.slug,
              'level',        ec.level,
              'gender',       ec.gender,
              'localisation', ec.localisation,
              'confederation',ec.confederation,
              'display_order',ec.display_order
            ) ORDER BY ec.display_order
          ) FILTER (WHERE ec.id IS NOT NULL),
          '[]'
        ) AS categories
      FROM sports s
      LEFT JOIN event_categories ec ON ec.sport_id = s.id
      WHERE s.is_active = TRUE
      GROUP BY s.id
      ORDER BY s.display_order
    `);

    res.json({ data: sports });
  } catch (err) {
    next(err);
  }
});

// GET /api/sports/:slug
// Returns a single sport with full category and competition tree
router.get('/:slug', async (req, res, next) => {
  try {
    const sport = await queryOne(`
      SELECT id, name, slug, display_pattern, icon_url
      FROM sports
      WHERE slug = $1 AND is_active = TRUE
    `, [req.params.slug]);

    if (!sport) {
      return res.status(404).json({ error: 'Sport not found' });
    }

    // Get categories with competitions
    const categories = await queryAll(`
      SELECT
        ec.id,
        ec.canonical_name,
        ec.short_name,
        ec.slug,
        ec.level,
        ec.gender,
        ec.localisation,
        ec.confederation,
        ec.display_order,
        -- Category-level logo (e.g. Grand Slam's own brand mark, distinct
        -- from any single Slam's competition logo) — backed by the same
        -- 'tour' entity_type entities already used for ATP/WTA
        -- (entities.slug = ec.slug), not a new admin surface. Prefers
        -- sidebar_logo_url (same admin field as clubs/competitions) since
        -- the full-size brand mark is often mostly padding and disappears
        -- at sidebar icon size. MAX() keeps this GROUP-BY-safe without
        -- adding ent.id to the ec.id grouping (slug is unique among tour
        -- entities, so at most one match).
        MAX(COALESCE(ent.sidebar_logo_url, ent.image_url)) AS logo_url,
        COALESCE(
          json_agg(
            json_build_object(
              'id',           c.id,
              'name',         c.name,
              'sidebar_name', c.sidebar_name,
              'short_code',   c.short_code,
              'slug',         c.slug,
              'logo_url',     c.logo_url,
              'sidebar_logo_url', c.sidebar_logo_url,
              'surface',      c.surface,
              'gender',       c.gender,
              'display_order',c.display_order,
              'founded_year', c.founded_year,
              'first_data_year', c.first_data_year,
              'is_default',   c.is_default,
              -- Real "happening right now" flag for the sidebar/Line A
              -- ongoing-dot indicator — deliberately independent of
              -- whichever year the user has selected (CURRENT_DATE, not
              -- the selected year's season), and computed from real dates
              -- rather than the stored seasons.status column, same
              -- "don't trust a column that's never revisited" reasoning
              -- as competitions.js's is_next fix (2026-08-20). Excludes
              -- cancelled seasons so a would-have-been-live cancelled
              -- tournament never lights the dot.
              'has_ongoing',  EXISTS (
                SELECT 1 FROM seasons s
                WHERE s.competition_id = c.id
                  AND s.status <> 'cancelled'
                  AND s.start_date IS NOT NULL AND s.end_date IS NOT NULL
                  AND CURRENT_DATE BETWEEN s.start_date AND s.end_date
              ),
              -- Whether this competition's Line A actually synthesizes a
              -- real 'schedule' tab (Sidebar.jsx, Mohamed 2026-08-26: "any
              -- click on a sidebar item leads to Schedule page" — needed so
              -- football's sidebar can tell round-robin leagues (Ligue 1,
              -- has a literal 'final_tour' result_tabs row) and World Cup-
              -- shaped competitions (quadrennial/biennial) apart from
              -- anything with genuinely no Schedule tab to send anyone to.
              -- UCL originally had neither shape (its own 'final_tour' is a
              -- TAB_GROUP spanning several differently-keyed tabs, not one
              -- literal 'final_tour' tab_key — see ContentArea.jsx's own
              -- hasLeagueFinalTour comment) — but 2025/26+ seasons gained a
              -- real Schedule tab once UCL's League Phase shipped
              -- (home_template.jsx's hasLeaguePhase branch), so the
              -- 'league_phase' tab_group is now also a qualifying shape
              -- (Mohamed 2026-08-27: sidebar's "Champions League" link was
              -- still landing on Home instead of Schedule). Same day,
              -- extended again to 'group_stages' (UCL's pre-2024 Group A..H
              -- era) once the Schedule page itself grew a merge path for
              -- that shape too (Mohamed: "create schedule page for all UCL
              -- seasons") — this flag governs every UCL season equally, not
              -- per-year, same as the pre-existing 'final_tour' check does
              -- for round-robin leagues. Basketball/MMA/car-racing sidebars
              -- never read this field — their Schedule tab is unconditional
              -- (home_template.jsx's own isBasketball check, MmaEventTemplate's
              -- 'schedule' section, F1/MotoGPContentArea's isScheduleMode).
              'has_schedule_tab', (
                c.competition_type IN ('quadrennial', 'biennial')
                OR EXISTS (
                  SELECT 1 FROM result_tabs rt
                  JOIN seasons se ON se.id = rt.season_id
                  WHERE se.competition_id = c.id AND rt.tab_key = 'final_tour'
                )
                OR EXISTS (
                  SELECT 1 FROM result_tabs rt
                  JOIN seasons se ON se.id = rt.season_id
                  WHERE se.competition_id = c.id AND rt.tab_group IN ('league_phase', 'group_stages')
                )
              )
            ) ORDER BY c.display_order
          ) FILTER (WHERE c.id IS NOT NULL),
          '[]'
        ) AS competitions
      FROM event_categories ec
      LEFT JOIN competitions c ON c.category_id = ec.id AND c.is_active = TRUE
      LEFT JOIN entities ent ON ent.slug = ec.slug AND ent.entity_type = 'tour'
      WHERE ec.sport_id = $1
      GROUP BY ec.id
      ORDER BY ec.display_order
    `, [sport.id]);

    // ATP/WTA aren't event_categories themselves (each groups several —
    // atp-masters-1000, atp-masters-500, etc, see Sidebar.jsx's
    // ATP_SLUGS/WTA_SLUGS), so their logos can't hang off a single category
    // row above. Same 'tour' entities, fetched separately and exposed as a
    // flat sport-level map. Only tennis has any 'tour' entities today, so
    // this is a no-op elsewhere (empty rows -> tour_logos: {}).
    const tourRows = await queryAll(
      `SELECT slug, COALESCE(sidebar_logo_url, image_url) AS logo_url FROM entities WHERE entity_type = 'tour'`
    );
    const tour_logos = Object.fromEntries(tourRows.map(r => [r.slug, r.logo_url]));

    res.json({ data: { ...sport, categories, tour_logos } });
  } catch (err) {
    next(err);
  }
});

// GET /api/sports/:slug/year-range — sport-wide firstDataYear, for Totals
// pages that have no single competition of their own (tennis's tour-wide
// ATP/WTA Totals hub — Mohamed 2026-08-26: "take into account the oldest
// competition in ATP or WTA"). Same MIN(seasons.year), year_convention-
// aware computation as GET /competitions/:slug/year-range's own
// firstDataYear, just widened from one competition to every competition
// under this sport via event_categories.sport_id (competitions has no
// sport_id column of its own).
router.get('/:slug/year-range', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const sport = await queryOne('SELECT id FROM sports WHERE slug = $1', [slug]);
    if (!sport) return res.status(404).json({ error: 'Sport not found' });

    const row = await queryOne(`
      SELECT MIN(CASE WHEN c.year_convention = 'start' THEN s.year + 1 ELSE s.year END) AS first_year
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      WHERE ec.sport_id = $1
    `, [sport.id]);

    res.json({ data: { firstDataYear: row?.first_year ?? null } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
