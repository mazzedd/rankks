// src/routes/motogp.js
// MotoGP has its own dedicated tables (motogp_circuits, motogp_grands_prix,
// motogp_sessions, motogp_session_results, motogp_rider_standings,
// motogp_team_standings, motogp_constructor_standings) — same "close to F1"
// precedent as f1.js, not the generic seasons/result_tabs/standings/games
// tables football/tennis use. See onboarding-motogp.md.
//
// ONE STRUCTURAL DIFFERENCE FROM F1 — the category dimension. MotoGP/Moto2/
// Moto3 share one `competitions` row (id 4829) and one physical GP calendar
// (motogp_grands_prix has no category column at all — round order/circuit/
// dates are identical across all three classes), but sessions/results ARE
// category-specific. So every route below takes `?category=motogp|moto2|
// moto3` as a query param, and `seasons` rows (competition_id 4829) are
// looked up by (year, category) — three rows per year, not one.
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

const COMPETITION_ID = 4829; // MotoGP World Championship — onboarding-motogp.md Section 4
const VALID_CATEGORIES = ['motogp', 'moto2', 'moto3'];

// TEAM NAME ALIASES — motogp_session_results.team_name is fragmented by
// sponsor-variant spelling and by substitute riders being logged under a
// different label than their team's canonical motogp_team_standings name
// (confirmed by direct query, not guessed). Grouping session_results by
// raw team_name would silently undercount any team hit by this. Each row
// here is a founder-verified mapping (category, year, session-level name
// -> canonical motogp_team_standings.team_name for that season) — only
// add a row once it's been confirmed the way these were, don't guess new
// ones. Unverified seasons/categories fall through unresolved (COALESCE
// to the raw name), same behavior as before this list existed — no worse
// off, just not yet fixed.
const TEAM_NAME_ALIASES = [
  // 2026 MotoGP: LCR Honda's two riders logged under different sponsor
  // spellings; Trackhouse renamed mid-season; Augusto Fernandez (sub)
  // logged as "Yamaha Factory Racing" instead of the team he rode for.
  { category: 'motogp', year: 2026, from: 'Castrol Honda LCR', to: 'LCR Honda' },
  { category: 'motogp', year: 2026, from: 'Pro Honda LCR', to: 'LCR Honda' },
  { category: 'motogp', year: 2026, from: 'Trackhouse MotoGP Team', to: 'SuperFile Trackhouse MotoGP Team' },
  { category: 'motogp', year: 2026, from: 'Yamaha Factory Racing', to: 'Monster Energy Yamaha MotoGP Team' },
];

// Builds a `WITH team_aliases(category, year, from_name, to_name) AS (VALUES ...)`
// CTE fragment. Returns '' (no rows) if the list is ever empty so the CTE
// still parses — VALUES needs at least one row.
function teamAliasesCte() {
  const rows = TEAM_NAME_ALIASES.map(a =>
    `('${a.category}', ${a.year}, '${a.from.replace(/'/g, "''")}', '${a.to.replace(/'/g, "''")}')`
  ).join(',\n    ');
  return `team_aliases(category, year, from_name, to_name) AS (VALUES\n    ${rows}\n  )`;
}

// OFFICIAL SESSION DEDUP — motogp_sessions can have more than one row for
// the same (grand_prix_id, category, session_type): every round runs both
// Q1 and Q2 (both tagged session_type='Q', but only Q2 sets the actual
// grid pole), and a red-flagged/restarted race gets logged as a second
// 'RAC' row (confirmed via direct query: 2026's Catalonia GP has one RAC
// session where the "winner" scored 0 points — the voided original — and
// a second, session_number=2, where the real winner scored 25). Counting
// every matching session_type row (as every query below used to) silently
// doubles poles and inflates wins/podiums for any round hit by either
// case. This restricts a session-type match to only the single highest
// session_number row per (grand_prix_id, category, session_type) — the
// one that actually counts. Call with the session alias already in scope
// (e.g. `AND ${officialSession('ms')}` right after `ms.session_type = 'RAC'`).
function officialSession(alias) {
  return `${alias}.id = (
        SELECT ms_official.id FROM motogp_sessions ms_official
        WHERE ms_official.grand_prix_id = ${alias}.grand_prix_id
          AND ms_official.category = ${alias}.category
          AND ms_official.session_type = ${alias}.session_type
        ORDER BY COALESCE(ms_official.session_number, 1) DESC
        LIMIT 1
      )`;
}

function categoryOf(req) {
  const c = req.query.category;
  return VALID_CATEGORIES.includes(c) ? c : 'motogp';
}

// Season-context block shared by all three standings routes (riders/teams/
// constructors) — powers the event blocks' Schedule/Edition/Riders/Teams
// bottom bar and Winner/"Current Leader" label, same "computed, never
// stored" approach f1.js uses (seasons.status is a stale/unmaintained
// column here, confirmed via direct query — never trust it). A season is
// 'current' if the shared GP calendar has at least one round already run
// AND at least one still upcoming; 'past' if every round has run; 'future'
// if none have. Unlike F1, MotoGP's calendar (motogp_grands_prix) has no
// season_id/category of its own — it's one shared table across all three
// classes for a given year.
//
// season_start/end_date and has_upcoming come from the FULL calendar (no
// session join) — a future round can never have session rows yet by
// definition (they're created once the weekend happens), so inner-joining
// through motogp_sessions.category silently dropped every not-yet-raced
// round and made an ongoing season look finished the moment session
// ingestion fell behind the calendar (confirmed: 2026 MotoGP has 22
// rounds scheduled through November, but only the first 11 have session
// rows — the old query's MAX(event_date_end) landed on round 11,
// mid-July, making a season with 11 races still to go show a "Champion"
// badge instead of "Current Leader"/ongoing).
// has_raced still requires this category's own session rows to exist —
// "did THIS class actually race this round" is a real distinct fact
// (this class occasionally skips a round the others don't, per
// /season/:year's own comment) separate from "is this round in the past".
async function getSeasonContext(seasonId, year, category) {
  const seasonMeta = await queryOne(`
    SELECT
      MIN(gp.event_date_start)                    AS season_start_date,
      MAX(gp.event_date_end)                      AS season_end_date,
      BOOL_OR(
        gp.event_date_end <= CURRENT_DATE
        AND EXISTS (SELECT 1 FROM motogp_sessions s WHERE s.grand_prix_id = gp.id AND s.category = $2)
      ) AS has_raced,
      BOOL_OR(gp.event_date_start > CURRENT_DATE) AS has_upcoming
    FROM motogp_grands_prix gp
    WHERE gp.year = $1
  `, [year, category]);

  const seasonStatus = seasonMeta?.has_raced && seasonMeta?.has_upcoming
    ? 'current'
    : seasonMeta?.has_raced
    ? 'past'
    : 'future';

  // Edition — count of this category's OWN season rows through this year,
  // not F1-style year arithmetic: Moto2/Moto3 carry their 250cc/125cc
  // lineage back to 1949 in this schema (see onboarding-motogp.md), so a
  // plain COUNT already reflects the right lineage-based edition number.
  const editionMeta = await queryOne(
    `SELECT COUNT(*) AS edition FROM seasons WHERE competition_id = $1 AND category = $2 AND year <= $3`,
    [COMPETITION_ID, category, year]
  );
  // teams_count comes from motogp_team_standings (the canonical table the
  // Teams tab itself is built on), NOT COUNT(DISTINCT team_name) on
  // motogp_rider_standings — that field is fragmented by sponsor-variant
  // spelling (confirmed: gave 13 instead of the real 11 for 2026 MotoGP,
  // same root cause as /standings/:seasonId/teams' TEAM_NAME_ALIASES).
  const entrantMeta = await queryOne(`
    SELECT
      (SELECT COUNT(*) FROM motogp_rider_standings WHERE season_id = $1) AS riders_count,
      (SELECT COUNT(*) FROM motogp_team_standings WHERE season_id = $1) AS teams_count
  `, [seasonId]);

  // races_count — distinct GP rounds THIS category actually raced (has a
  // RAC session), not a plain count of motogp_grands_prix rows for the
  // year: a round the calendar lists can still be skipped by one class
  // (see has_raced comment above), so counting the calendar itself would
  // overstate a category's real race count.
  const raceMeta = await queryOne(`
    SELECT COUNT(DISTINCT gp.id) AS races_count
    FROM motogp_grands_prix gp
    JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $2 AND s.session_type = 'RAC'
    WHERE gp.year = $1
  `, [year, category]);

  return {
    season_start_date: seasonMeta?.season_start_date || null,
    season_end_date: seasonMeta?.season_end_date || null,
    season_status: seasonStatus,
    edition: parseInt(editionMeta?.edition || 0, 10),
    riders_count: parseInt(entrantMeta?.riders_count || 0, 10),
    teams_count: parseInt(entrantMeta?.teams_count || 0, 10),
    races_count: parseInt(raceMeta?.races_count || 0, 10),
  };
}

// GET /api/motogp/years?category=motogp
router.get('/years', async (req, res, next) => {
  try {
    const category = categoryOf(req);
    const rows = await queryAll(
      `SELECT year FROM seasons WHERE competition_id = $1 AND category = $2 ORDER BY year ASC`,
      [COMPETITION_ID, category]
    );
    res.json({ data: rows.map(r => r.year) });
  } catch (err) { next(err) }
});

