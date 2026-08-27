/**
 * Shared scraping helpers for ufc-fr.com (www.ufc-fr.com) — a French UFC
 * fan site used as a SECOND, complementary UFC source alongside the
 * Greco1899/scrape_ufc_stats CSVs ingestufc.js reads from. That source
 * only ever carries DECIDED fights (see ingestufc.js's own header
 * comment), so it has no rankings and no future/scheduled events at all.
 * ufc-fr.com has both: per-division ranking tables and full fight cards
 * for not-yet-happened events — verified 2026-08-17 via a plain
 * server-side `fetch()` (not just the browser): real HTML comes back
 * (status 200, `ranking-list`/`fight-card-container` markers present),
 * confirmed NOT bot-walled the way ufcstats.com itself is.
 *
 * Kept separate from ingestufc.js's own exports because everything here
 * is specific to THIS source's markup/French text — the DB-side upsert
 * helpers (upsertFighter, upsertFight, etc.) are the shared part and
 * live in ingestufc.js, required by both ingest-ufc-rankings.js and
 * ingest-ufc-upcoming.js alongside this file.
 */
const cheerio = require('cheerio');
const { slugify, q, resolveNewFighterSlug } = require('./ingestufc');

const BASE = 'https://www.ufc-fr.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchHtml(path, attempt = 1) {
  const url = path.startsWith('http') ? path : `${BASE}/${path.replace(/^\//, '')}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (RANKKS ingestion bot)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return cheerio.load(await res.text());
  } catch (err) {
    if (attempt >= 4) throw new Error(`Failed to fetch ${url}: ${err.message}`);
    const backoff = 1000 * 2 ** (attempt - 1);
    console.warn(`  ! ${url} → ${err.message}, retrying in ${backoff}ms`);
    await sleep(backoff);
    return fetchHtml(path, attempt + 1);
  }
}

// "Samedi 19 septembre 2026" -> "2026-09-19"
const FR_MONTHS = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
};
function parseFrenchDate(str) {
  if (!str) return null;
  const m = str.trim().toLowerCase().match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i);
  if (!m) return null;
  const month = FR_MONTHS[m[2]];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(parseInt(m[1], 10)).padStart(2, '0')}`;
}

// "VAN VS. PANTOJA 2" -> "Van vs. Pantoja 2" — ALL CAPS -> title case,
// keeping "vs." lowercase. Capitalizes the letter after start-of-string,
// whitespace, apostrophe or hyphen so "O'NEILL"/"JEAN-PAUL" come out
// "O'Neill"/"Jean-Paul", not "O'neill"/"Jean-paul".
function toTitleCase(str) {
  return str
    .toLowerCase()
    .replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase())
    .replace(/\bVs\.?/g, 'vs.')
    // "Mcgregor"/"Macdonald" -> "McGregor"/"MacDonald" — the generic
    // word-boundary capitalization above only reaches the very first
    // letter of a word, so surname prefixes with a second internal
    // capital (real UFC example: Conor McGregor) need their own pass.
    .replace(/\bMc([a-zà-ÿ])/g, (m, ch) => 'Mc' + ch.toUpperCase())
    .replace(/\bMac([a-zà-ÿ])/g, (m, ch) => 'Mac' + ch.toUpperCase());
}

// ufc-fr.com's own event titles come as "UFC 331 - VAN VS. PANTOJA 2" or
// "UFC FIGHT NIGHT 285 - HERNANDEZ VS. RODRIGUES" — ALL CAPS, dash-
// separated, Fight Night carrying its own number. ingestufc.js's CSV-
// sourced event names (verified against the live `games` table
// 2026-08-17) are colon-separated title case, and Fight Night carries NO
// number at all — e.g. "UFC 330: Makhachev vs. Machado Garry" / "UFC
// Fight Night: Yan vs. Figueiredo". Every existing frontend parser
// (MmaEventTemplate.jsx's shortEventLabel/matchupLabel) already expects
// that exact shape, splitting on ':' — normalizing here, once, at
// ingestion (rather than patching each of those parsers separately) is
// what actually fixed the all-caps/un-shortened Line B labels, EventBlock
// headline, and EDITION ribbon stat for freshly-scraped events (Mohamed
// 2026-08-17). Bonus: this also makes a future `ingestufc.js live` run's
// exact-string reconciliation (see ingest-ufc-upcoming.js's own header
// comment on that risk) far more likely to land on the same round name
// once the CSV source catches up with real results.
function normalizeEventName(raw) {
  const dashIdx = raw.indexOf(' - ');
  if (dashIdx < 0) return toTitleCase(raw);
  let prefix = raw.slice(0, dashIdx).trim();
  const suffix = toTitleCase(raw.slice(dashIdx + 3).trim());
  if (/^UFC FIGHT NIGHT \d+$/i.test(prefix)) prefix = 'UFC Fight Night';
  else if (/^UFC\s+\d+$/i.test(prefix)) prefix = prefix.replace(/^ufc/i, 'UFC');
  return `${prefix}: ${suffix}`;
}

