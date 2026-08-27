// Regular Season standings for one 1947-1955 BAA/NBA season year, computed from the
// games ingest-nba-historical-games.js just inserted (not re-parsed from the scrape) —
// same W/L/home-away/streak/last-10 computation as ingest-nba-standings.js's CSV-driven
// version, just sourced from `games` instead of TeamStatistics.csv so it reuses the exact
// per-game win/loss/home records already sitting in the DB rather than duplicating that
// logic against a second, less complete source (the scraped standings only carries final
// W/L/PCT, no home/away split or streak).
const { Pool } = require('pg');

const COMPETITION_ID = 4828;
const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) { console.error('Usage: node ingest-nba-historical-standings.js <seasonYear>'); process.exit(1); }

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

async function main() {
  const tabs = await pool.query(`
    SELECT rt.id, rt.tab_key FROM result_tabs rt
    JOIN seasons s ON s.id = rt.season_id
    JOIN events ev ON ev.id = s.event_id
    WHERE s.competition_id = $1 AND s.year = $2 AND ev.name = 'Regular Season' AND rt.tab_key IN ('results', 'standings')
  `, [COMPETITION_ID, seasonYearArg]);
  const resultsTabId = tabs.rows.find(r => r.tab_key === 'results')?.id;
  const standingsTabId = tabs.rows.find(r => r.tab_key === 'standings')?.id;
  if (!resultsTabId || !standingsTabId) {
    console.error(`Missing Regular Season results/standings tab for ${seasonYearArg} — run ingest-nba-historical-games.js first.`);
    await pool.end();
    return;
  }

  const gameRows = await pool.query(`
    SELECT match_date, home_entity_id, away_entity_id, home_won
    FROM games WHERE result_tab_id = $1 ORDER BY match_date
  `, [resultsTabId]);
  if (!gameRows.rows.length) {
    console.log(`No games found for ${seasonYearArg} Results tab`);
    await pool.end();
    return;
  }

  // entityId -> chronological array of { win, home }
  const teamGames = new Map();
  for (const g of gameRows.rows) {
    for (const [entityId, isHome, win] of [
      [g.home_entity_id, true, g.home_won],
      [g.away_entity_id, false, !g.home_won],
    ]) {
      if (!teamGames.has(entityId)) teamGames.set(entityId, []);
      teamGames.get(entityId).push({ date: g.match_date, win, home: isHome });
    }
  }

  const summaries = [];
  for (const [entityId, games] of teamGames) {
    games.sort((a, b) => new Date(a.date) - new Date(b.date));
    const w = games.filter(g => g.win).length;
    const l = games.length - w;
    const homeGames = games.filter(g => g.home);
    const awayGames = games.filter(g => !g.home);
    const homeW = homeGames.filter(g => g.win).length;
    const awayW = awayGames.filter(g => g.win).length;

    let streakType = null, streakCount = 0;
    for (let i = games.length - 1; i >= 0; i--) {
      const result = games[i].win ? 'W' : 'L';
      if (streakType === null) { streakType = result; streakCount = 1; }
      else if (result === streakType) streakCount++;
      else break;
    }

    const last10 = games.slice(-10);
    const last10W = last10.filter(g => g.win).length;

    summaries.push({
      entityId, w, l, pct: w / (w + l),
      homeW, homeL: homeGames.length - homeW,
      awayW, awayL: awayGames.length - awayW,
      streak: `${streakType}${streakCount}`,
      last10W, last10L: 10 - last10W,
    });
  }

  summaries.sort((a, b) => b.pct - a.pct || b.w - a.w);
  const leader = summaries[0];

  await pool.query('DELETE FROM standings WHERE result_tab_id = $1', [standingsTabId]);

  let position = 1;
  for (const s of summaries) {
    const gb = ((leader.w - s.w) + (s.l - leader.l)) / 2;
    const stats = {
      w: s.w, l: s.l, pct: Number(s.pct.toFixed(3)),
      gb: Number(gb.toFixed(1)),
      home: `${s.homeW}-${s.homeL}`, away: `${s.awayW}-${s.awayL}`,
      streak: s.streak, last10: `${s.last10W}-${s.last10L}`,
    };
    await pool.query(
      `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats) VALUES ($1,$2,$3,'club',$4::jsonb)`,
      [standingsTabId, position, s.entityId, JSON.stringify(stats)]
    );
    position++;
  }

  console.log(`Season ${seasonYearArg}: ${position - 1} standings rows written to result_tab ${standingsTabId}`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
