// Ingests one BAA/NBA season (1947-1955) from the basketball-reference.com scrape
// (rankks-scrap/nba-historical-scraper/nba-historical-raw/{year}/*.json) into
// seasons/result_tabs/games — the years TeamStatistics.csv can't supply because it
// drops every game involving one of the 15 defunct 1946-1955 franchises entirely
// (see nba-1946-1955-data-gap memory). ingest-nba-games.js/ensure-nba-season.js
// are untouched and keep owning 1956+.
//
// Unlike the modern conference-based format, this era had no conferences (BAA/
// early-NBA used Divisions only) and playoff formats changed almost every year
// (Quarterfinals/Semifinals/Finals in 1947; Division Semifinals/Finals from 1949;
// a Round Robin tiebreaker phase in 1954). Rather than force today's Playoffs
// shape (eastern-conference/western-conference) onto data that never had that
// shape, tabs are created per the ACTUAL round names basketball-reference itself
// used that season. Only 'nba-finals' is hardcoded (results.js's Champion History
// feature keys off that exact tab_key/event regardless of era — confirmed via
// `rt.tab_key = 'nba-finals'` in the finalsParticipants query) — every other round
// gets its own dynamically-created tab under the Playoffs event.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { buildResolver } = require('./nba-historical-resolve-team');

const RAW_DIR = path.join(__dirname, '..', 'rankks-scrap', 'nba-historical-scraper', 'nba-historical-raw');
const COMPETITION_ID = 4828;
const EVENT_IDS = { 'Regular Season': 74, 'Finals': 75, 'Playoffs': 76, 'All-Time': 81 };

const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) { console.error('Usage: node ingest-nba-historical-games.js <seasonYear (1947-1955)>'); process.exit(1); }

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function parseDate(dateStr) {
  const m = dateStr.match(/(\w{3})\w* (\d+), (\d+)/);
  if (!m) throw new Error(`Unparseable date: "${dateStr}"`);
  const mo = MONTHS[m[1]];
  return `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function readJsonIfExists(p) { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; }

const seasonIdCache = new Map(); // eventId -> season.id
const tabIdCache = new Map();    // `${seasonId}|${tabKey}` -> result_tabs.id

async function ensureTab(eventName, tabName, tabKey, typology, displayOrder) {
  const eventId = EVENT_IDS[eventName];
  let dbSeasonId = seasonIdCache.get(eventId);
  if (!dbSeasonId) {
    const existing = await pool.query(
      `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
      [COMPETITION_ID, eventId, seasonYearArg]
    );
    if (existing.rows.length) {
      dbSeasonId = existing.rows[0].id;
    } else {
      const ins = await pool.query(
        `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition)
         VALUES ($1, $2, $3, 'past', 'M', 1) RETURNING id`,
        [COMPETITION_ID, eventId, seasonYearArg]
      );
      dbSeasonId = ins.rows[0].id;
      console.log(`  created season ${eventName} ${seasonYearArg} (id ${dbSeasonId})`);
    }
    seasonIdCache.set(eventId, dbSeasonId);
  }

  const tabCacheKey = `${dbSeasonId}|${tabKey}`;
  let tabId = tabIdCache.get(tabCacheKey);
  if (!tabId) {
    const existing = await pool.query(`SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`, [dbSeasonId, tabKey]);
    if (existing.rows.length) {
      tabId = existing.rows[0].id;
    } else {
      const ins = await pool.query(
        `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
         VALUES ($1, $2, $3, $4, $5, false) RETURNING id`,
        [dbSeasonId, tabName, tabKey, typology, displayOrder]
      );
      tabId = ins.rows[0].id;
      console.log(`    + result_tab '${tabKey}' (${tabName}) under ${eventName}`);
    }
    tabIdCache.set(tabCacheKey, tabId);
  }
  return tabId;
}

