// src/routes/seasons.js
const express = require('express');
const router  = express.Router();
const { queryAll, queryOne } = require('../db');

// GET /api/seasons?competition=:slug&year=:year&event=:eventSlug
router.get('/', async (req, res, next) => {
  try {
    const { competition, year, event } = req.query;

    if (!competition || !year) {
      return res.status(400).json({
        error: 'competition slug and year are required'
      });
    }

    const yearInt = parseInt(year);

    const comp = await queryOne(`
      SELECT c.id, c.name, c.slug, c.competition_type,
             c.edition_years, c.founded_year, c.dissolved_year,
             c.first_data_year, c.logo_url, c.bg_image_url, c.column_config,
             c.year_convention,
             s.id AS sport_id,
             s.display_pattern
      FROM competitions c
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN sports s ON s.id = ec.sport_id
      WHERE c.slug = $1
    `, [competition]);

    if (!comp) {
      return res.status(404).json({ error: 'Competition not found' });
    }

    // Resolve the DB year from the UI year based on convention
    // 'start' → DB stores start year (e.g. Ligue 1: 2020-21 stored as 2020) → UI shows end year → subtract 1
    // 'end'   → DB stores end year   (e.g. UCL: 2022-23 stored as 2023)     → UI shows end year → no change
    const dbYear = comp.year_convention === 'start' ? yearInt - 1 : yearInt;

    if (comp.founded_year && dbYear < comp.founded_year) {
      return res.json({
        data: null,
        empty_state: {
          type: 'not_founded',
          message: `${comp.name} was founded in ${comp.founded_year}. Select a later year.`,
          founded_year: comp.founded_year,
        }
      });
    }

    if (comp.dissolved_year && dbYear > comp.dissolved_year) {
      return res.json({
        data: null,
        empty_state: {
          type: 'dissolved',
          message: `${comp.name} ceased in ${comp.dissolved_year}. Select an earlier year.`,
          dissolved_year: comp.dissolved_year,
        }
      });
    }

    if (comp.competition_type === 'quadrennial' && comp.edition_years) {
      const editionYears = comp.edition_years;
      if (!editionYears.includes(dbYear)) {
        const prev = editionYears.filter(y => y < dbYear).pop();
        const next = editionYears.find(y => y > dbYear);
        return res.json({
          data: null,
          empty_state: {
            type: 'no_edition',
            message: `No ${comp.name} in ${yearInt}.`,
            previous_edition: prev || null,
            next_edition: next || null,
          }
        });
      }
    }

    let seasonQuery = `
      SELECT
        s.id,
        s.year,
        s.status,
        s.gender,
        s.sub_edition,
        s.start_date,
        s.end_date,
        s.current_matchday,
        s.current_round,
        s.edition_number,
        s.cancellation_reason,
        s.prize_money,
        s.bg_image_url,
        s.host_countries,
        e.id    AS event_id,
        e.name  AS event_name,
        e.slug  AS event_slug
      FROM seasons s
      LEFT JOIN events e ON e.id = s.event_id
      WHERE s.competition_id = $1
        AND s.year = $2
    `;

    const params = [comp.id, dbYear];

    if (event) {
      seasonQuery += ` AND (e.slug = $3 OR s.event_id IS NULL)`;
      params.push(event);
    }

    seasonQuery += ` ORDER BY s.sub_edition, s.gender DESC, e.display_order`

    const seasons = await queryAll(seasonQuery, params);

    if (seasons.length === 0) {
      return res.json({
        data: null,
        empty_state: {
          type: 'no_data',
          message: `No data available for ${comp.name} ${yearInt}.`,
        }
      });
    }

    // Detect multi-edition years (e.g. Australian Open 1977)
    const subEditions = [...new Set(seasons.map(s => s.sub_edition || 1))].sort()
    const hasMultiEditions = subEditions.length > 1

    // "Next" (vs plain "Future") for a not-yet-played season — the single
    // earliest start_date among every genuinely-upcoming row (real calendar
    // date in the future, not cancelled) across the WHOLE sport for this
    // same tour side (season.gender), same rule as competitions.js's Line A
    // list query. Every other future row is "Future" by elimination on the
    // frontend (is_next simply false).
    //
    // Deliberately computed from start_date > NOW() rather than trusting
    // the stored s.status column: status is written once at ingest time and
    // never revisited, so a season that's actually started (or ended) can
    // sit on a stale 'future'/'current' value indefinitely (see EventBlock's
    // getStatus() for the same class of staleness on the badge itself,
    // fixed the same way). Using the real date is self-correcting and needs
    // no recurring job to keep in sync.
    const now = new Date();
    const futureGenders = [...new Set(seasons.filter(s => s.status !== 'cancelled' && s.start_date && new Date(s.start_date) > now).map(s => s.gender))];
    let nextStartByGender = {};
    if (futureGenders.length) {
      const nextStarts = await queryAll(`
        SELECT s2.gender, MIN(s2.start_date) AS next_start
        FROM seasons s2
        JOIN competitions c2 ON c2.id = s2.competition_id
        JOIN event_categories ec2 ON ec2.id = c2.category_id
        WHERE ec2.sport_id = $1 AND s2.status <> 'cancelled' AND s2.start_date > NOW()
          AND s2.gender = ANY($2)
        GROUP BY s2.gender
      `, [comp.sport_id, futureGenders]);
      nextStartByGender = Object.fromEntries(nextStarts.map(r => [r.gender, r.next_start?.getTime?.()]));
    }
    for (const s of seasons) {
      s.is_next = s.status !== 'cancelled' && !!s.start_date && new Date(s.start_date) > now
        && s.start_date.getTime() === nextStartByGender[s.gender];
    }

    const seasonsWithTabs = await Promise.all(
      seasons.map(async (season) => {
        let tabs = await queryAll(`
          SELECT id, tab_name, tab_key, typology, display_order, is_default, tab_group, group_name
          FROM result_tabs
          WHERE season_id = $1
          ORDER BY display_order
        `, [season.id]);

        // A cancelled/future season has no draw of its own, so no real
        // result_tabs exist for it — reuse the most recent REAL season's
        // tab shape (same competition + gender) so Line B still reads
        // "Men's Singles"/"Men's Player List" etc. instead of falling back
        // to something else entirely. (Previously the frontend fell through
        // to the competition's legacy `events` table as a stand-in, which
        // carries stale/differently-named rows — e.g. "Men Single"/"Players"
        // with a "Doubles"/"Mixed Doubles" split that was never actually
        // tracked for tennis — found 2026-08.) hasVideosTab below still
        // checks this season's own id, so a reused Videos tab still
        // correctly hides with no real content of its own.
        if (tabs.length === 0 && (season.status === 'cancelled' || season.status === 'future')) {
          const templateSeason = await queryOne(`
            SELECT id FROM seasons
            WHERE competition_id = $1 AND gender = $2 AND status NOT IN ('cancelled', 'future')
            ORDER BY year DESC LIMIT 1
          `, [comp.id, season.gender]);
          if (templateSeason) {
            tabs = await queryAll(`
              SELECT id, tab_name, tab_key, typology, display_order, is_default, tab_group, group_name
              FROM result_tabs WHERE season_id = $1 ORDER BY display_order
            `, [templateSeason.id]);
          }
        }

        // Videos tab always stays visible, even with zero Iconic Moments
        // content yet (2026-08-14: "I want a video page even if there's no
        // video upload. Get rid of the rule saying: no video, no page") —
        // was previously hidden whenever the media table had no matching
        // row for this season, which also meant a freshly-uploaded video
        // wouldn't surface the tab if it didn't land as media_type
        // 'iconic_moment' specifically.
        let visibleTabs = tabs;

        // NBA Awards tabs (MVP/Finals MVP/DPOY/6MOY/MIP/ROY/All-NBA/All-Defense)
        // are all created unconditionally every year by ingest-nba-awards.js/
        // ingest-nba-eost.js, then only filled when the award actually existed
        // that season — DPOY/6MOY didn't exist before 1982-83, MIP before
        // 1985-86, Finals MVP before 1968-69, etc. Hide any award tab with zero
        // candidates so the nav matches reality instead of showing a dead link.
        // (All-NBA 3rd/All-Defense already behave this way for a different
        // reason — those scripts skip creating the tab at all when the source
        // has no rows — this generalizes the same visible result to every
        // award tab regardless of which ingestion path it came from.)
        if (season.event_slug === 'awards-4828' && visibleTabs.length) {
          const tabIds = visibleTabs.map(t => t.id);
          const nonEmpty = await queryAll(`
            SELECT DISTINCT result_tab_id FROM player_season_stats WHERE result_tab_id = ANY($1)
          `, [tabIds]);
          const nonEmptyIds = new Set(nonEmpty.map(r => r.result_tab_id));
          visibleTabs = visibleTabs.filter(t => nonEmptyIds.has(t.id));
        }

        // NBA Play-in's Eastern/Western Conf. tabs are both scaffolded every
        // year by ensure-nba-season.js regardless of whether that conference
        // actually held a play-in game — 2020 (the format's debut season)
        // only had one in the West (the East's own 8-9 seed gap was too wide
        // to trigger it that year). Hide whichever conference tab has zero
        // games, same principle as the Awards filter above. The event-level
        // gate below (hiding the whole Play-in tab for pre-2020 seasons)
        // relies on this having already emptied out both tabs for those years.
        if (season.event_slug === 'play-in-4828' && visibleTabs.length) {
          const tabIds = visibleTabs.map(t => t.id);
          const nonEmpty = await queryAll(`
            SELECT DISTINCT result_tab_id FROM games WHERE result_tab_id = ANY($1)
          `, [tabIds]);
          const nonEmptyIds = new Set(nonEmpty.map(r => r.result_tab_id));
          visibleTabs = visibleTabs.filter(t => nonEmptyIds.has(t.id));
        }

        return { ...season, result_tabs: visibleTabs };
      })
    );

    // NBA Play-in didn't exist before 2020-21 — its season row and both
    // conference tabs are still scaffolded every year by
    // ensure-nba-season.js, so hide the whole Line A event when neither
    // conference has a single game, rather than showing a dead Play-in tab
    // for 50+ seasons before it existed.
    //
    // NBA Cup started in the 2023-24 season — same pattern, but its tabs
    // are a mix of typology='game' (Final/Rounds) and typology='standings'
    // (Eastern/Western Conf. Groups), so both tables need checking before
    // the event counts as having real data for a year.
    const seasonsFiltered = await (async () => {
      const out = [];
      for (const s of seasonsWithTabs) {
        if (s.event_slug === 'play-in-4828') {
          const tabIds = s.result_tabs.map(t => t.id);
          const anyGame = tabIds.length
            ? await queryOne(`SELECT 1 FROM games WHERE result_tab_id = ANY($1) LIMIT 1`, [tabIds])
            : null;
          if (!anyGame) continue;
        }
        if (s.event_slug === 'nba-cup-4828') {
          const tabIds = s.result_tabs.map(t => t.id);
          const anyData = tabIds.length
            ? await queryOne(`
                SELECT 1 WHERE EXISTS (SELECT 1 FROM games WHERE result_tab_id = ANY($1))
                   OR EXISTS (SELECT 1 FROM standings WHERE result_tab_id = ANY($1))
              `, [tabIds])
            : null;
          if (!anyData) continue;
        }
        out.push(s);
      }
      return out;
    })();

    // For multi-edition years: attach a merged (deduplicated) tab list
    // so Line B renders each tab_key only once
    if (hasMultiEditions) {
      const seenKeys = new Set()
      const mergedTabs = []
      for (const subEd of subEditions) {
        for (const s of seasonsWithTabs.filter(s => (s.sub_edition || 1) === subEd)) {
          for (const tab of s.result_tabs) {
            if (!seenKeys.has(tab.tab_key)) {
              seenKeys.add(tab.tab_key)
              mergedTabs.push(tab)
            }
          }
        }
      }
      seasonsWithTabs.forEach(s => { s.merged_tabs = mergedTabs })
    }

    // Detect sport for winner query strategy
    const sportRow = await queryOne(`
      SELECT sp.slug FROM sports sp
      JOIN event_categories ec ON ec.sport_id = sp.id
      JOIN competitions c2 ON c2.category_id = ec.id
      WHERE c2.id = $1
    `, [comp.id]);
    const isTennis = sportRow?.slug === 'tennis';
    const isBasketball = sportRow?.slug === 'basketball';

    const winners = await Promise.all(
      seasons.map(async (season) => {
        if (isBasketball) {
          // Champion = NBA Finals winner, a best-of-7 series decided by
          // game-win count — NOT whichever event/tab is currently active
          // (unlike other sports, "current context" here could be Regular
          // Season/Playoffs/Awards/etc., none of which is itself the
          // championship decider). Always looks up the Finals event's own
          // season for this competition+year, regardless of which season
          // row this iteration is actually processing.
          //
          // NBA Cup is one exception: it's a genuinely separate in-season
          // competition with its own single-game Final, not a reflection of
          // the season's overall Finals champion — when the season being
          // processed IS the NBA Cup event, use its own 'final' tab instead
          // of redirecting to the Finals event. All-Star is the same kind
          // of exception — its own single game (Results tab), nothing to do
          // with who won the Finals that year.
          const isCupSeason = season.event_slug === 'nba-cup-4828';
          const isAllStarSeason = season.event_slug === 'all-star-4828';
          let finalsSeasonId, finalsTabKey;
          if (isCupSeason) {
            finalsSeasonId = season.id;
            finalsTabKey = 'final';
          } else if (isAllStarSeason) {
            finalsSeasonId = season.id;
            finalsTabKey = 'results';
          } else {
            const finalsSeason = await queryOne(`
              SELECT s2.id FROM seasons s2
              JOIN events ev ON ev.id = s2.event_id
              WHERE s2.competition_id = $1 AND s2.year = $2 AND ev.slug LIKE 'finals%'
              LIMIT 1
            `, [comp.id, dbYear]);
            if (!finalsSeason) return { season_id: season.id, winner: null };
            finalsSeasonId = finalsSeason.id;
            finalsTabKey = 'nba-finals';
          }

          const seriesWins = await queryAll(`
            SELECT g.winner_entity_id AS team_id, COUNT(*) AS wins
            FROM games g
            JOIN result_tabs rt ON rt.id = g.result_tab_id
            WHERE rt.season_id = $1 AND rt.tab_key = $2 AND g.winner_entity_id IS NOT NULL
            GROUP BY g.winner_entity_id
            ORDER BY wins DESC
          `, [finalsSeasonId, finalsTabKey]);
          if (!seriesWins.length) return { season_id: season.id, winner: null };

          const winnerId = seriesWins[0].team_id;
          // Loser: the OTHER side of any game in this tab whose winner is
          // winnerId. A multi-game series' loser also picks up wins of
          // their own (so seriesWins' 2nd row already covers it) — but the
          // NBA Cup Final is a single game, where the loser never appears
          // as a winner_entity_id at all, so seriesWins alone can't find
          // them. Reading straight off the game's own home/away pair
          // covers both shapes correctly.
          const loserRow = await queryOne(`
            SELECT CASE WHEN g.home_entity_id = $3 THEN g.away_entity_id ELSE g.home_entity_id END AS loser_id
            FROM games g
            JOIN result_tabs rt ON rt.id = g.result_tab_id
            WHERE rt.season_id = $1 AND rt.tab_key = $2
              AND (g.home_entity_id = $3 OR g.away_entity_id = $3)
            LIMIT 1
          `, [finalsSeasonId, finalsTabKey, winnerId]);
          const loserId = loserRow?.loser_id ?? null;

          const entityRows = await queryAll(`
            SELECT
              e.id AS entity_id, e.canonical_name,
              COALESCE(en.display_name, e.canonical_name) AS display_name,
              e.slug AS entity_slug, e.entity_type,
              e.primary_color AS club_primary_color, e.secondary_color AS club_secondary_color,
              e.third_color AS club_third_color,
              COALESCE(el.logo_url, e.image_url) AS image_url,
              co.iso2 AS country_iso2, co.name AS country_name
            FROM entities e
            LEFT JOIN entity_logos el ON el.entity_id = e.id
              AND $2::int BETWEEN el.start_year AND COALESCE(el.end_year, 9999)
            LEFT JOIN countries co ON co.id = e.country_id
            LEFT JOIN entity_names en ON en.entity_id = e.id
              AND $2::int BETWEEN en.start_year AND COALESCE(en.end_year, 9999)
            WHERE e.id = ANY($1)
          `, [[winnerId, loserId].filter(Boolean), dbYear]);
          const winner = entityRows.find(e => e.entity_id === winnerId) ?? null;
          const loser  = loserId ? (entityRows.find(e => e.entity_id === loserId) ?? null) : null;

          // Game-by-game Finals results, oldest first — reuses the exact
          // {w,l} shape EventBlock.jsx already renders for tennis sets
          // (score/scoreRow/scoreSetCell CSS), just as a binary 1/0 win
          // indicator per game instead of a game count, with no tiebreak.
          // All-Star is a single real-score game, not a best-of-N series —
          // its one "set" is the actual point score, not a 1/0 win flag.
          let sets = [];
          if (loserId && isAllStarSeason) {
            const game = await queryOne(`
              SELECT g.score, g.home_entity_id
              FROM games g
              JOIN result_tabs rt ON rt.id = g.result_tab_id
              WHERE rt.season_id = $1 AND rt.tab_key = $2
              LIMIT 1
            `, [finalsSeasonId, finalsTabKey]);
            if (game) {
              const homeScore = game.score?.home ?? 0;
              const awayScore = game.score?.away ?? 0;
              sets = game.home_entity_id === winnerId
                ? [{ w: homeScore, l: awayScore }]
                : [{ w: awayScore, l: homeScore }];
            }
          } else if (loserId) {
            const games = await queryAll(`
              SELECT g.winner_entity_id
              FROM games g
              JOIN result_tabs rt ON rt.id = g.result_tab_id
              WHERE rt.season_id = $1 AND rt.tab_key = $2 AND g.winner_entity_id IS NOT NULL
              ORDER BY g.leg_number ASC, g.match_date ASC
            `, [finalsSeasonId, finalsTabKey]);
            sets = games.map(g => g.winner_entity_id === winnerId ? { w: 1, l: 0 } : { w: 0, l: 1 });
          }

          return { season_id: season.id, winner, loser, sets, walkover: false };
        }

        if (isTennis) {
          // Tennis: winner = entity who won the Final game in this season
          // Must use a draw tab (not players tab) to find the Final game
          const genderKey = season.gender === 'F' ? 'draw-singles-f' : 'draw-singles-m'
          const finalTab = await queryOne(`
            SELECT id FROM result_tabs
            WHERE season_id = $1
              AND tab_key = $2
            LIMIT 1
          `, [season.id, genderKey]);
          if (!finalTab) return null;

          const finalGame = await queryOne(`
            SELECT
              g.score,
              g.home_entity_id,
              g.away_entity_id,
              ew.id             AS w_entity_id,
              ew.canonical_name AS w_name,
              ew.slug           AS w_slug,
              ew.entity_type    AS w_type,
              ew.image_url      AS w_image,
              ew.birth_date     AS w_birth_date,
              ew.death_date     AS w_death_date,
              cw.iso2           AS w_country_iso2,
              cw.name           AS w_country_name,
              (g.stats->>'w_rank')::int AS rank_at_event,
              eloser.id             AS l_entity_id,
              eloser.canonical_name AS l_name,
              eloser.slug           AS l_slug,
              eloser.birth_date     AS l_birth_date,
              eloser.death_date     AS l_death_date,
              cl.iso2               AS l_country_iso2,
              (g.stats->>'l_rank')::int AS l_rank_at_event
            FROM games g
            JOIN entities ew     ON ew.id = g.winner_entity_id
            JOIN entities eloser ON eloser.id = CASE
              WHEN g.home_entity_id = g.winner_entity_id THEN g.away_entity_id
              ELSE g.home_entity_id
            END
            LEFT JOIN countries cw ON cw.id = ew.country_id
            LEFT JOIN countries cl ON cl.id = eloser.country_id
            WHERE g.result_tab_id = $1
              AND g.round = 'Final'
            LIMIT 1
          `, [finalTab.id]);

          if (!finalGame) return { season_id: season.id, winner: null };

          const winner = {
            entity_id:      finalGame.w_entity_id,
            canonical_name: finalGame.w_name,
            entity_slug:    finalGame.w_slug,
            entity_type:    finalGame.w_type,
            image_url:      finalGame.w_image,
            birth_date:     finalGame.w_birth_date,
            death_date:     finalGame.w_death_date,
            country_iso2:   finalGame.w_country_iso2,
            country_name:   finalGame.w_country_name,
            rank_at_event:  finalGame.rank_at_event,
          };

          const loser = {
            entity_id:      finalGame.l_entity_id,
            canonical_name: finalGame.l_name,
            entity_slug:    finalGame.l_slug,
            birth_date:     finalGame.l_birth_date,
            death_date:     finalGame.l_death_date,
            country_iso2:   finalGame.l_country_iso2,
            rank_at_event:  finalGame.l_rank_at_event,
          };

          // finalGame.score is already stored in exactly the shape
          // EventBlock.jsx needs: { sets: [{w,l,tb}], walkover }. This was
          // previously nested under winner.score (with loser nested under
          // winner.runner_up) — but EventBlock reads sets/walkover/loser
          // as top-level siblings of winner, so none of it was ever
          // actually reaching the score display.
          const sets = finalGame.score?.sets || [];
          const walkover = finalGame.score?.walkover || false;

          return { season_id: season.id, winner, loser, sets, walkover };
        }

        // Football / standings-based sports: winner depends on competition
        // shape. UCL/World Cup (final_tour/final tab structure): champion =
        // winner_entity_id of the Final game. Ligue 1/Serie A/etc (flat
        // standings): champion = position 1 in the default standings tab.
        // Same usesFinalTour detection already used correctly by
        // /entity-history further down this file — this block was missing
        // that branch entirely, meaning every final_tour-based competition
        // (no tab has typology='standings') always fell through to the
        // standings-only path below and silently returned winner: null.
        const usesFinalTour = await queryOne(`
          SELECT 1 FROM result_tabs
          WHERE season_id = $1 AND tab_group = 'final_tour' AND tab_key = 'final'
          LIMIT 1
        `, [season.id]);

        if (usesFinalTour) {
          const finalTab = await queryOne(`
            SELECT id FROM result_tabs
            WHERE season_id = $1 AND tab_group = 'final_tour' AND tab_key = 'final'
            LIMIT 1
          `, [season.id]);
          if (!finalTab) return { season_id: season.id, winner: null };

          const finalGame = await queryOne(`
            SELECT
              g.score,
              g.home_entity_id = g.winner_entity_id AS winner_is_home,
              ew.id              AS entity_id,
              ew.canonical_name,
              ew.slug            AS entity_slug,
              ew.entity_type,
              ew.primary_color   AS club_primary_color,
              ew.secondary_color AS club_secondary_color,
              ew.third_color     AS club_third_color,
              COALESCE(el.logo_url, ew.image_url) AS image_url,
              cw.iso2            AS country_iso2,
              cw.name            AS country_name,
              eloser.id              AS l_entity_id,
              eloser.canonical_name  AS l_name,
              eloser.slug            AS l_slug,
              COALESCE(ell.logo_url, eloser.image_url) AS l_image_url,
              cl.iso2                AS l_country_iso2
            FROM games g
            JOIN entities ew ON ew.id = g.winner_entity_id
            JOIN entities eloser ON eloser.id = CASE
              WHEN g.home_entity_id = g.winner_entity_id THEN g.away_entity_id
              ELSE g.home_entity_id
            END
            LEFT JOIN entity_logos el ON el.entity_id = ew.id
              AND $2::int BETWEEN el.start_year AND COALESCE(el.end_year, 9999)
            LEFT JOIN entity_logos ell ON ell.entity_id = eloser.id
              AND $2::int BETWEEN ell.start_year AND COALESCE(ell.end_year, 9999)
            LEFT JOIN countries cw ON cw.id = ew.country_id
            LEFT JOIN countries cl ON cl.id = eloser.country_id
            WHERE g.result_tab_id = $1
            LIMIT 1
          `, [finalTab.id, season.year]);

          if (!finalGame) return { season_id: season.id, winner: null };

          const winner = {
            entity_id:            finalGame.entity_id,
            canonical_name:       finalGame.canonical_name,
            entity_slug:          finalGame.entity_slug,
            entity_type:          finalGame.entity_type,
            club_primary_color:   finalGame.club_primary_color,
            club_secondary_color: finalGame.club_secondary_color,
            club_third_color:     finalGame.club_third_color,
            image_url:            finalGame.image_url,
            country_iso2:         finalGame.country_iso2,
            country_name:         finalGame.country_name,
          };

          const loser = {
            entity_id:      finalGame.l_entity_id,
            canonical_name: finalGame.l_name,
            entity_slug:    finalGame.l_slug,
            image_url:      finalGame.l_image_url,
            country_iso2:   finalGame.l_country_iso2,
          };

          // EventBlock.jsx's scoreBlock reads `sets`/`loser`/`walkover` as
          // top-level siblings of `winner` (same shape tennis/basketball
          // already use) — previously loser/score were nested under
          // winner.runner_up/winner.score, which that block never reads, so
          // football finals silently fell back to the bare-name-only
          // display. Football has no best-of-N "sets" concept, so this is a
          // single {w,l} pair — the goal score at the end of extra time
          // (before penalties, same number the "1-1" part of "1-1 (4-2 pens)"
          // would show), reusing the exact shape the tennis/general score
          // block above already renders (winner/loser rows, flag before
          // name).
          const winnerGoals = finalGame.winner_is_home ? finalGame.score?.home : finalGame.score?.away;
          const loserGoals  = finalGame.winner_is_home ? finalGame.score?.away : finalGame.score?.home;
          const sets = (winnerGoals != null && loserGoals != null) ? [{ w: winnerGoals, l: loserGoals }] : [];

          // Penalty shootout score (1950s-onward final draws decided on
          // pens) — g.score.penalty is {home,away}|null, same shape/source
          // as fulltime/extratime, built by the ingestion script's
          // buildScore() from the goal-level dataset.
          const winnerPens = finalGame.winner_is_home ? finalGame.score?.penalty?.home : finalGame.score?.penalty?.away;
          const loserPens  = finalGame.winner_is_home ? finalGame.score?.penalty?.away : finalGame.score?.penalty?.home;
          const penalty = (winnerPens != null && loserPens != null) ? { w: winnerPens, l: loserPens } : null;

          return { season_id: season.id, winner, loser, sets, walkover: false, penalty };
        }

        // Plain standings competition (Ligue 1, Serie A, etc.): winner =
        // position 1 in the default standings tab. Reports the CURRENT
        // leader even mid-season, not just once status='past' — Mohamed
        // 2026-08-26: "Use the same eventblock template to display... Current
        // Leader (for team)... dont add +1 champion title because we will
        // know final result at the end of the season". EventBlock.jsx's
        // getAreaTitle already renders this as "Current league leader" (not
        // "Champion") whenever isPast is false, and every place that counts
        // a title toward a club/player's career total (entity-history's
        // titlesResult, club-leaders/player-leaders season_max CTEs,
        // champion-history-football, plus EventBlock's own
        // `highlighted: s.status === 'past'` on the Champion stat row) is
        // independently gated on season.status = 'past' — so this season's
        // in-progress leader is displayed as "current" everywhere but never
        // credited as a title anywhere. (Previously gated `winner` itself to
        // null pre-'past', which fixed the +1 bug but also blanked the
        // banner entirely instead of showing "current" — overcorrection.)
        const defaultTab = await queryOne(`
          SELECT id FROM result_tabs
          WHERE season_id = $1
            AND typology = 'standings'
            AND is_default = TRUE
          LIMIT 1
        `, [season.id]);
        if (!defaultTab) return { season_id: season.id, winner: null };

        const winner = await queryOne(`
          SELECT
            e.id              AS entity_id,
            e.canonical_name,
            e.slug            AS entity_slug,
            e.entity_type,
            e.primary_color   AS club_primary_color,
            e.secondary_color AS club_secondary_color,
            e.third_color     AS club_third_color,
            COALESCE(el.logo_url, e.image_url) AS image_url,
            co.iso2           AS country_iso2,
            co.name           AS country_name,
            st.stats
          FROM standings st
          JOIN entities e ON e.id = st.entity_id
          LEFT JOIN countries co ON co.id = e.country_id
          LEFT JOIN entity_logos el ON el.entity_id = e.id
            AND $2::int BETWEEN el.start_year AND COALESCE(el.end_year, 9999)
          WHERE st.result_tab_id = $1
            AND st.position = 1
        `, [defaultTab.id, season.year]);

        return { season_id: season.id, winner };
      })
    );

    const naming = await queryOne(`
      SELECT official_name, title_sponsor, partner, prize_money
      FROM competition_naming
      WHERE competition_id = $1
        AND start_year <= $2
        AND (end_year IS NULL OR end_year >= $2)
      ORDER BY start_year DESC
      LIMIT 1
    `, [comp.id, dbYear]);

    res.json({
      data: {
        competition: {
          ...comp,
          naming_this_year: naming,
        },
        seasons: seasonsFiltered,
        winners,
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/entity-history?entity_id=X&competition_id=Y&year=Z&tab_key=nba-finals
// Returns participations and titles up to and including the selected year.
// tab_key defaults to 'nba-finals' (the season's overall NBA Champion, used
// by Regular Season/Playoffs/Awards/etc.) — EventBlock.jsx passes
// tab_key='final' for the NBA Cup event, whose own single-game Final is a
// completely separate history from the season's Finals history.
router.get('/entity-history', async (req, res, next) => {
  try {
    const { entity_id, competition_id, year, tab_key } = req.query;

    if (!entity_id || !competition_id || !year) {
      return res.status(400).json({ error: 'entity_id, competition_id and year are required' });
    }
    const basketballTabKey = tab_key || 'nba-finals';

    // Detect sport
    const sportCheck = await queryOne(`
      SELECT sp.slug FROM sports sp
      JOIN event_categories ec ON ec.sport_id = sp.id
      JOIN competitions c2 ON c2.category_id = ec.id
      WHERE c2.id = $1
    `, [competition_id]);
    const isTennis = sportCheck?.slug === 'tennis';
    const isBasketball = sportCheck?.slug === 'basketball';

    let participationsResult, titlesResult, seasonsResult, finalsResult, rankResult, recordResult;

    if (isBasketball) {
      // Participation = reached the NBA Finals (appeared in the nba-finals
      // tab, as either side) that season. Title = won that season's Finals
      // series (most game-wins — a Finals appearance always has >=1 game
      // win for both sides, so raw "won a game" would count every runner-up
      // as a champion too; see the /teams route and winners-detection fix
      // above for the same series-winner pattern).
      participationsResult = await queryOne(`
        SELECT COUNT(DISTINCT s.id) AS participations
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE (g.home_entity_id = $1 OR g.away_entity_id = $1)
          AND rt.tab_key = $4
          AND s.competition_id = $2
          AND s.year <= $3
      `, [entity_id, competition_id, year, basketballTabKey]);

      titlesResult = await queryOne(`
        SELECT COUNT(*) AS titles, MAX(CASE WHEN year < $3 THEN year END) AS prev_title_year
        FROM (
          SELECT s.year AS year, g.winner_entity_id AS team_id, COUNT(*) AS wins,
            ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY COUNT(*) DESC) AS rk
          FROM games g
          JOIN result_tabs rt ON rt.id = g.result_tab_id
          JOIN seasons s ON s.id = rt.season_id
          WHERE rt.tab_key = $4
            AND g.winner_entity_id IS NOT NULL
            AND s.competition_id = $2
            AND s.year <= $3
          GROUP BY s.id, s.year, g.winner_entity_id
        ) series
        WHERE rk = 1 AND team_id = $1
      `, [entity_id, competition_id, year, basketballTabKey]);

      // Seasons = the franchise's own longevity counter (how many Regular
      // Season editions it has played in, through the selected year) — a
      // different notion from `participations` above (Finals appearances
      // only). Used by EventBlock.jsx's Team stat bloc "Seasons" row.
      seasonsResult = await queryOne(`
        SELECT COUNT(DISTINCT s.id) AS seasons
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE st.entity_id = $1
          AND s.competition_id = $2
          AND s.event_id = 74
          AND rt.tab_key = 'standings'
          AND s.year <= $3
      `, [entity_id, competition_id, year]);
    } else if (isTennis) {
      participationsResult = await queryOne(`
        SELECT COUNT(DISTINCT s.id) AS participations
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE (g.home_entity_id = $1 OR g.away_entity_id = $1)
          AND s.competition_id = $2
          AND s.year <= $3
      `, [entity_id, competition_id, year]);

      titlesResult = await queryOne(`
        SELECT
          COUNT(DISTINCT s.id) AS titles,
          MAX(CASE WHEN s.year < $3 THEN s.year END) AS prev_title_year
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE g.winner_entity_id = $1
          AND g.round = 'Final'
          AND s.competition_id = $2
          AND s.year <= $3
      `, [entity_id, competition_id, year]);

      // Finals reached (won or lost) — same shape as titlesResult but
      // counting either side of the Final, not just the winner. Backs
      // EventBlock.jsx's tennis stat bloc "Title / Finals" row (e.g. "2/2").
      finalsResult = await queryOne(`
        SELECT COUNT(DISTINCT s.id) AS finals
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE (g.home_entity_id = $1 OR g.away_entity_id = $1)
          AND g.round = 'Final'
          AND s.competition_id = $2
          AND s.year <= $3
      `, [entity_id, competition_id, year]);
    } else {
      // Detect whether this competition uses the tab_group / Final-game
      // structure (UCL: champion = winner_entity_id of the games row in
      // the final_tour/final tab) vs. a plain standings competition
      // (Ligue 1: champion = standings.position = 1). Same existence-check
      // the winner-detection logic above already relies on — no stored
      // flag needed, and it self-adapts to any future tab_group competition.
      const usesFinalTour = await queryOne(`
        SELECT 1
        FROM result_tabs rt
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1
          AND rt.tab_group = 'final_tour' AND rt.tab_key = 'final'
        LIMIT 1
      `, [competition_id]);

      // Participations: reaching the group/standings stage counts as a
      // participation either way — this part is correct for both shapes.
      participationsResult = await queryOne(`
        SELECT COUNT(DISTINCT rt.season_id) AS participations
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE st.entity_id = $1
          AND s.competition_id = $2
          AND s.year <= $3
      `, [entity_id, competition_id, year]);

      if (usesFinalTour) {
        // Title = won the Final game in that season's final_tour/final tab.
        // A group-stage 1st place (standings.position = 1) is NOT a title.
        titlesResult = await queryOne(`
          SELECT
            COUNT(DISTINCT s.id) AS titles,
            MAX(CASE WHEN s.year < $3 THEN s.year END) AS prev_title_year
          FROM games g
          JOIN result_tabs rt ON rt.id = g.result_tab_id
          JOIN seasons s ON s.id = rt.season_id
          WHERE g.winner_entity_id = $1
            AND rt.tab_group = 'final_tour' AND rt.tab_key = 'final'
            AND s.competition_id = $2
            AND s.year <= $3
        `, [entity_id, competition_id, year]);

        // Finals reached (won or lost) — same shape/purpose as tennis's own
        // finalsResult above, counting either side of the Final rather than
        // just the winner. Backs the quadrennial/biennial team stat bloc's
        // "Finals" row (World Cup, and any future competition of the same
        // shape — e.g. Euro, Olympics).
        finalsResult = await queryOne(`
          SELECT COUNT(DISTINCT s.id) AS finals
          FROM games g
          JOIN result_tabs rt ON rt.id = g.result_tab_id
          JOIN seasons s ON s.id = rt.season_id
          WHERE (g.home_entity_id = $1 OR g.away_entity_id = $1)
            AND rt.tab_group = 'final_tour' AND rt.tab_key = 'final'
            AND s.competition_id = $2
            AND s.year <= $3
        `, [entity_id, competition_id, year]);
      } else {
        // status = 'past' — same "no title until the season actually
        // ends" rule as /player-leaders' own championResult above (Mohamed
        // 2026-08-26: "EventBlock: dont assign +1 title" — an in-progress
        // season's current standings leader isn't a champion yet).
        titlesResult = await queryOne(`
          SELECT
            COUNT(DISTINCT rt.season_id) AS titles,
            MAX(CASE WHEN s.year < $3 THEN s.year END) AS prev_title_year
          FROM standings st
          JOIN result_tabs rt ON rt.id = st.result_tab_id
          JOIN seasons s ON s.id = rt.season_id
          WHERE st.entity_id = $1
            AND s.competition_id = $2
            AND s.year <= $3
            AND st.position = 1
            AND s.status = 'past'
        `, [entity_id, competition_id, year]);

        // 2nd/3rd-place finishes and overall win % — back the football
        // Performances tab (Mohamed 2026-08-26: "Add performances: see
        // screencapt" — Seasons/Champions/2nd/3rd/% wins for a club, same
        // "through <year>" cutoff as everything else here). Same
        // 'played' rule as the Ligue 1 goals/match fix earlier the same
        // day (results.js) — a scheduled-but-not-yet-played fixture has no
        // winner_entity_id AND no score.status='FT', so it's excluded from
        // both the numerator and denominator rather than counted as 0-0.
        rankResult = await queryOne(`
          SELECT
            COUNT(DISTINCT rt.season_id) FILTER (WHERE st.position = 2) AS second_place,
            COUNT(DISTINCT rt.season_id) FILTER (WHERE st.position = 3) AS third_place
          FROM standings st
          JOIN result_tabs rt ON rt.id = st.result_tab_id
          JOIN seasons s ON s.id = rt.season_id
          WHERE st.entity_id = $1
            AND s.competition_id = $2
            AND s.year <= $3
            AND s.status = 'past'
        `, [entity_id, competition_id, year]);

        recordResult = await queryOne(`
          SELECT
            COUNT(*) FILTER (WHERE g.winner_entity_id = $1) AS wins,
            COUNT(*) AS played
          FROM games g
          JOIN result_tabs rt ON rt.id = g.result_tab_id
          JOIN seasons s ON s.id = rt.season_id
          WHERE (g.home_entity_id = $1 OR g.away_entity_id = $1)
            AND s.competition_id = $2
            AND s.year <= $3
            AND (g.winner_entity_id IS NOT NULL OR g.score->>'status' = 'FT')
        `, [entity_id, competition_id, year]);
      }
    }

    const played = recordResult ? parseInt(recordResult.played ?? 0) : 0;
    const wins = recordResult ? parseInt(recordResult.wins ?? 0) : 0;

    res.json({
      data: {
        participations:  parseInt(participationsResult?.participations ?? 0),
        titles:          parseInt(titlesResult?.titles ?? 0),
        prev_title_year: titlesResult?.prev_title_year ? parseInt(titlesResult.prev_title_year) : null,
        seasons:         seasonsResult ? parseInt(seasonsResult.seasons ?? 0) : null,
        finals:          finalsResult ? parseInt(finalsResult.finals ?? 0) : null,
        second_place:    rankResult ? parseInt(rankResult.second_place ?? 0) : null,
        third_place:     rankResult ? parseInt(rankResult.third_place ?? 0) : null,
        win_pct:         recordResult ? (played > 0 ? Math.round((wins / played) * 100) : 0) : null,
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/grand-slam-history?entity_id=X&year=Z&competition_id=W
// Backs EventBlock.jsx's tennis stat bloc: per-Grand-Slam titles/finals for
// this player through the selected year, one row per Grand Slam competition
// plus the combined total. The 4 Grand Slams are looked up by category
// (event_categories.canonical_name = 'Grand Slam') rather than hardcoded
// competition ids, so this holds even if competition ids ever change.
//
// competition_id (optional) is the browsed Slam. When given, every count
// below is cut off at that Slam's own Final match_date, not just "year <=
// Z" — a plain year cutoff overcounts: browsing the Australian Open (played
// in January) would otherwise already include that SAME year's US Open
// (played in September), which hasn't happened yet from the browsed page's
// own point in time. Confirmed bug, Mohamed's worked example: Sinner's
// January 2024 Australian Open title/final must read 1I1 on that page, not
// 2I2 (2I2 is only true after he also wins the September 2024 US Open).
// Without competition_id, falls back to the coarser year<=Z cutoff (old
// behavior) since there's no specific browsed date to cut off against.
//
// same_year_count: how many Grand Slam titles this player has in exactly
// this `year`, counting only ones on or before the browsed Slam's own
// Final (same cutoff date as above). Backs the Grand Slam row's "+N"
// badge: winning Wimbledon after already winning that year's Australian
// Open should badge "+2", not the flat "+1" a single title alone suggests.
router.get('/grand-slam-history', async (req, res, next) => {
  try {
    const { entity_id, year, competition_id } = req.query;
    if (!entity_id || !year) {
      return res.status(400).json({ error: 'entity_id and year are required' });
    }

    let cutoff = null;
    if (competition_id) {
      const browsedFinal = await queryOne(`
        SELECT MIN(g.match_date) AS d
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE s.competition_id = $1 AND s.year = $2 AND g.round = 'Final' AND g.winner_entity_id = $3
      `, [competition_id, year, entity_id]);
      cutoff = browsedFinal?.d ?? null;
    }
    // No real cutoff resolved (no competition_id given, or this player
    // didn't win the browsed Slam's Final that year) — fall back to a
    // date far enough out that "s.year < $2 OR g.match_date <= cutoff"
    // behaves exactly like the old plain "s.year <= $2" cutoff.
    const cutoffOrMax = cutoff ?? '9999-12-31';

    const rows = await queryAll(`
      SELECT
        c.id AS competition_id, c.slug, c.name,
        COUNT(DISTINCT CASE WHEN g.id IS NOT NULL AND (s.year < $2 OR g.match_date <= $3) THEN s.id END) AS finals,
        COUNT(DISTINCT CASE WHEN g.winner_entity_id = $1 AND (s.year < $2 OR g.match_date <= $3) THEN s.id END) AS titles
      FROM competitions c
      JOIN event_categories ec ON ec.id = c.category_id
      JOIN seasons s ON s.competition_id = c.id AND s.year <= $2
      JOIN result_tabs rt ON rt.season_id = s.id AND rt.tab_key LIKE 'draw-singles-%'
      LEFT JOIN games g ON g.result_tab_id = rt.id AND g.round = 'Final'
        AND (g.home_entity_id = $1 OR g.away_entity_id = $1)
      WHERE ec.canonical_name = 'Grand Slam'
      GROUP BY c.id, c.slug, c.name
      ORDER BY c.id
    `, [entity_id, year, cutoffOrMax]);

    const by_competition = rows.map(r => ({
      competition_id: r.competition_id,
      slug:           r.slug,
      name:           r.name,
      finals:         parseInt(r.finals ?? 0),
      titles:         parseInt(r.titles ?? 0),
    }));
    const total = by_competition.reduce((acc, r) => ({
      finals: acc.finals + r.finals,
      titles: acc.titles + r.titles,
    }), { finals: 0, titles: 0 });

    let same_year_count = null;
    if (cutoff) {
      const cnt = await queryOne(`
        SELECT COUNT(DISTINCT s.id) AS n
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN competitions c ON c.id = s.competition_id
        JOIN event_categories ec ON ec.id = c.category_id
        WHERE ec.canonical_name = 'Grand Slam' AND s.year = $1 AND g.round = 'Final'
          AND g.winner_entity_id = $2 AND g.match_date <= $3
      `, [year, entity_id, cutoff]);
      same_year_count = parseInt(cnt?.n ?? 0);
    }

    res.json({ data: { by_competition, total, same_year_count } });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/tennis-tier-history?entity_id=X&year=Z&competition_id=W
// Backs EventBlock.jsx's tennis stat bloc on non-Grand-Slam (Masters
// 1000/500/250) pages: titles/finals rolled up across EVERY competition in
// each tier, not just the browsed one — e.g. "Masters 1000" sums Indian
// Wells + Miami + Monte-Carlo + ... together. Hardcoded to the 3 ATP tier
// category ids (12/14/16) — WTA's equivalents (13/15/17) aren't sourced yet
// (see CLAUDE.md current-work notes).
//
// competition_id (optional) is the browsed Masters event — when given, also
// returns same_year_count (how many titles this player has in exactly this
// `year`, within the SAME tier as the browsed event, whose Final happened on
// or before the browsed event's own Final — same "+N" badge logic as
// grand-slam-history's same_year_count, see that route's comment) and
// same_year_category_id (which tier that count belongs to, so the frontend
// knows which tier row to badge).
const ATP_TIER_CATEGORIES = [12, 14, 16];
router.get('/tennis-tier-history', async (req, res, next) => {
  try {
    const { entity_id, year, competition_id } = req.query;
    if (!entity_id || !year) {
      return res.status(400).json({ error: 'entity_id and year are required' });
    }

    // Cutoff at the browsed event's own Final date — same "at the time of
    // the event" fix as grand-slam-history (see that route's comment):
    // browsing an early-season Masters 1000 shouldn't already count a
    // later-in-the-year Masters 500 that hasn't happened yet from this
    // page's own point in time. Applies to EVERY tier row, not just the
    // one matching the browsed event's own category.
    let cutoff = null;
    let same_year_category_id = null;
    if (competition_id) {
      const browsed = await queryOne(`
        SELECT c.category_id, MIN(g.match_date) AS d
        FROM competitions c
        JOIN seasons s ON s.competition_id = c.id AND s.year = $2
        JOIN result_tabs rt ON rt.season_id = s.id AND rt.tab_key LIKE 'draw-singles-%'
        JOIN games g ON g.result_tab_id = rt.id AND g.round = 'Final' AND g.winner_entity_id = $1
        WHERE c.id = $3
        GROUP BY c.category_id
      `, [entity_id, year, competition_id]);
      cutoff = browsed?.d ?? null;
      same_year_category_id = browsed?.category_id ?? null;
    }
    const cutoffOrMax = cutoff ?? '9999-12-31';

    const rows = await queryAll(`
      SELECT
        c.category_id,
        COUNT(DISTINCT CASE WHEN g.id IS NOT NULL AND (s.year < $2 OR g.match_date <= $4) THEN s.id END) AS finals,
        COUNT(DISTINCT CASE WHEN g.winner_entity_id = $1 AND (s.year < $2 OR g.match_date <= $4) THEN s.id END) AS titles
      FROM competitions c
      JOIN seasons s ON s.competition_id = c.id AND s.year <= $2
      JOIN result_tabs rt ON rt.season_id = s.id AND rt.tab_key LIKE 'draw-singles-%'
      LEFT JOIN games g ON g.result_tab_id = rt.id AND g.round = 'Final'
        AND (g.home_entity_id = $1 OR g.away_entity_id = $1)
      WHERE c.category_id = ANY($3)
      GROUP BY c.category_id
    `, [entity_id, year, ATP_TIER_CATEGORIES, cutoffOrMax]);

    const byId = Object.fromEntries(rows.map(r => [r.category_id, r]));
    const tiers = ATP_TIER_CATEGORIES.map(catId => ({
      category_id: catId,
      finals:      parseInt(byId[catId]?.finals ?? 0),
      titles:      parseInt(byId[catId]?.titles ?? 0),
    }));

    let same_year_count = null;
    if (cutoff) {
      const cnt = await queryOne(`
        SELECT COUNT(DISTINCT s.id) AS n
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN competitions c ON c.id = s.competition_id
        WHERE c.category_id = $1 AND s.year = $2 AND g.round = 'Final'
          AND g.winner_entity_id = $3 AND g.match_date <= $4
      `, [same_year_category_id, year, entity_id, cutoff]);
      same_year_count = parseInt(cnt?.n ?? 0);
    }

    res.json({ data: { tiers, same_year_count, same_year_category_id } });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/club-leaders?club_entity_id=X&competition_id=Y&year=Z
// Football-only. Backs EventBlock.jsx's football stat bloc "Top Scorer /
// Assist" row: how many times (through the selected year) this club has
// produced the league's outright top scorer / top assist provider — a
// trophy-case count like Champion/Seasons above it, not a per-season name.
// A season counts as a title for the club if any of its players match that
// season's league-wide max goals/assists (ties all count, same "co-winner"
// treatment as any other shared-trophy season elsewhere in the app).
router.get('/club-leaders', async (req, res, next) => {
  try {
    const { club_entity_id, competition_id, year } = req.query;
    if (!club_entity_id || !competition_id || !year) {
      return res.status(400).json({ error: 'club_entity_id, competition_id and year are required' });
    }

    // status = 'past' on both — "top scorer/top assist provider that
    // season" is a final-ranking claim exactly like Champion, so it waits
    // for the season to finish too (Mohamed 2026-08-26: "EventBlock: dont
    // assign +1 title" / Team Stats: "neither top scorer, assist leader...
    // can be aggregated[d]" until the last matchweek).
    const topScorerResult = await queryOne(`
      WITH season_max AS (
        SELECT pss.season_id, MAX(pss.goals) AS max_goals
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND s.status = 'past'
        GROUP BY pss.season_id
      )
      SELECT COUNT(DISTINCT sm.season_id) AS titles
      FROM season_max sm
      JOIN player_season_stats pss2 ON pss2.season_id = sm.season_id AND pss2.goals = sm.max_goals
      WHERE pss2.club_entity_id = $1 AND sm.max_goals > 0
    `, [club_entity_id, competition_id, year]);

    const topAssistResult = await queryOne(`
      WITH season_max AS (
        SELECT pss.season_id, MAX(pss.assists) AS max_assists
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND s.status = 'past'
        GROUP BY pss.season_id
      )
      SELECT COUNT(DISTINCT sm.season_id) AS titles
      FROM season_max sm
      JOIN player_season_stats pss2 ON pss2.season_id = sm.season_id AND pss2.assists = sm.max_assists
      WHERE pss2.club_entity_id = $1 AND sm.max_assists > 0
    `, [club_entity_id, competition_id, year]);

    res.json({
      data: {
        top_scorer_titles: parseInt(topScorerResult?.titles ?? 0),
        top_assist_titles: parseInt(topAssistResult?.titles ?? 0),
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/player-leaders?entity_id=X&competition_id=Y&year=Z
// Football-only. Backs EventBlock.jsx's football Scorers/Passers stat bloc:
// this PLAYER's own career trophy case (through the selected year) — how
// many times he was the league's outright top scorer / top assist provider
// (same season_max pattern as club-leaders, just filtered by entity_id
// instead of club_entity_id), plus how many league titles he's won (any
// season where the club he played for that year was that season's
// standings champion — a player can rack these up across multiple clubs).
router.get('/player-leaders', async (req, res, next) => {
  try {
    const { entity_id, competition_id, year } = req.query;
    if (!entity_id || !competition_id || !year) {
      return res.status(400).json({ error: 'entity_id, competition_id and year are required' });
    }

    // status = 'past' on both — same "no title until the season ends" rule
    // as club-leaders above.
    const topScorerResult = await queryOne(`
      WITH season_max AS (
        SELECT pss.season_id, MAX(pss.goals) AS max_goals
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND s.status = 'past'
        GROUP BY pss.season_id
      )
      SELECT COUNT(DISTINCT sm.season_id) AS titles
      FROM season_max sm
      JOIN player_season_stats pss2 ON pss2.season_id = sm.season_id AND pss2.goals = sm.max_goals
      WHERE pss2.entity_id = $1 AND sm.max_goals > 0
    `, [entity_id, competition_id, year]);

    const topAssistResult = await queryOne(`
      WITH season_max AS (
        SELECT pss.season_id, MAX(pss.assists) AS max_assists
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE s.competition_id = $2 AND s.year <= $3 AND s.status = 'past'
        GROUP BY pss.season_id
      )
      SELECT COUNT(DISTINCT sm.season_id) AS titles
      FROM season_max sm
      JOIN player_season_stats pss2 ON pss2.season_id = sm.season_id AND pss2.assists = sm.max_assists
      WHERE pss2.entity_id = $1 AND sm.max_assists > 0
    `, [entity_id, competition_id, year]);

    // status = 'past' — a season only crowns a real champion once it's
    // finished (Mohamed 2026-08-26: "dont assign any champion title to any
    // player until the last game of the season", found live when Ligue 1
    // 2026/27's matchweek-1 leader was showing a title after one game).
    // Without this, season_champions would credit whoever currently sits
    // in position 1 of an in-progress season.
    const championResult = await queryOne(`
      WITH player_club_seasons AS (
        SELECT DISTINCT pss.season_id, pss.club_entity_id
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE pss.entity_id = $1 AND s.competition_id = $2 AND s.year <= $3
      ),
      season_champions AS (
        SELECT rt.season_id, st.entity_id AS champion_entity_id
        FROM standings st
        JOIN result_tabs rt ON rt.id = st.result_tab_id
        JOIN seasons s2 ON s2.id = rt.season_id
        WHERE rt.tab_key = 'standings' AND st.position = 1 AND s2.status = 'past'
      )
      SELECT COUNT(*) AS titles
      FROM player_club_seasons pcs
      JOIN season_champions sc ON sc.season_id = pcs.season_id AND sc.champion_entity_id = pcs.club_entity_id
    `, [entity_id, competition_id, year]);

    // Same idea as championResult above, but for Final-tour competitions
    // (World Cup, Euro, ...) which have no 'standings' tab at all — champion
    // there means "played for the team that won the Final" (games.winner_
    // entity_id on the final_tour/final tab), not standings position=1.
    // pss.club_entity_id is the national team the player represented that
    // edition (see ingest_worldcup_history.js), same shape winner_entity_id
    // already is, so the join is a direct id match.
    const finalTitlesResult = await queryOne(`
      WITH player_club_seasons AS (
        SELECT DISTINCT pss.season_id, pss.club_entity_id
        FROM player_season_stats pss
        JOIN seasons s ON s.id = pss.season_id
        WHERE pss.entity_id = $1 AND s.competition_id = $2 AND s.year <= $3
      ),
      season_champions AS (
        SELECT rt.season_id, g.winner_entity_id AS champion_entity_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        WHERE rt.tab_key = 'final' AND rt.tab_group = 'final_tour'
      )
      SELECT COUNT(*) AS titles
      FROM player_club_seasons pcs
      JOIN season_champions sc ON sc.season_id = pcs.season_id AND sc.champion_entity_id = pcs.club_entity_id
    `, [entity_id, competition_id, year]);

    // Quadrennial/biennial (World Cup, Euro, ...) Scorers/Passers stat bloc
    // swaps Champion/Cup/League Cup/Champions Trophy for career tournament
    // totals instead — one row per player_season_stats row per edition
    // played (already aggregated across the whole tournament per player per
    // season by ingestion, not per-tab, so a plain SUM/COUNT here is safe).
    const totalsResult = await queryOne(`
      SELECT
        COUNT(DISTINCT pss.season_id) AS participations,
        COALESCE(SUM(pss.games_played), 0) AS games_played,
        COALESCE(SUM(pss.goals), 0) AS goals,
        COALESCE(SUM(pss.assists), 0) AS assists
      FROM player_season_stats pss
      JOIN seasons s ON s.id = pss.season_id
      WHERE pss.entity_id = $1 AND s.competition_id = $2 AND s.year <= $3
    `, [entity_id, competition_id, year]);

    res.json({
      data: {
        champion_titles: parseInt(championResult?.titles ?? 0),
        final_titles: parseInt(finalTitlesResult?.titles ?? 0),
        top_scorer_titles: parseInt(topScorerResult?.titles ?? 0),
        top_assist_titles: parseInt(topAssistResult?.titles ?? 0),
        participations: parseInt(totalsResult?.participations ?? 0),
        games_played: parseInt(totalsResult?.games_played ?? 0),
        goals: parseInt(totalsResult?.goals ?? 0),
        assists: parseInt(totalsResult?.assists ?? 0),
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/award-winner?season_id=X&tab_key=mvp
// Basketball-only. Backs EventBlock B (per BASK-NAV-01 page 5): the award
// tab's actual winner (stats->>'winner', set directly from the source CSV's
// "winner" column by ingest-nba-awards.js — not inferred from rank=1, which
// would coincide in practice but isn't the authoritative flag), their club,
// and career counts of each of the 6 awards plus NBA Finals appearances and
// Titles (seasons where they rostered for a Finals team / the winning one),
// all "through" this season's year.
router.get('/award-winner', async (req, res, next) => {
  try {
    const { season_id, tab_key } = req.query;
    if (!season_id || !tab_key) {
      return res.status(400).json({ error: 'season_id and tab_key are required' });
    }

    const seasonRow = await queryOne(
      `SELECT competition_id, year FROM seasons WHERE id = $1`,
      [season_id]
    );
    if (!seasonRow) return res.json({ data: null });

    const winnerRow = await queryOne(`
      SELECT
        pss.entity_id,
        COALESCE(pss.club_entity_id, (pss.stats->>'club_entity_id')::int) AS club_entity_id
      FROM player_season_stats pss
      JOIN result_tabs rt ON rt.id = pss.result_tab_id
      WHERE rt.season_id = $1 AND rt.tab_key = $2 AND (pss.stats->>'winner')::boolean = true
      LIMIT 1
    `, [season_id, tab_key]);
    if (!winnerRow) return res.json({ data: null });

    const player = await queryOne(`
      SELECT e.id AS entity_id, e.canonical_name, e.slug AS entity_slug, e.image_url, e.birth_date, e.death_date,
             co.iso2 AS country_iso2, co.name AS country_name
      FROM entities e
      LEFT JOIN countries co ON co.id = e.country_id
      WHERE e.id = $1
    `, [winnerRow.entity_id]);

    const club = winnerRow.club_entity_id ? await queryOne(`
      SELECT e.id AS entity_id, e.canonical_name, e.slug AS entity_slug,
             e.sport_attributes->>'team_code' AS team_code,
             COALESCE(el.logo_url, e.image_url) AS image_url
      FROM entities e
      LEFT JOIN entity_logos el ON el.entity_id = e.id
        AND $2::int BETWEEN el.start_year AND COALESCE(el.end_year, 9999)
      WHERE e.id = $1
    `, [winnerRow.club_entity_id, seasonRow.year]) : null;

    const awardCounts = await queryAll(`
      SELECT rt.tab_key, COUNT(*) AS cnt
      FROM player_season_stats pss
      JOIN result_tabs rt ON rt.id = pss.result_tab_id
      JOIN seasons s ON s.id = rt.season_id
      WHERE pss.entity_id = $1
        AND s.competition_id = $2
        AND s.year <= $3
        -- All-Star reuses tab_key='mvp' for its own MVP tab (event_id=80) —
        -- excluded here so it can't inflate this player's regular-season
        -- MVP career count; All-Star's own selections/MVP total live in a
        -- separate query below, not this trophy-case list.
        AND s.event_id != 80
        AND (
          (rt.tab_key IN ('mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy', 'nba-cup-mvp') AND (pss.stats->>'winner')::boolean = true)
          -- All-NBA/All-Defense/NBA Cup Team have no 'winner' flag — every
          -- row in these tabs is already one of the selected team members,
          -- unlike MVP-style tabs which list every candidate who got votes.
          OR rt.tab_key IN ('all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd', 'nba-cup-teams')
        )
      GROUP BY rt.tab_key
    `, [winnerRow.entity_id, seasonRow.competition_id, seasonRow.year]);

    const career = {
      mvp: 0, 'finals-mvp': 0, dpoy: 0, smoy: 0, mip: 0, roy: 0, 'nba-cup-mvp': 0,
      'all-nba-1st': 0, 'all-nba-2nd': 0, 'all-nba-3rd': 0,
      'all-defense-1st': 0, 'all-defense-2nd': 0, 'nba-cup-teams': 0,
      'all-star': 0, 'all-star-mvp': 0,
    };
    awardCounts.forEach(r => { career[r.tab_key] = parseInt(r.cnt); });

    // All-Star selections/MVP: every typology='players' row under the
    // All-Star event (event_id=80) is a selection; its own 'mvp' tab
    // (winner=true) is the All-Star MVP count — same split as the
    // All-Time Player Awards page (results.js's /player-awards route).
    const allStarCounts = await queryOne(`
      SELECT
        COUNT(*) FILTER (WHERE rt.tab_key != 'mvp') AS all_star,
        COUNT(*) FILTER (WHERE rt.tab_key = 'mvp' AND (pss.stats->>'winner')::boolean = true) AS all_star_mvp
      FROM player_season_stats pss
      JOIN result_tabs rt ON rt.id = pss.result_tab_id
      JOIN seasons s ON s.id = rt.season_id
      WHERE pss.entity_id = $1 AND s.competition_id = $2 AND s.event_id = 80 AND s.year <= $3
        AND rt.typology = 'players'
    `, [winnerRow.entity_id, seasonRow.competition_id, seasonRow.year]);
    career['all-star']     = parseInt(allStarCounts?.all_star)     || 0;
    career['all-star-mvp'] = parseInt(allStarCounts?.all_star_mvp) || 0;

    const titlesResult = await queryOne(`
      WITH champions AS (
        SELECT s.id AS season_id, s.year, g.winner_entity_id AS team_id,
          ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY COUNT(*) DESC) AS rk
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'nba-finals' AND s.competition_id = $2 AND s.year <= $3
          AND g.winner_entity_id IS NOT NULL
        GROUP BY s.id, s.year, g.winner_entity_id
      )
      SELECT COUNT(*) AS titles
      FROM champions c
      JOIN seasons rs ON rs.competition_id = $2 AND rs.event_id = 74 AND rs.year = c.year
      JOIN result_tabs rt2 ON rt2.season_id = rs.id AND rt2.tab_key = 'players'
      JOIN player_season_stats pss2 ON pss2.result_tab_id = rt2.id AND pss2.entity_id = $1
      WHERE c.rk = 1
        AND COALESCE(pss2.club_entity_id, (pss2.stats->>'club_entity_id')::int) = c.team_id
    `, [winnerRow.entity_id, seasonRow.competition_id, seasonRow.year]);
    career.titles = parseInt(titlesResult?.titles ?? 0);

    // Finals = seasons where the player's team was one of the two sides in
    // that season's nba-finals tab (won or lost) — same roster-membership
    // join as titles above, minus the rk = 1 (won) restriction.
    const finalsResult = await queryOne(`
      WITH finalists AS (
        SELECT DISTINCT s.year, g.home_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'nba-finals' AND s.competition_id = $2 AND s.year <= $3
        UNION
        SELECT DISTINCT s.year, g.away_entity_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        WHERE rt.tab_key = 'nba-finals' AND s.competition_id = $2 AND s.year <= $3
      )
      SELECT COUNT(*) AS finals
      FROM finalists f
      JOIN seasons rs ON rs.competition_id = $2 AND rs.event_id = 74 AND rs.year = f.year
      JOIN result_tabs rt2 ON rt2.season_id = rs.id AND rt2.tab_key = 'players'
      JOIN player_season_stats pss2 ON pss2.result_tab_id = rt2.id AND pss2.entity_id = $1
      WHERE COALESCE(pss2.club_entity_id, (pss2.stats->>'club_entity_id')::int) = f.team_id
    `, [winnerRow.entity_id, seasonRow.competition_id, seasonRow.year]);
    career.finals = parseInt(finalsResult?.finals ?? 0);

    // NBA Cup titles = same roster-membership pattern as nba-finals titles
    // above, against the NBA Cup event's own single-game Final (event
    // slug nba-cup-4828, tab_key 'final' — a completely separate
    // competition/history from the season's overall Finals, same
    // distinction EventBlock.jsx's _isNbaCup / /entity-history tab_key
    // override already make).
    const cupTitlesResult = await queryOne(`
      WITH cup_champions AS (
        SELECT s.year, g.winner_entity_id AS team_id
        FROM games g
        JOIN result_tabs rt ON rt.id = g.result_tab_id
        JOIN seasons s ON s.id = rt.season_id
        JOIN events e ON e.id = s.event_id
        WHERE e.slug = 'nba-cup-4828' AND rt.tab_key = 'final'
          AND s.competition_id = $2 AND s.year <= $3
          AND g.winner_entity_id IS NOT NULL
      )
      SELECT COUNT(*) AS titles
      FROM cup_champions cc
      JOIN seasons rs ON rs.competition_id = $2 AND rs.event_id = 74 AND rs.year = cc.year
      JOIN result_tabs rt2 ON rt2.season_id = rs.id AND rt2.tab_key = 'players'
      JOIN player_season_stats pss2 ON pss2.result_tab_id = rt2.id AND pss2.entity_id = $1
      WHERE COALESCE(pss2.club_entity_id, (pss2.stats->>'club_entity_id')::int) = cc.team_id
    `, [winnerRow.entity_id, seasonRow.competition_id, seasonRow.year]);
    career['nba-cup'] = parseInt(cupTitlesResult?.titles ?? 0);

    res.json({ data: { player, club, career } });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/by-competition?competition_id=X
// Flat list of every season row for a competition, across all years.
// Used by:
//   - admin pickers (Match Videos, Iconic Moments) needing a year/gender dropdown
//   - the admin Competitions page Seasons block (Build: admin competitions
//     restructure), which additionally needs per-season counts and an
//     ingestion flag — added below as extra columns. Existing consumers
//     that only destructure {id, year, gender, sub_edition, status,
//     event_name, event_slug} are unaffected by the additional fields.
router.get('/by-competition', async (req, res, next) => {
  try {
    const { competition_id } = req.query;

    if (!competition_id) {
      return res.status(400).json({ error: 'competition_id is required' });
    }

    const seasons = await queryAll(`
      SELECT
        s.id,
        s.year,
        s.gender,
        s.sub_edition,
        s.status,
        s.start_date,
        s.end_date,
        s.edition_number,
        s.cancellation_reason,
        c.founded_year,
        c.cancelled_years,
        c.year_convention,
        e.name AS event_name,
        e.slug AS event_slug,
        (
          SELECT cn.official_name
          FROM competition_naming cn
          WHERE cn.competition_id = s.competition_id
            AND cn.start_year <= s.year
            AND (cn.end_year IS NULL OR cn.end_year >= s.year)
          ORDER BY cn.start_year DESC
          LIMIT 1
        ) AS official_name,
        (
          SELECT COUNT(DISTINCT st.entity_id)
          FROM standings st
          JOIN result_tabs rt ON rt.id = st.result_tab_id
          WHERE rt.season_id = s.id
        ) AS clubs_count,
        (
          SELECT COUNT(*) FROM player_season_stats pss WHERE pss.season_id = s.id
        ) AS players_count,
        (
          SELECT COUNT(*) FROM player_season_stats pss WHERE pss.season_id = s.id AND pss.goals > 0
        ) AS scorers_count,
        (
          SELECT COUNT(*) FROM player_season_stats pss WHERE pss.season_id = s.id AND pss.assists > 0
        ) AS assists_count,
        (
          EXISTS (SELECT 1 FROM standings st JOIN result_tabs rt ON rt.id = st.result_tab_id WHERE rt.season_id = s.id)
          OR EXISTS (SELECT 1 FROM player_season_stats pss WHERE pss.season_id = s.id)
          OR EXISTS (SELECT 1 FROM games g JOIN result_tabs rt2 ON rt2.id = g.result_tab_id WHERE rt2.season_id = s.id)
        ) AS ingested,
        -- Whether this season row has any game-typology tabs at all — used by
        -- the admin Match Videos picker to hide events that can never have a
        -- match to attach a video to (e.g. NBA Awards/All-Star, or any other
        -- sport's non-game events), rather than hardcoding event names.
        EXISTS (
          SELECT 1 FROM result_tabs rt WHERE rt.season_id = s.id AND rt.typology = 'game'
        ) AS has_game_tabs,
        -- NBA Awards completeness check (admin Seasons table only). Originally
        -- one combined 31-slot check (6 single-winner awards + 5 EOST rosters),
        -- split in two when the EOST tabs (All-NBA/All-Defense) moved out to
        -- their own "Team of the Year" event (id 79) — see
        -- migrate-nba-team-of-the-year.js. Awards now expects 6 single-winner
        -- slots (MVP/Finals MVP/DPOY/6MOY/MIP/ROY, one 'winner'-flagged
        -- player_season_stats row each per ingest-nba-awards.js). Finals MVP
        -- has no source data anywhere and is permanently empty by design (see
        -- ingest-nba-awards.js) — kept in the 6 anyway per product decision,
        -- so a fully-ingested season still reads 5/6 until that gap is
        -- backfilled. Scoped via e.slug so it's a no-op for every other
        -- competition/event.
        CASE WHEN e.slug = 'awards-4828' THEN 6
             WHEN e.slug = 'team-of-the-year-4828' THEN 25
        END AS award_slots_expected,
        CASE WHEN e.slug = 'awards-4828' THEN (
          SELECT COUNT(*)
          FROM result_tabs rt
          WHERE rt.season_id = s.id
            AND rt.tab_key IN ('mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy')
            AND EXISTS (
              SELECT 1 FROM player_season_stats pss
              WHERE pss.result_tab_id = rt.id AND pss.stats->>'winner' = 'true'
            )
        )
        WHEN e.slug = 'team-of-the-year-4828' THEN (
          -- 5 rosters (All-NBA 1st/2nd/3rd, All-Defense 1st/2nd) x 5 players
          -- each = 25. NBA All-Rookie (empty by design, no source data yet)
          -- and NBA Cup Team (only 2024+, not every season) are deliberately
          -- excluded from this count.
          SELECT COUNT(*)
          FROM result_tabs rt
          JOIN player_season_stats pss ON pss.result_tab_id = rt.id
          WHERE rt.season_id = s.id
            AND rt.tab_key IN ('all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd')
        ) END AS award_slots_filled
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      LEFT JOIN events e ON e.id = s.event_id
      WHERE s.competition_id = $1
      ORDER BY s.year DESC, s.gender DESC NULLS LAST, e.display_order
    `, [competition_id]);

    // Edition number is computed, not stored (same formula as EventBlock.jsx
    // on the public frontend): ui_year - founded_year + 1 - (cancelled years
    // up to and including ui_year). Falls back to the stored edition_number
    // for competitions with no founded_year (mirrors the frontend exactly).
    // ui_year converts the DB-stored year per year_convention, since a
    // 'start'-convention row (Ligue 1: DB year 2025) displays as the later
    // year (2026) — the same conversion EventBlock applies via activeYear.
    const withEdition = seasons.map(row => {
      const uiYear = row.year_convention === 'start' ? row.year + 1 : row.year;
      let edition_number = row.edition_number;
      if (row.founded_year) {
        const cancelledCount = (row.cancelled_years || []).filter(y => y <= uiYear).length;
        edition_number = uiYear - row.founded_year + 1 - cancelledCount;
      }
      return { ...row, edition_number, ui_year: uiYear };
    });

    res.json({ data: withEdition });
  } catch (err) {
    next(err);
  }
});

// GET /api/seasons/:id
router.get('/:id', async (req, res, next) => {
  try {
    const season = await queryOne(`
      SELECT s.*, c.name AS competition_name, c.slug AS competition_slug,
             c.logo_url, c.bg_image_url, c.column_config,
             e.name AS event_name, e.slug AS event_slug
      FROM seasons s
      JOIN competitions c ON c.id = s.competition_id
      LEFT JOIN events e ON e.id = s.event_id
      WHERE s.id = $1
    `, [req.params.id]);

    if (!season) {
      return res.status(404).json({ error: 'Season not found' });
    }

    const tabs = await queryAll(`
      SELECT id, tab_name, tab_key, typology, display_order, is_default, tab_group, group_name
      FROM result_tabs
      WHERE season_id = $1
      ORDER BY display_order
    `, [season.id]);

    // Videos tab always stays visible now, even with zero content yet —
    // see the matching comment on the list-seasons route above.
    const visibleTabs = tabs;

    res.json({ data: { ...season, result_tabs: visibleTabs } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;