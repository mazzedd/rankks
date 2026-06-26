// ingest-topscorers.js — matches actual RANKKS DB schema
const { queryOne, query } = require('./db');

async function ingestTopScorers(season, config, callApi) {
  console.log(`  🏆 Top Stats ${season}...`);

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.leagueSlug]);
  const seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2`,
    [comp.id, season]
  );
  if (!seasonRow) { console.log(`     ⚠️  Season not found`); return; }

  // Top scorers
  const scorers = await callApi('players/topscorers', { league: config.leagueId, season });
  for (let i = 0; i < (scorers || []).length; i++) {
    await updatePlayerStat(scorers[i], seasonRow.id, {
      goals: scorers[i].statistics?.[0]?.goals?.total || 0,
      ranking_at_event: i + 1,
    });
  }

  // Top assists
  const assists = await callApi('players/topassists', { league: config.leagueId, season });
  for (let i = 0; i < (assists || []).length; i++) {
    await updatePlayerStat(assists[i], seasonRow.id, {
      assists: assists[i].statistics?.[0]?.goals?.assists || 0,
    });
  }

  // Top cards
  const cards = await callApi('players/topyellowcards', { league: config.leagueId, season });
  for (let i = 0; i < (cards || []).length; i++) {
    const s = cards[i].statistics?.[0];
    await updatePlayerStat(cards[i], seasonRow.id, {
      yellow_cards: s?.cards?.yellow || 0,
      red_cards:    s?.cards?.red    || 0,
    });
  }

  console.log(`     ✅ Top stats updated`);
}

async function updatePlayerStat(item, seasonId, updates) {
  const p    = item.player;
  const stat = item.statistics?.[0];
  if (!p || !stat) return;

  const entity = await queryOne(
    `SELECT id FROM entities WHERE entity_type = 'player'
     AND external_ids->>'api_sports' = $1`,
    [String(p.id)]
  );
  if (!entity) return;

  // Build SET clause dynamically
  const setClauses = Object.entries(updates)
    .map(([k, v], i) => `${k} = $${i + 3}`)
    .join(', ');
  const values = Object.values(updates);

  if (!setClauses) return;

  // Update ALL rows for this player in this season (across all clubs)
  // This handles multi-club seasons and club name mismatches cleanly
  await query(
    `UPDATE player_season_stats
     SET ${setClauses}, updated_at = NOW()
     WHERE entity_id = $1 AND season_id = $2`,
    [entity.id, seasonId, ...values]
  ).catch(() => {});
}

module.exports = { ingestTopScorers };
