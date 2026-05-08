// ─────────────────────────────────────────────────────────────────────────────
// GET /results/tennis-players
// Query params: seasonId, gender (M|F), search, filters (gs,m1000,atp500,atp250), page, limit
//
// Rules:
//  1. WHO        — players who appeared in ≥1 match in this seasonId
//  2. RANK       — their best (lowest) ranking within this season's matches
//  3. CAREER STATS — finals reached/won in events whose start_date < this event's start_date
//  4. AGE        — calculated at event start_date, not today
//  5. FILTERS    — cumulative: player must have ≥1 final in each selected category (career up to cutoff)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/tennis-players', async (req, res) => {
  try {
    const {
      seasonId,
      gender  = 'M',
      search  = '',
      filters = '',
      page    = 1,
      limit   = 50,
    } = req.query;

    if (!seasonId) return res.status(400).json({ error: 'seasonId is required' });

    const offset        = (parseInt(page) - 1) * parseInt(limit);
    const activeFilters = filters ? filters.split(',').filter(Boolean) : [];
    const genderFilter  = gender === 'M' ? 'M' : 'F';

    // Category IDs
    const gsCategories    = [11];
    const m1000Categories = gender === 'M' ? [12] : [13];
    const a500Categories  = gender === 'M' ? [14] : [15];
    const a250Categories  = gender === 'M' ? [16] : [17];

    // ── Get event cutoff date ──────────────────────────────────────────────
    // Use the season's start_date if available, otherwise MIN(match_date) in that season
    const cutoffRow = await pool.query(`
      SELECT
        COALESCE(
          s.start_date,
          (SELECT MIN(g.match_date)
           FROM games g
           JOIN events ev ON g.event_id = ev.id
           WHERE ev.season_id = $1)
        ) AS cutoff_date
      FROM seasons s
      WHERE s.id = $1
    `, [seasonId]);

    const cutoffDate = cutoffRow.rows[0]?.cutoff_date;
    if (!cutoffDate) return res.status(404).json({ error: 'Season not found or has no matches' });

    // ── Filter clauses (applied in WHERE after career_stats CTE) ──────────
    const filterClauses = [];
    if (activeFilters.includes('gs'))     filterClauses.push('COALESCE(a.gs_finals, 0) > 0');
    if (activeFilters.includes('m1000'))  filterClauses.push('COALESCE(a.m1000_finals, 0) > 0');
    if (activeFilters.includes('atp500')) filterClauses.push('COALESCE(a.atp500_finals, 0) > 0');
    if (activeFilters.includes('atp250')) filterClauses.push('COALESCE(a.atp250_finals, 0) > 0');
    const filterWhere = filterClauses.length ? 'AND ' + filterClauses.join('\n          AND ') : '';

    // ── Parameters ────────────────────────────────────────────────────────
    // Fixed positions (no search):   $1=seasonId $2=cutoff $3=gs $4=m1000 $5=a500 $6=a250 $7=gender
    // With search adds $8=searchTerm (reuse $8 to keep numbering simple)
    const hasSearch  = search.trim().length > 0;
    const searchTerm = hasSearch ? `%${search.trim()}%` : null;

    // Build final param array
    const params = [
      seasonId,        // $1
      cutoffDate,      // $2
      gsCategories,    // $3
      m1000Categories, // $4
      a500Categories,  // $5
      a250Categories,  // $6
      genderFilter,    // $7
    ];
    if (hasSearch) params.push(searchTerm); // $8

    const searchWhere = hasSearch
      ? `AND (e.firstname ILIKE $8 OR e.canonical_name ILIKE $8)`
      : '';

    // ── Main SQL ──────────────────────────────────────────────────────────
    const sql = `
      WITH

      -- 1. Players who played in this season (any round)
      season_players AS (
        SELECT DISTINCT g.winner_entity_id AS entity_id
        FROM games g
        JOIN events ev ON g.event_id = ev.id
        WHERE ev.season_id = $1
          AND g.winner_entity_id IS NOT NULL

        UNION

        SELECT DISTINCT g.loser_entity_id
        FROM games g
        JOIN events ev ON g.event_id = ev.id
        WHERE ev.season_id = $1
          AND g.loser_entity_id IS NOT NULL
      ),

      -- 2. Their best ranking within this season's matches
      season_ranks AS (
        SELECT entity_id, MIN(rank_val)::int AS event_rank
        FROM (
          SELECT g.winner_entity_id AS entity_id,
                 (g.stats->>'w_rank')::int AS rank_val
          FROM games g
          JOIN events ev ON g.event_id = ev.id
          WHERE ev.season_id = $1
            AND (g.stats->>'w_rank') ~ '^[0-9]+$'

          UNION ALL

          SELECT g.loser_entity_id,
                 (g.stats->>'l_rank')::int
          FROM games g
          JOIN events ev ON g.event_id = ev.id
          WHERE ev.season_id = $1
            AND (g.stats->>'l_rank') ~ '^[0-9]+$'
        ) ranked
        GROUP BY entity_id
      ),

      -- 3. All Finals in events that started BEFORE this event's cutoff date
      --    (career stats up to but not including this event)
      career_finals AS (
        SELECT
          g.winner_entity_id   AS winner_id,
          g.loser_entity_id    AS loser_id,
          ev.event_category_id,
          g.event_id::text     AS final_key
        FROM games g
        JOIN events ev ON g.event_id = ev.id
        JOIN seasons s  ON ev.season_id = s.id
        WHERE g.round = 'Final'
          AND s.gender = $7
          AND COALESCE(
                s.start_date,
                (SELECT MIN(g2.match_date)
                 FROM games g2
                 JOIN events ev2 ON g2.event_id = ev2.id
                 WHERE ev2.season_id = s.id)
              ) < $2
      ),

      -- 4. Expand: one row per finalist (winner + runner-up)
      player_finals AS (
        SELECT winner_id AS entity_id, event_category_id, final_key, TRUE  AS is_winner
        FROM career_finals
        UNION ALL
        SELECT loser_id,               event_category_id, final_key, FALSE AS is_winner
        FROM career_finals
      ),

      -- 5. Aggregate career stats per player
      career_stats AS (
        SELECT
          entity_id,
          -- Grand Slam
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($3) THEN final_key END)::int               AS gs_finals,
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($3) AND is_winner THEN final_key END)::int AS gs_wins,
          -- Masters 1000 / WTA 1000
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($4) THEN final_key END)::int               AS m1000_finals,
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($4) AND is_winner THEN final_key END)::int AS m1000_wins,
          -- ATP 500 / WTA 500
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($5) THEN final_key END)::int               AS atp500_finals,
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($5) AND is_winner THEN final_key END)::int AS atp500_wins,
          -- ATP 250 / WTA 250
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($6) THEN final_key END)::int               AS atp250_finals,
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($6) AND is_winner THEN final_key END)::int AS atp250_wins,
          -- Total wins (all categories combined)
          COUNT(DISTINCT CASE WHEN is_winner THEN final_key END)::int                                  AS total_wins
        FROM player_finals
        GROUP BY entity_id
      )

      -- 6. Final SELECT
      SELECT
        e.id                  AS entity_id,
        e.slug,
        e.firstname,
        e.canonical_name      AS lastname,
        e.iso2                AS country_iso2,
        e.birth_date,
        -- Age at the time of the event
        DATE_PART('year', AGE($2::date, e.birth_date::date))::int AS age_at_event,
        sr.event_rank,
        COALESCE(cs.gs_wins,      0) AS gs_wins,
        COALESCE(cs.gs_finals,    0) AS gs_finals,
        COALESCE(cs.m1000_wins,   0) AS m1000_wins,
        COALESCE(cs.m1000_finals, 0) AS m1000_finals,
        COALESCE(cs.atp500_wins,  0) AS atp500_wins,
        COALESCE(cs.atp500_finals,0) AS atp500_finals,
        COALESCE(cs.atp250_wins,  0) AS atp250_wins,
        COALESCE(cs.atp250_finals,0) AS atp250_finals,
        COALESCE(cs.total_wins,   0) AS total_wins
      FROM season_players sp
      JOIN entities e          ON e.id = sp.entity_id
      LEFT JOIN career_stats cs ON cs.entity_id = e.id
      LEFT JOIN season_ranks sr ON sr.entity_id = e.id
      WHERE e.entity_type = 'player'
        ${searchWhere}
        ${filterWhere}
      ORDER BY
        sr.event_rank   ASC  NULLS LAST,
        COALESCE(cs.gs_wins, 0) DESC,
        e.canonical_name ASC
      LIMIT  ${parseInt(limit)}
      OFFSET ${offset}
    `;

    // ── Count query (same CTEs, no ORDER/LIMIT) ───────────────────────────
    const countSql = `
      WITH
      season_players AS (
        SELECT DISTINCT g.winner_entity_id AS entity_id
        FROM games g JOIN events ev ON g.event_id = ev.id
        WHERE ev.season_id = $1 AND g.winner_entity_id IS NOT NULL
        UNION
        SELECT DISTINCT g.loser_entity_id
        FROM games g JOIN events ev ON g.event_id = ev.id
        WHERE ev.season_id = $1 AND g.loser_entity_id IS NOT NULL
      ),
      career_finals AS (
        SELECT g.winner_entity_id AS winner_id, g.loser_entity_id AS loser_id,
               ev.event_category_id, g.event_id::text AS final_key
        FROM games g
        JOIN events ev ON g.event_id = ev.id
        JOIN seasons s  ON ev.season_id = s.id
        WHERE g.round = 'Final'
          AND s.gender = $7
          AND COALESCE(s.start_date,
                (SELECT MIN(g2.match_date) FROM games g2
                 JOIN events ev2 ON g2.event_id = ev2.id WHERE ev2.season_id = s.id)
              ) < $2
      ),
      player_finals AS (
        SELECT winner_id AS entity_id, event_category_id, final_key, TRUE  AS is_winner FROM career_finals
        UNION ALL
        SELECT loser_id,               event_category_id, final_key, FALSE AS is_winner FROM career_finals
      ),
      career_stats AS (
        SELECT entity_id,
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($3) THEN final_key END)::int AS gs_finals,
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($4) THEN final_key END)::int AS m1000_finals,
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($5) THEN final_key END)::int AS atp500_finals,
          COUNT(DISTINCT CASE WHEN event_category_id = ANY($6) THEN final_key END)::int AS atp250_finals
        FROM player_finals GROUP BY entity_id
      )
      SELECT COUNT(*) AS total
      FROM season_players sp
      JOIN entities e          ON e.id = sp.entity_id
      LEFT JOIN career_stats cs ON cs.entity_id = e.id
      WHERE e.entity_type = 'player'
        ${searchWhere}
        ${filterWhere}
    `;

    const [playersResult, countResult] = await Promise.all([
      pool.query(sql, params),
      pool.query(countSql, params),
    ]);

    const players = playersResult.rows.map((p, idx) => ({
      rank:          offset + idx + 1,
      entity_id:     p.entity_id,
      slug:          p.slug,
      firstname:     p.firstname,
      lastname:      p.lastname,
      country_iso2:  p.country_iso2,
      birth_date:    p.birth_date,
      age_at_event:  p.age_at_event  != null ? parseInt(p.age_at_event) : null,
      event_rank:    p.event_rank    != null ? parseInt(p.event_rank)   : null,
      gs_wins:       parseInt(p.gs_wins)       || 0,
      gs_finals:     parseInt(p.gs_finals)     || 0,
      m1000_wins:    parseInt(p.m1000_wins)    || 0,
      m1000_finals:  parseInt(p.m1000_finals)  || 0,
      atp500_wins:   parseInt(p.atp500_wins)   || 0,
      atp500_finals: parseInt(p.atp500_finals) || 0,
      atp250_wins:   parseInt(p.atp250_wins)   || 0,
      atp250_finals: parseInt(p.atp250_finals) || 0,
      total_wins:    parseInt(p.total_wins)     || 0,
    }));

    res.json({
      players,
      total:   parseInt(countResult.rows[0]?.total) || 0,
      page:    parseInt(page),
      limit:   parseInt(limit),
      cutoff:  cutoffDate,  // useful for debugging / display
    });

  } catch (err) {
    console.error('[tennis-players]', err);
    res.status(500).json({ error: err.message });
  }
});
