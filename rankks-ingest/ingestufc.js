/**
 * RANKKS - UFC Ingestion Script
 *
 * Source: Greco1899/scrape_ufc_stats on GitHub (github.com/Greco1899/scrape_ufc_stats)
 * — NOT ufcstats.com directly. ufcstats.com now serves a client-side
 * proof-of-work bot-challenge page to any non-browser request (verified
 * 2026-08-16: a plain fetch/curl gets a "Checking your browser…" JS
 * challenge, not HTML), so the original cheerio-on-ufcstats.com design
 * this file used to have could never work from a server. This repo scrapes
 * ufcstats.com itself (same underlying data) and commits the result as
 * plain CSV files, refreshed daily via an automated job — so we read
 * those CSVs straight off raw.githubusercontent.com instead. Verified
 * 2026-08-16: 785 events / 8860 fights / 4588 fighters, pushed same day.
 *
 * Schema reuse (unchanged from the original design):
 *   - One `competitions` row: "UFC" (creates its own sport/event_category
 *     if they don't exist yet).
 *   - One `seasons` row per year — feeds the Year Selector.
 *   - One `result_tabs` row per season (tab_key='results', typology='game').
 *   - One `games` row per fight. `games.round` holds the CARD name
 *     ("UFC 320", "UFC Fight Night: Sorensen vs Duarte"). Finish round/time
 *     live in `stats.finish_round` / `stats.finish_time`.
 *   - Everything UFC-specific (weight class, title fight, headliner,
 *     numbered-vs-fight-night, status) lives in `games.stats` — no new
 *     tables.
 *
 * Usage:
 *   node ingestufc.js history <startYear> <endYear> [--dry-run]
 *   node ingestufc.js upcoming [--dry-run]
 *   node ingestufc.js live [--dry-run]
 *
 * `upcoming` / `live` caveat (2026-08-16): the source repo only ever
 * commits DECIDED fights (verified: 0 of 8860 rows have an empty OUTCOME)
 * — ufcstats.com's own "upcoming events" listing isn't part of what it
 * scrapes. So there is currently nothing for `upcoming` to seed; it's
 * still implemented (checks for any event present in ufc_event_details.csv
 * with zero matching rows in ufc_fight_results.csv and seeds those as
 * `status:'scheduled'`) so it starts working the moment such a row shows
 * up, but expect it to log "nothing to seed" today. `live` no longer takes
 * an event URL — there's no true per-event live feed here, just a
 * daily-refreshed snapshot — so it re-runs `history` for the current year
 * only, which is idempotent and picks up anything newly posted.
 */

require('dotenv').config({ path: '../rankks-api/.env' });
const { Pool } = require('pg');
const { parse: parseCSV } = require('csv-parse/sync');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'rankks',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'rankks123',
});
const q = (text, params) => pool.query(text, params);

const CSV_BASE = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main';
const CSV_URLS = {
  events:   `${CSV_BASE}/ufc_event_details.csv`,
  fights:   `${CSV_BASE}/ufc_fight_results.csv`,
  tott:     `${CSV_BASE}/ufc_fighter_tott.csv`,     // "tale of the tape" — bio
  fighters: `${CSV_BASE}/ufc_fighter_details.csv`,  // first/last/nickname
};

const DRY_RUN = process.argv.includes('--dry-run');

// ── HTTP helper (bulk CSV fetch from GitHub raw, not ufcstats.com) ──────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchText(url, attempt = 1) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (attempt >= 4) throw new Error(`Failed to fetch ${url}: ${err.message}`);
    const backoff = 1000 * 2 ** (attempt - 1);
    console.warn(`  ! ${url} → ${err.message}, retrying in ${backoff}ms`);
    await sleep(backoff);
    return fetchText(url, attempt + 1);
  }
}

async function fetchCSV(url) {
  const text = await fetchText(url);
  return parseCSV(text, { columns: true, skip_empty_lines: true, trim: true });
}

// ── Parsing helpers ──────────────────────────────────────────────────────────
function slugify(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function int(v) { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; }

const MONTHS = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
};

