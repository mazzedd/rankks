// One-off ingestion for NBA Cup MVP + NBA Cup Teams (All-Tournament Team) — DB years
// 2024/2025/2026 (2023 In-Season Tournament, 2024 Cup, 2025 Cup editions).
//
// No Kaggle source covers this (Player Award Shares.csv has no NBA Cup award at all) — hand
// -compiled from Wikipedia's "2023 NBA In-Season Tournament" / "2024 NBA Cup" / "2025 NBA Cup"
// articles' "Awards and aftermath" sections (cross-checked against TeamStatistics.csv's own
// Championship game scores, which match exactly).
//
// The real NBA Cup All-Tournament Team is ONE 5-player list spanning both conferences (not
// split East/West, confirmed via the "NBA Cup" general Wikipedia article and all 3 season
// articles) — same shape as All-NBA 1st/2nd/3rd, so it reuses that pattern: one result_tab,
// ranked (here: MVP first, then the rest in the order Wikipedia's own table lists them, which
// is position-ordered G/G/G/F/C, not a real vote count nobody publishes) via ranking_at_event.
const { Pool } = require('pg');

const COMPETITION_ID = 4828;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// Source: Wikipedia "Awards and aftermath" section of each edition's article.
const SEASONS = [
  {
    year: 2024, // 2023 NBA In-Season Tournament (inaugural)
    mvp: { player: 'LeBron James', team: 'Los Angeles Lakers' },
    team: [
      { player: 'Tyrese Haliburton',      team: 'Indiana Pacers' },
      { player: 'Giannis Antetokounmpo',  team: 'Milwaukee Bucks' },
      { player: 'Kevin Durant',           team: 'Phoenix Suns' },
      { player: 'LeBron James',           team: 'Los Angeles Lakers' }, // MVP
      { player: 'Anthony Davis',          team: 'Los Angeles Lakers' },
    ],
  },
  {
    year: 2025, // 2024 NBA Cup
    mvp: { player: 'Giannis Antetokounmpo', team: 'Milwaukee Bucks' },
    team: [
      { player: 'Trae Young',              team: 'Atlanta Hawks' },
      { player: 'Shai Gilgeous-Alexander', team: 'Oklahoma City Thunder' },
      { player: 'Damian Lillard',          team: 'Milwaukee Bucks' },
      { player: 'Giannis Antetokounmpo',   team: 'Milwaukee Bucks' }, // MVP
      { player: 'Alperen Şengün',          team: 'Houston Rockets' },
    ],
  },
  {
    year: 2026, // 2025 NBA Cup
    mvp: { player: 'Jalen Brunson', team: 'New York Knicks' },
    team: [
      { player: 'Jalen Brunson',           team: 'New York Knicks' }, // MVP
      { player: 'Luka Dončić',             team: 'Los Angeles Lakers' },
      { player: 'De\'Aaron Fox',           team: 'San Antonio Spurs' },
      { player: 'Shai Gilgeous-Alexander', team: 'Oklahoma City Thunder' },
      { player: 'Karl-Anthony Towns',      team: 'New York Knicks' },
    ],
  },
];

const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
function stripDiacritics(s) { return s.normalize('NFD').replace(DIACRITICS_RE, ''); }

async function resolvePlayer(name) {
  const exact = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND canonical_name = $1`, [name]
  );
  if (exact.rows.length === 1) return exact.rows[0].id;

  const stripped = stripDiacritics(name);
  const fuzzy = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND regexp_replace(canonical_name, '[̀-ͯ]', '', 'g') = $1`,
    [stripped]
  );
  if (fuzzy.rows.length === 1) return fuzzy.rows[0].id;

  throw new Error(`No unique player match for "${name}" (${exact.rows.length + fuzzy.rows.length} candidates)`);
}

