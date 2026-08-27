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

// McLaren/Red Bull no longer have a separate entity per engine era (see
// migrate-f1-merge-team-engines.js) — the base team name and that
// season's engine now live on separate columns (entities.canonical_name,
// f1_team_standings.engine_name). Every route that used to just read the
// entity's canonical_name for a season's team display ("McLaren Honda")
// reconstructs it here instead, so the frontend needs no changes at all —
// same string shape as before, just assembled from two columns now
// rather than being one fragmented entity's own name.
function combineTeamEngine(name, engine) {
  if (!name || !engine) return name;
  // Many historical team names already end with their engine partner's
  // name (e.g. "BAR Honda" + engine="Honda") — appending again would
  // produce "BAR Honda Honda". Skip the append whenever the name already
  // ends with the engine as a whole word/phrase.
  const escaped = engine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alreadyPresent = new RegExp(`(?:^|\\s)${escaped}$`, 'i').test(name);
  return alreadyPresent ? name : `${name} ${engine}`;
}

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
      SELECT gp.id, gp.name, gp.slug, rn.full_title, gp.circuit_country, gp.event_date, gp.is_sprint_weekend, gp.round_order, gp.scheduled_laps,
        rv.id AS video_id, rv.video_url, rv.source AS video_source, rv.embeddable AS video_embeddable, rv.thumbnail_url AS video_thumbnail_url
      FROM f1_grands_prix gp
      LEFT JOIN f1_race_videos rv ON rv.grand_prix_id = gp.id
      -- Era-ranged sponsor name (e.g. "2010-2019" vs "2020-today", same
      -- pattern as competition_naming) — resolves the row whose
      -- [start_year, end_year] range covers this GP's own year, most
      -- recent start_year wins on overlap (shouldn't happen, the DB
      -- exclusion constraint on race_naming prevents overlapping ranges
      -- per sport+gp_slug, but ORDER BY is a harmless safety net).
      LEFT JOIN LATERAL (
        SELECT full_title FROM race_naming
        WHERE sport = 'f1' AND gp_slug = gp.slug
          AND start_year <= $3 AND (end_year IS NULL OR end_year >= $3)
        ORDER BY start_year DESC LIMIT 1
      ) rn ON true
      WHERE gp.f1_season_id = $1 AND gp.slug = $2
    `, [season.id, slug, year]);
    if (!gp) return res.status(404).json({ error: 'Grand Prix not found' });

    // laps_total falls back to gp.scheduled_laps (the circuit's published
    // lap count, known before the round is raced) when no session has real
    // results yet — MAX(laps) is only non-null once results exist.
    const sessions = await queryAll(`
      SELECT s.id, s.session_type, s.display_order, s.session_date,
        COALESCE((SELECT MAX(laps) FROM f1_session_results WHERE session_id = s.id), $2) AS laps_total
      FROM f1_sessions s
      WHERE s.grand_prix_id = $1
      ORDER BY s.display_order
    `, [gp.id, gp.scheduled_laps]);

    res.json({
      data: {
        season_id: season.id,
        gp: {
          id: gp.id,
          name: gp.name,
          slug: gp.slug,
          full_title: gp.full_title,
          city: null,
          season_id: season.id,
          round_order: gp.round_order,
          video_id: gp.video_id,
          video_url: gp.video_url,
          video_source: gp.video_source,
          video_embeddable: gp.video_embeddable,
          video_thumbnail_url: gp.video_thumbnail_url,
        },
        sessions: sessions.map(s => ({
          id: s.id,
          api_session_id: null,
          session_type: s.session_type,
          // Real per-session date (scraped from the calendar pages since
          // 2026 — see load-calendar.js) when available, falling back to
          // the GP's shared event_date for older seasons / any session not
          // yet re-scraped through the calendar loader.
          session_date: s.session_date || gp.event_date,
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
// both consume this same route. event_date now prefers the session's own
// real date (s.session_date, scraped per-session from the calendar pages
// since 2026 — see load-calendar.js) over the GP's shared event_date, so a
// Saturday Qualifying session's driver ages are computed as of Saturday,
// not Sunday's race date. Falls back to gp.event_date for any session
// without one (every pre-2026 season, and any 2026 session not yet
// re-scraped through the calendar loader).
router.get('/session/:sessionId/results', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await queryOne(`
      SELECT s.id, s.session_type, COALESCE(s.session_date, gp.event_date) AS event_date, gp.f1_season_id
      FROM f1_sessions s
      JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
      WHERE s.id = $1
    `, [sessionId]);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    let results = await queryAll(`
      SELECT sr.position, sr.car_number, sr.laps, sr.time_result, sr.points,
        sr.q1_time, sr.q2_time, sr.q3_time, sr.grid_position,
        d.id AS driver_id, d.canonical_name AS driver_name, d.slug AS driver_slug, COALESCE(d.profile_image_url, d.image_url) AS driver_image,
        d.birth_date, d.death_date,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        t.id AS team_id, t.canonical_name AS team_name, t.image_url AS team_logo,
        ts_engine.engine_name,
        activity.active_from, activity.active_to, activity.seasons_count
      FROM f1_session_results sr
      JOIN entities d ON d.id = sr.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN entities t ON t.id = sr.team_entity_id
      LEFT JOIN f1_team_standings ts_engine ON ts_engine.f1_season_id = $2 AND ts_engine.team_entity_id = t.id
      -- Capped at THIS session's own season year — see /standings/:seasonId/drivers'
      -- identical guard for why (a driver's future seasons must not count as
      -- "active" yet when viewing an older season).
      LEFT JOIN (
        SELECT ds2.driver_entity_id, MIN(fs2.year) AS active_from, MAX(fs2.year) AS active_to, COUNT(DISTINCT fs2.year) AS seasons_count
        FROM f1_driver_standings ds2
        JOIN f1_seasons fs2 ON fs2.id = ds2.f1_season_id
        WHERE fs2.year <= (SELECT year FROM f1_seasons WHERE id = $2)
        GROUP BY ds2.driver_entity_id
      ) activity ON activity.driver_entity_id = sr.driver_entity_id
      WHERE sr.session_id = $1
      ORDER BY ${POSITION_ORDER.replace(/position/g, 'sr.position')}
    `, [sessionId, session.f1_season_id]);
    results = results.map(({ engine_name, team_name, ...r }) => ({
      ...r,
      team_name_raw: team_name,
      engine_name,
      team_name: combineTeamEngine(team_name, engine_name),
    }));

    // No real results yet (round hasn't been raced/session hasn't run) —
    // fall back to the season's current driver standings as an entry list,
    // "-" in place of anything result-specific. The daily scheduled scrape
    // (ingest-f1.js) replaces this with real rows automatically once
    // formula1.com publishes them — this response is never persisted.
    let isPlaceholder = false;
    if (!results.length) {
      const standings = await queryAll(`
        SELECT ds.driver_entity_id AS driver_id, d.canonical_name AS driver_name, d.slug AS driver_slug,
          COALESCE(d.profile_image_url, d.image_url) AS driver_image, d.birth_date, d.death_date,
          co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
          t.id AS team_id, t.canonical_name AS team_name, t.image_url AS team_logo,
          ts_engine.engine_name,
          ds.car_number,
          activity.active_from, activity.active_to, activity.seasons_count
        FROM f1_driver_standings ds
        JOIN entities d ON d.id = ds.driver_entity_id
        LEFT JOIN countries co ON co.id = d.country_id
        LEFT JOIN entities t ON t.id = ds.team_entity_id
        LEFT JOIN f1_team_standings ts_engine ON ts_engine.f1_season_id = ds.f1_season_id AND ts_engine.team_entity_id = t.id
        LEFT JOIN (
          SELECT ds2.driver_entity_id, MIN(fs2.year) AS active_from, MAX(fs2.year) AS active_to, COUNT(DISTINCT fs2.year) AS seasons_count
          FROM f1_driver_standings ds2
          JOIN f1_seasons fs2 ON fs2.id = ds2.f1_season_id
          WHERE fs2.year <= (SELECT year FROM f1_seasons WHERE id = $1)
          GROUP BY ds2.driver_entity_id
        ) activity ON activity.driver_entity_id = ds.driver_entity_id
        WHERE ds.f1_season_id = $1
        ORDER BY (CASE WHEN ds.position ~ '^\\d+$' THEN ds.position::int ELSE 999999 END)
      `, [session.f1_season_id]);

      if (standings.length) {
        isPlaceholder = true;
        results = standings.map(({ engine_name, team_name, ...s }) => ({
          position: '-', laps: null, time_result: null, points: null,
          q1_time: null, q2_time: null, q3_time: null, grid_position: null,
          ...s,
          team_name_raw: team_name,
          engine_name,
          team_name: combineTeamEngine(team_name, engine_name),
        }));
      }
    }

    res.json({ data: { session, results, total: results.length, is_placeholder: isPlaceholder } });
  } catch (err) { next(err) }
});

// GET /api/f1/races/:seasonId — season overview, one row per RACE SESSION
// (winner only). A sprint weekend has two race sessions (Sprint Saturday,
// Race/Grand Prix Sunday) — both are real, separately-won races, so both
// get their own row now. Previously joined only session_type='Race',
// which meant sprint weekends silently dropped their Sprint winner
// entirely (the row shown was always the Sunday GP, just mislabeled
// "Sprint" via gp.is_sprint_weekend — a weekend-level flag, not a
// per-row session type). The Type badge now reflects the actual session
// (s.session_type) the row's result came from, not the weekend flag.
//
// Extended with d.image_url / t.image_url so the Races table can show the
// same driver-avatar treatment used everywhere else in the app (was
// previously omitted, leaving F1RacesTemplate with no image field to read).
// Also joins countries on the winning driver's country_id (admin-editable
// via the Clubs/Athletes country picker) for the flag + country display.
//
// CIRCUIT COUNTRY — a second countries join (aliased gpco) resolves
// gp.country_id to circuit_country_iso2/circuit_country_name, so the
// circuit flag actually renders. gp.country_id was backfilled from the
// pre-existing gp.circuit_country text column against countries.name
// (f1_circuits/circuit_id were unused/empty, so bypassed for this fix).
router.get('/races/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const races = await queryAll(`
      SELECT gp.id AS race_id, s.id AS session_id, gp.name AS gp_name, gp.slug, gp.circuit_country,
        gp.event_date, gp.round_order, s.session_type,
        gpco.iso2 AS circuit_country_iso2, gpco.name AS circuit_country_name,
        sr.time_result, sr.laps, sr.car_number,
        d.id AS driver_id, d.canonical_name AS driver_name, d.slug AS driver_slug, COALESCE(d.profile_image_url, d.image_url) AS driver_image,
        d.birth_date, d.death_date,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        t.id AS team_id, t.canonical_name AS team_name, t.image_url AS team_logo,
        ts_engine.engine_name,
        poled.canonical_name AS pole_driver_name
      FROM f1_grands_prix gp
      JOIN f1_sessions s ON s.grand_prix_id = gp.id AND s.session_type IN ('Race', 'Sprint')
      JOIN f1_session_results sr ON sr.session_id = s.id AND sr.position = '1'
      JOIN entities d ON d.id = sr.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN countries gpco ON gpco.id = gp.country_id
      LEFT JOIN entities t ON t.id = sr.team_entity_id
      LEFT JOIN f1_team_standings ts_engine ON ts_engine.f1_season_id = gp.f1_season_id AND ts_engine.team_entity_id = t.id
      -- Pole — whichever qualifying session actually set THIS row's grid:
      -- "Sprint Qualifying" for a Sprint row, plain "Qualifying" for a
      -- Race row (the same weekend can have both, on a sprint weekend).
      LEFT JOIN f1_sessions qs ON qs.grand_prix_id = gp.id
        AND qs.session_type = (CASE WHEN s.session_type = 'Sprint' THEN 'Sprint Qualifying' ELSE 'Qualifying' END)
      LEFT JOIN f1_session_results qsr ON qsr.session_id = qs.id AND qsr.position = '1'
      LEFT JOIN entities poled ON poled.id = qsr.driver_entity_id
      WHERE gp.f1_season_id = $1
      ORDER BY gp.round_order, (CASE s.session_type WHEN 'Sprint' THEN 0 ELSE 1 END)
    `, [seasonId]);

    res.json({
      data: {
        races: races.map(({ engine_name, team_name, ...r }) => ({
          ...r,
          is_sprint_race: r.session_type === 'Sprint',
          team_name_raw: team_name,
          engine_name,
          team_name: combineTeamEngine(team_name, engine_name),
        })),
        total: races.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/home-sessions/:seasonId
// One row per (round, session) for the F1 Home tab's calendar feed —
// every session of every round, not just Race (see HomeF1Template.jsx).
// LEFT JOINs to results (not the INNER JOIN /races/:seasonId uses) so a
// session with no result yet (an unraced future/ongoing one) still gets
// a row — winner/driver fields simply come back null, and the frontend
// falls back to the season's points leader for those.
//
// session_date — real per-session date (scraped from the calendar pages
// since 2026, see load-calendar.js) when available, else gp.event_date.
// Previously every session of a round shared gp.event_date, which broke
// PAST/NEXT/FUTURE status for any weekend spanning multiple real-world
// days (e.g. Qualifying Saturday, Race Sunday — browsing on the Saturday
// after Qualifying finished still showed Qualifying as NEXT, since it
// hadn't yet crossed the round's own Sunday date). HomeF1Template.jsx now
// classifies status per SESSION using this field instead of per round.
//
// DUPLICATE POSITION=1 (older seasons) — confirmed via direct query:
// pre-modern-qualifying-format seasons (e.g. 1990) have TWO rows at
// EVERY position, including position=1, for the same Qualifying session
// — the source data recorded two separate qualifying heats without a
// column distinguishing them. A plain `sr.position = '1'` join fans out
// into duplicate rows for those sessions (React then throws "two
// children with the same key" on session_id). The LATERAL subquery below
// deterministically picks just the lowest-id row per session, same class
// of fix as MotoGP's officialSession() dedup for its own duplicate-row
// issue (see motogp.js).
router.get('/home-sessions/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const sessions = await queryAll(`
      SELECT gp.id AS gp_id, gp.name AS gp_name, gp.slug, gp.event_date, gp.round_order,
        gpco.iso2 AS gp_country_iso2, COALESCE(gpco.name, gp.circuit_country) AS gp_country_name,
        s.id AS session_id, s.session_type, s.display_order,
        COALESCE(s.session_date, gp.event_date) AS session_date,
        d.canonical_name AS driver_name, d.slug AS driver_slug,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        t.canonical_name AS team_name, ts_engine.engine_name,
        rv.id AS video_id, rv.video_url, rv.source AS video_source, rv.embeddable AS video_embeddable, rv.thumbnail_url AS video_thumbnail_url
      FROM f1_grands_prix gp
      -- Circuit flag next to the GP name — same gp.country_id -> countries
      -- join /races/:seasonId already uses (see that route's comment).
      LEFT JOIN countries gpco ON gpco.id = gp.country_id
      JOIN f1_sessions s ON s.grand_prix_id = gp.id
      LEFT JOIN LATERAL (
        SELECT * FROM f1_session_results sr2
        WHERE sr2.session_id = s.id AND sr2.position = '1'
        ORDER BY sr2.id
        LIMIT 1
      ) sr ON true
      LEFT JOIN entities d ON d.id = sr.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN entities t ON t.id = sr.team_entity_id
      -- Same engine lookup /races/:seasonId uses: this team's engine for
      -- THIS season specifically (a team can switch engine supplier
      -- year to year).
      LEFT JOIN f1_team_standings ts_engine ON ts_engine.f1_season_id = gp.f1_season_id AND ts_engine.team_entity_id = t.id
      -- Video is tied to the race weekend as a whole (grand_prix_id, not
      -- session_id) — same table /gp/:slug/:year already joins. Frontend
      -- only shows the Watch Summary button on the Race row, same "not
      -- duplicated onto Sprint/Practice/Qualifying" rule that page uses.
      LEFT JOIN f1_race_videos rv ON rv.grand_prix_id = gp.id
      WHERE gp.f1_season_id = $1
      ORDER BY gp.round_order, s.display_order
    `, [seasonId]);

    res.json({ data: { sessions, total: sessions.length } });
  } catch (err) { next(err) }
});

// GET /api/f1/session-leaders/:seasonId — per-driver Race/Podium/Pole/
// Sprint/Sprint Pole/Practice counts for the Schedule page's Leaders card
// (Mohamed 2026-08-23: "assign same leader box to F1" — mirrors MotoGP's
// own /motogp/session-leaders/:seasonId exactly). Six buckets: Race wins,
// Race podiums (1-2-3, wins already included), Pole (Qualifying), Sprint
// wins, Sprint Pole (Sprint Qualifying — F1's own separate quali session
// for the sprint race, a concept MotoGP's schema has no equivalent of),
// Practice tops (fastest-time session, no real "win" concept there, same
// as MotoGP's practice_tops). position is stored as text here (confirmed
// via every other f1.js query's own `sr.position = '1'` convention), not
// an integer like MotoGP's schema.
router.get('/session-leaders/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const rows = await queryAll(`
      SELECT e.id AS driver_id, e.canonical_name AS driver_name, COALESCE(e.profile_image_url, e.image_url) AS driver_image,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        COUNT(*) FILTER (WHERE s.session_type = 'Race' AND sr.position = '1') AS race_wins,
        COUNT(*) FILTER (WHERE s.session_type = 'Race' AND sr.position IN ('1', '2', '3')) AS race_podiums,
        COUNT(*) FILTER (WHERE s.session_type = 'Qualifying' AND sr.position = '1') AS poles,
        COUNT(*) FILTER (WHERE s.session_type = 'Sprint' AND sr.position = '1') AS sprint_wins,
        COUNT(*) FILTER (WHERE s.session_type = 'Sprint Qualifying' AND sr.position = '1') AS sprint_poles,
        COUNT(*) FILTER (WHERE s.session_type LIKE 'Practice%' AND sr.position = '1') AS practice_tops
      FROM f1_session_results sr
      JOIN f1_sessions s ON s.id = sr.session_id
      JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id AND gp.f1_season_id = $1
      JOIN entities e ON e.id = sr.driver_entity_id
      LEFT JOIN countries co ON co.id = e.country_id
      GROUP BY e.id, e.canonical_name, e.image_url, e.profile_image_url, co.iso2, co.name
    `, [seasonId]);

    res.json({
      data: {
        drivers: rows.map(r => ({
          driver_id: r.driver_id,
          driver_name: r.driver_name,
          driver_image: r.driver_image,
          driver_country_iso2: r.driver_country_iso2,
          driver_country_name: r.driver_country_name,
          race_wins: Number(r.race_wins) || 0,
          race_podiums: Number(r.race_podiums) || 0,
          poles: Number(r.poles) || 0,
          sprint_wins: Number(r.sprint_wins) || 0,
          sprint_poles: Number(r.sprint_poles) || 0,
          practice_tops: Number(r.practice_tops) || 0,
        })),
      },
    });
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
//
// CAR NUMBER — f1_fastest_laps has no car_number column of its own;
// reuses the same Race-session join (sr) as the team fallback above.
router.get('/fastest-laps/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const laps = await queryAll(`
      SELECT gp.name AS gp_name, gp.slug, gp.circuit_country, gp.event_date, gp.round_order,
        gpco.iso2 AS circuit_country_iso2, gpco.name AS circuit_country_name,
        d.id AS driver_id, d.canonical_name AS driver_name, d.slug AS driver_slug, COALESCE(d.profile_image_url, d.image_url) AS driver_image,
        d.birth_date, d.death_date,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        t.id AS team_id, t.canonical_name AS team_name, t.image_url AS team_logo,
        ts_engine.engine_name,
        fl.time_result, sr.car_number
      FROM f1_fastest_laps fl
      JOIN f1_grands_prix gp ON gp.id = fl.grand_prix_id
      JOIN entities d ON d.id = fl.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN countries gpco ON gpco.id = gp.country_id
      LEFT JOIN f1_sessions rs ON rs.grand_prix_id = gp.id AND rs.session_type = 'Race'
      LEFT JOIN f1_session_results sr ON sr.session_id = rs.id AND sr.driver_entity_id = fl.driver_entity_id
      LEFT JOIN entities t ON t.id = COALESCE(fl.team_entity_id, sr.team_entity_id)
      LEFT JOIN f1_team_standings ts_engine ON ts_engine.f1_season_id = gp.f1_season_id AND ts_engine.team_entity_id = t.id
      WHERE gp.f1_season_id = $1
      ORDER BY gp.round_order
    `, [seasonId]);

    res.json({
      data: {
        laps: laps.map(({ engine_name, team_name, ...l }) => ({
          ...l,
          team_name_raw: team_name,
          engine_name,
          team_name: combineTeamEngine(team_name, engine_name),
        })),
        total: laps.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/poles/:seasonId
// One row per GP (pole-sitter of the main "Qualifying" session that sets
// the Sunday grid — same Race-only scope as /fastest-laps above, a sprint
// weekend's separate "Sprint Qualifying" pole isn't a second row here).
// Mirrors /fastest-laps' shape exactly (F1PoleTemplate is a straight copy
// of F1FastestLapTemplate) except the time comes from the driver's best
// qualifying lap (q3_time — always populated for the pole-sitter across
// every era in this schema, including pre-2006 seasons that predate the
// Q1/Q2/Q3 knockout format, confirmed via direct query) rather than
// f1_fastest_laps. team_entity_id/car_number both come directly off the
// Qualifying session's own result row — no fallback join needed the way
// fastest laps needs one.
router.get('/poles/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const poles = await queryAll(`
      SELECT gp.name AS gp_name, gp.slug, gp.circuit_country, gp.event_date, gp.round_order,
        gpco.iso2 AS circuit_country_iso2, gpco.name AS circuit_country_name,
        d.id AS driver_id, d.canonical_name AS driver_name, d.slug AS driver_slug, COALESCE(d.profile_image_url, d.image_url) AS driver_image,
        d.birth_date, d.death_date,
        co.iso2 AS driver_country_iso2, co.name AS driver_country_name,
        t.id AS team_id, t.canonical_name AS team_name, t.image_url AS team_logo,
        ts_engine.engine_name,
        sr.car_number, sr.q3_time AS time_result
      FROM f1_sessions s
      JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
      JOIN f1_session_results sr ON sr.session_id = s.id AND sr.position = '1'
      JOIN entities d ON d.id = sr.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN countries gpco ON gpco.id = gp.country_id
      LEFT JOIN entities t ON t.id = sr.team_entity_id
      LEFT JOIN f1_team_standings ts_engine ON ts_engine.f1_season_id = gp.f1_season_id AND ts_engine.team_entity_id = t.id
      WHERE gp.f1_season_id = $1 AND s.session_type = 'Qualifying'
      ORDER BY gp.round_order
    `, [seasonId]);

    res.json({
      data: {
        poles: poles.map(({ engine_name, team_name, ...p }) => ({
          ...p,
          team_name_raw: team_name,
          engine_name,
          team_name: combineTeamEngine(team_name, engine_name),
        })),
        total: poles.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/standings/:seasonId/drivers
// UPDATED — season_end_date added to the top-level response, computed as
// MAX(event_date) across every GP in this season. This is the F1
// equivalent of football/tennis's season.end_date, needed because F1's
// season-level standings table has no single date of its own to anchor
// age calculations against. Used client-side by calcAge() for every
// driver row in F1DriversTemplate.
//
// UPDATED AGAIN — season_start_date/edition/drivers_count/teams_count
// added, powering F1ChampionshipBlock's new "Schedule / Edition / Drivers
// / Teams" stat bar (replaces the old per-driver Points/Wins/2nd/3rd/Pole/
// Age row, which moved into a career stat bloc — see /driver-career
// below). edition is a plain COUNT of f1_seasons rows through this year
// (not year-1950+1 arithmetic) so it stays correct even if a future gap
// year is ever added; drivers_count/teams_count are this season's own
// entrant counts, same "season overview" framing football/basketball's
// Teams/Players stat already uses.
router.get('/standings/:seasonId/drivers', async (req, res, next) => {
  try {
    const { seasonId } = req.params;

    const season = await queryOne(`SELECT year FROM f1_seasons WHERE id = $1`, [seasonId]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    // season_status: computed, never stored (Option B — f1_seasons has no
    // status column, unlike the generic seasons table, and deliberately
    // stays that way). A season is 'current' if it has at least one GP
    // already raced AND at least one still upcoming; 'past' if every GP
    // has raced; 'future' if none have. Drives the EventBlock's
    // Winner/Champion vs "Current Leader" label — see F1EventBlock.jsx.
    const seasonMeta = await queryOne(`
      SELECT
        MIN(event_date)                          AS season_start_date,
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

    const editionMeta = await queryOne(`SELECT COUNT(*) AS edition FROM f1_seasons WHERE year <= $1`, [season.year]);
    const entrantMeta = await queryOne(`
      SELECT
        (SELECT COUNT(*) FROM f1_driver_standings WHERE f1_season_id = $1) AS drivers_count,
        (SELECT COUNT(*) FROM f1_team_standings   WHERE f1_season_id = $1) AS teams_count
    `, [seasonId]);
    const raceMeta = await queryOne(`
      SELECT COUNT(DISTINCT gp.id) AS races_count
      FROM f1_grands_prix gp
      JOIN f1_sessions s ON s.grand_prix_id = gp.id AND s.session_type = 'Race'
      WHERE gp.f1_season_id = $1
    `, [seasonId]);

    const rows = await queryAll(`
      SELECT ds.position, ds.points, ds.wins, ds.p2, ds.p3, ds.sprint_wins, ds.car_number,
        d.id AS entity_id, d.canonical_name, d.slug, COALESCE(d.profile_image_url, d.image_url) AS logo_url, d.birth_date, d.death_date,
        co.iso2 AS country_iso2, co.name AS country_name,
        t.canonical_name AS team_name, t.image_url AS team_logo, ts_engine.engine_name,
        COALESCE(poles.pole_count, 0) AS poles,
        COALESCE(fl.fl_count, 0) AS fastest_laps,
        activity.active_from, activity.active_to, activity.seasons_count
      FROM f1_driver_standings ds
      JOIN entities d ON d.id = ds.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN entities t ON t.id = ds.team_entity_id
      -- ds.team_entity_id has no engine of its own (only f1_team_standings
      -- does, one row per team per season) — joined by (season, team) to
      -- pull this driver's team's engine for THIS season specifically.
      LEFT JOIN f1_team_standings ts_engine ON ts_engine.f1_season_id = ds.f1_season_id AND ts_engine.team_entity_id = ds.team_entity_id
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
      LEFT JOIN (
        -- Same derivation as poles above, from f1_fastest_laps (one row
        -- per GP, the fastest lap of the race) instead of Qualifying P1.
        SELECT fl.driver_entity_id, COUNT(*) AS fl_count
        FROM f1_fastest_laps fl
        JOIN f1_grands_prix gp ON gp.id = fl.grand_prix_id AND gp.f1_season_id = $1
        GROUP BY fl.driver_entity_id
      ) fl ON fl.driver_entity_id = ds.driver_entity_id
      LEFT JOIN (
        -- Career activity span through THIS season's own year — first/last
        -- F1 season this driver has any standings row in, capped at the
        -- year being viewed (fs2.year <= this season's year), not the
        -- driver's real full career end. Powers the Drivers table's
        -- "Active" column (replaces the old car-number "No" column).
        -- Without this cap, viewing an old season (e.g. 2015) for a
        -- driver whose career actually runs to 2026 would wrongly show
        -- their FUTURE seasons as already "active" at that point in time.
        SELECT ds2.driver_entity_id, MIN(fs2.year) AS active_from, MAX(fs2.year) AS active_to, COUNT(DISTINCT fs2.year) AS seasons_count
        FROM f1_driver_standings ds2
        JOIN f1_seasons fs2 ON fs2.id = ds2.f1_season_id
        WHERE fs2.year <= (SELECT year FROM f1_seasons WHERE id = $1)
        GROUP BY ds2.driver_entity_id
      ) activity ON activity.driver_entity_id = ds.driver_entity_id
      WHERE ds.f1_season_id = $1
      ORDER BY ${POSITION_ORDER.replace(/position/g, 'ds.position')}
    `, [seasonId]);

    res.json({
      data: {
        season_start_date: seasonMeta?.season_start_date || null,
        season_end_date: seasonMeta?.season_end_date || null,
        season_status: seasonStatus,
        edition: parseInt(editionMeta?.edition || 0, 10),
        drivers_count: parseInt(entrantMeta?.drivers_count || 0, 10),
        teams_count: parseInt(entrantMeta?.teams_count || 0, 10),
        races_count: parseInt(raceMeta?.races_count || 0, 10),
        standings: rows.map(r => ({
          position: r.position,
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          birth_date: r.birth_date,
          death_date: r.death_date,
          country_iso2: r.country_iso2,   // now real — was previously hardcoded null
          country_name: r.country_name,   // now real — was previously hardcoded null
          stats: {
            team_name: combineTeamEngine(r.team_name, r.engine_name),
            team_name_raw: r.team_name,
            team_logo: r.team_logo,
            engine_name: r.engine_name,
            points: r.points,
            wins: r.wins,
            p2: r.p2,
            p3: r.p3,
            sprint_wins: r.sprint_wins,
            poles: r.poles,
            fastest_laps: r.fastest_laps,
            number: r.car_number,
            active_from: r.active_from,
            active_to: r.active_to,
            seasons_count: r.seasons_count,
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/standings/:seasonId/points-by-race
// Per-round points breakdown matrix for the Points Standings page (Line A
// Standings > Points Standings, after Teams). One column per Grand Prix
// this season (every round, including any not yet raced — those come
// back 0 via the LEFT JOIN/COALESCE, never omitted), one row per driver
// with a standings entry, ordered by championship position. Race and
// Sprint points are kept separate (not summed together) so the frontend
// can show Sprint as its own small second line, only on the sprint
// weekends that actually have one — each round's own has_sprint flag
// drives that, not a per-driver check. Only Race/Sprint sessions award
// points (confirmed via direct query — every other session_type sums to
// null) — no restart/duplicate-session risk here (confirmed no GP has
// more than one Race/Sprint row, unlike MotoGP's officialSession() case),
// so a plain SUM is safe.
router.get('/standings/:seasonId/points-by-race', async (req, res, next) => {
  try {
    const { seasonId } = req.params;

    const rounds = await queryAll(`
      SELECT gp.id AS gp_id, gp.name, gp.round_order, gp.event_date,
        EXISTS(SELECT 1 FROM f1_sessions s2 WHERE s2.grand_prix_id = gp.id AND s2.session_type = 'Sprint') AS has_sprint
      FROM f1_grands_prix gp
      WHERE gp.f1_season_id = $1
      ORDER BY gp.round_order
    `, [seasonId]);

    const rows = await queryAll(`
      SELECT
        ds.position, ds.points AS total_points,
        d.id AS entity_id, d.canonical_name, d.slug, COALESCE(d.profile_image_url, d.image_url) AS logo_url, d.death_date,
        co.iso2 AS country_iso2, co.name AS country_name,
        gp.id AS gp_id,
        COALESCE(SUM(sr.points) FILTER (WHERE s.session_type = 'Race'), 0) AS race_points,
        COALESCE(SUM(sr.points) FILTER (WHERE s.session_type = 'Sprint'), 0) AS sprint_points,
        MAX(sr.position) FILTER (WHERE s.session_type = 'Race') AS race_position
      FROM f1_driver_standings ds
      JOIN entities d ON d.id = ds.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      CROSS JOIN f1_grands_prix gp
      LEFT JOIN f1_sessions s ON s.grand_prix_id = gp.id AND s.session_type IN ('Race', 'Sprint')
      LEFT JOIN f1_session_results sr ON sr.session_id = s.id AND sr.driver_entity_id = d.id
      WHERE ds.f1_season_id = $1 AND gp.f1_season_id = $1
      GROUP BY ds.position, ds.points, d.id, d.canonical_name, d.slug, d.image_url, d.death_date, co.iso2, co.name, gp.id
      ORDER BY ${POSITION_ORDER.replace(/position/g, 'ds.position')}, gp.round_order
    `, [seasonId]);

    // Pivot the flat (driver, gp) rows into one entry per driver with a
    // points_by_gp map — grouped in JS rather than a second round-trip.
    const byDriver = new Map();
    for (const r of rows) {
      if (!byDriver.has(r.entity_id)) {
        byDriver.set(r.entity_id, {
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
      byDriver.get(r.entity_id).points_by_gp[r.gp_id] = { race: Number(r.race_points), sprint: Number(r.sprint_points), race_position: r.race_position };
    }

    res.json({
      data: {
        rounds: rounds.map(r => ({ gp_id: r.gp_id, name: r.name, round_order: r.round_order, event_date: r.event_date, has_sprint: r.has_sprint })),
        standings: [...byDriver.values()],
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/standings/:seasonId/teams
// season_status added — same computed (never stored) logic as the
// drivers route above, needed by F1TeamsChampionshipBlock for the same
// Winner/"Current Leader" label swap.
//
// UPDATED — season_start_date/edition/drivers_count/teams_count added,
// same fields (and same reasoning) as the drivers route's own "Schedule/
// Edition/Drivers/Teams" bottom-bar addition — F1TeamsChampionshipBlock
// uses this same bar, so it needs the same season-level fields from its
// own fetch rather than borrowing the drivers route's response.
router.get('/standings/:seasonId/teams', async (req, res, next) => {
  try {
    const { seasonId } = req.params;

    const season = await queryOne(`SELECT year FROM f1_seasons WHERE id = $1`, [seasonId]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const seasonMeta = await queryOne(`
      SELECT
        MIN(event_date)                     AS season_start_date,
        MAX(event_date)                     AS season_end_date,
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

    const editionMeta = await queryOne(`SELECT COUNT(*) AS edition FROM f1_seasons WHERE year <= $1`, [season.year]);
    const entrantMeta = await queryOne(`
      SELECT
        (SELECT COUNT(*) FROM f1_driver_standings WHERE f1_season_id = $1) AS drivers_count,
        (SELECT COUNT(*) FROM f1_team_standings   WHERE f1_season_id = $1) AS teams_count
    `, [seasonId]);
    const raceMeta = await queryOne(`
      SELECT COUNT(DISTINCT gp.id) AS races_count
      FROM f1_grands_prix gp
      JOIN f1_sessions s ON s.grand_prix_id = gp.id AND s.session_type = 'Race'
      WHERE gp.f1_season_id = $1
    `, [seasonId]);

    const rows = await queryAll(`
      SELECT ts.position, ts.points, ts.wins, ts.p2, ts.p3, ts.sprint_wins, ts.engine_name,
        ts.country_name AS scraped_country_name,
        t.id AS entity_id, t.canonical_name, t.slug, t.image_url AS logo_url,
        co_admin.iso2 AS iso2_by_admin, co_admin.name AS name_by_admin,
        co_scrape.iso2 AS iso2_by_scrape,
        COALESCE(poles.pole_count, 0) AS poles,
        COALESCE(fl.fl_count, 0) AS fastest_laps
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
      LEFT JOIN (
        -- f1_fastest_laps.team_entity_id is often NULL (see /fastest-laps
        -- route above) — falls back to the driver's own Race-session team
        -- for that GP, same reliable-source fallback used there.
        SELECT COALESCE(fl.team_entity_id, sr.team_entity_id) AS team_entity_id, COUNT(*) AS fl_count
        FROM f1_fastest_laps fl
        JOIN f1_grands_prix gp ON gp.id = fl.grand_prix_id AND gp.f1_season_id = $1
        LEFT JOIN f1_sessions rs ON rs.grand_prix_id = gp.id AND rs.session_type = 'Race'
        LEFT JOIN f1_session_results sr ON sr.session_id = rs.id AND sr.driver_entity_id = fl.driver_entity_id
        GROUP BY COALESCE(fl.team_entity_id, sr.team_entity_id)
      ) fl ON fl.team_entity_id = ts.team_entity_id
      WHERE ts.f1_season_id = $1
      ORDER BY ${POSITION_ORDER.replace(/position/g, 'ts.position')}
    `, [seasonId]);

    res.json({
      data: {
        season_start_date: seasonMeta?.season_start_date || null,
        season_end_date: seasonMeta?.season_end_date || null,
        season_status: seasonStatus,
        edition: parseInt(editionMeta?.edition || 0, 10),
        drivers_count: parseInt(entrantMeta?.drivers_count || 0, 10),
        teams_count: parseInt(entrantMeta?.teams_count || 0, 10),
        races_count: parseInt(raceMeta?.races_count || 0, 10),
        standings: rows.map(r => ({
          position: r.position,
          entity_id: r.entity_id,
          canonical_name: combineTeamEngine(r.canonical_name, r.engine_name),
          name_raw: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          // Prefer the admin-set country (entities.country_id, editable in
          // the Clubs admin page) — fall back to the legacy scraped
          // f1_team_standings.country_name column if admin hasn't set one
          // for this team yet.
          country_iso2: r.iso2_by_admin || r.iso2_by_scrape,
          country_name: r.name_by_admin || r.scraped_country_name,
          stats: {
            engine_name: r.engine_name,
            points: r.points,
            wins: r.wins,
            p2: r.p2,
            p3: r.p3,
            sprint_wins: r.sprint_wins,
            poles: r.poles,
            fastest_laps: r.fastest_laps,
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
//
// gpId (Mohamed 2026-08-23: "iconic moment may be tied to a Grand Prix")
// — optional filter down to just that one race's moments, backed by the
// grand_prix_id column added alongside this change. Omitted (the tour-
// wide Iconic Moments tab's own call) still returns every moment in the
// season regardless of which race, if any, it's tagged to.
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
        COUNT(*) FILTER (WHERE s.session_type = 'Qualifying' AND sr.position = '1') AS poles,
        COUNT(*) FILTER (WHERE s.session_type = 'Sprint' AND sr.position = '1') AS sprint_wins
      FROM f1_session_results sr
      JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type IN ('Race', 'Qualifying', 'Sprint')
      JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
      WHERE gp.f1_season_id = $1
        AND gp.round_order <= $2
        AND sr.driver_entity_id = $3
    `, [seasonId, uptoRound, entityId]);

    res.json({
      data: {
        wins:        parseInt(stats?.wins || 0, 10),
        p2:          parseInt(stats?.p2 || 0, 10),
        p3:          parseInt(stats?.p3 || 0, 10),
        poles:       parseInt(stats?.poles || 0, 10),
        sprint_wins: parseInt(stats?.sprint_wins || 0, 10),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/driver-career/:entityId?throughYear=YYYY
// Single-driver career totals through a given year — powers the new
// "career stat bloc" on F1ChampionshipBlock (Final Standings > Drivers/
// Races/Fastest Lap), same {seasons, championships, wins, p2, p3, poles,
// sprint_wins} shape /drivers-all-time/:seasonId already computes for
// every driver, just scoped to one entity instead of scanning the whole
// `entities` table — that route is for the All-Time list page, this one
// is a lightweight single-row lookup for the EventBlock.
// prev_title_year mirrors the generic /seasons/entity-history route's own
// field: the most recent PRIOR championship year (year < throughYear),
// so the frontend can render "1st title" vs "X Y. ago" the same way that
// route's consumers already do.
//
// CHAMPIONSHIPS — f1_driver_standings.position is kept live-updated during
// an in-progress season (points-leader rank), not just written once a
// season is decided, so a naive "position = '1'" count over-credits the
// current leader of an ongoing season with a title before it's actually
// won. Excluded here via NOT EXISTS on any still-upcoming GP in that
// season — a season only counts toward `championships` once every one of
// its GPs has actually been raced. Wins/podiums/poles/sprints don't need
// this guard: those are real results from races that have already
// happened, accurate regardless of whether the season itself is finished.
router.get('/driver-career/:entityId', async (req, res, next) => {
  try {
    const { entityId } = req.params;
    const { throughYear } = req.query;
    if (!throughYear) return res.status(400).json({ error: 'throughYear query param is required' });

    const agg = await queryOne(`
      SELECT
        COUNT(DISTINCT ds.f1_season_id) AS seasons,
        COUNT(*) FILTER (
          WHERE ds.position = '1'
            AND NOT EXISTS (
              SELECT 1 FROM f1_grands_prix gp
              WHERE gp.f1_season_id = ds.f1_season_id AND gp.event_date > CURRENT_DATE
            )
        ) AS championships,
        MAX(CASE
          WHEN ds.position = '1' AND fs.year < $2
            AND NOT EXISTS (
              SELECT 1 FROM f1_grands_prix gp2
              WHERE gp2.f1_season_id = ds.f1_season_id AND gp2.event_date > CURRENT_DATE
            )
          THEN fs.year
        END) AS prev_title_year,
        COALESCE(SUM(ds.wins), 0)        AS wins,
        COALESCE(SUM(ds.p2), 0)          AS p2,
        COALESCE(SUM(ds.p3), 0)          AS p3,
        COALESCE(SUM(ds.sprint_wins), 0) AS sprint_wins
      FROM f1_driver_standings ds
      JOIN f1_seasons fs ON fs.id = ds.f1_season_id AND fs.year <= $2
      WHERE ds.driver_entity_id = $1
    `, [entityId, throughYear]);

    const poles = await queryOne(`
      SELECT COUNT(*) AS pole_count
      FROM f1_session_results sr
      JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type = 'Qualifying'
      JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
      JOIN f1_seasons fs     ON fs.id = gp.f1_season_id AND fs.year <= $2
      WHERE sr.driver_entity_id = $1 AND sr.position = '1'
    `, [entityId, throughYear]);

    const wins = Number(agg?.wins || 0);
    const p2   = Number(agg?.p2 || 0);
    const p3   = Number(agg?.p3 || 0);

    res.json({
      data: {
        seasons:        Number(agg?.seasons || 0),
        championships:  Number(agg?.championships || 0),
        prev_title_year: agg?.prev_title_year ? parseInt(agg.prev_title_year, 10) : null,
        wins,
        p2,
        p3,
        podiums:        wins + p2 + p3,
        poles:          Number(poles?.pole_count || 0),
        sprint_wins:    Number(agg?.sprint_wins || 0),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/team-career/:entityId?throughYear=YYYY
// Single-team career totals through a given year — team counterpart of
// /driver-career/:entityId above, powering F1TeamsChampionshipBlock's own
// career stat bloc (Final Standings > Teams). Same shape and same
// f1_team_standings.position live-update caveat: a still-ongoing season's
// points-leading constructor gets excluded from `championships` via the
// same NOT EXISTS-on-upcoming-GP guard the driver route uses, so an
// undecided season's leader isn't credited with a title before it's won.
router.get('/team-career/:entityId', async (req, res, next) => {
  try {
    const { entityId } = req.params;
    const { throughYear } = req.query;
    if (!throughYear) return res.status(400).json({ error: 'throughYear query param is required' });

    const agg = await queryOne(`
      SELECT
        COUNT(DISTINCT ts.f1_season_id) AS seasons,
        COUNT(*) FILTER (
          WHERE ts.position = '1'
            AND NOT EXISTS (
              SELECT 1 FROM f1_grands_prix gp
              WHERE gp.f1_season_id = ts.f1_season_id AND gp.event_date > CURRENT_DATE
            )
        ) AS championships,
        MAX(CASE
          WHEN ts.position = '1' AND fs.year < $2
            AND NOT EXISTS (
              SELECT 1 FROM f1_grands_prix gp2
              WHERE gp2.f1_season_id = ts.f1_season_id AND gp2.event_date > CURRENT_DATE
            )
          THEN fs.year
        END) AS prev_title_year,
        COALESCE(SUM(ts.wins), 0)        AS wins,
        COALESCE(SUM(ts.p2), 0)          AS p2,
        COALESCE(SUM(ts.p3), 0)          AS p3,
        COALESCE(SUM(ts.sprint_wins), 0) AS sprint_wins
      FROM f1_team_standings ts
      JOIN f1_seasons fs ON fs.id = ts.f1_season_id AND fs.year <= $2
      WHERE ts.team_entity_id = $1
    `, [entityId, throughYear]);

    const poles = await queryOne(`
      SELECT COUNT(*) AS pole_count
      FROM f1_session_results sr
      JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type = 'Qualifying'
      JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
      JOIN f1_seasons fs     ON fs.id = gp.f1_season_id AND fs.year <= $2
      WHERE sr.team_entity_id = $1 AND sr.position = '1'
    `, [entityId, throughYear]);

    const wins = Number(agg?.wins || 0);
    const p2   = Number(agg?.p2 || 0);
    const p3   = Number(agg?.p3 || 0);

    res.json({
      data: {
        seasons:        Number(agg?.seasons || 0),
        championships:  Number(agg?.championships || 0),
        prev_title_year: agg?.prev_title_year ? parseInt(agg.prev_title_year, 10) : null,
        wins,
        p2,
        p3,
        podiums:        wins + p2 + p3,
        poles:          Number(poles?.pole_count || 0),
        sprint_wins:    Number(agg?.sprint_wins || 0),
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/drivers-all-time/:seasonId
// Career cumulative driver stats "through <year>" — All-Time counterpart
// of /standings/:seasonId/drivers above, same "through year" convention
// as the generic /results/players-all-time/:seasonId route (career-wide,
// scoped to season.year <= the selected year, not just the current
// roster — see that route's comment for why "current roster only" is a
// bug class to avoid here too).
//
// f1_driver_standings already carries per-season totals (points, wins,
// p2, p3, sprint_wins) — summed across every season through the selected
// year for career totals. Races/poles/fastest_laps have no equivalent
// stored column and are derived from f1_session_results/f1_fastest_laps,
// same derivation the single-season standings route already uses for
// poles.
//
// is_current_grid (drives the Active/Retired toggle) means "entered in
// the latest F1 season on record" (today's real grid, e.g. 2026) —
// deliberately NOT relative to the selected/viewed year, so Active means
// the same drivers regardless of whether you're browsing All-Time stats
// through 2026 or through 1990.
router.get('/drivers-all-time/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year FROM f1_seasons WHERE id = $1`, [seasonId]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

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

    // Base is entities (every driver, entity_type='driver'), not
    // f1_driver_standings — a driver with zero standings rows (e.g. a
    // one-off/reserve entry that only ever appears in a session result,
    // never scored points) still belongs on an "all drivers" page. All
    // stat sources below are LEFT JOINs, each independently capped to
    // season.year <= the selected year, and COALESCEd to 0 so a driver
    // with no career data at all still gets a full zeroed row rather than
    // being dropped.
    const rows = await queryAll(`
      SELECT d.id AS entity_id, d.canonical_name, d.slug, COALESCE(d.profile_image_url, d.image_url) AS logo_url, d.birth_date, d.death_date,
        co.iso2 AS country_iso2, co.name AS country_name,
        COALESCE(ds.seasons, 0)          AS seasons,
        COALESCE(ds.championships, 0)    AS championships,
        COALESCE(ds.points, 0)           AS points,
        COALESCE(ds.wins, 0)             AS wins,
        COALESCE(ds.p2, 0)               AS p2,
        COALESCE(ds.p3, 0)               AS p3,
        COALESCE(ds.sprint_wins, 0)      AS sprint_wins,
        COALESCE(races.race_count, 0)    AS races,
        COALESCE(poles.pole_count, 0)    AS poles,
        COALESCE(fl.fl_count, 0)         AS fastest_laps,
        ds.latest_team_name, ds.latest_engine_name, ds.first_season_year, ds.last_season_year,
        (cg.driver_entity_id IS NOT NULL) AS is_current_grid
      FROM entities d
      LEFT JOIN countries co ON co.id = d.country_id
      LEFT JOIN (
        SELECT ds.driver_entity_id,
          COUNT(DISTINCT ds.f1_season_id)           AS seasons,
          -- Same ongoing-season guard as /driver-career: position='1' is a
          -- live points-leader rank during an in-progress season, not a
          -- decided title — exclude any season with a still-upcoming GP so
          -- the current leader isn't credited with a championship early.
          COUNT(*) FILTER (
            WHERE ds.position = '1'
              AND NOT EXISTS (
                SELECT 1 FROM f1_grands_prix gpx WHERE gpx.f1_season_id = ds.f1_season_id AND gpx.event_date > CURRENT_DATE
              )
          ) AS championships,
          SUM(ds.points)      AS points,
          SUM(ds.wins)        AS wins,
          SUM(ds.p2)          AS p2,
          SUM(ds.p3)          AS p3,
          SUM(ds.sprint_wins) AS sprint_wins,
          MIN(fs.year)        AS first_season_year,
          MAX(fs.year)        AS last_season_year,
          (ARRAY_AGG(t.canonical_name ORDER BY fs.year DESC))[1] AS latest_team_name,
          (ARRAY_AGG(ts_e.engine_name ORDER BY fs.year DESC))[1] AS latest_engine_name
        FROM f1_driver_standings ds
        JOIN f1_seasons fs ON fs.id = ds.f1_season_id AND fs.year <= $1
        LEFT JOIN entities t ON t.id = ds.team_entity_id
        LEFT JOIN f1_team_standings ts_e ON ts_e.f1_season_id = ds.f1_season_id AND ts_e.team_entity_id = ds.team_entity_id
        GROUP BY ds.driver_entity_id
      ) ds ON ds.driver_entity_id = d.id
      LEFT JOIN (
        SELECT sr.driver_entity_id, COUNT(DISTINCT gp.id) AS race_count
        FROM f1_session_results sr
        JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type = 'Race'
        JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
        JOIN f1_seasons fs2    ON fs2.id = gp.f1_season_id AND fs2.year <= $1
        GROUP BY sr.driver_entity_id
      ) races ON races.driver_entity_id = d.id
      LEFT JOIN (
        SELECT sr.driver_entity_id, COUNT(*) AS pole_count
        FROM f1_session_results sr
        JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type = 'Qualifying'
        JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
        JOIN f1_seasons fs3    ON fs3.id = gp.f1_season_id AND fs3.year <= $1
        WHERE sr.position = '1'
        GROUP BY sr.driver_entity_id
      ) poles ON poles.driver_entity_id = d.id
      LEFT JOIN (
        SELECT fl.driver_entity_id, COUNT(*) AS fl_count
        FROM f1_fastest_laps fl
        JOIN f1_grands_prix gp ON gp.id = fl.grand_prix_id
        JOIN f1_seasons fs4    ON fs4.id = gp.f1_season_id AND fs4.year <= $1
        GROUP BY fl.driver_entity_id
      ) fl ON fl.driver_entity_id = d.id
      LEFT JOIN (
        -- Current grid = drivers entered in the LATEST F1 season on
        -- record (today's real season, e.g. 2026), not the season being
        -- viewed — same "Active means the current grid, always" fix as
        -- teams-all-time's is_current_grid.
        SELECT DISTINCT ds_cur.driver_entity_id
        FROM f1_driver_standings ds_cur
        JOIN f1_seasons fs_cur ON fs_cur.id = ds_cur.f1_season_id
        WHERE fs_cur.year = (SELECT MAX(year) FROM f1_seasons)
      ) cg ON cg.driver_entity_id = d.id
      WHERE d.entity_type = 'driver'
      ORDER BY COALESCE(ds.points, 0) DESC
    `, [season.year]);

    res.json({
      data: {
        year: season.year,
        season_status: seasonStatus,
        drivers: rows.map(r => ({
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          birth_date: r.birth_date,
          death_date: r.death_date,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          team_name: combineTeamEngine(r.latest_team_name, r.latest_engine_name),
          // First season this driver ever raced, through the selected
          // year — powers the "<debut>-<viewed year>" range shown under
          // Seas. I Champ., same "through <year>" convention TennisPlayer
          // StatsTemplate's Seasons column uses.
          first_season_year: r.first_season_year ? Number(r.first_season_year) : null,
          // Last season this driver actually raced, through the selected
          // year — used to tell "retired" (raced at some point, but not
          // on the current grid) from "hasn't debuted yet" (no career
          // stats through this year at all).
          last_season_year: r.last_season_year ? Number(r.last_season_year) : null,
          // On the real current F1 grid (latest season on record) —
          // independent of the selected year. Powers the Active toggle.
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
            fastest_laps: Number(r.fastest_laps),
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/teams-all-time/:seasonId
// Career cumulative team stats "through <year>" — the constructor
// counterpart of drivers-all-time above. Same shape of reasoning:
//   - Base is entities (entity_type='f1_team'), not f1_team_standings —
//     343 team entities exist but only 188 ever have a standings row
//     (privateers/one-off entrants that never scored), so a team with
//     zero career stats still gets a full zeroed row rather than being
//     dropped (same "all drivers even zero-stat ones" fix applied here
//     from the start).
//   - Every stat source is a LEFT JOIN, independently capped to
//     season.year <= the selected year.
//   - Country resolution mirrors /standings/:seasonId/teams: prefer the
//     admin-set entities.country_id, fall back to the legacy scraped
//     f1_team_standings.country_name (most recent season's value, since
//     that's a per-season text column with no single "current" row).
//   - Fastest-lap team fallback mirrors /fastest-laps/:seasonId: when
//     f1_fastest_laps.team_entity_id is null (common — team wasn't always
//     captured on that row), fall back to the same driver's Race-session
//     team for that GP.
//   - is_current_grid (drives the Active/Retired toggle) means "entered
//     in the latest F1 season on record" (today's real grid, e.g. 2026) —
//     deliberately NOT relative to the selected/viewed year, so Active
//     means the same 11 teams regardless of whether you're browsing
//     All-Time stats through 2026 or through 1990.
router.get('/teams-all-time/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year FROM f1_seasons WHERE id = $1`, [seasonId]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

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
      SELECT t.id AS entity_id, t.canonical_name, t.slug, t.image_url AS logo_url,
        co_admin.iso2 AS iso2_by_admin, co_admin.name AS name_by_admin,
        co_scrape.iso2 AS iso2_by_scrape,
        ts.scraped_country_name,
        COALESCE(ts.seasons, 0)             AS seasons,
        COALESCE(ts.championships, 0)       AS championships,
        COALESCE(driver_champs.dc_count, 0) AS driver_championships,
        COALESCE(ts.points, 0)              AS points,
        COALESCE(ts.wins, 0)                AS wins,
        COALESCE(ts.p2, 0)                  AS p2,
        COALESCE(ts.p3, 0)                  AS p3,
        COALESCE(ts.sprint_wins, 0)         AS sprint_wins,
        COALESCE(races.race_count, 0)       AS races,
        COALESCE(poles.pole_count, 0)       AS poles,
        COALESCE(fl.fl_count, 0)            AS fastest_laps,
        ts.first_season_year, ts.last_season_year, ts.latest_engine_name,
        (cg.team_entity_id IS NOT NULL) AS is_current_grid
      FROM entities t
      LEFT JOIN countries co_admin ON co_admin.id = t.country_id
      LEFT JOIN (
        SELECT ts.team_entity_id,
          COUNT(DISTINCT ts.f1_season_id)           AS seasons,
          -- Same ongoing-season guard as /team-career — see that route's
          -- comment.
          COUNT(*) FILTER (
            WHERE ts.position = '1'
              AND NOT EXISTS (
                SELECT 1 FROM f1_grands_prix gpx WHERE gpx.f1_season_id = ts.f1_season_id AND gpx.event_date > CURRENT_DATE
              )
          ) AS championships,
          SUM(ts.points)      AS points,
          SUM(ts.wins)        AS wins,
          SUM(ts.p2)          AS p2,
          SUM(ts.p3)          AS p3,
          SUM(ts.sprint_wins) AS sprint_wins,
          MIN(fs.year)        AS first_season_year,
          MAX(fs.year)        AS last_season_year,
          (ARRAY_AGG(ts.country_name ORDER BY fs.year DESC))[1] AS scraped_country_name,
          (ARRAY_AGG(ts.engine_name ORDER BY fs.year DESC))[1]  AS latest_engine_name
        FROM f1_team_standings ts
        JOIN f1_seasons fs ON fs.id = ts.f1_season_id AND fs.year <= $1
        GROUP BY ts.team_entity_id
      ) ts ON ts.team_entity_id = t.id
      LEFT JOIN countries co_scrape ON co_scrape.name = ts.scraped_country_name
      LEFT JOIN (
        -- Drivers' Championships won while driving for this team — distinct
        -- from the team's own Constructors' Championships (ts.championships
        -- above). One driver_entity_id has position='1' per season; the
        -- team that driver was registered under that season gets credit
        -- (e.g. Ferrari's 15 Drivers' titles vs its 16 Constructors' titles).
        SELECT ds.team_entity_id, COUNT(*) AS dc_count
        FROM f1_driver_standings ds
        JOIN f1_seasons fs6 ON fs6.id = ds.f1_season_id AND fs6.year <= $1
        WHERE ds.position = '1'
          AND NOT EXISTS (
            SELECT 1 FROM f1_grands_prix gpx WHERE gpx.f1_season_id = ds.f1_season_id AND gpx.event_date > CURRENT_DATE
          )
        GROUP BY ds.team_entity_id
      ) driver_champs ON driver_champs.team_entity_id = t.id
      LEFT JOIN (
        SELECT sr.team_entity_id, COUNT(DISTINCT gp.id) AS race_count
        FROM f1_session_results sr
        JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type = 'Race'
        JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
        JOIN f1_seasons fs2    ON fs2.id = gp.f1_season_id AND fs2.year <= $1
        GROUP BY sr.team_entity_id
      ) races ON races.team_entity_id = t.id
      LEFT JOIN (
        SELECT sr.team_entity_id, COUNT(*) AS pole_count
        FROM f1_session_results sr
        JOIN f1_sessions s     ON s.id = sr.session_id AND s.session_type = 'Qualifying'
        JOIN f1_grands_prix gp ON gp.id = s.grand_prix_id
        JOIN f1_seasons fs3    ON fs3.id = gp.f1_season_id AND fs3.year <= $1
        WHERE sr.position = '1'
        GROUP BY sr.team_entity_id
      ) poles ON poles.team_entity_id = t.id
      LEFT JOIN (
        SELECT COALESCE(fl.team_entity_id, sr.team_entity_id) AS team_entity_id, COUNT(*) AS fl_count
        FROM f1_fastest_laps fl
        JOIN f1_grands_prix gp  ON gp.id = fl.grand_prix_id
        JOIN f1_seasons fs4     ON fs4.id = gp.f1_season_id AND fs4.year <= $1
        LEFT JOIN f1_sessions rs        ON rs.grand_prix_id = gp.id AND rs.session_type = 'Race'
        LEFT JOIN f1_session_results sr ON sr.session_id = rs.id AND sr.driver_entity_id = fl.driver_entity_id
        GROUP BY COALESCE(fl.team_entity_id, sr.team_entity_id)
      ) fl ON fl.team_entity_id = t.id
      LEFT JOIN (
        -- Current grid = teams entered in the LATEST F1 season on record
        -- (today's real season, e.g. 2026), not the season being viewed —
        -- Active/Retired must mean "on the grid right now" even when
        -- browsing All-Time stats through an old year like 1990.
        SELECT DISTINCT ts_cur.team_entity_id
        FROM f1_team_standings ts_cur
        JOIN f1_seasons fs_cur ON fs_cur.id = ts_cur.f1_season_id
        WHERE fs_cur.year = (SELECT MAX(year) FROM f1_seasons)
      ) cg ON cg.team_entity_id = t.id
      WHERE t.entity_type = 'f1_team'
      ORDER BY COALESCE(ts.points, 0) DESC
    `, [season.year]);

    res.json({
      data: {
        year: season.year,
        season_status: seasonStatus,
        teams: rows.map(r => ({
          entity_id: r.entity_id,
          canonical_name: r.canonical_name,
          slug: r.slug,
          logo_url: r.logo_url,
          country_iso2: r.iso2_by_admin || r.iso2_by_scrape,
          country_name: r.name_by_admin || r.scraped_country_name,
          engine_name: r.latest_engine_name,
          // First season this team ever competed, through the selected
          // year — powers the "<debut>-<viewed year>" range shown under
          // Seas. I Champ., same convention F1DriversAllTimeTemplate uses.
          first_season_year: r.first_season_year ? Number(r.first_season_year) : null,
          // Last season this team actually competed, through the selected
          // year — used to tell "retired" (raced at some point, but not on
          // the current grid) from "hasn't debuted yet" (no career stats
          // through this year at all).
          last_season_year: r.last_season_year ? Number(r.last_season_year) : null,
          // On the real current F1 grid (latest season on record) —
          // independent of the selected year. Powers the Active toggle.
          is_current_grid: r.is_current_grid === true,
          stats: {
            seasons: Number(r.seasons),
            championships: Number(r.championships),
            driver_championships: Number(r.driver_championships),
            points: r.points,
            races: Number(r.races),
            wins: Number(r.wins) || 0,
            p2: Number(r.p2) || 0,
            p3: Number(r.p3) || 0,
            sprint_wins: Number(r.sprint_wins) || 0,
            poles: Number(r.poles),
            fastest_laps: Number(r.fastest_laps),
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/races-all-time/:seasonId
// Career cumulative per-Grand-Prix records "through <year>" — grouped by
// gp.slug, the stable cross-season identity for a Grand Prix (confirmed
// 54 distinct slugs = 54 distinct names across all 1171 f1_grands_prix
// rows — slug is what SLUG_ALIASES in load-calendar.js normalizes
// renamed races onto, e.g. "united-arab-emirates" -> "abu-dhabi", so
// grouping by it is exactly the right key, not name or id).
//
// Only actually-raced editions count (event_date <= CURRENT_DATE) — a
// scheduled-but-not-yet-run future round shouldn't inflate "Nb of races"
// or shift "1st GP".
//
// "Greater Wins/Poles/Sprint Wins" — the single driver with the most
// Race wins / Qualifying poles / Sprint wins at that specific GP, found
// via DISTINCT ON per slug ordered by count desc. Ties are broken by
// driver_entity_id (deterministic, not meaningful) — a genuine tie shows
// only one name, a known simplification for a single-name column.
router.get('/races-all-time/:seasonId', async (req, res, next) => {
  try {
    const { seasonId } = req.params;
    const season = await queryOne(`SELECT year FROM f1_seasons WHERE id = $1`, [seasonId]);
    if (!season) return res.status(404).json({ error: 'Season not found' });

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
      WITH race_editions AS (
        SELECT gp.id, gp.slug, gp.name, fs.year, gp.circuit_country, gp.country_id
        FROM f1_grands_prix gp
        JOIN f1_seasons fs ON fs.id = gp.f1_season_id
        WHERE fs.year <= $1 AND gp.event_date <= CURRENT_DATE
      ),
      gp_meta AS (
        SELECT slug,
          (ARRAY_AGG(name ORDER BY year DESC))[1]            AS latest_name,
          (ARRAY_AGG(country_id ORDER BY year DESC))[1]       AS latest_country_id,
          (ARRAY_AGG(circuit_country ORDER BY year DESC))[1]  AS latest_circuit_country,
          MIN(year)  AS first_year,
          MAX(year)  AS last_year,
          COUNT(*)   AS race_count
        FROM race_editions
        GROUP BY slug
      ),
      -- Active = still on the REAL current F1 calendar (latest season on
      -- record), independent of the "through <year>" being viewed and of
      -- whether that edition has actually been RUN yet — same "always the
      -- real current grid" rule as is_current_grid elsewhere (drivers/
      -- teams-all-time). Not derived from gp_meta.last_year: a GP whose
      -- next edition is scheduled but hasn't raced yet (e.g. Italy 2026,
      -- confirmed via direct query) would otherwise wrongly read as
      -- defunct through last season's raced-only cap.
      current_slugs AS (
        SELECT DISTINCT gp.slug
        FROM f1_grands_prix gp
        JOIN f1_seasons fs ON fs.id = gp.f1_season_id
        WHERE fs.year = (SELECT MAX(year) FROM f1_seasons)
      ),
      race_wins AS (
        SELECT re.slug, sr.driver_entity_id, COUNT(*) AS win_count
        FROM f1_session_results sr
        JOIN f1_sessions s      ON s.id = sr.session_id AND s.session_type = 'Race'
        JOIN race_editions re   ON re.id = s.grand_prix_id
        WHERE sr.position = '1'
        GROUP BY re.slug, sr.driver_entity_id
      ),
      top_wins AS (
        SELECT DISTINCT ON (slug) slug, driver_entity_id, win_count
        FROM race_wins ORDER BY slug, win_count DESC, driver_entity_id ASC
      ),
      race_poles AS (
        SELECT re.slug, sr.driver_entity_id, COUNT(*) AS pole_count
        FROM f1_session_results sr
        JOIN f1_sessions s      ON s.id = sr.session_id AND s.session_type = 'Qualifying'
        JOIN race_editions re   ON re.id = s.grand_prix_id
        WHERE sr.position = '1'
        GROUP BY re.slug, sr.driver_entity_id
      ),
      top_poles AS (
        SELECT DISTINCT ON (slug) slug, driver_entity_id, pole_count
        FROM race_poles ORDER BY slug, pole_count DESC, driver_entity_id ASC
      ),
      race_sprints AS (
        SELECT re.slug, sr.driver_entity_id, COUNT(*) AS sprint_count
        FROM f1_session_results sr
        JOIN f1_sessions s      ON s.id = sr.session_id AND s.session_type = 'Sprint'
        JOIN race_editions re   ON re.id = s.grand_prix_id
        WHERE sr.position = '1'
        GROUP BY re.slug, sr.driver_entity_id
      ),
      top_sprints AS (
        SELECT DISTINCT ON (slug) slug, driver_entity_id, sprint_count
        FROM race_sprints ORDER BY slug, sprint_count DESC, driver_entity_id ASC
      )
      SELECT gm.slug, gm.latest_name, gm.first_year, gm.last_year, gm.race_count,
        (cs.slug IS NOT NULL) AS is_current_calendar,
        co.iso2 AS country_iso2, COALESCE(co.name, gm.latest_circuit_country) AS country_name,
        dw.canonical_name AS win_driver_name, dw.slug AS win_driver_slug, dw.death_date AS win_driver_death_date, dwco.iso2 AS win_driver_iso2, dwco.name AS win_driver_country_name, tw.win_count,
        dp.canonical_name AS pole_driver_name, dp.slug AS pole_driver_slug, dp.death_date AS pole_driver_death_date, dpco.iso2 AS pole_driver_iso2, dpco.name AS pole_driver_country_name, tp.pole_count,
        ds.canonical_name AS sprint_driver_name, ds.slug AS sprint_driver_slug, ds.death_date AS sprint_driver_death_date, dsco.iso2 AS sprint_driver_iso2, dsco.name AS sprint_driver_country_name, tsp.sprint_count
      FROM gp_meta gm
      LEFT JOIN current_slugs cs ON cs.slug = gm.slug
      LEFT JOIN countries co ON co.id = gm.latest_country_id
      LEFT JOIN top_wins tw    ON tw.slug = gm.slug
      LEFT JOIN entities dw    ON dw.id = tw.driver_entity_id
      LEFT JOIN countries dwco ON dwco.id = dw.country_id
      LEFT JOIN top_poles tp   ON tp.slug = gm.slug
      LEFT JOIN entities dp    ON dp.id = tp.driver_entity_id
      LEFT JOIN countries dpco ON dpco.id = dp.country_id
      LEFT JOIN top_sprints tsp ON tsp.slug = gm.slug
      LEFT JOIN entities ds    ON ds.id = tsp.driver_entity_id
      LEFT JOIN countries dsco ON dsco.id = ds.country_id
      ORDER BY gm.race_count DESC, gm.first_year ASC
    `, [season.year]);

    res.json({
      data: {
        year: season.year,
        season_status: seasonStatus,
        races: rows.map(r => ({
          slug: r.slug,
          name: r.latest_name,
          first_year: r.first_year,
          last_year: r.last_year,
          is_current_calendar: r.is_current_calendar === true,
          country_iso2: r.country_iso2,
          country_name: r.country_name,
          stats: {
            race_count: Number(r.race_count),
            greater_wins: r.win_driver_name ? { driver_name: r.win_driver_name, driver_slug: r.win_driver_slug, death_date: r.win_driver_death_date, country_iso2: r.win_driver_iso2, country_name: r.win_driver_country_name, count: Number(r.win_count) } : null,
            greater_poles: r.pole_driver_name ? { driver_name: r.pole_driver_name, driver_slug: r.pole_driver_slug, death_date: r.pole_driver_death_date, country_iso2: r.pole_driver_iso2, country_name: r.pole_driver_country_name, count: Number(r.pole_count) } : null,
            greater_sprint_wins: r.sprint_driver_name ? { driver_name: r.sprint_driver_name, driver_slug: r.sprint_driver_slug, death_date: r.sprint_driver_death_date, country_iso2: r.sprint_driver_iso2, country_name: r.sprint_driver_country_name, count: Number(r.sprint_count) } : null,
          },
        })),
        count: rows.length,
      },
    });
  } catch (err) { next(err) }
});

// GET /api/f1/gp-top-winners/:slug
// Top 3 drivers by win count for EVERY session type (Race, Qualifying,
// Sprint, Practice 1/2/3, Sprint Qualifying...) at one specific Grand Prix
// (by its stable cross-season slug), each with the list of years they
// won — powers the Homepage's F1 Performances tab (Mohamed 2026-08-21:
// "Flag + profile + Lando Norris - 3 wins (2020, 2022, 2023)... Show the
// top 3... Stats for each session: record of wins, qualifying, sprint" →
// "u dont show top 3 performances for Italy Practice 1, etc. Why? We have
// historical data" — the original version restricted to just Race/
// Qualifying/Sprint; every session_type is included now, keyed by its own
// real value so it maps 1:1 onto whichever session the frontend has
// selected). Only actually-raced editions count (event_date <=
// CURRENT_DATE), same convention races-all-time above already uses.
router.get('/gp-top-winners/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const rows = await queryAll(`
      WITH editions AS (
        SELECT gp.id, fs.year
        FROM f1_grands_prix gp
        JOIN f1_seasons fs ON fs.id = gp.f1_season_id
        WHERE gp.slug = $1 AND gp.event_date <= CURRENT_DATE
      ),
      session_wins AS (
        SELECT s.session_type, sr.driver_entity_id, ed.year
        FROM f1_session_results sr
        JOIN f1_sessions s ON s.id = sr.session_id
        JOIN editions ed ON ed.id = s.grand_prix_id
        WHERE sr.position = '1'
      ),
      agg AS (
        SELECT session_type, driver_entity_id, COUNT(*) AS win_count, ARRAY_AGG(year ORDER BY year) AS years
        FROM session_wins
        GROUP BY session_type, driver_entity_id
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY session_type ORDER BY win_count DESC, driver_entity_id ASC) AS rn
        FROM agg
      )
      SELECT r.session_type, r.win_count, r.years,
        d.canonical_name AS driver_name, d.slug AS driver_slug, d.death_date,
        co.iso2 AS country_iso2, co.name AS country_name
      FROM ranked r
      JOIN entities d ON d.id = r.driver_entity_id
      LEFT JOIN countries co ON co.id = d.country_id
      WHERE r.rn <= 3
      ORDER BY r.session_type, r.rn
    `, [slug]);

    const sessions = {};
    rows.forEach(r => {
      if (!sessions[r.session_type]) sessions[r.session_type] = [];
      sessions[r.session_type].push({
        driver_name: r.driver_name, driver_slug: r.driver_slug, death_date: r.death_date,
        country_iso2: r.country_iso2, country_name: r.country_name,
        win_count: Number(r.win_count), years: r.years,
      });
    });
    res.json({ data: { slug, sessions } });
  } catch (err) { next(err) }
});

// GET /api/f1/gp-history/:slug/:year
// "All-Time Results" drawer for one Grand Prix. Started as a straight port
// of tennis's tournament-history drawer (winner vs runner-up, "ATP model")
// but a Grand Prix result is a 3-way podium, not a 2-player final — 2026-
// 08-10: "tennis model doesn't fit F1 requirements, display 1st/2nd/3rd" —
// so this returns a P1/P2/P3 podium per edition instead of a winner/
// runner-up pair. edition_number is a plain ROW_NUMBER over actually-raced
// editions (event_date <= CURRENT_DATE) with year <= the cap, same "as of
// viewed year" convention as races-all-time. win_ordinal is the P1 driver's
// Nth win at this specific GP, ascending by year — same window-function
// pattern as tournament-history's champion ordinal.
router.get('/gp-history/:slug/:year', async (req, res, next) => {
  try {
    const { slug, year } = req.params;
    const yearInt = parseInt(year);

    const rows = await queryAll(`
      WITH editions AS (
        SELECT gp.id, gp.slug, fs.year,
          ROW_NUMBER() OVER (ORDER BY fs.year ASC) AS edition_number
        FROM f1_grands_prix gp
        JOIN f1_seasons fs ON fs.id = gp.f1_season_id
        WHERE gp.slug = $1 AND fs.year <= $2 AND gp.event_date <= CURRENT_DATE
      ),
      results AS (
        SELECT e.year, e.edition_number,
          r1.driver_entity_id AS p1_driver_id, r1.team_entity_id AS p1_team_id,
          r2.driver_entity_id AS p2_driver_id, r2.team_entity_id AS p2_team_id,
          r3.driver_entity_id AS p3_driver_id, r3.team_entity_id AS p3_team_id,
          COUNT(*) OVER (PARTITION BY r1.driver_entity_id ORDER BY e.year ASC) AS win_ordinal
        FROM editions e
        JOIN f1_sessions s ON s.grand_prix_id = e.id AND s.session_type = 'Race'
        LEFT JOIN f1_session_results r1 ON r1.session_id = s.id AND r1.position = '1'
        LEFT JOIN f1_session_results r2 ON r2.session_id = s.id AND r2.position = '2'
        LEFT JOIN f1_session_results r3 ON r3.session_id = s.id AND r3.position = '3'
      )
      SELECT r.year, r.edition_number, r.win_ordinal,
        d1.canonical_name AS p1_name, d1.slug AS p1_slug, d1.death_date AS p1_death_date,
        c1.iso2 AS p1_iso2, c1.name AS p1_country, t1.canonical_name AS p1_team,
        d2.canonical_name AS p2_name, d2.slug AS p2_slug, d2.death_date AS p2_death_date,
        c2.iso2 AS p2_iso2, c2.name AS p2_country, t2.canonical_name AS p2_team,
        d3.canonical_name AS p3_name, d3.slug AS p3_slug, d3.death_date AS p3_death_date,
        c3.iso2 AS p3_iso2, c3.name AS p3_country, t3.canonical_name AS p3_team
      FROM results r
      LEFT JOIN entities d1 ON d1.id = r.p1_driver_id
      LEFT JOIN countries c1 ON c1.id = d1.country_id
      LEFT JOIN entities t1 ON t1.id = r.p1_team_id
      LEFT JOIN entities d2 ON d2.id = r.p2_driver_id
      LEFT JOIN countries c2 ON c2.id = d2.country_id
      LEFT JOIN entities t2 ON t2.id = r.p2_team_id
      LEFT JOIN entities d3 ON d3.id = r.p3_driver_id
      LEFT JOIN countries c3 ON c3.id = d3.country_id
      LEFT JOIN entities t3 ON t3.id = r.p3_team_id
      ORDER BY r.year DESC
    `, [slug, yearInt]);

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