// "August 15, 2026" -> "2026-08-15"
function parseLongDate(str) {
  if (!str) return null;
  const m = str.trim().match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(int(m[2])).padStart(2, '0')}`;
}

// "Jul 13, 1978" -> "1978-07-13"
function parseShortDate(str) {
  if (!str || str === '--') return null;
  const m = str.trim().match(/([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const key = Object.keys(MONTHS).find(k => k.startsWith(m[1].toLowerCase().slice(0, 3)));
  if (!key) return null;
  return `${m[3]}-${String(MONTHS[key]).padStart(2, '0')}-${String(int(m[2])).padStart(2, '0')}`;
}

// "6' 0\"" -> 182 (cm); "--" -> null
function heightToCm(str) {
  if (!str) return null;
  const m = str.match(/(\d+)'\s*(\d+)/);
  if (!m) return null;
  const totalIn = int(m[1]) * 12 + int(m[2]);
  return Math.round(totalIn * 2.54);
}

// "155 lbs." -> 70.3 (kg); "--" -> null
function weightToKg(str) {
  if (!str) return null;
  const m = str.match(/(\d+)/);
  if (!m) return null;
  return Math.round(int(m[1]) * 0.45359237 * 10) / 10;
}

// '75"' -> 190 (cm); "--" -> null
function reachToCm(str) {
  if (!str) return null;
  const m = str.match(/(\d+)/);
  if (!m) return null;
  return Math.round(int(m[1]) * 2.54);
}

// Order matters — more specific labels ("Light Heavyweight", "Super
// Heavyweight", "Women's X") must be checked before their bare substring
// ("Heavyweight") or the wrong one wins on .includes().
const WEIGHT_CLASSES = [
  "Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight",
  'Flyweight', 'Bantamweight', 'Featherweight', 'Lightweight', 'Welterweight', 'Middleweight',
  'Light Heavyweight', 'Super Heavyweight', 'Heavyweight', 'Catch Weight', 'Open Weight',
];

// WEIGHTCLASS text is messy free text from ufcstats — spans real weight
// classes ("UFC Welterweight Title Bout") down to pre-weight-class tourney
// eras ("UFC 2 Tournament Title Bout", no weight class exists at all).
// Falls back to the raw cleaned text when no known class matches, same
// as the original design.
function extractWeightClass(text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  for (const wc of WEIGHT_CLASSES) {
    if (clean.includes(wc)) return wc;
  }
  return clean || null;
}

function isTitleFight(text) {
  return /title/i.test(text || '');
}

function genderFromWeightClass(wc) {
  if (!wc) return null;
  if (wc.startsWith("Women's")) return 'F';
  // "Catch Weight" bouts are fought by both genders (a fighter's earliest
  // UFC fights are sometimes catchweight, before/around when their real
  // division existed under that name) — not real evidence either way.
  // Returning null here (instead of defaulting to 'M') matters because
  // upsertFighter's `gender = COALESCE(gender, $N)` only ever sets gender
  // ONCE, on whichever fight is processed first for that fighter: a
  // catchweight bout processed before a real "Women's X" bout used to lock
  // gender to 'M' permanently. Confirmed 2026-08-17 via direct query: 9
  // real fighters (Cristiane Justino, Alexis Dufresne, Sarah Moras, Lina
  // Lansberg, Regina Tarin, Wang Cong, Ernesta Kareckaite, Eduarda Moura,
  // Sarah Moras) stuck at gender='M' despite every one of them having a
  // "Women's ..." fight elsewhere in their record — repaired via one-off
  // UPDATE, this fix prevents it recurring for anyone re-ingested later.
  if (wc === 'Catch Weight') return null;
  return 'M';
}

function eventKind(name) {
  return /^UFC\s*\d+\b/i.test(name || '') ? 'numbered' : 'fight_night';
}

// ── CSV loading & lookups ────────────────────────────────────────────────────
async function loadAllData() {
  console.log('Fetching source CSVs from GitHub (Greco1899/scrape_ufc_stats)...');
  const [eventsRows, fightRows, tottRows, fighterRows] = await Promise.all([
    fetchCSV(CSV_URLS.events),
    fetchCSV(CSV_URLS.fights),
    fetchCSV(CSV_URLS.tott),
    fetchCSV(CSV_URLS.fighters),
  ]);
  console.log(`  events: ${eventsRows.length}, fights: ${fightRows.length}, fighter bios: ${tottRows.length}, fighter names: ${fighterRows.length}`);

  const eventsByName = new Map();
  for (const row of eventsRows) {
    eventsByName.set(row.EVENT.trim(), {
      date: parseLongDate(row.DATE),
      location: row.LOCATION || null,
      url: row.URL || null,
    });
  }

  // Preserves file order within each event — needed for the headliner
  // fallback (first row encountered) when the event name has no usable
  // "A vs B" suffix to match fighters against.
  const fightRowsByEvent = new Map();
  for (const row of fightRows) {
    const name = row.EVENT.trim();
    if (!fightRowsByEvent.has(name)) fightRowsByEvent.set(name, []);
    fightRowsByEvent.get(name).push(row);
  }

  const bioByName = new Map();
  for (const row of tottRows) {
    bioByName.set(row.FIGHTER.trim(), {
      height_cm: heightToCm(row.HEIGHT),
      height_display: row.HEIGHT && row.HEIGHT !== '--' ? row.HEIGHT : null,
      weight_kg: weightToKg(row.WEIGHT),
      reach_cm: reachToCm(row.REACH),
      stance: row.STANCE && row.STANCE !== '--' ? row.STANCE : null,
      born: parseShortDate(row.DOB),
      url: row.URL || null,
    });
  }

  const nickByName = new Map();
  for (const row of fighterRows) {
    const name = `${row.FIRST} ${row.LAST}`.trim();
    nickByName.set(name, { nickname: row.NICKNAME || null, url: row.URL || null });
  }

  return { eventsByName, fightRowsByEvent, bioByName, nickByName };
}

// "Islam Makhachev vs. Ian Machado Garry" -> ["Islam Makhachev", "Ian Machado Garry"]
function splitBout(bout) {
  const parts = (bout || '').split(/\s+vs\.?\s+/i);
  if (parts.length !== 2) return null;
  return [parts[0].trim(), parts[1].trim()];
}

// Loose "does this fighter's name plausibly match this event-name half"
// check — event names abbreviate ("Nunes vs Shevchenko 2" vs the fight's
// actual "Amanda Nunes vs. Valentina Shevchenko"), so exact equality would
// almost never hit. Strips a trailing rematch number, then checks
// substring containment either way, or a last-name match.
function isNameMatch(half, fullName) {
  const h = (half || '').toLowerCase().replace(/\s+\d+$/, '').trim();
  const f = (fullName || '').toLowerCase();
  if (!h || !f) return false;
  if (f.includes(h) || h.includes(f)) return true;
  const lastName = f.split(' ').pop();
  return lastName.length > 2 && h.includes(lastName);
}

// Marks exactly one fight per event as the headliner. Primary signal:
// event names very often name the headliner fight directly ("UFC 330:
// Makhachev vs. Machado Garry" — verified 2026-08-16 across the dataset,
// ~68% of events carry this suffix). Falls back to "first row on record
// for this event" (verified: for events where it DOESN'T carry a name
// suffix — old numbered UFCs with taglines like "UFC 100" or TUF Finales —
// file order is not reliably main-event-first across the whole dataset's
// history, so this is a best-effort default, not a guarantee, for those
// older cards only).
function markHeadliner(eventName, rows, splitBouts) {
  const afterColon = eventName.includes(':') ? eventName.slice(eventName.lastIndexOf(':') + 1) : eventName;
  const halves = splitBout(afterColon);

  if (halves) {
    const [h1, h2] = halves;
    for (let i = 0; i < rows.length; i++) {
      const [a, b] = splitBouts[i];
      if ((isNameMatch(h1, a) && isNameMatch(h2, b)) || (isNameMatch(h1, b) && isNameMatch(h2, a))) {
        return i;
      }
    }
  }
  return 0; // fallback: first row on record for this event
}

// ── DB: sport / category / competition scaffolding ──────────────────────────
async function upsertSport(slug, name) {
  const existing = await q(`SELECT id FROM sports WHERE slug = $1`, [slug]);
  if (existing.rows[0]) return existing.rows[0].id;
  const res = await q(
    `INSERT INTO sports (name, slug, is_active) VALUES ($1, $2, true) RETURNING id`,
    [name, slug]
  );
  console.log(`  ✦ Created sport: ${name}`);
  return res.rows[0].id;
}

async function upsertEventCategory(sportId, name, slug) {
  const existing = await q(`SELECT id FROM event_categories WHERE slug = $1`, [slug]);
  if (existing.rows[0]) return existing.rows[0].id;
  const res = await q(
    `INSERT INTO event_categories (sport_id, canonical_name, short_name, slug)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [sportId, name, name, slug]
  );
  console.log(`  ✦ Created event category: ${name}`);
  return res.rows[0].id;
}

