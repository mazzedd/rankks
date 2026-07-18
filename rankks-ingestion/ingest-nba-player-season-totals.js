// Ingests NBA Regular Season player stats for one season year from
// Player Totals.csv, for years PlayerStatisticsExtended.csv (the per-game
// box-score source ingest-nba-player-boxscores.js depends on) doesn't cover.
// Confirmed live: that file's earliest date is 1996-11-01 — every season
// 1946-47 through 1995-96 (year <= 1996) has zero per-game box scores
// available, so ingest-nba-player-boxscores.js silently writes 0 rows for
// those years. Player Totals.csv covers 1947-2026 instead, at season-total
// granularity (not per-game), keyed by the same bref player_id system as
// Awards/EOST/positions — reuses nba-player-lookup.js's resolvePlayerEntity
// so these years' player entities merge cleanly with anything Awards/EOST
// already created, no new duplicate-entity class.
//
// Traded players get a combined "2TM"/"3TM" row (season totals) plus one row
// per team stint — same convention as Player Season Info.csv (see
// ingest-nba-positions.js's identical handling). The combined row is used
// for stats; club_entity_id is whichever individual stint has the most
// games, matching ingest-nba-player-boxscores.js's "most frequent team"
// convention for the box-score era.
//
// stats jsonb shape is intentionally identical to ingest-nba-player-boxscores.js's
// so results.js's existing reads work unchanged for these years too.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { loadCareerInfo, resolvePlayerEntity } = require('./nba-player-lookup');

const TOTALS_CSV = path.join(__dirname, '..', '00-nba', 'Player Totals.csv');
const TEAM_ABBREV_CSV = path.join(__dirname, '..', '00-nba', 'Team Abbrev.csv');
const TEAM_STATS_CSV = path.join(__dirname, '..', '00-nba', 'TeamStatistics.csv');
const COMPETITION_ID = 4828;
const REGULAR_SEASON_EVENT_ID = 74;

const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-player-season-totals.js <seasonYear>');
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
  if (v === '' || v === undefined || v === null || v === 'NA') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function round(n, dp = 1) {
  return n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp;
}

