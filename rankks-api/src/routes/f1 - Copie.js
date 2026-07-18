// src/routes/f1.js
// F1 has its own dedicated tables (f1_seasons, f1_grands_prix, f1_sessions,
// f1_session_results, f1_fastest_laps, f1_driver_standings,
// f1_team_standings) — separate from the generic seasons/result_tabs/
// standings/games tables football and tennis use. See RANKKS F1 Master
// Spec for the FOR1-NAV-01 navigation pattern and template column sets
// these endpoints are built to serve.
//
// VIDEO TABLES (added for the F1 video feature) — f1_race_videos (one row
// per f1_grands_prix.id, enforced by a UNIQUE constraint — "one summary
// video per race/season") and f1_iconic_moments (many rows per
// f1_seasons.id — a season-level gallery, same pattern as the generic
// media/iconic_moment_categories system football/tennis use, just
// pointed at F1's own tables instead of the generic schema).
//
// KNOWN GAPS, not fixed here — same ones flagged during data loading:
//   - Driver/team country_iso2/country_name: entities.country_id was
//     never populated for F1 entities (nationality text like "GER"/"BRA"
//     was scraped but never resolved to a countries.id). Every country
//     field below is null until that backfill happens. The frontend's
//     Flag component already handles a null iso2 gracefully.
//   - Circuit name/location: confirmed absent from F1.com entirely
//     (see master spec §5, open items). circuit_name is always null.
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// Sorts by numeric position first (ascending), non-numeric (e.g. 'NC')
// last — used everywhere a position/grid column can contain that value.
const POSITION_ORDER = `
  (position ~ '^[0-9]+$') DESC,
  CASE WHEN position ~ '^[0-9]+$' THEN position::int ELSE 9999 END
`;

// GET /api/f1/years
router.get('/years', async (req, res, next) => {
  try {
    const rows = await queryAll(`SELECT year FROM f1_seasons ORDER BY year ASC`);
    res.json({ data: rows.map(r => r.year) });
  } catch (err) { next(err) }
});