async function resolveClub(name) {
  const row = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'club' AND canonical_name = $1`, [name]
  );
  if (row.rows.length !== 1) throw new Error(`No unique club match for "${name}" (${row.rows.length} candidates)`);
  return row.rows[0].id;
}

// Same box-score fallback ingest-nba-awards-2026-manual.js uses — Min/Pts/shooting splits
// pulled from the player's Regular Season row for that year, since the Cup awards themselves
// carry no box-score data of their own.
async function getRegularSeasonStats(entityId, year) {
  const row = await pool.query(`
    SELECT reg.club_entity_id, reg.stats
    FROM player_season_stats reg
    JOIN result_tabs rt ON rt.id = reg.result_tab_id
    JOIN seasons s ON s.id = rt.season_id
    WHERE rt.tab_key = 'players' AND s.competition_id = $1 AND s.event_id = 74 AND s.year = $2
      AND reg.entity_id = $3
    LIMIT 1
  `, [COMPETITION_ID, year, entityId]);
  const r = row.rows[0];
  if (!r) return {};
  const s = r.stats || {};
  const t = s.totals || {};
  return {
    fgm: s.fgm ?? null, fg_pct: s.fg_pct ?? null,
    tpm: s.tpm ?? null, tp_pct: s.tp_pct ?? null,
    ftm: s.ftm ?? null, ft_pct: s.ft_pct ?? null,
    assists: s.assists ?? null, rebounds: s.rebounds ?? null, blocks: s.blocks ?? null,
    totals: {
      fgm: t.fgm ?? null, tpm: t.tpm ?? null, ftm: t.ftm ?? null,
      assists: t.assists ?? null, rebounds: t.rebounds ?? null, blocks: t.blocks ?? null,
    },
  };
}

async function getTabId(year, tabKey) {
  const row = await pool.query(`
    SELECT rt.id FROM result_tabs rt
    JOIN seasons s ON s.id = rt.season_id
    JOIN events ev ON ev.id = s.event_id
    WHERE s.competition_id = $1 AND s.year = $2 AND ev.slug = 'awards-4828' AND rt.tab_key = $3
  `, [COMPETITION_ID, year, tabKey]);
  if (!row.rows.length) throw new Error(`Tab ${tabKey} not found for year ${year} — create result_tabs first.`);
  return row.rows[0].id;
}

async function main() {
  for (const season of SEASONS) {
    const mvpTabId = await getTabId(season.year, 'nba-cup-mvp');
    const teamTabId = await getTabId(season.year, 'nba-cup-teams');

    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [mvpTabId]);
    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [teamTabId]);

    // MVP tab: single winner row. club_entity_id goes in stats jsonb, not the real column —
    // the same player (e.g. LeBron James, 2024) can legitimately be both MVP and on the
    // All-Tournament Team in the same season/club, which would collide on
    // uq_player_season_club (UNIQUE entity_id, season_id, club_entity_id) if both rows set
    // the real column. Same workaround ingest-nba-awards.js already uses for this exact class
    // of collision — the players API route already falls back to stats->>'club_entity_id'
    // when the real column is null.
    const mvpEntityId = await resolvePlayer(season.mvp.player);
    const mvpClubId = await resolveClub(season.mvp.team);
    const mvpRegStats = await getRegularSeasonStats(mvpEntityId, season.year);
    await pool.query(
      `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
       VALUES ($1, (SELECT season_id FROM result_tabs WHERE id = $2), $2, 1, $3::jsonb)`,
      [mvpEntityId, mvpTabId, JSON.stringify({ winner: true, club_entity_id: mvpClubId, ...mvpRegStats })]
    );
    console.log(`${season.year} NBA Cup MVP: ${season.mvp.player} ingested`);

    // Teams tab: 5-player All-Tournament Team, ranked in Wikipedia's own listed order.
    let rank = 1;
    for (const c of season.team) {
      const entityId = await resolvePlayer(c.player);
      const clubId = await resolveClub(c.team);
      const regStats = await getRegularSeasonStats(entityId, season.year);
      await pool.query(
        `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
         VALUES ($1, (SELECT season_id FROM result_tabs WHERE id = $2), $2, $3, $4::jsonb)`,
        [entityId, teamTabId, rank, JSON.stringify({ club_entity_id: clubId, ...regStats })]
      );
      rank++;
    }
    console.log(`${season.year} NBA Cup Teams: ${season.team.length} players ingested`);
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