// GET /api/motogp/season/:year?category=motogp — GP list for Line A
router.get('/season/:year', async (req, res, next) => {
  try {
    const { year } = req.params;
    const category = categoryOf(req);
    const season = await queryOne(
      `SELECT id, year FROM seasons WHERE competition_id = $1 AND year = $2 AND category = $3`,
      [COMPETITION_ID, year, category]
    );
    if (!season) return res.status(404).json({ error: 'Season not found' });

    // Only GPs where this category actually had at least one session —
    // a GP the calendar includes but this class didn't race gets skipped,
    // same "self-describing, don't assume uniformity" rule the scraper
    // itself follows.
    const gps = await queryAll(`
      SELECT DISTINCT gp.id, gp.name, gp.slug, gp.round_order, gp.event_date_start, gp.event_date_end,
        c.name AS circuit_name, co.iso2 AS country_iso2, co.name AS country_name
      FROM motogp_grands_prix gp
      JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $2
      LEFT JOIN motogp_circuits c ON c.id = gp.circuit_id
      LEFT JOIN countries co ON co.id = gp.country_id
      WHERE gp.year = $1
      ORDER BY gp.round_order
    `, [year, category]);

    // Iconic Moments Line A tab (pinned right, same as F1's) is only shown
    // when this exact (year, category) season actually has at least one
    // row — same conditional-visibility rule F1's /season/:year applies via
    // f1_iconic_moments.
    const iconicCheck = await queryOne(
      `SELECT EXISTS (SELECT 1 FROM motogp_iconic_moments WHERE season_id = $1) AS has_iconic_moments`,
      [season.id]
    );

    res.json({
      data: {
        season_id: season.id,
        year: season.year,
        category,
        has_iconic_moments: !!iconicCheck?.has_iconic_moments,
        gps: gps.map(g => ({
          id: g.id,
          name: g.name,
          slug: g.slug,
          round_order: g.round_order,
          race_date: g.event_date_start,
          event_date_end: g.event_date_end,
          circuit_name: g.circuit_name,
          country_iso2: g.country_iso2,
          country_name: g.country_name,
        })),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/gp/:slug/:year?category=motogp — one GP's session list for Line B
//
// VIDEO — LEFT JOIN motogp_race_videos scoped to THIS category (a round can
// have up to 3 videos, one per class — see routes/admin.js's MotoGP Media
// block), same pattern as F1's own /f1/gp/:slug/:year joining
// f1_race_videos, so MotoGPSessionResultsTemplate's Race tab can show the
// same "Watch Video" button F1's does.
router.get('/gp/:slug/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;
    const category = categoryOf(req);

    const gp = await queryOne(`
      SELECT gp.id, gp.name, gp.slug, rn.full_title, gp.round_order, gp.event_date_start, gp.event_date_end,
        c.name AS circuit_name, co.iso2 AS country_iso2, co.name AS country_name,
        rv.id AS video_id, rv.video_url, rv.source AS video_source, rv.embeddable AS video_embeddable, rv.thumbnail_url AS video_thumbnail_url
      FROM motogp_grands_prix gp
      LEFT JOIN motogp_circuits c ON c.id = gp.circuit_id
      LEFT JOIN countries co ON co.id = gp.country_id
      LEFT JOIN motogp_race_videos rv ON rv.grand_prix_id = gp.id AND rv.category = $3
      -- Era-ranged sponsor name — same race_naming pattern as F1's
      -- /f1/gp/:slug/:year (see that route's comment). One row per year
      -- (motogp_grands_prix has no per-category split), so an era applies
      -- across MotoGP/Moto2/Moto3 for that round.
      LEFT JOIN LATERAL (
        SELECT full_title FROM race_naming
        WHERE sport = 'motogp' AND gp_slug = gp.slug
          AND start_year <= $1 AND (end_year IS NULL OR end_year >= $1)
        ORDER BY start_year DESC LIMIT 1
      ) rn ON true
      WHERE gp.year = $1 AND gp.slug = $2
    `, [year, slug, category]);
    if (!gp) return res.status(404).json({ error: 'Grand Prix not found' });

    // season_id — motogp_grands_prix itself has no season_id/category (one
    // shared calendar row across all three classes), so it's looked up
    // separately here purely for MotoGPGPBlock's season-context fetch
    // (career/edition/riders_count/teams_count), same as F1GPBlock uses
    // gp.f1_season_id for that same purpose.
    const season = await queryOne(
      `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND category = $3`,
      [COMPETITION_ID, year, category]
    );

    const sessions = await queryAll(`
      SELECT id, session_type, session_number, display_order, session_date
      FROM motogp_sessions
      WHERE grand_prix_id = $1 AND category = $2
      ORDER BY display_order
    `, [gp.id, category]);

    res.json({
      data: {
        category,
        gp: {
          id: gp.id,
          season_id: season?.id || null,
          name: gp.name,
          slug: gp.slug,
          full_title: gp.full_title,
          round_order: gp.round_order,
          race_date: gp.event_date_start,
          circuit_name: gp.circuit_name,
          country_iso2: gp.country_iso2,
          country_name: gp.country_name,
          video_id: gp.video_id,
          video_url: gp.video_url,
          video_source: gp.video_source,
          video_embeddable: gp.video_embeddable,
          video_thumbnail_url: gp.video_thumbnail_url,
        },
        sessions: sessions.map(s => ({
          id: s.id,
          session_type: s.session_type,
          session_number: s.session_number,
          display_order: s.display_order,
          session_date: s.session_date || gp.event_date_start,
        })),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/home-sessions/:seasonId — one row per (round, session)
// for MotoGP's Home tab calendar feed, same shape/intent as F1's own
// /home-sessions/:seasonId (see HomeF1Template.jsx / HomeMotoGPTemplate.jsx).
// category comes from the season row itself (seasonId already IS
// category-specific, same as every other :seasonId route here), not a
// query param. LEFT JOINs to results so an unraced future/ongoing session
// still gets a row (rider/team fields come back null, frontend falls back
// to the points leader) — no officialSession() dedup here, matching
// /gp/:slug/:year's own listing (which also shows every real session row,
// including Q1/Q2 as separate rows — only aggregate/stat routes need the
// "one row counts" dedup).
router.get('/home-sessions/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const sessions = await queryAll(`
      WITH ${teamAliasesCte()}
      SELECT gp.id AS gp_id, gp.name AS gp_name, gp.slug, gp.event_date_start AS event_date, gp.round_order,
        gpco.iso2 AS gp_country_iso2, gpco.name AS gp_country_name,
        s.id AS session_id, s.session_type, s.session_number, s.display_order,
        COALESCE(s.session_date, gp.event_date_start) AS session_date,
        e.canonical_name AS rider_name, e.slug AS rider_slug,
        co.iso2 AS rider_country_iso2, co.name AS rider_country_name,
        COALESCE(ta.to_name, sr.team_name) AS team_name, sr.constructor_name,
        rv.id AS video_id, rv.video_url, rv.source AS video_source, rv.embeddable AS video_embeddable, rv.thumbnail_url AS video_thumbnail_url
      FROM motogp_grands_prix gp
      LEFT JOIN countries gpco ON gpco.id = gp.country_id
      -- officialSession() dedup — a red-flagged/restarted race logs a
      -- second RAC row (e.g. 2026 Catalonia: a voided session_number=null
      -- RAC where the "winner" scored 0 points, plus the real
      -- session_number=2 RAC that actually counts — confirmed via direct
      -- query). Home's session list showed both as separate rows until
      -- this was added (2026-08-10) — every OTHER MotoGP route already
      -- applies this same guard.
      JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $3 AND ${officialSession('s')}
      LEFT JOIN motogp_session_results sr ON sr.session_id = s.id AND sr.position = 1
      LEFT JOIN entities e ON e.id = sr.rider_entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      LEFT JOIN team_aliases ta ON ta.category = $3 AND ta.year = $2 AND ta.from_name = sr.team_name
      -- Video is tied to the race weekend + category as a whole (a round
      -- can have up to 3 videos, one per class — see /gp/:slug/:year's own
      -- comment), only ever shown on the Race row, same rule that page's
      -- Watch button follows.
      LEFT JOIN motogp_race_videos rv ON rv.grand_prix_id = gp.id AND rv.category = $3
      WHERE gp.year = $1
      ORDER BY gp.round_order, s.display_order
    `, [season.year, season.year, season.category]);

    res.json({ data: { sessions, total: sessions.length } });
  } catch (err) { next(err) }
});

// GET /api/motogp/session-leaders/:seasonId — per-category "who's leading
// this season" breakdown for the Schedule page's Leaders card (Mohamed
// 2026-08-23: "display by default all leaders for each session (race,
// qualifying, etc.)... when it comes to dropdown a driver, display he's
// own results replacing global leaders metrics"). Six buckets: Race wins,
// Race podiums (1-2-3, wins already included), Pole (Q/QP), Sprint wins,
// Practice tops (fastest-time session, no real "win" concept there), Warm
// Up tops — one row per rider who has any session result this season,
// every count computed live from motogp_session_results (same
// derive-don't-trust-stored-columns rule /standings/:seasonId/riders
// documents — motogp_rider_standings.wins/poles/etc. are only ~24-33%
// populated pre-2012). officialSession() dedup applies uniformly across
// every session_type in one shot since it self-correlates on the row's
// own session_type (see that helper's own comment).
router.get('/session-leaders/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const rows = await queryAll(`
      SELECT e.id AS rider_id, e.canonical_name AS rider_name, COALESCE(e.profile_image_url, e.image_url) AS rider_image,
        co.iso2 AS rider_country_iso2, co.name AS rider_country_name,
        COUNT(*) FILTER (WHERE s.session_type = 'RAC' AND sr.position = 1) AS race_wins,
        COUNT(*) FILTER (WHERE s.session_type = 'RAC' AND sr.position IN (1, 2, 3)) AS race_podiums,
        COUNT(*) FILTER (WHERE s.session_type IN ('Q', 'QP') AND sr.position = 1) AS poles,
        COUNT(*) FILTER (WHERE s.session_type = 'SPR' AND sr.position = 1) AS sprint_wins,
        COUNT(*) FILTER (WHERE s.session_type IN ('FP', 'P', 'PR') AND sr.position = 1) AS practice_tops,
        COUNT(*) FILTER (WHERE s.session_type = 'WUP' AND sr.position = 1) AS warmup_tops
      FROM motogp_session_results sr
      JOIN motogp_sessions s ON s.id = sr.session_id AND s.category = $2 AND ${officialSession('s')}
      JOIN motogp_grands_prix gp ON gp.id = s.grand_prix_id AND gp.year = $1
      JOIN entities e ON e.id = sr.rider_entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      GROUP BY e.id, e.canonical_name, e.image_url, co.iso2, co.name
    `, [season.year, season.category]);

    res.json({
      data: {
        riders: rows.map(r => ({
          rider_id: r.rider_id,
          rider_name: r.rider_name,
          rider_image: r.rider_image,
          rider_country_iso2: r.rider_country_iso2,
          rider_country_name: r.rider_country_name,
          race_wins: Number(r.race_wins) || 0,
          race_podiums: Number(r.race_podiums) || 0,
          poles: Number(r.poles) || 0,
          sprint_wins: Number(r.sprint_wins) || 0,
          practice_tops: Number(r.practice_tops) || 0,
          warmup_tops: Number(r.warmup_tops) || 0,
        })),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/iconic-moments/:seasonId — season-level gallery, backed
// by motogp_iconic_moments (one season_id per (year, category), so this is
// already class-scoped without needing a separate category param — see
// file header). Mirrors F1's own /f1/iconic-moments/:seasonId response
// shape ({ items, total }) so the shared iconic_moments_template.jsx
// component works unmodified, just pointed at this fetch function instead.
//
// gpId (Mohamed 2026-08-23: "same changes as F1... iconic moment may be
// tied to a Grand Prix") — optional filter down to just that one race's
// moments, backed by the grand_prix_id column added alongside this change,
// same as F1's own gpId param. Omitted (the tour-wide Iconic Moments tab's
// own call) still returns every moment in the season regardless of race.
router.get('/iconic-moments/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const { category, tag, gpId } = req.query;

    const conditions = ['season_id = $1'];
    const params = [seasonId];

    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (tag) {
      params.push(`%${tag}%`);
      conditions.push(`(title ILIKE $${params.length} OR $${params.length} = ANY(tags))`);
    }
    if (gpId) {
      params.push(gpId);
      conditions.push(`grand_prix_id = $${params.length}`);
    }

    const items = await queryAll(`
      SELECT id, title, video_url, source, embeddable, category, tags, display_order, thumbnail_url, grand_prix_id
      FROM motogp_iconic_moments
      WHERE ${conditions.join(' AND ')}
      ORDER BY display_order NULLS LAST, id
    `, params);

    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err) }
});

// GET /api/motogp/session/:sessionId/results
//
// SEASONS — same career-span shape as /standings/:seasonId/riders: count of
// this rider's distinct seasons in THIS category through this session's own
// year, capped so future seasons never count as "active" yet (same guard
// F1's equivalent route uses).
//
// TEAM LOGO/ALIAS — r.team_name here is the same fragmented field
// /standings/:seasonId/teams resolves via TEAM_NAME_ALIASES; resolved here
// through the same team_aliases CTE before being matched against
// entity_type='motogp_team' entities for logo_url (falls back to
// entities.image_url when no entity_logos row exists yet, same COALESCE
// order the Teams route uses).
router.get('/session/:sessionId/results', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    // event_date — this exact session's own real date (motogp_sessions.
    // session_date is fully populated, see HomeMotoGPTemplate.jsx's file
    // header), falling back to the GP's own start date only for the rare
    // row missing one. Mirrors F1's own COALESCE(s.session_date, gp.
    // event_date) — the placeholder message below needs this session's
    // own date ("Race date, Practice date, etc."), not the whole weekend's.
    const session = await queryOne(`
      SELECT s.id, s.category, s.session_type, s.session_number,
        COALESCE(s.session_date, gp.event_date_start) AS event_date, gp.name AS gp_name, gp.year
      FROM motogp_sessions s
      JOIN motogp_grands_prix gp ON gp.id = s.grand_prix_id
      WHERE s.id = $1
    `, [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const results = await queryAll(`
      WITH ${teamAliasesCte()}
      SELECT r.position, r.car_number, r.laps, r.time_result, r.gap_to_first, r.points,
        r.best_lap_time, r.top_speed, r.average_speed,
        e.id AS rider_id, e.canonical_name AS rider_name, e.slug AS rider_slug, COALESCE(e.profile_image_url, e.image_url) AS rider_image,
        -- Portrait-priority variant (Mohamed 2026-08-23: MotoGPGPBlock's big
        -- banner showed the compact profile crop stretched large — opposite
        -- priority from rider_image above, which table rows correctly want
        -- profile-first for). Same two columns, reversed COALESCE order.
        COALESCE(e.image_url, e.profile_image_url) AS rider_portrait,
        e.birth_date, e.death_date,
        co.iso2 AS rider_country_iso2, co.name AS rider_country_name,
        COALESCE(ta.to_name, r.team_name) AS team_name, r.constructor_name,
        COALESCE(el.logo_url, te.image_url) AS team_logo,
        activity.active_from, activity.active_to, activity.seasons_count
      FROM motogp_session_results r
      JOIN entities e ON e.id = r.rider_entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      LEFT JOIN team_aliases ta ON ta.category = $2 AND ta.year = $3 AND ta.from_name = r.team_name
      LEFT JOIN entities te ON te.entity_type = 'motogp_team' AND te.canonical_name = COALESCE(ta.to_name, r.team_name)
      LEFT JOIN entity_logos el ON el.entity_id = te.id
        AND $3::int BETWEEN el.start_year AND COALESCE(el.end_year, 9999)
      LEFT JOIN (
        SELECT rs2.rider_entity_id, MIN(s2.year) AS active_from, MAX(s2.year) AS active_to, COUNT(DISTINCT s2.year) AS seasons_count
        FROM motogp_rider_standings rs2
        JOIN seasons s2 ON s2.id = rs2.season_id
        WHERE s2.competition_id = $4 AND s2.category = $2 AND s2.year <= $3
        GROUP BY rs2.rider_entity_id
      ) activity ON activity.rider_entity_id = r.rider_entity_id
      WHERE r.session_id = $1
      ORDER BY (r.position IS NULL), r.position ASC
    `, [sessionId, session.category, session.year, COMPETITION_ID]);

    let mappedResults = results.map(r => ({
      ...r,
      seasons_count: r.seasons_count != null ? Number(r.seasons_count) : null,
    }));

    // No real results yet (round hasn't been raced / not published) — fall
    // back to the season's current rider standings as an entry list,
    // '-' in place of anything result-specific. Same rule F1's own
    // /f1/session/:sessionId/results uses (see that route's identical
    // comment) — the scheduled ingest-motogp-update.js run replaces this
    // with real rows automatically once motogp.com publishes them, this
    // response is never persisted. Needs a real motogp_sessions row to
    // exist at all to get here (see ingest-motogp.js's session-shell
    // comment for why not-yet-raced sessions still get one).
    let isPlaceholder = false;
    if (!mappedResults.length) {
      const standings = await queryAll(`
        WITH ${teamAliasesCte()}
        SELECT rs.position, rs.rider_entity_id AS rider_id,
          e.canonical_name AS rider_name, e.slug AS rider_slug, COALESCE(e.profile_image_url, e.image_url) AS rider_image,
          e.birth_date, e.death_date,
          co.iso2 AS rider_country_iso2, co.name AS rider_country_name,
          COALESCE(ta.to_name, rs.team_name) AS team_name, rs.constructor_name,
          COALESCE(el.logo_url, te.image_url) AS team_logo,
          activity.active_from, activity.active_to, activity.seasons_count
        FROM motogp_rider_standings rs
        JOIN seasons se ON se.id = rs.season_id
        JOIN entities e ON e.id = rs.rider_entity_id
        LEFT JOIN countries co ON co.id = e.country_id
        LEFT JOIN team_aliases ta ON ta.category = $1 AND ta.year = $2 AND ta.from_name = rs.team_name
        LEFT JOIN entities te ON te.entity_type = 'motogp_team' AND te.canonical_name = COALESCE(ta.to_name, rs.team_name)
        LEFT JOIN entity_logos el ON el.entity_id = te.id
          AND $2::int BETWEEN el.start_year AND COALESCE(el.end_year, 9999)
        LEFT JOIN (
          SELECT rs2.rider_entity_id, MIN(s2.year) AS active_from, MAX(s2.year) AS active_to, COUNT(DISTINCT s2.year) AS seasons_count
          FROM motogp_rider_standings rs2
          JOIN seasons s2 ON s2.id = rs2.season_id
          WHERE s2.competition_id = $3 AND s2.category = $1 AND s2.year <= $2
          GROUP BY rs2.rider_entity_id
        ) activity ON activity.rider_entity_id = rs.rider_entity_id
        WHERE se.competition_id = $3 AND se.year = $2 AND se.category = $1
        ORDER BY (rs.position IS NULL), rs.position ASC
      `, [session.category, session.year, COMPETITION_ID]);

      if (standings.length) {
        isPlaceholder = true;
        mappedResults = standings.map(s => ({
          position: '-', car_number: null, laps: null, time_result: null,
          gap_to_first: null, points: null, best_lap_time: null, top_speed: null, average_speed: null,
          rider_id: s.rider_id, rider_name: s.rider_name, rider_slug: s.rider_slug, rider_image: s.rider_image,
          birth_date: s.birth_date, death_date: s.death_date,
          rider_country_iso2: s.rider_country_iso2, rider_country_name: s.rider_country_name,
          team_name: s.team_name, constructor_name: s.constructor_name, team_logo: s.team_logo,
          active_from: s.active_from, active_to: s.active_to,
          seasons_count: s.seasons_count != null ? Number(s.seasons_count) : null,
        }));
      }
    }

    res.json({
      data: {
        session,
        results: mappedResults,
        total: mappedResults.length,
        is_placeholder: isPlaceholder,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/standings/:seasonId/riders
//
// Full parity with F1's own /standings/:seasonId/drivers — same stat set
// except Fast. Lap (motogp_session_results.best_lap_time/top_speed are
// NULL on 100% of RAC/SPR rows, confirmed via direct query — the ingested
// dataset has no per-race fastest-lap source at all, unlike F1's dedicated
// f1_fastest_laps table, so it isn't fabricated here) and plus Sprint
// Podiums in its place (MotoGP tracks this, F1 doesn't need to).
//
// SEASONS — same "active through the viewed year" stat-stack F1's own
// route uses (count + first-last year range), bounded to THIS category's
// own seasons rows (a Moto3 season must not count a rider's later MotoGP
// seasons, and vice versa).
//
// CAR NUMBER — motogp_rider_standings itself has no number column
// (confirmed via information_schema), so it's derived the same way F1's
// /fastest-laps and /poles routes derive team when their own source table
// lacks it: fall back to the rider's own session results for this exact
// category+year, picking the most recent round's car_number.
//
// WINS/PODIUMS/POLES — motogp_rider_standings.wins/podiums/sprint_wins are
// only populated for a handful of recent seasons (confirmed via direct
// query: ~24-33% non-null coverage across motogp/moto2/moto3, NULL for
// nearly every season before ~2012 and even some recent ones like MotoGP
// 2023-2024 sprint_wins) — trusting those stored columns silently showed
// 0 wins for a season's actual dominant champion (e.g. Mick Doohan, 11
// real 1997 wins, showed 0). All of wins/p2/p3/poles/sprint_wins/
// sprint_p2/sprint_p3 are instead derived live from motogp_session_results,
// same convention F1 already uses — p2/p3 from RAC session results
// position 2/3, wins from RAC position 1, poles from Q/QP session results
// position 1, sprint_wins/p2/p3 from SPR session results. The frontend
// computes the podiums TOTAL as wins+p2+p3 client-side (same convention
// F1DriversTemplate uses), not a stored `podiums` column, so the on-screen
// total always matches its own W/2nd/3rd breakdown exactly. Same treatment
// for sprint_podiums — the frontend sums sprint_wins+sprint_p2+sprint_p3
// itself rather than trusting a stored total.
router.get('/standings/:seasonId/riders', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const rows = await queryAll(`
      WITH ${teamAliasesCte()}
      SELECT rs.position, rs.points,
        e.id AS entity_id, e.canonical_name, e.slug, COALESCE(e.profile_image_url, e.image_url) AS logo_url,
        -- Portrait-priority variant for MotoGPChampionshipBlock's big banner
        -- (Mohamed 2026-08-23) — see /session/:sessionId/results' identical
        -- rider_portrait comment for the full rationale.
        COALESCE(e.image_url, e.profile_image_url) AS portrait_url,
        e.birth_date, e.death_date,
        co.iso2 AS country_iso2, co.name AS country_name,
        COALESCE(ta.to_name, rs.team_name) AS team_name, rs.constructor_name,
        activity.active_from, activity.active_to, activity.seasons_count,
        num.car_number,
        COALESCE(podium.wins, 0) AS wins, COALESCE(podium.p2, 0) AS p2, COALESCE(podium.p3, 0) AS p3,
        COALESCE(poles.pole_count, 0) AS poles,
        COALESCE(sprint_podium.wins, 0) AS sprint_wins,
        COALESCE(sprint_podium.p2, 0) AS sprint_p2, COALESCE(sprint_podium.p3, 0) AS sprint_p3
      FROM motogp_rider_standings rs
      JOIN entities e ON e.id = rs.rider_entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      LEFT JOIN team_aliases ta ON ta.category = $3 AND ta.year = $4 AND ta.from_name = rs.team_name
      LEFT JOIN (
        SELECT rs2.rider_entity_id, MIN(s2.year) AS active_from, MAX(s2.year) AS active_to, COUNT(DISTINCT s2.year) AS seasons_count
        FROM motogp_rider_standings rs2
        JOIN seasons s2 ON s2.id = rs2.season_id
        WHERE s2.competition_id = $2 AND s2.category = $3 AND s2.year <= $4
        GROUP BY rs2.rider_entity_id
      ) activity ON activity.rider_entity_id = rs.rider_entity_id
      LEFT JOIN (
        SELECT sr2.rider_entity_id, (ARRAY_AGG(sr2.car_number ORDER BY gp2.round_order DESC))[1] AS car_number
        FROM motogp_session_results sr2
        JOIN motogp_sessions ms2 ON ms2.id = sr2.session_id AND ms2.category = $3
        JOIN motogp_grands_prix gp2 ON gp2.id = ms2.grand_prix_id AND gp2.year = $4
        GROUP BY sr2.rider_entity_id
      ) num ON num.rider_entity_id = rs.rider_entity_id
      LEFT JOIN (
        SELECT sr3.rider_entity_id,
          COUNT(*) FILTER (WHERE sr3.position = 1) AS wins,
          COUNT(*) FILTER (WHERE sr3.position = 2) AS p2,
          COUNT(*) FILTER (WHERE sr3.position = 3) AS p3
        FROM motogp_session_results sr3
        JOIN motogp_sessions ms3 ON ms3.id = sr3.session_id AND ms3.category = $3 AND ms3.session_type = 'RAC' AND ${officialSession('ms3')}
        JOIN motogp_grands_prix gp3 ON gp3.id = ms3.grand_prix_id AND gp3.year = $4
        GROUP BY sr3.rider_entity_id
      ) podium ON podium.rider_entity_id = rs.rider_entity_id
      LEFT JOIN (
        SELECT sr4.rider_entity_id, COUNT(*) AS pole_count
        FROM motogp_session_results sr4
        JOIN motogp_sessions ms4 ON ms4.id = sr4.session_id AND ms4.category = $3 AND ms4.session_type IN ('Q', 'QP') AND ${officialSession('ms4')}
        JOIN motogp_grands_prix gp4 ON gp4.id = ms4.grand_prix_id AND gp4.year = $4
        WHERE sr4.position = 1
        GROUP BY sr4.rider_entity_id
      ) poles ON poles.rider_entity_id = rs.rider_entity_id
      LEFT JOIN (
        SELECT sr5.rider_entity_id,
          COUNT(*) FILTER (WHERE sr5.position = 1) AS wins,
          COUNT(*) FILTER (WHERE sr5.position = 2) AS p2,
          COUNT(*) FILTER (WHERE sr5.position = 3) AS p3
        FROM motogp_session_results sr5
        JOIN motogp_sessions ms5 ON ms5.id = sr5.session_id AND ms5.category = $3 AND ms5.session_type = 'SPR' AND ${officialSession('ms5')}
        JOIN motogp_grands_prix gp5 ON gp5.id = ms5.grand_prix_id AND gp5.year = $4
        GROUP BY sr5.rider_entity_id
      ) sprint_podium ON sprint_podium.rider_entity_id = rs.rider_entity_id
      WHERE rs.season_id = $1
      ORDER BY (rs.position IS NULL), rs.position ASC
    `, [seasonId, COMPETITION_ID, season.category, season.year]);

    const context = await getSeasonContext(seasonId, season.year, season.category);

    res.json({
      data: {
        year: season.year,
        category: season.category,
        ...context,
        standings: rows.map(r => ({
          position: r.position,
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          portrait_url: r.portrait_url,
          birth_date: r.birth_date,
          death_date: r.death_date,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          car_number: r.car_number,
          stats: {
            team_name: r.team_name,
            constructor_name: r.constructor_name,
            points: r.points,
            wins: Number(r.wins) || 0,
            p2: Number(r.p2) || 0,
            p3: Number(r.p3) || 0,
            poles: Number(r.poles) || 0,
            sprint_wins: Number(r.sprint_wins) || 0,
            sprint_p2: Number(r.sprint_p2) || 0,
            sprint_p3: Number(r.sprint_p3) || 0,
            sprint_podiums: (Number(r.sprint_wins) || 0) + (Number(r.sprint_p2) || 0) + (Number(r.sprint_p3) || 0),
            active_from: r.active_from,
            active_to: r.active_to,
            seasons_count: r.seasons_count != null ? Number(r.seasons_count) : null,
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/standings/:seasonId/points-by-race
// Per-round points breakdown matrix for the Points Standings page (Line A
// Standings > Points Standings, after Teams). One column per Grand Prix
// this YEAR (motogp_grands_prix has no category of its own — see file
// header — so every round on the shared calendar is a column, including
// any this category skipped or hasn't raced yet; those come back 0 via
// the LEFT JOIN/COALESCE, never omitted). Only RAC/SPR sessions award
// points, and — unlike F1 — a round can have more than one RAC/SPR row
// (red-flag restarts, confirmed via direct query), so this reuses the
// same officialSession() dedup every other MotoGP points/podium query
// already applies, or points would be double-counted. Race and Sprint
// points are kept separate (not summed together) so the frontend can
// show Sprint as its own small second line — each round's own
// has_sprint flag drives that, not a per-rider check.
router.get('/standings/:seasonId/points-by-race', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const rounds = await queryAll(`
      SELECT gp.id AS gp_id, gp.name, gp.round_order, gp.event_date_start AS event_date,
        EXISTS(SELECT 1 FROM motogp_sessions s2 WHERE s2.grand_prix_id = gp.id AND s2.category = $2 AND s2.session_type = 'SPR') AS has_sprint
      FROM motogp_grands_prix gp
      WHERE gp.year = $1
      ORDER BY gp.round_order
    `, [season.year, season.category]);

    const rows = await queryAll(`
      SELECT
        rs.position, rs.points AS total_points,
        e.id AS entity_id, e.canonical_name, e.slug, COALESCE(e.profile_image_url, e.image_url) AS logo_url, e.death_date,
        co.iso2 AS country_iso2, co.name AS country_name,
        gp.id AS gp_id,
        COALESCE(SUM(sr.points) FILTER (WHERE s.session_type = 'RAC'), 0) AS race_points,
        COALESCE(SUM(sr.points) FILTER (WHERE s.session_type = 'SPR'), 0) AS sprint_points,
        MAX(sr.position) FILTER (WHERE s.session_type = 'RAC') AS race_position
      FROM motogp_rider_standings rs
      JOIN entities e ON e.id = rs.rider_entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      CROSS JOIN motogp_grands_prix gp
      LEFT JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $3
        AND s.session_type IN ('RAC', 'SPR') AND ${officialSession('s')}
      LEFT JOIN motogp_session_results sr ON sr.session_id = s.id AND sr.rider_entity_id = e.id
      WHERE rs.season_id = $1 AND gp.year = $2
      GROUP BY rs.position, rs.points, e.id, e.canonical_name, e.slug, e.image_url, e.death_date, co.iso2, co.name, gp.id
      ORDER BY (rs.position IS NULL), rs.position ASC, gp.round_order
    `, [seasonId, season.year, season.category]);

    // Pivot the flat (rider, gp) rows into one entry per rider with a
    // points_by_gp map — grouped in JS rather than a second round-trip.
    const byRider = new Map();
    for (const r of rows) {
      if (!byRider.has(r.entity_id)) {
        byRider.set(r.entity_id, {
          position: r.position,
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          death_date: r.death_date,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          total_points: r.total_points,
          points_by_gp: {},
        });
      }
      byRider.get(r.entity_id).points_by_gp[r.gp_id] = { race: Number(r.race_points), sprint: Number(r.sprint_points), race_position: r.race_position };
    }

    res.json({
      data: {
        rounds: rounds.map(r => ({ gp_id: r.gp_id, name: r.name, round_order: r.round_order, event_date: r.event_date, has_sprint: r.has_sprint })),
        standings: [...byRider.values()],
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/races/:seasonId
//
// One row per round's RAC winner, plus the SPR winner too on rounds that
// have a sprint (`is_sprint_race` lets the frontend render a second
// sprint-winner row/badge under the same round without a separate call).
// Confirmed via information_schema (motogp_grands_prix has no season_id/
// category of its own — see file-header comment), so scoped the same way
// every other route here does: year + motogp_sessions.category.
//
// Flat field shape (not nested like a "winner" sub-object) — mirrors
// F1's own /races/:seasonId exactly, so MotoGPRacesTemplate can be a
// straight copy of F1RacesTemplate. `pole_rider_name` cross-references
// the GP's own Q-session pole-sitter (name only, matches F1's
// pole_driver_name — no separate "Sprint Qualifying" session concept in
// this schema, unlike F1, so both RAC and SPR rows for a round point at
// the same single Q session's pole-sitter).
router.get('/races/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const rows = await queryAll(`
      SELECT s.id AS session_id, gp.slug, gp.name AS gp_name, gp.round_order, gp.event_date_start AS event_date,
        co.iso2 AS circuit_country_iso2, co.name AS circuit_country_name,
        s.session_type, r.time_result, r.laps, r.points, r.car_number,
        e.id AS rider_id, e.canonical_name AS rider_name, e.slug AS rider_slug, COALESCE(e.profile_image_url, e.image_url) AS rider_image,
        e.birth_date, e.death_date,
        rco.iso2 AS rider_country_iso2, rco.name AS rider_country_name,
        r.team_name AS team_name_raw, r.constructor_name,
        pole.rider_name AS pole_rider_name
      FROM motogp_grands_prix gp
      JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $2 AND s.session_type IN ('RAC', 'SPR') AND ${officialSession('s')}
      JOIN motogp_session_results r ON r.session_id = s.id AND r.position = 1
      JOIN entities e ON e.id = r.rider_entity_id
      LEFT JOIN countries co ON co.id = gp.country_id
      LEFT JOIN countries rco ON rco.id = e.country_id
      LEFT JOIN (
        SELECT qs.grand_prix_id, pe.canonical_name AS rider_name
        FROM motogp_sessions qs
        JOIN motogp_session_results pr ON pr.session_id = qs.id AND pr.position = 1
        JOIN entities pe ON pe.id = pr.rider_entity_id
        WHERE qs.category = $2 AND qs.session_type IN ('Q', 'QP') AND ${officialSession('qs')}
      ) pole ON pole.grand_prix_id = gp.id
      WHERE gp.year = $1
      ORDER BY gp.round_order ASC, (CASE s.session_type WHEN 'SPR' THEN 0 ELSE 1 END)
    `, [season.year, season.category]);

    res.json({
      data: {
        year: season.year,
        category: season.category,
        races: rows.map(r => ({
          session_id: r.session_id,
          slug: r.slug,
          gp_name: r.gp_name,
          round_order: r.round_order,
          event_date: r.event_date,
          circuit_country_iso2: r.circuit_country_iso2,
          circuit_country_name: r.circuit_country_name,
          is_sprint_race: r.session_type === 'SPR',
          rider_id: r.rider_id,
          rider_name: r.rider_name,
          rider_slug: r.rider_slug,
          rider_image: r.rider_image,
          birth_date: r.birth_date,
          death_date: r.death_date,
          rider_country_iso2: r.rider_country_iso2,
          rider_country_name: r.rider_country_name,
          car_number: r.car_number,
          team_name_raw: r.team_name_raw,
          constructor_name: r.constructor_name,
          pole_rider_name: r.pole_rider_name,
          time_result: r.time_result,
          laps: r.laps,
          points: r.points,
        })),
        total: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/poles/:seasonId
// One row per GP's pole-sitter (Q/QP session, position 1). Mirrors F1's own
// /poles/:seasonId shape exactly (flat fields, not nested like /races
// above) so MotoGPPoleTemplate can be a straight copy of F1PoleTemplate.
// Time comes from best_lap_time on the Q/QP session result — confirmed
// populated for 263/263 Q rows this season (unlike RAC/SPR, which have
// none at all, see /standings/:seasonId/riders route comment). 'QP' is the
// legacy single-qualifying-session label used before 'Q' (MotoGP pre-2013,
// Moto2/Moto3 pre-2019) — real pole data exists back to 2005 under that
// label and was previously silently dropped by an 'Q'-only filter.
router.get('/poles/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const rows = await queryAll(`
      SELECT gp.name AS gp_name, gp.slug, gp.event_date_start AS event_date, gp.round_order,
        co.iso2 AS circuit_country_iso2, co.name AS circuit_country_name,
        r.best_lap_time AS time_result, r.car_number,
        e.id AS rider_id, e.canonical_name AS rider_name, e.slug AS rider_slug, COALESCE(e.profile_image_url, e.image_url) AS rider_image,
        e.birth_date, e.death_date,
        rco.iso2 AS rider_country_iso2, rco.name AS rider_country_name,
        r.team_name AS team_name_raw, r.constructor_name
      FROM motogp_grands_prix gp
      JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $2 AND s.session_type IN ('Q', 'QP') AND ${officialSession('s')}
      JOIN motogp_session_results r ON r.session_id = s.id AND r.position = 1
      JOIN entities e ON e.id = r.rider_entity_id
      LEFT JOIN countries co ON co.id = gp.country_id
      LEFT JOIN countries rco ON rco.id = e.country_id
      WHERE gp.year = $1
      ORDER BY gp.round_order
    `, [season.year, season.category]);

    res.json({ data: { year: season.year, category: season.category, poles: rows, total: rows.length } });
  } catch (err) { next(err) }
});

// GET /api/motogp/standings/:seasonId/teams
//
// Wins/podiums(p2/p3)/poles/sprint/constructor derived from
// motogp_session_results grouped by team_name, same pattern as the
// Constructors route below — except team_name isn't clean (see
// TEAM_NAME_ALIASES above), so every join here goes through the
// team_aliases CTE first: COALESCE(alias.to_name, sr.team_name) as the
// grouping key, matched back to motogp_team_standings.team_name. Only
// resolves what's in TEAM_NAME_ALIASES; unverified season/category
// combinations fall through with raw team_name, same as before this
// existed.
//
// LOGO/COUNTRY — joined from entity_type='motogp_team' entities (created
// by rankks-ingestion/create-motogp-team-entities.js, matched here by
// canonical_name = team_name — no FK yet, just an exact string match
// against the same alias-resolved name motogp_team_standings.team_name
// already uses). Null until logos/countries are entered in the admin
// Clubs page; that's expected, not a bug.
router.get('/standings/:seasonId/teams', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const rows = await queryAll(`
      WITH ${teamAliasesCte()}
      SELECT ts.team_name, ts.position, ts.points,
        COALESCE(w.wins, 0) AS wins, COALESCE(w.p2, 0) AS p2, COALESCE(w.p3, 0) AS p3,
        COALESCE(poles.pole_count, 0) AS poles,
        COALESCE(sw.sprint_wins, 0) AS sprint_wins,
        COALESCE(sw.sprint_p2, 0) AS sprint_p2, COALESCE(sw.sprint_p3, 0) AS sprint_p3,
        constructor.constructor_name,
        COALESCE(el.logo_url, te.image_url) AS logo_url,
        co.iso2 AS country_iso2, co.name AS country_name
      FROM motogp_team_standings ts
      LEFT JOIN entities te ON te.entity_type = 'motogp_team' AND te.canonical_name = ts.team_name
      LEFT JOIN entity_logos el ON el.entity_id = te.id
        AND $2::int BETWEEN el.start_year AND COALESCE(el.end_year, 9999)
      LEFT JOIN countries co ON co.id = te.country_id
      LEFT JOIN (
        SELECT COALESCE(ta.to_name, sr.team_name) AS resolved_team_name,
          COUNT(*) FILTER (WHERE sr.position = 1) AS wins,
          COUNT(*) FILTER (WHERE sr.position = 2) AS p2,
          COUNT(*) FILTER (WHERE sr.position = 3) AS p3
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type = 'RAC' AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year = $2
        LEFT JOIN team_aliases ta ON ta.category = $3 AND ta.year = $2 AND ta.from_name = sr.team_name
        GROUP BY COALESCE(ta.to_name, sr.team_name)
      ) w ON w.resolved_team_name = ts.team_name
      LEFT JOIN (
        SELECT COALESCE(ta.to_name, sr.team_name) AS resolved_team_name,
          COUNT(*) FILTER (WHERE sr.position = 1) AS sprint_wins,
          COUNT(*) FILTER (WHERE sr.position = 2) AS sprint_p2,
          COUNT(*) FILTER (WHERE sr.position = 3) AS sprint_p3
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type = 'SPR' AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year = $2
        LEFT JOIN team_aliases ta ON ta.category = $3 AND ta.year = $2 AND ta.from_name = sr.team_name
        GROUP BY COALESCE(ta.to_name, sr.team_name)
      ) sw ON sw.resolved_team_name = ts.team_name
      LEFT JOIN (
        SELECT COALESCE(ta.to_name, sr.team_name) AS resolved_team_name, COUNT(*) AS pole_count
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type IN ('Q', 'QP') AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year = $2
        LEFT JOIN team_aliases ta ON ta.category = $3 AND ta.year = $2 AND ta.from_name = sr.team_name
        WHERE sr.position = 1
        GROUP BY COALESCE(ta.to_name, sr.team_name)
      ) poles ON poles.resolved_team_name = ts.team_name
      LEFT JOIN (
        SELECT COALESCE(ta.to_name, sr.team_name) AS resolved_team_name,
          (ARRAY_AGG(sr.constructor_name))[1] AS constructor_name
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year = $2
        LEFT JOIN team_aliases ta ON ta.category = $3 AND ta.year = $2 AND ta.from_name = sr.team_name
        WHERE sr.constructor_name IS NOT NULL
        GROUP BY COALESCE(ta.to_name, sr.team_name)
      ) constructor ON constructor.resolved_team_name = ts.team_name
      WHERE ts.season_id = $1
      ORDER BY (ts.position IS NULL), ts.position ASC
    `, [seasonId, season.year, season.category]);

    const context = await getSeasonContext(seasonId, season.year, season.category);
    res.json({
      data: {
        year: season.year,
        category: season.category,
        ...context,
        standings: rows.map(r => ({
          team_name: r.team_name,
          position: r.position,
          logo_url: r.logo_url,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          stats: {
            constructor_name: r.constructor_name,
            points: r.points,
            wins: Number(r.wins) || 0,
            p2: Number(r.p2) || 0,
            p3: Number(r.p3) || 0,
            poles: Number(r.poles) || 0,
            sprint_wins: Number(r.sprint_wins) || 0,
            sprint_p2: Number(r.sprint_p2) || 0,
            sprint_p3: Number(r.sprint_p3) || 0,
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// /standings/:seasonId/constructors was removed per explicit instruction
// (the season-level Constructors standings page/tab is gone — Teams
// already surfaces "Constructor: X" per team, and the All-Time >
// Constructor Stats view still covers career constructor records via
// /constructors-all-time/:seasonId below).

// GET /api/motogp/rider-career/:entityId?category=&throughYear=
// Single-rider career totals through a given year, scoped to one class
// lineage (motogp/moto2/moto3) — powers MotoGPChampionshipBlock's career
// stat bloc (Seasons/Champion/Wins/Podiums/Sprint Wins/Sprint Podiums,
// the exact field set motogp_rider_standings itself stores — no "poles"
// column exists in this schema, unlike F1). Same "championships" guard as
// f1.js's /driver-career: a season only counts once every round on the
// shared calendar for that year has actually been raced, so an ongoing
// season's points leader isn't credited with a title before it's decided.
router.get('/rider-career/:entityId', async (req, res, next) => {
  try {
    const { entityId } = req.params;
    const { throughYear } = req.query;
    const category = VALID_CATEGORIES.includes(req.query.category) ? req.query.category : 'motogp';
    if (!throughYear) return res.status(400).json({ error: 'throughYear query param is required' });

    const agg = await queryOne(`
      SELECT
        COUNT(DISTINCT rs.season_id) AS seasons,
        COUNT(*) FILTER (
          WHERE rs.position = 1
            AND NOT EXISTS (
              SELECT 1 FROM motogp_grands_prix gp WHERE gp.year = s.year AND gp.event_date_start > CURRENT_DATE
            )
        ) AS championships,
        MAX(CASE
          WHEN rs.position = 1 AND s.year < $3
            AND NOT EXISTS (
              SELECT 1 FROM motogp_grands_prix gp2 WHERE gp2.year = s.year AND gp2.event_date_start > CURRENT_DATE
            )
          THEN s.year
        END) AS prev_title_year,
        -- rs.wins/podiums/sprint_wins/sprint_podiums are only populated for
        -- a handful of recent seasons (~24-33% coverage, see the WINS/
        -- PODIUMS/POLES comment on /standings/:seasonId/riders) — derived
        -- live from motogp_session_results instead, same pattern.
        COALESCE((
          SELECT COUNT(*) FROM motogp_session_results sr
          JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $4 AND ms.session_type = 'RAC' AND ${officialSession('ms')}
          JOIN motogp_grands_prix gpw ON gpw.id = ms.grand_prix_id AND gpw.year <= $3
          WHERE sr.rider_entity_id = $1 AND sr.position = 1
        ), 0) AS wins,
        COALESCE((
          SELECT COUNT(*) FROM motogp_session_results sr
          JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $4 AND ms.session_type = 'RAC' AND ${officialSession('ms')}
          JOIN motogp_grands_prix gpw ON gpw.id = ms.grand_prix_id AND gpw.year <= $3
          WHERE sr.rider_entity_id = $1 AND sr.position IN (1, 2, 3)
        ), 0) AS podiums,
        COALESCE((
          SELECT COUNT(*) FROM motogp_session_results sr
          JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $4 AND ms.session_type = 'SPR' AND ${officialSession('ms')}
          JOIN motogp_grands_prix gpw ON gpw.id = ms.grand_prix_id AND gpw.year <= $3
          WHERE sr.rider_entity_id = $1 AND sr.position = 1
        ), 0) AS sprint_wins,
        COALESCE((
          SELECT COUNT(*) FROM motogp_session_results sr
          JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $4 AND ms.session_type = 'SPR' AND ${officialSession('ms')}
          JOIN motogp_grands_prix gpw ON gpw.id = ms.grand_prix_id AND gpw.year <= $3
          WHERE sr.rider_entity_id = $1 AND sr.position IN (1, 2, 3)
        ), 0) AS sprint_podiums
      FROM motogp_rider_standings rs
      JOIN seasons s ON s.id = rs.season_id AND s.competition_id = $2 AND s.category = $4 AND s.year <= $3
      WHERE rs.rider_entity_id = $1
    `, [entityId, COMPETITION_ID, throughYear, category]);

    res.json({
      data: {
        seasons: Number(agg?.seasons || 0),
        championships: Number(agg?.championships || 0),
        prev_title_year: agg?.prev_title_year ? parseInt(agg.prev_title_year, 10) : null,
        wins: Number(agg?.wins || 0),
        podiums: Number(agg?.podiums || 0),
        sprint_wins: Number(agg?.sprint_wins || 0),
        sprint_podiums: Number(agg?.sprint_podiums || 0),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/team-career?team_name=&category=&throughYear=
// Team counterpart of /rider-career — same "career total + this-season
// badge" method F1's own /team-career/:entityId uses for
// F1TeamsChampionshipBlock, ported to MotoGPTeamsBlock. wins/podiums/
// poles/sprint_wins/sprint_podiums are already a rollup of every rider who
// rode for this team that round (motogp_session_results.team_name is
// per-result, not per-rider-career), so a rider's individual contribution
// (e.g. a pole) naturally shows up here as this team's own total — no
// separate "combine tied riders" step needed.
//
// KEYED BY team_name (a literal string), not a stable entity_id —
// motogp_team_standings has no FK to the motogp_team entities created this
// build (create-motogp-team-entities.js), only free-text team_name. KNOWN
// LIMITATION: a team whose sponsor name changed across seasons (the exact
// fragmentation TEAM_NAME_ALIASES exists for) undercounts pre-rename
// seasons here — only 2026's aliases are verified, same accepted tradeoff
// /constructors-all-time already carries for the same reason.
//
// TEAMS ONLY — constructor_name (the Constructors tab) has no equivalent
// career route; that tab stays a plain season-only view, unchanged.
router.get('/team-career', async (req, res, next) => {
  try {
    const { team_name, category, throughYear } = req.query;
    if (!team_name || !category || !throughYear) {
      return res.status(400).json({ error: 'team_name, category and throughYear query params are required' });
    }

    const agg = await queryOne(`
      SELECT
        COUNT(DISTINCT ts.season_id) AS seasons,
        COUNT(*) FILTER (
          WHERE ts.position = 1
            AND NOT EXISTS (
              SELECT 1 FROM motogp_grands_prix gpx WHERE gpx.year = s.year AND gpx.event_date_start > CURRENT_DATE
            )
        ) AS championships,
        MAX(CASE
          WHEN ts.position = 1 AND s.year < $4
            AND NOT EXISTS (
              SELECT 1 FROM motogp_grands_prix gpx2 WHERE gpx2.year = s.year AND gpx2.event_date_start > CURRENT_DATE
            )
          THEN s.year
        END) AS prev_title_year
      FROM motogp_team_standings ts
      JOIN seasons s ON s.id = ts.season_id AND s.competition_id = $2 AND s.category = $3 AND s.year <= $4
      WHERE ts.team_name = $1
    `, [team_name, COMPETITION_ID, category, throughYear]);

    const race = await queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE sr.position = 1) AS wins,
        COUNT(*) FILTER (WHERE sr.position = 2) AS p2,
        COUNT(*) FILTER (WHERE sr.position = 3) AS p3
      FROM motogp_session_results sr
      JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $2 AND ms.session_type = 'RAC' AND ${officialSession('ms')}
      JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $3
      WHERE sr.team_name = $1
    `, [team_name, category, throughYear]);

    const poles = await queryOne(`
      SELECT COUNT(*) AS pole_count
      FROM motogp_session_results sr
      JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $2 AND ms.session_type IN ('Q', 'QP') AND ${officialSession('ms')}
      JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $3
      WHERE sr.team_name = $1 AND sr.position = 1
    `, [team_name, category, throughYear]);

    const sprint = await queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE sr.position = 1) AS sprint_wins,
        COUNT(*) FILTER (WHERE sr.position = 2) AS sprint_p2,
        COUNT(*) FILTER (WHERE sr.position = 3) AS sprint_p3
      FROM motogp_session_results sr
      JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $2 AND ms.session_type = 'SPR' AND ${officialSession('ms')}
      JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $3
      WHERE sr.team_name = $1
    `, [team_name, category, throughYear]);

    const wins = Number(race?.wins || 0);
    const p2   = Number(race?.p2 || 0);
    const p3   = Number(race?.p3 || 0);
    const sprintWins = Number(sprint?.sprint_wins || 0);
    const sprintP2   = Number(sprint?.sprint_p2 || 0);
    const sprintP3   = Number(sprint?.sprint_p3 || 0);

    res.json({
      data: {
        seasons: Number(agg?.seasons || 0),
        championships: Number(agg?.championships || 0),
        prev_title_year: agg?.prev_title_year ? parseInt(agg.prev_title_year, 10) : null,
        wins,
        podiums: wins + p2 + p3,
        poles: Number(poles?.pole_count || 0),
        sprint_wins: sprintWins,
        sprint_podiums: sprintWins + sprintP2 + sprintP3,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/rider-round-stats/:entityId?year=&category=&throughRound=
// Cumulative Wins/Podiums/Sprint Wins/Sprint Podiums for one rider within
// one season, counting only rounds up to and including the given
// round_order — powers MotoGPGPBlock's stat bar the same way f1.js's
// /driver-race-stats powers F1GPBlock (fetched twice client-side, this
// round and the previous one, to derive the "+N this round" badges).
router.get('/rider-round-stats/:entityId', async (req, res, next) => {
  try {
    const { entityId } = req.params;
    const { year, category, throughRound } = req.query;
    if (!year || !category || throughRound === undefined) {
      return res.status(400).json({ error: 'year, category and throughRound query params are required' });
    }

    const stats = await queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE s.session_type = 'RAC' AND r.position = 1)              AS wins,
        COUNT(*) FILTER (WHERE s.session_type = 'RAC' AND r.position IN (1, 2, 3))      AS podiums,
        COUNT(*) FILTER (WHERE s.session_type = 'SPR' AND r.position = 1)              AS sprint_wins,
        COUNT(*) FILTER (WHERE s.session_type = 'SPR' AND r.position IN (1, 2, 3))      AS sprint_podiums
      FROM motogp_session_results r
      JOIN motogp_sessions s     ON s.id = r.session_id AND s.category = $2 AND ${officialSession('s')}
      JOIN motogp_grands_prix gp ON gp.id = s.grand_prix_id AND gp.year = $1 AND gp.round_order <= $3
      WHERE r.rider_entity_id = $4
    `, [year, category, throughRound, entityId]);

    res.json({
      data: {
        wins: parseInt(stats?.wins || 0, 10),
        podiums: parseInt(stats?.podiums || 0, 10),
        sprint_wins: parseInt(stats?.sprint_wins || 0, 10),
        sprint_podiums: parseInt(stats?.sprint_podiums || 0, 10),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/riders-all-time/:seasonId
// Career cumulative rider stats "through <year>" — All-Time counterpart of
// /standings/:seasonId/riders, same convention as F1's own
// /drivers-all-time/:seasonId (career-wide, scoped to season.year <= the
// selected year, not just the current grid).
//
// BASE SET — entities.entity_type='driver' is shared across every motor
// sport on this platform (confirmed via direct query: F1 drivers and
// MotoGP riders both use 'driver'), so unlike F1's own all-time route
// (which can safely base off `entities WHERE entity_type='driver'`
// because every join is F1-specific), the base set here is every rider
// who has ever had a motogp_rider_standings row in THIS category — avoids
// pulling in F1 drivers or other sports' entities with zero MotoGP stats.
//
// is_current_grid = rode in the latest season on record FOR THIS
// CATEGORY specifically (a Moto2 rider's "current" grid is the latest
// Moto2 season, not the latest MotoGP one) — same "always the real
// current grid, independent of the viewed year" rule as F1.
router.get('/riders-all-time/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const seasonStatus = await getSeasonContext(seasonId, season.year, season.category);

    const rows = await queryAll(`
      SELECT e.id AS entity_id, e.canonical_name, e.slug, COALESCE(e.profile_image_url, e.image_url) AS logo_url, e.birth_date, e.death_date,
        co.iso2 AS country_iso2, co.name AS country_name,
        COALESCE(agg.seasons, 0) AS seasons,
        COALESCE(agg.championships, 0) AS championships,
        COALESCE(agg.points, 0) AS points,
        COALESCE(podium.wins, 0) AS wins,
        COALESCE(sprint.wins, 0) AS sprint_wins,
        agg.latest_team_name, agg.latest_constructor_name, agg.first_season_year, agg.last_season_year,
        COALESCE(races.race_count, 0) AS races,
        COALESCE(podium.p2, 0) AS p2, COALESCE(podium.p3, 0) AS p3,
        COALESCE(poles.pole_count, 0) AS poles,
        (cg.rider_entity_id IS NOT NULL) AS is_current_grid
      FROM (SELECT DISTINCT rider_entity_id FROM motogp_rider_standings rs0 JOIN seasons s0 ON s0.id = rs0.season_id WHERE s0.competition_id = $2 AND s0.category = $3) base
      JOIN entities e ON e.id = base.rider_entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      LEFT JOIN (
        SELECT rs.rider_entity_id,
          COUNT(DISTINCT rs.season_id) AS seasons,
          -- Same ongoing-season guard as /rider-career — see that route's
          -- comment. Calendar check isn't category-scoped since
          -- motogp_grands_prix is one shared calendar across all 3 classes.
          COUNT(*) FILTER (
            WHERE rs.position = 1
              AND NOT EXISTS (
                SELECT 1 FROM motogp_grands_prix gpx WHERE gpx.year = s2.year AND gpx.event_date_start > CURRENT_DATE
              )
          ) AS championships,
          SUM(rs.points) AS points,
          MIN(s2.year) AS first_season_year,
          MAX(s2.year) AS last_season_year,
          (ARRAY_AGG(rs.team_name ORDER BY s2.year DESC))[1] AS latest_team_name,
          (ARRAY_AGG(rs.constructor_name ORDER BY s2.year DESC))[1] AS latest_constructor_name
        FROM motogp_rider_standings rs
        JOIN seasons s2 ON s2.id = rs.season_id AND s2.competition_id = $2 AND s2.category = $3 AND s2.year <= $1
        GROUP BY rs.rider_entity_id
      ) agg ON agg.rider_entity_id = base.rider_entity_id
      LEFT JOIN (
        SELECT sr.rider_entity_id, COUNT(DISTINCT gp.id) AS race_count
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type = 'RAC' AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $1
        GROUP BY sr.rider_entity_id
      ) races ON races.rider_entity_id = base.rider_entity_id
      LEFT JOIN (
        SELECT sr.rider_entity_id,
          COUNT(*) FILTER (WHERE sr.position = 1) AS wins,
          COUNT(*) FILTER (WHERE sr.position = 2) AS p2,
          COUNT(*) FILTER (WHERE sr.position = 3) AS p3
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type = 'RAC' AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $1
        GROUP BY sr.rider_entity_id
      ) podium ON podium.rider_entity_id = base.rider_entity_id
      LEFT JOIN (
        SELECT sr.rider_entity_id, COUNT(*) FILTER (WHERE sr.position = 1) AS wins
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type = 'SPR' AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $1
        GROUP BY sr.rider_entity_id
      ) sprint ON sprint.rider_entity_id = base.rider_entity_id
      LEFT JOIN (
        SELECT sr.rider_entity_id, COUNT(*) AS pole_count
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type IN ('Q', 'QP') AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $1
        WHERE sr.position = 1
        GROUP BY sr.rider_entity_id
      ) poles ON poles.rider_entity_id = base.rider_entity_id
      LEFT JOIN (
        SELECT DISTINCT rs_cur.rider_entity_id
        FROM motogp_rider_standings rs_cur
        JOIN seasons s_cur ON s_cur.id = rs_cur.season_id AND s_cur.competition_id = $2 AND s_cur.category = $3
        WHERE s_cur.year = (SELECT MAX(year) FROM seasons WHERE competition_id = $2 AND category = $3)
      ) cg ON cg.rider_entity_id = base.rider_entity_id
      ORDER BY COALESCE(agg.points, 0) DESC
    `, [season.year, COMPETITION_ID, season.category]);

    res.json({
      data: {
        year: season.year,
        category: season.category,
        season_status: seasonStatus.season_status,
        riders: rows.map(r => ({
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          birth_date: r.birth_date,
          death_date: r.death_date,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          team_name: r.latest_team_name,
          constructor_name: r.latest_constructor_name,
          // First season this rider ever raced, through the selected
          // year — powers the "<debut>-<viewed year>" range shown under
          // Seas. I Champ., same convention F1DriversAllTimeTemplate uses.
          first_season_year: r.first_season_year ? Number(r.first_season_year) : null,
          last_season_year: r.last_season_year ? Number(r.last_season_year) : null,
          is_current_grid: r.is_current_grid === true,
          stats: {
            seasons: Number(r.seasons),
            championships: Number(r.championships),
            points: r.points,
            races: Number(r.races),
            wins: Number(r.wins) || 0,
            p2: Number(r.p2) || 0,
            p3: Number(r.p3) || 0,
            sprint_wins: Number(r.sprint_wins) || 0,
            poles: Number(r.poles),
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/constructors-all-time/:seasonId
// Career cumulative constructor stats "through <year>" — safe to build
// (unlike a Teams all-time equivalent) for the same reason the
// single-season /standings/:seasonId/constructors route is: constructor_name
// is a clean, consistent field with no sponsor-variant fragmentation.
router.get('/constructors-all-time/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const rows = await queryAll(`
      SELECT base.constructor_name,
        COALESCE(agg.seasons, 0) AS seasons,
        COALESCE(agg.championships, 0) AS championships,
        COALESCE(agg.points, 0) AS points,
        COALESCE(w.wins, 0) AS wins, COALESCE(w.p2, 0) AS p2, COALESCE(w.p3, 0) AS p3,
        COALESCE(sw.sprint_wins, 0) AS sprint_wins,
        COALESCE(poles.pole_count, 0) AS poles,
        agg.first_season_year, agg.last_season_year
      FROM (SELECT DISTINCT constructor_name FROM motogp_constructor_standings cs0 JOIN seasons s0 ON s0.id = cs0.season_id WHERE s0.competition_id = $2 AND s0.category = $3) base
      LEFT JOIN (
        SELECT cs.constructor_name,
          COUNT(DISTINCT cs.season_id) AS seasons,
          -- Same ongoing-season guard as /rider-career/riders-all-time.
          COUNT(*) FILTER (
            WHERE cs.position = 1
              AND NOT EXISTS (
                SELECT 1 FROM motogp_grands_prix gpx WHERE gpx.year = s2.year AND gpx.event_date_start > CURRENT_DATE
              )
          ) AS championships,
          SUM(cs.points) AS points,
          MIN(s2.year) AS first_season_year,
          MAX(s2.year) AS last_season_year
        FROM motogp_constructor_standings cs
        JOIN seasons s2 ON s2.id = cs.season_id AND s2.competition_id = $2 AND s2.category = $3 AND s2.year <= $1
        GROUP BY cs.constructor_name
      ) agg ON agg.constructor_name = base.constructor_name
      LEFT JOIN (
        SELECT sr.constructor_name,
          COUNT(*) FILTER (WHERE sr.position = 1) AS wins,
          COUNT(*) FILTER (WHERE sr.position = 2) AS p2,
          COUNT(*) FILTER (WHERE sr.position = 3) AS p3
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type = 'RAC' AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $1
        GROUP BY sr.constructor_name
      ) w ON w.constructor_name = base.constructor_name
      LEFT JOIN (
        SELECT sr.constructor_name, COUNT(*) AS sprint_wins
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type = 'SPR' AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $1
        WHERE sr.position = 1
        GROUP BY sr.constructor_name
      ) sw ON sw.constructor_name = base.constructor_name
      LEFT JOIN (
        SELECT sr.constructor_name, COUNT(*) AS pole_count
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $3 AND ms.session_type IN ('Q', 'QP') AND ${officialSession('ms')}
        JOIN motogp_grands_prix gp ON gp.id = ms.grand_prix_id AND gp.year <= $1
        WHERE sr.position = 1
        GROUP BY sr.constructor_name
      ) poles ON poles.constructor_name = base.constructor_name
      ORDER BY COALESCE(agg.points, 0) DESC
    `, [season.year, COMPETITION_ID, season.category]);

    res.json({
      data: {
        year: season.year,
        category: season.category,
        constructors: rows.map(r => ({
          constructor_name: r.constructor_name,
          // First/last season this constructor ever competed, through the
          // selected year — power the "<debut>-<last active>" range shown
          // under Seas. I Champ. (last, not the viewed year — a defunct
          // constructor's range must stop at its real last season, same
          // fix as riders-all-time/drivers-all-time).
          first_season_year: r.first_season_year ? Number(r.first_season_year) : null,
          last_season_year: r.last_season_year ? Number(r.last_season_year) : null,
          stats: {
            seasons: Number(r.seasons),
            championships: Number(r.championships),
            points: r.points,
            wins: Number(r.wins) || 0,
            p2: Number(r.p2) || 0,
            p3: Number(r.p3) || 0,
            sprint_wins: Number(r.sprint_wins) || 0,
            poles: Number(r.poles),
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/races-all-time/:seasonId
// Career cumulative per-Grand-Prix records "through <year>" — grouped by
// gp.slug, the stable cross-season identity (confirmed via direct query:
// 57 distinct slugs vs. 97 distinct names — the same GP is scraped under
// different name spellings across eras, e.g. "GRAN PREMIO DE ARAGÓN" vs
// "GRAND PRIX OF ARAGON", same reasoning as F1's own slug grouping).
//
// "Greater Wins/Poles/Sprint Wins" — the single rider with the most RAC
// wins / Q poles / SPR wins at that specific GP, via DISTINCT ON per slug
// ordered by count desc (ties broken by rider_entity_id, a known
// simplification for a single-name column — same as F1).
router.get('/races-all-time/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year, category FROM seasons WHERE id = $1 AND competition_id = $2`, [seasonId, COMPETITION_ID]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const rows = await queryAll(`
      WITH race_editions AS (
        SELECT gp.id, gp.slug, gp.name, gp.year, gp.country_id
        FROM motogp_grands_prix gp
        JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $2 AND s.session_type = 'RAC' AND ${officialSession('s')}
        WHERE gp.year <= $1 AND gp.event_date_start <= CURRENT_DATE
      ),
      gp_meta AS (
        SELECT slug,
          (ARRAY_AGG(name ORDER BY year DESC))[1]       AS latest_name,
          (ARRAY_AGG(country_id ORDER BY year DESC))[1] AS latest_country_id,
          MIN(year) AS first_year,
          MAX(year) AS last_year,
          COUNT(*)  AS race_count
        FROM race_editions
        GROUP BY slug
      ),
      -- Active = still on the REAL current calendar for this category
      -- (latest scheduled year, whether that round has actually RUN yet
      -- or not), independent of the "through <year>" being viewed — same
      -- "always the real current grid" rule as is_current_grid elsewhere
      -- (riders-all-time). Not derived from gp_meta.last_year: a GP whose
      -- next edition is scheduled but hasn't raced yet would otherwise
      -- wrongly read as defunct through last season's raced-only cap
      -- (race_editions above filters to event_date_start <= CURRENT_DATE).
      current_slugs AS (
        SELECT DISTINCT gp.slug
        FROM motogp_grands_prix gp
        JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $2 AND s.session_type = 'RAC' AND ${officialSession('s')}
        WHERE gp.year = (
          SELECT MAX(gp2.year)
          FROM motogp_grands_prix gp2
          JOIN motogp_sessions s2 ON s2.grand_prix_id = gp2.id AND s2.category = $2 AND s2.session_type = 'RAC' AND ${officialSession('s2')}
        )
      ),
      race_wins AS (
        SELECT re.slug, sr.rider_entity_id, COUNT(*) AS win_count
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $2 AND ms.session_type = 'RAC' AND ${officialSession('ms')}
        JOIN race_editions re   ON re.id = ms.grand_prix_id
        WHERE sr.position = 1
        GROUP BY re.slug, sr.rider_entity_id
      ),
      top_wins AS (
        SELECT DISTINCT ON (slug) slug, rider_entity_id, win_count
        FROM race_wins ORDER BY slug, win_count DESC, rider_entity_id ASC
      ),
      race_poles AS (
        SELECT re.slug, sr.rider_entity_id, COUNT(*) AS pole_count
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $2 AND ms.session_type IN ('Q', 'QP') AND ${officialSession('ms')}
        JOIN race_editions re   ON re.id = ms.grand_prix_id
        WHERE sr.position = 1
        GROUP BY re.slug, sr.rider_entity_id
      ),
      top_poles AS (
        SELECT DISTINCT ON (slug) slug, rider_entity_id, pole_count
        FROM race_poles ORDER BY slug, pole_count DESC, rider_entity_id ASC
      ),
      race_sprints AS (
        SELECT re.slug, sr.rider_entity_id, COUNT(*) AS sprint_count
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $2 AND ms.session_type = 'SPR' AND ${officialSession('ms')}
        JOIN race_editions re   ON re.id = ms.grand_prix_id
        WHERE sr.position = 1
        GROUP BY re.slug, sr.rider_entity_id
      ),
      top_sprints AS (
        SELECT DISTINCT ON (slug) slug, rider_entity_id, sprint_count
        FROM race_sprints ORDER BY slug, sprint_count DESC, rider_entity_id ASC
      )
      SELECT gm.slug, gm.latest_name, gm.first_year, gm.last_year, gm.race_count,
        (cs.slug IS NOT NULL) AS is_current_calendar,
        co.iso2 AS country_iso2, co.name AS country_name,
        rw.canonical_name AS win_rider_name, rw.slug AS win_rider_slug, rw.death_date AS win_rider_death_date, rwco.iso2 AS win_rider_iso2, rwco.name AS win_rider_country_name, tw.win_count,
        rp.canonical_name AS pole_rider_name, rp.slug AS pole_rider_slug, rp.death_date AS pole_rider_death_date, rpco.iso2 AS pole_rider_iso2, rpco.name AS pole_rider_country_name, tp.pole_count,
        rs.canonical_name AS sprint_rider_name, rs.slug AS sprint_rider_slug, rs.death_date AS sprint_rider_death_date, rsco.iso2 AS sprint_rider_iso2, rsco.name AS sprint_rider_country_name, tsp.sprint_count
      FROM gp_meta gm
      LEFT JOIN current_slugs cs ON cs.slug = gm.slug
      LEFT JOIN countries co ON co.id = gm.latest_country_id
      LEFT JOIN top_wins tw     ON tw.slug = gm.slug
      LEFT JOIN entities rw     ON rw.id = tw.rider_entity_id
      LEFT JOIN countries rwco  ON rwco.id = rw.country_id
      LEFT JOIN top_poles tp    ON tp.slug = gm.slug
      LEFT JOIN entities rp     ON rp.id = tp.rider_entity_id
      LEFT JOIN countries rpco  ON rpco.id = rp.country_id
      LEFT JOIN top_sprints tsp ON tsp.slug = gm.slug
      LEFT JOIN entities rs     ON rs.id = tsp.rider_entity_id
      LEFT JOIN countries rsco  ON rsco.id = rs.country_id
      ORDER BY gm.race_count DESC, gm.first_year ASC
    `, [season.year, season.category]);

    res.json({
      data: {
        year: season.year,
        category: season.category,
        races: rows.map(r => ({
          slug: r.slug,
          name: r.latest_name,
          first_year: Number(r.first_year),
          last_year: Number(r.last_year),
          is_current_calendar: r.is_current_calendar === true,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          stats: {
            race_count: Number(r.race_count),
            greater_wins: r.win_rider_name ? { rider_name: r.win_rider_name, rider_slug: r.win_rider_slug, death_date: r.win_rider_death_date, country_iso2: r.win_rider_iso2, country_name: r.win_rider_country_name, count: Number(r.win_count) } : null,
            greater_poles: r.pole_rider_name ? { rider_name: r.pole_rider_name, rider_slug: r.pole_rider_slug, death_date: r.pole_rider_death_date, country_iso2: r.pole_rider_iso2, country_name: r.pole_rider_country_name, count: Number(r.pole_count) } : null,
            greater_sprint_wins: r.sprint_rider_name ? { rider_name: r.sprint_rider_name, rider_slug: r.sprint_rider_slug, death_date: r.sprint_rider_death_date, country_iso2: r.sprint_rider_iso2, country_name: r.sprint_rider_country_name, count: Number(r.sprint_count) } : null,
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/motogp/gp-top-winners/:slug?category=motogp|moto2|moto3
// Top 3 riders by win count for each of RAC/Q(P)/SPR at one specific
// Grand Prix, each with the years they won — MotoGP counterpart of F1's
// own /gp-top-winners/:slug (Mohamed 2026-08-21: "Flag + profile +
// Lando Norris - 3 wins (2020, 2022, 2023)... Show the top 3... Stats for
// each session: record of wins, qualifying, sprint"). Category-scoped and
// deduped the same way races-all-time above already is — motogp_sessions
// has no single canonical Qualifying code (Q for the modern two-part
// format, QP for the legacy single session), so both are grouped together
// under one 'Qualifying' bucket rather than shown as two separate rows.
// Practice (FP/PR, numbered when the era split it into FP1/FP2) and Warm
// Up are included too, not just Race/Qualifying/Sprint (Mohamed
// 2026-08-21: "u dont show top 3 performances for Italy Practice 1, etc.
// Why? We have historical data").
router.get('/gp-top-winners/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const category = (req.query.category || 'motogp').toLowerCase();
    if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });

    const rows = await queryAll(`
      WITH editions AS (
        SELECT gp.id, gp.year
        FROM motogp_grands_prix gp
        WHERE gp.slug = $1 AND gp.event_date_start <= CURRENT_DATE
      ),
      session_wins AS (
        SELECT
          CASE WHEN ms.session_type = 'RAC' THEN 'Race'
               WHEN ms.session_type = 'SPR' THEN 'Sprint'
               WHEN ms.session_type IN ('Q', 'QP') THEN 'Qualifying'
               WHEN ms.session_type = 'WUP' THEN 'Warm Up'
               WHEN ms.session_type IN ('FP', 'PR') AND ms.session_number IS NOT NULL THEN 'Practice ' || ms.session_number
               WHEN ms.session_type IN ('FP', 'PR') THEN 'Practice'
               ELSE ms.session_type
          END AS session_label,
          sr.rider_entity_id, ed.year
        FROM motogp_session_results sr
        JOIN motogp_sessions ms ON ms.id = sr.session_id AND ms.category = $2 AND ${officialSession('ms')}
        JOIN editions ed ON ed.id = ms.grand_prix_id
        WHERE sr.position = 1
      ),
      agg AS (
        SELECT session_label, rider_entity_id, COUNT(*) AS win_count, ARRAY_AGG(year ORDER BY year) AS years
        FROM session_wins
        GROUP BY session_label, rider_entity_id
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY session_label ORDER BY win_count DESC, rider_entity_id ASC) AS rn
        FROM agg
      )
      SELECT r.session_label, r.win_count, r.years,
        rd.canonical_name AS rider_name, rd.slug AS rider_slug, rd.death_date,
        co.iso2 AS country_iso2, co.name AS country_name
      FROM ranked r
      JOIN entities rd ON rd.id = r.rider_entity_id
      LEFT JOIN countries co ON co.id = rd.country_id
      WHERE r.rn <= 3
      ORDER BY r.session_label, r.rn
    `, [slug, category]);

    const sessions = {};
    rows.forEach(r => {
      if (!sessions[r.session_label]) sessions[r.session_label] = [];
      sessions[r.session_label].push({
        driver_name: r.rider_name, driver_slug: r.rider_slug, death_date: r.death_date,
        country_iso2: r.country_iso2, country_name: r.country_name,
        win_count: Number(r.win_count), years: r.years,
      });
    });
    res.json({ data: { slug, category, sessions } });
  } catch (err) { next(err) }
});

// GET /api/motogp/gp-history/:slug/:year?category=motogp|moto2|moto3
// "All-Time Results" drawer for one Grand Prix — MotoGP counterpart of F1's
// /gp-history/:slug/:year (P1/P2/P3 podium per edition, most recent first,
// win_ordinal = the P1 rider's Nth win at this GP). Category-scoped like
// every other MotoGP route — motogp_grands_prix has no category column, so
// an "edition" only counts if THIS category actually raced it (via the RAC
// session join, same officialSession() dedup as races-all-time).
router.get('/gp-history/:slug/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;
    const yearInt = parseInt(year);
    const category = categoryOf(req);

    const rows = await queryAll(`
      WITH ${teamAliasesCte()},
      editions AS (
        SELECT gp.id, gp.slug, gp.year,
          ROW_NUMBER() OVER (ORDER BY gp.year ASC) AS edition_number
        FROM motogp_grands_prix gp
        JOIN motogp_sessions s ON s.grand_prix_id = gp.id AND s.category = $3 AND s.session_type = 'RAC' AND ${officialSession('s')}
        WHERE gp.slug = $1 AND gp.year <= $2 AND gp.event_date_start <= CURRENT_DATE
      ),
      results AS (
        SELECT e.year, e.edition_number,
          r1.rider_entity_id AS p1_rider_id, COALESCE(ta1.to_name, r1.team_name) AS p1_team,
          r2.rider_entity_id AS p2_rider_id, COALESCE(ta2.to_name, r2.team_name) AS p2_team,
          r3.rider_entity_id AS p3_rider_id, COALESCE(ta3.to_name, r3.team_name) AS p3_team,
          COUNT(*) OVER (PARTITION BY r1.rider_entity_id ORDER BY e.year ASC) AS win_ordinal
        FROM editions e
        JOIN motogp_sessions s ON s.grand_prix_id = e.id AND s.category = $3 AND s.session_type = 'RAC' AND ${officialSession('s')}
        LEFT JOIN motogp_session_results r1 ON r1.session_id = s.id AND r1.position = 1
        LEFT JOIN motogp_session_results r2 ON r2.session_id = s.id AND r2.position = 2
        LEFT JOIN motogp_session_results r3 ON r3.session_id = s.id AND r3.position = 3
        LEFT JOIN team_aliases ta1 ON ta1.category = $3 AND ta1.year = e.year AND ta1.from_name = r1.team_name
        LEFT JOIN team_aliases ta2 ON ta2.category = $3 AND ta2.year = e.year AND ta2.from_name = r2.team_name
        LEFT JOIN team_aliases ta3 ON ta3.category = $3 AND ta3.year = e.year AND ta3.from_name = r3.team_name
      )
      SELECT r.year, r.edition_number, r.win_ordinal,
        d1.canonical_name AS p1_name, d1.slug AS p1_slug, d1.death_date AS p1_death_date,
        c1.iso2 AS p1_iso2, c1.name AS p1_country, r.p1_team,
        d2.canonical_name AS p2_name, d2.slug AS p2_slug, d2.death_date AS p2_death_date,
        c2.iso2 AS p2_iso2, c2.name AS p2_country, r.p2_team,
        d3.canonical_name AS p3_name, d3.slug AS p3_slug, d3.death_date AS p3_death_date,
        c3.iso2 AS p3_iso2, c3.name AS p3_country, r.p3_team
      FROM results r
      LEFT JOIN entities d1 ON d1.id = r.p1_rider_id
      LEFT JOIN countries c1 ON c1.id = d1.country_id
      LEFT JOIN entities d2 ON d2.id = r.p2_rider_id
      LEFT JOIN countries c2 ON c2.id = d2.country_id
      LEFT JOIN entities d3 ON d3.id = r.p3_rider_id
      LEFT JOIN countries c3 ON c3.id = d3.country_id
      ORDER BY r.year DESC
    `, [slug, yearInt, category]);

    const podiumSpot = (name, slug, death_date, iso2, country, team, ordinal) =>
      name ? { name, slug, death_date, iso2, country, team, ...(ordinal !== undefined ? { ordinal } : {}) } : null;

    res.json({
      data: {
        rows: rows.map(r => ({
          year: r.year,
          edition: r.edition_number != null ? Number(r.edition_number) : null,
          p1: podiumSpot(r.p1_name, r.p1_slug, r.p1_death_date, r.p1_iso2, r.p1_country, r.p1_team, r.win_ordinal != null ? Number(r.win_ordinal) : null),
          p2: podiumSpot(r.p2_name, r.p2_slug, r.p2_death_date, r.p2_iso2, r.p2_country, r.p2_team),
          p3: podiumSpot(r.p3_name, r.p3_slug, r.p3_death_date, r.p3_iso2, r.p3_country, r.p3_team),
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

module.exports = router;
