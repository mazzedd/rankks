// Populates entity_venues — a year-ranged home-arena history per team
// entity, same shape/precedent as entity_names (see entities.canonical_name
// backfill) — needed because our per-game source data (TeamStatistics.csv)
// carries no venue/arena field at all, unlike football's API-Sports source
// which returns real per-fixture venue. Since a team plays every regular
// home game at one arena per season (rare in-season displacement games
// aside — not modeled here), the home team's arena for that season's year
// is a safe stand-in for the missing per-game venue, applied by
// backfill-nba-game-venues.js.
//
// Hand-compiled from Wikipedia (each franchise's own page + "List of NBA
// arenas"), same precedent as ingest-nba-all-star-results.js's hand-compiled
// game data. Same-building sponsor renames (e.g. Philips Arena -> State Farm
// Arena, Staples Center -> Crypto.com Arena) are split into separate rows
// here anyway — the venue NAME shown on old games should match what the
// arena was actually called at the time, not a retroactive rebrand.
//
// Run with: node ingest-nba-arenas.js (no year argument — replaces the
// full history for every team in one pass, not a per-year backfill).
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

const US = 91;
const CA = 17;

// entityName must exactly match entities.canonical_name (current name) —
// resolved to entity_id at run time, not hardcoded, so this file doesn't
// need updating if a team's canonical_name ever changes.
//
// Year boundaries for city relocations are aligned to this DB's own
// entity_names table (already the site's ground truth for "which years
// belong to which era" — see the franchise name-history comment in
// migrate-nba-team-of-the-year.js and [[nba-franchise-continuity]] memory),
// not independently re-derived — so a relocation year lines up with the
// season the name actually changed in OUR data, even on the handful of
// franchises where that's a year off from the real-world move (e.g. Atlanta
// Hawks' entity_names row splits St. Louis/Atlanta at 1968/1969, not the
// real 1968 move). Arena names/rename years within a stable city are from
// Wikipedia research (team pages + "List of NBA arenas").
//
// A few franchises had genuinely messy multi-venue or multi-city seasons
// that don't reduce to a clean single row — simplified to one primary venue
// per year rather than modeling every displaced/split game:
//   - Golden State Warriors 1963-1970 (SF era rotated Cow Palace/Civic
//     Auditorium/USF gym) -> Cow Palace picked as primary.
//   - Sacramento Kings 1973-1975 (Kansas City-Omaha Kings split home games
//     between both cities) -> Kansas City picked as primary.
//   - New Orleans Pelicans 2005-2006 (Katrina displacement — per-season game
//     logs show the large majority of home games at Ford Center, Oklahoma
//     City, not New Orleans) -> Ford Center picked as primary both seasons.
//   - Oklahoma City Thunder 1994 (Seattle, one season split with Tacoma Dome
//     during a Coliseum renovation) -> Seattle Center Coliseum kept as
//     primary, Tacoma not modeled.
//   - Toronto Raptors 2021 (full COVID-relocated season) -> Amalie Arena,
//     Tampa modeled as its own row since it really was the full home venue
//     that season, not a handful of displaced games.
// A handful of sponsor-rename boundary years (Suns, Pacers, Blazers, Jazz,
// OKC) are approximate to within ~1 year — supplementary display data, not
// a source of truth for anything computed.
// { entityName, venues: [{ venue, venue_city, countryId, startYear, endYear (null = present) }] }
const ARENAS = [
  { entityName: 'Atlanta Hawks', venues: [
    { venue: 'Kiel Auditorium', venue_city: 'St. Louis, MO', countryId: US, startYear: 1956, endYear: 1968 },
    { venue: 'Alexander Memorial Coliseum', venue_city: 'Atlanta, GA', countryId: US, startYear: 1969, endYear: 1971 },
    { venue: 'Omni Coliseum', venue_city: 'Atlanta, GA', countryId: US, startYear: 1972, endYear: 1996 },
    { venue: 'Georgia Dome', venue_city: 'Atlanta, GA', countryId: US, startYear: 1997, endYear: 1998 },
    { venue: 'Philips Arena', venue_city: 'Atlanta, GA', countryId: US, startYear: 1999, endYear: 2017 },
    { venue: 'State Farm Arena', venue_city: 'Atlanta, GA', countryId: US, startYear: 2018, endYear: null },
  ]},
  { entityName: 'Boston Celtics', venues: [
    { venue: 'Boston Garden', venue_city: 'Boston, MA', countryId: US, startYear: 1946, endYear: 1994 },
    { venue: 'FleetCenter', venue_city: 'Boston, MA', countryId: US, startYear: 1995, endYear: 2004 },
    { venue: 'TD Banknorth Garden', venue_city: 'Boston, MA', countryId: US, startYear: 2005, endYear: 2009 },
    { venue: 'TD Garden', venue_city: 'Boston, MA', countryId: US, startYear: 2010, endYear: null },
  ]},
  { entityName: 'Brooklyn Nets', venues: [
    { venue: 'Nassau Veterans Memorial Coliseum', venue_city: 'Uniondale, NY', countryId: US, startYear: 1977, endYear: 1977 },
    { venue: 'Rutgers Athletic Center', venue_city: 'Piscataway, NJ', countryId: US, startYear: 1978, endYear: 1980 },
    { venue: 'Brendan Byrne Arena', venue_city: 'East Rutherford, NJ', countryId: US, startYear: 1981, endYear: 1995 },
    { venue: 'Continental Airlines Arena', venue_city: 'East Rutherford, NJ', countryId: US, startYear: 1996, endYear: 2006 },
    { venue: 'Izod Center', venue_city: 'East Rutherford, NJ', countryId: US, startYear: 2007, endYear: 2009 },
    { venue: 'Prudential Center', venue_city: 'Newark, NJ', countryId: US, startYear: 2010, endYear: 2011 },
    { venue: 'Barclays Center', venue_city: 'Brooklyn, NY', countryId: US, startYear: 2012, endYear: null },
  ]},
  { entityName: 'Charlotte Hornets', venues: [
    { venue: 'Charlotte Coliseum', venue_city: 'Charlotte, NC', countryId: US, startYear: 1989, endYear: 2001 },
    { venue: 'Charlotte Bobcats Arena', venue_city: 'Charlotte, NC', countryId: US, startYear: 2005, endYear: 2007 },
    { venue: 'Time Warner Cable Arena', venue_city: 'Charlotte, NC', countryId: US, startYear: 2008, endYear: 2015 },
    { venue: 'Spectrum Center', venue_city: 'Charlotte, NC', countryId: US, startYear: 2016, endYear: null },
  ]},
  { entityName: 'Chicago Bulls', venues: [
    { venue: 'International Amphitheatre', venue_city: 'Chicago, IL', countryId: US, startYear: 1966, endYear: 1966 },
    { venue: 'Chicago Stadium', venue_city: 'Chicago, IL', countryId: US, startYear: 1967, endYear: 1993 },
    { venue: 'United Center', venue_city: 'Chicago, IL', countryId: US, startYear: 1994, endYear: null },
  ]},
  { entityName: 'Cleveland Cavaliers', venues: [
    { venue: 'Cleveland Arena', venue_city: 'Cleveland, OH', countryId: US, startYear: 1970, endYear: 1973 },
    { venue: 'Richfield Coliseum', venue_city: 'Richfield, OH', countryId: US, startYear: 1974, endYear: 1993 },
    { venue: 'Gund Arena', venue_city: 'Cleveland, OH', countryId: US, startYear: 1994, endYear: 2004 },
    { venue: 'Quicken Loans Arena', venue_city: 'Cleveland, OH', countryId: US, startYear: 2005, endYear: 2018 },
    { venue: 'Rocket Mortgage FieldHouse', venue_city: 'Cleveland, OH', countryId: US, startYear: 2019, endYear: 2024 },
    { venue: 'Rocket Arena', venue_city: 'Cleveland, OH', countryId: US, startYear: 2025, endYear: null },
  ]},
  { entityName: 'Dallas Mavericks', venues: [
    { venue: 'Reunion Arena', venue_city: 'Dallas, TX', countryId: US, startYear: 1980, endYear: 2000 },
    { venue: 'American Airlines Center', venue_city: 'Dallas, TX', countryId: US, startYear: 2001, endYear: null },
  ]},
  { entityName: 'Denver Nuggets', venues: [
    { venue: 'McNichols Sports Arena', venue_city: 'Denver, CO', countryId: US, startYear: 1977, endYear: 1998 },
    { venue: 'Pepsi Center', venue_city: 'Denver, CO', countryId: US, startYear: 1999, endYear: 2019 },
    { venue: 'Ball Arena', venue_city: 'Denver, CO', countryId: US, startYear: 2020, endYear: null },
  ]},
  { entityName: 'Detroit Pistons', venues: [
    { venue: 'Olympia Stadium', venue_city: 'Detroit, MI', countryId: US, startYear: 1958, endYear: 1960 },
    { venue: 'Cobo Arena', venue_city: 'Detroit, MI', countryId: US, startYear: 1961, endYear: 1977 },
    { venue: 'Pontiac Silverdome', venue_city: 'Pontiac, MI', countryId: US, startYear: 1978, endYear: 1987 },
    { venue: 'The Palace of Auburn Hills', venue_city: 'Auburn Hills, MI', countryId: US, startYear: 1988, endYear: 2016 },
    { venue: 'Little Caesars Arena', venue_city: 'Detroit, MI', countryId: US, startYear: 2017, endYear: null },
  ]},
  { entityName: 'Golden State Warriors', venues: [
    { venue: 'Philadelphia Arena', venue_city: 'Philadelphia, PA', countryId: US, startYear: 1947, endYear: 1962 },
    { venue: 'Cow Palace', venue_city: 'Daly City, CA', countryId: US, startYear: 1963, endYear: 1970 },
    { venue: 'Oakland-Alameda County Coliseum Arena', venue_city: 'Oakland, CA', countryId: US, startYear: 1971, endYear: 1996 },
    { venue: 'The Arena in Oakland', venue_city: 'Oakland, CA', countryId: US, startYear: 1997, endYear: 2005 },
    { venue: 'Oracle Arena', venue_city: 'Oakland, CA', countryId: US, startYear: 2006, endYear: 2018 },
    { venue: 'Chase Center', venue_city: 'San Francisco, CA', countryId: US, startYear: 2019, endYear: null },
  ]},
  { entityName: 'Houston Rockets', venues: [
    { venue: 'San Diego Sports Arena', venue_city: 'San Diego, CA', countryId: US, startYear: 1968, endYear: 1971 },
    { venue: 'Hofheinz Pavilion', venue_city: 'Houston, TX', countryId: US, startYear: 1972, endYear: 1974 },
    { venue: 'The Summit', venue_city: 'Houston, TX', countryId: US, startYear: 1975, endYear: 1997 },
    { venue: 'Compaq Center', venue_city: 'Houston, TX', countryId: US, startYear: 1998, endYear: 2002 },
    { venue: 'Toyota Center', venue_city: 'Houston, TX', countryId: US, startYear: 2003, endYear: null },
  ]},
  { entityName: 'Indiana Pacers', venues: [
    { venue: 'Market Square Arena', venue_city: 'Indianapolis, IN', countryId: US, startYear: 1977, endYear: 1998 },
    { venue: 'Conseco Fieldhouse', venue_city: 'Indianapolis, IN', countryId: US, startYear: 1999, endYear: 2010 },
    { venue: 'Bankers Life Fieldhouse', venue_city: 'Indianapolis, IN', countryId: US, startYear: 2011, endYear: 2018 },
    { venue: 'Gainbridge Fieldhouse', venue_city: 'Indianapolis, IN', countryId: US, startYear: 2019, endYear: null },
  ]},
  { entityName: 'LA Clippers', venues: [
    { venue: 'Buffalo Memorial Auditorium', venue_city: 'Buffalo, NY', countryId: US, startYear: 1971, endYear: 1978 },
    { venue: 'San Diego Sports Arena', venue_city: 'San Diego, CA', countryId: US, startYear: 1979, endYear: 1984 },
    { venue: 'Los Angeles Memorial Sports Arena', venue_city: 'Los Angeles, CA', countryId: US, startYear: 1985, endYear: 1998 },
    { venue: 'Staples Center', venue_city: 'Los Angeles, CA', countryId: US, startYear: 1999, endYear: 2020 },
    { venue: 'Crypto.com Arena', venue_city: 'Los Angeles, CA', countryId: US, startYear: 2021, endYear: 2023 },
    { venue: 'Intuit Dome', venue_city: 'Inglewood, CA', countryId: US, startYear: 2024, endYear: null },
  ]},
  { entityName: 'Los Angeles Lakers', venues: [
    { venue: 'Los Angeles Memorial Sports Arena', venue_city: 'Los Angeles, CA', countryId: US, startYear: 1961, endYear: 1966 },
    { venue: 'The Forum', venue_city: 'Inglewood, CA', countryId: US, startYear: 1967, endYear: 1998 },
    { venue: 'Staples Center', venue_city: 'Los Angeles, CA', countryId: US, startYear: 1999, endYear: 2020 },
    { venue: 'Crypto.com Arena', venue_city: 'Los Angeles, CA', countryId: US, startYear: 2021, endYear: null },
  ]},
  { entityName: 'Memphis Grizzlies', venues: [
    { venue: 'General Motors Place', venue_city: 'Vancouver, BC', countryId: CA, startYear: 1996, endYear: 2000 },
    { venue: 'Pyramid Arena', venue_city: 'Memphis, TN', countryId: US, startYear: 2001, endYear: 2003 },
    { venue: 'FedExForum', venue_city: 'Memphis, TN', countryId: US, startYear: 2004, endYear: null },
  ]},
  { entityName: 'Miami Heat', venues: [
    { venue: 'Miami Arena', venue_city: 'Miami, FL', countryId: US, startYear: 1989, endYear: 1999 },
    { venue: 'American Airlines Arena', venue_city: 'Miami, FL', countryId: US, startYear: 2000, endYear: 2020 },
    { venue: 'FTX Arena', venue_city: 'Miami, FL', countryId: US, startYear: 2021, endYear: 2022 },
    { venue: 'Kaseya Center', venue_city: 'Miami, FL', countryId: US, startYear: 2023, endYear: null },
  ]},
  { entityName: 'Milwaukee Bucks', venues: [
    { venue: 'MECCA Arena', venue_city: 'Milwaukee, WI', countryId: US, startYear: 1969, endYear: 1987 },
    { venue: 'Bradley Center', venue_city: 'Milwaukee, WI', countryId: US, startYear: 1988, endYear: 2011 },
    { venue: 'BMO Harris Bradley Center', venue_city: 'Milwaukee, WI', countryId: US, startYear: 2012, endYear: 2017 },
    { venue: 'Fiserv Forum', venue_city: 'Milwaukee, WI', countryId: US, startYear: 2018, endYear: null },
  ]},
  { entityName: 'Minnesota Timberwolves', venues: [
    { venue: 'Hubert H. Humphrey Metrodome', venue_city: 'Minneapolis, MN', countryId: US, startYear: 1989, endYear: 1989 },
    { venue: 'Target Center', venue_city: 'Minneapolis, MN', countryId: US, startYear: 1990, endYear: null },
  ]},
  { entityName: 'New Orleans Pelicans', venues: [
    { venue: 'New Orleans Arena', venue_city: 'New Orleans, LA', countryId: US, startYear: 2003, endYear: 2004 },
    { venue: 'Ford Center', venue_city: 'Oklahoma City, OK', countryId: US, startYear: 2005, endYear: 2006 },
    { venue: 'New Orleans Arena', venue_city: 'New Orleans, LA', countryId: US, startYear: 2007, endYear: 2013 },
    { venue: 'Smoothie King Center', venue_city: 'New Orleans, LA', countryId: US, startYear: 2014, endYear: null },
  ]},
  { entityName: 'New York Knicks', venues: [
    { venue: 'Madison Square Garden III', venue_city: 'New York, NY', countryId: US, startYear: 1947, endYear: 1967 },
    { venue: 'Madison Square Garden IV', venue_city: 'New York, NY', countryId: US, startYear: 1968, endYear: null },
  ]},
  { entityName: 'Oklahoma City Thunder', venues: [
    { venue: 'Seattle Center Coliseum', venue_city: 'Seattle, WA', countryId: US, startYear: 1968, endYear: 1977 },
    { venue: 'Kingdome', venue_city: 'Seattle, WA', countryId: US, startYear: 1978, endYear: 1984 },
    { venue: 'Seattle Center Coliseum', venue_city: 'Seattle, WA', countryId: US, startYear: 1985, endYear: 1994 },
    { venue: 'KeyArena', venue_city: 'Seattle, WA', countryId: US, startYear: 1995, endYear: 2008 },
    { venue: 'Ford Center', venue_city: 'Oklahoma City, OK', countryId: US, startYear: 2009, endYear: 2010 },
    { venue: 'Chesapeake Energy Arena', venue_city: 'Oklahoma City, OK', countryId: US, startYear: 2011, endYear: 2020 },
    { venue: 'Paycom Center', venue_city: 'Oklahoma City, OK', countryId: US, startYear: 2021, endYear: null },
  ]},
  { entityName: 'Orlando Magic', venues: [
    { venue: 'Orlando Arena', venue_city: 'Orlando, FL', countryId: US, startYear: 1990, endYear: 1998 },
    { venue: 'TD Waterhouse Centre', venue_city: 'Orlando, FL', countryId: US, startYear: 1999, endYear: 2005 },
    { venue: 'Amway Arena', venue_city: 'Orlando, FL', countryId: US, startYear: 2006, endYear: 2009 },
    { venue: 'Amway Center', venue_city: 'Orlando, FL', countryId: US, startYear: 2010, endYear: 2022 },
    { venue: 'Kia Center', venue_city: 'Orlando, FL', countryId: US, startYear: 2023, endYear: null },
  ]},
  { entityName: 'Philadelphia 76ers', venues: [
    { venue: 'Syracuse War Memorial', venue_city: 'Syracuse, NY', countryId: US, startYear: 1950, endYear: 1963 },
    { venue: 'Philadelphia Convention Hall', venue_city: 'Philadelphia, PA', countryId: US, startYear: 1964, endYear: 1966 },
    { venue: 'The Spectrum', venue_city: 'Philadelphia, PA', countryId: US, startYear: 1967, endYear: 1995 },
    { venue: 'CoreStates Center', venue_city: 'Philadelphia, PA', countryId: US, startYear: 1996, endYear: 1997 },
    { venue: 'First Union Center', venue_city: 'Philadelphia, PA', countryId: US, startYear: 1998, endYear: 2002 },
    { venue: 'Wachovia Center', venue_city: 'Philadelphia, PA', countryId: US, startYear: 2003, endYear: 2009 },
    { venue: 'Wells Fargo Center', venue_city: 'Philadelphia, PA', countryId: US, startYear: 2010, endYear: 2024 },
    { venue: 'Xfinity Mobile Arena', venue_city: 'Philadelphia, PA', countryId: US, startYear: 2025, endYear: null },
  ]},
  { entityName: 'Phoenix Suns', venues: [
    { venue: 'Arizona Veterans Memorial Coliseum', venue_city: 'Phoenix, AZ', countryId: US, startYear: 1969, endYear: 1991 },
    { venue: 'America West Arena', venue_city: 'Phoenix, AZ', countryId: US, startYear: 1992, endYear: 2005 },
    { venue: 'US Airways Center', venue_city: 'Phoenix, AZ', countryId: US, startYear: 2006, endYear: 2014 },
    { venue: 'Talking Stick Resort Arena', venue_city: 'Phoenix, AZ', countryId: US, startYear: 2015, endYear: 2019 },
    { venue: 'Footprint Center', venue_city: 'Phoenix, AZ', countryId: US, startYear: 2020, endYear: 2024 },
    { venue: 'Mortgage Matchup Center', venue_city: 'Phoenix, AZ', countryId: US, startYear: 2025, endYear: null },
  ]},
  { entityName: 'Portland Trail Blazers', venues: [
    { venue: 'Memorial Coliseum', venue_city: 'Portland, OR', countryId: US, startYear: 1971, endYear: 1994 },
    { venue: 'Rose Garden Arena', venue_city: 'Portland, OR', countryId: US, startYear: 1995, endYear: 2012 },
    { venue: 'Moda Center', venue_city: 'Portland, OR', countryId: US, startYear: 2013, endYear: null },
  ]},
  { entityName: 'Sacramento Kings', venues: [
    { venue: 'Cincinnati Gardens', venue_city: 'Cincinnati, OH', countryId: US, startYear: 1958, endYear: 1972 },
    { venue: 'Municipal Auditorium', venue_city: 'Kansas City, MO', countryId: US, startYear: 1973, endYear: 1975 },
    { venue: 'Kemper Arena', venue_city: 'Kansas City, MO', countryId: US, startYear: 1976, endYear: 1984 },
    { venue: 'ARCO Arena (I)', venue_city: 'Sacramento, CA', countryId: US, startYear: 1985, endYear: 1987 },
    { venue: 'ARCO Arena', venue_city: 'Sacramento, CA', countryId: US, startYear: 1988, endYear: 2010 },
    { venue: 'Power Balance Pavilion', venue_city: 'Sacramento, CA', countryId: US, startYear: 2011, endYear: 2012 },
    { venue: 'Sleep Train Arena', venue_city: 'Sacramento, CA', countryId: US, startYear: 2013, endYear: 2015 },
    { venue: 'Golden 1 Center', venue_city: 'Sacramento, CA', countryId: US, startYear: 2016, endYear: null },
  ]},
  { entityName: 'San Antonio Spurs', venues: [
    { venue: 'HemisFair Arena', venue_city: 'San Antonio, TX', countryId: US, startYear: 1977, endYear: 1992 },
    { venue: 'Alamodome', venue_city: 'San Antonio, TX', countryId: US, startYear: 1993, endYear: 2001 },
    { venue: 'SBC Center', venue_city: 'San Antonio, TX', countryId: US, startYear: 2002, endYear: 2005 },
    { venue: 'AT&T Center', venue_city: 'San Antonio, TX', countryId: US, startYear: 2006, endYear: 2019 },
    { venue: 'Frost Bank Center', venue_city: 'San Antonio, TX', countryId: US, startYear: 2020, endYear: null },
  ]},
  { entityName: 'Toronto Raptors', venues: [
    { venue: 'SkyDome', venue_city: 'Toronto, ON', countryId: CA, startYear: 1996, endYear: 1998 },
    { venue: 'Air Canada Centre', venue_city: 'Toronto, ON', countryId: CA, startYear: 1999, endYear: 2017 },
    { venue: 'Scotiabank Arena', venue_city: 'Toronto, ON', countryId: CA, startYear: 2018, endYear: 2020 },
    { venue: 'Amalie Arena', venue_city: 'Tampa, FL', countryId: US, startYear: 2021, endYear: 2021 },
    { venue: 'Scotiabank Arena', venue_city: 'Toronto, ON', countryId: CA, startYear: 2022, endYear: null },
  ]},
  { entityName: 'Utah Jazz', venues: [
    { venue: 'Louisiana Superdome', venue_city: 'New Orleans, LA', countryId: US, startYear: 1975, endYear: 1979 },
    { venue: 'Salt Palace', venue_city: 'Salt Lake City, UT', countryId: US, startYear: 1980, endYear: 1990 },
    { venue: 'Delta Center', venue_city: 'Salt Lake City, UT', countryId: US, startYear: 1991, endYear: 2005 },
    { venue: 'EnergySolutions Arena', venue_city: 'Salt Lake City, UT', countryId: US, startYear: 2006, endYear: 2014 },
    { venue: 'Vivint Smart Home Arena', venue_city: 'Salt Lake City, UT', countryId: US, startYear: 2015, endYear: 2022 },
    { venue: 'Delta Center', venue_city: 'Salt Lake City, UT', countryId: US, startYear: 2023, endYear: null },
  ]},
  { entityName: 'Washington Wizards', venues: [
    { venue: 'International Amphitheatre', venue_city: 'Chicago, IL', countryId: US, startYear: 1962, endYear: 1962 },
    { venue: 'Chicago Coliseum', venue_city: 'Chicago, IL', countryId: US, startYear: 1963, endYear: 1963 },
    { venue: 'Baltimore Civic Center', venue_city: 'Baltimore, MD', countryId: US, startYear: 1964, endYear: 1973 },
    { venue: 'Capital Centre', venue_city: 'Landover, MD', countryId: US, startYear: 1974, endYear: 1996 },
    { venue: 'US Airways Arena', venue_city: 'Landover, MD', countryId: US, startYear: 1997, endYear: 1997 },
    { venue: 'MCI Center', venue_city: 'Washington, DC', countryId: US, startYear: 1998, endYear: 2005 },
    { venue: 'Verizon Center', venue_city: 'Washington, DC', countryId: US, startYear: 2006, endYear: 2016 },
    { venue: 'Capital One Arena', venue_city: 'Washington, DC', countryId: US, startYear: 2017, endYear: null },
  ]},
];

async function resolveEntityId(name) {
  const r = await pool.query(`SELECT id FROM entities WHERE entity_type = 'club' AND canonical_name = $1`, [name]);
  if (!r.rows.length) throw new Error(`No entity found for "${name}"`);
  return r.rows[0].id;
}

async function main() {
  if (!ARENAS.length) {
    console.error('ARENAS is empty — fill in the compiled arena-history data before running.');
    process.exit(1);
  }
  for (const team of ARENAS) {
    const entityId = await resolveEntityId(team.entityName);
    await pool.query(`DELETE FROM entity_venues WHERE entity_id = $1`, [entityId]);
    for (const v of team.venues) {
      await pool.query(
        `INSERT INTO entity_venues (entity_id, venue, venue_city, venue_country_id, start_year, end_year)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entityId, v.venue, v.venue_city, v.countryId, v.startYear, v.endYear]
      );
    }
    console.log(`${team.entityName}: ${team.venues.length} arena eras ingested`);
  }
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
