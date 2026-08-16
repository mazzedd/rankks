/**
 * RANKKS - Tennis Ingestion Script (TML source)
 * Source: Tennismylife / TML-Database + TML-Rankings-Database (CC BY-NC-SA 4.0,
 *         derived from Jeff Sackmann's tennis_atp before that repo went 404)
 * Repos:  github.com/Tennismylife/TML-Database        (matches, branch: master)
 *         github.com/Tennismylife/TML-Rankings-Database (rankings, branch: main)
 *
 * ATP + WTA matches (stats.tennismylife.org's live site hosts both — the
 * '-wta' commands below point at its {year}_wta.csv / wta_ongoing_tourneys.csv
 * files, same column schema as the ATP files). Rankings stay ATP-only: no WTA
 * rankings source exists in TML-Rankings-Database, and none is needed for the
 * Player List "Points" column anyway — that reads per-match embedded
 * winner_rank_points/loser_rank_points (games.stats), not this table.
 * Reuses the same schema conventions as ingest-tennis.js (Sackmann) so
 * seasons/competitions already ingested from Sackmann are matched and
 * extended, not duplicated. Players are matched to existing entities by slug
 * (TML's player ids don't correspond to Sackmann's), and the TML id is cached
 * under external_ids.tml_id afterwards so reruns skip the slug lookup.
 *
 * Usage:
 *   node ingest-tennis-tml.js matches     2024 2026
 *   node ingest-tennis-tml.js matches-wta 2024 2026
 *   node ingest-tennis-tml.js rankings    1973 2026
 *   node ingest-tennis-tml.js ongoing
 *   node ingest-tennis-tml.js ongoing-wta
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

const SPORT_ID   = 2;
// Mutable, not const — flipped to 'F' for the WTA CLI commands (see main()
// below) before any ingestion runs. Every function in this file already
// reads this module-level binding rather than taking gender as its own
// argument, so a single reassignment before the run is enough to route an
// entire pass through the WTA data files/category ids/tab names instead of
// threading a gender param through a dozen call sites.
let GENDER = 'M';

// Own category row, not tucked under Masters 1000/250 (2026-08): both are
// ATP-only, 8-player, season-ending events with draw_size=8 - previously
// getCategoryId's generic 'A'/draw-size-based fallback mapped them into
// Masters 250 (wrong tier, same draw size coincidence) and the dedicated
// 'F' branch mapped ATP Tour Finals into Masters 1000. No WTA equivalent
// exists in this source, so these are unconditional, not gender-branched.
// Tour Finals and Next Gen ATP Finals share one sidebar menu ("ATP Finals")
// with two Line A competitions under it, not two separate menus - they're
// the same category id, just distinguished by competition slug.
const ATP_FINALS_CATEGORY_ID   = 1216; // event_categories.slug = 'atp-finals'
const NEXT_GEN_CATEGORY_ID     = 1216;
// event_categories.slug = 'wta-finals' (id 1219) — created 2026-08-09,
// moving WTA Finals out of wta-1000 (13). Prior to this, tourneyLevel 'F'
// on a WTA row fell into the same isWTA?13:12 branch as the M-level tier,
// same miscategorization the sidebar/Line A fix addressed on the read
// side; this is the ingestion-side counterpart so a fresh WTA Finals
// re-ingest doesn't put it back under WTA 1000.
const WTA_FINALS_CATEGORY_ID   = 1219;

// Same category ids as ingest-tennis.js (event_categories table). WTA's
// equivalent tiers are different category rows (13/15/17, not 12/14/16) —
// Grand Slam (11) and Challenger/Futures (18) are shared/gender-neutral
// categories, so those two branches don't need a WTA variant.
function getCategoryId(tourneyName, tourneyLevel, drawSize, gender) {
  const is250 = parseInt(drawSize) <= 32;
  const isWTA = gender === 'F';
  // TML renames the finale event every year and codes it under both 'F' and
  // 'A' tourney_level across different years, so it has to be name-matched
  // first, before either level branch below (mirrors resolveSlug).
  const nameLower = (tourneyName || '').toLowerCase();
  if (nameLower.includes('next gen') || nameLower.includes('nextgen')) return NEXT_GEN_CATEGORY_ID;
  if (tourneyLevel === 'F') return isWTA ? WTA_FINALS_CATEGORY_ID : ATP_FINALS_CATEGORY_ID;
  if (tourneyLevel === 'G') return 11;
  if (tourneyLevel === 'M') return isWTA ? 13 : 12;
  // Pre-2009 WTA tier system (T1-T5) — the yearly {year}_wta.csv files (unlike
  // the ongoing/current-era ones) still use WTA's OLD 5-tier scheme, not the
  // post-2009 Premier/International naming this file's other WTA branches
  // assume. Confirmed via real tournament names in the actual 2005 file
  // (found 2026-08-09, root cause of "no WTA Line A items before 2009" —
  // T1-T5 aren't in ingestMatches' allowedLevels at all, so every single
  // non-Slam/non-Finals WTA match from 1990-2008 was being silently
  // skipped): T1 = Indian Wells/Miami/Rome/Berlin/Charleston/Zurich/Toronto/
  // Moscow/Tokyo — today's WTA 1000 tier. T2 = Beijing/Doha/Dubai/
  // Eastbourne/Antwerp/Sydney — today's WTA 500 tier. T3/T4/T5 = smaller
  // events (Auckland, Hobart, s-Hertogenbosch, Acapulco, Birmingham, etc.) —
  // all of these are CURRENT WTA 250s, confirming the old 3-way split
  // (III/IV/V) collapsed into today's single "International"/250 tier, not
  // three separate ones.
  if (isWTA && tourneyLevel === 'T1') return 13;
  if (isWTA && (tourneyLevel === 'T2')) return 15;
  if (isWTA && (tourneyLevel === 'T3' || tourneyLevel === 'T4' || tourneyLevel === 'T5')) return 17;
  if (tourneyLevel === 'D') return 18;
  if (tourneyLevel === 'C') return 18;
  if (tourneyLevel === 'A') return is250 ? (isWTA ? 17 : 16) : (isWTA ? 15 : 14);
  if (tourneyLevel === '250') return isWTA ? 17 : 16;
  if (tourneyLevel === '500') return isWTA ? 15 : 14;
  if (tourneyLevel === '1000') return isWTA ? 13 : 12; // ongoing_tourneys.csv codes Masters 1000 as '1000', not 'M'
  return isWTA ? 17 : 16;
}

// Same slug map as ingest-tennis.js, ATP entries only
const SLUG_MAP = {
  'australian open':        'australian-open',
  'roland garros':          'roland-garros',
  'wimbledon':              'wimbledon',
  'us open':                'us-open-tennis',
  'indian wells masters':   'indian-wells',
  'miami masters':          'miami-open',
  'monte carlo masters':    'monte-carlo',
  'monte carlo':            'monte-carlo', // TML drops "Masters" from the name some years - bare "Monte Carlo" fell through to slugify() and created a duplicate competition (merged 2026-08)
  'monte-carlo':            'monte-carlo',
  'madrid masters':         'madrid-open',
  'rome masters':           'atp-roma',
  'canada masters':         'canadian-open-atp',
  'canadian open':          'canadian-open-atp',
  'cincinnati masters':     'cincinnati-open',
  'shanghai masters':       'shanghai-masters',
  'paris masters':          'paris-masters',
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
  'doha':                   'doha-500',
  'santiago':               'santiago-atp',
  'marseille':              'marseille-atp',
  'estoril':                'estoril',
  'marrakech':              'marrakesh-atp',
  'houston':                'houston-atp',
  'geneva':                 'geneva-atp',
  'lyon':                   'lyon-atp',
  's-hertogenbosch':        's-hertogenbosch',
  's hertogenbosch':        's-hertogenbosch',
  'stuttgart':              'stuttgart-250',
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
  // TML naming differs from Sackmann's for these - verified against existing
  // DB rows to avoid creating duplicate competitions (see conversation notes)
  'atp finals':             'tour-finals-M',
  'hamburg masters':        'hamburg-M', // 2000-2008 TML rows named it this way; created a duplicate competition until merged 2026-08
  // Hamburg dropped from Masters 1000 to ATP 500 after 2008 - TML also drops
  // "Masters" from the name at the same point ("Hamburg Masters" pre-2009,
  // bare "Hamburg" 2009+), so the two names disambiguate the tier split
  // cleanly. Without this alias, plain slugify("Hamburg") fell back to
  // 'hamburg-M' too - same competition as the pre-2009 rows - so 2009+
  // matches kept landing in the Masters 1000 competition and the correctly-
  // tiered 'hamburg-atp' (Masters 500) row stayed empty (found + migrated
  // 21 seasons across 2026-08).
  'hamburg':                'hamburg-atp',
  'shanghai':               'shanghai-masters',
  "'s-hertogenbosch":       's-hertogenbosch',
  // Tier corrections (2026-08): these tournaments' original Sackmann-era
  // rows got permanently pinned to whatever category_id their draw size
  // implied at first ingest. Real tier has since changed (or the pin was
  // simply wrong), so - matching the existing Hamburg Masters / Hamburg
  // Open split - the old rows now stop at valid_to=2023 and these route
  // 2024+ matches to new, correctly-tiered rows instead.
  'brisbane':               'brisbane-250',
  'bucharest':              'bucharest-250',
};

// Small number of known TML/DB name mismatches for WTA tour-level events
// (full-tour backfill, 2026-08) - the tournament moves/renames year to year
// (Montreal<->Toronto for the Canada WTA1000, Rosmalen<->'s-Hertogenbosch)
// or TML spells it differently from how it was first ingested ("Prague
// Open" vs "Prague"). Checked before the DB name-lookup map below so these
// don't fall through to slugify() and create a duplicate competition.
const WTA_ALIAS_MAP = {
  'montreal':               'canada-wta',
  'toronto':                'canada-wta', // alternates host city with Montreal year to year, same competition entity (found 2026-08-09 — ongoing-wta's first real run created a duplicate "Toronto" competition before this alias existed)
  'rosmalen':               's-hertogenbosch-F',
  'prague open':            'prague-wta',
  'wta tour championships': 'wta-finals-F', // pre-2009 name for the same season finale event (found 2026-08-09 during the 1990-2008 backfill — without this it created a duplicate competition instead of matching the existing WTA Finals row)
};

// Populated once per WTA run (see loadWtaSlugMap, called from main()) from
// every existing WTA 1000/500/250 competition already in the DB - the
// original Sackmann-era full-tour ingest used two different slug
// conventions over time ('-wta' suffix, then bare name + gender='F'), so
// matching by name against what's actually in the DB is more reliable than
// guessing a suffix. Keeps the 2025/2026 backfill from creating duplicate
// competitions for tournaments we already have full history for.
let WTA_DB_SLUG_MAP = {};

function resolveSlug(tourneyName, isGS, tourneyLevel) {
  const key = tourneyName.toLowerCase().trim();
  const isWTA = GENDER === 'F';
  // Next Gen Finals / Tour Finals are ATP-only concepts - no WTA equivalent
  // slug exists, so these two checks must not fire on a WTA run (WTA Finals
  // falls through to the generic tourney_level handling in getCategoryId/
  // the fallback below instead, same as before this competition existed).
  if (!isWTA) {
    // Next Gen Finals must be checked before the 'F' branch below - TML coded
    // it tourney_level='F' in 2018 (same code the real Tour Finals uses in
    // every other year), so an 'F'-first check silently merged 2018 Next Gen
    // matches into the Tour Finals competition (found + cleaned up 2026-08).
    // Name spelling also varies by year ("Next Gen Finals", "Next Gen ATP
    // Finals", "NextGen Finals" with no space) - match with/without the space.
    if (key.includes('next gen') || key.includes('nextgen')) return 'next-gen-atp-finals-M';
    // TML renames the season finale event every year (Tour Finals / ATP Finals /
    // ATP Tour Finals) - tourney_level 'F' is otherwise unique to it regardless
    // of name text.
    if (tourneyLevel === 'F') return 'tour-finals-M';
  }
  if (isWTA && WTA_ALIAS_MAP[key]) return WTA_ALIAS_MAP[key];
  if (isWTA && WTA_DB_SLUG_MAP[key]) return WTA_DB_SLUG_MAP[key];
  // SLUG_MAP's tour-level (non-Slam) entries are ATP-only (see its own
  // comment) - some host cities run both an ATP and a WTA event under the
  // same name ("Queen's Club"), so an ungated lookup here silently merged
  // 2025/2026 WTA Queen's Club into the men's competition (found + cleaned
  // up 2026-08). Its 4 Grand Slam entries are the one exception: Slams are
  // a single gender-shared competition row (gender='X'), not a per-gender
  // split, so gating isGS rows out too broke US Open specifically (its DB
  // slug "us-open-tennis" isn't what naive slugify(name) produces, unlike
  // the other 3 Slams which happen to coincide - created a duplicate
  // competition, also found + cleaned up 2026-08). Hence isGS is let through
  // regardless of gender, only non-Slam WTA rows skip SLUG_MAP entirely.
  if ((isGS || !isWTA) && SLUG_MAP[key]) return SLUG_MAP[key];
  // Fallback suffix must be gender-aware - this used to hardcode '-M' even
  // for WTA rows falling through here, which would have silently mislabeled
  // a brand-new WTA-only tournament as men's (found 2026-08, unreached until
  // now since WTA ingestion was Grand-Slam-only, i.e. always isGS=true, up to
  // this point).
  return slugify(tourneyName) + (isGS ? '' : (isWTA ? '-F' : '-M'));
}

const ROUND_MAP = {
  R128: 'Round of 128', R64: 'Round of 64', R32: 'Round of 32',
  R16: 'Round of 16', QF: 'Quarter-Final', SF: 'Semi-Final',
  F: 'Final', BR: 'Bronze Match', RR: 'Round Robin',
};

// stats.tennismylife.org's own hosted copy, not the GitHub repo — the
// website is kept far more current (same-day updates during live events;
// the GitHub repo lagged by months when checked 2026-08).
const BASE_MATCHES  = 'https://stats.tennismylife.org/data';
const BASE_RANKINGS = 'https://raw.githubusercontent.com/Tennismylife/TML-Rankings-Database/main/TML%20Rankings';

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 404) { resolve(null); return; }
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ' for ' + url)); return; }
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
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
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

// Matches against existing entities (created by Sackmann ingestion, or a prior
// run of this script) by tml_id first, then by slug. Never touches
// external_ids.sackmann_id - only adds/reads tml_id, so the two sources coexist.
// Backfills country/hand/height onto an already-existing entity when those
// fields are currently null - never overwrites a value that's already set.
// Needed because a player can first get created bio-less via the rankings
// path below (ingestRankingYear always passes ioc=null - TML's rankings
// files don't carry nationality) and then every later match-row lookup for
// that same player used to short-circuit on the tml_id/slug match without
// ever revisiting country_id, even though match rows do carry winner_ioc/
// loser_ioc (found via Ignacio Buse - PER nationality present on all 31 of
// his 2026 match rows, but his entity had been created rankings-first on
// 2026-08-03 with country_id null; 12,880 tennis players share this gap).
async function backfillPlayerBio(entityId, countryId, sportAttrs, extraExternalIds) {
  const hasSportAttrs = sportAttrs && Object.keys(sportAttrs).length > 0;
  if (countryId == null && !hasSportAttrs && !extraExternalIds) return;
  await q(
    `UPDATE entities SET
       country_id       = COALESCE(entities.country_id, $2),
       sport_attributes = CASE WHEN $3::jsonb = '{}'::jsonb THEN entities.sport_attributes
                                ELSE entities.sport_attributes || $3::jsonb END,
       external_ids     = entities.external_ids || $4::jsonb,
       updated_at       = NOW()
     WHERE id = $1`,
    [entityId, countryId, JSON.stringify(sportAttrs || {}), JSON.stringify(extraExternalIds || {})]
  );
}

async function upsertPlayerTML(name, ioc, hand, ht, tmlId) {
  if (!name || name === '\\N') return null;
  const playerSlug = slugify(name);

  let countryId = null;
  if (ioc && ioc !== '\\N') {
    const c = await q(`SELECT id FROM countries WHERE iso3 = $1`, [ioc]);
    if (c.rows[0]) countryId = c.rows[0].id;
  }
  const sport_attributes = {};
  if (hand && hand !== '\\N') sport_attributes.hand = hand;
  if (ht && ht !== '\\N') sport_attributes.height_cm = int(ht);

  // Scoped by gender/entity_type for the same reason the Sackmann loader's
  // sackmann_id lookup needed it (see ingest-tennis.js's upsertPlayer) — TML
  // is run once per gender with its own id space, and an unscoped lookup
  // here would risk the identical cross-gender merge bug (found 2026-08 via
  // the sackmann_id version of this same pattern: Chris Evert's WTA matches
  // silently attached to an unrelated modern ATP player's entity).
  if (tmlId) {
    const r = await q(
      `SELECT id FROM entities WHERE external_ids->>'tml_id' = $1 AND gender = $2 AND entity_type = 'player'`,
      [String(tmlId), GENDER]
    );
    if (r.rows[0]) {
      await backfillPlayerBio(r.rows[0].id, countryId, sport_attributes, null);
      return r.rows[0].id;
    }
  }

  const bySlug = await q(
    `SELECT id FROM entities WHERE slug = $1 AND gender = $2 AND entity_type = 'player'`,
    [playerSlug, GENDER]
  );
  if (bySlug.rows[0]) {
    await backfillPlayerBio(bySlug.rows[0].id, countryId, sport_attributes, tmlId ? { tml_id: tmlId } : null);
    return bySlug.rows[0].id;
  }

  const res = await q(
    `INSERT INTO entities
       (entity_type, canonical_name, slug, country_id, gender, sport_attributes,
        external_ids, is_active, is_verified, created_at, updated_at)
     VALUES ('player', $1, $2, $3, $4, $5, $6, true, false, NOW(), NOW())
     ON CONFLICT (slug) DO UPDATE SET
       country_id       = COALESCE(EXCLUDED.country_id, entities.country_id),
       external_ids     = entities.external_ids || EXCLUDED.external_ids,
       updated_at       = NOW()
     RETURNING id`,
    [name, playerSlug, countryId, GENDER,
     JSON.stringify(sport_attributes),
     JSON.stringify({ tml_id: tmlId })]
  );
  return res.rows[0].id;
}

// Fills WTA_DB_SLUG_MAP from every existing WTA 1000/500/250 competition
// (category ids 13/15/17) - call once before a WTA matches run, so
// resolveSlug can match an incoming TML tourney_name against what's already
// in the DB instead of guessing a slug and creating a duplicate.
async function loadWtaSlugMap() {
  const rows = await q(`SELECT name, slug FROM competitions WHERE category_id IN (13, 15, 17)`);
  for (const r of rows.rows) {
    WTA_DB_SLUG_MAP[r.name.toLowerCase().trim()] = r.slug;
  }
  console.log('  Loaded ' + rows.rows.length + ' existing WTA competition names for slug matching.');
}

async function upsertCompetition(tourneyName, surface, isGS, categoryId, compSlug) {
  const existing = await q(`SELECT id FROM competitions WHERE slug = $1`, [compSlug]);
  if (existing.rows[0]) return existing.rows[0].id;

  const res = await q(
    `INSERT INTO competitions
       (category_id, name, slug, surface, competition_type, gender, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'seasonal', $5, true, NOW(), NOW())
     RETURNING id`,
    [categoryId, tourneyName, compSlug, surface || null, isGS ? 'X' : GENDER]
  );
  return res.rows[0].id;
}

async function upsertSeason(competitionId, year, startDate) {
  // Some seasons (e.g. Masters Finals 1990-1999, 2009-2023 - found + backfilled
  // 2026-08) predate the Player List tab convention below and were never
  // revisited, so it's called unconditionally on every re-run (existing or
  // new season) rather than only at INSERT - upsertResultTab already no-ops
  // if the tab row exists, so this is a safe, self-healing check every time.
  const playersTabKey  = GENDER === 'F' ? 'players-f' : 'players-m';
  const playersTabName = GENDER === 'F' ? "Women's Player List" : "Men's Player List";

  const existing = await q(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND gender = $3`,
    [competitionId, year, GENDER]
  );
  if (existing.rows[0]) {
    await upsertResultTab(existing.rows[0].id, playersTabName, playersTabKey, 'players', 90);
    // Keep the date range accurate as more matches get ingested — this
    // used to just return early and never touch start_date/end_date again,
    // which left both frozen at whichever single match's date happened to
    // be first-processed on the season's very first insert. For an
    // in-progress tournament (the ongoing-fixtures pipeline re-runs this
    // daily via the scheduler) that meant end_date stuck days behind
    // reality, which fed straight into EventBlock's getStatus() showing
    // "Past" mid-tournament (confirmed bug: Canadian Open 2026, Aug 2-13,
    // reading "Past" on Aug 7 because end_date never advanced past the
    // first day's matches). LEAST/GREATEST widen the range monotonically —
    // never shrinks it, safe to call on every row of every re-run.
    if (startDate) {
      await q(
        `UPDATE seasons SET
           start_date = LEAST(start_date, $2),
           end_date   = GREATEST(end_date, $2),
           updated_at = NOW()
         WHERE id = $1`,
        [existing.rows[0].id, startDate]
      );
    }
    return existing.rows[0].id;
  }

  const res = await q(
    `INSERT INTO seasons
       (competition_id, year, status, gender, start_date, end_date, created_at, updated_at)
     VALUES ($1, $2, 'past', $3, $4, $4, NOW(), NOW())
     RETURNING id`,
    [competitionId, year, GENDER, startDate]
  );
  const seasonId = res.rows[0].id;
  // Mirrors the established 3-tab scheme from the Sackmann-era seasons
  // (see e.g. Australian Open 2023, season_id 98): Singles draw + Player
  // List + Iconic Moments. Player List has no match data of its own -
  // it's populated live by /results/tennis-players - but the tab row
  // must still exist for the frontend nav to show it.
  await upsertResultTab(seasonId, playersTabName, playersTabKey, 'players', 90);
  await upsertResultTab(seasonId, 'Iconic Moments', 'videos', 'iconic_moments', 99);
  return seasonId;
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
        is_walkover, is_retirement, duration_minutes, stats, leg_number, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'player','player',$8,$9,$10,$11,true,$12,$13,$14,$15,1,NOW(),NOW())
     ON CONFLICT (result_tab_id, round, home_entity_id, away_entity_id, leg_number) DO NOTHING`,
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

// wta_ongoing_tourneys.csv ships with NO header row (confirmed live 2026-08-09
// — first line is real match data, unlike ongoing_tourneys.csv/the per-year
// {year}_wta.csv files, which both do have one) despite the file header
// comment's "same column schema as the ATP files" claim being otherwise
// accurate field-for-field. Without this, parseRows() treats row 1's DATA as
// column names, so every row.tourney_level lookup on every subsequent row
// comes back undefined and silently fails the allowedLevels check at the top
// of the loop below (found: 83 matches found, 0 processed, 83 skipped, no
// errors logged since that's not a thrown-error path). Passed in only for
// ingestOngoingWTA below — every other caller's source file already has its
// own real header line.
const TML_MATCH_HEADER = 'tourney_id,tourney_name,surface,draw_size,tourney_level,indoor,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,winner_rank,winner_rank_points,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,loser_rank,loser_rank_points,score,best_of,round,minutes,w_ace,w_df,w_svpt,w_1stIn,w_1stWon,w_2ndWon,w_SvGms,w_bpSaved,w_bpFaced,l_ace,l_df,l_svpt,l_1stIn,l_1stWon,l_2ndWon,l_SvGms,l_bpSaved,l_bpFaced';

async function ingestMatches(url, label, fallbackYear, slamOnly = false, headerOverride = null) {
  console.log('  Fetching ATP ' + label + ' (TML)...');
  const lines = await fetchCSV(url);
  if (!lines) { console.log('     No file for ' + label); return; }
  if (headerOverride) lines.unshift(headerOverride);

  const rows = parseRows(lines);
  console.log('     ' + rows.length + ' matches found');

  const competitionCache = {};
  const seasonCache      = {};
  const resultTabCache   = {};
  const playerCache      = {};
  let created = 0, skipped = 0, newTourneys = [];

  for (const row of rows) {
    try {
      // T1-T5 (pre-2009 WTA tier codes) added alongside the modern codes —
      // see getCategoryId's own comment for why these exist and how they map.
      // 'D' (Fed Cup in the WTA files) deliberately stays excluded — team
      // events are out of scope for now per explicit instruction.
      const allowedLevels = slamOnly ? ['G'] : ['G','M','A','F','250','500','1000','T1','T2','T3','T4','T5'];
      if (!allowedLevels.includes(row.tourney_level)) { skipped++; continue; }

      const year4      = int(row.tourney_date && row.tourney_date.slice(0,4)) || fallbackYear;
      const startDate  = parseDate(row.tourney_date);
      const isGS       = row.tourney_level === 'G';
      const categoryId = getCategoryId(row.tourney_name, row.tourney_level, row.draw_size, GENDER);
      const compSlug   = resolveSlug(row.tourney_name, isGS, row.tourney_level);

      if (!competitionCache[compSlug]) {
        competitionCache[compSlug] = await upsertCompetition(
          row.tourney_name, row.surface, isGS, categoryId, compSlug
        );
        const key = row.tourney_name.toLowerCase().trim();
        if (!SLUG_MAP[key]) newTourneys.push(row.tourney_name + ' -> ' + compSlug);
      }
      const competitionId = competitionCache[compSlug];

      const seasonKey = competitionId + '-' + year4;
      if (!seasonCache[seasonKey]) {
        seasonCache[seasonKey] = await upsertSeason(competitionId, year4, startDate);
      }
      const seasonId = seasonCache[seasonKey];

      const tabKey  = GENDER === 'F' ? 'draw-singles-f' : 'draw-singles-m';
      const tabName = GENDER === 'F' ? "Women's Singles" : "Men's Singles";
      const rtKey  = seasonId + '-' + tabKey;
      if (!resultTabCache[rtKey]) {
        resultTabCache[rtKey] = await upsertResultTab(seasonId, tabName, tabKey, 'game', 1);
      }
      const resultTabId = resultTabCache[rtKey];

      const wKey = row.winner_id || slugify(row.winner_name);
      const lKey = row.loser_id  || slugify(row.loser_name);

      if (!playerCache[wKey]) {
        playerCache[wKey] = await upsertPlayerTML(
          row.winner_name, row.winner_ioc, row.winner_hand, row.winner_ht, row.winner_id
        );
      }
      if (!playerCache[lKey]) {
        playerCache[lKey] = await upsertPlayerTML(
          row.loser_name, row.loser_ioc, row.loser_hand, row.loser_ht, row.loser_id
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

  console.log('     Done: ' + created + ' processed, ' + skipped + ' skipped');
  if (newTourneys.length > 0) {
    console.log('     New tournaments created (not in SLUG_MAP):');
    [...new Set(newTourneys)].forEach(t => console.log('       - ' + t));
  }
}

function ingestMatchYear(year) {
  return ingestMatches(BASE_MATCHES + '/' + year + '.csv', String(year), year);
}

// WTA equivalent — same site, same CSV schema, just the '_wta' filename
// suffix (confirmed via /api/data-files: {year}_wta.csv, 1990-2026, plus
// wta_ongoing_tourneys.csv for the live feed below). Caller must set
// GENDER = 'F' first (see main()) so category ids/tab names/season gender
// all route to the WTA side instead of silently mislabeling women's data
// as men's.
//
// Full tour by default since 2026-08 (was slamOnly=true) — the fallback-slug
// gender bug and the missing WTA 1000/500/250 name mapping that justified
// restricting this to Grand Slams are both fixed now (see WTA_ALIAS_MAP /
// WTA_DB_SLUG_MAP / resolveSlug above), so a full-tour pull correctly
// reuses the ~118 WTA competitions already in the DB from the original
// Sackmann-era backfill instead of creating duplicates.
function ingestMatchYearWTA(year, slamOnly = false) {
  return ingestMatches(BASE_MATCHES + '/' + year + '_wta.csv', String(year) + ' WTA', year, slamOnly);
}

// The live/ongoing feed - whatever ATP tournaments are in progress right
// now, updated same-day by the site. Not scoped to one year or one
// competition; each row's own tourney_date decides its season, same as
// ingestMatchYear. This is what the Providers "live feed" coverage row
// (competition_id = null, no year passed by the scheduler) calls.
function ingestOngoing() {
  return ingestMatches(BASE_MATCHES + '/ongoing_tourneys.csv', 'ongoing tournaments', new Date().getFullYear());
}

function ingestOngoingWTA() {
  return ingestMatches(BASE_MATCHES + '/wta_ongoing_tourneys.csv', 'ongoing WTA tournaments', new Date().getFullYear(), false, TML_MATCH_HEADER);
}

async function ingestRankingYear(year) {
  const url = BASE_RANKINGS + '/' + year + '.csv';

  console.log('  Fetching ATP rankings ' + year + ' (TML)...');
  const lines = await fetchCSV(url);
  if (!lines) { console.log('     No rankings file for ' + year); return; }

  const rows = parseRows(lines);
  console.log('     ' + rows.length + ' ranking rows');

  const playerCache = {};
  let done = 0, skipped = 0;

  for (const row of rows) {
    try {
      if (!row.name || !row.rank) { skipped++; continue; }

      const pKey = row.id || slugify(row.name);
      if (!(pKey in playerCache)) {
        playerCache[pKey] = await upsertPlayerTML(row.name, null, null, null, row.id);
      }
      const entityId = playerCache[pKey];
      if (!entityId) { skipped++; continue; }

      const rankDate = parseDate(row.date);
      if (!rankDate) { skipped++; continue; }

      await q(
        `INSERT INTO player_attributes
           (entity_id, sport_id, attribute_key, attribute_value, start_year, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (entity_id, sport_id, attribute_key) DO NOTHING`,
        [entityId, SPORT_ID, 'rank_' + rankDate,
         JSON.stringify({ rank: int(row.rank), pts: int(row.points) }),
         int(row.date && row.date.slice(0,4))]
      );
      done++;
    } catch (err) {
      console.error('     Row error:', err.message, row.name);
      skipped++;
    }
  }
  console.log('     Done: ' + done + ' ranking snapshots stored, ' + skipped + ' skipped');
}

async function main() {
  const args    = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log('Usage:');
    console.log('  node ingest-tennis-tml.js matches      <startYear> <endYear>');
    console.log('  node ingest-tennis-tml.js matches-wta  <startYear> <endYear>');
    console.log('  node ingest-tennis-tml.js rankings     <startYear> <endYear>   (ATP only - no WTA rankings source exists)');
    console.log('  node ingest-tennis-tml.js ongoing');
    console.log('  node ingest-tennis-tml.js ongoing-wta');
    console.log('  node ingest-tennis-tml.js fixtures     (alias for "ongoing" - the Providers scheduler calls it by data_type name)');
    process.exit(0);
  }

  if (command.endsWith('-wta')) {
    GENDER = 'F';
    await loadWtaSlugMap();
  }

  console.log('\nRANKKS Tennis Ingestion (TML source' + (GENDER === 'F' ? ', WTA' : ', ATP') + ')');
  console.log('Command: ' + command + '\n');

  if (command === 'ongoing' || command === 'fixtures') {
    await ingestOngoing();
  } else if (command === 'ongoing-wta') {
    await ingestOngoingWTA();
  } else {
    const startYear = int(args[1]) || 2024;
    const endYear   = int(args[2]) || new Date().getFullYear();
    console.log('Years  : ' + startYear + ' to ' + endYear + '\n');
    for (let yr = startYear; yr <= endYear; yr++) {
      if (command === 'matches')     await ingestMatchYear(yr);
      if (command === 'matches-wta') await ingestMatchYearWTA(yr);
      if (command === 'rankings')    await ingestRankingYear(yr);
    }
  }

  console.log('\nTML tennis ingestion complete.\n');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  pool.end();
  process.exit(1);
});
