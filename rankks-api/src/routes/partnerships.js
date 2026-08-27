const express = require('express');
const router  = express.Router();
const { queryAll } = require('../db');

// GET /api/partnerships
// Full listing across every brand, for the public "Official Partnerships"
// page — filtering/counting happens client-side (same pattern as the tennis
// schedule page), so this returns everything in one shot rather than taking
// filter query params.
router.get('/', async (req, res, next) => {
  try {
    const rows = await queryAll(`
      WITH base AS (
        SELECT
          ps.id, ps.name, ps.subcategory, ps.subject_type, ps.start_year, ps.end_year,
          ps.value_amount, ps.value_currency, ps.displayed_in_name,
          e.entity_type AS subject_entity_type, e.gender AS subject_gender,
          p.id AS partner_id, p.name AS partner_name, p.logo_url AS partner_logo_url,
          pt.name AS tier_name, pt.slug AS tier_slug,
          pc.name AS category_name, pc.slug AS category_slug,
          co.name AS partner_country_name, co.iso2 AS partner_country_iso2,
          COALESCE(en.display_name, e.canonical_name, comp.name, f1r.name, motor.name) AS subject_name,
          CASE
            WHEN ps.subject_type = 'race' AND ps.race_sport = 'f1'     THEN 4
            WHEN ps.subject_type = 'race' AND ps.race_sport = 'motogp' THEN 5
            WHEN ps.subject_type = 'competition' THEN s_comp.id
            WHEN e.entity_type = 'f1_team'     THEN 4
            WHEN e.entity_type = 'motogp_team' THEN 5
            WHEN e.entity_type = 'tour'        THEN 2
            ELSE COALESCE(club_sport.sport_id, athlete_sport.sport_id)
          END AS sport_id
        FROM partnerships ps
        JOIN partners p ON p.id = ps.partner_id
        JOIN partnership_tiers pt ON pt.id = ps.tier_id
        LEFT JOIN partner_categories pc ON pc.id = p.category_id
        LEFT JOIN countries co ON co.id = p.country_id
        LEFT JOIN entities e ON e.id = ps.entity_id
        LEFT JOIN entity_names en ON en.entity_id = e.id AND en.end_year IS NULL
        LEFT JOIN competitions comp ON comp.id = ps.competition_id
        LEFT JOIN event_categories ec_comp ON ec_comp.id = comp.category_id
        LEFT JOIN sports s_comp ON s_comp.id = ec_comp.sport_id
        LEFT JOIN LATERAL (
          SELECT s.id AS sport_id
          FROM club_competitions cc
          JOIN competitions co2 ON co2.id = cc.competition_id
          JOIN event_categories ec2 ON ec2.id = co2.category_id
          JOIN sports s ON s.id = ec2.sport_id
          WHERE cc.club_id = e.id
          ORDER BY cc.season_year DESC NULLS LAST
          LIMIT 1
        ) club_sport ON ps.subject_type = 'entity' AND e.entity_type NOT IN ('f1_team', 'motogp_team', 'tour')
        LEFT JOIN LATERAL (
          SELECT s.id AS sport_id
          FROM games g
          JOIN result_tabs rt ON rt.id = g.result_tab_id
          JOIN seasons se ON se.id = rt.season_id
          JOIN competitions co3 ON co3.id = se.competition_id
          JOIN event_categories ec3 ON ec3.id = co3.category_id
          JOIN sports s ON s.id = ec3.sport_id
          WHERE g.home_entity_id = e.id OR g.away_entity_id = e.id
          ORDER BY g.match_date DESC NULLS LAST
          LIMIT 1
        ) athlete_sport ON ps.subject_type = 'entity' AND e.entity_type IN ('player', 'driver', 'fighter', 'national_team')
        LEFT JOIN LATERAL (
          SELECT name FROM f1_grands_prix WHERE slug = ps.race_gp_slug ORDER BY event_date DESC LIMIT 1
        ) f1r ON ps.subject_type = 'race' AND ps.race_sport = 'f1'
        LEFT JOIN LATERAL (
          SELECT name FROM motogp_grands_prix WHERE slug = ps.race_gp_slug ORDER BY event_date_start DESC LIMIT 1
        ) motor ON ps.subject_type = 'race' AND ps.race_sport = 'motogp'
      )
      SELECT base.*, sp.name AS sport_name, sp.slug AS sport_slug
      FROM base
      LEFT JOIN sports sp ON sp.id = base.sport_id
      ORDER BY base.partner_name
    `);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