async function upsertCompetition(categoryId, name, slug) {
  const existing = await q(`SELECT id FROM competitions WHERE slug = $1`, [slug]);
  if (existing.rows[0]) return existing.rows[0].id;
  const res = await q(
    `INSERT INTO competitions
       (category_id, name, slug, gender, competition_type, organiser, website, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, 'X', 'bout', 'UFC', 'https://www.ufc.com', true, NOW(), NOW())
     RETURNING id`,
    [categoryId, name, slug]
  );
  console.log(`  ✦ Created competition: ${name}`);
  return res.rows[0].id;
}

let ufcCompetitionIdCache = null;
async function getUfcCompetitionId() {
  if (ufcCompetitionIdCache) return ufcCompetitionIdCache;
  const sportId = await upsertSport('mma', 'Combat Sport');
  const categoryId = await upsertEventCategory(sportId, 'UFC', 'ufc');
  ufcCompetitionIdCache = await upsertCompetition(categoryId, 'UFC', 'ufc');
  return ufcCompetitionIdCache;
}

async function upsertSeason(competitionId, year) {
  const existing = await q(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND gender = 'X'`,
    [competitionId, year]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const currentYear = new Date().getFullYear();
  const status = year < currentYear ? 'past' : year === currentYear ? 'current' : 'future';

  const res = await q(
    `INSERT INTO seasons (competition_id, year, status, gender, created_at, updated_at)
     VALUES ($1, $2, $3, 'X', NOW(), NOW()) RETURNING id`,
    [competitionId, year, status]
  );
  return res.rows[0].id;
}

async function upsertResultTab(seasonId) {
  const existing = await q(
    `SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = 'results'`,
    [seasonId]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const res = await q(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default, created_at)
     VALUES ($1, 'Results', 'results', 'game', 0, true, NOW()) RETURNING id`,
    [seasonId]
  );
  return res.rows[0].id;
}

