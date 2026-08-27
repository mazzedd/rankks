require('dotenv').config();
const { queryAll, queryOne } = require('./src/db');

const TENNIS_SPORT_ID = 2;
const fedId = 8151;

async function firstTitle(entityId, slugs) {
  return queryOne(`
    SELECT g.match_date, c.name AS competition_name, se.year
    FROM games g
    JOIN result_tabs rt ON rt.id = g.result_tab_id
    JOIN seasons se ON se.id = rt.season_id
    JOIN competitions c ON c.id = se.competition_id
    JOIN event_categories ec ON ec.id = c.category_id
    WHERE ec.sport_id = $1 AND rt.tab_key LIKE 'draw-singles%'
      AND g.round ILIKE '%final%' AND g.round NOT ILIKE '%semi%' AND g.round NOT ILIKE '%quarter%'
      AND g.winner_entity_id = $2 AND ec.slug = ANY($3::text[])
    ORDER BY g.match_date ASC NULLS LAST
    LIMIT 1
  `, [TENNIS_SPORT_ID, entityId, slugs]);
}

async function firstNo1(entityId) {
  return queryOne(`
    WITH my_ranks AS (
      SELECT g.match_date,
        (CASE WHEN g.winner_entity_id = $2 THEN g.stats->>'w_rank' ELSE g.stats->>'l_rank' END) AS rnk_txt
      FROM games g
      JOIN result_tabs rt ON rt.id = g.result_tab_id
      JOIN seasons se ON se.id = rt.season_id
      JOIN competitions c ON c.id = se.competition_id
      JOIN event_categories ec ON ec.id = c.category_id
      WHERE ec.sport_id = $1 AND rt.tab_key LIKE 'draw-singles%'
        AND (g.home_entity_id = $2 OR g.away_entity_id = $2)
    )
    SELECT match_date FROM my_ranks WHERE rnk_txt = '1' ORDER BY match_date ASC NULLS LAST LIMIT 1
  `, [TENNIS_SPORT_ID, entityId]);
}

async function debutDate(entityId) {
  return queryOne(`
    SELECT MIN(g.match_date) AS d
    FROM games g
    JOIN result_tabs rt ON rt.id = g.result_tab_id
    WHERE rt.tab_key LIKE 'draw-singles%' AND (g.home_entity_id = $1 OR g.away_entity_id = $1)
  `, [entityId]);
}

(async () => {
  console.log('debut', await debutDate(fedId));
  console.log('first no1', await firstNo1(fedId));
  console.log('first grand slam', await firstTitle(fedId, ['grand-slam']));
  console.log('first masters 1000', await firstTitle(fedId, ['atp-masters-1000']));
  console.log('birth_date', (await queryOne('SELECT birth_date FROM entities WHERE id=$1', [fedId])).birth_date);
})().catch(console.error);