// ufc-fr.com's own French division labels ("Poids Mouches") -> the same
// English weight-class strings ingestufc.js's WEIGHT_CLASSES/
// extractWeightClass already use everywhere else in this schema — so
// games.stats.weight_class reads identically regardless of which source
// wrote the row. Gender ("Women's " prefix) is NOT derivable from this
// label — men's and women's flyweight both read "Poids Mouches" — see
// resolveGender() in the two ingest scripts, which infer it from the
// fighters' own already-known entities.gender instead.
const FR_WEIGHT_CLASS = {
  'poids mouches': 'Flyweight',
  'poids coqs': 'Bantamweight',
  'poids plumes': 'Featherweight',
  'poids légers': 'Lightweight',
  'poids legers': 'Lightweight',
  'poids mi-moyens': 'Welterweight',
  'poids moyens': 'Middleweight',
  'poids mi-lourds': 'Light Heavyweight',
  'poids lourds': 'Heavyweight',
  'poids pailles': 'Strawweight',
  'poids atomes': 'Atomweight',
  'poids plumes catch weight': 'Catch Weight',
  'catch weight': 'Catch Weight',
};

// "Championnat du Monde - Poids Mouches" -> { weightClass: 'Flyweight', isTitleFight: true }
// "Combat Categorie - Poids Légers"       -> { weightClass: 'Lightweight', isTitleFight: false }
function parseCatLabel(label) {
  const clean = (label || '').trim();
  const isTitleFight = /championnat/i.test(clean);
  const afterDash = clean.includes('-') ? clean.slice(clean.indexOf('-') + 1).trim() : clean;
  const key = afterDash.toLowerCase().replace(/\s+/g, ' ').trim();
  // Catchweight bouts (fighters agree a weight outside any named
  // division) are labelled by exact poundage here ("Poids 158 lbs")
  // rather than a division name — normalized to the same 'Catch Weight'
  // string ingestufc.js's own CSV-sourced extractWeightClass() already
  // uses for ufcstats' "Catch Weight Bout" text, so both sources agree.
  const weightClass = /^poids\s+\d+\s*lbs?\.?$/.test(key) ? 'Catch Weight' : (FR_WEIGHT_CLASS[key] || afterDash || null);
  return { weightClass, isTitleFight };
}

// "14-4-0 UFC" / "8-6-0, 1NC UFC" -> { wins:14, losses:4, draws:0, note:null|'1NC' }
// The ranking table's own badge text always carries a trailing " UFC"
// (it's labelling the record as UFC-specific, not part of the record
// itself) — stripped before parsing so `note` comes out as a clean "1NC"
// rather than "1NC UFC".
function parseRecord(text) {
  if (!text) return null;
  const clean = text.trim().replace(/\s*UFC\s*$/i, '');
  const m = clean.match(/(\d+)-(\d+)-(\d+)(?:,\s*(.+))?/);
  if (!m) return null;
  return { wins: parseInt(m[1], 10), losses: parseInt(m[2], 10), draws: parseInt(m[3], 10), note: m[4] || null };
}

// Flag <img src="images/flags/24/United-States.png"> -> "United States"
// (this source's flag filenames are plain English country names — the
// on-page alt/title text is French ("Etats-Unis") and NOT used here,
// specifically so this lines up with countries.name in our own schema,
// which is English). Hyphens in multi-word names -> spaces.
function countryNameFromFlagSrc(src) {
  if (!src) return null;
  const m = src.match(/\/([^/]+)\.(?:png|svg|webp)$/i);
  if (!m) return null;
  return m[1].replace(/-/g, ' ').trim();
}

// A handful of ufc-fr.com country-flag names that don't literally match
// this schema's `countries.name` spelling — extend as new misses turn up
// (both ingest scripts log any name they can't resolve, so gaps are
// visible rather than silently dropped).
// Verified against the live `countries` table 2026-08-17 (queried
// directly — see the exchange that produced this list) rather than
// guessed: this schema's `countries.name` already matches "Czech
// Republic"/"South Korea"/"North Korea" as-is (no alias needed), stores
// only a single unsplit "Congo" row, and spells Ivory Coast with its
// French name.
const COUNTRY_NAME_ALIASES = {
  'Ivory Coast': "Côte d'Ivoire",
  'Congo Kinshasa': 'Congo',
  'Congo Brazzaville': 'Congo',
};

function resolveCountryName(rawName) {
  if (!rawName) return null;
  return COUNTRY_NAME_ALIASES[rawName] || rawName;
}

