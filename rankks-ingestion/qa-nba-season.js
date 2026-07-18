// qa-nba-season.js — NBA ingestion QA report.
// Usage: node qa-nba-season.js <startYear> [endYear]
//
// Prints a per-season checklist across every NBA Line A event (Regular
// Season/Playoffs/Play-in/Finals/Awards, competition_id=4828) plus player
// bio/media coverage, then a summary of every FAIL found in the range.
// Read-only — never modifies data. Re-run any time after an ingestion batch.
//
// Schema assumptions here were confirmed live against the DB, not guessed:
//   - seasons: one row per (competition_id, event_id, year) — NOT one row
//     per year. NBA years fan out across event_id 74/75/76/77/78.
//   - Awards season (event 78) already has all 11 tabs (6 awards + 5 EOST)
//     pre-created for every year 2016-2026 — see ingest-nba-eost.js fix.
//   - Player bio fields (birth_date, image_url) live on entities, NOT on
//     player_attributes (whose birthdate/portrait_path/profile_path columns
//     are dead — 0 rows populated as of this script's writing).
//   - Position lives in player_attributes as attribute_key='position'.
//   - Team/player images resolve via entities.image_url, a /media/-prefixed
//     path served from rankks-api/media/.
//   - Player stats source is year-dependent: ingest-nba-player-boxscores.js
//     (PlayerStatisticsExtended.csv, per-game) for year >= 1997; that CSV's
//     earliest date is 1996-11-01, so year <= 1996 needs
//     ingest-nba-player-season-totals.js (Player Totals.csv, season totals)
//     instead — confirmed live on the 1995/1996 boundary. Both write the
//     same stats jsonb shape, so this QA script's checks don't need to know
//     which source a given year used.
const path = require('path');
const fs = require('fs');
const { pool, end } = require('./db');

const COMPETITION_ID = 4828;
const MEDIA_ROOT = path.join(__dirname, '..', 'rankks-api', 'media');

const EVENTS = { REGULAR: 74, FINALS: 75, PLAYOFFS: 76, PLAYIN: 77, AWARDS: 78, ALLTIME: 81 };

// 'teams' Regular Season tab is intentionally excluded: it was originally a
// Line B item there, later superseded by the Line A "All-Time Teams" tab
// (event 81) — nothing ever writes to the old Regular Season 'teams' tab_key.
const REGULAR_TABS = ['standings', 'results', 'players'];
const PLAYOFF_TABS = ['eastern-conference', 'western-conference'];
const PLAYIN_TABS  = ['eastern-conference', 'western-conference'];
const FINALS_TABS  = ['nba-finals', 'eastern-finals', 'western-finals'];
// 'finals-mvp' backfilled 2026-07-16 from a manually-compiled list
// (ingest-nba-finals-mvp.js) covering every year the award has existed,
// 1969-2026 — no longer a permanent gap, checked like every other award.
const AWARDS_TABS  = [
  'mvp', 'finals-mvp', 'dpoy', 'smoy', 'mip', 'roy',
  'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd',
  'all-defense-1st', 'all-defense-2nd',
];
// Real historical introduction year (year_convention='end') for awards/tiers
// that didn't always exist — confirmed live: 1988 (1987-88 season) has zero
// All-NBA 3rd candidates in source, correctly skipped by ingest-nba-eost.js,
// not a gap. mvp/roy thresholds don't affect anything in the current
// 1956-2026 range (both predate it) but matter once 1946-1955 resumes —
// per Mohamed's confirmed list (2026-07-16): MVP 1955-56, ROY 1952-53,
// DPOY/6MOY 1982-83, MIP 1985-86, Finals MVP 1968-69, All-Defense 1968-69,
// All-NBA 1st/2nd 1946-47 (never gated — predates the whole dataset),
// All-NBA 3rd 1988-89.
const AWARD_INTRO_YEAR = {
  mvp: 1956, roy: 1953,
  dpoy: 1983, smoy: 1983, mip: 1986, 'finals-mvp': 1969,
  'all-nba-3rd': 1989,
  'all-defense-1st': 1969, 'all-defense-2nd': 1969,
};
// Portraits are only expected for the #1-ranked player in these three awards.
const PORTRAIT_AWARD_TABS = ['mvp', 'mip', 'roy'];