// ── DB: fighters ─────────────────────────────────────────────────────────────
const fighterCache = new Map();

// `entities.slug` is UNIQUE across every entity_type, not scoped per sport —
// so a fighter whose name happens to match an existing football player's
// slug exactly (real examples found 2026-08-17: Paulo Costa, Alexander
// Volkov, Stephen Thompson, Thiago Silva, and 7 others) used to hit
// `ON CONFLICT (slug) DO UPDATE SET updated_at = NOW()` on creation, which
// silently returned the WRONG entity (the football player's id) instead of
// creating a real fighter — every one of that "fighter"'s subsequent fights
// then got attributed to a football player. Confirmed via a live query:
// 217 real UFC games and 2 rankings rows were pointing at football-player
// entities before this fix + a one-off repair migration. Now: if the base
// slug is taken by anything other than a fighter, a disambiguated slug is
// used instead of ever touching the other entity's row.
async function resolveNewFighterSlug(baseSlug) {
  const existing = await q(`SELECT id FROM entities WHERE slug = $1`, [baseSlug]);
  if (!existing.rows[0]) return baseSlug;
  let n = 2;
  while (true) {
    const candidate = n === 2 ? `${baseSlug}-mma` : `${baseSlug}-mma-${n}`;
    const check = await q(`SELECT id FROM entities WHERE slug = $1`, [candidate]);
    if (!check.rows[0]) return candidate;
    n++;
  }
}

