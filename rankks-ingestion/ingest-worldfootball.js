// =============================================================
// RANKKS — Ingest worldfootball.net historical scrape into Postgres
// Loads rankks-ingestion/worldfootball-scrape-output.json (produced by
// scrape-worldfootball.js) into the same tables/conventions the existing
// api-sports.io pipeline uses (ingest-standings.js, ingest-fixtures.js,
// ingest-players.js) — same competition (ligue-1-france), same
// result_tabs structure, same entity-matching approach.
//
// Run:
//   node ingest-worldfootball.js test <season>   e.g. 1935-1936
//   node ingest-worldfootball.js all
//
// Club-name reconciliation (verified against the live DB, not assumed):
// worldfootball.net uses full names ("AS Monaco", "Olympique Lyonnais",
// "Lille OSC") where RANKKS's existing entities use short ones ("Monaco",
// "Lyon", "Lille") inherited from api-sports.io's naming. CLUB_ALIASES
// below maps the 31 confirmed same-club cases; the aliases are also
// written to entity_aliases so future lookups (from either pipeline)
// resolve automatically. A few historically distinct clubs are
// deliberately NOT mapped, confirmed by checking exactly which seasons
// each name appears in scrape output:
//   - "Toulouse FC (old)" (1946-67, the original club, dissolved 1967)
//     vs unqualified "Toulouse FC" (1982-2009, continuous into the
//     existing modern "Toulouse" entity — the club was re-founded 1970).
//   - "Olympique Lillois Lille" and "SC Fives Lille" (both 1932-38 only)
//     — the two clubs that merged in 1944 to *form* Lille OSC (which
//     first appears 1945-46). Kept separate, not merged into "Lille".
//   - "Lyon OU" — a single 1945-46 season, unrelated to Olympique
//     Lyonnais (which only starts 1951-52). Kept separate.
// =============================================================

require('dotenv').config({ path: '.env' });
const fs = require('fs');
const path = require('path');
const { queryOne, queryAll, query, end } = require('./db');

const COMPETITION_SLUG = 'ligue-1-france';
const SCRAPE_PATH = path.join(__dirname, 'worldfootball-scrape-output.json');
const DETAILS_PATH = path.join(__dirname, 'worldfootball-player-details.json');
const LEAGUE_SLUG = 'ligue-1';

// worldfootball.net's country-facts text vs RANKKS's countries.name — the
// other 102 of 112 distinct strings seen in the scrape matched exactly;
// only these 10 needed a mapping (checked against the live table, not
// assumed), covering historical-nation naming (CSSR/USSR) and a few plain
// spelling differences.
const COUNTRY_ALIASES = {
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  'CSSR': 'Czechoslovakia',
  'Cape Verde Islands': 'Cabo Verde',
  'Great Britain': 'United Kingdom',
  'Ivory Coast': "Côte d'Ivoire",
  'Reunion': 'Réunion',
  'Saint Martin': 'Saint Martin (French part)',
  'Tahiti': 'French Polynesia',
  'USA': 'United States',
  'USSR': 'Soviet Union',
};

const CLUB_ALIASES = {
  'AC Ajaccio': 'Ajaccio',
  'AJ Auxerre': 'Auxerre',
  'AS Monaco': 'Monaco',
  'AS Nancy Lorraine': 'Nancy',
  'AS Saint-Étienne': 'Saint Etienne',
  'Angers SCO': 'Angers',
  'EA Guingamp': 'Guingamp',
  'ES Troyes AC': 'Estac Troyes',
  'FC Lorient': 'Lorient',
  'FC Metz': 'Metz',
  'FC Nancy': 'Nancy',
  'FC Nantes': 'Nantes',
  'FC Sochaux': 'Sochaux',
  'Girondins de Bordeaux': 'Bordeaux',
  'Havre AC': 'Le Havre',
  'Lille OSC': 'Lille',
  'Montpellier HSC': 'Montpellier',
  'Nîmes Olympique': 'Nimes',
  'OGC Nice': 'Nice',
  'Olympique Lyonnais': 'Lyon',
  'Olympique de Marseille': 'Marseille',
  'Paris Saint-Germain': 'Paris Saint Germain',
  'RC Lens': 'Lens',
  'Racing Strasbourg': 'Strasbourg',
  'SC Bastia': 'Bastia',
  'SC Nîmes': 'Nimes',
  'SM Caen': 'Caen',
  'Stade Rennais': 'Rennes',
  'Stade de Reims': 'Reims',
  'Toulouse FC': 'Toulouse',
  'Valenciennes FC': 'Valenciennes',
};

