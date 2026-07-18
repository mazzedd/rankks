// Ingests the NBA Cup (Emirates NBA Cup) Final/Rounds/Groups for one season year, from the
// same TeamStatistics.csv ingest-nba-games.js/ingest-nba-standings.js already read.
//
// Distinct from ingest-nba-games.js: Cup group-stage and Quarterfinal/Semifinal games ALSO
// count as real regular season games (per NBA rules) and stay exactly where they already are
// — Regular Season > Results and the Regular Season standings computed by
// ingest-nba-standings.js. This script does not touch either; it ADDITIONALLY writes:
//   - Group stage -> aggregated into `standings` (group_name-tagged) under the
//     eastern/western-conference-groups tabs. No individual games shown there — the games
//     themselves are already viewable via Regular Season > Results, per the confirmed nav
//     design (NBA Cup > Groups shows standings only).
//   - Quarterfinal/Semifinal -> individual games under the 'rounds' tab (typology='game'),
//     round='Quarterfinal'/'Semifinal', both conferences merged onto one page (per spec:
//     "Round displays quarter and semi finals, 2 conferences in the same page"). These are
//     genuinely a SECOND row for the same real game (result_tab_id differs from the Results
//     tab's copy) — deliberate, since the game has two legitimate contexts, unlike Playoffs/
//     Finals games which are Cup-exclusive.
//   - Championship -> the single Final game under the 'final' tab. NOT a regular season game
//     (never appears in Results) — gameId[0] === '6' identifies it even in the 2023-24 and
//     2024-25 seasons where gameLabel/gameSubLabel are blank for this game specifically (only
//     2025-26 populates gameSubLabel='Championship'). Cross-checked against Wikipedia's
//     2023/2024/2025 NBA Cup articles — final scores and dates match exactly.
//
// Detection: gameLabel === 'Emirates NBA Cup' identifies Group/QF/SF rows (gameSubLabel
// non-empty: 'East/West Group A/B/C', 'East/West Quarterfinal', 'East/West Semifinal'). A
// single stray 2019-10-22 row carries the same label predating the Cup's 2023 launch —
// excluded by requiring seasonYearArg >= 2024 (the earliest real Cup season under our 'end'
// year_convention).
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { getSeasonYear } = require('./nba-season-year');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'TeamStatistics.csv');
const COMPETITION_ID = 4828;
const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg || seasonYearArg < 2024) {
  console.error('Usage: node ingest-nba-cup.js <seasonYear>  (NBA Cup started 2023-24 season, DB year 2024)');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

function numOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const BOX_SCORE_FIELDS = [
  'assists', 'blocks', 'steals', 'fieldGoalsAttempted', 'fieldGoalsMade', 'fieldGoalsPercentage',
  'threePointersAttempted', 'threePointersMade', 'threePointersPercentage',
  'freeThrowsAttempted', 'freeThrowsMade', 'freeThrowsPercentage',
  'reboundsDefensive', 'reboundsOffensive', 'reboundsTotal', 'reboundsTeam',
  'foulsPersonal', 'turnovers', 'turnoversTeam', 'plusMinusPoints',
  'q1Points', 'q2Points', 'q3Points', 'q4Points', 'ot1Points', 'ot2Points', 'otAllPoints',
  'benchPoints', 'biggestLead', 'biggestScoringRun', 'leadChanges',
  'pointsFastBreak', 'pointsFromTurnovers', 'pointsInThePaint', 'pointsSecondChance', 'timesTied',
];
function boxScoreStats(row) {
  const out = {};
  for (const f of BOX_SCORE_FIELDS) out[f] = numOrNull(row[f]);
  return out;
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });

  const teamRows = await pool.query(`SELECT id, external_ids->>'nba_team_id' AS nba_team_id FROM entities WHERE entity_type='club' AND external_ids ? 'nba_team_id'`);
  const teamMap = new Map(teamRows.rows.map(r => [r.nba_team_id, r.id]));

  // Preload this year's NBA Cup + Regular Season result_tabs.
  const tabRows = await pool.query(`
    SELECT rt.id, ev.slug AS event_slug, rt.tab_key
    FROM result_tabs rt
    JOIN seasons s ON s.id = rt.season_id
    JOIN events ev ON ev.id = s.event_id
    WHERE s.competition_id = $1 AND s.year = $2 AND ev.slug IN ('nba-cup-4828', 'regular-season-4828')
  `, [COMPETITION_ID, seasonYearArg]);
  const tabMap = new Map(tabRows.rows.map(r => [`${r.event_slug}|${r.tab_key}`, r.id]));
  const roundsTabId = tabMap.get('nba-cup-4828|rounds');
  const finalTabId = tabMap.get('nba-cup-4828|final');
  const eastGroupsTabId = tabMap.get('nba-cup-4828|eastern-conference-groups');
  const westGroupsTabId = tabMap.get('nba-cup-4828|western-conference-groups');
  if (!roundsTabId || !finalTabId || !eastGroupsTabId || !westGroupsTabId) {
    console.error(`Missing NBA Cup result_tabs for year ${seasonYearArg} — create seasons/result_tabs first.`);
    await pool.end();
    return;
  }

  // Group the 2 rows per gameId (home + away perspective), scoped to this season year and
  // to Cup rows only (label match, or gameId prefix '6' for the unlabeled Championship game).
  const games = new Map();
  for (const r of records) {
    if (r.teamId === '0' || !r.gameDateTimeEst) continue;
    const isLabeledCup = r.gameLabel === 'Emirates NBA Cup' && r.gameSubLabel;
    const isChampionship = r.gameId?.[0] === '6';
    if (!isLabeledCup && !isChampionship) continue;
    const year = getSeasonYear(r.gameDateTimeEst, CSV_PATH);
    if (year !== seasonYearArg) continue;

    if (!games.has(r.gameId)) games.set(r.gameId, {});
    const g = games.get(r.gameId);
    if (r.home === '1') g.home = r; else g.away = r;
  }

  const roundGames = [];   // Quarterfinal/Semifinal -> games table
  let championshipGame = null; // -> games table, single row
  const groupGames = [];   // Group stage -> aggregated into standings, not stored as games

  for (const [gameId, { home, away }] of games) {
    if (!home || !away) { console.warn('Incomplete pair for gameId', gameId); continue; }
    const homeEntityId = teamMap.get(home.teamId);
    const awayEntityId = teamMap.get(away.teamId);
    if (!homeEntityId || !awayEntityId) { console.warn('No entity for gameId', gameId); continue; }

    if (home.gameId[0] === '6') {
      championshipGame = { gameId, home, away, homeEntityId, awayEntityId };
      continue;
    }

    const subLabel = home.gameSubLabel; // e.g. 'East Group A', 'West Quarterfinal', 'East Semifinal'
    if (/Quarterfinal|Semifinal/.test(subLabel)) {
      roundGames.push({ gameId, home, away, homeEntityId, awayEntityId, round: subLabel.replace(/^(East|West) /, '') });
    } else if (/Group/.test(subLabel)) {
      const m = subLabel.match(/^(East|West) Group ([A-Z])$/);
      if (!m) { console.warn('Unrecognized group label', subLabel); continue; }
      groupGames.push({ home, away, homeEntityId, awayEntityId, conference: m[1], groupLetter: m[2] });
    } else {
      console.warn('Unrecognized Cup sub-label', subLabel, 'for gameId', gameId);
    }
  }

  // --- Rounds (Quarterfinal/Semifinal) -> games table -----------------------------------
  await pool.query(`DELETE FROM games WHERE result_tab_id = $1`, [roundsTabId]);
  let roundsInserted = 0;
  for (const g of roundGames) {
    const score = { home: numOrNull(g.home.teamScore), away: numOrNull(g.away.teamScore) };
    const stats = { home: boxScoreStats(g.home), away: boxScoreStats(g.away) };
    const homeWon = g.home.win === '1';
    await pool.query(
      `INSERT INTO games (
         result_tab_id, round, match_number, match_date,
         home_entity_id, away_entity_id, home_entity_type, away_entity_type,
         score, winner_entity_id, home_won, duration_minutes, stats
       ) VALUES ($1,$2,$3,$4,$5,$6,'club','club',$7::jsonb,$8,$9,$10,$11::jsonb)`,
      [roundsTabId, g.round, g.gameId, g.home.gameDateTimeEst.slice(0, 10),
       g.homeEntityId, g.awayEntityId, JSON.stringify(score),
       homeWon ? g.homeEntityId : g.awayEntityId, homeWon, numOrNull(g.home.numMinutes), JSON.stringify(stats)]
    );
    roundsInserted++;
  }
  console.log(`Rounds: ${roundsInserted} games inserted (Quarterfinal/Semifinal, both conferences)`);

  // --- Championship -> games table (single game) ------------------------------------------
  await pool.query(`DELETE FROM games WHERE result_tab_id = $1`, [finalTabId]);
  if (championshipGame) {
    const g = championshipGame;
    const score = { home: numOrNull(g.home.teamScore), away: numOrNull(g.away.teamScore) };
    const stats = { home: boxScoreStats(g.home), away: boxScoreStats(g.away) };
    const homeWon = g.home.win === '1';
    await pool.query(
      `INSERT INTO games (
         result_tab_id, round, match_number, match_date,
         home_entity_id, away_entity_id, home_entity_type, away_entity_type,
         score, winner_entity_id, home_won, duration_minutes, stats
       ) VALUES ($1,'Final',$2,$3,$4,$5,'club','club',$6::jsonb,$7,$8,$9,$10::jsonb)`,
      [finalTabId, g.gameId, g.home.gameDateTimeEst.slice(0, 10),
       g.homeEntityId, g.awayEntityId, JSON.stringify(score),
       homeWon ? g.homeEntityId : g.awayEntityId, homeWon, numOrNull(g.home.numMinutes), JSON.stringify(stats)]
    );
    console.log(`Final: 1 game inserted (${g.home.teamName} ${score.home} - ${score.away} ${g.away.teamName})`);
  } else {
    console.log(`Final: no Championship game found for ${seasonYearArg} (season may still be in progress)`);
  }

  // --- Group stage -> standings (aggregated, group_name-tagged) ---------------------------
  // Position ranked by W then point differential, matching the tiebreak order the NBA's own
  // group tables use (head-to-head/PD/total points/prior-season record/draw) — PD is the
  // only one of those computable from aggregate box scores alone, and is what the Wikipedia
  // group tables display and sort by for any teams tied on W-L.
  const perTeam = new Map(); // `${conference}|${groupLetter}|${entityId}` -> summary
  for (const g of groupGames) {
    for (const side of ['home', 'away']) {
      const row = g[side];
      const entityId = side === 'home' ? g.homeEntityId : g.awayEntityId;
      const key = `${g.conference}|${g.groupLetter}|${entityId}`;
      if (!perTeam.has(key)) {
        perTeam.set(key, {
          conference: g.conference, groupLetter: g.groupLetter, entityId,
          w: 0, l: 0, pf: 0, pa: 0, homeW: 0, homeL: 0, awayW: 0, awayL: 0,
        });
      }
      const t = perTeam.get(key);
      const won = row.win === '1';
      const pf = numOrNull(row.teamScore) || 0;
      const pa = numOrNull(row === g.home ? g.away.teamScore : g.home.teamScore) || 0;
      if (won) t.w++; else t.l++;
      t.pf += pf; t.pa += pa;
      if (side === 'home') { if (won) t.homeW++; else t.homeL++; }
      else { if (won) t.awayW++; else t.awayL++; }
    }
  }

  const groupTabForConf = { East: eastGroupsTabId, West: westGroupsTabId };
  await pool.query(`DELETE FROM standings WHERE result_tab_id = ANY($1)`, [[eastGroupsTabId, westGroupsTabId]]);

  const byConfGroup = new Map(); // `${conference}|${groupLetter}` -> [summary,...]
  for (const t of perTeam.values()) {
    const key = `${t.conference}|${t.groupLetter}`;
    if (!byConfGroup.has(key)) byConfGroup.set(key, []);
    byConfGroup.get(key).push(t);
  }

  let groupsInserted = 0;
  for (const [key, teams] of byConfGroup) {
    const [conference, groupLetter] = key.split('|');
    teams.sort((a, b) => b.w - a.w || (b.pf - b.pa) - (a.pf - a.pa));
    const leader = teams[0];
    let position = 1;
    for (const t of teams) {
      const gb = ((leader.w - t.w) + (t.l - leader.l)) / 2;
      const stats = {
        w: t.w, l: t.l, pct: Number((t.w / (t.w + t.l)).toFixed(3)),
        gb: Number(gb.toFixed(1)),
        home: `${t.homeW}-${t.homeL}`, away: `${t.awayW}-${t.awayL}`,
        pf: t.pf, pa: t.pa, pd: t.pf - t.pa,
      };
      await pool.query(
        `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, group_name, stats)
         VALUES ($1,$2,$3,'club',$4,$5::jsonb)`,
        [groupTabForConf[conference], position, t.entityId, `Group ${groupLetter}`, JSON.stringify(stats)]
      );
      position++;
      groupsInserted++;
    }
  }
  console.log(`Groups: ${groupsInserted} standings rows written across ${byConfGroup.size} groups`);

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