async function upsertFighter(fighter, bio, gender) {
  const key = fighter.url || fighter.name;
  if (fighterCache.has(key)) return fighterCache.get(key);

  const externalId = fighter.url ? fighter.url.split('/').filter(Boolean).pop() : null;
  const fighterSlug = slugify(fighter.name);

  if (externalId) {
    const byExternal = await q(
      `SELECT id FROM entities WHERE external_ids->>'ufcstats_id' = $1`, [externalId]
    );
    if (byExternal.rows[0]) {
      const id = byExternal.rows[0].id;
      if (bio) await applyFighterBio(id, bio);
      if (gender) await q(`UPDATE entities SET gender = COALESCE(gender, $2) WHERE id = $1`, [id, gender]);
      fighterCache.set(key, id);
      return id;
    }
  }

  const bySlug = await q(
    `SELECT id FROM entities WHERE slug = $1 AND entity_type = 'fighter'`, [fighterSlug]
  );
  let entityId;
  if (bySlug.rows[0]) {
    entityId = bySlug.rows[0].id;
    await q(
      `UPDATE entities SET external_ids = external_ids || $2, gender = COALESCE(gender, $3) WHERE id = $1`,
      [entityId, JSON.stringify({ ufcstats_id: externalId }), gender || null]
    );
  } else {
    const sportAttrs = bio ? bioToSportAttributes(bio) : {};
    const insertSlug = await resolveNewFighterSlug(fighterSlug);
    const res = await q(
      `INSERT INTO entities
         (entity_type, canonical_name, slug, gender, sport_attributes, external_ids, is_active, is_verified, created_at, updated_at)
       VALUES ('fighter', $1, $2, $3, $4, $5, true, false, NOW(), NOW())
       RETURNING id`,
      [fighter.name, insertSlug, gender || null, JSON.stringify(sportAttrs), JSON.stringify({ ufcstats_id: externalId })]
    );
    entityId = res.rows[0].id;
    console.log(`    ✦ Created fighter: ${fighter.name}${insertSlug !== fighterSlug ? ` (slug: ${insertSlug}, "${fighterSlug}" already taken by a non-fighter entity)` : ''}`);
  }

  if (bio) await applyFighterBio(entityId, bio);
  fighterCache.set(key, entityId);
  return entityId;
}

function bioToSportAttributes(bio) {
  const attrs = {};
  if (bio.height_cm != null) attrs.height_cm = bio.height_cm;
  if (bio.height_display) attrs.height_display = bio.height_display;
  if (bio.weight_kg != null) attrs.weight_kg = bio.weight_kg;
  if (bio.reach_cm != null) attrs.reach_cm = bio.reach_cm;
  if (bio.stance) attrs.stance = bio.stance;
  if (bio.nickname) attrs.nickname = bio.nickname;
  if (bio.born) attrs.born = bio.born; // guaranteed home for DOB — see applyFighterBio for the optional dedicated column
  return attrs;
}

async function applyFighterBio(entityId, bio) {
  const attrs = bioToSportAttributes(bio);
  await q(
    `UPDATE entities
     SET sport_attributes = sport_attributes || $2,
         updated_at = NOW()
     WHERE id = $1`,
    [entityId, JSON.stringify(attrs)]
  );
  if (bio.born) {
    // Best-effort: also populate a dedicated birth_date column if this
    // schema has one. bio.born is already durably stored in
    // sport_attributes above regardless of whether this succeeds.
    await q(
      `UPDATE entities SET birth_date = COALESCE(birth_date, $2), updated_at = NOW() WHERE id = $1`,
      [entityId, bio.born]
    ).catch(() => { /* no birth_date column on this schema — fine, it's in sport_attributes.born */ });
  }
}

// ── DB: games (fights) ───────────────────────────────────────────────────────
// `fight.status` defaults to 'final' since this file's own CSV source
// only ever carries decided fights (see module header) — ingest-ufc-
// upcoming.js (a different source, ufc-fr.com's future-event fight
// cards) passes 'scheduled' explicitly for fights with no winner yet.
// `homeWon` is computed by the CALLER now (not inferred here from
// fight.winner === 'a') — inferring it as a bare boolean made an
// undecided fight's home_won come out `false` instead of `null` (reads
// as "away won" for a fight nobody has fought yet), which never showed
// up while every fight this file ingested was already decided.
async function upsertFight(resultTabId, cardName, cardDate, cardMeta, fight, homeId, awayId) {
  const winnerId = fight.winner === 'a' ? homeId : fight.winner === 'b' ? awayId : null;
  const homeWon = fight.winner === 'a' ? true : fight.winner === 'b' ? false : null;
  const stats = {
    weight_class: fight.weightClass,
    is_title_fight: fight.title,
    title_name: fight.titleName,
    is_headliner: fight.headliner,
    event_kind: cardMeta.eventKind,
    venue: cardMeta.venue,
    method: fight.method,
    finish_round: fight.finishRound,
    finish_time: fight.finishTime,
    status: fight.status || 'final',
  };

  const existing = await q(
    `SELECT id FROM games
     WHERE result_tab_id = $1 AND round = $2
       AND ((home_entity_id = $3 AND away_entity_id = $4)
         OR (home_entity_id = $4 AND away_entity_id = $3))`,
    [resultTabId, cardName, homeId, awayId]
  );

  if (existing.rows[0]) {
    await q(
      `UPDATE games SET
         winner_entity_id = $2,
         home_won = $3,
         stats = $4,
         updated_at = NOW()
       WHERE id = $1`,
      [existing.rows[0].id, winnerId, homeWon, JSON.stringify(stats)]
    );
    return existing.rows[0].id;
  }

  const res = await q(
    `INSERT INTO games
       (result_tab_id, round, match_date, home_entity_id, away_entity_id,
        home_entity_type, away_entity_type, winner_entity_id, home_won, stats,
        created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'fighter','fighter',$6,$7,$8,NOW(),NOW())
     RETURNING id`,
    [resultTabId, cardName, cardDate, homeId, awayId, winnerId, homeWon, JSON.stringify(stats)]
  );
  return res.rows[0].id;
}

