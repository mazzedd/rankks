// One-time backfill of NBA Finals MVP (1969-2026) from a manually-compiled
// list (C:\Users\mohamed\Desktop\finals-mvp.xlsx) — no CSV source has ever
// had this award (see ingest-nba-awards.js header). The 'finals-mvp' tab
// already exists for every year (created empty by ingest-nba-awards.js);
// this script just fills in the single winner row per year.
//
// Unlike the voted awards (MVP/DPOY/etc.), there's no candidate list or
// vote share here — one winner per year, directly from the source list.
// Player entities are resolved by name only (no bref_player_id in this
// source) since every one of these players already has an entity from the
// MVP/All-NBA/box-score ingestion already done for every year in this list —
// unmatched names are reported, not silently turned into new entities,
// since a Finals MVP failing to match almost certainly means a name-spelling
// mismatch against existing data, not a genuinely new player.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const COMPETITION_ID = 4828;
const AWARDS_EVENT_ID = 74 + 4; // 78

// [year, player, team] — team is informational only (cross-checked against
// the player's own Regular Season club that year, not written directly).
// "Joe White" (1976) corrected to "Jo Jo White" per Mohamed confirmation —
// the source spreadsheet had a transcription typo.
const FINALS_MVP = [
  [2026, 'Jalen Brunson', 'New York Knicks'],
  [2025, 'Shai Gilgeous-Alexander', 'Oklahoma City Thunder'],
  [2024, 'Jaylen Brown', 'Boston Celtics'],
  [2023, 'Nikola Jokić', 'Denver Nuggets'],
  [2022, 'Stephen Curry', 'Golden State Warriors'],
  [2021, 'Giannis Antetokounmpo', 'Milwaukee Bucks'],
  [2020, 'LeBron James', 'Los Angeles Lakers'],
  [2019, 'Kawhi Leonard', 'Toronto Raptors'],
  [2018, 'Kevin Durant', 'Golden State Warriors'],
  [2017, 'Kevin Durant', 'Golden State Warriors'],
  [2016, 'LeBron James', 'Cleveland Cavaliers'],
  [2015, 'Andre Iguodala', 'Golden State Warriors'],
  [2014, 'Kawhi Leonard', 'San Antonio Spurs'],
  [2013, 'LeBron James', 'Miami Heat'],
  [2012, 'LeBron James', 'Miami Heat'],
  [2011, 'Dirk Nowitzki', 'Dallas Mavericks'],
  [2010, 'Kobe Bryant', 'Los Angeles Lakers'],
  [2009, 'Kobe Bryant', 'Los Angeles Lakers'],
  [2008, 'Paul Pierce', 'Boston Celtics'],
  [2007, 'Tony Parker', 'San Antonio Spurs'],
  [2006, 'Dwyane Wade', 'Miami Heat'],
  [2005, 'Tim Duncan', 'San Antonio Spurs'],
  [2004, 'Chauncey Billups', 'Detroit Pistons'],
  [2003, 'Tim Duncan', 'San Antonio Spurs'],
  [2002, "Shaquille O'Neal", 'Los Angeles Lakers'],
  [2001, "Shaquille O'Neal", 'Los Angeles Lakers'],
  [2000, "Shaquille O'Neal", 'Los Angeles Lakers'],
  [1999, 'Tim Duncan', 'San Antonio Spurs'],
  [1998, 'Michael Jordan', 'Chicago Bulls'],
  [1997, 'Michael Jordan', 'Chicago Bulls'],
  [1996, 'Michael Jordan', 'Chicago Bulls'],
  [1995, 'Hakeem Olajuwon', 'Houston Rockets'],
  [1994, 'Hakeem Olajuwon', 'Houston Rockets'],
  [1993, 'Michael Jordan', 'Chicago Bulls'],
  [1992, 'Michael Jordan', 'Chicago Bulls'],
  [1991, 'Michael Jordan', 'Chicago Bulls'],
  [1990, 'Isiah Thomas', 'Detroit Pistons'],
  [1989, 'Joe Dumars', 'Detroit Pistons'],
  [1988, 'James Worthy', 'Los Angeles Lakers'],
  [1987, 'Magic Johnson', 'Los Angeles Lakers'],
  [1986, 'Larry Bird', 'Boston Celtics'],
  [1985, 'Kareem Abdul-Jabbar', 'Los Angeles Lakers'],
  [1984, 'Larry Bird', 'Boston Celtics'],
  [1983, 'Moses Malone', 'Philadelphia 76ers'],
  [1982, 'Magic Johnson', 'Los Angeles Lakers'],
  [1981, 'Cedric Maxwell', 'Boston Celtics'],
  [1980, 'Magic Johnson', 'Los Angeles Lakers'],
  [1979, 'Dennis Johnson', 'Seattle SuperSonics'],
  [1978, 'Wes Unseld', 'Washington Bullets'],
  [1977, 'Bill Walton', 'Portland Trail Blazers'],
  [1976, 'Jo Jo White', 'Boston Celtics'],
  [1975, 'Rick Barry', 'Golden State Warriors'],
  [1974, 'John Havlicek', 'Boston Celtics'],
  [1973, 'Willis Reed', 'New York Knicks'],
  [1972, 'Wilt Chamberlain', 'Los Angeles Lakers'],
  [1971, 'Kareem Abdul-Jabbar', 'Milwaukee Bucks'],
  [1970, 'Willis Reed', 'New York Knicks'],
  [1969, 'Jerry West', 'Los Angeles Lakers'],
];

