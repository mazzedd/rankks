// One-time load of NBA teams' historical conference/division assignments from
// 00-nba/conference-division-history.md into entity_conference_history.
// Year boundaries in the doc use season-START-year notation (e.g. "1970"
// means the 1970-71 season); this DB uses year_convention='end' (the 1970-71
// season is year 1971), so every boundary here is the doc's value + 1.
// Only the 30 current franchises are loaded — the 15 defunct franchises
// (see nba-franchise-continuity memory) have no entity yet and are deferred
// until the 1946-1955 backfill resumes.
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// [entityId, [ [startYear, endYearOrNull, conferenceOrNull, division], ... ] ]
const HISTORY = [
  [76236, [[1947, 1970, null, 'Eastern Division'], [1971, null, 'Eastern', 'Atlantic']]], // Boston Celtics
  [76227, [[1947, 1970, null, 'Eastern Division'], [1971, null, 'Eastern', 'Atlantic']]], // New York Knicks
  [76233, [[1947, 1970, null, 'Eastern Division'], [1971, null, 'Eastern', 'Atlantic']]], // Philadelphia 76ers
  [76255, [[1977, null, 'Eastern', 'Atlantic']]], // Brooklyn Nets
  [76234, [[1996, 2004, 'Eastern', 'Central'], [2005, null, 'Eastern', 'Atlantic']]], // Toronto Raptors
  [76247, [[1967, 1970, null, 'Western Division'], [1971, 1980, 'Western', 'Midwest'], [1981, null, 'Eastern', 'Central']]], // Chicago Bulls
  [76229, [[1971, null, 'Eastern', 'Central']]], // Cleveland Cavaliers
  [76230, [[1947, 1950, null, 'Central'], [1951, 1967, null, 'Western Division'], [1968, 1970, null, 'Eastern Division'], [1971, 1978, 'Western', 'Midwest'], [1979, null, 'Eastern', 'Central']]], // Detroit Pistons
  [76253, [[1977, 1979, 'Western', 'Midwest'], [1980, null, 'Eastern', 'Central']]], // Indiana Pacers
  [76254, [[1969, 1970, null, 'Eastern Division'], [1971, 1980, 'Western', 'Midwest'], [1981, null, 'Eastern', 'Central']]], // Milwaukee Bucks
  [76239, [[1947, 1970, null, 'Western Division'], [1971, null, 'Eastern', 'Central']]], // Atlanta Hawks
  [76243, [[1989, 1989, 'Eastern', 'Atlantic'], [1990, 1990, 'Western', 'Midwest'], [1991, 2002, 'Eastern', 'Central'], [2005, null, 'Eastern', 'Southeast']]], // Charlotte Hornets
  [76245, [[1989, 1989, 'Western', 'Midwest'], [1990, 2004, 'Eastern', 'Atlantic'], [2005, null, 'Eastern', 'Southeast']]], // Miami Heat
  [76235, [[1990, 1990, 'Eastern', 'Central'], [1991, 1991, 'Western', 'Midwest'], [1992, 2004, 'Eastern', 'Atlantic'], [2005, null, 'Eastern', 'Southeast']]], // Orlando Magic
  [76252, [[1962, 1966, null, 'Western Division'], [1967, 1970, null, 'Eastern Division'], [1971, 1978, 'Eastern', 'Central'], [1979, 2004, 'Eastern', 'Atlantic'], [2005, null, 'Eastern', 'Southeast']]], // Washington Wizards
  [76232, [[1949, 1950, null, 'Central'], [1951, 1970, null, 'Western Division'], [1971, null, 'Western', 'Pacific']]], // Los Angeles Lakers
  [76242, [[1947, 1962, null, 'Eastern Division'], [1963, 1970, null, 'Western Division'], [1971, null, 'Western', 'Pacific']]], // Golden State Warriors
  [76251, [[1949, 1950, null, 'Central'], [1951, 1962, null, 'Western Division'], [1963, 1970, null, 'Eastern Division'], [1971, 1972, 'Eastern', 'Central'], [1973, 1985, 'Western', 'Midwest'], [1986, null, 'Western', 'Pacific']]], // Sacramento Kings
  [76241, [[1969, 1970, null, 'Western Division'], [1971, 1972, 'Western', 'Midwest'], [1973, null, 'Western', 'Pacific']]], // Phoenix Suns
  [76244, [[1971, 1978, 'Eastern', 'Atlantic'], [1979, null, 'Western', 'Pacific']]], // LA Clippers
  [76238, [[1977, 2004, 'Western', 'Midwest'], [2005, null, 'Western', 'Northwest']]], // Denver Nuggets
  [76231, [[1990, 2004, 'Western', 'Midwest'], [2005, null, 'Western', 'Northwest']]], // Minnesota Timberwolves
  [76228, [[1968, 1970, null, 'Western Division'], [1971, 2004, 'Western', 'Pacific'], [2005, null, 'Western', 'Northwest']]], // Oklahoma City Thunder
  [76240, [[1971, 2004, 'Western', 'Pacific'], [2005, null, 'Western', 'Northwest']]], // Portland Trail Blazers
  [76250, [[1975, 1979, 'Eastern', 'Central'], [1980, 2004, 'Western', 'Midwest'], [2005, null, 'Western', 'Northwest']]], // Utah Jazz
  [76246, [[1981, 2004, 'Western', 'Midwest'], [2005, null, 'Western', 'Southwest']]], // Dallas Mavericks
  [76237, [[1968, 1970, null, 'Western Division'], [1971, 1972, 'Western', 'Pacific'], [1973, 1980, 'Eastern', 'Central'], [1981, 2004, 'Western', 'Midwest'], [2005, null, 'Western', 'Southwest']]], // Houston Rockets
  [76248, [[1996, 2004, 'Western', 'Midwest'], [2005, null, 'Western', 'Southwest']]], // Memphis Grizzlies
  [76226, [[1977, 1980, 'Eastern', 'Central'], [1981, 2004, 'Western', 'Midwest'], [2005, null, 'Western', 'Southwest']]], // San Antonio Spurs
  [76249, [[2003, 2004, 'Eastern', 'Central'], [2005, null, 'Western', 'Southwest']]], // New Orleans Pelicans
];

async function main() {
  let inserted = 0;
  for (const [entityId, rows] of HISTORY) {
    for (const [startYear, endYear, conference, division] of rows) {
      await pool.query(
        `INSERT INTO entity_conference_history (entity_id, conference, division, start_year, end_year)
         VALUES ($1, $2, $3, $4, $5)`,
        [entityId, conference, division, startYear, endYear]
      );
      inserted++;
    }
  }
  console.log(`Inserted ${inserted} conference/division history rows for ${HISTORY.length} teams.`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
