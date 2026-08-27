// src/routes/competitions.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/competitions
router.get('/', async (req, res, next) => {
  try {
    const { sport, category, gender, year } = req.query;
    const params = [sport, category, gender].filter(Boolean);
    const yearIdx = params.length + 1;

    const rows = await queryAll(`
      SELECT
        c.id,
        c.name,
        c.sidebar_name,
        c.short_code,
        c.slug,
        c.country_id,
        c.logo_url,
        c.sidebar_logo_url,
        c.bg_image_url,
        c.city,
        c.surface,
        c.gender,
        c.competition_type,
        c.organiser,
        c.website,
        c.founded_year,
        c.first_data_year,
        c.valid_from,
        c.valid_to,
        c.display_order,
        c.column_config,
        c.primary_color,
        c.secondary_color,
        c.third_color,
        c.cancelled_years,
        c.cancelled_editions,
        c.year_convention,
        ec.id             AS category_id,
        ec.canonical_name AS category_name,
        ec.short_name     AS category_short,
        ec.slug           AS category_slug,
        ec.level,
        ec.localisation,
        s.id              AS sport_id,
        s.name            AS sport_name,
        s.slug            AS sport_slug,
        s.display_pattern,
        co.iso2           AS country_iso2,
        co.name           AS country_name,
        yr.status             AS year_status,
        yr.cancellation_reason AS year_cancellation_reason,
        yr.start_date         AS year_start_date,
        yr.end_date           AS year_end_date,
        -- Computed from the real calendar date, not the stored status
        -- column, which is written once at ingest and never revisited —
        -- see the nx LATERAL below for why.
        (yr.status <> 'cancelled' AND yr.start_date > NOW() AND yr.start_date = nx.next_start) AS is_next
      FROM competitions c
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN sports s ON s.id = ec.sport_id
      LEFT JOIN countries co ON co.id = c.country_id
      LEFT JOIN LATERAL (
        SELECT se.status, se.cancellation_reason, se.start_date, se.end_date, se.gender AS season_gender
        FROM seasons se
        WHERE se.competition_id = c.id
          ${year ? `AND se.year = $${yearIdx}` : 'AND FALSE'}
        ORDER BY (se.status = 'cancelled'), se.gender
        LIMIT 1
      ) yr ON TRUE
      -- "Next" is scoped to the same tour side (ATP vs WTA, i.e. same
      -- season.gender) across EVERY category of this sport, not just
      -- whichever category this row's own list is filtered to — a Line A
      -- list for one category (e.g. Masters 1000) can still correctly show
      -- no "Next" badge at all when the true next tournament on the
      -- calendar is a 500 or 250 instead. Only the single earliest
      -- start_date among every future-status row wins; every other future
      -- row is "Future" by elimination (handled client-side).
      LEFT JOIN LATERAL (
        SELECT MIN(s2.start_date) AS next_start
        FROM seasons s2
        JOIN competitions c2 ON c2.id = s2.competition_id
        JOIN event_categories ec2 ON ec2.id = c2.category_id
        WHERE ec2.sport_id = ec.sport_id
          AND s2.status <> 'cancelled'
          AND s2.start_date > NOW()
          AND s2.gender = yr.season_gender
      ) nx ON TRUE
      WHERE s.is_active = TRUE
        AND (c.is_active = TRUE OR c.valid_to IS NOT NULL)
        ${sport    ? 'AND s.slug = $1'    : ''}
        ${category ? `AND ec.slug = $${sport ? 2 : 1}` : ''}
        ${gender   ? `AND (c.gender = $${[sport,category].filter(Boolean).length + 1} OR c.gender = 'X')` : ''}
        ${year     ? `AND (c.valid_from IS NULL OR c.valid_from <= $${yearIdx})` : ''}
        ${year     ? `AND (c.valid_to   IS NULL OR c.valid_to   >= $${yearIdx})` : ''}
        ${year     ? 'AND yr.status IS NOT NULL' : ''}
      -- Chronological within the requested year (yr.start_date - when this
      -- competition actually falls in THIS season's calendar), not by how
      -- old the tournament franchise is (founded_year) or c.display_order
      -- (an uncurated legacy field with scattered values that was silently
      -- winning over everything else - found 2026-08, this is what made
      -- ATP 250's Line A order look scrambled). founded_year/name remain as
      -- fallbacks for the no-year case (category browse with no year yet).
      ORDER BY ec.display_order, yr.start_date NULLS LAST, c.founded_year NULLS LAST, c.name
    `, year ? [...params, parseInt(year)] : params);

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/home/:tour/:year
// ATP/WTA Home hub — one row per tournament edition of the given year,
// across every category that belongs to that tour, with the singles
// draw's Final-round winner/runner-up + match video attached. Powers
// the "Home of ATP"/"Home of WTA" page (sidebar section label / Line A
// hub button), not any one competition's own page.
const TENNIS_SPORT_ID = 2;
const TOUR_CATEGORY_SLUGS = {
  atp: ['grand-slam', 'atp-masters-1000', 'atp-masters-500', 'atp-masters-250', 'atp-finals', 'atp-various'],
  wta: ['grand-slam', 'wta-1000', 'wta-500', 'wta-250', 'wta-finals'],
};
// Totals > Tournament Stats only — one tier lower than /home's own list
// (Challenger/WTA 125 have no data yet, but Totals is a career-spanning
// aggregate view rather than a per-year results table, so including them
// here can't clutter it the way it would clutter Home's one-row-per-
// edition-this-year table. Kept out of TOUR_CATEGORY_SLUGS itself so
// /home/:tour/:year is unaffected.
const TOTALS_CATEGORY_SLUGS = {
  atp: [...TOUR_CATEGORY_SLUGS.atp, 'atp-challenger'],
  wta: [...TOUR_CATEGORY_SLUGS.wta, 'wta-125'],
};
// Masters-1000-tier slug per tour — 'grand-slam' is shared across both
// tours so it can be hardcoded in SQL, but the 1000 tier has a separate
// slug per tour (atp-masters-1000 / wta-1000), so Player Stats' M1000/Wins
// column needs it passed in as a query param instead.
const TOUR_M1000_SLUG = { atp: 'atp-masters-1000', wta: 'wta-1000' };
// Homepage matchup comparison (Performances tab) needs Finals/500/250 title
// counts broken out individually, not folded into wins_all like every
// other player-totals consumer needed so far — added alongside the
// existing grand-slam/m1000 breakdown rather than a new query (2026-08-20).
const TOUR_FINALS_SLUG = { atp: 'atp-finals', wta: 'wta-finals' };
const TOUR_M500_SLUG   = { atp: 'atp-masters-500', wta: 'wta-500' };
const TOUR_M250_SLUG   = { atp: 'atp-masters-250', wta: 'wta-250' };
// Round-robin team events (World Team Cup/Championship) — no clean single
// Final-round winner exists in the data (multiple "Final"-round rows per
// edition, one per individual rubber, no team/tie aggregate stored
// anywhere). Rather than guess, these categories' winner/runner_up are
// nulled out in JS after the query, regardless of what the Final-round
// LATERAL below happens to pick up.
const NO_WINNER_CATEGORY_SLUGS = ['atp-various'];

router.get('/home/:tour/:year', async (req, res, next) => {
  try {
    const { tour, year } = req.params;
    const categorySlugs = TOUR_CATEGORY_SLUGS[tour];
    if (!categorySlugs) return res.status(400).json({ error: 'tour must be atp or wta' });
    const gender = tour === 'wta' ? 'F' : 'M';
    const yearInt = parseInt(year);

    // s.year >= 1877 (Wimbledon's real founding year, the earliest real
    // tennis record in this DB) guards against stray bad data dragging the
    // year range down — found live: seasons.id 7301 (Canadian Open) has
    // year=202, clearly a mistyped 2020, which produced an 1027-button year
    // selector before this guard. Not auto-corrected here — that's a data
    // fix for Mohamed to confirm, not something to silently rewrite.
    const bounds = await queryOne(`
      SELECT MIN(s.year) AS min_year, MAX(s.year) AS max_year
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3 AND s.year >= 1877
    `, [TENNIS_SPORT_ID, categorySlugs, gender]);

    const rows = await queryAll(`
      SELECT
        c.id AS competition_id, c.name AS competition_name, c.slug AS competition_slug,
        cco.iso2 AS competition_iso2, cco.name AS competition_country,
        ec.slug AS category_slug, ec.short_name AS category_short_name, ec.display_order,
        s.id AS season_id, s.year, s.status, s.start_date, s.end_date, s.cancellation_reason,
        (s.status <> 'cancelled' AND s.start_date > NOW() AND s.start_date = nx.next_start) AS is_next,
        we.id AS winner_id, COALESCE(wen.display_name, we.canonical_name) AS winner_name,
        wco.iso2 AS winner_iso2, wco.name AS winner_country,
        le.id AS runner_up_id, COALESCE(len.display_name, le.canonical_name) AS runner_up_name,
        lco.iso2 AS runner_up_iso2, lco.name AS runner_up_country,
        m.id AS video_id, m.video_url, m.source AS video_source,
        m.embeddable AS video_embeddable, m.thumbnail_url AS video_thumbnail_url,
        -- Prefer the surface actually played this edition (any round already
        -- played in the draw, not just the Final — an in-progress event has
        -- no Final yet but its earlier rounds already show the real surface).
        -- Falls back to the competition's own static surface field (only
        -- reachable for events with zero games played yet, i.e. genuinely
        -- future editions) — normalized to match games.surface's casing/
        -- vocabulary, since that column was found to be inconsistently
        -- cased ('hard' vs 'Hard') and to use 'indoor_hard' with no Carpet
        -- equivalent, so it's grouped into 'Hard'.
        COALESCE(surf.surface, CASE lower(c.surface)
          WHEN 'clay' THEN 'Clay' WHEN 'grass' THEN 'Grass'
          WHEN 'hard' THEN 'Hard' WHEN 'indoor_hard' THEN 'Hard'
          ELSE NULL END) AS surface
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      LEFT JOIN countries cco ON cco.id = c.country_id
      -- Same "single earliest future tournament, whole sport, this gender"
      -- rule competitions.js/seasons.js already use for is_next — scoped to
      -- the WHOLE tennis sport (not just this tour's category subset), so
      -- meaning stays consistent with the NEXT/FUTURE wording used
      -- elsewhere in the app.
      LEFT JOIN LATERAL (
        SELECT MIN(s2.start_date) AS next_start
        FROM seasons s2
        JOIN competitions c2 ON c2.id = s2.competition_id
        JOIN event_categories ec2 ON ec2.id = c2.category_id
        WHERE ec2.sport_id = $1 AND s2.status <> 'cancelled' AND s2.start_date > NOW() AND s2.gender = $3
      ) nx ON TRUE
      LEFT JOIN LATERAL (
        SELECT rt.id FROM result_tabs rt
        WHERE rt.season_id = s.id AND rt.tab_key = ('draw-singles-' || lower($3))
        LIMIT 1
      ) tab ON TRUE
      LEFT JOIN LATERAL (
        SELECT g.id AS game_id, g.winner_entity_id,
          CASE WHEN g.winner_entity_id = g.home_entity_id THEN g.away_entity_id ELSE g.home_entity_id END AS loser_entity_id
        FROM games g WHERE g.result_tab_id = tab.id AND g.round = 'Final'
        ORDER BY g.id LIMIT 1
      ) fin ON TRUE
      LEFT JOIN LATERAL (
        SELECT g.surface FROM games g
        WHERE g.result_tab_id = tab.id AND g.surface IS NOT NULL
        ORDER BY g.id LIMIT 1
      ) surf ON TRUE
      LEFT JOIN entities we ON we.id = fin.winner_entity_id
      LEFT JOIN countries wco ON wco.id = we.country_id
      LEFT JOIN entity_names wen ON wen.entity_id = we.id AND $2::int BETWEEN wen.start_year AND COALESCE(wen.end_year, 9999)
      LEFT JOIN entities le ON le.id = fin.loser_entity_id
      LEFT JOIN countries lco ON lco.id = le.country_id
      LEFT JOIN entity_names len ON len.entity_id = le.id AND $2::int BETWEEN len.start_year AND COALESCE(len.end_year, 9999)
      LEFT JOIN media m ON m.game_id = fin.game_id AND m.media_type = 'match_summary'
      WHERE ec.sport_id = $1 AND ec.slug = ANY($4::text[]) AND s.year = $2 AND s.gender = $3
      ORDER BY s.start_date NULLS LAST, ec.display_order
    `, [TENNIS_SPORT_ID, yearInt, gender, categorySlugs]);

    const data = rows.map(r => {
      const noWinner = NO_WINNER_CATEGORY_SLUGS.includes(r.category_slug);
      return {
        competition_id: r.competition_id,
        competition_name: r.competition_name,
        competition_slug: r.competition_slug,
        competition_iso2: r.competition_iso2,
        competition_country: r.competition_country,
        category_slug: r.category_slug,
        category_short_name: r.category_short_name,
        category_display_order: r.display_order,
        season_id: r.season_id,
        year: r.year,
        status: r.status,
        start_date: r.start_date,
        end_date: r.end_date,
        cancellation_reason: r.cancellation_reason,
        is_next: r.is_next,
        surface: r.surface,
        winner: (!noWinner && r.winner_id) ? { id: r.winner_id, name: r.winner_name, iso2: r.winner_iso2, country: r.winner_country } : null,
        runner_up: (!noWinner && r.runner_up_id) ? { id: r.runner_up_id, name: r.runner_up_name, iso2: r.runner_up_iso2, country: r.runner_up_country } : null,
        video: r.video_id ? { id: r.video_id, url: r.video_url, source: r.video_source, embeddable: r.video_embeddable, thumbnail_url: r.video_thumbnail_url } : null,
      };
    });

    res.json({ data: { tour, year: yearInt, min_year: bounds?.min_year || yearInt, max_year: bounds?.max_year || yearInt, rows: data } });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/totals/:tour/:year
// ATP/WTA "Totals" hub (Line A pinned Totals button) — Tournament Stats:
// one row per tournament (competition), cumulative "through <year>"
// across every category belonging to that tour, same shape as F1's
// races-all-time (see f1.js) — Editions/1st Edition instead of Nb of
// races/1st GP, and a single Wins/Runner-up Finishes record-holder pair
// (the singles draw's Final winner/loser) instead of F1's three
// Wins/Poles/Sprint-Wins columns, since tennis has no pole/sprint
// equivalent.
//
// Only actually-held editions count (status IN 'past'/'ongoing', i.e. not
// 'cancelled' or 'future') and are capped to year <= the selected year —
// same "as of viewed year" rule as everywhere else in the app (see
// tennis-players route's identical convention in results.js).
router.get('/totals/:tour/:year', async (req, res, next) => {
  try {
    const { tour, year } = req.params;
    const categorySlugs = TOTALS_CATEGORY_SLUGS[tour];
    if (!categorySlugs) return res.status(400).json({ error: 'tour must be atp or wta' });
    const gender = tour === 'wta' ? 'F' : 'M';
    const yearInt = parseInt(year);

    const rows = await queryAll(`
      WITH editions AS (
        SELECT c.id AS competition_id, s.id AS season_id, c.name, co.iso2 AS country_iso2, co.name AS country_name, s.year,
          ec.short_name AS category_short_name, ec.display_order AS category_display_order, c.surface AS static_surface
        FROM seasons s
        JOIN competitions c ON c.id = s.competition_id
        JOIN event_categories ec ON ec.id = c.category_id
        LEFT JOIN countries co ON co.id = c.country_id
        WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
          AND s.year <= $4 AND s.status IN ('past', 'ongoing')
      ),
      comp_meta AS (
        SELECT competition_id,
          (ARRAY_AGG(name ORDER BY year DESC))[1]         AS latest_name,
          (ARRAY_AGG(country_iso2 ORDER BY year DESC))[1] AS country_iso2,
          (ARRAY_AGG(country_name ORDER BY year DESC))[1] AS country_name,
          -- Constant per competition (category never changes across its
          -- own editions) — MIN is just a safe way to pull the one value
          -- out of the group.
          MIN(category_short_name)    AS category_short_name,
          MIN(category_display_order) AS category_display_order,
          MIN(static_surface)         AS static_surface,
          MIN(year)  AS first_year,
          MAX(year)  AS latest_year,
          COUNT(*)   AS edition_count
        FROM editions
        GROUP BY competition_id
      ),
      -- Surface actually played at the most recent counted edition — same
      -- "any played round, not just the Final" rule /home/:tour/:year uses
      -- (see that route's own comment), since a tournament can change
      -- surface over its history and the current one is what the "All
      -- Surfaces" filter here should match against.
      latest_surface AS (
        SELECT DISTINCT ON (e.competition_id) e.competition_id, g.surface
        FROM editions e
        JOIN comp_meta cm ON cm.competition_id = e.competition_id AND e.year = cm.latest_year
        JOIN result_tabs rt ON rt.season_id = e.season_id AND rt.tab_key = ('draw-singles-' || lower($3))
        JOIN games g ON g.result_tab_id = rt.id AND g.surface IS NOT NULL
        ORDER BY e.competition_id, g.id
      ),
      finals AS (
        SELECT e.competition_id, g.winner_entity_id,
          CASE WHEN g.winner_entity_id = g.home_entity_id THEN g.away_entity_id ELSE g.home_entity_id END AS loser_entity_id
        FROM editions e
        JOIN result_tabs rt ON rt.season_id = e.season_id AND rt.tab_key = ('draw-singles-' || lower($3))
        JOIN games g ON g.result_tab_id = rt.id AND g.round = 'Final'
      ),
      title_counts AS (
        SELECT competition_id, winner_entity_id, COUNT(*) AS win_count
        FROM finals WHERE winner_entity_id IS NOT NULL
        GROUP BY competition_id, winner_entity_id
      ),
      top_titles AS (
        SELECT DISTINCT ON (competition_id) competition_id, winner_entity_id, win_count
        FROM title_counts ORDER BY competition_id, win_count DESC, winner_entity_id ASC
      ),
      runnerup_counts AS (
        SELECT competition_id, loser_entity_id, COUNT(*) AS ru_count
        FROM finals WHERE loser_entity_id IS NOT NULL
        GROUP BY competition_id, loser_entity_id
      ),
      top_runnerup AS (
        SELECT DISTINCT ON (competition_id) competition_id, loser_entity_id, ru_count
        FROM runnerup_counts ORDER BY competition_id, ru_count DESC, loser_entity_id ASC
      )
      SELECT cm.competition_id, cm.latest_name, cm.first_year, cm.edition_count,
        cm.country_iso2, cm.country_name, cm.category_short_name, cm.category_display_order,
        COALESCE(ls.surface, CASE lower(cm.static_surface)
          WHEN 'clay' THEN 'Clay' WHEN 'grass' THEN 'Grass'
          WHEN 'hard' THEN 'Hard' WHEN 'indoor_hard' THEN 'Hard'
          ELSE NULL END) AS surface,
        we.canonical_name AS win_name, we.slug AS win_slug, we.death_date AS win_death_date,
        wco.iso2 AS win_country_iso2, wco.name AS win_country_name, tt.win_count,
        le.canonical_name AS ru_name, le.slug AS ru_slug, le.death_date AS ru_death_date,
        lco.iso2 AS ru_country_iso2, lco.name AS ru_country_name, tr.ru_count
      FROM comp_meta cm
      LEFT JOIN latest_surface ls ON ls.competition_id = cm.competition_id
      LEFT JOIN top_titles tt   ON tt.competition_id = cm.competition_id
      LEFT JOIN entities we     ON we.id = tt.winner_entity_id
      LEFT JOIN countries wco   ON wco.id = we.country_id
      LEFT JOIN top_runnerup tr ON tr.competition_id = cm.competition_id
      LEFT JOIN entities le     ON le.id = tr.loser_entity_id
      LEFT JOIN countries lco   ON lco.id = le.country_id
      ORDER BY cm.edition_count DESC, cm.first_year ASC
    `, [TENNIS_SPORT_ID, categorySlugs, gender, yearInt]);

    res.json({
      data: {
        tour, year: yearInt,
        tournaments: rows.map(r => ({
          competition_id: r.competition_id,
          name: r.latest_name,
          category: r.category_short_name,
          category_display_order: r.category_display_order,
          first_year: r.first_year,
          edition_count: Number(r.edition_count),
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          surface: r.surface,
          wins: r.win_name ? { name: r.win_name, slug: r.win_slug, death_date: r.win_death_date, iso2: r.win_country_iso2, country: r.win_country_name, count: Number(r.win_count) } : null,
          runner_up: r.ru_name ? { name: r.ru_name, slug: r.ru_slug, death_date: r.ru_death_date, iso2: r.ru_country_iso2, country: r.ru_country_name, count: Number(r.ru_count) } : null,
        })),
        count: rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/tournament-history/:competitionId/:tour/:year
// One row per edition of a single tournament (e.g. every Wimbledon final
// ever played) — champion + runner-up, most recent first, capped through
// the selected year (same "as of viewed year" rule as /totals above: only
// actually-held editions, status past/ongoing). Powers the Tournament
// Stats page's "All-Time Results" drawer (per-row action, same slide-in
// pattern as TennisResultsDrawer's "Full Results" — that one shows a
// single edition's bracket, this shows every edition's Final result).
router.get('/tournament-history/:competitionId/:tour/:year', async (req, res, next) => {
  try {
    const { competitionId, tour, year } = req.params;
    const gender = tour === 'wta' ? 'F' : 'M';
    const yearInt = parseInt(year);

    const rows = await queryAll(`
      WITH editions AS (
        -- seasons.edition_number is unpopulated for this competition (and
        -- most others) — computed here instead as "how many actually-held
        -- editions through this one", same rule /totals' own edition_count
        -- uses, so a cancelled year (e.g. Wimbledon 2020) correctly isn't
        -- counted (found 2026-08-10: naive year-1968+1 arithmetic would
        -- have called 2026 the 59th edition; it's the 58th).
        SELECT s.id AS season_id, s.year,
          ROW_NUMBER() OVER (ORDER BY s.year ASC) AS edition_number
        FROM seasons s
        WHERE s.competition_id = $1 AND s.gender = $2
          AND s.year <= $3 AND s.status IN ('past', 'ongoing')
      ),
      finals AS (
        SELECT e.year, e.edition_number, g.winner_entity_id,
          CASE WHEN g.winner_entity_id = g.home_entity_id THEN g.away_entity_id ELSE g.home_entity_id END AS loser_entity_id,
          g.score,
          -- Aggregate title count for this player at this tournament, as of
          -- this edition — "Nadal (1)", then "Nadal (2)" the next time he
          -- wins it, per Mohamed's spec. Ascending so it counts UP toward
          -- each player's eventual total, not down from it.
          COUNT(*) OVER (PARTITION BY g.winner_entity_id ORDER BY e.year ASC) AS win_ordinal
        FROM editions e
        JOIN result_tabs rt ON rt.season_id = e.season_id AND rt.tab_key = ('draw-singles-' || lower($2))
        JOIN games g ON g.result_tab_id = rt.id AND g.round = 'Final'
        WHERE g.winner_entity_id IS NOT NULL
      )
      SELECT f.year, f.edition_number, f.score, false AS is_cancelled, NULL::text AS cancellation_reason,
        we.canonical_name AS win_name, we.slug AS win_slug, we.death_date AS win_death_date,
        wco.iso2 AS win_iso2, wco.name AS win_country, f.win_ordinal,
        le.canonical_name AS ru_name, le.slug AS ru_slug, le.death_date AS ru_death_date,
        lco.iso2 AS ru_iso2, lco.name AS ru_country
      FROM finals f
      LEFT JOIN entities we   ON we.id = f.winner_entity_id
      LEFT JOIN countries wco ON wco.id = we.country_id
      LEFT JOIN entities le   ON le.id = f.loser_entity_id
      LEFT JOIN countries lco ON lco.id = le.country_id

      UNION ALL

      -- Scheduled-but-not-held years (war, COVID, etc.) — same "scheduled,
      -- not played" convention the season-level empty-state already uses
      -- (Mohamed's rule: still listed, not hidden). No edition_number
      -- (never actually held) and no result fields.
      SELECT s.year, NULL, NULL, true, s.cancellation_reason,
        NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL
      FROM seasons s
      WHERE s.competition_id = $1 AND s.gender = $2
        AND s.year <= $3 AND s.status = 'cancelled'

      ORDER BY year DESC
    `, [competitionId, gender, yearInt]);

    res.json({
      data: {
        rows: rows.map(r => ({
          year: r.year,
          edition: r.edition_number,
          score: r.score,
          is_cancelled: r.is_cancelled,
          cancellation_reason: r.cancellation_reason,
          champion: r.is_cancelled ? null : { name: r.win_name, slug: r.win_slug, death_date: r.win_death_date, iso2: r.win_iso2, country: r.win_country, ordinal: r.win_ordinal != null ? Number(r.win_ordinal) : null },
          runner_up: r.is_cancelled ? null : { name: r.ru_name, slug: r.ru_slug, death_date: r.ru_death_date, iso2: r.ru_iso2, country: r.ru_country },
        })),
        count: rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/player-totals/:tour/:year
// ATP/WTA "Totals" hub — Player Stats: one row per player, cumulative
// "through <year>" across every category belonging to the tour (same
// TOTALS_CATEGORY_SLUGS scope as Tournament Stats above, so Player Stats
// and Tournament Stats always agree on what counts as "this tour").
//
// Played = distinct tournament EDITIONS (competition+year) this player
// appeared in at least once — not matches. Wins = tournament titles (won
// the singles draw's Final), not match wins. Broken out Grand-Slam-only
// (G.Slam/Wins) and as a title-conversion rate (Finals/Wins — every Final
// reached, won or lost, vs how many were won). Only actually-held editions
// count (status past/ongoing, year <= selected year) — same "as of viewed
// year" rule as everywhere else.
//
// is_active_now — fixed to the real current calendar year regardless of
// which year is being browsed (same convention F1DriversAllTimeTemplate's
// is_current_grid uses: "Active" means the same players whether browsing
// through 2026 or through 1990), so it needs its OWN unbounded-by-$4 CTEs
// rather than reusing the "through <year>" appearances above.
router.get('/player-totals/:tour/:year', async (req, res, next) => {
  try {
    const { tour, year } = req.params;
    const categorySlugs = TOTALS_CATEGORY_SLUGS[tour];
    if (!categorySlugs) return res.status(400).json({ error: 'tour must be atp or wta' });
    const gender = tour === 'wta' ? 'F' : 'M';
    const yearInt = parseInt(year);
    const m1000Slug = TOUR_M1000_SLUG[tour];
    const finalsSlug = TOUR_FINALS_SLUG[tour];
    const m500Slug = TOUR_M500_SLUG[tour];
    const m250Slug = TOUR_M250_SLUG[tour];

    const rows = await queryAll(`
      WITH editions AS (
        SELECT c.id AS competition_id, s.id AS season_id, s.year, ec.slug AS category_slug
        FROM seasons s
        JOIN competitions c ON c.id = s.competition_id
        JOIN event_categories ec ON ec.id = c.category_id
        WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
          AND s.year <= $4 AND s.status IN ('past', 'ongoing')
      ),
      draws AS (
        SELECT e.competition_id, e.season_id, e.year, e.category_slug, rt.id AS result_tab_id
        FROM editions e
        JOIN result_tabs rt ON rt.season_id = e.season_id AND rt.tab_key = ('draw-singles-' || lower($3))
      ),
      appearances AS (
        SELECT d.competition_id, d.season_id, d.year, d.category_slug, g.home_entity_id AS entity_id
        FROM draws d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.home_entity_id IS NOT NULL
        UNION
        SELECT d.competition_id, d.season_id, d.year, d.category_slug, g.away_entity_id AS entity_id
        FROM draws d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.away_entity_id IS NOT NULL
      ),
      distinct_appearances AS (
        SELECT DISTINCT competition_id, season_id, year, category_slug, entity_id FROM appearances
      ),
      player_stats AS (
        SELECT entity_id,
          COUNT(*) AS played_all,
          COUNT(*) FILTER (WHERE category_slug = 'grand-slam') AS played_gs,
          COUNT(*) FILTER (WHERE category_slug = $5) AS played_m1000,
          COUNT(DISTINCT year) AS season_count,
          MIN(year) AS debut_year,
          MAX(year) AS last_season_year
        FROM distinct_appearances
        GROUP BY entity_id
      ),
      finals AS (
        SELECT d.category_slug, g.winner_entity_id, g.home_entity_id, g.away_entity_id
        FROM draws d
        JOIN games g ON g.result_tab_id = d.result_tab_id AND g.round = 'Final'
        WHERE g.winner_entity_id IS NOT NULL
      ),
      -- Best (lowest) ATP/WTA ranking on record, through the selected year
      -- — TML's per-match stats carry w_rank/l_rank (the winner's/loser's
      -- own ranking on that match date), keyed by winner/loser rather than
      -- home/away, remapped here same as the frontend's rankFor() does for
      -- a single match (Homepage's Performances tab, 2026-08-20: "Add best
      -- rankings in columns performance").
      match_ranks AS (
        SELECT g.home_entity_id AS entity_id,
          (CASE WHEN g.winner_entity_id = g.home_entity_id THEN g.stats->>'w_rank' ELSE g.stats->>'l_rank' END)::int AS rank
        FROM draws d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.home_entity_id IS NOT NULL AND g.winner_entity_id IS NOT NULL
        UNION ALL
        SELECT g.away_entity_id AS entity_id,
          (CASE WHEN g.winner_entity_id = g.away_entity_id THEN g.stats->>'w_rank' ELSE g.stats->>'l_rank' END)::int AS rank
        FROM draws d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.away_entity_id IS NOT NULL AND g.winner_entity_id IS NOT NULL
      ),
      best_rank_stats AS (
        SELECT entity_id, MIN(rank) AS best_rank
        FROM match_ranks
        WHERE rank IS NOT NULL
        GROUP BY entity_id
      ),
      finalists AS (
        SELECT category_slug, winner_entity_id AS entity_id, TRUE AS is_win FROM finals
        UNION ALL
        SELECT category_slug,
          CASE WHEN winner_entity_id = home_entity_id THEN away_entity_id ELSE home_entity_id END AS entity_id,
          FALSE AS is_win
        FROM finals
      ),
      title_stats AS (
        SELECT entity_id,
          COUNT(*) AS finals_all,
          COUNT(*) FILTER (WHERE is_win) AS wins_all,
          COUNT(*) FILTER (WHERE category_slug = 'grand-slam') AS finals_gs,
          COUNT(*) FILTER (WHERE is_win AND category_slug = 'grand-slam') AS wins_gs,
          COUNT(*) FILTER (WHERE is_win AND category_slug = $5) AS wins_m1000,
          COUNT(*) FILTER (WHERE is_win AND category_slug = $6) AS wins_finals,
          COUNT(*) FILTER (WHERE is_win AND category_slug = $7) AS wins_m500,
          COUNT(*) FILTER (WHERE is_win AND category_slug = $8) AS wins_m250
        FROM finalists
        GROUP BY entity_id
      ),
      current_year_editions AS (
        SELECT c.id AS competition_id, s.id AS season_id
        FROM seasons s
        JOIN competitions c ON c.id = s.competition_id
        JOIN event_categories ec ON ec.id = c.category_id
        WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
          AND s.year = EXTRACT(YEAR FROM CURRENT_DATE)::int AND s.status IN ('past', 'ongoing')
      ),
      current_draws AS (
        SELECT rt.id AS result_tab_id
        FROM current_year_editions e
        JOIN result_tabs rt ON rt.season_id = e.season_id AND rt.tab_key = ('draw-singles-' || lower($3))
      ),
      active_entities AS (
        SELECT DISTINCT g.home_entity_id AS entity_id FROM current_draws d JOIN games g ON g.result_tab_id = d.result_tab_id WHERE g.home_entity_id IS NOT NULL
        UNION
        SELECT DISTINCT g.away_entity_id AS entity_id FROM current_draws d JOIN games g ON g.result_tab_id = d.result_tab_id WHERE g.away_entity_id IS NOT NULL
      )
      SELECT e.id AS entity_id, e.canonical_name, e.slug, e.gender, e.birth_date, e.death_date,
        co.iso2 AS country_iso2, co.name AS country_name,
        ps.played_all, ps.played_gs, ps.played_m1000, ps.season_count, ps.debut_year, ps.last_season_year,
        COALESCE(ts.wins_all, 0) AS wins_all, COALESCE(ts.wins_gs, 0) AS wins_gs,
        COALESCE(ts.wins_m1000, 0) AS wins_m1000,
        COALESCE(ts.wins_finals, 0) AS wins_finals,
        COALESCE(ts.wins_m500, 0) AS wins_m500,
        COALESCE(ts.wins_m250, 0) AS wins_m250,
        COALESCE(ts.finals_all, 0) AS finals_all, COALESCE(ts.finals_gs, 0) AS finals_gs,
        (ae.entity_id IS NOT NULL) AS is_active_now,
        brs.best_rank
      FROM player_stats ps
      JOIN entities e ON e.id = ps.entity_id
      LEFT JOIN countries co        ON co.id = e.country_id
      LEFT JOIN title_stats ts      ON ts.entity_id = ps.entity_id
      LEFT JOIN active_entities ae  ON ae.entity_id = ps.entity_id
      LEFT JOIN best_rank_stats brs ON brs.entity_id = ps.entity_id
    `, [TENNIS_SPORT_ID, categorySlugs, gender, yearInt, m1000Slug, finalsSlug, m500Slug, m250Slug]);

    res.json({
      data: {
        tour, year: yearInt,
        players: rows.map(r => ({
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          gender: r.gender,
          birth_date: r.birth_date,
          death_date: r.death_date,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          season_count: Number(r.season_count),
          debut_year: r.debut_year,
          // Last season this player actually appeared in, through the
          // selected year — caps the "<debut>-<?>" range at their real
          // career end (death/retirement), not always the viewed year
          // (found 2026-08-16: Senna showing "1984-2026" instead of
          // "1984-1994" on the F1 equivalent — same bug, same fix, applied
          // here too).
          last_season_year: r.last_season_year,
          played_all: Number(r.played_all),
          wins_all: Number(r.wins_all),
          played_gs: Number(r.played_gs),
          wins_gs: Number(r.wins_gs),
          played_m1000: Number(r.played_m1000),
          wins_m1000: Number(r.wins_m1000),
          wins_finals: Number(r.wins_finals),
          wins_m500: Number(r.wins_m500),
          wins_m250: Number(r.wins_m250),
          finals_all: Number(r.finals_all),
          finals_gs: Number(r.finals_gs),
          is_active: r.is_active_now,
          best_rank: r.best_rank != null ? Number(r.best_rank) : null,
        })),
        count: rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ATP/WTA Watch Center (Line A pinned "Watch center" icon, tour-wide) —
// same cross-category reach as /totals and /player-totals above (every
// category in TOTALS_CATEGORY_SLUGS[tour], not just whichever one is on
// screen), returning the exact { items, total } shape GET
// /results/iconic-moments/:seasonId already returns so the frontend can
// reuse IconicMomentsTemplate unmodified via its fetchMoments prop (same
// reuse pattern F1's getF1IconicMoments already established). Scoped to
// the exact selected year (not cumulative through it) — a video gallery
// is a per-edition thing, not a career total.
router.get('/iconic-moments-totals/:tour/:year', async (req, res, next) => {
  try {
    const { tour, year } = req.params;
    const categorySlugs = TOTALS_CATEGORY_SLUGS[tour];
    if (!categorySlugs) return res.status(400).json({ error: 'tour must be atp or wta' });
    const gender = tour === 'wta' ? 'F' : 'M';
    const yearInt = parseInt(year);
    const { category, tag } = req.query;

    const params = [TENNIS_SPORT_ID, categorySlugs, gender, yearInt];
    let extra = '';
    if (category) { params.push(category); extra += ` AND m.category = $${params.length}`; }
    if (tag)      { params.push(tag);      extra += ` AND $${params.length} = ANY(m.tags)`; }

    const items = await queryAll(`
      SELECT m.id, m.video_url, m.source, m.embeddable, m.title, m.category, m.tags,
             m.thumbnail_url, m.display_order, m.duration_seconds, m.view_count,
             c.name AS competition_name
      FROM media m
      JOIN seasons s ON s.id = m.season_id
      JOIN competitions c ON c.id = s.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
        AND s.year = $4 AND s.status IN ('past', 'ongoing')
        AND m.media_type = 'iconic_moment' ${extra}
      ORDER BY m.view_count DESC NULLS LAST, m.display_order ASC, m.id ASC
    `, params);

    res.json({ data: { items, total: items.length } });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/match-videos-totals/:tour/:year
// Watch Center's "Match Videos" section (Mohamed 2026-08-19: "compile
// Match Videos and Iconic moments in a single page") — same tour-wide,
// per-selected-year scope as iconic-moments-totals above, pointed at the
// OTHER media_type this same table already carries ('match_summary', 16
// rows in the DB today vs iconic_moment's 10 — the two were always
// sitting in one table, just never surfaced together). Each row is tied
// to a real game_id, so round/opponents come from the game itself rather
// than needing their own columns on media.
router.get('/match-videos-totals/:tour/:year', async (req, res, next) => {
  try {
    const { tour, year } = req.params;
    const categorySlugs = TOTALS_CATEGORY_SLUGS[tour];
    if (!categorySlugs) return res.status(400).json({ error: 'tour must be atp or wta' });
    const gender = tour === 'wta' ? 'F' : 'M';
    const yearInt = parseInt(year);

    const items = await queryAll(`
      SELECT m.id, m.video_url, m.source, m.embeddable, m.title, m.tags,
             m.thumbnail_url, m.display_order, m.duration_seconds, m.view_count,
             g.round, c.name AS competition_name,
             home.canonical_name AS home_name, away.canonical_name AS away_name
      FROM media m
      JOIN games g              ON g.id = m.game_id
      LEFT JOIN entities home   ON home.id = g.home_entity_id
      LEFT JOIN entities away   ON away.id = g.away_entity_id
      JOIN result_tabs rt       ON rt.id = g.result_tab_id
      JOIN seasons s            ON s.id = rt.season_id
      JOIN competitions c       ON c.id = s.competition_id
      JOIN event_categories ec  ON ec.id = c.category_id
      WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
        AND s.year = $4 AND s.status IN ('past', 'ongoing')
        AND m.media_type = 'match_summary'
      ORDER BY
        -- "Default order. Final, Semi, Final etc." — round significance,
        -- not date/id. Matched on substring rather than an exact-value
        -- map since real round text varies ('Final'/'Round of 32'/etc,
        -- confirmed via the actual ingested rows) and this holds for any
        -- future one without a code change (same convention-over-
        -- configuration reasoning as everywhere else in this codebase).
        CASE
          WHEN g.round ILIKE '%final%' AND g.round NOT ILIKE '%semi%' AND g.round NOT ILIKE '%quarter%' THEN 1
          WHEN g.round ILIKE '%semi%' THEN 2
          WHEN g.round ILIKE '%quarter%' THEN 3
          WHEN g.round ILIKE '%16%' THEN 4
          WHEN g.round ILIKE '%32%' THEN 5
          WHEN g.round ILIKE '%64%' THEN 6
          WHEN g.round ILIKE '%128%' THEN 7
          ELSE 8
        END,
        m.display_order ASC, m.id ASC
    `, [TENNIS_SPORT_ID, categorySlugs, gender, yearInt]);

    res.json({ data: { items, total: items.length } });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/rankings/:tour/:year
// ATP/WTA Rankings — one row per player ranked at the end of the selected
// year. Rank/Points are NOT a continuous live feed — this DB only stores
// a per-match snapshot (games.stats->>'w_rank'/'l_rank' + paired
// 'w_rank_pts'/'l_rank_pts') — so "rank as of <year>" is each player's
// LATEST such snapshot (by match_date) from a singles match played in
// that year specifically, not their best. For the real current year this
// naturally resolves to "latest we have" since the season isn't over yet
// (Mohamed 2026-08-16: "2025 should display atp points at the end of
// 2025... 2026 should display the latest ranking we have" — same query,
// no special-casing needed). Tournaments/Titles I Finals/Games Played are
// scoped to THIS year only (not career totals — Mohamed: "tournaments
// won/played in 2025"), while Seasons/debut_year stay a career-through-
// this-year count, same "through <year>" convention every other Totals
// page uses (age likewise: as of this year, not accumulated within it).
// Only players with a snapshot in the selected year are included (INNER
// JOIN on year_rank) — known limitation, not a bug: a player who only
// played tournaments outside TOTALS_CATEGORY_SLUGS (Challenger/ITF-tier
// events this DB doesn't ingest) or sat out every tracked category that
// year has no snapshot at all, so real rank numbers can skip (e.g. 262 ->
// 278) wherever such a player would have sat. The numbers themselves are
// real; the list just isn't a complete consecutive Top-N.
router.get('/rankings/:tour/:year', async (req, res, next) => {
  try {
    const { tour, year } = req.params;
    const categorySlugs = TOTALS_CATEGORY_SLUGS[tour];
    if (!categorySlugs) return res.status(400).json({ error: 'tour must be atp or wta' });
    const gender = tour === 'wta' ? 'F' : 'M';
    const yearInt = parseInt(year);

    const rows = await queryAll(`
      WITH editions_through_year AS (
        SELECT s.id AS season_id, s.year
        FROM seasons s
        JOIN competitions c ON c.id = s.competition_id
        JOIN event_categories ec ON ec.id = c.category_id
        WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
          AND s.year <= $4 AND s.status IN ('past', 'ongoing')
      ),
      draws_through_year AS (
        SELECT e.season_id, e.year, rt.id AS result_tab_id
        FROM editions_through_year e
        JOIN result_tabs rt ON rt.season_id = e.season_id AND rt.tab_key = ('draw-singles-' || lower($3))
      ),
      appearances_through_year AS (
        SELECT d.year, g.home_entity_id AS entity_id
        FROM draws_through_year d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.home_entity_id IS NOT NULL
        UNION
        SELECT d.year, g.away_entity_id
        FROM draws_through_year d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.away_entity_id IS NOT NULL
      ),
      player_stats AS (
        SELECT entity_id,
          COUNT(DISTINCT year) AS season_count,
          MIN(year) AS debut_year
        FROM (SELECT DISTINCT year, entity_id FROM appearances_through_year) da
        GROUP BY entity_id
      ),
      -- Same shape as above, scoped to ONLY the selected year — backs
      -- Tournaments/Titles I Finals/Games Played, which are single-season
      -- figures on this page, not career totals.
      editions_this_year AS (
        SELECT s.id AS season_id
        FROM seasons s
        JOIN competitions c ON c.id = s.competition_id
        JOIN event_categories ec ON ec.id = c.category_id
        WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
          AND s.year = $4 AND s.status IN ('past', 'ongoing')
      ),
      draws_this_year AS (
        SELECT e.season_id, rt.id AS result_tab_id
        FROM editions_this_year e
        JOIN result_tabs rt ON rt.season_id = e.season_id AND rt.tab_key = ('draw-singles-' || lower($3))
      ),
      -- season_id carried through so DISTINCT below counts one row PER
      -- TOURNAMENT per player, not one row per player total — dropping it
      -- (as an earlier version of this query did) collapses every player
      -- to a single row before COUNT ever runs, making Tournaments always
      -- read 1 regardless of how many editions they actually played
      -- (found 2026-08-16: Sinner showing "1" despite 6 finals that year).
      appearances_this_year AS (
        SELECT d.season_id, g.home_entity_id AS entity_id
        FROM draws_this_year d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.home_entity_id IS NOT NULL
        UNION
        SELECT d.season_id, g.away_entity_id
        FROM draws_this_year d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.away_entity_id IS NOT NULL
      ),
      year_stats AS (
        SELECT entity_id, COUNT(*) AS tournaments
        FROM (SELECT DISTINCT season_id, entity_id FROM appearances_this_year) da
        GROUP BY entity_id
      ),
      finals AS (
        SELECT g.winner_entity_id, g.home_entity_id, g.away_entity_id
        FROM draws_this_year d
        JOIN games g ON g.result_tab_id = d.result_tab_id AND g.round = 'Final'
        WHERE g.winner_entity_id IS NOT NULL
      ),
      finalists AS (
        SELECT winner_entity_id AS entity_id, TRUE AS is_win FROM finals
        UNION ALL
        SELECT CASE WHEN winner_entity_id = home_entity_id THEN away_entity_id ELSE home_entity_id END AS entity_id, FALSE AS is_win
        FROM finals
      ),
      title_stats AS (
        SELECT entity_id, COUNT(*) AS finals_year, COUNT(*) FILTER (WHERE is_win) AS wins_year
        FROM finalists GROUP BY entity_id
      ),
      -- Individual match win/loss for the selected year only. A match
      -- with no winner recorded (walkover before a ball was struck etc.)
      -- is excluded from both the played and won counts rather than
      -- guessing.
      match_rows AS (
        SELECT g.home_entity_id AS entity_id, (g.winner_entity_id = g.home_entity_id) AS is_win
        FROM draws_this_year d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.home_entity_id IS NOT NULL AND g.winner_entity_id IS NOT NULL
        UNION ALL
        SELECT g.away_entity_id, (g.winner_entity_id = g.away_entity_id)
        FROM draws_this_year d JOIN games g ON g.result_tab_id = d.result_tab_id
        WHERE g.away_entity_id IS NOT NULL AND g.winner_entity_id IS NOT NULL
      ),
      match_stats AS (
        SELECT entity_id, COUNT(*) AS games_played, COUNT(*) FILTER (WHERE is_win) AS games_won
        FROM match_rows GROUP BY entity_id
      ),
      -- Latest (not best) rank/points snapshot within the selected year —
      -- "as of the end of that year", or "latest we have" for the real
      -- current year still in progress. DISTINCT ON ... ORDER BY match_date
      -- DESC, not rank_val ASC (that was the old "best this season" logic).
      year_rank AS (
        SELECT DISTINCT ON (entity_id)
               entity_id, rank_val::int AS rank, pts_val::int AS points
        FROM (
          SELECT g.home_entity_id AS entity_id, g.match_date,
                 (g.stats->>'w_rank')::int AS rank_val,
                 (g.stats->>'w_rank_pts')::int AS pts_val
          FROM draws_this_year d JOIN games g ON g.result_tab_id = d.result_tab_id
          WHERE (g.stats->>'w_rank') ~ '^[0-9]+$'

          UNION ALL

          SELECT g.away_entity_id, g.match_date,
                 (g.stats->>'l_rank')::int,
                 (g.stats->>'l_rank_pts')::int
          FROM draws_this_year d JOIN games g ON g.result_tab_id = d.result_tab_id
          WHERE (g.stats->>'l_rank') ~ '^[0-9]+$'
        ) ranked
        ORDER BY entity_id, match_date DESC NULLS LAST
      )
      SELECT e.id AS entity_id, e.canonical_name, e.slug, e.gender, e.birth_date, e.death_date,
        e.image_url,
        co.iso2 AS country_iso2, co.name AS country_name,
        COALESCE(ps.season_count, 0) AS season_count,
        ps.debut_year,
        COALESCE(ys.tournaments, 0) AS tournaments,
        COALESCE(ts.wins_year, 0) AS wins_year,
        COALESCE(ts.finals_year, 0) AS finals_year,
        COALESCE(ms.games_played, 0) AS games_played,
        COALESCE(ms.games_won, 0) AS games_won,
        yr.rank, yr.points
      FROM year_rank yr
      JOIN entities e            ON e.id = yr.entity_id
      LEFT JOIN countries co     ON co.id = e.country_id
      LEFT JOIN player_stats ps  ON ps.entity_id = yr.entity_id
      LEFT JOIN year_stats ys    ON ys.entity_id = yr.entity_id
      LEFT JOIN title_stats ts   ON ts.entity_id = yr.entity_id
      LEFT JOIN match_stats ms   ON ms.entity_id = yr.entity_id
      ORDER BY yr.rank ASC
    `, [TENNIS_SPORT_ID, categorySlugs, gender, yearInt]);

    // Tour-wide summary counts for the Rankings banner's bottom bar
    // (Mohamed 2026-08-19: "SCHEDULE: 2026 I SEASONS I PLAYERS I
    // TOURNAMENTS" replacing the title+follower line there). Seasons is a
    // fixed career total (all years this tour has data for, not bounded by
    // the selected year — same "since 1968" framing as the YearSelector's
    // own range); Tournaments is scoped to the selected year, one row per
    // editions_this_year above; Players reuses rows.length (already the
    // selected year's player count, same number the table's own "N
    // players" filter-bar total shows).
    const totalSeasonsRow = await queryOne(`
      SELECT COUNT(DISTINCT s.year) AS n
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3 AND s.status IN ('past', 'ongoing')
    `, [TENNIS_SPORT_ID, categorySlugs, gender]);
    const totalTournamentsRow = await queryOne(`
      SELECT COUNT(*) AS n
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
        AND s.year = $4 AND s.status IN ('past', 'ongoing')
    `, [TENNIS_SPORT_ID, categorySlugs, gender, yearInt]);

    // No.1 stat-row context for the leader row (EventBlock's
    // TennisRankingsBlock) — Mohamed 2026-08-19: the row's VALUE is not
    // leader.rank (always 1 by definition — this IS the #1 player, showing
    // "1" every single year told Mohamed nothing, "why Federer, Djokovic,
    // etc. shows always 1?"). It's now career_no1_count — how many distinct
    // years (through the selected year) this player has been the tour's
    // #1 — so Djokovic reads e.g. "8", not "1". "+1" badge fires only the
    // year that count just grew (a NEW No.1 stint started — they weren't
    // #1 last year), never every year they simply hold onto it. Caption:
    // "since last year" if they led last year too (no growth, no badge);
    // "1st time" only if career_no1_count is exactly 1 (this is the very
    // first year they've ever been #1); any other case (reclaiming #1
    // after losing it — count > 1 but not consecutive with last year)
    // shows no caption, confirmed explicitly rather than guessed.
    let no1Context = null;
    if (rows.length) {
      const leaderEntityId = rows[0].entity_id;
      const yearLeaderRows = await queryAll(`
        WITH yearly_rank AS (
          SELECT s.year, g.home_entity_id AS entity_id, g.match_date, (g.stats->>'w_rank')::int AS rank_val
          FROM seasons s
          JOIN competitions c ON c.id = s.competition_id
          JOIN event_categories ec ON ec.id = c.category_id
          JOIN result_tabs rt ON rt.season_id = s.id AND rt.tab_key = ('draw-singles-' || lower($3))
          JOIN games g ON g.result_tab_id = rt.id
          WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
            AND s.year <= $4 AND s.status IN ('past', 'ongoing') AND g.home_entity_id IS NOT NULL
            AND (g.stats->>'w_rank') ~ '^[0-9]+$'
          UNION ALL
          SELECT s.year, g.away_entity_id, g.match_date, (g.stats->>'l_rank')::int
          FROM seasons s
          JOIN competitions c ON c.id = s.competition_id
          JOIN event_categories ec ON ec.id = c.category_id
          JOIN result_tabs rt ON rt.season_id = s.id AND rt.tab_key = ('draw-singles-' || lower($3))
          JOIN games g ON g.result_tab_id = rt.id
          WHERE ec.sport_id = $1 AND ec.slug = ANY($2::text[]) AND s.gender = $3
            AND s.year <= $4 AND s.status IN ('past', 'ongoing') AND g.away_entity_id IS NOT NULL
            AND (g.stats->>'l_rank') ~ '^[0-9]+$'
        ),
        year_snapshot AS (
          SELECT DISTINCT ON (year, entity_id) year, entity_id, rank_val AS rank, match_date
          FROM yearly_rank
          ORDER BY year, entity_id, match_date DESC NULLS LAST
        )
        SELECT DISTINCT ON (year) year, entity_id
        FROM year_snapshot
        ORDER BY year, rank ASC
      `, [TENNIS_SPORT_ID, categorySlugs, gender, yearInt]);

      const leaderYears = yearLeaderRows.filter(r => r.entity_id === leaderEntityId).map(r => r.year);
      const careerNo1Count = leaderYears.length;
      const prevYearLeader = yearLeaderRows.find(r => r.year === yearInt - 1);
      const wasLeaderLastYear = prevYearLeader?.entity_id === leaderEntityId;
      // Most recent PRIOR year (before the selected year) this same player
      // was also No.1 — powers the new "Last No.1" row (Mohamed 2026-08-19:
      // "after No 1, place Last No1: 2 y ago 1998"). null when this is
      // their first-ever No.1 year (nothing prior to point to).
      const priorNo1Years = leaderYears.filter(y => y < yearInt);
      const lastNo1Year = priorNo1Years.length ? Math.max(...priorNo1Years) : null;

      no1Context = {
        value: careerNo1Count,
        badge: !wasLeaderLastYear,
        caption: wasLeaderLastYear ? 'since_last_year' : (careerNo1Count === 1 ? 'first_time' : null),
        last_no1_year: lastNo1Year,
      };
    }

    res.json({
      data: {
        tour, year: yearInt,
        players: rows.map(r => ({
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          gender: r.gender,
          birth_date: r.birth_date,
          death_date: r.death_date,
          image_url: r.image_url,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          season_count: Number(r.season_count),
          debut_year: r.debut_year,
          tournaments: Number(r.tournaments),
          wins_year: Number(r.wins_year),
          finals_year: Number(r.finals_year),
          games_played: Number(r.games_played),
          games_won: Number(r.games_won),
          games_lost: Number(r.games_played) - Number(r.games_won),
          rank: r.rank,
          points: r.points,
        })),
        count: rows.length,
        no1_context: no1Context,
        total_seasons: Number(totalSeasonsRow?.n || 0),
        total_tournaments: Number(totalTournamentsRow?.n || 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug
router.get('/:slug', async (req, res, next) => {
  try {
    const competition = await queryOne(`
      SELECT
        c.id,
        c.name,
        c.sidebar_name,
        c.short_code,
        c.slug,
        c.country_id,
        c.logo_url,
        c.sidebar_logo_url,
        c.bg_image_url,
        c.city,
        c.surface,
        c.gender,
        c.competition_type,
        c.edition_years,
        c.organiser,
        c.owner,
        c.website,
        c.founded_year,
        c.dissolved_year,
        c.first_data_year,
        c.valid_from,
        c.valid_to,
        c.column_config,
        c.primary_color,
        c.secondary_color,
        c.third_color,
        c.cancelled_years,
        c.cancelled_editions,
        c.year_convention,
        ec.id             AS category_id,
        ec.canonical_name AS category_name,
        ec.short_name     AS category_short,
        ec.slug           AS category_slug,
        ec.level,
        ec.localisation,
        ec.confederation,
        s.id              AS sport_id,
        s.name            AS sport_name,
        s.slug            AS sport_slug,
        s.display_pattern,
        co.iso2           AS country_iso2,
        co.name           AS country_name,
        (SELECT MIN(year) FROM seasons WHERE competition_id = c.id) AS first_season_year
      FROM competitions c
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN sports s ON s.id = ec.sport_id
      LEFT JOIN countries co ON co.id = c.country_id
      WHERE c.slug = $1 AND (c.is_active = TRUE OR c.valid_to IS NOT NULL)
    `, [req.params.slug]);

    if (!competition) {
      return res.status(404).json({ error: 'Competition not found' });
    }

    // Prefer the surface actually played in this competition's most recent
    // draw-singles matches (real ingested data) over the static c.surface
    // field, same "games data wins, static field is only the fallback"
    // rule /totals and /home already use — otherwise a competition whose
    // static field was simply never set shows as blank in the admin even
    // though the public site already knows its real surface from match
    // data (found 2026-08-16: Halle showing "— Not set —" in the admin
    // despite "Grass" on the public Tournament Stats page).
    const latestSurfaceRow = await queryOne(`
      SELECT g.surface
      FROM seasons s
      JOIN result_tabs rt ON rt.season_id = s.id AND rt.tab_key = ('draw-singles-' || lower(COALESCE(s.gender, 'm')))
      JOIN games g ON g.result_tab_id = rt.id AND g.surface IS NOT NULL
      WHERE s.competition_id = $1
      ORDER BY s.year DESC, g.id DESC
      LIMIT 1
    `, [competition.id]);
    const SURFACE_MAP = { clay: 'Clay', grass: 'Grass', hard: 'Hard', indoor_hard: 'Hard' };
    const rawSurface = latestSurfaceRow?.surface || competition.surface;
    competition.surface = rawSurface ? (SURFACE_MAP[rawSurface.toLowerCase()] || null) : null;

    const events = await queryAll(`
      SELECT e.id, e.name, e.slug, e.display_order,
        EXISTS (
          SELECT 1 FROM seasons s
          JOIN result_tabs rt ON rt.season_id = s.id
          WHERE s.event_id = e.id AND rt.typology = 'iconic_moments'
        ) AS is_gallery
      FROM events e
      WHERE e.competition_id = $1 AND e.is_active = TRUE
      ORDER BY e.display_order
    `, [competition.id]);

    const years = await queryAll(`
      SELECT DISTINCT year, status
      FROM seasons
      WHERE competition_id = $1
      ORDER BY year DESC
    `, [competition.id]);

    const naming = await queryOne(`
      SELECT official_name, title_sponsor, partner, prize_money
      FROM competition_naming
      WHERE competition_id = $1
        AND (end_year IS NULL OR end_year >= EXTRACT(YEAR FROM NOW()))
      ORDER BY start_year DESC
      LIMIT 1
    `, [competition.id]);

    res.json({
      data: {
        ...competition,
        current_naming: naming,
        events,
        available_years: years,
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/logo/:year
router.get('/:slug/logo/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;

    const override = await queryOne(`
      SELECT cl.logo_url
      FROM competition_logos cl
      JOIN competitions c ON c.id = cl.competition_id
      WHERE c.slug = $1
        AND cl.start_year <= $2
        AND (cl.end_year IS NULL OR cl.end_year >= $2)
      ORDER BY cl.start_year DESC
      LIMIT 1
    `, [slug, parseInt(year)]);

    if (override) {
      return res.json({ data: { logo_url: override.logo_url, source: 'era_override' } });
    }

    const comp = await queryOne(`SELECT logo_url FROM competitions WHERE slug = $1`, [slug]);
    res.json({ data: { logo_url: comp?.logo_url ?? null, source: 'default' } });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/events/:year
// Year-scoped variant of the plain :slug events list. Most Line A events are
// always shown regardless of data — three exceptions, all NBA-specific
// (competition_id=4828) since that's the only competition so far with
// events that genuinely didn't exist for its whole backfilled year range:
//   1. Any event whose season carries an 'iconic_moments' result_tab
//      (currently just NBA's Iconic Moments event): gated on actual video
//      content existing for the requested year, so the button only appears
//      once a video has been added for that season. Detected generically
//      via typology rather than by name/slug, so any future sport reusing
//      this event-per-gallery pattern gets the same behavior for free.
//   2. A fixed list of NBA event slugs (see GATED_NBA_EVENT_SLUGS below),
//      each gated on real content (games/standings/player_season_stats)
//      existing for the requested year — added 2026-08-25 per Mohamed's nav
//      cleanup request ("no point showing Awards before 1956, it's just an
//      empty tab"). This is the route that actually drives the Line A nav
//      bar (the /api/seasons route drives the page content below it and
//      needed the identical, independent fix for Play-in/NBA Cup already).
//      Deliberately scoped to this named list rather than a blanket
//      "every event needs content" rule — that would also hide OTHER
//      sports' legitimately-empty upcoming/future seasons, which this was
//      never meant to touch.
const GATED_NBA_EVENT_SLUGS = [
  'finals-4828', 'playoffs-4828', 'play-in-4828', 'nba-cup-4828',
  'awards-4828', 'team-of-the-year-4828', 'all-star-4828',
];
router.get('/:slug/events/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;

    const comp = await queryOne(`SELECT id, year_convention FROM competitions WHERE slug = $1`, [slug]);
    if (!comp) return res.status(404).json({ error: 'Competition not found' });

    const yearInt = parseInt(year);
    const dbYear = comp.year_convention === 'start' ? yearInt - 1 : yearInt;

    const events = await queryAll(`
      SELECT e.id, e.name, e.slug, e.display_order,
        EXISTS (
          SELECT 1 FROM seasons s
          JOIN result_tabs rt ON rt.season_id = s.id
          WHERE s.event_id = e.id AND rt.typology = 'iconic_moments'
        ) AS is_gallery
      FROM events e
      WHERE e.competition_id = $1 AND e.is_active = TRUE
        AND (
          NOT EXISTS (
            SELECT 1 FROM seasons s
            JOIN result_tabs rt ON rt.season_id = s.id
            WHERE s.event_id = e.id AND rt.typology = 'iconic_moments'
          )
          OR EXISTS (
            SELECT 1 FROM seasons s
            JOIN result_tabs rt ON rt.season_id = s.id
            JOIN media m ON m.season_id = s.id AND m.media_type = 'iconic_moment' AND m.is_active = TRUE
            WHERE s.event_id = e.id AND rt.typology = 'iconic_moments' AND s.year = $2
          )
        )
        AND (
          NOT (e.slug = ANY($3::text[]))
          OR EXISTS (
            SELECT 1 FROM seasons s
            JOIN result_tabs rt ON rt.season_id = s.id
            WHERE s.event_id = e.id AND s.year = $2
              AND (
                EXISTS (SELECT 1 FROM games g WHERE g.result_tab_id = rt.id)
                OR EXISTS (SELECT 1 FROM standings st WHERE st.result_tab_id = rt.id)
                OR EXISTS (SELECT 1 FROM player_season_stats pss WHERE pss.result_tab_id = rt.id)
              )
          )
        )
      ORDER BY e.display_order
    `, [comp.id, dbYear, GATED_NBA_EVENT_SLUGS]);

    res.json({ data: events });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/naming/:year
router.get('/:slug/naming/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;

    const naming = await queryOne(`
      SELECT cn.official_name, cn.title_sponsor, cn.partner, cn.prize_money,
             cn.start_year, cn.end_year
      FROM competition_naming cn
      JOIN competitions c ON c.id = cn.competition_id
      WHERE c.slug = $1
        AND (cn.start_year IS NULL OR cn.start_year <= $2)
        AND (cn.end_year IS NULL OR cn.end_year >= $2)
      ORDER BY cn.start_year DESC NULLS LAST
      LIMIT 1
    `, [slug, parseInt(year)]);

    res.json({ data: naming });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/category-era/:year — the tier's ORIGINAL name
// at the viewed year (e.g. Indian Wells 1992 was "ATP Championship Series
// Single Week", not yet "Masters 1000" — that name only started in 2009).
// Distinct from event_categories.canonical_name/short_name, which are the
// category's fixed, present-day identity used everywhere else (Line A
// labels, the Home hub's "Sort by:" filter, etc.) — those never change by
// year. Only returns a row when the era's original_name actually differs
// from the category's current name; a category with no rename history
// (e.g. Challenger, unchanged since inception) simply has no rows here.
router.get('/:slug/category-era/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;

    const era = await queryOne(`
      SELECT ece.original_name
      FROM event_category_eras ece
      JOIN competitions c ON c.category_id = ece.category_id
      WHERE c.slug = $1
        AND ece.start_year <= $2
        AND (ece.end_year IS NULL OR ece.end_year >= $2)
      ORDER BY ece.start_year DESC
      LIMIT 1
    `, [slug, parseInt(year)]);

    res.json({ data: era });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/year-range — the full navigable span for this
// competition's YearSelector. NOT just this competition's own
// founded_year–dissolved_year: it's the EARLIEST of (a) the category's own
// founded_year and (b) MIN(founded_year) across every competition sharing
// that category_id. Fixes 2026-08-10: Next Gen Finals (founded 2017) shares
// the "ATP Finals" category with Masters Finals (founded 1990) — bounding
// the strip to 2017-2026 alone made it look truncated/broken. The category
// row itself can predate every current competition row under it (ATP
// Finals the category was founded 1970, six years before the oldest
// competition row currently modeling it, 1990) — checked 2026-08-10 after
// Mohamed asked why 1989/1988 weren't shown/greyed; without this the strip
// silently missed real years the category covers. Applies uniformly to
// every competition (sport-agnostic, purely data-driven — never fabricates
// a range), not a tennis special case. Years inside this range but outside
// the competition's OWN founded/dissolved are real years, just ones where
// THIS competition had no edition — the frontend greys those out rather
// than hiding them.
// first_data_year for the actual Totals/All-Time page range (Mohamed
// 2026-08-26: "false since data is displayed from 1st season ingested to
// year selection" — founded_year/category range above answers a different
// question, "how far back should the year-selector strip scroll", and can
// disagree with the real data: Saudi Pro League's founded_year is 1976 but
// only its 2027 season is actually ingested, which made the Totals
// breadcrumb claim 51 years of coverage that don't exist). THIS
// competition's own seasons only — never widened to sibling competitions
// sharing a category, unlike minYear/maxYear above, since Totals pages
// never aggregate across sibling competitions either. year_convention-aware
// (same toDisplayYear conversion every other All-Time template already
// applies) so a 'start'-convention competition's raw season year 2025
// reports as display year 2026, matching what the breadcrumb/year-selector
// shows everywhere else.
async function getFirstDataYear(competitionId, yearConvention) {
  const row = await queryOne(`
    SELECT MIN(CASE WHEN $2 = 'start' THEN year + 1 ELSE year END) AS first_year
    FROM seasons
    WHERE competition_id = $1
  `, [competitionId, yearConvention]);
  return row?.first_year ?? null;
}

router.get('/:slug/year-range', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const comp = await queryOne(
      'SELECT id, category_id, founded_year, dissolved_year, year_convention FROM competitions WHERE slug = $1',
      [slug]
    );
    if (!comp) return res.status(404).json({ error: 'Competition not found' });
    const firstDataYear = await getFirstDataYear(comp.id, comp.year_convention);

    if (!comp.category_id) {
      return res.json({ data: { minYear: comp.founded_year, maxYear: comp.dissolved_year, firstDataYear } });
    }

    const cat = await queryOne(
      'SELECT founded_year, dissolved_year FROM event_categories WHERE id = $1',
      [comp.category_id]
    );

    const range = await queryOne(`
      SELECT
        MIN(founded_year) AS min_year,
        CASE WHEN bool_or(dissolved_year IS NULL) THEN NULL ELSE MAX(dissolved_year) END AS max_year
      FROM competitions
      WHERE category_id = $1
    `, [comp.category_id]);

    const minCandidates = [cat?.founded_year, range?.min_year, comp.founded_year].filter(y => y != null);
    const minYear = minCandidates.length ? Math.min(...minCandidates) : null;

    // maxYear only bounds below "through the current year" (YearSelector's
    // own default) when EVERY signal agrees the category is over — the
    // category itself dissolved AND every competition under it dissolved.
    // Any one of them still open-ended means new editions remain possible.
    const maxYear = (cat?.dissolved_year != null && range?.max_year != null)
      ? Math.max(cat.dissolved_year, range.max_year)
      : null;

    res.json({ data: { minYear, maxYear, firstDataYear } });
  } catch (err) {
    next(err);
  }
});

// GET /api/competitions/:slug/event-naming/:year
router.get('/:slug/event-naming/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;
    const naming = await queryOne(`
      SELECT en.official_name, en.short_name, en.start_year, en.end_year
      FROM event_naming en
      JOIN competitions c ON c.id = en.competition_id
      WHERE c.slug = $1
        AND en.start_year <= $2
        AND (en.end_year IS NULL OR en.end_year >= $2)
      ORDER BY en.start_year DESC
      LIMIT 1
    `, [slug, parseInt(year)]);
    res.json({ data: naming });
  } catch (err) {
    next(err);
  }
});

// PUT /api/competitions/:id
router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const {
      logo_url,
      sidebar_logo_url,
      primary_color,
      secondary_color,
      third_color,
      surface,
      founding_year,
      cancelled_editions,  // [{year, reason}]
      sidebar_name,
      short_code,
      country_id,
    } = req.body;

    const cancelledYears = Array.isArray(cancelled_editions)
      ? cancelled_editions.map(e => e.year)
      : [];

    const row = await queryOne(`
      UPDATE competitions SET
        logo_url           = COALESCE($1, logo_url),
        primary_color      = COALESCE($2, primary_color),
        secondary_color    = COALESCE($3, secondary_color),
        third_color        = COALESCE($4, third_color),
        surface            = COALESCE($5, surface),
        founded_year       = COALESCE($6, founded_year),
        cancelled_editions = $7::jsonb,
        cancelled_years    = $8,
        sidebar_name       = COALESCE($10, sidebar_name),
        short_code         = COALESCE($11, short_code),
        country_id         = COALESCE($12, country_id),
        sidebar_logo_url   = COALESCE($13, sidebar_logo_url)
      WHERE id = $9
      RETURNING
        id, name, slug, logo_url, sidebar_logo_url,
        primary_color, secondary_color, third_color,
        surface, founded_year,
        cancelled_years, cancelled_editions,
        sidebar_name, short_code, founded_year, country_id
    `, [
      logo_url        ?? null,
      primary_color   ?? null,
      secondary_color ?? null,
      third_color     ?? null,
      // Lowercased on write — the dropdown that drives this field only
      // ever emits lowercase ('grass'/'clay'/'hard'), but legacy/ingested
      // rows can hold Title Case ("Grass"), which the admin's <select>
      // then fails to match and shows as "— Not set —" even though a
      // value exists (found 2026-08-16: Halle showing unset in admin
      // despite the public frontend correctly showing its surface).
      surface         ? surface.toLowerCase() : (surface ?? null),
      founding_year   ? parseInt(founding_year) : null,
      JSON.stringify(cancelled_editions ?? []),
      cancelledYears,
      id,
      sidebar_name     ?? null,
      short_code       ?? null,
      country_id       || null,
      sidebar_logo_url ?? null,
    ]);

    if (!row) return res.status(404).json({ error: 'Competition not found' });

    res.json(row);
  } catch (err) {
    next(err);
  }
});

// Same surface normalization the tennis home/tournament-history queries
// already use elsewhere in this file (g.surface is inconsistently cased
// and uses 'indoor_hard' with no separate Carpet bucket).
const H2H_SURFACE_LABEL = { clay: 'Clay', grass: 'Grass', hard: 'Hard', indoor_hard: 'Hard' };
// Category slug -> the exact label PerformancesTable already uses
// (Homepage's Performances tab), so the H2H breakdown reads as the same
// categories, not a second vocabulary.
const H2H_CATEGORY_LABEL = {
  'grand-slam': 'Grand Slam',
  'atp-finals': 'ATP Final', 'wta-finals': 'WTA Final',
  'atp-masters-1000': 'Master 1000', 'wta-1000': 'Master 1000',
  'atp-masters-500': 'Master 500', 'wta-500': 'Master 500',
  'atp-masters-250': 'Master 250', 'wta-250': 'Master 250',
};

// Head-to-head career record between two entities — Homepage's H2H detail
// tab (Mohamed 2026-08-20: "Head 2 head: highlight best H2H stat... replace
// win by: All (bold) shall count all wins - then specific [surface/
// category breakdown], display only if value is not 0"). Not tennis-
// specific in the schema (games.home/away_entity_id are generic), so the
// overall meetings/wins_a/wins_b counts every decided meeting across their
// whole recorded history regardless of sport/competition — only the
// surface/category breakdown assumes tennis's own vocabulary.
router.get('/h2h/:idA/:idB', async (req, res, next) => {
  try {
    const idA = parseInt(req.params.idA, 10);
    const idB = parseInt(req.params.idB, 10);
    if (!idA || !idB) return res.status(400).json({ error: 'idA and idB required' });

    // "Played" has to work across sports with no shared schema field for it:
    // tennis games never carry a score.status at all (score is {sets:[...]}),
    // but always get winner_entity_id set once played and are never stored
    // pre-kickoff (confirmed empirically — no NULL-winner ATP rows exist).
    // Football pre-loads a whole season's fixtures up front (see
    // ingest-standings.js), so an unplayed row is a real row here with
    // score.status='NS' and winner_entity_id NULL — same NULL winner a real
    // FOOTBALL DRAW also has once played (score.status='FT'). Checking
    // EITHER a real winner OR an explicit 'FT' status correctly separates
    // "played, drew" from "not played yet" for football while leaving
    // tennis's own winner-only rows unaffected (Mohamed 2026-08-26: "head 2
    // head football" — the old winner_entity_id-only filter silently
    // dropped every real draw AND counted zero unplayed rows correctly by
    // accident for tennis only, since football has none of those to filter
    // out under the old query).
    const rows = await queryAll(`
      SELECT g.id, g.match_date, g.winner_entity_id, g.home_entity_id, g.away_entity_id, g.score,
        g.surface, ec.slug AS category_slug, c.name AS competition_name,
        s.competition_id, s.year AS season_year, c.year_convention
      FROM games g
      JOIN result_tabs rt ON rt.id = g.result_tab_id
      JOIN seasons s ON s.id = rt.season_id
      JOIN competitions c ON c.id = s.competition_id
      LEFT JOIN event_categories ec ON ec.id = c.category_id
      WHERE (g.winner_entity_id IS NOT NULL OR g.score->>'status' = 'FT')
        AND ((g.home_entity_id = $1 AND g.away_entity_id = $2)
          OR (g.home_entity_id = $2 AND g.away_entity_id = $1))
      ORDER BY g.match_date DESC
    `, [idA, idB]);

    const winsA = rows.filter(r => r.winner_entity_id === idA).length;
    const winsB = rows.filter(r => r.winner_entity_id === idB).length;
    const draws = rows.filter(r => r.winner_entity_id == null).length;

    const bump = (map, key, winnerId) => {
      if (!key) return;
      if (!map[key]) map[key] = { a: 0, b: 0 };
      if (winnerId === idA) map[key].a++;
      else if (winnerId === idB) map[key].b++;
    };
    const bySurface = {};
    const byCategory = {};
    rows.forEach(r => {
      bump(bySurface, H2H_SURFACE_LABEL[(r.surface || '').toLowerCase()], r.winner_entity_id);
      bump(byCategory, H2H_CATEGORY_LABEL[r.category_slug], r.winner_entity_id);
    });

    // Most recent meeting each side actually WON (not just the most recent
    // meeting overall) — `rows` is already sorted newest-first, so the
    // first match in it per side is that side's last victory.
    const lastVictoryA = rows.find(r => r.winner_entity_id === idA) || null;
    const lastVictoryB = rows.find(r => r.winner_entity_id === idB) || null;

    // Football H2H's "Last victory" wants "X seasons ago"/"This season",
    // not a calendar date diff — a win in Aug 2025 and one in Apr 2026 are
    // the SAME Ligue 1 season, "0 seasons ago" either way (Mohamed
    // 2026-08-26: "1 year ago: replace by 5 seasons ago or this season if
    // victory happens in current season"). Needs each row's own season
    // (already selected above) plus that SAME competition's current (or
    // latest, if the competition has since ended) season, both converted
    // to the same start/end display-year convention used everywhere else
    // in this app (toDisplayYear).
    const toDisplayYear = (rawYear, conv) => conv === 'start' ? rawYear + 1 : rawYear;
    async function seasonsAgo(row) {
      if (!row) return null;
      const cur = await queryOne(`
        SELECT COALESCE(
          (SELECT year FROM seasons WHERE competition_id = $1 AND status = 'current' LIMIT 1),
          (SELECT MAX(year) FROM seasons WHERE competition_id = $1)
        ) AS year
      `, [row.competition_id]);
      if (cur?.year == null) return null;
      return toDisplayYear(parseInt(cur.year), row.year_convention) - toDisplayYear(parseInt(row.season_year), row.year_convention);
    }
    const [seasonsAgoA, seasonsAgoB] = await Promise.all([seasonsAgo(lastVictoryA), seasonsAgo(lastVictoryB)]);

    // Same breakdown, scoped to only the 10 most recent meetings — "recent
    // form" between the two, distinct from the full-history totals above.
    const last10 = rows.slice(0, 10);

    res.json({
      data: {
        meetings: rows.length,
        wins_a: winsA,
        wins_b: winsB,
        draws,
        last_victory_a: lastVictoryA ? { match_date: lastVictoryA.match_date, seasons_ago: seasonsAgoA } : null,
        last_victory_b: lastVictoryB ? { match_date: lastVictoryB.match_date, seasons_ago: seasonsAgoB } : null,
        last10: {
          meetings: last10.length,
          wins_a: last10.filter(r => r.winner_entity_id === idA).length,
          wins_b: last10.filter(r => r.winner_entity_id === idB).length,
          draws: last10.filter(r => r.winner_entity_id == null).length,
        },
        by_surface: bySurface,
        by_category: byCategory,
        recent: rows.slice(0, 5).map(r => ({
          id: r.id,
          match_date: r.match_date,
          winner_entity_id: r.winner_entity_id,
          competition_name: r.competition_name,
          score: r.score,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;