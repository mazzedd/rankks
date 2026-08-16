// =============================================================
// RANKKS — worldfootball.net historical scraper
// Backfills standings/results/scorers/assists for seasons that
// api-sports.io does not cover (pre-2010ish).
//
// Run:
//   node scrape-worldfootball.js test <league-slug> <season>
//   node scrape-worldfootball.js all
//
// Example:
//   node scrape-worldfootball.js test ligue-1 1935-1936
//
// Site structure notes (verified manually 2026-07-25, worldfootball.net
// redesign — the old /table/xxx-slug-YYYY-YYYY/ URLs and
// div.data table.standard_tabelle selectors from older scraping guides
// no longer exist):
//
//   - Every competition has a numeric id (coNN) and every season within
//     it has its own numeric id (seNNNNN). These are NOT derivable from
//     slug+year — they're resolved by fetching one page for the
//     competition and reading its season <select> dropdown, which lists
//     every season's id + URL. Resolved once, cached to
//     worldfootball-season-map.json.
//   - Standings:  .../se{ID}/{season}/results-and-standings/
//       -> div.module-standing > table   (direct child only — the page
//          contains 7 standings tables: Overall/Home/Away/First half/
//          Second half/1st half/2nd half, all sharing the same class;
//          the non-Overall ones are nested one level deeper inside a
//          hs-hide wrapper div, so '>' isolates Overall)
//   - Results:    .../se{ID}/{season}/all-matches/
//       -> div.module-gameplan, match rows are div[data-match_id],
//          grouped by preceding sibling .hs-head--round (matchday) and
//          .hs-head--date (date). Whole season is on one page, no
//          per-matchday pagination needed.
//   - Scorers:    .../se{ID}/{season}/statistics-goals/
//       -> table.module-statistics tr.entry, whole list on one page.
//   - Assists:    .../se{ID}/{season}/statistics-assists/
//       -> same selector; old seasons render
//          <th class="nodata">No data available.</th> instead of rows —
//          treated as an empty list, not an error (assists weren't
//          tracked in this era).
//
//   Points column format changes by era: modern seasons show a plain
//   number ("76"). Pre-1994 seasons (2-points-per-win system) show
//   "pointsFor:pointsAgainst" (e.g. "44:16" = 20 wins*2 + 4 draws*1 =
//   44). We only keep the points-scored half, merged into one `points`
//   column, matching the modern schema.
// =============================================================

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const cheerio = require('cheerio');

const execFileAsync = promisify(execFile);

const BASE_URL = 'https://www.worldfootball.net';
const SEASON_MAP_PATH = path.join(__dirname, 'worldfootball-season-map.json');
const REQUEST_DELAY_MS = 1500;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ── CONFIG ─────────────────────────────────────────────────────
// slug -> worldfootball competition path fragment (co{id}/{name-slug})
const LEAGUES = {
  'ligue-1': 'co71/france-ligue-1',
};