// ── One event, start to finish ───────────────────────────────────────────────
async function ingestEvent(eventName, eventInfo, rows, data) {
  console.log(`\n  🥊 ${eventName} — ${eventInfo.date || '?'}`);
  if (!eventInfo.date) { console.warn('    ! No date found, skipping event'); return; }
  if (!rows.length) { console.warn('    ! No fights found, skipping event'); return; }

  const year = parseInt(eventInfo.date.slice(0, 4), 10);
  const cardMeta = { eventKind: eventKind(eventName), venue: eventInfo.location };

  const splitBouts = rows.map(r => splitBout(r.BOUT));
  const headlinerIdx = markHeadliner(eventName, rows, splitBouts);

  const fights = rows.map((row, idx) => {
    const bout = splitBouts[idx];
    if (!bout) return null;
    const [nameA, nameB] = bout;

    const outcome = (row.OUTCOME || '').trim();
    const winner = outcome === 'W/L' ? 'a' : outcome === 'L/W' ? 'b' : null;

    const weightClass = extractWeightClass(row.WEIGHTCLASS);
    const title = isTitleFight(row.WEIGHTCLASS);
    const round = int(row.ROUND);
    const time = row.TIME && row.TIME !== '--' ? row.TIME.trim() : null;
    const method = row.METHOD ? row.METHOD.trim() : null;

    return {
      headliner: idx === headlinerIdx,
      weightClass,
      title,
      titleName: title ? `${weightClass} Title` : null,
      a: { name: nameA },
      b: { name: nameB },
      winner,
      method,
      finishRound: round,
      finishTime: time,
    };
  }).filter(Boolean);

  if (DRY_RUN) {
    console.log(`    (dry-run) ${fights.length} fights, kind=${cardMeta.eventKind}, venue=${cardMeta.venue}`);
    fights.forEach(f => console.log(
      `      ${f.headliner ? '★ ' : '  '}${f.a.name} vs ${f.b.name} — ${f.weightClass}${f.title ? ' (TITLE)' : ''} — ` +
      `${f.method || '?'} R${f.finishRound ?? '?'} ${f.finishTime || '?'}, winner: ${f.winner === 'a' ? f.a.name : f.winner === 'b' ? f.b.name : 'draw/NC'}`
    ));
    return;
  }

  const competitionId = await getUfcCompetitionId();
  const seasonId = await upsertSeason(competitionId, year);
  const resultTabId = await upsertResultTab(seasonId);

  let created = 0;
  for (const fight of fights) {
    try {
      const gender = genderFromWeightClass(fight.weightClass);

      const resolve = (name) => {
        const bio = data.bioByName.get(name) || null;
        const nick = data.nickByName.get(name) || null;
        const url = bio?.url || nick?.url || null;
        const bioObj = bio ? { ...bio, nickname: nick?.nickname || null } : (nick?.nickname ? { nickname: nick.nickname } : null);
        return { fighter: { name, url }, bio: bioObj };
      };

      const ra = resolve(fight.a.name);
      const rb = resolve(fight.b.name);
      const homeId = await upsertFighter(ra.fighter, ra.bio, gender);
      const awayId = await upsertFighter(rb.fighter, rb.bio, gender);

      await upsertFight(resultTabId, eventName, eventInfo.date, cardMeta, fight, homeId, awayId);
      created++;
      const result = fight.winner
        ? `${fight.winner === 'a' ? fight.a.name : fight.b.name} won (${fight.method}, R${fight.finishRound} ${fight.finishTime})`
        : `no winner (${fight.method || 'draw/NC'})`;
      console.log(`    ${fight.headliner ? '★ ' : '  '}${fight.a.name} vs ${fight.b.name} — ${fight.weightClass}${fight.title ? ' [TITLE]' : ''} — ${result}`);
    } catch (err) {
      console.warn(`    ! Fight skipped (${fight.a?.name} vs ${fight.b?.name}): ${err.message}`);
    }
  }
  console.log(`  ✅ ${created}/${fights.length} fights ingested for ${eventName}`);
}

