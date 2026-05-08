/**
 * RANKKS - Tennis Ingestion Script
 * Source: Jeff Sackmann / Tennis Abstract (CC BY-NC-SA 4.0)
 * Repos:  github.com/JeffSackmann/tennis_atp
 *         github.com/JeffSackmann/tennis_wta
 *
 * Usage:
 *   node ingest-tennis.js atp 2020 2024
 *   node ingest-tennis.js wta 2020 2024
 *   node ingest-tennis.js both 1968 2024
 *   node ingest-tennis.js rankings atp 1980
 */

const { Pool } = require('pg');
const https    = require('https');
const readline = require('readline');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'rankks',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});
const q = (text, params) => pool.query(text, params);

const SPORT_ID = 2;

// Hardcoded category ids from your existing event_categories table
// Grand Slam=11(X), ATP M1000=12, WTA 1000=13, ATP 500=14, WTA 500=15
// ATP 250=16, WTA 250=17, ATP Challenger=18, WTA 125=19
function getCategoryId(tourneyLevel, isWTA, drawSize) {
  const is250 = parseInt(drawSize) <= 32;
  if (tourneyLevel === 'G')  return 11;
  if (tourneyLevel === 'PM') return 13;        // WTA Premier Mandatory = 1000
  if (tourneyLevel === 'P')  return is250 ? 15 : 13;  // WTA Premier 500 or 1000
  if (tourneyLevel === 'I')  return is250 ? 17 : 15;  // WTA International 250 or 500
  if (tourneyLevel === 'M')  return 12;        // ATP Masters 1000
  if (tourneyLevel === 'F')  return isWTA ? 13 : 12;
  if (tourneyLevel === 'D')  return isWTA ? 19 : 18;
  if (tourneyLevel === 'C')  return isWTA ? 19 : 18;
  if (tourneyLevel === 'A') {
    if (isWTA) return is250 ? 17 : 15;
    return is250 ? 16 : 14;
  }
  return isWTA ? 17 : 16;
}