// Full pre-api-sports.io gap: worldfootball.net's Ligue 1 seasons up to
// 2009-2010 (ingest-ligue1.js covers 2010-2011 onward). Excludes
// "1933 Final", a one-off championship playoff, not a normal season.
const BACKFILL_SEASONS = {
  'ligue-1': [
    '1932-1933', '1933-1934', '1934-1935', '1935-1936', '1936-1937', '1937-1938', '1938-1939',
    '1945-1946', '1946-1947', '1947-1948', '1948-1949', '1949-1950',
    '1950-1951', '1951-1952', '1952-1953', '1953-1954', '1954-1955', '1955-1956', '1956-1957', '1957-1958', '1958-1959', '1959-1960',
    '1960-1961', '1961-1962', '1962-1963', '1963-1964', '1964-1965', '1965-1966', '1966-1967', '1967-1968', '1968-1969', '1969-1970',
    '1970-1971', '1971-1972', '1972-1973', '1973-1974', '1974-1975', '1975-1976', '1976-1977', '1977-1978', '1978-1979', '1979-1980',
    '1980-1981', '1981-1982', '1982-1983', '1983-1984', '1984-1985', '1985-1986', '1986-1987', '1987-1988', '1988-1989', '1989-1990',
    '1990-1991', '1991-1992', '1992-1993', '1993-1994', '1994-1995', '1995-1996', '1996-1997', '1997-1998', '1998-1999', '1999-2000',
    '2000-2001', '2001-2002', '2002-2003', '2003-2004', '2004-2005', '2005-2006', '2006-2007', '2007-2008', '2008-2009', '2009-2010',
  ],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// worldfootball.net sits behind Cloudflare bot-fingerprinting that challenges
// axios/Node's TLS client but passes plain curl — so pages are fetched via a
// curl subprocess (URL passed as an argv element, never shell-interpolated)
// and only the resulting HTML is handed to cheerio for parsing.
// Retries on transient network failures (curl exits non-zero on timeout/
// connection reset/DNS blips; it does NOT exit non-zero on HTTP error
// statuses like 403/404 since we don't pass -f, so a retry here is only
// ever compensating for a real network hiccup, observed in practice during
// the full 72-season backfill).
async function fetchHtml(url, attempt = 1) {
  try {
    const { stdout } = await execFileAsync(
      'curl',
      ['-sL', '--max-time', '20', '-A', USER_AGENT, url],
      { maxBuffer: 20 * 1024 * 1024 }
    );
    return cheerio.load(stdout);
  } catch (err) {
    if (attempt >= 3) throw err;
    await sleep(3000 * attempt);
    return fetchHtml(url, attempt + 1);
  }
}

// ── SEASON ID RESOLUTION ──────────────────────────────────────
function loadSeasonMapCache() {
  if (!fs.existsSync(SEASON_MAP_PATH)) return {};
  return JSON.parse(fs.readFileSync(SEASON_MAP_PATH, 'utf8'));
}

function saveSeasonMapCache(map) {
  fs.writeFileSync(SEASON_MAP_PATH, JSON.stringify(map, null, 2));
}

// Resolves every season's URL path for a competition by reading the
// season <select> dropdown off any one page for that competition.
// Returns { "1935-1936": "/competition/co71/france-ligue-1/se4334/1935-1936/", ... }
async function resolveSeasonMap(leagueSlug) {
  const cache = loadSeasonMapCache();
  if (cache[leagueSlug]) return cache[leagueSlug];

  const compPath = LEAGUES[leagueSlug];
  if (!compPath) throw new Error(`Unknown league slug: ${leagueSlug}`);

  const $ = await fetchHtml(`${BASE_URL}/competition/${compPath}/results-and-standings/`);
  const seasons = {};
  $('select.season-navigation option').each((_, el) => {
    const label = $(el).text().trim().replace('/', '-'); // "2023/2024" -> "2023-2024"
    const value = $(el).attr('value'); // full path incl. /results-and-standings/
    if (!value) return;
    const base = value.replace(/results-and-standings\/$/, '');
    seasons[label] = base;
  });

  cache[leagueSlug] = seasons;
  saveSeasonMapCache(cache);
  return seasons;
}

async function resolveSeasonBase(leagueSlug, season) {
  const seasons = await resolveSeasonMap(leagueSlug);
  const base = seasons[season];
  if (!base) {
    throw new Error(
      `Season ${season} not found for ${leagueSlug}. Known seasons: ${Object.keys(seasons).join(', ')}`
    );
  }
  return base; // e.g. "/competition/co71/france-ligue-1/se4334/1935-1936/"
}

// ── PARSERS ────────────────────────────────────────────────────

// "44:16" (historic 2pt-era pointsFor:pointsAgainst) -> 44
// "76" (modern) -> 76
function parsePoints(raw) {
  const text = raw.trim();
  const [first] = text.split(':');
  return parseInt(first, 10);
}

function parseStandings($) {
  const rows = [];
  // Page has 7 standings tables (Overall/Home/Away/First half/Second half/
  // 1st/2nd half). Only the Overall one sits directly inside
  // div.hs-block.hs-standing — the rest are nested one level deeper inside
  // a div.hs-home/.hs-away/etc.hs-hide wrapper.
  $('div.hs-block.hs-standing > div.module-standing > table tr').each((_, el) => {
    const $row = $(el);
    if ($row.find('td').length === 0) return; // header row
    const rank = parseInt($row.find('td.standing-rank').first().text().trim(), 10);
    const teamHref = $row.find('td.team-name a').first().attr('href') || '';
    const team = $row.find('td.team-name a').first().text().trim();
    const played = parseInt($row.find('td.standing-games_played').text().trim(), 10);
    const won = parseInt($row.find('td.standing-win').text().trim(), 10);
    const drawn = parseInt($row.find('td.standing-draw').text().trim(), 10);
    const lost = parseInt($row.find('td.standing-lost').text().trim(), 10);
    const goals = $row.find('td.standing-goaldiff').text().trim(); // "81:45"
    const points = parsePoints($row.find('td.standing-points').text());
    if (!team || Number.isNaN(rank)) return;
    // href looks like "/teams/te17870/racing-club-de-france/"
    const teamMatch = teamHref.match(/\/teams\/te(\d+)\/([^/]+)\//);
    rows.push({
      rank, team, played, won, drawn, lost, goals, points,
      teamId: teamMatch ? teamMatch[1] : null,
      teamSlug: teamMatch ? teamMatch[2] : null,
    });
  });
  return rows;
}

function parseResults($) {
  const results = [];
  let currentMatchday = null;
  let currentDate = null;

  $('div.module-gameplan > div > div').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') || '';

    if (cls.includes('hs-head--round')) {
      const text = $el.text().trim(); // "Matchday 1"
      const m = text.match(/(\d+)/);
      currentMatchday = m ? parseInt(m[1], 10) : text;
      return;
    }
    if (cls.includes('hs-head--date')) {
      currentDate = $el.text().trim(); // "25.08.1935"
      return;
    }
    if ($el.attr('data-match_id')) {
      const home = $el.find('.team-name-home a').first().text().trim();
      const away = $el.find('.team-name-away a').first().text().trim();
      const score = $el.find('.match-result a').first().text().trim();
      if (!home || !away) return;
      results.push({ matchday: currentMatchday, date: currentDate, home, away, score });
    }
  });

  return results;
}