async function seedClubAliases() {
  let seeded = 0, missing = [];
  for (const [alias, canonical] of Object.entries(CLUB_ALIASES)) {
    const entity = await queryOne(
      `SELECT id FROM entities WHERE entity_type = 'club' AND canonical_name = $1`,
      [canonical]
    );
    if (!entity) { missing.push(canonical); continue; }
    const res = await query(
      `INSERT INTO entity_aliases (entity_id, alias, source, alias_type)
       VALUES ($1, $2, 'worldfootball', 'name_variant')
       ON CONFLICT (alias, source) DO NOTHING`,
      [entity.id, alias]
    );
    if (res.rowCount > 0) seeded++;
  }
  if (missing.length) {
    console.log(`  ⚠️  Expected existing entities not found: ${missing.join(', ')}`);
  }
  console.log(`  🔗 Club aliases seeded: ${seeded} new (of ${Object.keys(CLUB_ALIASES).length} mapped)`);
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

let countryIdByName = null;
async function loadCountryLookup() {
  if (countryIdByName) return countryIdByName;
  const rows = await queryAll(`SELECT id, name FROM countries`);
  countryIdByName = new Map(rows.map((r) => [r.name, r.id]));
  return countryIdByName;
}

function resolveCountryId(countryName) {
  if (!countryName) return null;
  const resolved = COUNTRY_ALIASES[countryName] || countryName;
  return countryIdByName.get(resolved) || null;
}

let footballSportId = null;
async function getFootballSportId() {
  if (footballSportId) return footballSportId;
  const row = await queryOne(`SELECT id FROM sports WHERE slug = 'football'`);
  footballSportId = row?.id || null;
  return footballSportId;
}

// Name text can differ just enough to dodge ILIKE (accents, double spaces,
// punctuation — e.g. scraped "Yoann Gourcuff" vs an existing "Yoann  Gourcuff"
// with a stray double space) while still slugifying identically, which would
// otherwise crash on entities_slug_key. Checking by slug before creating
// catches that whole class of near-miss instead of minting a duplicate.
async function findOrCreateEntity(entityType, name, personId) {
  // Players: worldfootball's own numeric person ID is a far more reliable
  // match than name text (immune to accents/spacing/same-name collisions) —
  // check it first whenever we have one.
  if (entityType === 'player' && personId) {
    const byExternalId = await queryOne(
      `SELECT id FROM entities WHERE entity_type = 'player' AND external_ids->>'worldfootball_person_id' = $1`,
      [personId]
    );
    if (byExternalId) return byExternalId;
  }

  let entity = await queryOne(
    `SELECT id FROM entities WHERE entity_type = $1 AND canonical_name ILIKE $2`,
    [entityType, name]
  );
  if (entity) return entity;

  if (entityType === 'club') {
    entity = await queryOne(
      `SELECT e.id FROM entities e
       JOIN entity_aliases ea ON ea.entity_id = e.id
       WHERE e.entity_type = 'club' AND ea.alias ILIKE $1`,
      [name]
    );
    if (entity) return entity;
  }

  const slug = slugify(name);
  entity = await queryOne(`SELECT id FROM entities WHERE slug = $1`, [slug]);
  if (entity) return entity;

  try {
    entity = await queryOne(
      `INSERT INTO entities (canonical_name, slug, entity_type, is_active, is_verified)
       VALUES ($1, $2, $3, true, false) RETURNING id`,
      [name, slug, entityType]
    );
  } catch (err) {
    if (err.code === '23505') { // unique_violation — lost a race on slug, just re-fetch
      entity = await queryOne(`SELECT id FROM entities WHERE slug = $1`, [slug]);
      if (entity) return entity;
    }
    throw err;
  }
  if (entityType === 'club') console.log(`     ➕ Created club: ${name}`);
  return entity;
}

async function findOrCreateClub(name) {
  return findOrCreateEntity('club', name);
}

// Resolves the player entity, then enriches it with everything
// scrapePersonDetail found (birth/death date, country, height) and the
// squad-page role as position — always via COALESCE, so a field already
// set from some other source (e.g. an existing api-sports-era entity) is
// never overwritten, only filled in where missing.
async function findOrCreatePlayer(name, personId, personSlug, playerDetails) {
  const entity = await findOrCreateEntity('player', name, personId);
  const details = personId ? playerDetails[personId] : null;

  const countryId = details ? resolveCountryId(details.country) : null;
  await query(
    `UPDATE entities SET
       external_ids = COALESCE(external_ids, '{}'::jsonb) || $1::jsonb,
       birth_date = COALESCE(birth_date, $2),
       death_date = COALESCE(death_date, $3),
       country_id = COALESCE(country_id, $4),
       height_cm = COALESCE(height_cm, $5),
       updated_at = NOW()
     WHERE id = $6`,
    [
      JSON.stringify(personId ? { worldfootball_person_id: personId } : {}),
      details?.birth_date || null,
      details?.death_date || null,
      countryId,
      details?.height_cm || null,
      entity.id,
    ]
  );

  return entity;
}

async function setPlayerPosition(entityId, role) {
  if (!role || role === 'Manager') return;
  const sportId = await getFootballSportId();
  if (!sportId) return;
  await query(
    `INSERT INTO player_attributes (entity_id, sport_id, attribute_key, attribute_value)
     VALUES ($1, $2, 'position', $3)
     ON CONFLICT (entity_id, sport_id, attribute_key) DO NOTHING`,
    [entityId, sportId, role]
  ).catch(() => {}); // matches ingest-players.js's own defensive no-op here
}

async function getOrCreateSeason(seasonLabel) {
  const year = parseInt(seasonLabel.split('-')[0], 10);

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [COMPETITION_SLUG]);
  if (!comp) throw new Error(`Competition not found: ${COMPETITION_SLUG}`);

  let seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2`,
    [comp.id, year]
  );
  if (!seasonRow) {
    seasonRow = await queryOne(
      `INSERT INTO seasons (competition_id, year, status, gender)
       VALUES ($1, $2, 'past', 'M') RETURNING id`,
      [comp.id, year]
    );
    console.log(`     ✅ Created season ${year}`);
  }

  const tabDefs = [
    ['Standings', 'standings', 'standings', 0, true, null],
    ['Results', 'final_tour', 'game', 2, false, null],
    ['Scorers', 'scorers', 'players', 3, false, null],
    ['Passers', 'passers', 'players', 4, false, null],
    ['Players', 'players', 'players', 5, false, null],
    ['Videos', 'videos', 'iconic_moments', 99, false, null],
    // All-Time group — pinned in LineA next to Iconic Moments (tab_key
    // 'all-time' sentinel, see ContentArea.jsx/LineA.jsx). typology
    // 'coming_soon' until the real Player/Team/Champion History columns
    // are spec'd — see rankks-frontend's coming_soon_template.jsx.
    ['Player Stats', 'all-time-players', 'players_all_time_fb', 300, false, 'all_time'],
    ['Team Stats', 'all-time-teams', 'teams_all_time', 301, false, 'all_time'],
    ['Champion History', 'all-time-champion-history', 'champion_history_fb', 302, false, 'all_time'],
  ];
  const tabs = {};
  for (const [tab_name, tab_key, typology, display_order, is_default, tab_group] of tabDefs) {
    let tab = await queryOne(
      `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
      [seasonRow.id, tab_key]
    );
    if (!tab) {
      tab = await queryOne(
        `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default, tab_group)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [seasonRow.id, tab_name, tab_key, typology, display_order, is_default, tab_group]
      );
    }
    tabs[tab_key] = tab.id;
  }

  return { seasonId: seasonRow.id, tabs };
}

// "81:45" -> { for: 81, against: 45 }
function parseGoals(raw) {
  const [f, a] = (raw || '0:0').split(':').map((n) => parseInt(n, 10));
  return { for: f || 0, against: a || 0 };
}

// worldfootball flattens multi-group standings (e.g. 1932-33, Ligue 1's
// inaugural season, ran as two 10-team groups) into one list where rank
// resets back to 1 at each group boundary. Detect those resets so groups
// don't collide on position — everything else is a single implicit group
// (group_name stays null, matching every other season).
function assignGroups(rows) {
  let groupIndex = 0;
  let prevRank = -Infinity;
  const withGroups = rows.map((row) => {
    if (row.rank <= prevRank) groupIndex++;
    prevRank = row.rank;
    return { ...row, group: groupIndex };
  });
  return groupIndex === 0
    ? withGroups.map((r) => ({ ...r, group_name: null }))
    : withGroups.map((r) => ({ ...r, group_name: `Group ${String.fromCharCode(65 + r.group)}` }));
}

async function ingestStandings(seasonLabel, standingsTabId, rows) {
  // Standings are always the full current list from the source — delete and
  // rebuild the tab rather than incrementally reconciling by position, which
  // breaks down across group boundaries (see assignGroups above).
  await query(`DELETE FROM standings WHERE result_tab_id = $1`, [standingsTabId]);

  let n = 0;
  for (const row of assignGroups(rows)) {
    const club = await findOrCreateClub(row.team);
    const goals = parseGoals(row.goals);
    const stats = {
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      goals_for: goals.for,
      goals_against: goals.against,
      goal_diff: goals.for - goals.against,
      points: row.points,
    };

    await query(
      `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats, group_name)
       VALUES ($1, $2, $3, 'club', $4, $5)`,
      [standingsTabId, row.rank, club.id, JSON.stringify(stats), row.group_name]
    );
    n++;
  }
  return n;
}

// "24.05.1936" -> "1936-05-24"
function parseWorldfootballDate(raw) {
  const m = (raw || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function ingestResults(resultsTabId, rows) {
  let n = 0;
  for (const row of rows) {
    const home = await findOrCreateClub(row.home);
    const away = await findOrCreateClub(row.away);
    const [homeGoals, awayGoals] = (row.score || '').split(':').map((s) => parseInt(s, 10));

    let winnerId = null, homeWon = null;
    if (!Number.isNaN(homeGoals) && !Number.isNaN(awayGoals)) {
      if (homeGoals > awayGoals) { winnerId = home.id; homeWon = true; }
      else if (awayGoals > homeGoals) { winnerId = away.id; homeWon = false; }
    }

    const scoreJson = {
      home: Number.isNaN(homeGoals) ? null : homeGoals,
      away: Number.isNaN(awayGoals) ? null : awayGoals,
      fulltime: { home: Number.isNaN(homeGoals) ? null : homeGoals, away: Number.isNaN(awayGoals) ? null : awayGoals },
      status: 'FT',
    };

    const round = `Regular Season - ${row.matchday}`;
    const matchDate = parseWorldfootballDate(row.date);

    await query(
      `INSERT INTO games (
         result_tab_id, round, leg_number, match_date,
         home_entity_id, away_entity_id, home_entity_type, away_entity_type,
         score, winner_entity_id, home_won
       ) VALUES ($1,$2,1,$3,$4,$5,'club','club',$6,$7,$8)
       ON CONFLICT (result_tab_id, round, home_entity_id, away_entity_id, leg_number) DO UPDATE SET
         match_date = EXCLUDED.match_date,
         score = EXCLUDED.score,
         winner_entity_id = EXCLUDED.winner_entity_id,
         home_won = EXCLUDED.home_won,
         updated_at = NOW()`,
      [resultsTabId, round, matchDate, home.id, away.id, JSON.stringify(scoreJson), winnerId, homeWon]
    );
    n++;
  }
  return n;
}

// Football's player_season_stats rows are never tab-scoped — Scorers,
// Passers, and Players all read the same season-wide, result_tab_id-IS-NULL
// row set (see rankks-api/src/routes/results.js's tab-scoping comment;
// matches how ingest-players.js/ingest-topscorers.js already write these).
// Only basketball's award tabs tag result_tab_id, since they legitimately
// need several different candidate lists sharing one season.
async function ingestPlayerStat(seasonId, row, statKey, playerDetails) {
  const player = await findOrCreatePlayer(row.player, row.personId, row.personSlug, playerDetails);
  const club = await findOrCreateClub(row.team);
  const value = row[statKey];

  const setCol = statKey === 'goals' ? 'goals' : 'assists';
  const rankCol = statKey === 'goals' ? 'ranking_at_event' : null;

  await query(
    `INSERT INTO player_season_stats (entity_id, season_id, club_entity_id, ${setCol}${rankCol ? `, ${rankCol}` : ''})
     VALUES ($1, $2, $3, $4${rankCol ? ', $5' : ''})
     ON CONFLICT (entity_id, season_id, club_entity_id) DO UPDATE SET
       ${setCol} = EXCLUDED.${setCol}${rankCol ? `, ${rankCol} = EXCLUDED.${rankCol}` : ''},
       updated_at = NOW()`,
    rankCol ? [player.id, seasonId, club.id, value, row.rank] : [player.id, seasonId, club.id, value]
  );
}

// Full squad roster — establishes a player_season_stats row for every
// squad member (not just the goal/assist leaders), so the Players tab
// shows a real roster. DO NOTHING on conflict: a row already existing here
// means the scorers/assists pass already created it with real stats, and
// squads have no per-player numbers of their own to contribute — only
// identity (which findOrCreatePlayer's UPDATE already enriches regardless
// of which pass ran first).
async function ingestSquads(seasonId, squads, playerDetails) {
  let n = 0;
  for (const squad of Object.values(squads || {})) {
    const club = await findOrCreateClub(squad.teamName);
    for (const p of squad.players) {
      if (p.role === 'Manager') continue;
      const player = await findOrCreatePlayer(p.name, p.personId, p.personSlug, playerDetails);
      await setPlayerPosition(player.id, p.role);
      await query(
        `INSERT INTO player_season_stats (entity_id, season_id, club_entity_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (entity_id, season_id, club_entity_id) DO NOTHING`,
        [player.id, seasonId, club.id]
      );
      n++;
    }
  }
  return n;
}

async function ingestSeason(seasonLabel, data, playerDetails) {
  console.log(`\n📅 ${seasonLabel}`);
  const { seasonId, tabs } = await getOrCreateSeason(seasonLabel);

  const standingsCount = await ingestStandings(seasonLabel, tabs.standings, data.standings);
  const resultsCount = await ingestResults(tabs.final_tour, data.results);
  const squadCount = await ingestSquads(seasonId, data.squads, playerDetails);

  for (const row of data.scorers) {
    await ingestPlayerStat(seasonId, row, 'goals', playerDetails);
  }
  for (const row of data.assists) {
    await ingestPlayerStat(seasonId, row, 'assists', playerDetails);
  }

  console.log(
    `   ✅ standings=${standingsCount} results=${resultsCount} squad_entries=${squadCount} scorers=${data.scorers.length} assists=${data.assists.length}`
  );
}

async function updateFirstDataYear() {
  await query(
    `UPDATE competitions SET first_data_year = 1932 WHERE slug = $1 AND (first_data_year IS NULL OR first_data_year > 1932)`,
    [COMPETITION_SLUG]
  );
}

async function main() {
  const [, , command, seasonArg] = process.argv;
  const scrape = JSON.parse(fs.readFileSync(SCRAPE_PATH, 'utf8'));
  const seasons = scrape[LEAGUE_SLUG];
  const playerDetails = fs.existsSync(DETAILS_PATH) ? JSON.parse(fs.readFileSync(DETAILS_PATH, 'utf8')) : {};

  console.log('🔗 Seeding club aliases...');
  await seedClubAliases();
  await loadCountryLookup();

  if (command === 'test') {
    if (!seasonArg || !seasons[seasonArg]) {
      console.error(`Usage: node ingest-worldfootball.js test <season>`);
      console.error(`Known seasons: ${Object.keys(seasons).join(', ')}`);
      process.exit(1);
    }
    await ingestSeason(seasonArg, seasons[seasonArg], playerDetails);
  } else if (command === 'all') {
    for (const seasonLabel of Object.keys(seasons).sort()) {
      await ingestSeason(seasonLabel, seasons[seasonLabel], playerDetails);
    }
    await updateFirstDataYear();
    console.log('\n✅ Updated first_data_year to 1932');
  } else {
    console.error('Usage:');
    console.error('  node ingest-worldfootball.js test <season>');
    console.error('  node ingest-worldfootball.js all');
    process.exit(1);
  }

  await end();
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
