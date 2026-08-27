// Ingests the actual NBA All-Star Game results (final score + venue) and
// Game MVP for every year 1951-2026 — hand-compiled from Wikipedia's
// "NBA All-Star Game" article (en.wikipedia.org/wiki/NBA_All-Star_Game),
// same "no Kaggle source, hand-compile from Wikipedia" pattern already used
// by ingest-nba-cup-awards.js. 1999 is skipped (All-Star Game cancelled —
// 1998-99 lockout).
//
// Per Mohamed's call: Results rides the same `games` table/typology='game'
// machinery as Playoffs/Finals (not a bespoke display), which needs each
// side to be a real entity. Since East/West/Team LeBron/etc. aren't real
// clubs, they're modeled as their own entity_type='all_star_team' rows
// (reused across every year that side recurs — e.g. one "Team LeBron"
// entity spans 2018-2022, same way "Eastern Conference All-Stars" spans
// every East/West year) — deliberately excluded from every other
// entity_type='club' query in the app by construction. No colours set on
// these (not needed per Mohamed) — only two have real logos so far
// (Eastern/Western Conference All-Stars); the rest get logos later.
//
// MVP is its own Line B tab (typology='players', tab_key='all-star-mvp') —
// lives under the AWARDS event (78), not All-Star (80): per Mohamed's nav
// cleanup (2026-08-25, see migrate-all-star-mvp-to-awards.js), All-Star MVP
// belongs alongside the season's other individual awards, ordered right
// before NBA Cup MVP (display_order 11, vs. NBA Cup MVP's 12) — same
// single-winner shape as Finals MVP/NBA Cup MVP, reusing this file's own
// club/box-score enrichment (getRegularSeasonStats). A few years have
// co-MVPs (1993, 2000, 2009) — both ranked #1.
//
// Wikipedia's 2025/2026 championship-game team names ("Shaq's OGs"/"Chuck's
// Global Stars", "USA Stars"/"USA Stripes") are the SAME sides as the
// roster draft's "Team Shaq"/"Team Chuck"/"Team Stars"/"Team Stripes" —
// cross-checked 2026 against TeamStatistics.csv's own gameType='All-Star
// Game' rows (team names "Stars"/"Stripes", score 47-21) which matches
// exactly — mapped onto the SAME entities the roster tabs already created,
// via TEAM_NAME_ALIASES below, rather than creating confusing duplicates.
const { Pool } = require('pg');
const { getRegularSeasonStats } = require('./nba-player-lookup');

const COMPETITION_ID = 4828;
const ALL_STAR_EVENT_ID = 80;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

// entity_type='all_star_team' — canonical name -> logo (only two real logos
// exist so far; the rest are null until provided).
const TEAMS = [
  { name: 'Eastern Conference All-Stars', logo: '/media/logos/competitions/basketball/national/usa/nba-allstar-east.jpg' },
  { name: 'Western Conference All-Stars', logo: '/media/logos/competitions/basketball/national/usa/nba-allstar-west.png' },
  { name: 'Team LeBron', logo: null },
  { name: 'Team Stephen', logo: null },
  { name: 'Team Giannis', logo: null },
  { name: 'Team Durant', logo: null },
  { name: 'Team Chuck', logo: null },
  { name: 'Team Kenny', logo: null },
  { name: 'Team Shaq', logo: null },
  { name: 'Team Stars', logo: null },
  { name: 'Team Stripes', logo: null },
  { name: 'Team World', logo: null },
];

// Wikipedia's own game-result labels that differ from the roster-draft
// entity names created above — same side, different label at the
// championship-game stage.
const TEAM_NAME_ALIASES = {
  'East': 'Eastern Conference All-Stars',
  'West': 'Western Conference All-Stars',
  "Shaq's OGs": 'Team Shaq',
  "Chuck's Global Stars": 'Team Chuck',
  'USA Stars': 'Team Stars',
  'USA Stripes': 'Team Stripes',
  // Same 2023 bare-name quirk as ingest-nba-all-star.js's roster source —
  // Wikipedia's result page also drops the 'Team ' prefix for this one year.
  'Giannis': 'Team Giannis',
  'LeBron': 'Team LeBron',
};