async function getOrCreatePlayersTab(seasonId) {
  const existing = await pool.query(`SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = 'players'`, [seasonId]);
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
     VALUES ($1, 'Players', 'players', 'players', 3, false) RETURNING id`,
    [seasonId]
  );
  return inserted.rows[0].id;
}

// abbreviation (this season) -> entity_id, bridged through TeamStatistics.csv's
// teamId (stable across relocations) rather than matching names directly —
// entities.canonical_name reflects the CURRENT franchise name (e.g. "Oklahoma
// City Thunder"), which wouldn't match an old season's "Seattle SuperSonics"
// row in Team Abbrev.csv.
async function buildAbbrevToEntityMap(year) {
  const dateWindow = await pool.query(
    `SELECT MIN(match_date) AS start_date, MAX(match_date) AS end_date
     FROM games g JOIN result_tabs rt ON rt.id = g.result_tab_id
     JOIN seasons s ON s.id = rt.season_id
     WHERE s.competition_id = $1 AND s.event_id = $2 AND s.year = $3 AND rt.tab_key = 'results'`,
    [COMPETITION_ID, REGULAR_SEASON_EVENT_ID, year]
  );
  const { start_date, end_date } = dateWindow.rows[0];
  if (!start_date) throw new Error(`No Regular Season games found for ${year} — run ingest-nba-games.js first.`);
  const startDate = start_date.toISOString().slice(0, 10);
  const endDate = end_date.toISOString().slice(0, 10);

  const teamStatsRaw = fs.readFileSync(TEAM_STATS_CSV, 'utf8');
  const teamStatsRows = parse(teamStatsRaw, { columns: true, skip_empty_lines: true });
  const nameToTeamId = new Map();
  for (const r of teamStatsRows) {
    const d = r.gameDateTimeEst?.slice(0, 10);
    if (!d || d < startDate || d > endDate) continue;
    nameToTeamId.set(`${r.teamCity} ${r.teamName}`, r.teamId);
  }

  const abbrevRaw = fs.readFileSync(TEAM_ABBREV_CSV, 'utf8');
  const abbrevRows = parse(abbrevRaw, { columns: true, skip_empty_lines: true })
    .filter(r => r.season === String(year));

  const teamRows = await pool.query(
    `SELECT id, external_ids->>'nba_team_id' AS nba_team_id FROM entities WHERE entity_type='club' AND external_ids ? 'nba_team_id'`
  );
  const teamIdToEntity = new Map(teamRows.rows.map(r => [r.nba_team_id, r.id]));

  // Exact-match first; TeamStatistics.csv and Team Abbrev.csv occasionally
  // spell the same historical franchise differently in older eras (caught
  // live: "Fort Wayne Pistons" vs "Ft. Wayne Zollner Pistons", a 1950s
  // sponsor-name convention) — fall back to matching on the last word
  // (the franchise nickname, the stable part across such naming quirks)
  // when the full string doesn't match anything in this season's window.
  function resolveTeamId(teamName) {
    if (nameToTeamId.has(teamName)) return nameToTeamId.get(teamName);
    const nickname = teamName.trim().split(/\s+/).pop();
    for (const [key, id] of nameToTeamId) {
      if (key.endsWith(` ${nickname}`)) return id;
    }
    return undefined;
  }

  const abbrevToEntity = new Map();
  for (const r of abbrevRows) {
    const teamId = resolveTeamId(r.team);
    const entityId = teamId && teamIdToEntity.get(teamId);
    if (entityId) abbrevToEntity.set(r.abbreviation, entityId);
  }
  return abbrevToEntity;
}

async function main() {
  const totalsRaw = fs.readFileSync(TOTALS_CSV, 'utf8');
  const totalsRows = parse(totalsRaw, { columns: true, skip_empty_lines: true })
    .filter(r => r.season === String(seasonYearArg) && r.lg === 'NBA');

  const byPlayerId = new Map();
  for (const r of totalsRows) {
    if (!byPlayerId.has(r.player_id)) byPlayerId.set(r.player_id, []);
    byPlayerId.get(r.player_id).push(r);
  }
  console.log(`${byPlayerId.size} unique players in source for ${seasonYearArg}`);

  const careerInfo = loadCareerInfo();
  const abbrevToEntity = await buildAbbrevToEntityMap(seasonYearArg);

  const seasonRow = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, REGULAR_SEASON_EVENT_ID, seasonYearArg]
  );
  const seasonId = seasonRow.rows[0].id;
  const tabId = await getOrCreatePlayersTab(seasonId);
  await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);

  let n = 0, noTeamMatch = 0;
  for (const [playerId, group] of byPlayerId) {
    const combined = group.find(r => /^\dTM$/.test(r.team)) || group[0];
    const stints = group.filter(r => !/^\dTM$/.test(r.team));
    const primaryStint = (stints.length ? stints : group).sort((a, b) => numOrNull(b.g) - numOrNull(a.g))[0];
    const clubEntityId = abbrevToEntity.get(primaryStint.team) || null;
    if (!clubEntityId) noTeamMatch++;

    const entityId = await resolvePlayerEntity(pool, playerId, combined.player, careerInfo);

    const games = numOrNull(combined.g);
    const fgm = numOrNull(combined.fg), fga = numOrNull(combined.fga);
    const tpm = numOrNull(combined.x3p), tpa = numOrNull(combined.x3pa);
    const ftm = numOrNull(combined.ft), fta = numOrNull(combined.fta);
    const minutesTotal = numOrNull(combined.mp);

    const perGame = (total) => (total != null && games) ? round(total / games) : null;

    const stats = {
      minutes:   perGame(minutesTotal),
      assists:   perGame(numOrNull(combined.ast)),
      points:    perGame(numOrNull(combined.pts)),
      rebounds:  perGame(numOrNull(combined.trb)),
      steals:    perGame(numOrNull(combined.stl)),
      blocks:    perGame(numOrNull(combined.blk)),
      turnovers: perGame(numOrNull(combined.tov)),
      fgm: perGame(fgm), fga: perGame(fga), fg_pct: (fgm != null && fga) ? round(fgm / fga, 3) : null,
      tpm: perGame(tpm), tpa: perGame(tpa), tp_pct: (tpm != null && tpa) ? round(tpm / tpa, 3) : null,
      ftm: perGame(ftm), fta: perGame(fta), ft_pct: (ftm != null && fta) ? round(ftm / fta, 3) : null,
      totals: {
        minutes: minutesTotal, assists: numOrNull(combined.ast), points: numOrNull(combined.pts),
        rebounds: numOrNull(combined.trb), steals: numOrNull(combined.stl), blocks: numOrNull(combined.blk),
        turnovers: numOrNull(combined.tov), fgm, fga, tpm, tpa, ftm, fta,
      },
    };

    await pool.query(
      `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, club_entity_id, games_played, minutes_played, stats)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [entityId, seasonId, tabId, clubEntityId, games, minutesTotal != null && games ? Math.round(minutesTotal / games) : null, JSON.stringify(stats)]
    );
    n++;
    if (n % 100 === 0) console.log(`  ...${n} players ingested`);
  }

  console.log(`Done: ${n} players ingested for ${seasonYearArg} (${noTeamMatch} with no club_entity_id match)`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
