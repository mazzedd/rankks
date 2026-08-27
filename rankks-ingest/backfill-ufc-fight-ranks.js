/**
 * RANKKS - UFC Fight Rank Backfill
 *
 * Source: andrewlor.me/demos/historical-ufc-rankings/ — a public data-viz
 * demo whose underlying dataset (S3-hosted static JSON, no auth, no bot-
 * wall — verified 2026-08-17) is a genuinely rare find: 480 WEEKLY UFC
 * rankings snapshots from 2013-02-04 through 2025-05-06, per division,
 * {fighter, rank} pairs (rank 0 = champion, matching ingest-ufc-
 * rankings.js's own convention for the live snapshot). ufc-fr.com (this
 * repo's other rankings source) only ever has "right now" — nothing
 * historical.
 *
 * What this does: for every DECIDED UFC fight already in `games` (from
 * ingestufc.js's CSV pipeline), looks up each fighter's rank as of the
 * most recent weekly snapshot on or before the fight's date, and writes
 * it onto that game row — `games.stats.home_rank` / `away_rank` — same
 * "rank recorded per-match" pattern this schema's own tennis pipeline
 * already uses (games.stats->>'w_rank'/'l_rank'). Lets any fight card
 * show "(#3)" next to a fighter's name retroactively, no new page.
 *
 * Matching: fighter names in this dataset are plain text with no stable
 * ID to correlate against (unlike ufcstats' externalId or ufc-fr.com's
 * numeric fighter id) — EXACT normalized-name match only against the
 * fight's own home_name/away_name (already the correct real name for
 * that game, sourced from ufcstats). No fuzzy/substring fallback:
 * ingest-ufc-upcoming.js's last-name-fuzzy matcher wrongly merged two
 * distinct real fighters into each other on its first run 2026-08-17
 * (Louis Jourdain -> Charles Jourdain, Bilal Hasan -> Farman Hasanov) —
 * here a wrong match would silently attribute one fighter's real
 * historical ranking to a different fighter's fight, which is worse
 * (data corruption) than just leaving a genuinely-ranked fighter's rank
 * blank on a handful of fights whose name formatting doesn't line up
 * exactly (e.g. accents, suffixes) — an accepted, visible gap over a
 * silent wrong one.
 *
 * Only reaches fights with match_date >= this dataset's first date
 * (2013-02-04) — fights before then have no rankings to look up (UFC's
 * own media rankings program didn't exist yet), and future
 * scheduled fights (ingest-ufc-upcoming.js's own rows) are out of this
 * dataset's range entirely (it ends 2025-05-06) — those should read
 * ingest-ufc-rankings.js's LIVE snapshot instead, a separate concern.
 *
 * Usage:
 *   node backfill-ufc-fight-ranks.js [--dry-run]
 */
require('dotenv').config({ path: '../rankks-api/.env' });
const { q, pool } = require('./ingestufc');

const DRY_RUN = process.argv.includes('--dry-run');
const RANKINGS_URL = 'https://s3.us-west-2.amazonaws.com/andrewlor.me/demos/historical-ufc-rankings/data/rankings_history.json';

// P4P divisions are cross-weight-class rankings, not one of the 11
// per-division tables this schema's `standings`/games.stats.weight_class
// convention tracks — skipped here for the same reason ingest-ufc-
// rankings.js's own DIVISIONS list never included them.
const SKIP_DIVISIONS = new Set(["POUND-FOR-POUND", "MEN'S POUND-FOR-POUND", "WOMEN'S POUND-FOR-POUND"]);