function resolveTeamName(name) {
  return TEAM_NAME_ALIASES[name] || name;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// { year, winner, winnerScore, loser, loserScore, overtime, venue, city, mvp: [{player, club}] }
const GAMES = [
  { year: 1951, winner: 'East', winnerScore: 111, loser: 'West', loserScore: 94, venue: 'Boston Garden', city: 'Boston, MA', mvp: [{ player: 'Ed Macauley', club: 'Boston Celtics' }] },
  { year: 1952, winner: 'East', winnerScore: 108, loser: 'West', loserScore: 91, venue: 'Boston Garden', city: 'Boston, MA', mvp: [{ player: 'Paul Arizin', club: 'Philadelphia Warriors' }] },
  { year: 1953, winner: 'West', winnerScore: 79, loser: 'East', loserScore: 75, venue: 'Allen County War Memorial Coliseum', city: 'Fort Wayne, IN', mvp: [{ player: 'George Mikan', club: 'Minneapolis Lakers' }] },
  { year: 1954, winner: 'East', winnerScore: 98, loser: 'West', loserScore: 93, overtime: 1, venue: 'Madison Square Garden III', city: 'New York City, NY', mvp: [{ player: 'Bob Cousy', club: 'Boston Celtics' }] },
  { year: 1955, winner: 'East', winnerScore: 100, loser: 'West', loserScore: 91, venue: 'Madison Square Garden III', city: 'New York City, NY', mvp: [{ player: 'Bill Sharman', club: 'Boston Celtics' }] },
  { year: 1956, winner: 'West', winnerScore: 108, loser: 'East', loserScore: 94, venue: 'Rochester War Memorial Coliseum', city: 'Rochester, NY', mvp: [{ player: 'Bob Pettit', club: 'St. Louis Hawks' }] },
  { year: 1957, winner: 'East', winnerScore: 109, loser: 'West', loserScore: 97, venue: 'Boston Garden', city: 'Boston, MA', mvp: [{ player: 'Bob Cousy', club: 'Boston Celtics' }] },
  { year: 1958, winner: 'East', winnerScore: 130, loser: 'West', loserScore: 118, venue: 'St. Louis Arena', city: 'St. Louis, MO', mvp: [{ player: 'Bob Pettit', club: 'St. Louis Hawks' }] },
  { year: 1959, winner: 'West', winnerScore: 124, loser: 'East', loserScore: 108, venue: 'Olympia Stadium', city: 'Detroit, MI', mvp: [{ player: 'Elgin Baylor', club: 'Minneapolis Lakers' }] },
  { year: 1960, winner: 'East', winnerScore: 125, loser: 'West', loserScore: 115, venue: 'Convention Hall', city: 'Philadelphia, PA', mvp: [{ player: 'Wilt Chamberlain', club: 'Philadelphia Warriors' }] },
  { year: 1961, winner: 'West', winnerScore: 153, loser: 'East', loserScore: 131, venue: 'Onondaga County War Memorial Coliseum', city: 'Syracuse, NY', mvp: [{ player: 'Oscar Robertson', club: 'Cincinnati Royals' }] },
  { year: 1962, winner: 'West', winnerScore: 150, loser: 'East', loserScore: 130, venue: 'St. Louis Arena', city: 'St. Louis, MO', mvp: [{ player: 'Bob Pettit', club: 'St. Louis Hawks' }] },
  { year: 1963, winner: 'East', winnerScore: 115, loser: 'West', loserScore: 108, venue: 'LA Sports Arena', city: 'Los Angeles, CA', mvp: [{ player: 'Bill Russell', club: 'Boston Celtics' }] },
  { year: 1964, winner: 'East', winnerScore: 111, loser: 'West', loserScore: 107, venue: 'Boston Garden', city: 'Boston, MA', mvp: [{ player: 'Oscar Robertson', club: 'Cincinnati Royals' }] },
  { year: 1965, winner: 'East', winnerScore: 124, loser: 'West', loserScore: 123, venue: 'St. Louis Arena', city: 'St. Louis, MO', mvp: [{ player: 'Jerry Lucas', club: 'Cincinnati Royals' }] },
  { year: 1966, winner: 'East', winnerScore: 137, loser: 'West', loserScore: 94, venue: 'Cincinnati Gardens', city: 'Cincinnati, OH', mvp: [{ player: 'Adrian Smith', club: 'Cincinnati Royals' }] },
  { year: 1967, winner: 'West', winnerScore: 135, loser: 'East', loserScore: 120, venue: 'Cow Palace', city: 'Daly City, CA', mvp: [{ player: 'Rick Barry', club: 'San Francisco Warriors' }] },
  { year: 1968, winner: 'East', winnerScore: 144, loser: 'West', loserScore: 124, venue: 'Madison Square Garden III', city: 'New York City, NY', mvp: [{ player: 'Hal Greer', club: 'Philadelphia 76ers' }] },
  { year: 1969, winner: 'East', winnerScore: 123, loser: 'West', loserScore: 112, venue: 'Baltimore Civic Center', city: 'Baltimore, MD', mvp: [{ player: 'Oscar Robertson', club: 'Cincinnati Royals' }] },
  { year: 1970, winner: 'East', winnerScore: 142, loser: 'West', loserScore: 135, venue: 'The Spectrum', city: 'Philadelphia, PA', mvp: [{ player: 'Willis Reed', club: 'New York Knicks' }] },
  { year: 1971, winner: 'West', winnerScore: 108, loser: 'East', loserScore: 107, venue: 'San Diego Sports Arena', city: 'San Diego, CA', mvp: [{ player: 'Lenny Wilkens', club: 'Seattle SuperSonics' }] },
  { year: 1972, winner: 'West', winnerScore: 112, loser: 'East', loserScore: 110, venue: 'The Forum', city: 'Inglewood, CA', mvp: [{ player: 'Jerry West', club: 'Los Angeles Lakers' }] },
  { year: 1973, winner: 'East', winnerScore: 104, loser: 'West', loserScore: 84, venue: 'Chicago Stadium', city: 'Chicago, IL', mvp: [{ player: 'Dave Cowens', club: 'Boston Celtics' }] },
  { year: 1974, winner: 'West', winnerScore: 134, loser: 'East', loserScore: 123, venue: 'Seattle Center Coliseum', city: 'Seattle, WA', mvp: [{ player: 'Bob Lanier', club: 'Detroit Pistons' }] },
  { year: 1975, winner: 'East', winnerScore: 108, loser: 'West', loserScore: 102, venue: 'Arizona Veterans Memorial Coliseum', city: 'Phoenix, AZ', mvp: [{ player: 'Walt Frazier', club: 'New York Knicks' }] },
  { year: 1976, winner: 'East', winnerScore: 123, loser: 'West', loserScore: 109, venue: 'The Spectrum', city: 'Philadelphia, PA', mvp: [{ player: 'Dave Bing', club: 'Washington Bullets' }] },
  { year: 1977, winner: 'West', winnerScore: 125, loser: 'East', loserScore: 124, venue: 'Milwaukee Arena', city: 'Milwaukee, WI', mvp: [{ player: 'Julius Erving', club: 'Philadelphia 76ers' }] },
  { year: 1978, winner: 'East', winnerScore: 133, loser: 'West', loserScore: 125, venue: 'Omni Coliseum', city: 'Atlanta, GA', mvp: [{ player: 'Randy Smith', club: 'Buffalo Braves' }] },
  { year: 1979, winner: 'West', winnerScore: 134, loser: 'East', loserScore: 129, venue: 'Pontiac Silverdome', city: 'Pontiac, MI', mvp: [{ player: 'David Thompson', club: 'Denver Nuggets' }] },
  { year: 1980, winner: 'East', winnerScore: 144, loser: 'West', loserScore: 136, overtime: 1, venue: 'Capital Centre', city: 'Landover, MD', mvp: [{ player: 'George Gervin', club: 'San Antonio Spurs' }] },
  { year: 1981, winner: 'East', winnerScore: 123, loser: 'West', loserScore: 120, venue: 'Coliseum at Richfield', city: 'Richfield, OH', mvp: [{ player: 'Tiny Archibald', club: 'Boston Celtics' }] },
  { year: 1982, winner: 'East', winnerScore: 120, loser: 'West', loserScore: 118, venue: 'Brendan Byrne Arena', city: 'East Rutherford, NJ', mvp: [{ player: 'Larry Bird', club: 'Boston Celtics' }] },
  { year: 1983, winner: 'East', winnerScore: 132, loser: 'West', loserScore: 123, venue: 'The Forum', city: 'Inglewood, CA', mvp: [{ player: 'Julius Erving', club: 'Philadelphia 76ers' }] },
  { year: 1984, winner: 'East', winnerScore: 154, loser: 'West', loserScore: 145, overtime: 1, venue: 'McNichols Sports Arena', city: 'Denver, CO', mvp: [{ player: 'Isiah Thomas', club: 'Detroit Pistons' }] },
  { year: 1985, winner: 'West', winnerScore: 140, loser: 'East', loserScore: 129, venue: 'Hoosier Dome', city: 'Indianapolis, IN', mvp: [{ player: 'Ralph Sampson', club: 'Houston Rockets' }] },
  { year: 1986, winner: 'East', winnerScore: 139, loser: 'West', loserScore: 132, venue: 'Reunion Arena', city: 'Dallas, TX', mvp: [{ player: 'Isiah Thomas', club: 'Detroit Pistons' }] },
  { year: 1987, winner: 'West', winnerScore: 154, loser: 'East', loserScore: 149, overtime: 1, venue: 'Kingdome', city: 'Seattle, WA', mvp: [{ player: 'Tom Chambers', club: 'Seattle SuperSonics' }] },
  { year: 1988, winner: 'East', winnerScore: 138, loser: 'West', loserScore: 133, venue: 'Chicago Stadium', city: 'Chicago, IL', mvp: [{ player: 'Michael Jordan', club: 'Chicago Bulls' }] },
  { year: 1989, winner: 'West', winnerScore: 143, loser: 'East', loserScore: 134, venue: 'Astrodome', city: 'Houston, TX', mvp: [{ player: 'Karl Malone', club: 'Utah Jazz' }] },
  { year: 1990, winner: 'East', winnerScore: 130, loser: 'West', loserScore: 113, venue: 'Miami Arena', city: 'Miami, FL', mvp: [{ player: 'Magic Johnson', club: 'Los Angeles Lakers' }] },
  { year: 1991, winner: 'East', winnerScore: 116, loser: 'West', loserScore: 114, venue: 'Charlotte Coliseum', city: 'Charlotte, NC', mvp: [{ player: 'Charles Barkley', club: 'Philadelphia 76ers' }] },
  { year: 1992, winner: 'West', winnerScore: 153, loser: 'East', loserScore: 113, venue: 'Orlando Arena', city: 'Orlando, FL', mvp: [{ player: 'Magic Johnson', club: 'Los Angeles Lakers' }] },
  { year: 1993, winner: 'West', winnerScore: 135, loser: 'East', loserScore: 132, overtime: 1, venue: 'Delta Center', city: 'Salt Lake City, UT', mvp: [{ player: 'Karl Malone', club: 'Utah Jazz' }, { player: 'John Stockton', club: 'Utah Jazz' }] },
  { year: 1994, winner: 'East', winnerScore: 127, loser: 'West', loserScore: 118, venue: 'Target Center', city: 'Minneapolis, MN', mvp: [{ player: 'Scottie Pippen', club: 'Chicago Bulls' }] },
  { year: 1995, winner: 'West', winnerScore: 139, loser: 'East', loserScore: 112, venue: 'America West Arena', city: 'Phoenix, AZ', mvp: [{ player: 'Mitch Richmond', club: 'Sacramento Kings' }] },
  { year: 1996, winner: 'East', winnerScore: 129, loser: 'West', loserScore: 118, venue: 'Alamodome', city: 'San Antonio, TX', mvp: [{ player: 'Michael Jordan', club: 'Chicago Bulls' }] },
  { year: 1997, winner: 'East', winnerScore: 132, loser: 'West', loserScore: 120, venue: 'Gund Arena', city: 'Cleveland, OH', mvp: [{ player: 'Glen Rice', club: 'Charlotte Hornets' }] },
  { year: 1998, winner: 'East', winnerScore: 135, loser: 'West', loserScore: 114, venue: 'Madison Square Garden', city: 'New York City, NY', mvp: [{ player: 'Michael Jordan', club: 'Chicago Bulls' }] },
  // 1999 cancelled — lockout, no game.
  { year: 2000, winner: 'West', winnerScore: 137, loser: 'East', loserScore: 126, venue: 'The Arena in Oakland', city: 'Oakland, CA', mvp: [{ player: 'Tim Duncan', club: 'San Antonio Spurs' }, { player: "Shaquille O'Neal", club: 'Los Angeles Lakers' }] },
  { year: 2001, winner: 'East', winnerScore: 111, loser: 'West', loserScore: 110, venue: 'MCI Center', city: 'Washington, D.C.', mvp: [{ player: 'Allen Iverson', club: 'Philadelphia 76ers' }] },
  { year: 2002, winner: 'West', winnerScore: 135, loser: 'East', loserScore: 120, venue: 'First Union Center', city: 'Philadelphia, PA', mvp: [{ player: 'Kobe Bryant', club: 'Los Angeles Lakers' }] },
  { year: 2003, winner: 'West', winnerScore: 155, loser: 'East', loserScore: 145, overtime: 2, venue: 'Philips Arena', city: 'Atlanta, GA', mvp: [{ player: 'Kevin Garnett', club: 'Minnesota Timberwolves' }] },
  { year: 2004, winner: 'West', winnerScore: 136, loser: 'East', loserScore: 132, venue: 'Staples Center', city: 'Los Angeles, CA', mvp: [{ player: "Shaquille O'Neal", club: 'Los Angeles Lakers' }] },
  { year: 2005, winner: 'East', winnerScore: 125, loser: 'West', loserScore: 115, venue: 'Pepsi Center', city: 'Denver, CO', mvp: [{ player: 'Allen Iverson', club: 'Philadelphia 76ers' }] },
  { year: 2006, winner: 'East', winnerScore: 122, loser: 'West', loserScore: 120, venue: 'Toyota Center', city: 'Houston, TX', mvp: [{ player: 'LeBron James', club: 'Cleveland Cavaliers' }] },
  { year: 2007, winner: 'West', winnerScore: 153, loser: 'East', loserScore: 132, venue: 'Thomas & Mack Center', city: 'Paradise, NV', mvp: [{ player: 'Kobe Bryant', club: 'Los Angeles Lakers' }] },
  { year: 2008, winner: 'East', winnerScore: 134, loser: 'West', loserScore: 128, venue: 'New Orleans Arena', city: 'New Orleans, LA', mvp: [{ player: 'LeBron James', club: 'Cleveland Cavaliers' }] },
  { year: 2009, winner: 'West', winnerScore: 146, loser: 'East', loserScore: 119, venue: 'US Airways Center', city: 'Phoenix, AZ', mvp: [{ player: 'Kobe Bryant', club: 'Los Angeles Lakers' }, { player: "Shaquille O'Neal", club: 'Phoenix Suns' }] },
  { year: 2010, winner: 'East', winnerScore: 141, loser: 'West', loserScore: 139, venue: 'Cowboys Stadium', city: 'Arlington, TX', mvp: [{ player: 'Dwyane Wade', club: 'Miami Heat' }] },
  { year: 2011, winner: 'West', winnerScore: 148, loser: 'East', loserScore: 143, venue: 'Staples Center', city: 'Los Angeles, CA', mvp: [{ player: 'Kobe Bryant', club: 'Los Angeles Lakers' }] },
  { year: 2012, winner: 'West', winnerScore: 152, loser: 'East', loserScore: 149, venue: 'Amway Center', city: 'Orlando, FL', mvp: [{ player: 'Kevin Durant', club: 'Oklahoma City Thunder' }] },
  { year: 2013, winner: 'West', winnerScore: 143, loser: 'East', loserScore: 138, venue: 'Toyota Center', city: 'Houston, TX', mvp: [{ player: 'Chris Paul', club: 'Los Angeles Clippers' }] },
  { year: 2014, winner: 'East', winnerScore: 163, loser: 'West', loserScore: 155, venue: 'Smoothie King Center', city: 'New Orleans, LA', mvp: [{ player: 'Kyrie Irving', club: 'Cleveland Cavaliers' }] },
  { year: 2015, winner: 'West', winnerScore: 163, loser: 'East', loserScore: 158, venue: 'Madison Square Garden', city: 'New York City, NY', mvp: [{ player: 'Russell Westbrook', club: 'Oklahoma City Thunder' }] },
  { year: 2016, winner: 'West', winnerScore: 196, loser: 'East', loserScore: 173, venue: 'Air Canada Centre', city: 'Toronto, ON, Canada', mvp: [{ player: 'Russell Westbrook', club: 'Oklahoma City Thunder' }] },
  { year: 2017, winner: 'West', winnerScore: 192, loser: 'East', loserScore: 182, venue: 'Smoothie King Center', city: 'New Orleans, LA', mvp: [{ player: 'Anthony Davis', club: 'New Orleans Pelicans' }] },
  { year: 2018, winner: 'Team LeBron', winnerScore: 148, loser: 'Team Stephen', loserScore: 145, venue: 'Staples Center', city: 'Los Angeles, CA', mvp: [{ player: 'LeBron James', club: 'Cleveland Cavaliers' }] },
  { year: 2019, winner: 'Team LeBron', winnerScore: 178, loser: 'Team Giannis', loserScore: 164, venue: 'Spectrum Center', city: 'Charlotte, NC', mvp: [{ player: 'Kevin Durant', club: 'Golden State Warriors' }] },
  { year: 2020, winner: 'Team LeBron', winnerScore: 157, loser: 'Team Giannis', loserScore: 155, venue: 'United Center', city: 'Chicago, IL', mvp: [{ player: 'Kawhi Leonard', club: 'Los Angeles Clippers' }] },
  { year: 2021, winner: 'Team LeBron', winnerScore: 170, loser: 'Team Durant', loserScore: 150, venue: 'State Farm Arena', city: 'Atlanta, GA', mvp: [{ player: 'Giannis Antetokounmpo', club: 'Milwaukee Bucks' }] },
  { year: 2022, winner: 'Team LeBron', winnerScore: 163, loser: 'Team Durant', loserScore: 160, venue: 'Rocket Mortgage FieldHouse', city: 'Cleveland, OH', mvp: [{ player: 'Stephen Curry', club: 'Golden State Warriors' }] },
  { year: 2023, winner: 'Giannis', winnerScore: 184, loser: 'LeBron', loserScore: 175, venue: 'Vivint Arena', city: 'Salt Lake City, UT', mvp: [{ player: 'Jayson Tatum', club: 'Boston Celtics' }] },
  { year: 2024, winner: 'East', winnerScore: 211, loser: 'West', loserScore: 186, venue: 'Gainbridge Fieldhouse', city: 'Indianapolis, IN', mvp: [{ player: 'Damian Lillard', club: 'Milwaukee Bucks' }] },
  { year: 2025, winner: "Shaq's OGs", winnerScore: 41, loser: "Chuck's Global Stars", loserScore: 25, venue: 'Chase Center', city: 'San Francisco, CA', mvp: [{ player: 'Stephen Curry', club: 'Golden State Warriors' }] },
  { year: 2026, winner: 'USA Stars', winnerScore: 47, loser: 'USA Stripes', loserScore: 21, venue: 'Intuit Dome', city: 'Inglewood, CA', mvp: [{ player: 'Anthony Edwards', club: 'Minnesota Timberwolves' }] },
];

async function getOrCreateTeamEntity(name, logo) {
  const existing = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'all_star_team' AND canonical_name = $1`, [name]
  );
  if (existing.rows.length) return existing.rows[0].id;
  let slug = slugify(name);
  const slugTaken = await pool.query(`SELECT 1 FROM entities WHERE slug = $1`, [slug]);
  if (slugTaken.rows.length) slug = `${slug}-all-star-team`;
  const inserted = await pool.query(
    `INSERT INTO entities (entity_type, canonical_name, slug, image_url, is_active)
     VALUES ('all_star_team', $1, $2, $3, true) RETURNING id`,
    [name, slug, logo]
  );
  return inserted.rows[0].id;
}

async function getSeasonId(year) {
  const row = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, ALL_STAR_EVENT_ID, year]
  );
  if (!row.rows.length) throw new Error(`No All-Star season row for ${year} — run ingest-nba-all-star.js ${year} first.`);
  return row.rows[0].id;
}

const AWARDS_EVENT_ID = 78;
async function getOrCreateAwardsSeasonId(year) {
  const existing = await pool.query(
    `SELECT id FROM seasons WHERE competition_id = $1 AND event_id = $2 AND year = $3`,
    [COMPETITION_ID, AWARDS_EVENT_ID, year]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const regSeason = await pool.query(
    `SELECT start_date, end_date FROM seasons WHERE competition_id = $1 AND event_id = 74 AND year = $2`,
    [COMPETITION_ID, year]
  );
  const { start_date, end_date } = regSeason.rows[0] || {};
  const inserted = await pool.query(
    `INSERT INTO seasons (competition_id, event_id, year, status, gender, sub_edition, start_date, end_date)
     VALUES ($1, $2, $3, 'past', 'M', 1, $4, $5) RETURNING id`,
    [COMPETITION_ID, AWARDS_EVENT_ID, year, start_date || null, end_date || null]
  );
  return inserted.rows[0].id;
}

async function getOrCreateTab(seasonId, tabKey, tabName, typology, displayOrder) {
  const existing = await pool.query(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
    [seasonId, tabKey]
  );
  if (existing.rows.length) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [seasonId, tabName, tabKey, typology, displayOrder, displayOrder === 1]
  );
  return inserted.rows[0].id;
}

// Some MVP clubs are the historical (pre-relocation/rename) name, e.g.
// "Philadelphia Warriors" for a 1950s MVP whose entity's canonical_name is
// now "Golden State Warriors" (relocations = 1 entity, see entity_names) —
// checked by display_name + year range first, falling back to the entity's
// current canonical_name for anyone who's never been renamed.
async function resolveClub(name, year) {
  const historical = await pool.query(
    `SELECT entity_id FROM entity_names WHERE display_name = $1 AND $2 BETWEEN start_year AND COALESCE(end_year, 9999)`,
    [name, year]
  );
  if (historical.rows.length === 1) return historical.rows[0].entity_id;

  const row = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'club' AND canonical_name = $1`, [name]
  );
  if (row.rows.length !== 1) throw new Error(`No unique club match for "${name}" in ${year} (${row.rows.length} candidates)`);
  return row.rows[0].id;
}

