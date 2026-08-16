// Ingests NBA All-Star Selections for one season year — per onboarding-nba.md
// Section 1/2: roster-only (who was selected + `replaced` flag for injury
// replacements). The CSV's own `team` column (All-Star team/side assignment)
// is era-inconsistent — checked every year's distinct `team` values directly:
//   1951-2017, 2024        → exactly 'East'/'West'
//   2018-2022               → captain-named 2-team ('Team LeBron'/'Team Stephen', etc.)
//   2023                    → captain-named, no 'Team ' prefix ('Giannis'/'LeBron')
//   2025-2026               → 3-team mini-tournament ('Team Stars'/'Team Stripes'/'Team World', etc.)
// 2023's missing 'Team ' prefix is normalized back on before use (see below)
// so tab_name stays 'Team Giannis'/'Team LeBron' like every other
// captain-draft year, rather than surfacing the source's bare-name quirk.
// Per Mohamed's call: years that are cleanly East/West get split into two
// Line B tabs (Eastern Conf./Western Conf.), matching the Playoffs/Play-in
// naming. Every other year gets one Line B tab per distinct team name found
// in the source that year (e.g. "Team LeBron"/"Team Stephen") — tab_key/
// tab_name are dynamic since team names differ every year, unlike the fixed
// conference tabs. Ordered by first appearance in the source (draft order —
// team captain picked first).
//
// Same shape as ingest-nba-awards.js: own `seasons` row keyed by event_id,
// result_tab(s) typology='players', club/box-score stats pulled from the
// same year's Regular Season row via the shared nba-player-lookup helper —
// the CSV itself carries no box-score data.
//
// Source spans 1951-2026 and includes a one-off 1976 ABA All-Star Game
// (`lg` = 'ABA') from before the ABA-NBA merger — filtered out, this
// competition is NBA-only.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { loadCareerInfo, resolvePlayerEntity, getRegularSeasonStats } = require('./nba-player-lookup');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'All-Star Selections.csv');
const COMPETITION_ID = 4828;
const ALL_STAR_EVENT_ID = 80;

// display_order starts at 2 — 1 is reserved for the 'results' tab created
// by the companion ingest-nba-all-star-results.js (this script only owns
// the roster tabs). MVP sits after every roster tab (Line B order: Results,
// [team/conference tabs], MVP) — that script gives it a fixed 99 rather
// than coordinating with however many roster tabs a given year has.
const CONFERENCE_TABS = [
  { team: 'East', tabKey: 'eastern-conference', tabName: 'Eastern Conf.', displayOrder: 2 },
  { team: 'West', tabKey: 'western-conference', tabName: 'Western Conf.', displayOrder: 3 },
];
const RESERVED_TAB_KEYS = ['results', 'mvp'];

function slugifyTeamName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-all-star.js <seasonYear>');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

async function getOrCreateSeason(year) {
  const existing = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, ALL_STAR_EVENT_ID, year]
  );
  if (existing.rows.length) return existing.rows[0].id;
  // All-Star has no games of its own in scope (see onboarding doc — the
  // actual All-Star Game box score is a separate, out-of-scope question) to
  // derive dates from — borrows Regular Season's start/end_date, same as
  // Awards, so calcAge.js has a reference date to compute Age against.
  const regSeason = await pool.query(
    `SELECT start_date, end_date FROM seasons WHERE competition_id = $1 AND event_id = 74 AND year = $2`,
    [COMPETITION_ID, year]
  );
  const { start_date, end_date } = regSeason.rows[0] || {};
  const inserted = await pool.query(
    `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition, start_date, end_date)
     VALUES ($1, $2, $3, 'past', 'M', 1, $4, $5) RETURNING id`,
    [COMPETITION_ID, ALL_STAR_EVENT_ID, year, start_date || null, end_date || null]
  );
  return inserted.rows[0].id;
}