async function main() {
  const yearDir = path.join(RAW_DIR, String(seasonYearArg));
  const summary = readJsonIfExists(path.join(yearDir, 'season-summary.json'));
  if (!summary) { console.error(`No scraped data for ${seasonYearArg} at ${yearDir}`); process.exit(1); }

  const monthFiles = fs.readdirSync(yearDir).filter(f => /^games-/.test(f));
  const allGames = [];
  for (const f of monthFiles) {
    for (const g of readJsonIfExists(path.join(yearDir, f))) allGames.push(g);
  }
  console.log(`${seasonYearArg}: ${allGames.length} scheduled games across ${monthFiles.length} month file(s)`);

  // boxScoreUrl -> round label, from every non-Round-Robin playoff series'
  // per-game breakdown (Round Robin series have no per-game data on this page
  // — their games are picked up below via the schedule's own "Round Robin"
  // remarks instead, tagged with a division-based tab).
  const roundByUrl = new Map();
  for (const series of summary.playoffSeries) {
    if (!series.games || !series.games.length) continue;
    for (const g of series.games) {
      if (g.boxScoreUrl) roundByUrl.set(g.boxScoreUrl, series.round);
    }
  }

  const resolve = await buildResolver(pool);

  // Pass 1: resolve entities + classify routing for every game. Collect ALL
  // resolution errors before writing anything — never guess, never partially
  // load a season.
  const resolutionErrors = [];
  const divisionCache = new Map(); // `${entityId}|${year}` -> division string
  async function divisionFor(entityId) {
    const key = `${entityId}|${seasonYearArg}`;
    if (divisionCache.has(key)) return divisionCache.get(key);
    const r = await pool.query(
      `SELECT division FROM entity_conference_history WHERE entity_id = $1 AND start_year <= $2 AND (end_year IS NULL OR end_year >= $2)`,
      [entityId, seasonYearArg]
    );
    const division = r.rows[0]?.division || null;
    divisionCache.set(key, division);
    return division;
  }

  const pending = [];
  for (const row of allGames) {
    if (!row.date || !row.home || !row.visitor) continue;
    let homeEntityId, awayEntityId;
    try {
      homeEntityId = resolve(row.home, seasonYearArg);
      awayEntityId = resolve(row.visitor, seasonYearArg);
    } catch (e) {
      resolutionErrors.push(e.message);
      continue;
    }

    const matchDate = parseDate(row.date);
    const homeScore = row.homePts ? Number(row.homePts) : null;
    const awayScore = row.visitorPts ? Number(row.visitorPts) : null;
    if (homeScore == null || awayScore == null) continue; // no final score — nothing to record
    const homeWon = homeScore > awayScore;
    const winnerEntityId = homeWon ? homeEntityId : awayEntityId;

    const roundLabel = row.boxScoreUrl ? roundByUrl.get(row.boxScoreUrl) : null;
    let routing;
    if (roundLabel === 'Finals') {
      routing = { event: 'Finals', tabKey: 'nba-finals', tabName: 'NBA Finals', typology: 'game', seriesRound: roundLabel };
    } else if (roundLabel) {
      routing = { event: 'Playoffs', tabKey: slugify(roundLabel), tabName: roundLabel, typology: 'game', seriesRound: roundLabel };
    } else if ((row.remarks || '').includes('Round Robin')) {
      // eslint-disable-next-line no-await-in-loop
      const division = await divisionFor(homeEntityId);
      const isEastern = (division || '').toLowerCase().includes('eastern');
      const label = `${isEastern ? 'Eastern' : 'Western'} Round Robin`;
      routing = { event: 'Playoffs', tabKey: slugify(label), tabName: label, typology: 'game', seriesRound: null };
    } else {
      const monthLabel = new Date(`${matchDate}T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      routing = { event: 'Regular Season', tabKey: 'results', tabName: 'Results', typology: 'game', seriesRound: null, round: monthLabel };
    }

    pending.push({
      matchDate, homeEntityId, awayEntityId,
      homeScore, awayScore, winnerEntityId, homeWon,
      routing, round: routing.round || routing.seriesRound,
    });
  }

  if (resolutionErrors.length) {
    console.error(`\n${resolutionErrors.length} entity resolution error(s) — fix before proceeding:`);
    for (const msg of [...new Set(resolutionErrors)]) console.error(' -', msg);
    process.exit(1);
  }

  // Ensure Regular Season + All-Time season/tabs always exist, even if this
  // pass's schedule happens to touch every tab already (idempotent no-ops).
  await ensureTab('Regular Season', 'Standings', 'standings', 'standings', 1);
  await ensureTab('Regular Season', 'Results', 'results', 'game', 2);
  await ensureTab('All-Time', 'Player Stats', 'all-time-players', 'players', 1);
  await ensureTab('All-Time', 'Team Stats', 'all-time-teams', 'teams', 2);
  await ensureTab('All-Time', 'Player Awards', 'all-time-player-awards', 'player_awards', 3);
  await ensureTab('All-Time', 'Team Honours', 'all-time-team-honours', 'team_honours', 4);
  await ensureTab('All-Time', 'Champion History', 'all-time-champion-history', 'champion_history', 5);
  await ensureTab('Finals', 'NBA Finals', 'nba-finals', 'game', 1);

  // Playoffs tabs: one per distinct non-Finals round actually present this
  // season, ordered by that round's earliest game date (so e.g. a 1954-style
  // Round Robin phase — which happened before the Division Semifinals —
  // naturally sorts ahead of them without hardcoding a fixed round sequence).
  const playoffRoundDates = new Map(); // tabKey -> { tabName, minDate }
  for (const g of pending) {
    if (g.routing.event !== 'Playoffs') continue;
    const cur = playoffRoundDates.get(g.routing.tabKey);
    if (!cur || g.matchDate < cur.minDate) {
      playoffRoundDates.set(g.routing.tabKey, { tabName: g.routing.tabName, minDate: g.matchDate });
    }
  }
  const orderedPlayoffTabs = [...playoffRoundDates.entries()].sort((a, b) => a[1].minDate.localeCompare(b[1].minDate));
  const playoffTabIds = new Map();
  let order = 1;
  for (const [tabKey, { tabName }] of orderedPlayoffTabs) {
    const tabId = await ensureTab('Playoffs', tabName, tabKey, 'game', order++);
    playoffTabIds.set(tabKey, tabId);
  }

  // Resolve each pending game's final result_tab_id now that all tabs exist.
  const regularTabId = tabIdCache.get(`${seasonIdCache.get(74)}|results`);
  const finalsTabId = tabIdCache.get(`${seasonIdCache.get(75)}|nba-finals`);
  for (const g of pending) {
    if (g.routing.event === 'Regular Season') g.resultTabId = regularTabId;
    else if (g.routing.event === 'Finals') g.resultTabId = finalsTabId;
    else g.resultTabId = playoffTabIds.get(g.routing.tabKey);
    // Series key for leg_number grouping — only meaningful for actual 2-team
    // playoff/finals series, not Regular Season (no legs) or Round Robin
    // (3+ teams, not a best-of series).
    g.seriesKey = (g.routing.event !== 'Regular Season' && g.routing.seriesRound)
      ? `${g.resultTabId}|${g.routing.seriesRound}|${Math.min(g.homeEntityId, g.awayEntityId)}-${Math.max(g.homeEntityId, g.awayEntityId)}`
      : null;
  }

  // match_number is an integer column (built for the Kaggle CSV's own numeric
  // gameId) — basketball-reference's box-score slugs are alphanumeric
  // ("194611020STB"), so instead each tab gets its own dense 1..N numbering,
  // assigned by sorting that tab's games chronologically (tiebroken by the
  // entity ids, which can't tie for two distinct games). This is stable
  // across re-runs since the source data never changes, and only needs to be
  // unique within one result_tab, which is all the existing-row lookup below
  // requires.
  const byTab = new Map();
  for (const g of pending) {
    if (!byTab.has(g.resultTabId)) byTab.set(g.resultTabId, []);
    byTab.get(g.resultTabId).push(g);
  }
  for (const group of byTab.values()) {
    group.sort((a, b) => a.matchDate.localeCompare(b.matchDate) || a.homeEntityId - b.homeEntityId || a.awayEntityId - b.awayEntityId);
    group.forEach((g, i) => { g.matchNumber = i + 1; });
  }

  // Pass 2: leg_number per series, chronological.
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

  // Null out existing leg_numbers first (same rationale as ingest-nba-games.js:
  // re-running after a partial/earlier pass can require two games to swap
  // leg_number values, which single sequential UPDATEs can't do without
  // tripping the unique index mid-sequence).
  for (const g of pending) {
    const existing = await pool.query(
      `SELECT id FROM games WHERE result_tab_id = $1 AND match_number = $2`,
      [g.resultTabId, g.matchNumber]
    );
    g.existingId = existing.rows[0]?.id ?? null;
  }
  const idsToNull = pending.filter(g => g.existingId).map(g => g.existingId);
  if (idsToNull.length) await pool.query(`UPDATE games SET leg_number = NULL WHERE id = ANY($1)`, [idsToNull]);

  let inserted = 0, updated = 0;
  for (const g of pending) {
    const legNumber = g.legNumber ?? null;
    const score = { home: g.homeScore, away: g.awayScore };
    const stats = { home: {}, away: {} }; // no box-score-level stats available for this era on basketball-reference

    if (g.existingId) {
      await pool.query(
        `UPDATE games SET
           round = $1, leg_number = $2, match_date = $3,
           score = $4::jsonb, stats = $5::jsonb, winner_entity_id = $6, home_won = $7,
           home_entity_id = $8, away_entity_id = $9,
           home_entity_type = 'club', away_entity_type = 'club', updated_at = NOW()
         WHERE id = $10`,
        [g.round, legNumber, g.matchDate, JSON.stringify(score), JSON.stringify(stats),
         g.winnerEntityId, g.homeWon, g.homeEntityId, g.awayEntityId, g.existingId]
      );
      updated++;
    } else {
      await pool.query(
        `INSERT INTO games (
           result_tab_id, round, match_number, leg_number, match_date,
           home_entity_id, away_entity_id, home_entity_type, away_entity_type,
           score, winner_entity_id, home_won, stats
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'club','club',$8::jsonb,$9,$10,$11::jsonb)`,
        [g.resultTabId, g.round, g.matchNumber, legNumber, g.matchDate,
         g.homeEntityId, g.awayEntityId, JSON.stringify(score), g.winnerEntityId, g.homeWon, JSON.stringify(stats)]
      );
      inserted++;
    }
  }

  console.log(`\nSeason ${seasonYearArg}: ${inserted} games inserted, ${updated} updated`);

  const dateWindows = await pool.query(`
    SELECT s.id AS season_id, MIN(g.match_date) AS start_date, MAX(g.match_date) AS end_date
    FROM seasons s
    JOIN result_tabs rt ON rt.season_id = s.id
    JOIN games g ON g.result_tab_id = rt.id
    WHERE s.competition_id = $1 AND s.year = $2
    GROUP BY s.id
  `, [COMPETITION_ID, seasonYearArg]);
  for (const w of dateWindows.rows) {
    await pool.query(`UPDATE seasons SET start_date = $1, end_date = $2 WHERE id = $3`, [w.start_date, w.end_date, w.season_id]);
  }
  console.log(`Backfilled start_date/end_date for ${dateWindows.rows.length} season rows`);

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