// All these MVPs are established stars already ingested (with bref_player_id
// set) via the Regular Season/Awards pipeline — resolvePlayerEntity's
// create-fallback path assumes a bref id and would insert a duplicate here
// (its "NOT external_ids ? 'bref_player_id'" byName fallback would never
// match any of these). A plain exact-name lookup is correct and safe — with
// one wrinkle: a handful of players (e.g. Glen Rice) have an unmerged
// duplicate entity left over from ingest-nba-player-boxscores.js's own
// pipeline (nba_person_id-only, not yet caught by
// merge-nba-duplicate-players.js) alongside the "real" bref_player_id one
// already used by this player's other All-Star/Awards rows — prefer
// whichever candidate has bref_player_id set, same disambiguation rule
// nba-player-lookup.js already uses elsewhere.
async function resolveMvpPlayer(name) {
  const row = await pool.query(
    `SELECT id FROM entities WHERE entity_type = 'player' AND canonical_name = $1
     ORDER BY (external_ids ? 'bref_player_id') DESC`, [name]
  );
  if (!row.rows.length) throw new Error(`No player match for MVP "${name}"`);
  if (row.rows.length > 1) console.warn(`  (multiple candidates for "${name}" — using the bref_player_id-holding one)`);
  return row.rows[0].id;
}

