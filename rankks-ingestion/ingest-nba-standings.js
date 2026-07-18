// Regular Season standings for one NBA season year, aggregated from TeamStatistics.csv.
// Per onboarding-nba.md Section 1, the table consolidates East+West into ONE ranked list
// (conference is an in-template filter, not a separate table) — so position/GB are
// computed league-wide, not conference-relative. Full NBA.com column set per Section 5:
// W/L/PCT/GB/Home/Away/Streak/Last 10.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { getSeasonYear, resolveGameType } = require('./nba-season-year');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'TeamStatistics.csv');
const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-standings.js <seasonYear>');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });

  // teamId -> chronological array of { date, win, home }
  const teamGames = new Map();
  for (const r of records) {
    if (r.teamId === '0' || !r.gameDateTimeEst) continue;
    if (resolveGameType(r.gameType, r.gameId) !== 'Regular Season') continue;
    const year = getSeasonYear(r.gameDateTimeEst, CSV_PATH);
    if (year !== seasonYearArg) continue;

    if (!teamGames.has(r.teamId)) teamGames.set(r.teamId, []);
    teamGames.get(r.teamId).push({
      date: r.gameDateTimeEst,
      win: r.win === '1',
      home: r.home === '1',
    });
  }

  if (!teamGames.size) {
    console.log(`No Regular Season games found for ${seasonYearArg}`);
    await pool.end();
    return;
  }

  const teamRows = await pool.query(`SELECT id, external_ids->>'nba_team_id' AS nba_team_id FROM entities WHERE entity_type='club' AND external_ids ? 'nba_team_id'`);
  const teamMap = new Map(teamRows.rows.map(r => [r.nba_team_id, r.id]));

  const summaries = [];
  for (const [teamId, games] of teamGames) {
    games.sort((a, b) => new Date(a.date) - new Date(b.date));
    const w = games.filter(g => g.win).length;
    const l = games.length - w;
    const homeGames = games.filter(g => g.home);
    const awayGames = games.filter(g => !g.home);
    const homeW = homeGames.filter(g => g.win).length;
    const awayW = awayGames.filter(g => g.win).length;

    // Streak: trailing run of identical results, most recent game first
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
      teamId,
      entityId: teamMap.get(teamId),
      w, l,
      pct: w / (w + l),
      homeW, homeL: homeGames.length - homeW,
      awayW, awayL: awayGames.length - awayW,
      streak: `${streakType}${streakCount}`,
      last10W, last10L: 10 - last10W,
    });
  }

  summaries.sort((a, b) => b.pct - a.pct || b.w - a.w);
  const leader = summaries[0];

  // Look up (or create) the Regular Season result_tab for this year
  const tab = await pool.query(`
    SELECT rt.id FROM result_tabs rt
    JOIN seasons s ON s.id = rt.season_id
    JOIN events ev ON ev.id = s.event_id
    WHERE s.competition_id = 4828 AND s.year = $1 AND ev.name = 'Regular Season' AND rt.tab_key = 'standings'
  `, [seasonYearArg]);
  if (!tab.rows.length) {
    console.error(`No Regular Season standings tab found for ${seasonYearArg} — create seasons/result_tabs first.`);
    await pool.end();
    return;
  }
  const resultTabId = tab.rows[0].id;

  await pool.query('DELETE FROM standings WHERE result_tab_id = $1', [resultTabId]);

  let position = 1;
  for (const s of summaries) {
    if (!s.entityId) { console.warn('No entity for teamId', s.teamId); continue; }
    const gb = ((leader.w - s.w) + (s.l - leader.l)) / 2;
    const stats = {
      w: s.w, l: s.l, pct: Number(s.pct.toFixed(3)),
      gb: Number(gb.toFixed(1)),
      home: `${s.homeW}-${s.homeL}`, away: `${s.awayW}-${s.awayL}`,
      streak: s.streak, last10: `${s.last10W}-${s.last10L}`,
    };
    await pool.query(
      `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats) VALUES ($1,$2,$3,'club',$4::jsonb)`,
      [resultTabId, position, s.entityId, JSON.stringify(stats)]
    );
    position++;
  }

  console.log(`Season ${seasonYearArg}: ${position - 1} standings rows written to result_tab ${resultTabId}`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