// Maps Sackmann tourney_name -> your existing competition slug
// Sackmann name (lowercased, trimmed) -> existing slug in competitions table
const SLUG_MAP = {
  // Grand Slams
  'australian open':        'australian-open',
  'roland garros':          'roland-garros',
  'wimbledon':              'wimbledon',
  'us open':                'us-open-tennis',
  // ATP Masters 1000
  'indian wells masters':   'indian-wells',
  'miami masters':          'miami-open',
  'monte carlo masters':    'monte-carlo',
  'madrid masters':         'madrid-open',
  'rome masters':           'atp-roma',
  'canada masters':         'canadian-open-atp',
  'canadian open':          'canadian-open-atp',
  'cincinnati masters':     'cincinnati-open',
  'shanghai masters':       'shanghai-masters',
  'paris masters':          'paris-masters',
  // ATP 500
  'brisbane international': 'brisbane-international',
  'dallas':                 'dallas-atp',
  'rotterdam':              'rotterdam',
  'rio de janeiro':         'rio-de-janeiro-atp',
  'dubai':                  'dubai-atp',
  'acapulco':               'acapulco',
  'barcelona':              'barcelona-atp',
  'munich':                 'munich-atp',
  "queen's club":           'queens-club',
  'halle':                  'halle',
  'washington':             'washington-atp',
  'beijing':                'beijing-atp',
  'tokyo':                  'tokyo-atp',
  'basel':                  'basel',
  'vienna':                 'vienna',
  // ATP 250
  'adelaide':               'adelaide-atp',
  'adelaide 1':             'adelaide-atp',
  'adelaide 2':             'adelaide-atp',
  'auckland':               'auckland-atp',
  'hong kong':              'hong-kong-atp',
  'montpellier':            'montpellier',
  'cordoba':                'cordoba',
  'pune':                   'pune',
  'buenos aires':           'buenos-aires-atp',
  'delray beach':           'delray-beach',
  'los cabos':              'los-cabos',
  'doha':                   'doha-atp',
  'santiago':               'santiago-atp',
  'marseille':              'marseille-atp',
  'estoril':                'estoril',
  'marrakech':              'marrakesh-atp',
  'houston':                'houston-atp',
  'geneva':                 'geneva-atp',
  'lyon':                   'lyon-atp',
  's-hertogenbosch':        's-hertogenbosch',
  's hertogenbosch':        's-hertogenbosch',  // ADD THIS
  'stuttgart':              'stuttgart-atp',
  'eastbourne':             'eastbourne-atp',
  'mallorca':               'mallorca-atp',
  'atlanta':                'atlanta-atp',
  'bastad':                 'bastad',
  'umag':                   'umag',
  'kitzbuhel':              'kitzbuhel',
  'winston-salem':          'winston-salem',
  'winston salem':          'winston-salem',
  'chengdu':                'chengdu',
  'zhuhai':                 'zhuhai-atp',
  'stockholm':              'stockholm-atp',
  'antwerp':                'antwerp',
  'almaty':                 'almaty-atp',
  'metz':                   'metz',
  // WTA 1000
  'doha wta':               'doha-wta',
  'dubai wta':              'dubai-wta',
  'indian wells wta':       'indian-wells-wta',
  'miami wta':              'miami-wta',
  'stuttgart wta':          'stuttgart-wta',
  'madrid wta':             'madrid-wta',
  'rome wta':               'rome-wta',
  'canada wta':             'canada-wta',
  'cincinnati wta':         'cincinnati-wta',
  'guadalajara wta':        'guadalajara-wta',
  'beijing wta':            'beijing-wta',
  'wuhan':                  'wuhan-wta',
  // WTA 500
  'adelaide wta':           'adelaide-wta',
  'brisbane wta':           'brisbane-wta',
  'linz':                   'linz-wta',
  'abu dhabi':              'abu-dhabi-wta',
  'san diego':              'san-diego-wta',
  'charleston':             'charleston-wta',
  'strasbourg':             'strasbourg-wta',
  'berlin':                 'berlin-wta',
  'eastbourne wta':         'eastbourne-wta',
  'washington wta':         'washington-wta',
  'monterrey':              'monterrey-wta',
  'seoul':                  'seoul-wta',
  'zhengzhou':              'zhengzhou-wta',
  'tokyo wta':              'tokyo-wta',
  'ningbo':                 'ningbo-wta',
  // WTA 250
  'auckland wta':           'auckland-wta',
  'hobart':                 'hobart-wta',
  'hua hin':                'hua-hin-wta',
  'cluj-napoca':            'cluj-napoca-wta',
  'lyon wta':               'lyon-wta',
  'austin':                 'austin-wta',
  'merida':                 'merida-wta',
  'bogota':                 'bogota-wta',
  'rouen':                  'rouen-wta',
  'rabat':                  'rabat-wta',
  'nottingham':             'nottingham-wta',
  'birmingham':             'birmingham-wta',
  'bad homburg':            'bad-homburg-wta',
  'palermo':                'palermo-wta',
  'budapest':               'budapest-wta',
  'prague':                 'prague-wta',
  'lausanne':               'lausanne-wta',
  'hamburg wta':            'hamburg-wta',
  'hamburg':                'hamburg-M',        // ADD THIS
  'iasi':                   'iasi-wta',
  'warsaw':                 'warsaw-wta',
  'cleveland':              'cleveland-wta',
  'monastir':               'monastir-wta',
  'guangzhou':              'guangzhou-wta',
  'osaka':                  'osaka-wta',
  'hong kong wta':          'hong-kong-wta',
  'jiujiang':               'jiujiang-wta',
  'nanchang':               'nanchang-wta',
  'indian wells':         'indian-wells-wta',
'miami':                'miami-wta',
'madrid':               'madrid-wta',
'rome':                 'rome-wta',
'montreal':             'canada-wta',
'cincinnati':           'cincinnati-wta',
'guadalajara':          'guadalajara-wta',
'cluj napoca':          'cluj-napoca-wta',
'australian championships':  'australian-open',
'australian chps.':          'australian-open',
'australian open-2':         'australian-open',
'australian round robin':    'australian-open',
};

// Resolve Sackmann tourney_name to your existing slug or generate a new one
function resolveSlug(tourneyName, isGS, genderChar) {
  const key = tourneyName.toLowerCase().trim();
  if (SLUG_MAP[key]) return SLUG_MAP[key];
  // fallback: generate slug with gender suffix
  return slugify(tourneyName) + (isGS ? '' : '-' + genderChar);
}

const ROUND_MAP = {
  R128: 'Round of 128', R64: 'Round of 64', R32: 'Round of 32',
  R16: 'Round of 16', QF: 'Quarter-Final', SF: 'Semi-Final',
  F: 'Final', BR: 'Bronze Match', RR: 'Round Robin',
};

