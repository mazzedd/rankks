// Ingests NBA Regular Season player box scores from PlayerStatisticsExtended.csv
// for one season year, aggregated per player into player_season_stats — backs
// Regular Season's "Players" tab (BASK-NAV-01 page 9's Players Template: per-game
// averages — Min/Pts/FGM/FGA/3PM/3PA/FTM/FTA/Reb/Ast/Blk/To).
//
// Streams the file line-by-line rather than csv-parse/sync-ing the whole thing —
// PlayerStatisticsExtended.csv is 110 columns across every season since 1946 and
// blows the default heap trying to load it all at once.
//
// personId (this file's player key) is NOT the same id system as bref_player_id
// (Award Shares/EOST/All-Star/Draft Pick History) — no crosswalk file exists
// between the two Kaggle datasets, confirmed earlier. Entities created here are
// keyed by external_ids->>'nba_person_id', a separate identity set from the
// bref-id player entities created by nba-player-lookup.js for Awards/EOST.
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'PlayerStatisticsExtended.csv');
const COMPETITION_ID = 4828;
const REGULAR_SEASON_EVENT_ID = 74;

const seasonYearArg = parseInt(process.argv[2], 10);
if (!seasonYearArg) {
  console.error('Usage: node ingest-nba-player-boxscores.js <seasonYear>');
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

function slugify(name) {
  const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
  return name.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Streams the CSV, keeping only Regular Season rows for the target year (matched
// on the gameDateTimeEst year-month the same way TeamStatistics.csv's season
// boundary works: an NBA season spans two calendar years, Oct-Jun, and the
// source's own row already carries "seasonYear-" prefix conventions elsewhere —
// simplest and most robust here is checking gameDateTimeEst falls within the
// season's real date window, derived from the already-ingested games table
// rather than re-deriving it from scratch.
async function loadSeasonDateWindow() {
  const row = await pool.query(
    `SELECT MIN(match_date) AS start_date, MAX(match_date) AS end_date
     FROM games g JOIN result_tabs rt ON rt.id = g.result_tab_id
     JOIN seasons s ON s.id = rt.season_id
     WHERE s.competition_id = $1 AND s.event_id = $2 AND s.year = $3 AND rt.tab_key = 'results'`,
    [COMPETITION_ID, REGULAR_SEASON_EVENT_ID, seasonYearArg]
  );
  return row.rows[0];
}

async function streamAggregate(startDate, endDate) {
  const rl = readline.createInterface({ input: fs.createReadStream(CSV_PATH) });
  let header = null;
  const byPlayer = new Map(); // personId -> { name, games: [], teamCounts: Map }

  for await (const line of rl) {
    if (!header) { header = parse(line, { columns: false })[0]; continue; }
    if (!line.includes('Regular Season')) continue; // cheap pre-filter before full parse
    const row = parse(line, { columns: false })[0];
    const r = header.reduce((o, h, i) => (o[h] = row[i], o), {});
    if (r.gameType !== 'Regular Season') continue;
    const gameDate = r.gameDateTimeEst?.slice(0, 10);
    if (!gameDate || gameDate < startDate || gameDate > endDate) continue;
    if (!r.personId) continue;

    if (!byPlayer.has(r.personId)) {
      byPlayer.set(r.personId, {
        name: `${r.firstName} ${r.lastName}`.trim(),
        games: [],
        teamCounts: new Map(),
      });
    }
    const p = byPlayer.get(r.personId);
    p.games.push(r);
    // 2021-22 season: playerteamId is blank for ~99.9% of rows in this CSV
    // (same class of gap as TeamStatistics.csv's blank gameType/gameLabel
    // that season) — but playerteamCity/playerteamName are still populated,
    // so fall back to the team's full name as the counting key when the id
    // is missing; resolved against teamNameMap below alongside teamMap.
    const teamKey = r.playerteamId || `${r.playerteamCity} ${r.playerteamName}`;
    p.teamCounts.set(teamKey, (p.teamCounts.get(teamKey) || 0) + 1);
  }

  return byPlayer;
}

function avg(nums) {
  const valid = nums.filter(n => n != null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function sum(nums) {
  const valid = nums.filter(n => n != null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0);
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

async function resolvePlayerEntity(personId, name) {
  const existing = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND external_ids->>'nba_person_id' = $1`,
    [personId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  let slug = slugify(name);
  const slugTaken = await pool.query(`SELECT 1 FROM entities WHERE slug = $1`, [slug]);
  if (slugTaken.rows.length) slug = `${slug}-${personId}`;

  const imageUrl = `https://cdn.nba.com/headshots/nba/latest/1040x760/${personId}.png`;
  const inserted = await pool.query(
    `INSERT INTO entities (entity_type, canonical_name, slug, image_url, external_ids, is_active)
     VALUES ('player', $1, $2, $3, $4::jsonb, true) RETURNING id`,
    [name, slug, imageUrl, JSON.stringify({ nba_person_id: personId })]
  );
  return inserted.rows[0].id;
}

async function main() {
  const { start_date, end_date } = await loadSeasonDateWindow();
  if (!start_date) {
    console.error(`No Regular Season Results games found for ${seasonYearArg} — run ingest-nba-games.js first.`);
    process.exit(1);
  }
  const startDate = start_date.toISOString().slice(0, 10);
  const endDate = end_date.toISOString().slice(0, 10);
  console.log(`Aggregating box scores from ${startDate} to ${endDate}...`);

  const byPlayer = await streamAggregate(startDate, endDate);
  console.log(`${byPlayer.size} players found`);

  const teamRows = await pool.query(`SELECT id, canonical_name, external_ids->>'nba_team_id' AS nba_team_id FROM entities WHERE entity_type='club' AND external_ids ? 'nba_team_id'`);
  const teamMap = new Map(teamRows.rows.map(r => [r.nba_team_id, r.id]));
  const teamNameMap = new Map(teamRows.rows.map(r => [r.canonical_name, r.id]));
  // playerteamCity+playerteamName builds "Los Angeles Clippers" — the only
  // team whose stored canonical_name uses the shortened "LA" convention
  // instead of the full city name (every other team's canonical_name is an
  // exact city+name match).
  if (teamNameMap.has('LA Clippers')) teamNameMap.set('Los Angeles Clippers', teamNameMap.get('LA Clippers'));

  const seasonRow = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, REGULAR_SEASON_EVENT_ID, seasonYearArg]
  );
  const seasonId = seasonRow.rows[0].id;
  const tabId = await getOrCreatePlayersTab(seasonId);
  await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);

  let n = 0;
  for (const [personId, p] of byPlayer) {
    const entityId = await resolvePlayerEntity(personId, p.name);

    const mostFrequentTeamId = [...p.teamCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const clubEntityId = teamMap.get(mostFrequentTeamId) || teamNameMap.get(mostFrequentTeamId) || null;

    const fgm = avg(p.games.map(g => numOrNull(g.fieldGoalsMade)));
    const fga = avg(p.games.map(g => numOrNull(g.fieldGoalsAttempted)));
    const tpm = avg(p.games.map(g => numOrNull(g.threePointersMade)));
    const tpa = avg(p.games.map(g => numOrNull(g.threePointersAttempted)));
    const ftm = avg(p.games.map(g => numOrNull(g.freeThrowsMade)));
    const fta = avg(p.games.map(g => numOrNull(g.freeThrowsAttempted)));

    const fgmTotal = sum(p.games.map(g => numOrNull(g.fieldGoalsMade)));
    const fgaTotal = sum(p.games.map(g => numOrNull(g.fieldGoalsAttempted)));
    const tpmTotal = sum(p.games.map(g => numOrNull(g.threePointersMade)));
    const tpaTotal = sum(p.games.map(g => numOrNull(g.threePointersAttempted)));
    const ftmTotal = sum(p.games.map(g => numOrNull(g.freeThrowsMade)));
    const ftaTotal = sum(p.games.map(g => numOrNull(g.freeThrowsAttempted)));

    // assists/minutes_played are INTEGER columns in player_season_stats (built
    // for football's whole-number career totals) — per-game averages like
    // "5.3 apg" don't fit there, so both live in stats jsonb instead (getValue's
    // existing fallback already checks stats.minutes before minutes_played).
    // minutes_played itself gets a rounded-integer fallback for safety.
    const minutesAvg = avg(p.games.map(g => numOrNull(g.numMinutes)))
    const stats = {
      minutes:   round(minutesAvg),
      assists:   round(avg(p.games.map(g => numOrNull(g.assists)))),
      points:    round(avg(p.games.map(g => numOrNull(g.points)))),
      rebounds:  round(avg(p.games.map(g => numOrNull(g.reboundsTotal)))),
      steals:    round(avg(p.games.map(g => numOrNull(g.steals)))),
      blocks:    round(avg(p.games.map(g => numOrNull(g.blocks)))),
      turnovers: round(avg(p.games.map(g => numOrNull(g.turnovers)))),
      fgm: round(fgm), fga: round(fga), fg_pct: (fgm != null && fga) ? round(fgm / fga, 3) : null,
      tpm: round(tpm), tpa: round(tpa), tp_pct: (tpm != null && tpa) ? round(tpm / tpa, 3) : null,
      ftm: round(ftm), fta: round(fta), ft_pct: (ftm != null && fta) ? round(ftm / fta, 3) : null,
      // Exact season totals, summed straight from each game's raw box score —
      // not the per-game averages above multiplied back out, which would
      // compound rounding error. fg_pct/tp_pct/ft_pct are the same value
      // whether derived from per-game or total made/attempted (avg(a)/avg(b)
      // == sum(a)/sum(b)), so they aren't duplicated here — the UI reuses
      // the per-game percentage in both stat-mode views.
      totals: {
        // numMinutes is fractional per game (e.g. 34.62) — summing many of
        // them accumulates float error (2244.9799999999996), so round to a
        // whole minute like every other total here already is.
        minutes:   round(sum(p.games.map(g => numOrNull(g.numMinutes))), 0),
        assists:   sum(p.games.map(g => numOrNull(g.assists))),
        points:    sum(p.games.map(g => numOrNull(g.points))),
        rebounds:  sum(p.games.map(g => numOrNull(g.reboundsTotal))),
        steals:    sum(p.games.map(g => numOrNull(g.steals))),
        blocks:    sum(p.games.map(g => numOrNull(g.blocks))),
        turnovers: sum(p.games.map(g => numOrNull(g.turnovers))),
        fgm: fgmTotal, fga: fgaTotal,
        tpm: tpmTotal, tpa: tpaTotal,
        ftm: ftmTotal, fta: ftaTotal,
      },
    };

    await pool.query(
      `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, club_entity_id, games_played, minutes_played, stats)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        entityId, seasonId, tabId, clubEntityId,
        p.games.length,
        minutesAvg != null ? Math.round(minutesAvg) : null,
        JSON.stringify(stats),
      ]
    );
    n++;
    if (n % 100 === 0) console.log(`  ...${n} players ingested`);
  }

  console.log(`Done: ${n} players ingested for ${seasonYearArg}`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