const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');
function normalizeName(name) {
  return name.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase().trim();
}

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
  if (!r) return { club_entity_id: null };
  const s = r.stats || {};
  const t = s.totals || {};
  return {
    club_entity_id: r.club_entity_id,
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

async function main() {
  const entityRows = await pool.query(`SELECT id, canonical_name FROM entities WHERE entity_type = 'player'`);
  const nameMap = new Map();
  for (const r of entityRows.rows) {
    const key = normalizeName(r.canonical_name);
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key).push(r.id);
  }

  let ingested = 0;
  const unmatched = [];
  const ambiguous = [];

  for (const [year, player, team] of FINALS_MVP) {
    const key = normalizeName(player);
    const candidates = nameMap.get(key);
    if (!candidates || candidates.length === 0) { unmatched.push(`${year}: ${player}`); continue; }
    if (candidates.length > 1) { ambiguous.push(`${year}: ${player} (${candidates.length} entities: ${candidates.join(',')})`); continue; }
    const entityId = candidates[0];

    const seasonRow = await pool.query(
      `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
      [COMPETITION_ID, AWARDS_EVENT_ID, year]
    );
    if (!seasonRow.rows.length) { unmatched.push(`${year}: ${player} — no Awards season row for this year`); continue; }
    const seasonId = seasonRow.rows[0].id;

    const tabRow = await pool.query(
      `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = 'finals-mvp'`,
      [seasonId]
    );
    if (!tabRow.rows.length) { unmatched.push(`${year}: ${player} — no finals-mvp tab for this year`); continue; }
    const tabId = tabRow.rows[0].id;

    const regStats = await getRegularSeasonStats(entityId, year);
    const stats = { winner: true, ...regStats };

    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [tabId]);
    await pool.query(
      `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
       VALUES ($1, $2, $3, 1, $4::jsonb)`,
      [entityId, seasonId, tabId, JSON.stringify(stats)]
    );
    ingested++;
  }

  console.log(`Ingested: ${ingested}/${FINALS_MVP.length}`);
  if (unmatched.length) { console.log('\nUNMATCHED:'); unmatched.forEach(u => console.log('  ' + u)); }
  if (ambiguous.length) { console.log('\nAMBIGUOUS:'); ambiguous.forEach(a => console.log('  ' + a)); }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