function normalizeFighterName(name) {
  return (name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

async function loadRankingsHistory() {
  console.log('Fetching rankings history from andrewlor.me (S3)...');
  const res = await fetch(RANKINGS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const dates = Object.keys(raw).sort();
  console.log(`  ${dates.length} weekly snapshots, ${dates[0]} to ${dates[dates.length - 1]}`);

  // Per division: sorted array of { date, ranks: Map<normalizedName, rank> }
  const byDivision = new Map();
  for (const date of dates) {
    for (const [division, rows] of Object.entries(raw[date])) {
      if (SKIP_DIVISIONS.has(division)) continue;
      if (!byDivision.has(division)) byDivision.set(division, []);
      const ranks = new Map(rows.map(r => [normalizeFighterName(r.fighter), r.rank]));
      byDivision.get(division).push({ date, ranks });
    }
  }
  return { byDivision, firstDate: dates[0], lastDate: dates[dates.length - 1] };
}

// Most recent snapshot on or before `date` (simple linear scan backward —
// snapshots arrays are only ~250-480 entries each, called once per fight,
// no need for a binary search).
function findSnapshotOnOrBefore(snapshots, date) {
  let found = null;
  for (const snap of snapshots) {
    if (snap.date > date) break;
    found = snap;
  }
  return found;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  RANKKS — UFC Fight Rank Backfill (andrewlor.me)');
  if (DRY_RUN) console.log('  (dry run — no database writes)');
  console.log('═══════════════════════════════════════════════');

  if (!DRY_RUN) {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  }

  const { byDivision, firstDate, lastDate } = await loadRankingsHistory();

  // Capped at the dataset's own last snapshot (2025-05-06) — without this,
  // findSnapshotOnOrBefore silently falls back to that same last snapshot
  // for every fight AFTER it too (nothing more recent exists to compare
  // against), which would misrepresent a 14+-month-stale rank as this
  // fight's real contemporaneous one (caught 2026-08-17: an Aug 2026 fight
  // was about to get tagged with May 2025 rankings).
  const games = (await q(`
    SELECT g.id, g.home_entity_id, g.away_entity_id, g.match_date,
      g.stats->>'weight_class' AS weight_class,
      he.canonical_name AS home_name, ae.canonical_name AS away_name
    FROM games g
    JOIN result_tabs rt ON g.result_tab_id = rt.id
    JOIN seasons s ON rt.season_id = s.id
    JOIN competitions c ON c.id = s.competition_id
    JOIN entities he ON he.id = g.home_entity_id
    JOIN entities ae ON ae.id = g.away_entity_id
    WHERE c.slug = 'ufc' AND g.stats->>'status' = 'final'
      AND g.match_date BETWEEN $1 AND $2
      AND g.stats->>'weight_class' IS NOT NULL
    ORDER BY g.match_date
  `, [firstDate, lastDate])).rows;

  console.log(`\nChecking ${games.length} decided fights (${firstDate} to ${lastDate})...`);

  let updated = 0, homeHits = 0, awayHits = 0;
  for (const g of games) {
    const division = g.weight_class.toUpperCase();
    const snapshots = byDivision.get(division);
    if (!snapshots) continue; // Catch Weight, Open Weight, tournament-era strings — no ranking division for these

    const dateStr = new Date(g.match_date).toISOString().slice(0, 10);
    const snap = findSnapshotOnOrBefore(snapshots, dateStr);
    if (!snap) continue; // fight predates this division's first snapshot

    const homeRank = snap.ranks.get(normalizeFighterName(g.home_name));
    const awayRank = snap.ranks.get(normalizeFighterName(g.away_name));
    if (homeRank == null && awayRank == null) continue;

    if (homeRank != null) homeHits++;
    if (awayRank != null) awayHits++;

    if (DRY_RUN) {
      console.log(`  ${g.home_name}${homeRank != null ? ` (#${homeRank})` : ''} vs ${g.away_name}${awayRank != null ? ` (#${awayRank})` : ''} — ${dateStr} ${division}`);
      continue;
    }

    const patch = {};
    if (homeRank != null) patch.home_rank = homeRank;
    if (awayRank != null) patch.away_rank = awayRank;
    await q(`UPDATE games SET stats = stats || $2::jsonb, updated_at = NOW() WHERE id = $1`, [g.id, JSON.stringify(patch)]);
    updated++;
  }

  console.log(`\n✅ ${DRY_RUN ? 'Would update' : 'Updated'} ${DRY_RUN ? homeHits + '/' + awayHits + ' home/away hits across ' + games.length + ' fights checked' : updated + ' fights'}`);
  console.log('\nDone.');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  pool.end();
  process.exit(1);
});