async function main() {
  const teamEntityIds = new Map();
  for (const t of TEAMS) teamEntityIds.set(t.name, await getOrCreateTeamEntity(t.name, t.logo));
  console.log(`${TEAMS.length} All-Star team entities ready.`);

  for (const g of GAMES) {
    const seasonId = await getSeasonId(g.year);

    // Results
    const resultsTabId = await getOrCreateTab(seasonId, 'results', 'Results', 'game', 1);
    await pool.query(`DELETE FROM games WHERE result_tab_id = $1`, [resultsTabId]);
    const homeId = teamEntityIds.get(resolveTeamName(g.winner));
    const awayId = teamEntityIds.get(resolveTeamName(g.loser));
    if (!homeId || !awayId) throw new Error(`Unknown team entity for ${g.year}: ${g.winner} / ${g.loser}`);
    await pool.query(
      `INSERT INTO games (result_tab_id, round, match_date, venue, venue_city, home_entity_id, away_entity_id,
                          home_entity_type, away_entity_type, score, winner_entity_id, home_won, stats)
       VALUES ($1, 'All-Star Game', NULL, $2, $3, $4, $5, 'all_star_team', 'all_star_team', $6::jsonb, $4, true, $7::jsonb)`,
      [
        resultsTabId, g.venue, g.city, homeId, awayId,
        JSON.stringify({ home: g.winnerScore, away: g.loserScore }),
        JSON.stringify(g.overtime ? { overtime: g.overtime } : {}),
      ]
    );
    console.log(`${g.year} Results: ${g.winner} ${g.winnerScore} – ${g.loserScore} ${g.loser} (${g.venue}, ${g.city})`);

    // MVP — lives under Awards, not this All-Star season (see header).
    // display_order 11 sits after ROY (6) and before NBA Cup MVP (12).
    const awardsSeasonId = await getOrCreateAwardsSeasonId(g.year);
    const mvpTabId = await getOrCreateTab(awardsSeasonId, 'all-star-mvp', 'All-Star MVP', 'players', 11);
    await pool.query(`DELETE FROM player_season_stats WHERE result_tab_id = $1`, [mvpTabId]);
    for (const winner of g.mvp) {
      const entityId = await resolveMvpPlayer(winner.player);
      const clubId = await resolveClub(winner.club, g.year);
      const regStats = await getRegularSeasonStats(pool, COMPETITION_ID, entityId, g.year);
      await pool.query(
        `INSERT INTO player_season_stats (entity_id, season_id, result_tab_id, ranking_at_event, stats)
         VALUES ($1, $2, $3, 1, $4::jsonb)`,
        [entityId, awardsSeasonId, mvpTabId, JSON.stringify({ winner: true, club_entity_id: clubId, ...regStats })]
      );
    }
    console.log(`${g.year} MVP: ${g.mvp.map(m => m.player).join(' & ')}`);
  }

  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
