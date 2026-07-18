// Ingests NBA Regular Season/Playoffs/Play-in/Finals games from TeamStatistics.csv for one
// season year. Regular Season routes to its own "Results" tab (typology='game',
// tab_key='results') alongside the Standings tab from ingest-nba-standings.js — per the
// confirmed BASK-NAV-01 nav spec, Regular Season's Line B is Standings/Results/Players/Teams,
// not Standings alone.
//
// Routing (per onboarding-nba.md Section 8 discussion): each playoff round is its own
// `round` value within a single per-conference result_tab (not a separate result_tab per
// round, unlike UCL's tab_group='final_tour' pattern) — Conf. Finals and the NBA Finals
// route to the separate "Finals" event instead, each as a single-round tab with no
// round-expand needed.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { getSeasonYear, resolveGameType } = require('./nba-season-year');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'TeamStatistics.csv');
const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-games.js <seasonYear>');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// 2021-22 season: gameLabel (and gameSubLabel/seriesGameNumber/seed) is
// blank for every Playoffs/Finals row, same class of gap as the blank
// gameType elsewhere that season — but gameId's structure still encodes
// the round: for a Playoffs-type id ("4" + 2-digit season code + round
// digit + series-slot + game-number), character index 5 is the round
// number (verified against every other season where gameLabel IS
// populated: 1=First Round, 2=Conf. Semifinals, 3=Conf. Finals, 4=NBA
// Finals — confirmed against 2022's real bracket teams/dates directly).
// Conference for rounds 1-3 comes from the home team's own conference
// (teamConferenceMap, already built for the Play-in fallback above) since
// there's no label text to read it from.
function deriveRoundFromGameId(gameId) {
  const roundDigit = gameId?.[5];
  return { '1': 'First Round', '2': 'Conf. Semifinals', '3': 'Conf. Finals', '4': 'NBA Finals' }[roundDigit] || null;
}