// GET /api/f1/season/:year — GP list for Line A
router.get('/season/:year', async (req, res, next) => {
  try {
    const { year } = req.params;
    const season = await queryOne(`SELECT id, year FROM f1_seasons WHERE year = $1`, [year]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const gps = await queryAll(`
      SELECT id, name, slug, circuit_country, event_date, round_order, is_sprint_weekend
      FROM f1_grands_prix
      WHERE f1_season_id = $1
      ORDER BY round_order
    `, [season.id]);

    // Iconic Moments Line B tab is only shown when this season actually
    // has at least one row — same conditional-visibility rule Section 30
    // of the spec applies to the generic /api/seasons route for
    // football/tennis. F1 has no result_tabs row to omit (it doesn't use
    // that table at all), so the check travels as a flag on this response
    // instead, and F1ContentArea.jsx decides whether to render the tab.
    const iconicCheck = await queryOne(`
      SELECT EXISTS (SELECT 1 FROM f1_iconic_moments WHERE season_id = $1) AS has_iconic_moments
    `, [season.id]);

    res.json({
      data: {
        season_id: season.id,
        year: season.year,
        has_iconic_moments: !!iconicCheck?.has_iconic_moments,
        gps: gps.map(g => ({
          id: g.id,
          name: g.name,
          slug: g.slug,
          city: null,                      // not available from source — see file header
          logo_url: null,
          country_iso2: null,              // not available — see file header
          country_name: g.circuit_country,
          flag_url: null,
          circuit_name: null,              // not available — see file header
          circuit_image: null,
          first_session_date: g.event_date,
          race_date: g.event_date,
          is_sprint_weekend: g.is_sprint_weekend,
          is_cancelled: false,
        })),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/gp/:slug/:year — one GP's session list for Line B
// Extended (video feature) with a LEFT JOIN on f1_race_videos so the
// "Watch summary" video (if any) travels with the GP data the frontend
// already fetches — no extra round trip, same pattern as the generic
// games route joining media for football/tennis match videos.
router.get('/gp/:slug/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;
    const season = await queryOne(`SELECT id FROM f1_seasons WHERE year = $1`, [year]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const gp = await queryOne(`
      SELECT gp.id, gp.name, gp.slug, gp.circuit_country, gp.event_date, gp.is_sprint_weekend, gp.round_order,
        rv.video_url, rv.source AS video_source, rv.embeddable AS video_embeddable, rv.thumbnail_url AS video_thumbnail_url
      FROM f1_grands_prix gp
      LEFT JOIN f1_race_videos rv ON rv.grand_prix_id = gp.id
      WHERE gp.f1_season_id = $1 AND gp.slug = $2
    `, [season.id, slug]);
    if (!gp) return res.status(404).json({ error: 'Grand Prix not found' });

    const sessions = await queryAll(`
      SELECT s.id, s.session_type, s.display_order,
        (SELECT MAX(laps) FROM f1_session_results WHERE session_id = s.id) AS laps_total
      FROM f1_sessions s
      WHERE s.grand_prix_id = $1
      ORDER BY s.display_order
    `, [gp.id]);

    res.json({
      data: {
        season_id: season.id,
        gp: {
          id: gp.id,
          name: gp.name,
          slug: gp.slug,
          city: null,
          season_id: season.id,
          round_order: gp.round_order,
          video_url: gp.video_url,
          video_source: gp.video_source,
          video_embeddable: gp.video_embeddable,
          video_thumbnail_url: gp.video_thumbnail_url,
        },
        sessions: sessions.map(s => ({
          id: s.id,
          api_session_id: null,
          session_type: s.session_type,
          session_date: gp.event_date,     // per-session dates weren't scraped, GP-level date used for all
          laps_total: s.laps_total,
          fastest_lap_time: null,
          distance: null,
          status: 'Completed',
          is_sprint_weekend: gp.is_sprint_weekend,
          display_order: s.display_order,
          circuit_id: null,
          circuit_name: null,              // not available — see file header
          circuit_image: null,
          circuit_country_iso2: null,
        })),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/session/:sessionId/results
// UPDATED — session lookup now joins f1_grands_prix so event_date travels
// with the response as session.event_date. This is the reference date
// used client-side by calcAge() for both Race Results/Practice
// (F1SessionResultsTemplate) and Qualifying (F1QualifyingTemplate), which
// both consume this same route.
router.get('/session/:sessionId/results', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await queryOne(`
      SELECT s.id, s.session_type, gp.event_date
      FROM f1_sessions s
      JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
      WHERE s.id = $1
    `, [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const results = await queryAll(`
      SELECT sr.position, sr.car_number, sr.laps, sr.time_result, sr.points,
        sr.q1_time, sr.q2_time, sr.q3_time, sr.grid_position,
        d.id AS driver_id, d.canonical_name AS driver_name, d.slug AS driver_slug, d.image_url AS driver_image,
        d.birth_date,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        t.id AS team_id, t.canonical_name AS team_name, t.image_url AS team_logo
      FROM f1_session_results sr
      JOIN entities d ON d.id = sr.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN entities t ON t.id = sr.team_entity_id
      WHERE sr.session_id = $1
      ORDER BY ${POSITION_ORDER.replace(/position/g, 'sr.position')}
    `, [sessionId]);

    res.json({ data: { session, results, total: results.length } });
  } catch (err) { next(err) }
});

// GET /api/f1/races/:seasonId — season overview, one row per race (winner only, per locked spec)
// Extended with d.image_url / t.image_url so the Races table can show the
// same driver-avatar treatment used everywhere else in the app (was
// previously omitted, leaving F1RacesTemplate with no image field to read).
// Also joins countries on the winning driver's country_id (admin-editable
// via the Clubs/Athletes country picker) for the flag + country display.
router.get('/races/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const races = await queryAll(`
      SELECT gp.id AS race_id, gp.name AS gp_name, gp.slug, gp.circuit_country,
        gp.event_date, gp.is_sprint_weekend, gp.round_order,
        sr.time_result, sr.laps,
        d.id AS driver_id, d.canonical_name AS driver_name, d.slug AS driver_slug, d.image_url AS driver_image,
        d.birth_date,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        t.id AS team_id, t.canonical_name AS team_name, t.image_url AS team_logo
      FROM f1_grands_prix gp
      JOIN f1_sessions s ON s.grand_prix_id = gp.id AND s.session_type = 'Race'
      JOIN f1_session_results sr ON sr.session_id = s.id AND sr.position = '1'
      JOIN entities d ON d.id = sr.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN entities t ON t.id = sr.team_entity_id
      WHERE gp.f1_season_id = $1
      ORDER BY gp.round_order
    `, [seasonId]);

    res.json({ data: { races, total: races.length } });
  } catch (err) { next(err) }
});

// GET /api/f1/fastest-laps/:seasonId
// Extended with d.image_url / t.image_url — same reasoning as /races above.
// Team is derived with a fallback: use f1_fastest_laps.team_entity_id if
// present, otherwise pull the driver's team from their own Race session
// result for that same GP. This fixes rows showing no team at all when
// team_entity_id was never populated on the fastest-lap row itself — the
// Race result is the more reliable source anyway, since it reflects
// exactly who the driver raced for that weekend.
router.get('/fastest-laps/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const laps = await queryAll(`
      SELECT gp.name AS gp_name, gp.slug, gp.circuit_country, gp.event_date, gp.round_order,
        d.id AS driver_id, d.canonical_name AS driver_name, d.slug AS driver_slug, d.image_url AS driver_image,
        d.birth_date,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        t.id AS team_id, t.canonical_name AS team_name, t.image_url AS team_logo,
        fl.time_result
      FROM f1_fastest_laps fl
      JOIN f1_grands_prix gp ON gp.id = fl.grand_prix_id
      JOIN entities d ON d.id = fl.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN f1_sessions rs ON rs.grand_prix_id = gp.id AND rs.session_type = 'Race'
      LEFT JOIN f1_session_results sr ON sr.session_id = rs.id AND sr.driver_entity_id = fl.driver_entity_id
      LEFT JOIN entities t ON t.id = COALESCE(fl.team_entity_id, sr.team_entity_id)
      WHERE gp.f1_season_id = $1
      ORDER BY gp.round_order
    `, [seasonId]);

    res.json({ data: { laps, total: laps.length } });
  } catch (err) { next(err) }
});

// GET /api/f1/standings/:seasonId/drivers
// UPDATED — season_end_date added to the top-level response, computed as
// MAX(event_date) across every GP in this season. This is the F1
// equivalent of football/tennis's season.end_date, needed because F1's
// season-level standings table has no single date of its own to anchor
// age calculations against. Used client-side by calcAge() for every
// driver row in F1DriversTemplate.
router.get('/standings/:seasonId/drivers', async (req, res, next) => {
  try {
    const { seasonId } = req.params;

    // season_status: computed, never stored (Option B — f1_seasons has no
    // status column, unlike the generic seasons table, and deliberately
    // stays that way). A season is 'current' if it has at least one GP
    // already raced AND at least one still upcoming; 'past' if every GP
    // has raced; 'future' if none have. Drives the EventBlock's
    // Winner/Champion vs "Current Leader" label — see F1EventBlock.jsx.
    const seasonMeta = await queryOne(`
      SELECT
        MAX(event_date)                          AS season_end_date,
        BOOL_OR(event_date <= CURRENT_DATE)       AS has_raced,
        BOOL_OR(event_date > CURRENT_DATE)        AS has_upcoming
      FROM f1_grands_prix
      WHERE f1_season_id = $1
    `, [seasonId]);

    const seasonStatus = seasonMeta?.has_raced && seasonMeta?.has_upcoming
      ? 'current'
      : seasonMeta?.has_raced
      ? 'past'
      : 'future';

    const rows = await queryAll(`
      SELECT ds.position, ds.points, ds.wins, ds.p2, ds.p3, ds.sprint_wins, ds.car_number,
        d.id AS entity_id, d.canonical_name, d.slug, d.image_url AS logo_url, d.birth_date,
        co.iso2 AS country_iso2, co.name AS country_name,
        t.canonical_name AS team_name,
        COALESCE(poles.pole_count, 0) AS poles
      FROM f1_driver_standings ds
      JOIN entities d ON d.id = ds.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN entities t ON t.id = ds.team_entity_id
      LEFT JOIN (
        -- No stored "poles" column exists on f1_driver_standings — pole
        -- position is derived here as a count of Qualifying-session P1
        -- results across every GP in this season, per driver.
        SELECT sr.driver_entity_id, COUNT(*) AS pole_count
        FROM f1_session_results sr
        JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type = 'Qualifying'
        JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id AND gp.f1_season_id = $1
        WHERE sr.position = '1'
        GROUP BY sr.driver_entity_id
      ) poles ON poles.driver_entity_id = ds.driver_entity_id
      WHERE ds.f1_season_id = $1
      ORDER BY ${POSITION_ORDER.replace(/position/g, 'ds.position')}
    `, [seasonId]);

    res.json({
      data: {
        season_end_date: seasonMeta?.season_end_date || null,
        season_status: seasonStatus,
        standings: rows.map(r => ({
          position: r.position,
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          birth_date: r.birth_date,
          country_iso2: r.country_iso2,   // now real — was previously hardcoded null
          country_name: r.country_name,   // now real — was previously hardcoded null
          stats: {
            team_name: r.team_name,
            points: r.points,
            wins: r.wins,
            p2: r.p2,
            p3: r.p3,
            sprint_wins: r.sprint_wins,
            poles: r.poles,
            number: r.car_number,
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/standings/:seasonId/teams
// season_status added — same computed (never stored) logic as the
// drivers route above, needed by F1TeamsChampionshipBlock for the same
// Winner/"Current Leader" label swap.
router.get('/standings/:seasonId/teams', async (req, res, next) => {
  try {
    const { seasonId } = req.params;

    const seasonMeta = await queryOne(`
      SELECT
        BOOL_OR(event_date <= CURRENT_DATE) AS has_raced,
        BOOL_OR(event_date > CURRENT_DATE)  AS has_upcoming
      FROM f1_grands_prix
      WHERE f1_season_id = $1
    `, [seasonId]);

    const seasonStatus = seasonMeta?.has_raced && seasonMeta?.has_upcoming
      ? 'current'
      : seasonMeta?.has_raced
      ? 'past'
      : 'future';

    const rows = await queryAll(`
      SELECT ts.position, ts.points, ts.wins, ts.p2, ts.p3, ts.sprint_wins,
        ts.country_name AS scraped_country_name,
        t.id AS entity_id, t.canonical_name, t.slug, t.image_url AS logo_url,
        co_admin.iso2 AS iso2_by_admin, co_admin.name AS name_by_admin,
        co_scrape.iso2 AS iso2_by_scrape,
        COALESCE(poles.pole_count, 0) AS poles
      FROM f1_team_standings ts
      JOIN entities t ON t.id = ts.team_entity_id
      LEFT JOIN countries co_admin  ON co_admin.id = t.country_id
      LEFT JOIN countries co_scrape ON co_scrape.name = ts.country_name
      LEFT JOIN (
        -- Same derivation as the driver route, aggregated by team instead
        -- — i.e. the sum of both drivers' Qualifying P1 results for this
        -- team across the season ("aggregate of pilots' results").
        SELECT sr.team_entity_id, COUNT(*) AS pole_count
        FROM f1_session_results sr
        JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type = 'Qualifying'
        JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id AND gp.f1_season_id = $1
        WHERE sr.position = '1'
        GROUP BY sr.team_entity_id
      ) poles ON poles.team_entity_id = ts.team_entity_id
      WHERE ts.f1_season_id = $1
      ORDER BY ${POSITION_ORDER.replace(/position/g, 'ts.position')}
    `, [seasonId]);

    res.json({
      data: {
        season_status: seasonStatus,
        standings: rows.map(r => ({
          position: r.position,
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          // Prefer the admin-set country (entities.country_id, editable in
          // the Clubs admin page) — fall back to the legacy scraped
          // f1_team_standings.country_name column if admin hasn't set one
          // for this team yet.
          country_iso2: r.iso2_by_admin || r.iso2_by_scrape,
          country_name: r.name_by_admin || r.scraped_country_name,
          stats: {
            points: r.points,
            wins: r.wins,
            p2: r.p2,
            p3: r.p3,
            sprint_wins: r.sprint_wins,
            poles: r.poles,
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/iconic-moments/:seasonId — season-level gallery, backed by
// f1_iconic_moments (mirrors the generic /results/iconic-moments/:seasonId
// route's response shape — { items, total } — so the shared
// iconic_moments_template.jsx component works against either source
// unmodified, just pointed at a different fetch function).
router.get('/iconic-moments/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const { category, tag } = req.query;

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

    const items = await queryAll(`
      SELECT id, title, video_url, source, embeddable, category, tags, display_order, thumbnail_url
      FROM f1_iconic_moments
      WHERE ${conditions.join(' AND ')}
      ORDER BY display_order NULLS LAST, id
    `, params);

    res.json({ data: { items, total: items.length } });
  } catch (err) { next(err) }
});

// GET /api/f1/seasons/by-competition — admin Seasons panel data source.
// Mirrors the shape of the generic GET /api/seasons/by-competition route
// (seasons.js) that Competitions.jsx already calls for football/tennis,
// so the frontend can branch on sport_slug and swap the fetch URL without
// needing a different response contract. competition_id is accepted for
// call-shape parity but ignored: f1_seasons has no competition_id column
// (F1 lives in its own tables, unrelated to the generic competitions FK
// structure — see file header), and there is only ever one F1 entry in
// the generic competitions table, so "by competition" is moot for F1 —
// every f1_seasons row is returned.
router.get('/seasons/by-competition', async (req, res, next) => {
  try {
    const seasons = await queryAll(`
      SELECT
        s.id, s.year,
        COUNT(gp.id)                                      AS race_count,
        COUNT(gp.id) FILTER (WHERE gp.is_sprint_weekend)   AS sprint_count,
        MIN(gp.event_date)                                 AS start_date,
        MAX(gp.event_date)                                 AS end_date,
        EXISTS (
          SELECT 1 FROM f1_driver_standings ds WHERE ds.f1_season_id = s.id
        ) AS ingested
      FROM f1_seasons s
      LEFT JOIN f1_grands_prix gp ON gp.f1_season_id = s.id
      GROUP BY s.id, s.year
      ORDER BY s.year DESC
    `);
    res.json({ data: seasons });
  } catch (err) { next(err) }
});

// GET /api/f1/grands-prix/:seasonId — race-level drill-down for a season
// row in the admin Seasons panel (Competitions.jsx expands each F1 season
// row into its individual Grands Prix, mirroring the multi-edition drill
// football/tennis seasons don't need since one competition row = one race
// weekend list per year for F1, not multiple sub-editions).
router.get('/grands-prix/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const races = await queryAll(`
      SELECT gp.id, gp.name, gp.slug, gp.circuit_country, gp.full_title,
        gp.event_date, gp.round_order, gp.is_sprint_weekend,
        EXISTS (
          SELECT 1 FROM f1_sessions s
          JOIN f1_session_results sr ON sr.session_id = s.id
          WHERE s.grand_prix_id = gp.id
        ) AS ingested
      FROM f1_grands_prix gp
      WHERE gp.f1_season_id = $1
      ORDER BY gp.round_order
    `, [seasonId]);
    res.json({ data: races });
  } catch (err) { next(err) }
});

// GET /api/f1/driver-race-stats/:entityId?seasonId=X&uptoRound=N
// Cumulative Wins/2nd/3rd for a driver within one season, counting only
// Race sessions up to and including the given round_order. Powers the GP
// EventBlock's stat bar (F1GPBlock): shows the race winner's season-to-
// date podium counts as of that specific race, matching the "Event-time
// snapshot — stats reflect data as of the event date" notice already
// present in the block (previously just text, not backed by real data).
router.get('/driver-race-stats/:entityId', async (req, res, next) => {
  try {
    const { entityId } = req.params;
    const { seasonId, uptoRound } = req.query;
    if (!seasonId || !uptoRound) {
      return res.status(400).json({ error: 'seasonId and uptoRound query params are required' });
    }

    const stats = await queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE s.session_type = 'Race' AND sr.position = '1') AS wins,
        COUNT(*) FILTER (WHERE s.session_type = 'Race' AND sr.position = '2') AS p2,
        COUNT(*) FILTER (WHERE s.session_type = 'Race' AND sr.position = '3') AS p3,
        COUNT(*) FILTER (WHERE s.session_type = 'Qualifying' AND sr.position = '1') AS poles
      FROM f1_session_results sr
      JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type IN ('Race', 'Qualifying')
      JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
      WHERE gp.f1_season_id = $1
        AND gp.round_order <= $2
        AND sr.driver_entity_id = $3
    `, [seasonId, uptoRound, entityId]);

    res.json({
      data: {
        wins:  parseInt(stats?.wins || 0, 10),
        p2:    parseInt(stats?.p2 || 0, 10),
        p3:    parseInt(stats?.p3 || 0, 10),
        poles: parseInt(stats?.poles || 0, 10),
      },
    });
  } catch (err) { next(err) }
});

module.exports = router;
