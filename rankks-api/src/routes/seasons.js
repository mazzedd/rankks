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

    const seasonsWithTabs = await Promise.all(
      seasons.map(async (season) => {
        const tabs = await queryAll(`
          SELECT id, tab_name, tab_key, typology, display_order, is_default, tab_group, group_name
          FROM result_tabs
          WHERE season_id = $1
          ORDER BY display_order
        `, [season.id]);

        // Hide the Videos tab entirely when no Iconic Moments content exists yet
        // for this season — most tournaments will never have curated video, so
        // showing an empty tab everywhere would be noise.
        const hasVideosTab = tabs.some(t => t.tab_key === 'videos');
        let visibleTabs = tabs;
        if (hasVideosTab) {
          const videoContent = await queryOne(`
            SELECT 1 FROM media
            WHERE season_id = $1 AND media_type = 'iconic_moment'
            LIMIT 1
          `, [season.id]);
          if (!videoContent) {
            visibleTabs = tabs.filter(t => t.tab_key !== 'videos');
          }
        }

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
          // NBA Cup is the one exception: it's a genuinely separate
          // in-season competition with its own single-game Final, not a
          // reflection of the season's overall Finals champion — when the
          // season being processed IS the NBA Cup event, use its own
          // 'final' tab instead of redirecting to the Finals event.
          const isCupSeason = season.event_slug === 'nba-cup-4828';
          let finalsSeasonId, finalsTabKey;
          if (isCupSeason) {
            finalsSeasonId = season.id;
            finalsTabKey = 'final';
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
            LEFT JOIN entity_logos el ON el.entity_id = e.id AND el.is_current = true
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
          let sets = [];
          if (loserId) {
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
              cl.iso2               AS l_country_iso2
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
            country_iso2:   finalGame.l_country_iso2,
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
              cl.iso2                AS l_country_iso2
            FROM games g
            JOIN entities ew ON ew.id = g.winner_entity_id
            JOIN entities eloser ON eloser.id = CASE
              WHEN g.home_entity_id = g.winner_entity_id THEN g.away_entity_id
              ELSE g.home_entity_id
            END
            LEFT JOIN entity_logos el ON el.entity_id = ew.id AND el.is_current = true
            LEFT JOIN countries cw ON cw.id = ew.country_id
            LEFT JOIN countries cl ON cl.id = eloser.country_id
            WHERE g.result_tab_id = $1
            LIMIT 1
          `, [finalTab.id]);

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
            runner_up: {
              entity_id:      finalGame.l_entity_id,
              canonical_name: finalGame.l_name,
              entity_slug:    finalGame.l_slug,
              country_iso2:   finalGame.l_country_iso2,
            },
            score: finalGame.score,
          };

          return { season_id: season.id, winner };
        }

        // Plain standings competition (Ligue 1, Serie A, etc.): winner =
        // position 1 in the default standings tab
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
          LEFT JOIN entity_logos el ON el.entity_id = e.id AND el.is_current = true
          WHERE st.result_tab_id = $1
            AND st.position = 1
        `, [defaultTab.id]);

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

    let participationsResult, titlesResult;

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
      } else {
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
        `, [entity_id, competition_id, year]);
      }
    }

    res.json({
      data: {
        participations:  parseInt(participationsResult?.participations ?? 0),
        titles:          parseInt(titlesResult?.titles ?? 0),
        prev_title_year: titlesResult?.prev_title_year ? parseInt(titlesResult.prev_title_year) : null,
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
      LEFT JOIN entity_logos el ON el.entity_id = e.id AND el.is_current = true
      WHERE e.id = $1
    `, [winnerRow.club_entity_id]) : null;

    const awardCounts = await queryAll(`
      SELECT rt.tab_key, COUNT(*) AS cnt
      FROM player_season_stats pss
      JOIN result_tabs rt ON rt.id = pss.result_tab_id
      JOIN seasons s ON s.id = rt.season_id
      WHERE pss.entity_id = $1
        AND s.competition_id = $2
        AND s.year <= $3
        AND (
          (rt.tab_key IN ('mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy', 'nba-cup-mvp') AND (pss.stats->>'winner')::boolean = true)
          -- All-NBA/All-Defense have no 'winner' flag — every row in these
          -- tabs is already one of the 5 selected team members, unlike
          -- MVP-style tabs which list every candidate who got votes.
          OR rt.tab_key IN ('all-nba-1st', 'all-defense-1st')
        )
      GROUP BY rt.tab_key
    `, [winnerRow.entity_id, seasonRow.competition_id, seasonRow.year]);

    const career = { mvp: 0, 'finals-mvp': 0, dpoy: 0, smoy: 0, mip: 0, roy: 0, 'all-nba-1st': 0, 'all-defense-1st': 0, 'nba-cup-mvp': 0 };
    awardCounts.forEach(r => { career[r.tab_key] = parseInt(r.cnt); });

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
        -- NBA Awards completeness check (admin Seasons table only): the Awards
        -- season carries 11 result_tabs — 6 single-winner awards (MVP/Finals
        -- MVP/DPOY/6MOY/MIP/ROY, one 'winner'-flagged player_season_stats row
        -- each per ingest-nba-awards.js) plus 5 End-of-Season-Team rosters
        -- (all-nba-1st/2nd/3rd, all-defense-1st/2nd, 5 players each per
        -- ingest-nba-eost.js) = 31 expected slots. Finals MVP has no source
        -- data anywhere and is permanently empty by design (see
        -- ingest-nba-awards.js) — kept in the 31 anyway per product decision,
        -- so a fully-ingested season still reads 30/31 until that gap is
        -- backfilled. Scoped via e.slug so it's a no-op for every other
        -- competition/event.
        CASE WHEN e.slug = 'awards-4828' THEN 31 END AS award_slots_expected,
        CASE WHEN e.slug = 'awards-4828' THEN (
          (
            SELECT COUNT(*)
            FROM result_tabs rt
            WHERE rt.season_id = s.id
              AND rt.tab_key IN ('mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy')
              AND EXISTS (
                SELECT 1 FROM player_season_stats pss
                WHERE pss.result_tab_id = rt.id AND pss.stats->>'winner' = 'true'
              )
          )
          +
          (
            SELECT COUNT(*)
            FROM result_tabs rt
            JOIN player_season_stats pss ON pss.result_tab_id = rt.id
            WHERE rt.season_id = s.id
              AND rt.tab_key IN ('all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd')
          )
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

    let visibleTabs = tabs;
    if (tabs.some(t => t.tab_key === 'videos')) {
      const videoContent = await queryOne(`
        SELECT 1 FROM media
        WHERE season_id = $1 AND media_type = 'iconic_moment'
        LIMIT 1
      `, [season.id]);
      if (!videoContent) {
        visibleTabs = tabs.filter(t => t.tab_key !== 'videos');
      }
    }

    res.json({ data: { ...season, result_tabs: visibleTabs } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;