function routeGame(gameType, gameLabel) {
  if (gameType === 'Regular Season') {
    return { event: 'Regular Season', tabKey: 'results', round: null };
  }
  if (gameType === 'Play-in Tournament') {
    return { event: 'Play-in', tabKey: null, round: 'Play-In' }; // tabKey resolved per-row via gameSubLabel (East/West)
  }
  // 2016-2023 label this "East - Conf. Finals" (hyphen separator); 2024+
  // dropped the hyphen ("East Conf. Finals"). Normalizing here means every
  // check below works identically regardless of source era — without it,
  // hyphenated Conf Finals games silently fell through to the generic
  // startsWith('East ')/('West ') branch and got misfiled as an extra
  // Playoffs round instead of routing to the dedicated Finals tabs.
  gameLabel = (gameLabel || '').replace(/ - /g, ' ');
  if (gameLabel === 'NBA Finals') return { event: 'Finals', tabKey: 'nba-finals', round: 'NBA Finals' };
  if (gameLabel === 'East Conf. Finals') return { event: 'Finals', tabKey: 'eastern-finals', round: 'East Conf. Finals' };
  if (gameLabel === 'West Conf. Finals') return { event: 'Finals', tabKey: 'western-finals', round: 'West Conf. Finals' };
  if (gameLabel.startsWith('East ')) return { event: 'Playoffs', tabKey: 'eastern-conference', round: gameLabel.replace(/^East /, '') };
  if (gameLabel.startsWith('West ')) return { event: 'Playoffs', tabKey: 'western-conference', round: gameLabel.replace(/^West /, '') };
  return null;
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

function numOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function boxScoreStats(row) {
  const out = {};
  for (const f of BOX_SCORE_FIELDS) out[f] = numOrNull(row[f]);
  return out;
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });

  // Preload team entity map: nba_team_id -> entity_id, and each team's
  // conference (used below as a Play-in routing fallback).
  const teamRows = await pool.query(`SELECT id, external_ids->>'nba_team_id' AS nba_team_id, sport_attributes->>'conference' AS conference FROM entities WHERE entity_type='club' AND external_ids ? 'nba_team_id'`);
  const teamMap = new Map(teamRows.rows.map(r => [r.nba_team_id, r.id]));
  // 2020-2024's Play-in rows have a blank gameSubLabel (only 2025+ populates
  // 'East'/'West'), which silently misfiled every one of those games as
  // "western-conference" (the ternary's default branch when gameSubLabel
  // doesn't match 'East'). Fall back to the home team's own conference
  // (already tracked for standings) when gameSubLabel is blank.
  const teamConferenceMap = new Map(teamRows.rows.map(r => [r.nba_team_id, r.conference]));

  // Preload result_tabs for this season year, keyed by "event|tabKey"
  const tabRows = await pool.query(`
    SELECT rt.id, ev.name AS event_name, rt.tab_key
    FROM result_tabs rt
    JOIN seasons s ON s.id = rt.season_id
    JOIN events ev ON ev.id = s.event_id
    WHERE s.competition_id = 4828 AND s.year = $1
  `, [seasonYearArg]);
  const tabMap = new Map(tabRows.rows.map(r => [`${r.event_name}|${r.tab_key}`, r.id]));

  // Group the 2 rows per gameId (home + away perspective)
  const games = new Map(); // gameId -> { home: row, away: row }
  for (const r of records) {
    if (r.teamId === '0' || !r.gameDateTimeEst) continue;
    r.gameType = resolveGameType(r.gameType, r.gameId);
    if (!['Regular Season', 'Playoffs', 'Play-in Tournament'].includes(r.gameType)) continue;
    const year = getSeasonYear(r.gameDateTimeEst, CSV_PATH);
    if (year !== seasonYearArg) continue;

    if (!games.has(r.gameId)) games.set(r.gameId, {});
    const g = games.get(r.gameId);
    if (r.home === '1') g.home = r; else g.away = r;
  }

  let skippedNoTab = 0, skippedNoEntity = 0;

  // Pass 1: route + compute every field except leg_number. CSV's own
  // seriesGameNumber is unreliable for at least some historical seasons —
  // caught live on 2001 First Round Mavericks-Jazz, where it read
  // 1,2,8,8,4 instead of 1,2,3,4,5 (gameLabel's own "Game 3"/"Game 4" text
  // was correct, seriesGameNumber wasn't) and hit uq_game_tab_round_entities
  // trying to insert two "leg 8" games in the same series. Rather than trust
  // either CSV field, leg_number is self-computed below in pass 2: group by
  // (result_tab, round, unordered team pair) and number sequentially by
  // match_date — structurally can't collide or misnumber regardless of what
  // the source data's own counters say.
  const pending = [];
  for (const [gameId, { home, away }] of games) {
    if (!home || !away) { console.warn('Incomplete pair for gameId', gameId); continue; }

    let routed = routeGame(home.gameType, home.gameLabel);
    if (!routed && home.gameType === 'Playoffs' && !home.gameLabel) {
      const round = deriveRoundFromGameId(home.gameId);
      const conference = teamConferenceMap.get(home.teamId);
      if (round === 'NBA Finals') {
        routed = { event: 'Finals', tabKey: 'nba-finals', round: 'NBA Finals' };
      } else if (round === 'Conf. Finals') {
        routed = conference === 'Eastern'
          ? { event: 'Finals', tabKey: 'eastern-finals', round: 'East Conf. Finals' }
          : { event: 'Finals', tabKey: 'western-finals', round: 'West Conf. Finals' };
      } else if (round) {
        routed = conference === 'Eastern'
          ? { event: 'Playoffs', tabKey: 'eastern-conference', round }
          : { event: 'Playoffs', tabKey: 'western-conference', round };
      }
    }
    if (!routed) { skippedNoTab++; continue; }

    let tabKey = routed.tabKey;
    if (routed.event === 'Play-in') {
      const conference = home.gameSubLabel || teamConferenceMap.get(home.teamId);
      tabKey = conference === 'East' || conference === 'Eastern' ? 'eastern-conference' : 'western-conference';
    }
    const resultTabId = tabMap.get(`${routed.event}|${tabKey}`);
    if (!resultTabId) { console.warn('No result_tab for', routed.event, tabKey); skippedNoTab++; continue; }

    const homeEntityId = teamMap.get(home.teamId);
    const awayEntityId = teamMap.get(away.teamId);
    if (!homeEntityId || !awayEntityId) { skippedNoEntity++; continue; }

    const homeScore = numOrNull(home.teamScore);
    const awayScore = numOrNull(away.teamScore);
    const homeWon = home.win === '1';
    const winnerEntityId = homeWon ? homeEntityId : awayEntityId;

    const score = { home: homeScore, away: awayScore };
    const stats = { home: boxScoreStats(home), away: boxScoreStats(away) };
    const matchDate = home.gameDateTimeEst.slice(0, 10);
    // Regular Season has no matchday/round number in the source (unlike
    // Ligue 1's "Regular Season - N" fixture rounds) — grouped by month
    // instead so GameTemplate's existing round-collapse UI has something
    // sensible to bucket 1,230 games under, per confirmed product decision.
    const round = routed.event === 'Regular Season'
      ? new Date(`${matchDate}T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
      : routed.round;
    const homeSeed = numOrNull(home.seed);
    const awaySeed = numOrNull(away.seed);
    const durationMinutes = numOrNull(home.numMinutes);

    // Regular Season games aren't a "series" — no leg_number grouping.
    const seriesKey = routed.event === 'Regular Season' ? null
      : `${resultTabId}|${round}|${Math.min(homeEntityId, awayEntityId)}-${Math.max(homeEntityId, awayEntityId)}`;

    pending.push({
      gameId, resultTabId, round, matchDate, homeEntityId, awayEntityId,
      homeSeed, awaySeed, score, stats, winnerEntityId, homeWon, durationMinutes, seriesKey,
    });
  }

  // Pass 2: assign leg_number per series, sorted chronologically.
  const seriesGroups = new Map();
  for (const g of pending) {
    if (!g.seriesKey) continue;
    if (!seriesGroups.has(g.seriesKey)) seriesGroups.set(g.seriesKey, []);
    seriesGroups.get(g.seriesKey).push(g);
  }
  for (const group of seriesGroups.values()) {
    group.sort((a, b) => a.matchDate.localeCompare(b.matchDate));
    group.forEach((g, i) => { g.legNumber = i + 1; });
  }

  // Look up existing rows once and null out leg_number on all of them first —
  // re-running this script after a partial/earlier run can require two games
  // to effectively swap leg_number values (e.g. old buggy data had game A=4,
  // game B=5 and the correct values are A=5, B=4); doing that as sequential
  // single-row UPDATEs hits uq_game_tab_round_entities mid-sequence since
  // Postgres checks the unique constraint per-statement, not per-transaction.
  // NULLs never collide with each other under a unique index, so nulling
  // first removes any ordering dependency before the real values go in.
  for (const g of pending) {
    const existing = await pool.query(
      `SELECT id FROM games WHERE result_tab_id = $1 AND match_number = $2`,
      [g.resultTabId, g.gameId]
    );
    g.existingId = existing.rows[0]?.id ?? null;
  }
  const idsToNull = pending.filter(g => g.existingId).map(g => g.existingId);
  if (idsToNull.length) {
    await pool.query(`UPDATE games SET leg_number = NULL WHERE id = ANY($1)`, [idsToNull]);
  }

  let inserted = 0, updated = 0;
  for (const g of pending) {
    const legNumber = g.legNumber ?? null;

    if (g.existingId) {
      await pool.query(
        `UPDATE games SET
           round = $1, leg_number = $2, match_date = $3, home_seed = $4, away_seed = $5,
           score = $6::jsonb, stats = $7::jsonb, winner_entity_id = $8, home_won = $9,
           duration_minutes = $10, home_entity_id = $11, away_entity_id = $12,
           home_entity_type = 'club', away_entity_type = 'club', updated_at = NOW()
         WHERE id = $13`,
        [g.round, legNumber, g.matchDate, g.homeSeed, g.awaySeed,
         JSON.stringify(g.score), JSON.stringify(g.stats), g.winnerEntityId, g.homeWon,
         g.durationMinutes, g.homeEntityId, g.awayEntityId, g.existingId]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO games (
           result_tab_id, round, match_number, leg_number, match_date,
           home_entity_id, away_entity_id, home_entity_type, away_entity_type,
           home_seed, away_seed, score, winner_entity_id, home_won,
           duration_minutes, stats
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'club','club',$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb)`,
        [g.resultTabId, g.round, g.gameId, legNumber, g.matchDate,
         g.homeEntityId, g.awayEntityId, g.homeSeed, g.awaySeed,
         JSON.stringify(g.score), g.winnerEntityId, g.homeWon, g.durationMinutes, JSON.stringify(g.stats)]
      );
      inserted++;
    }
  }

  console.log(`Season ${seasonYearArg}: ${inserted} games inserted, ${updated} updated, ${skippedNoTab} skipped (no tab), ${skippedNoEntity} skipped (no entity)`);

  // Backfill seasons.start_date/end_date from each event's own games — these
  // were left NULL by getOrCreateSeason-style helpers across the NBA scripts,
  // which silently breaks age-at-event-date display (calcAge.js returns null
  // when either date is missing) for every player page. Real dates, not
  // estimates, since we already have the actual game dates on hand.
  const dateWindows = await pool.query(`
    SELECT s.id AS season_id, MIN(g.match_date) AS start_date, MAX(g.match_date) AS end_date
    FROM seasons s
    JOIN result_tabs rt ON rt.season_id = s.id
    JOIN games g ON g.result_tab_id = rt.id
    WHERE s.competition_id = 4828 AND s.year = $1
    GROUP BY s.id
  `, [seasonYearArg]);
  for (const w of dateWindows.rows) {
    await pool.query(`UPDATE seasons SET start_date = $1, end_date = $2 WHERE id = $3`, [w.start_date, w.end_date, w.season_id]);
  }
  console.log(`Backfilled start_date/end_date for ${dateWindows.rows.length} season rows`);

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
