// ingest-fixtures.js — matches actual RANKKS DB schema
const { queryOne, query } = require('./db');

async function ingestFixtures(season, config, callApi) {
  console.log(`  ⚽ Fixtures ${season}...`);

  const data = await callApi('fixtures', { league: config.leagueId, season });
  if (!data?.length) { console.log(`     ⚠️  No fixtures`); return; }

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.leagueSlug]);
  const seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2`,
    [comp.id, season]
  );
  if (!seasonRow) throw new Error(`Season ${season} not found`);

  // Get or create game result_tab
  let tab = await queryOne(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = 'final_tour'`,
    [seasonRow.id]
  );
  if (!tab) {
    tab = await queryOne(
      `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
       VALUES ($1, 'Final Tour', 'final_tour', 'game', 2, false) RETURNING id`,
      [seasonRow.id]
    );
  }

  let inserted = 0, updated = 0, skipped = 0;

  for (const item of data) {
    const f      = item.fixture;
    const teams  = item.teams;
    const goals  = item.goals;
    const score  = item.score;
    const league = item.league;

    const homeEntity = await findClub(teams.home.name);
    const awayEntity = await findClub(teams.away.name);

    if (!homeEntity || !awayEntity) {
      skipped++;
      continue;
    }

    const scoreJson = {
      home:      goals.home,
      away:      goals.away,
      halftime:  { home: score.halftime?.home,  away: score.halftime?.away },
      fulltime:  { home: score.fulltime?.home,   away: score.fulltime?.away },
      extratime: score.extratime?.home != null
        ? { home: score.extratime.home, away: score.extratime.away } : null,
      penalty:   score.penalty?.home != null
        ? { home: score.penalty.home,   away: score.penalty.away } : null,
      status: f.status?.short,
    };

    // Determine winner
    let winnerId = null, homeWon = null;
    const finished = ['FT','AET','PEN'].includes(f.status?.short);
    if (finished && goals.home !== null && goals.away !== null) {
      if (goals.home > goals.away)       { winnerId = homeEntity.id; homeWon = true; }
      else if (goals.away > goals.home)  { winnerId = awayEntity.id; homeWon = false; }
      else if (score.penalty?.home != null) {
        if (score.penalty.home > score.penalty.away) { winnerId = homeEntity.id; homeWon = true; }
        else { winnerId = awayEntity.id; homeWon = false; }
      }
    }

    const scorers = (item.events || [])
      .filter(e => e.type === 'Goal')
      .map(e => ({
        player: e.player?.name, team: e.team?.name,
        minute: e.time?.elapsed, extra: e.time?.extra || null,
        detail: e.detail, assist: e.assist?.name || null,
      }));

    // Use API fixture ID stored in match_number for dedup
    const existing = await queryOne(
      `SELECT id FROM games WHERE result_tab_id = $1 AND match_number = $2`,
      [tab.id, f.id]
    );

    if (existing) {
      await query(
        `UPDATE games SET
           match_date = $1, venue = $2, venue_city = $3,
           score = $4, winner_entity_id = $5, home_won = $6,
           scorers = $7, updated_at = NOW()
         WHERE id = $8`,
        [
          f.date?.split('T')[0] || null,
          f.venue?.name || null, f.venue?.city || null,
          JSON.stringify(scoreJson), winnerId, homeWon,
          JSON.stringify(scorers), existing.id,
        ]
      );
      updated++;
    } else {
      await query(
        `INSERT INTO games (
           result_tab_id, round, match_number,
           match_date, venue, venue_city,
           home_entity_id, away_entity_id,
           home_entity_type, away_entity_type,
           score, winner_entity_id, home_won, scorers
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'club','club',$9,$10,$11,$12)`,
        [
          tab.id, league.round || null, f.id,
          f.date?.split('T')[0] || null,
          f.venue?.name || null, f.venue?.city || null,
          homeEntity.id, awayEntity.id,
          JSON.stringify(scoreJson), winnerId, homeWon,
          JSON.stringify(scorers),
        ]
      );
      inserted++;
    }
  }

  console.log(`     ✅ Fixtures: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
}

async function findClub(name) {
  return queryOne(
    `SELECT id FROM entities WHERE entity_type = 'club'
     AND canonical_name ILIKE $1`,
    [name]
  );
}

module.exports = { ingestFixtures };