function fileExists(imageUrl) {
  if (!imageUrl) return false;
  const rel = imageUrl.replace(/^\/media\//, '');
  return fs.existsSync(path.join(MEDIA_ROOT, rel));
}

async function getSeasonId(eventId, year) {
  const r = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, eventId, year]
  );
  return r.rows[0]?.id || null;
}

async function getTabIds(seasonId) {
  const r = await pool.query(`SELECT id, tab_key FROM result_tabs WHERE season_id = $1`, [seasonId]);
  const map = {};
  for (const row of r.rows) map[row.tab_key] = row.id;
  return map;
}

async function countRows(table, column, id) {
  if (!id) return 0;
  const r = await pool.query(`SELECT COUNT(*) FROM ${table} WHERE ${column} = $1`, [id]);
  return parseInt(r.rows[0].count, 10);
}

async function checkTeamLogos() {
  const rows = [];
  const r = await pool.query(`
    SELECT id, canonical_name, image_url
    FROM entities
    WHERE entity_type = 'club' AND external_ids ? 'nba_team_id'
    ORDER BY canonical_name
  `);
  for (const team of r.rows) {
    const hasUrl = !!team.image_url;
    const exists = fileExists(team.image_url);
    if (!hasUrl || !exists) {
      rows.push({ team: team.canonical_name, status: !hasUrl ? 'FAIL' : 'FAIL', detail: !hasUrl ? 'image_url is null' : `file missing: ${team.image_url}` });
    }
  }
  return { total: r.rows.length, problems: rows };
}

