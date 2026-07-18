// Derives NBA team entities + franchise-history (entity_names) directly from
// TeamStatistics.csv — no Games.csv/TeamHistories.csv needed (see onboarding-nba.md
// Section 3). teamId stays constant across relocations/renames (verified against the
// Hornets/Bobcats split), so grouping (teamId, teamCity, teamName) with season-year
// ranges gives an accurate history with zero external source.
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { getSeasonYear } = require('./nba-season-year');

const CSV_PATH = path.join(__dirname, '..', '00-nba', 'TeamStatistics.csv');
const USA_COUNTRY_ID = 91;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'rankks',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });

  // teamId -> Map(seasonYear -> {city, name}) — one (city,name) per team per season year,
  // confirmed no team ever has two names within the same season year.
  const teamYears = new Map();
  let maxSeasonYearOverall = 0;

  // Scope to the game types onboarding-nba.md Section 3.1 actually covers — Regular
  // Season/Playoffs/Play-in Tournament. Preseason (blank gameType), All-Star Game (draft
  // team names like "Team Stripes"), and Emirates NBA Cup rows would otherwise pollute
  // team-entity extraction with non-franchise names (international exhibition opponents,
  // All-Star draft teams) — confirmed by inspection before this filter was added.
  const IN_SCOPE_GAME_TYPES = new Set(['Regular Season', 'Playoffs', 'Play-in Tournament']);

  for (const r of records) {
    if (r.teamId === '0' || !r.gameDateTimeEst) continue;
    if (!IN_SCOPE_GAME_TYPES.has(r.gameType)) continue;
    const teamId = r.teamId;
    const year = getSeasonYear(r.gameDateTimeEst, CSV_PATH);
    maxSeasonYearOverall = Math.max(maxSeasonYearOverall, year);

    if (!teamYears.has(teamId)) teamYears.set(teamId, new Map());
    teamYears.get(teamId).set(year, { city: r.teamCity, name: r.teamName });
  }

  // Collapse each team's year-by-year (city,name) timeline into CONTIGUOUS eras —
  // grouping by (city,name) alone would wrongly merge e.g. Charlotte Hornets'
  // 1989-2002 era with its 2014-present era across the 2005-2014 Bobcats gap,
  // making the season-aware entity_names lookup ambiguous (two rows matching
  // one year). An era ends when the value differs from the *immediately
  // preceding* year, not just any earlier occurrence.
  const teams = new Map(); // teamId -> array of {city, name, minYear, maxYear}
  for (const [teamId, yearMap] of teamYears) {
    const years = [...yearMap.keys()].sort((a, b) => a - b);
    const eras = [];
    for (const year of years) {
      const { city, name } = yearMap.get(year);
      const last = eras[eras.length - 1];
      if (last && last.city === city && last.name === name && year === last.maxYear + 1) {
        last.maxYear = year;
      } else {
        eras.push({ city, name, minYear: year, maxYear: year });
      }
    }
    teams.set(teamId, eras);
  }

  console.log(`Parsed ${records.length} rows -> ${teams.size} distinct teamIds. Latest season year in data: ${maxSeasonYearOverall}`);

  let entitiesCreated = 0, entitiesSkipped = 0, namesCreated = 0, namesSkipped = 0;

  for (const [teamId, eras] of teams) {
    const groups = eras; // already chronologically ordered
    const current = groups[groups.length - 1]; // most recent name era
    const canonicalName = `${current.city} ${current.name}`;
    const slug = slugify(canonicalName);
    const isActive = current.maxYear >= maxSeasonYearOverall;

    // Find or create the entity, keyed by external_ids->>'nba_team_id'
    let entity = await pool.query(
      `SELECT id FROM entities WHERE entity_type = 'club' AND external_ids->>'nba_team_id' = $1`,
      [teamId]
    );
    let entityId;
    if (entity.rows.length) {
      entityId = entity.rows[0].id;
      entitiesSkipped++;
    } else {
      const ins = await pool.query(
        `INSERT INTO entities (entity_type, canonical_name, slug, country_id, external_ids, is_active)
         VALUES ('club', $1, $2, $3, $4::jsonb, $5)
         RETURNING id`,
        [canonicalName, slug, USA_COUNTRY_ID, JSON.stringify({ nba_team_id: teamId }), isActive]
      );
      entityId = ins.rows[0].id;
      entitiesCreated++;
    }

    // entity_names: one row per (city, name) era for this team
    for (const g of groups) {
      const displayName = `${g.city} ${g.name}`;
      const isCurrentEra = g === current;
      const endYear = isCurrentEra ? null : g.maxYear;

      const existing = await pool.query(
        `SELECT id FROM entity_names WHERE entity_id = $1 AND start_year = $2 AND display_name = $3`,
        [entityId, g.minYear, displayName]
      );
      if (existing.rows.length) { namesSkipped++; continue; }

      await pool.query(
        `INSERT INTO entity_names (entity_id, display_name, short_name, start_year, end_year, change_reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entityId, displayName, g.name, g.minYear, endYear, 'Derived from TeamStatistics.csv team identity']
      );
      namesCreated++;
    }
  }

  console.log(`Entities: ${entitiesCreated} created, ${entitiesSkipped} already existed`);
  console.log(`entity_names: ${namesCreated} created, ${namesSkipped} already existed`);
  await pool.end();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