const BASE_ATP = 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master';
const BASE_WTA = 'https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master';

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 404) { resolve(null); return; }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      const lines = [];
      const rl = readline.createInterface({ input: res, crlfDelay: Infinity });
      rl.on('line', line => lines.push(line));
      rl.on('close', () => resolve(lines));
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
    else { cur += c; }
  }
  result.push(cur.trim());
  return result;
}

function parseRows(lines) {
  if (!lines || lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const vals = parseCSVLine(line);
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? null]));
    });
}

function slugify(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function int(v) { const n = parseInt(v); return isNaN(n) ? null : n; }

function parseScore(scoreStr) {
  if (!scoreStr || scoreStr === 'W/O' || scoreStr === '') return { sets: [], walkover: true };
  const sets = [];
  const parts = scoreStr.trim().split(' ');
  for (const part of parts) {
    const m = part.match(/^(\d+)-(\d+)(?:\((\d+)\))?$/);
    if (m) sets.push({ w: int(m[1]), l: int(m[2]), tb: m[3] ? int(m[3]) : null });
  }
  return { sets, walkover: false };
}

function parseDate(d) {
  if (!d || d.length !== 8) return null;
  return d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6,8);
}

async function upsertPlayer(name, ioc, hand, ht, externalId, genderChar) {
  if (!name || name === '\\N') return null;
  const playerSlug = slugify(name);

  if (externalId && externalId !== '\\N') {
    const r = await q(`SELECT id FROM entities WHERE external_ids->>'sackmann_id' = $1`, [String(externalId)]);
    if (r.rows[0]) return r.rows[0].id;
  }

  const bySlug = await q(
    `SELECT id FROM entities WHERE slug = $1 AND gender = $2 AND entity_type = 'player'`,
    [playerSlug, genderChar]
  );
  if (bySlug.rows[0]) return bySlug.rows[0].id;

  let countryId = null;
  if (ioc && ioc !== '\\N') {
    const c = await q(`SELECT id FROM countries WHERE iso3 = $1`, [ioc]);
    if (c.rows[0]) countryId = c.rows[0].id;
  }

  const sport_attributes = {};
  if (hand && hand !== '\\N') sport_attributes.hand = hand;
  if (ht && ht !== '\\N') sport_attributes.height_cm = int(ht);

  const res = await q(
    `INSERT INTO entities
       (entity_type, canonical_name, slug, country_id, gender, sport_attributes,
        external_ids, is_active, is_verified, created_at, updated_at)
     VALUES ('player', $1, $2, $3, $4, $5, $6, true, false, NOW(), NOW())
     ON CONFLICT (slug) DO UPDATE SET
       country_id       = COALESCE(EXCLUDED.country_id, entities.country_id),
       sport_attributes = EXCLUDED.sport_attributes,
       external_ids     = entities.external_ids || EXCLUDED.external_ids,
       updated_at       = NOW()
     RETURNING id`,
    [name, playerSlug, countryId, genderChar,
     JSON.stringify(sport_attributes),
     JSON.stringify({ sackmann_id: externalId })]
  );
  return res.rows[0].id;
}

async function upsertCompetition(tourneyName, surface, isGS, genderChar, categoryId, compSlug) {
  const existing = await q(`SELECT id FROM competitions WHERE slug = $1`, [compSlug]);
  if (existing.rows[0]) return existing.rows[0].id;

  const res = await q(
    `INSERT INTO competitions
       (category_id, name, slug, surface, competition_type, gender, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'seasonal', $5, true, NOW(), NOW())
     RETURNING id`,
    [categoryId, tourneyName, compSlug, surface || null, isGS ? 'X' : genderChar]
  );
  return res.rows[0].id;
}