async function checkYear(year) {
  const results = [];
  const add = (section, check, status, detail = '') => results.push({ section, check, status, detail });

  // --- Regular Season ---
  const regSeasonId = await getSeasonId(EVENTS.REGULAR, year);
  add('Regular Season', 'season row', regSeasonId ? 'PASS' : 'FAIL', regSeasonId ? `season_id ${regSeasonId}` : 'no seasons row for event 74');

  let regTabs = {};
  if (regSeasonId) {
    regTabs = await getTabIds(regSeasonId);
    for (const key of REGULAR_TABS) {
      add('Regular Season', `tab '${key}'`, regTabs[key] ? 'PASS' : 'FAIL', regTabs[key] ? `tab_id ${regTabs[key]}` : 'missing');
    }

    const gamesCount = await countRows('games', 'result_tab_id', regTabs['results']);
    if (gamesCount === 0) add('Regular Season', 'games count', 'FAIL', '0 games');
    else if (gamesCount < 800) add('Regular Season', 'games count', 'WARN', `${gamesCount} games — confirm if this is a lockout-shortened season`);
    else add('Regular Season', 'games count', 'PASS', `${gamesCount} games`);

    const standingsCount = await countRows('standings', 'result_tab_id', regTabs['standings']);
    if (standingsCount === 0) add('Regular Season', 'standings rows', 'FAIL', '0 teams');
    else if (standingsCount !== 30) add('Regular Season', 'standings rows', 'WARN', `${standingsCount} teams (expected 30 for modern-era NBA)`);
    else add('Regular Season', 'standings rows', 'PASS', '30 teams');

    const playerStatsCount = await countRows('player_season_stats', 'result_tab_id', regTabs['players']);
    add('Regular Season', 'player_season_stats rows', playerStatsCount > 0 ? 'PASS' : 'FAIL', `${playerStatsCount} rows`);

    if (regTabs['players']) {
      const bio = await pool.query(`
        SELECT COUNT(DISTINCT pss.entity_id) AS total,
               COUNT(DISTINCT pss.entity_id) FILTER (WHERE e.birth_date IS NOT NULL) AS with_birthdate
        FROM player_season_stats pss
        JOIN entities e ON e.id = pss.entity_id
        WHERE pss.result_tab_id = $1
      `, [regTabs['players']]);
      const { total, with_birthdate } = bio.rows[0];
      if (total > 0) {
        add('Players', 'birth_date coverage', with_birthdate === total ? 'PASS' : 'WARN', `${with_birthdate}/${total}`);
      }

      const pos = await pool.query(`
        SELECT COUNT(DISTINCT pss.entity_id) AS total,
               COUNT(DISTINCT pa.entity_id) AS with_position
        FROM player_season_stats pss
        LEFT JOIN player_attributes pa ON pa.entity_id = pss.entity_id AND pa.attribute_key = 'position'
        WHERE pss.result_tab_id = $1
      `, [regTabs['players']]);
      const { total: pTotal, with_position } = pos.rows[0];
      if (pTotal > 0) add('Players', 'position coverage', with_position === pTotal ? 'PASS' : 'WARN', `${with_position}/${pTotal}`);
    }
  }

  // --- Playoffs ---
  const playoffSeasonId = await getSeasonId(EVENTS.PLAYOFFS, year);
  add('Playoffs', 'season row', playoffSeasonId ? 'PASS' : 'FAIL');
  if (playoffSeasonId) {
    const tabs = await getTabIds(playoffSeasonId);
    for (const key of PLAYOFF_TABS) {
      const g = await countRows('games', 'result_tab_id', tabs[key]);
      add('Playoffs', `'${key}' games`, g > 0 ? 'PASS' : 'FAIL', `${g} games`);
    }
  }

  // --- Play-in (introduced 2021 — the 2020 bubble had a one-off Western-only
  // play-in game, not the formal tournament, so 2020 is treated as N/A too) ---
  if (year >= 2021) {
    const playinSeasonId = await getSeasonId(EVENTS.PLAYIN, year);
    add('Play-in', 'season row', playinSeasonId ? 'PASS' : 'FAIL');
    if (playinSeasonId) {
      const tabs = await getTabIds(playinSeasonId);
      for (const key of PLAYIN_TABS) {
        const g = await countRows('games', 'result_tab_id', tabs[key]);
        add('Play-in', `'${key}' games`, g > 0 ? 'PASS' : 'FAIL', `${g} games`);
      }
    }
  } else {
    add('Play-in', 'season row', 'N/A', 'play-in introduced 2021');
  }

  // --- Finals ---
  const finalsSeasonId = await getSeasonId(EVENTS.FINALS, year);
  add('Finals', 'season row', finalsSeasonId ? 'PASS' : 'FAIL');
  if (finalsSeasonId) {
    const tabs = await getTabIds(finalsSeasonId);
    for (const key of FINALS_TABS) {
      const g = await countRows('games', 'result_tab_id', tabs[key]);
      add('Finals', `'${key}' games`, g > 0 ? 'PASS' : 'FAIL', `${g} games`);
    }
  }

  // --- Awards (incl. EOST tabs, same season per ingest-nba-eost.js fix) ---
  const awardsSeasonId = await getSeasonId(EVENTS.AWARDS, year);
  add('Awards', 'season row', awardsSeasonId ? 'PASS' : 'FAIL');
  let awardsTabs = {};
  if (awardsSeasonId) {
    awardsTabs = await getTabIds(awardsSeasonId);
    for (const key of AWARDS_TABS) {
      const introYear = AWARD_INTRO_YEAR[key];
      if (introYear && year < introYear) { add('Awards', `'${key}'`, 'N/A', `introduced ${introYear}`); continue; }
      if (!awardsTabs[key]) { add('Awards', `'${key}'`, 'FAIL', 'tab missing'); continue; }
      const c = await countRows('player_season_stats', 'result_tab_id', awardsTabs[key]);
      add('Awards', `'${key}'`, c > 0 ? 'PASS' : 'FAIL', `${c} rows`);
    }

    // Portraits are only expected for the #1 vote-getter in MVP/MIP/ROY.
    for (const key of PORTRAIT_AWARD_TABS) {
      if (!awardsTabs[key]) continue;
      const r = await pool.query(`
        SELECT e.canonical_name, e.image_url
        FROM player_season_stats pss
        JOIN entities e ON e.id = pss.entity_id
        WHERE pss.result_tab_id = $1 AND pss.ranking_at_event = 1
        LIMIT 1
      `, [awardsTabs[key]]);
      const winner = r.rows[0];
      if (!winner) continue; // already flagged as a FAIL above if the tab has 0 rows
      if (!winner.image_url) {
        add('Players', `${key} winner portrait`, 'FAIL', `${winner.canonical_name} — image_url is null`);
      } else if (!fileExists(winner.image_url)) {
        add('Players', `${key} winner portrait`, 'FAIL', `${winner.canonical_name} — file missing: ${winner.image_url}`);
      } else {
        add('Players', `${key} winner portrait`, 'PASS', winner.canonical_name);
      }
    }
  }

  // --- All-Time (event 81): Players All-Time / Teams All-Time are computed
  // live from games/standings/player_season_stats — no data of their own to
  // check — but the season+tabs scaffolding must exist or the frontend shows
  // "No data available" even though the underlying stats are all there.
  // ensure-nba-season.js didn't create this event until this was caught live
  // for 2015 — re-run ensure-nba-season.js for any year that FAILs here.
  const allTimeSeasonId = await getSeasonId(EVENTS.ALLTIME, year);
  add('All-Time', 'season row', allTimeSeasonId ? 'PASS' : 'FAIL');
  if (allTimeSeasonId) {
    const tabs = await getTabIds(allTimeSeasonId);
    for (const key of ['all-time-players', 'all-time-teams']) {
      add('All-Time', `tab '${key}'`, tabs[key] ? 'PASS' : 'FAIL', tabs[key] ? `tab_id ${tabs[key]}` : 'missing');
    }
  }

  // --- Iconic Moments season picker: does this year show up in the admin
  // "create iconic moment" dropdown? That dropdown is fed unfiltered by
  // GET /seasons/by-competition (see IconicMoments.jsx), which returns every
  // seasons row for the competition regardless of event — so this just
  // checks that at least one seasons row exists for the year.
  const anySeasonThisYear = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM seasons WHERE competition_id = $1 AND year = $2)`,
    [COMPETITION_ID, year]
  );
  add('Media', 'appears in iconic-moment season picker', anySeasonThisYear.rows[0].exists ? 'PASS' : 'FAIL');

  return results;
}

function statusOrder(s) { return { FAIL: 0, WARN: 1, INFO: 2, PASS: 3, 'N/A': 4 }[s] ?? 5; }

function printYearReport(year, results) {
  console.log(`\n=== NBA ${year} ===`);
  const bySection = {};
  for (const r of results) {
    bySection[r.section] = bySection[r.section] || [];
    bySection[r.section].push(r);
  }
  for (const [section, checks] of Object.entries(bySection)) {
    console.log(`  ${section}`);
    for (const c of checks.sort((a, b) => statusOrder(a.status) - statusOrder(b.status))) {
      console.log(`    [${c.status.padEnd(4)}] ${c.check}${c.detail ? ' — ' + c.detail : ''}`);
    }
  }
}

async function main() {
  const startYear = parseInt(process.argv[2], 10);
  const endYear = parseInt(process.argv[3], 10) || startYear;
  if (!startYear) {
    console.error('Usage: node qa-nba-season.js <startYear> [endYear]');
    process.exit(1);
  }

  const logoCheck = await checkTeamLogos();
  console.log(`=== Team Logos (one-time, ${logoCheck.total} teams) ===`);
  if (logoCheck.problems.length === 0) {
    console.log('  [PASS] all teams have image_url + file on disk');
  } else {
    for (const p of logoCheck.problems) console.log(`  [FAIL] ${p.team} — ${p.detail}`);
  }

  const failsByYear = {};
  for (let year = startYear; year <= endYear; year++) {
    const results = await checkYear(year);
    printYearReport(year, results);
    const fails = results.filter(r => r.status === 'FAIL');
    if (fails.length) failsByYear[year] = fails;
  }

  console.log('\n=== Summary ===');
  const yearsWithFails = Object.keys(failsByYear);
  if (yearsWithFails.length === 0) {
    console.log('  No FAILs across the range.');
  } else {
    for (const year of yearsWithFails) {
      console.log(`  ${year}: ${failsByYear[year].length} FAIL(s)`);
      for (const f of failsByYear[year]) console.log(`    - [${f.section}] ${f.check}${f.detail ? ' — ' + f.detail : ''}`);
    }
  }

  await end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