// ── Fighter matching (shared by ingest-ufc-rankings.js and
// ingest-ufc-upcoming.js — both source fighters from this same site by
// name, keyed on this source's own numeric fighter id, a different id
// space from ufcstats' external_ids.ufcstats_id) ──────────────────────
async function lookupFighterGender(name, ufcfrId) {
  const byExternal = await q(
    `SELECT gender FROM entities WHERE entity_type = 'fighter' AND external_ids->>'ufcfr_id' = $1`, [String(ufcfrId)]
  );
  if (byExternal.rows[0]) return byExternal.rows[0].gender || null;
  const bySlug = await q(
    `SELECT gender FROM entities WHERE entity_type = 'fighter' AND slug = $1`, [slugify(name)]
  );
  return bySlug.rows[0]?.gender || null;
}

async function findOrCreateFighter(name, ufcfrId, gender) {
  const byExternal = await q(
    `SELECT id FROM entities WHERE entity_type = 'fighter' AND external_ids->>'ufcfr_id' = $1`, [String(ufcfrId)]
  );
  if (byExternal.rows[0]) return byExternal.rows[0].id;

  const slug = slugify(name);
  const bySlug = await q(
    `SELECT id FROM entities WHERE entity_type = 'fighter' AND slug = $1`, [slug]
  );
  if (bySlug.rows[0]) {
    const id = bySlug.rows[0].id;
    await q(
      `UPDATE entities SET external_ids = external_ids || $2, gender = COALESCE(gender, $3), updated_at = NOW() WHERE id = $1`,
      [id, JSON.stringify({ ufcfr_id: String(ufcfrId) }), gender || null]
    );
    return id;
  }

  // NO last-name-fuzzy fallback here — there used to be one ("does
  // exactly one existing fighter's canonical_name contain this last
  // name"), removed 2026-08-17 after it produced two confirmed wrong
  // merges on its first real run: "Louis Jourdain" (ufc-fr.com fighter
  // 6821, a 0-0-0 UFC debutant) got merged into the existing, unrelated
  // "Charles Jourdain" entity, and "Bilal Hasan" (fighter 7787) got
  // merged into the existing, unrelated "Farman Hasanov" — both real
  // distinct people who happen to share a last-name substring, both
  // caught only by manually cross-checking ufc-fr.com's own fighter
  // profile pages against what got written. A shared surname is common
  // enough that "exactly one candidate" is not a safe uniqueness signal.
  // Trade-off accepted deliberately: a genuinely-same fighter whose name
  // is formatted differently between sources now creates a second entity
  // instead of merging — a visible, later-fixable duplicate — rather than
  // silently attributing one real person's fight to a different real
  // person's record.
  // Same cross-sport slug-collision guard as ingestufc.js's own
  // upsertFighter (see resolveNewFighterSlug's header comment there for
  // the real corruption this fixes — 11 fighters, 217 UFC games wrongly
  // attributed to football players sharing their slug, found 2026-08-17).
  const insertSlug = await resolveNewFighterSlug(slug);
  const res = await q(
    `INSERT INTO entities (entity_type, canonical_name, slug, gender, external_ids, is_active, is_verified, created_at, updated_at)
     VALUES ('fighter', $1, $2, $3, $4, true, false, NOW(), NOW())
     RETURNING id`,
    [name, insertSlug, gender || null, JSON.stringify({ ufcfr_id: String(ufcfrId) })]
  );
  console.log(`    ✦ Created fighter: ${name}${insertSlug !== slug ? ` (slug: ${insertSlug}, "${slug}" already taken by a non-fighter entity)` : ''}`);
  return res.rows[0].id;
}

// ── Country backfill (from this source's flag <img> filenames) ─────────
let countryMapCache = null;
async function getCountryMap() {
  if (countryMapCache) return countryMapCache;
  const rows = (await q(`SELECT id, name FROM countries`)).rows;
  countryMapCache = new Map(rows.map(r => [r.name.toLowerCase(), r.id]));
  return countryMapCache;
}

async function resolveCountryId(flagSrc) {
  const raw = countryNameFromFlagSrc(flagSrc);
  if (!raw) return null;
  const name = resolveCountryName(raw);
  const map = await getCountryMap();
  const id = map.get(name.toLowerCase());
  if (!id) console.warn(`    ? Unmapped country "${raw}" (flag: ${flagSrc}) — left blank, see COUNTRY_NAME_ALIASES in ufc-fr-source.js`);
  return id || null;
}

module.exports = {
  fetchHtml, parseFrenchDate, normalizeEventName, parseCatLabel, parseRecord,
  countryNameFromFlagSrc, resolveCountryName,
  lookupFighterGender, findOrCreateFighter, resolveCountryId,
};