async function getOrCreateTab(seasonId, tabKey, tabName, displayOrder) {
  const existing = await pool.query(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
    [seasonId, tabKey]
  );
  if (existing.rows.length) {
    // Sync tab_name/display_order/is_default on re-runs too — not just
    // insert-once — since a re-run can change which tab_key sits first
    // (e.g. Results/MVP were added later and now claim display_order 1/2).
    await pool.query(
      `UPDATE result_tabs SET tab_name = $2, display_order = $3, is_default = $4 WHERE id = $1`,
      [existing.rows[0].id, tabName, displayOrder, displayOrder === 1]
    );
    return existing.rows[0].id;
  }
  const inserted = await pool.query(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
     VALUES ($1, $2, $3, 'players', $4, $5) RETURNING id`,
    [seasonId, tabName, tabKey, displayOrder, displayOrder === 1]
  );
  return inserted.rows[0].id;
}

// Drops every existing result_tab for this season NOT in keepTabKeys — e.g.
// a year first ingested as a flat 'all-star' tab (or under an older format's
// tab_keys) before this run's split logic decided the real shape for that
// year. Never touches RESERVED_TAB_KEYS (results/mvp) — those are owned by
// the companion ingest-nba-all-star-results.js script. No-op for tabs that
// don't exist.
async function dropStaleTabsExcept(seasonId, keepTabKeys) {
  const existing = await pool.query(
    `SELECT id, tab_key FROM result_tabs WHERE season_id = $1`,
    [seasonId]
  );
  for (const tab of existing.rows) {
    if (keepTabKeys.includes(tab.tab_key) || RESERVED_TAB_KEYS.includes(tab.tab_key)) continue;
    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tab.id]);
    await pool.query(`DELETE FROM result_tabs WHERE id = $1`, [tab.id]);
  }
}

async function ingestRows(seasonId, tabId, rows, careerInfo) {
  await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);
  for (const row of rows) {
    const entityId = await resolvePlayerEntity(pool, row.player_id, row.player, careerInfo);
    const regStats = await getRegularSeasonStats(pool, COMPETITION_ID, entityId, seasonYearArg);
    const stats = {
      replaced: row.replaced === 'TRUE',
      ...regStats,
    };
    await pool.query(
      `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, stats)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [entityId, seasonId, tabId, JSON.stringify(stats)]
    );
  }
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  const careerInfo = loadCareerInfo();

  const rows = records.filter(r => r.lg === 'NBA' && r.season === String(seasonYearArg));
  if (!rows.length) {
    console.log(`All-Star ${seasonYearArg}: no selections in source — skipping (game likely didn't happen or predates coverage)`);
    await pool.end();
    return;
  }

  // 2023's source rows carry the captain's bare name ('Giannis'/'LeBron')
  // instead of every other captain-draft year's 'Team '-prefixed name
  // ('Team LeBron'/'Team Durant') — normalized here so tab_name stays
  // consistent across all captain-draft years regardless of source quirk.
  for (const r of rows) {
    if (r.team !== 'East' && r.team !== 'West' && !r.team.startsWith('Team ')) {
      r.team = `Team ${r.team}`;
    }
  }

  const teamValues = new Set(rows.map(r => r.team));
  const isConferenceFormat = [...teamValues].every(t => t === 'East' || t === 'West');

  const seasonId = await getOrCreateSeason(seasonYearArg);

  if (isConferenceFormat) {
    await dropStaleTabsExcept(seasonId, CONFERENCE_TABS.map(c => c.tabKey));
    for (const conf of CONFERENCE_TABS) {
      const tabId = await getOrCreateTab(seasonId, conf.tabKey, conf.tabName, conf.displayOrder);
      const confRows = rows.filter(r => r.team === conf.team);
      await ingestRows(seasonId, tabId, confRows, careerInfo);
      console.log(`All-Star ${seasonYearArg} ${conf.tabName}: ${confRows.length} selections ingested`);
    }
  } else {
    // One Line B tab per distinct team name, ordered by first appearance
    // in the source (draft/captain order).
    const teamNames = [];
    for (const r of rows) if (!teamNames.includes(r.team)) teamNames.push(r.team);
    const teamTabs = teamNames.map((team, i) => ({
      team, tabKey: slugifyTeamName(team), tabName: team, displayOrder: i + 2,
    }));

    await dropStaleTabsExcept(seasonId, teamTabs.map(t => t.tabKey));
    for (const t of teamTabs) {
      const tabId = await getOrCreateTab(seasonId, t.tabKey, t.tabName, t.displayOrder);
      const teamRows = rows.filter(r => r.team === t.team);
      await ingestRows(seasonId, tabId, teamRows, careerInfo);
      console.log(`All-Star ${seasonYearArg} ${t.tabName}: ${teamRows.length} selections ingested`);
    }
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