async function upsertSeason(competitionId, year, startDate, genderChar) {
  const existing = await q(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND gender = $3`,
    [competitionId, year, genderChar]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const res = await q(
    `INSERT INTO seasons
       (competition_id, year, status, gender, start_date, end_date, created_at, updated_at)
     VALUES ($1, $2, 'past', $3, $4, $4, NOW(), NOW())
     RETURNING id`,
    [competitionId, year, genderChar, startDate]
  );
  return res.rows[0].id;
}

async function upsertResultTab(seasonId, tabName, tabKey, typology, displayOrder) {
  const existing = await q(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`,
    [seasonId, tabKey]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const res = await q(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default, created_at)
     VALUES ($1, $2, $3, $4, $5, false, NOW())
     RETURNING id`,
    [seasonId, tabName, tabKey, typology, displayOrder]
  );
  return res.rows[0].id;
}

async function upsertGame(row, resultTabId, winnerId, loserId) {
  const scoreJson  = parseScore(row.score);
  const isWalkover = row.score === 'W/O' || scoreJson.walkover;
  const isRetired  = (row.score || '').includes('RET');
  const matchDate  = parseDate(row.tourney_date);
  const round      = ROUND_MAP[row.round] || row.round;

  const statsJson = {
    w_ace: int(row.w_ace), w_df: int(row.w_df), w_svpt: int(row.w_svpt),
    w_1stIn: int(row.w_1stIn), w_1stWon: int(row.w_1stWon), w_2ndWon: int(row.w_2ndWon),
    w_SvGms: int(row.w_SvGms), w_bpSaved: int(row.w_bpSaved), w_bpFaced: int(row.w_bpFaced),
    l_ace: int(row.l_ace), l_df: int(row.l_df), l_svpt: int(row.l_svpt),
    l_1stIn: int(row.l_1stIn), l_1stWon: int(row.l_1stWon), l_2ndWon: int(row.l_2ndWon),
    l_SvGms: int(row.l_SvGms), l_bpSaved: int(row.l_bpSaved), l_bpFaced: int(row.l_bpFaced),
    best_of: int(row.best_of),
    w_rank: int(row.winner_rank), w_rank_pts: int(row.winner_rank_points),
    l_rank: int(row.loser_rank),  l_rank_pts: int(row.loser_rank_points),
    w_seed: int(row.winner_seed), l_seed: int(row.loser_seed),
    w_entry: row.winner_entry || null, l_entry: row.loser_entry || null,
  };

  await q(
    `INSERT INTO games
       (result_tab_id, round, match_number, match_date, surface,
        home_entity_id, away_entity_id, home_entity_type, away_entity_type,
        home_seed, away_seed, score, winner_entity_id, home_won,
        is_walkover, is_retirement, duration_minutes, stats, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'player','player',$8,$9,$10,$11,true,$12,$13,$14,$15,NOW(),NOW())
     ON CONFLICT DO NOTHING`,
    [
      resultTabId, round, int(row.match_num), matchDate, row.surface || null,
      winnerId, loserId,
      int(row.winner_seed), int(row.loser_seed),
      JSON.stringify(scoreJson), winnerId,
      isWalkover, isRetired, int(row.minutes),
      JSON.stringify(statsJson),
    ]
  );
}

async function ingestYear(tour, year) {
  const isWTA      = tour === 'wta';
  const genderChar = isWTA ? 'F' : 'M';
  const base       = isWTA ? BASE_WTA : BASE_ATP;
  const prefix     = isWTA ? 'wta'   : 'atp';
  const url        = base + '/' + prefix + '_matches_' + year + '.csv';

  console.log('  Fetching ' + tour.toUpperCase() + ' ' + year + '...');
  const lines = await fetchCSV(url);
  if (!lines) { console.log('     No file for ' + year); return; }

  const rows = parseRows(lines);
  console.log('     ' + rows.length + ' matches found');

  const competitionCache = {};
  const seasonCache      = {};
  const resultTabCache   = {};
  const playerCache      = {};
  let created = 0, skipped = 0, newTourneys = [];

  for (const row of rows) {
    try {
      if (!['G','M','A','F','P','PM','I'].includes(row.tourney_level)) { skipped++; continue; }

      const year4      = int(row.tourney_date && row.tourney_date.slice(0,4)) || year;
      const startDate  = parseDate(row.tourney_date);
      const isGS       = row.tourney_level === 'G';
      const categoryId = getCategoryId(row.tourney_level, isWTA, row.draw_size);
      const compSlug   = resolveSlug(row.tourney_name, isGS, genderChar);

      if (!competitionCache[compSlug]) {
        competitionCache[compSlug] = await upsertCompetition(
          row.tourney_name, row.surface, isGS, genderChar, categoryId, compSlug
        );
        // Log new tournaments not in SLUG_MAP (unmapped ones)
        const key = row.tourney_name.toLowerCase().trim();
        if (!SLUG_MAP[key]) newTourneys.push(row.tourney_name + ' -> ' + compSlug);
      }
      const competitionId = competitionCache[compSlug];

      const seasonKey = competitionId + '-' + year4 + '-' + genderChar;
      if (!seasonCache[seasonKey]) {
        seasonCache[seasonKey] = await upsertSeason(competitionId, year4, startDate, genderChar);
      }
      const seasonId = seasonCache[seasonKey];

      const tabKey = isWTA ? 'draw-singles-f' : 'draw-singles-m'
      const rtKey  = seasonId + '-' + tabKey;
      if (!resultTabCache[rtKey]) {
        resultTabCache[rtKey] = await upsertResultTab(seasonId, 'Draw', tabKey, 'game', 1);
      }
      const resultTabId = resultTabCache[rtKey];

      const wKey = row.winner_id || slugify(row.winner_name);
      const lKey = row.loser_id  || slugify(row.loser_name);

      if (!playerCache[wKey]) {
        playerCache[wKey] = await upsertPlayer(
          row.winner_name, row.winner_ioc, row.winner_hand,
          row.winner_ht, row.winner_id, genderChar
        );
      }
      if (!playerCache[lKey]) {
        playerCache[lKey] = await upsertPlayer(
          row.loser_name, row.loser_ioc, row.loser_hand,
          row.loser_ht, row.loser_id, genderChar
        );
      }

      const winnerId = playerCache[wKey];
      const loserId  = playerCache[lKey];
      if (!winnerId || !loserId) { skipped++; continue; }

      await upsertGame(row, resultTabId, winnerId, loserId);
      created++;

    } catch (err) {
      console.error('     Row error:', err.message, row.winner_name, 'vs', row.loser_name);
      skipped++;
    }
  }

  console.log('     Done: ' + created + ' ingested, ' + skipped + ' skipped');
  if (newTourneys.length > 0) {
    console.log('     New tournaments created (not in SLUG_MAP):');
    [...new Set(newTourneys)].forEach(t => console.log('       - ' + t));
  }
}

async function ingestRankings(tour, decade) {
  const isWTA  = tour === 'wta';
  const base   = isWTA ? BASE_WTA : BASE_ATP;
  const prefix = isWTA ? 'wta'   : 'atp';
  const url    = base + '/' + prefix + '_rankings_' + decade + 's.csv';

  console.log('  Fetching ' + tour.toUpperCase() + ' rankings ' + decade + 's...');
  const lines = await fetchCSV(url);
  if (!lines) { console.log('     No rankings file for ' + decade + 's'); return; }

  const rows = parseRows(lines);
  console.log('     ' + rows.length + ' ranking rows');

  let done = 0;
  for (const row of rows) {
    try {
      if (!row.player_id || !row.ranking) continue;
      const entity = await q(
        `SELECT id FROM entities WHERE external_ids->>'sackmann_id' = $1`,
        [String(row.player_id)]
      );
      if (!entity.rows[0]) continue;

      const rankDate = row.ranking_date
        ? row.ranking_date.slice(0,4) + '-' + row.ranking_date.slice(4,6) + '-' + row.ranking_date.slice(6,8)
        : null;

      await q(
        `INSERT INTO player_attributes
           (entity_id, sport_id, attribute_key, attribute_value, start_year, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT DO NOTHING`,
        [entity.rows[0].id, SPORT_ID, 'rank_' + rankDate,
         JSON.stringify({ rank: int(row.ranking), pts: int(row.ranking_points) }),
         int(row.ranking_date && row.ranking_date.slice(0,4))]
      );
      done++;
    } catch (err) { /* silent */ }
  }
  console.log('     Done: ' + done + ' ranking snapshots stored');
}

async function main() {
  const args    = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('Usage:');
    console.log('  node ingest-tennis.js atp  <startYear> <endYear>');
    console.log('  node ingest-tennis.js wta  <startYear> <endYear>');
    console.log('  node ingest-tennis.js both <startYear> <endYear>');
    console.log('  node ingest-tennis.js rankings atp|wta <decade>');
    process.exit(0);
  }

  if (command === 'rankings') {
    await ingestRankings(args[1], int(args[2]) || 2020);
    await pool.end();
    return;
  }

  const startYear = int(args[1]) || 2020;
  const endYear   = int(args[2]) || new Date().getFullYear();
  const tours     = command === 'both' ? ['atp', 'wta'] : [command];

  console.log('\nRANKKS Tennis Ingestion');
  console.log('Tours : ' + tours.join(', ').toUpperCase());
  console.log('Years : ' + startYear + ' to ' + endYear + '\n');

  for (const tour of tours) {
    console.log('\n-- ' + tour.toUpperCase() + ' --');
    for (let yr = startYear; yr <= endYear; yr++) {
      await ingestYear(tour, yr);
    }
  }

  console.log('\nTennis ingestion complete.\n');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(1);
});
