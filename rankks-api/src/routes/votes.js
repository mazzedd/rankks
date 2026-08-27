// src/routes/votes.js
// "Who's your pick?" — a non-betting engagement feature (Mohamed
// 2026-08-19: "Votes are a non betting feat within Rankks", separate from
// the demo/fake odds toggle elsewhere on the homepage). One vote per user
// per game, enforced by game_votes' own UNIQUE(user_id, game_id).
const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { queryAll, queryOne } = require('../db');
const userAuth = require('../middleware/userAuth');

// Best-effort decode — unlike userAuth, a missing/invalid token is not a
// failure here: vote tallies are public, only "did I already vote" needs
// to know who's asking.
function optionalUser(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

async function tallyFor(gameId) {
  const rows = await queryAll(
    `SELECT picked_entity_id, COUNT(*)::int AS n FROM game_votes WHERE game_id = $1 GROUP BY picked_entity_id`,
    [gameId]
  );
  const counts = {};
  let total = 0;
  for (const r of rows) { counts[r.picked_entity_id] = r.n; total += r.n; }
  return { total, counts };
}

// GET /api/votes/game/:gameId — public tally + the requesting user's own
// pick (null if signed out or hasn't voted yet).
router.get('/game/:gameId', async (req, res, next) => {
  try {
    const gameId = parseInt(req.params.gameId);
    const { total, counts } = await tallyFor(gameId);

    const user = optionalUser(req);
    let myPick = null;
    if (user) {
      const mine = await queryOne(`SELECT picked_entity_id FROM game_votes WHERE user_id = $1 AND game_id = $2`, [user.id, gameId]);
      myPick = mine?.picked_entity_id ?? null;
    }

    res.json({ data: { total, counts, my_pick: myPick } });
  } catch (err) { next(err); }
});

// POST /api/votes — body: { game_id, picked_entity_id }.
router.post('/', userAuth, async (req, res, next) => {
  try {
    const { game_id, picked_entity_id } = req.body;
    if (!Number.isInteger(game_id) || !Number.isInteger(picked_entity_id)) {
      return res.status(400).json({ error: 'game_id and picked_entity_id are required integers' });
    }

    const game = await queryOne(`SELECT id, home_entity_id, away_entity_id FROM games WHERE id = $1`, [game_id]);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (picked_entity_id !== game.home_entity_id && picked_entity_id !== game.away_entity_id) {
      return res.status(400).json({ error: "picked_entity_id must be one of this game's two competitors" });
    }

    const existing = await queryOne(`SELECT picked_entity_id FROM game_votes WHERE user_id = $1 AND game_id = $2`, [req.user.id, game_id]);
    if (existing) {
      return res.status(409).json({ error: 'ALREADY_VOTED', picked_entity_id: existing.picked_entity_id });
    }

    try {
      await queryOne(
        `INSERT INTO game_votes (user_id, game_id, picked_entity_id) VALUES ($1, $2, $3) RETURNING id`,
        [req.user.id, game_id, picked_entity_id]
      );
    } catch (err) {
      // 23505 = unique_violation — a second request from the same user
      // landed between the SELECT above and this INSERT (double-click,
      // duplicate tab). Treat exactly like the pre-check above rather than
      // letting a raw DB error surface as a 500.
      if (err.code === '23505') {
        const raced = await queryOne(`SELECT picked_entity_id FROM game_votes WHERE user_id = $1 AND game_id = $2`, [req.user.id, game_id]);
        return res.status(409).json({ error: 'ALREADY_VOTED', picked_entity_id: raced?.picked_entity_id ?? picked_entity_id });
      }
      throw err;
    }

    const { total, counts } = await tallyFor(game_id);
    res.status(201).json({ data: { total, counts, my_pick: picked_entity_id } });
  } catch (err) { next(err); }
});

// GET /api/votes/mine — the signed-in user's full vote history, newest
// first. Optional ?sport=<slug>&league=<competition slug> filters for the
// My Account page's "All Sports"/"All Leagues" dropdowns.
router.get('/mine', userAuth, async (req, res, next) => {
  try {
    const { sport, league } = req.query;
    const params = [req.user.id];
    let filterSql = '';
    if (sport)  { params.push(sport);  filterSql += ` AND sp.slug = $${params.length}`; }
    if (league) { params.push(league); filterSql += ` AND c.slug = $${params.length}`; }

    const rows = await queryAll(`
      SELECT
        gv.id, gv.created_at AS voted_at,
        g.id AS game_id, g.match_date, g.round, g.winner_entity_id, g.score,
        gv.picked_entity_id,
        picked.canonical_name AS picked_name,
        home.canonical_name AS home_name, away.canonical_name AS away_name,
        CASE WHEN g.winner_entity_id = g.home_entity_id THEN home.canonical_name
             WHEN g.winner_entity_id = g.away_entity_id THEN away.canonical_name
             ELSE NULL END AS winner_name,
        s.year, s.status AS season_status,
        c.name AS competition_name, c.slug AS competition_slug,
        sp.name AS sport_name, sp.slug AS sport_slug,
        (SELECT COUNT(*)::int FROM game_votes gv2 WHERE gv2.game_id = g.id) AS total_votes,
        -- Crowd accuracy — of everyone who voted on this game, how many
        -- picked the entity that actually won (Mohamed 2026-08-19: "under
        -- Votes, 2nd line = % of good vote"). NULL (not 0) while the game
        -- has no winner yet, so the frontend can render "—" instead of a
        -- misleading 0%.
        (SELECT COUNT(*)::int FROM game_votes gv3 WHERE gv3.game_id = g.id AND gv3.picked_entity_id = g.winner_entity_id) AS correct_votes
      FROM game_votes gv
      JOIN games g              ON g.id = gv.game_id
      JOIN entities picked      ON picked.id = gv.picked_entity_id
      LEFT JOIN entities home   ON home.id = g.home_entity_id
      LEFT JOIN entities away   ON away.id = g.away_entity_id
      JOIN result_tabs rt       ON rt.id = g.result_tab_id
      JOIN seasons s            ON s.id = rt.season_id
      JOIN competitions c       ON c.id = s.competition_id
      JOIN event_categories ec  ON ec.id = c.category_id
      JOIN sports sp            ON sp.id = ec.sport_id
      WHERE gv.user_id = $1 ${filterSql}
      ORDER BY gv.created_at DESC
    `, params);

    res.json({
      data: rows.map(r => ({
        id: r.id,
        voted_at: r.voted_at,
        picked_entity_id: r.picked_entity_id,
        picked_name: r.picked_name,
        home_name: r.home_name,
        away_name: r.away_name,
        match_date: r.match_date,
        round: r.round,
        year: r.year,
        // No start/end range on a single game (just one match_date) to run
        // the site's usual getStatus() through — decided (winner recorded)
        // beats a future match_date beats "already past its date, no
        // winner yet" (data still being ingested), same spirit as
        // getStatus's own liveOngoing carve-out elsewhere in this codebase.
        status: r.winner_entity_id != null
          ? 'past'
          : (r.match_date && new Date(r.match_date) > new Date() ? 'upcoming' : 'ongoing'),
        is_correct: r.winner_entity_id != null ? (r.winner_entity_id === r.picked_entity_id) : null,
        winner_name: r.winner_name,
        score: r.score,
        competition_name: r.competition_name,
        competition_slug: r.competition_slug,
        sport_name: r.sport_name,
        sport_slug: r.sport_slug,
        total_votes: r.total_votes,
        crowd_good_pct: r.winner_entity_id != null && r.total_votes > 0
          ? Math.round((r.correct_votes / r.total_votes) * 100)
          : null,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