// ── Commands ─────────────────────────────────────────────────────────────────
async function runHistory(startYear, endYear) {
  const data = await loadAllData();

  const inRange = [...data.eventsByName.entries()]
    .filter(([, info]) => info.date && int(info.date.slice(0, 4)) >= startYear && int(info.date.slice(0, 4)) <= endYear)
    .sort((a, b) => a[1].date.localeCompare(b[1].date)); // oldest first, so re-runs resume sensibly

  console.log(`Found ${data.eventsByName.size} events total, ${inRange.length} in range ${startYear}-${endYear}`);

  for (const [eventName, info] of inRange) {
    const rows = data.fightRowsByEvent.get(eventName) || [];
    await ingestEvent(eventName, info, rows, data);
  }
}

async function runUpcoming() {
  const data = await loadAllData();
  const withoutResults = [...data.eventsByName.entries()]
    .filter(([name]) => !(data.fightRowsByEvent.get(name) || []).length);

  if (!withoutResults.length) {
    console.log('No unresolved upcoming events in this data source right now (see file header comment) — nothing to seed.');
    return;
  }

  console.log(`Found ${withoutResults.length} events with no fight results yet — seeding as scheduled.`);
  for (const [eventName, info] of withoutResults) {
    console.log(`\n  📅 ${eventName} — ${info.date || '?'} (no fight card published yet, competition/season shell only)`);
    if (DRY_RUN || !info.date) continue;
    const competitionId = await getUfcCompetitionId();
    const year = parseInt(info.date.slice(0, 4), 10);
    await upsertSeason(competitionId, year);
  }
}

async function runLive() {
  const currentYear = new Date().getFullYear();
  console.log(`Re-syncing current year (${currentYear}) to pick up newly posted results...`);
  await runHistory(currentYear, currentYear);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const [, , command, ...rest] = process.argv;
  const args = rest.filter(a => !a.startsWith('--'));

  console.log('═══════════════════════════════════════════════');
  console.log('  RANKKS — UFC Ingestion (via Greco1899/scrape_ufc_stats)');
  if (DRY_RUN) console.log('  (dry run — no database writes)');
  console.log('═══════════════════════════════════════════════');

  if (!DRY_RUN) {
    try {
      await pool.query('SELECT 1');
      console.log('✅ Database connected\n');
    } catch (err) {
      console.error('❌ Database connection failed:', err.message);
      process.exit(1);
    }
  }

  if (command === 'history') {
    const startYear = int(args[0]) || new Date().getFullYear();
    const endYear   = int(args[1]) || startYear;
    await runHistory(startYear, endYear);
  } else if (command === 'upcoming') {
    await runUpcoming();
  } else if (command === 'live') {
    await runLive();
  } else {
    console.log('Usage:');
    console.log('  node ingestufc.js history <startYear> <endYear> [--dry-run]');
    console.log('  node ingestufc.js upcoming [--dry-run]');
    console.log('  node ingestufc.js live [--dry-run]');
    process.exit(0);
  }

  console.log('\nDone.');
  await pool.end();
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    pool.end();
    process.exit(1);
  });
}

module.exports = {
  splitBout, isNameMatch, markHeadliner,
  heightToCm, weightToKg, reachToCm, parseLongDate, parseShortDate,
  extractWeightClass, isTitleFight, eventKind, slugify,
  // Shared DB plumbing — exported so other UFC-adjacent ingestion scripts
  // (ingest-ufc-rankings.js, ingest-ufc-upcoming.js) reuse the exact same
  // fighter-matching/upsert logic instead of a second copy that could
  // drift from this one. `pool`/`q` are the same live connection those
  // scripts run their own queries through too — only the process that
  // called `main()` (this file run directly) ever calls `pool.end()`.
  pool, q, int, genderFromWeightClass,
  getUfcCompetitionId, upsertSeason, upsertResultTab,
  upsertFighter, applyFighterBio, upsertFight, resolveNewFighterSlug,
};