function parsePersonStatsTable($, table, valueColumnClass, valueKey) {
  const rows = [];
  const $table = $(table);
  if ($table.find('th.nodata').length > 0) return rows; // "No data available."

  let lastRank = null;
  $table.find('tbody tr, tr.entry').each((_, el) => {
    const $row = $(el);
    if ($row.find('td').length === 0) return;
    const rankText = $row.find('td.person_stats-rank').text().trim();
    // worldfootball leaves the rank cell blank for tied positions (joint Nth)
    // instead of repeating the number — carry the last seen rank forward.
    const rank = rankText ? parseInt(rankText, 10) : lastRank;
    const nameLink = $row.find('td.person-name a').first();
    const player = nameLink.text().trim();
    const personMatch = (nameLink.attr('href') || '').match(/\/person\/pe(\d+)\/([^/]+)\//);
    const team = $row.find('td.team-name a').first().text().trim();
    const value = parseInt($row.find(`td.${valueColumnClass}`).first().text().trim(), 10);
    if (!player) return;
    lastRank = rank;
    rows.push({
      rank, player, team, [valueKey]: value,
      personId: personMatch ? personMatch[1] : null,
      personSlug: personMatch ? personMatch[2] : null,
    });
  });

  return rows;
}

function parseScorers($) {
  return parsePersonStatsTable($, 'table.module-statistics', 'person_stats-score', 'goals');
}

function parseAssists($) {
  return parsePersonStatsTable($, 'table.module-statistics', 'person_stats-assists', 'assists');
}

// Squad page groups players under role headers (<th colspan="5"
// class="role">Goalkeeper</th>) followed by a repeated column-header row,
// then entry rows. Walk the table's direct <tr> children in order, tracking
// the most recent role header, rather than trying to select role+entry rows
// independently (nothing else ties an entry row back to its group).
function parseSquad($) {
  const players = [];
  let currentRole = null;

  $('table > tbody > tr, table > tr').each((_, el) => {
    const $row = $(el);
    const roleHeader = $row.find('th.role').first();
    if (roleHeader.length > 0) {
      currentRole = roleHeader.text().trim();
      return;
    }
    if ($row.hasClass('hs-repeated-header')) return; // repeated column-header row
    if ($row.find('td.person-name').length === 0) return;

    const nameLink = $row.find('td.person-name a').first();
    const name = nameLink.text().trim();
    const href = nameLink.attr('href') || ''; // "/person/pe1730379/robert-cabanis/"
    const personMatch = href.match(/\/person\/pe(\d+)\/([^/]+)\//);
    const country = $row.find('td.country-name a').first().text().trim() || null;
    if (!name || !personMatch) return;

    players.push({
      personId: personMatch[1],
      personSlug: personMatch[2],
      name,
      role: currentRole,
      country,
    });
  });

  return players;
}

// Person detail page's <dl> is a flat list of <dt>/<dd> "facts" pairs, key
// text varies (Name/Birthday/born in/Country/Height/Position(s)) — read by
// label text rather than assuming fixed positions, since not every player
// has every field (weight and preferred foot are not tracked by
// worldfootball.net at all, confirmed absent from this markup entirely).
// Birthday field format is "DD.MM.YYYY" or, for deceased players,
// "DD.MM.YYYY † DD.MM.YYYY" (birth † death, a literal dagger character).
function parsePersonDetail($) {
  const facts = {};
  $('dl > tr, dl').find('dt').each((_, dt) => {
    const $dt = $(dt);
    const label = $dt.text().trim();
    const value = $dt.next('dd').text().trim();
    facts[label] = value;
  });

  const result = {
    birth_date: null,
    death_date: null,
    birth_place: null,
    country: null,
    height_cm: null,
    position: null,
  };

  if (facts['Birthday']) {
    const [birthPart, deathPart] = facts['Birthday'].split('†').map((s) => s.trim());
    result.birth_date = parseDDMMYYYY(birthPart);
    if (deathPart) result.death_date = parseDDMMYYYY(deathPart);
  }
  if (facts['born in']) result.birth_place = facts['born in'];
  if (facts['Country']) result.country = facts['Country'];
  if (facts['Height']) {
    const m = facts['Height'].match(/(\d+)/);
    if (m) result.height_cm = parseInt(m[1], 10);
  }
  if (facts['Position(s)']) result.position = facts['Position(s)'];

  return result;
}

// "30.05.1912" -> "1912-05-30"
function parseDDMMYYYY(raw) {
  const m = (raw || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ── FETCHERS ───────────────────────────────────────────────────
async function scrapeStandings(leagueSlug, season) {
  const base = await resolveSeasonBase(leagueSlug, season);
  const $ = await fetchHtml(`${BASE_URL}${base}results-and-standings/`);
  return parseStandings($);
}

async function scrapeResults(leagueSlug, season) {
  const base = await resolveSeasonBase(leagueSlug, season);
  const $ = await fetchHtml(`${BASE_URL}${base}all-matches/`);
  return parseResults($);
}

async function scrapeScorers(leagueSlug, season) {
  const base = await resolveSeasonBase(leagueSlug, season);
  const $ = await fetchHtml(`${BASE_URL}${base}statistics-goals/`);
  return parseScorers($);
}

async function scrapeAssists(leagueSlug, season) {
  const base = await resolveSeasonBase(leagueSlug, season);
  const $ = await fetchHtml(`${BASE_URL}${base}statistics-assists/`);
  return parseAssists($);
}

async function scrapeSquad(teamId, teamSlug, season) {
  const $ = await fetchHtml(`${BASE_URL}/teams/te${teamId}/${teamSlug}/vs${season}/squad/`);
  return parseSquad($);
}

async function scrapePersonDetail(personId, personSlug) {
  const $ = await fetchHtml(`${BASE_URL}/person/pe${personId}/${personSlug}/`);
  return parsePersonDetail($);
}

// ── COMMANDS ───────────────────────────────────────────────────
async function runTest(leagueSlug, season) {
  if (!LEAGUES[leagueSlug]) {
    console.error(`Unknown league slug "${leagueSlug}". Known: ${Object.keys(LEAGUES).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🔍 Test scrape — ${leagueSlug} ${season}\n`);

  console.log('── Standings ──');
  const standings = await scrapeStandings(leagueSlug, season);
  console.table(standings);
  await sleep(REQUEST_DELAY_MS);

  console.log('── Results (first 10 of season) ──');
  const results = await scrapeResults(leagueSlug, season);
  console.log(`Total matches: ${results.length}`);
  console.table(results.slice(0, 10));
  await sleep(REQUEST_DELAY_MS);

  console.log('── Top scorers (first 15) ──');
  const scorers = await scrapeScorers(leagueSlug, season);
  console.log(`Total scorer rows: ${scorers.length}`);
  console.table(scorers.slice(0, 15));
  await sleep(REQUEST_DELAY_MS);

  console.log('── Assists (first 15) ──');
  const assists = await scrapeAssists(leagueSlug, season);
  console.log(`Total assist rows: ${assists.length}`);
  if (assists.length === 0) {
    console.log('(none — not tracked for this season)');
  } else {
    console.table(assists.slice(0, 15));
  }
}

async function runAll() {
  const outPath = path.join(__dirname, 'worldfootball-scrape-output.json');
  // Resume support: reload whatever's already on disk (e.g. from a prior
  // run that crashed partway through) and skip seasons already scraped,
  // instead of redoing 72 seasons' worth of requests from scratch.
  const output = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};

  for (const [leagueSlug, allSeasons] of Object.entries(BACKFILL_SEASONS)) {
    // WF_TEST_SEASON: scope a run to one season for verification before
    // committing to the full batch. Unset in normal/production use.
    const seasons = process.env.WF_TEST_SEASON ? [process.env.WF_TEST_SEASON] : allSeasons;
    output[leagueSlug] = output[leagueSlug] || {};
    for (const season of seasons) {
      // Resume is per-field, not per-season: standings/scorers/assists were
      // scraped before teamId/personId existed in the parsers (needed for
      // squad URLs and for linking stat-list rows to the same person
      // entities squads use), and squads were added in a later pass
      // entirely. Every field below independently checks whether its
      // existing cached value is actually complete, so re-running `all`
      // tops up whatever's missing/stale instead of skipping the season
      // wholesale or redoing everything.
      const seasonData = output[leagueSlug][season] || {};
      const hasPersonId = (arr) => !!arr && (arr.length === 0 || arr[0].personId != null);
      let fetchedAnything = false;

      if (!seasonData.standings || !seasonData.standings[0]?.teamId) {
        seasonData.standings = await scrapeStandings(leagueSlug, season);
        await sleep(REQUEST_DELAY_MS);
        fetchedAnything = true;
      }
      if (!seasonData.results) {
        seasonData.results = await scrapeResults(leagueSlug, season);
        await sleep(REQUEST_DELAY_MS);
        fetchedAnything = true;
      }
      if (!hasPersonId(seasonData.scorers)) {
        seasonData.scorers = await scrapeScorers(leagueSlug, season);
        await sleep(REQUEST_DELAY_MS);
        fetchedAnything = true;
      }
      if (!hasPersonId(seasonData.assists)) {
        seasonData.assists = await scrapeAssists(leagueSlug, season);
        await sleep(REQUEST_DELAY_MS);
        fetchedAnything = true;
      }

      // One squad fetch per distinct club in this season's standings,
      // skipping any club whose squad was already fetched in a prior run.
      seasonData.squads = seasonData.squads || {};
      const teams = new Map();
      for (const row of seasonData.standings) {
        if (row.teamId && !teams.has(row.teamId)) teams.set(row.teamId, row);
      }
      for (const [teamId, row] of teams) {
        if (seasonData.squads[teamId]) continue;
        seasonData.squads[teamId] = {
          teamName: row.team,
          players: await scrapeSquad(teamId, row.teamSlug, season),
        };
        await sleep(REQUEST_DELAY_MS);
        fetchedAnything = true;
      }

      output[leagueSlug][season] = seasonData;

      if (!fetchedAnything) {
        console.log(`\n⏭️  ${leagueSlug} ${season} (already fully scraped, skipping)`);
        continue;
      }

      // Write after every season, not just at the end — a crash partway
      // through a long run shouldn't lose everything scraped so far.
      fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

      console.log(
        `\n📅 ${leagueSlug} ${season}\n` +
        `   standings=${seasonData.standings.length} ` +
        `results=${seasonData.results.length} ` +
        `scorers=${seasonData.scorers.length} ` +
        `assists=${seasonData.assists.length} ` +
        `squads=${teams.size} teams`
      );
    }
  }

  console.log(`\n✅ Wrote ${outPath}`);
}

async function runPlayerDetails() {
  const outPath = path.join(__dirname, 'worldfootball-scrape-output.json');
  const detailsPath = path.join(__dirname, 'worldfootball-player-details.json');
  if (!fs.existsSync(outPath)) {
    console.error(`${outPath} doesn't exist yet — run \`all\` first.`);
    process.exit(1);
  }

  const scrape = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const details = fs.existsSync(detailsPath) ? JSON.parse(fs.readFileSync(detailsPath, 'utf8')) : {};

  // Collect every distinct person seen anywhere (scorers, assists, squads)
  // across the whole dataset — a player who appears in 5 seasons should
  // only ever get one detail-page fetch, not five.
  const persons = new Map(); // personId -> personSlug
  for (const seasons of Object.values(scrape)) {
    for (const season of Object.values(seasons)) {
      for (const squad of Object.values(season.squads || {})) {
        for (const p of squad.players) {
          if (p.role === 'Manager') continue; // coaching staff, not a player
          if (!persons.has(p.personId)) persons.set(p.personId, p.personSlug);
        }
      }
      for (const p of [...(season.scorers || []), ...(season.assists || [])]) {
        if (p.personId && !persons.has(p.personId)) persons.set(p.personId, p.personSlug);
      }
    }
  }

  const todo = [...persons.entries()].filter(([id]) => !details[id]);
  console.log(`${persons.size} distinct players total, ${todo.length} still need detail fetch.\n`);

  let n = 0;
  for (const [personId, personSlug] of todo) {
    details[personId] = await scrapePersonDetail(personId, personSlug);
    n++;
    if (n % 25 === 0) {
      fs.writeFileSync(detailsPath, JSON.stringify(details, null, 2));
      console.log(`  ${n}/${todo.length} done`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  fs.writeFileSync(detailsPath, JSON.stringify(details, null, 2));
  console.log(`\n✅ Wrote ${detailsPath} (${Object.keys(details).length} total players)`);
}

// ── MAIN ───────────────────────────────────────────────────────
async function main() {
  const [, , command, arg1, arg2] = process.argv;

  if (command === 'test') {
    if (!arg1 || !arg2) {
      console.error('Usage: node scrape-worldfootball.js test <league-slug> <season>');
      process.exit(1);
    }
    await runTest(arg1, arg2);
  } else if (command === 'all') {
    await runAll();
  } else if (command === 'player-details') {
    await runPlayerDetails();
  } else if (command === 'test-squad') {
    const [, , , teamId, teamSlug, season] = process.argv;
    console.log(await scrapeSquad(teamId, teamSlug, season));
  } else if (command === 'test-person') {
    const [, , , personId, personSlug] = process.argv;
    console.log(await scrapePersonDetail(personId, personSlug));
  } else {
    console.error('Usage:');
    console.error('  node scrape-worldfootball.js test <league-slug> <season>');
    console.error('  node scrape-worldfootball.js all');
    console.error('  node scrape-worldfootball.js test-squad <teamId> <teamSlug> <season>');
    console.error('  node scrape-worldfootball.js test-person <personId> <personSlug>');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
