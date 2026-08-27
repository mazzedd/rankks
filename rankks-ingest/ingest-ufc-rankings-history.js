/**
 * RANKKS - UFC Historical Rankings Ingestion
 *
 * Source: same andrewlor.me dataset backfill-ufc-fight-ranks.js reads
 * (480 weekly snapshots, 2013-02-04 to 2025-05-06 — see that file's own
 * header comment for provenance/verification). That script used it to
 * badge individual fights; this one seeds the actual Rankings pages with
 * a real per-YEAR historical snapshot instead of only ever showing "right
 * now" (Mohamed 2026-08-17: "2025 rankings should display latest 2025
 * rankings (max 31.12.2025)").
 *
 * One `standings` snapshot per (division, year): the LAST weekly snapshot
 * dated on or before Dec 31 of that year — not the full weekly history
 * (declined earlier as a bigger, separate feature; this is the "one
 * representative snapshot per year" version instead). Written under that
 * YEAR's own season (tab_key='rankings-<gender>-<weightclass>', same
 * convention ingest-ufc-rankings.js's live snapshot already uses under
 * the *current* season) — so /mma/rankings/:gender/:weightClass just
 * needs to look up by season year, live vs. historical is the same query
 * shape either way.
 *
 * Divisions are read directly off the dataset's own keys (not hardcoded
 * to ingest-ufc-rankings.js's live DIVISIONS list) — the historical data
 * includes "WOMEN'S FEATHERWEIGHT" (a real division that was ranked in
 * the Cris Cyborg era but isn't on ufc-fr.com's current live rankings
 * page, since too few active fighters remain) and this should still show
 * up for the years it was real.
 *
 * Fighter matching: EXACT slug match against existing entities only — no
 * fuzzy fallback, and no auto-creating new entities from a bare name
 * string with nothing else to verify it against (this dataset carries no
 * external id, no country, no record — unlike ufc-fr.com's numeric
 * fighter id). A miss here just means that one ranked fighter is skipped
 * for that snapshot, logged, not silently guessed at — see backfill-ufc-
 * fight-ranks.js's own header comment for why guessing is the wrong
 * trade here (the Louis Jourdain / Bilal Hasan incident).
 *
 * Usage:
 *   node ingest-ufc-rankings-history.js [--dry-run]
 */
require('dotenv').config({ path: '../rankks-api/.env' });
const { q, slugify, getUfcCompetitionId, upsertSeason } = require('./ingestufc');

const DRY_RUN = process.argv.includes('--dry-run');
const RANKINGS_URL = 'https://s3.us-west-2.amazonaws.com/andrewlor.me/demos/historical-ufc-rankings/data/rankings_history.json';

const SKIP_DIVISIONS = new Set(["POUND-FOR-POUND", "MEN'S POUND-FOR-POUND", "WOMEN'S POUND-FOR-POUND"]);

// "WOMEN'S LIGHT HEAVYWEIGHT" -> { gender: 'F', weightClass: 'Light Heavyweight' }
// "HEAVYWEIGHT" -> { gender: 'M', weightClass: 'Heavyweight' }
function parseDivisionKey(key) {
  const isWomen = key.startsWith("WOMEN'S ");
  const raw = isWomen ? key.slice(8) : key;
  const weightClass = raw.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ');
  return { gender: isWomen ? 'F' : 'M', weightClass };
}

async function loadRankingsHistory() {
  console.log('Fetching rankings history from andrewlor.me (S3)...');
  const res = await fetch(RANKINGS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  return raw;
}

// Also tries the "-mma" disambiguated slug — repair_slug_collisions.js's
// one-off migration (2026-08-17) moved 11 real fighters whose plain slug
// collided with an existing football player's onto "<slug>-mma" instead
// (see resolveNewFighterSlug in ingestufc.js for why), so a plain
// slugify(name) alone would miss all of them here.
async function findFighterBySlug(name) {
  const slug = slugify(name);
  const row = await q(
    `SELECT id, gender FROM entities WHERE entity_type = 'fighter' AND slug IN ($1, $2) LIMIT 1`,
    [slug, `${slug}-mma`]
  );
  return row.rows[0] || null;
}

async function upsertRankingResultTab(seasonId, gender, weightClass) {
  const genderSlug = gender === 'F' ? 'women' : 'men';
  const wcSlug = slugify(weightClass);
  const tabKey = `rankings-${genderSlug}-${wcSlug}`;
  const existing = await q(`SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`, [seasonId, tabKey]);
  if (existing.rows[0]) return existing.rows[0].id;
  const tabName = `${gender === 'F' ? "Women's" : "Men's"} ${weightClass} Rankings`;
  const res = await q(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default, created_at)
     VALUES ($1, $2, $3, 'standings', 0, false, NOW()) RETURNING id`,
    [seasonId, tabName, tabKey]
  );
  return res.rows[0].id;
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  RANKKS — UFC Historical Rankings Ingestion (andrewlor.me)');
  if (DRY_RUN) console.log('  (dry run — no database writes)');
  console.log('═══════════════════════════════════════════════');

  const { pool } = require('./ingestufc');
  if (!DRY_RUN) {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  }

  const raw = await loadRankingsHistory();
  const dates = Object.keys(raw).sort();
  console.log(`${dates.length} weekly snapshots, ${dates[0]} to ${dates[dates.length - 1]}`);

  // Group snapshot dates by year, keep only the LATEST date within each year.
  const latestDateByYear = new Map();
  for (const date of dates) {
    const year = parseInt(date.slice(0, 4), 10);
    if (!latestDateByYear.has(year) || date > latestDateByYear.get(year)) latestDateByYear.set(year, date);
  }
  console.log(`Years covered: ${[...latestDateByYear.keys()].join(', ')}`);

  const competitionId = DRY_RUN ? null : await getUfcCompetitionId();
  let totalRanked = 0, totalSkipped = 0;

  for (const [year, snapshotDate] of latestDateByYear) {
    const snapshot = raw[snapshotDate];
    console.log(`\n  📅 ${year} — using snapshot ${snapshotDate}`);

    const seasonId = DRY_RUN ? null : await upsertSeason(competitionId, year);

    for (const [divisionKey, rows] of Object.entries(snapshot)) {
      if (SKIP_DIVISIONS.has(divisionKey)) continue;
      const { gender, weightClass } = parseDivisionKey(divisionKey);

      if (DRY_RUN) {
        console.log(`    ${gender === 'F' ? "Women's" : "Men's"} ${weightClass}: ${rows.length} ranked (top: ${rows[0]?.fighter})`);
        continue;
      }

      const resultTabId = await upsertRankingResultTab(seasonId, gender, weightClass);
      await q(`DELETE FROM standings WHERE result_tab_id = $1`, [resultTabId]);

      let ranked = 0;
      const usedRanks = new Set()
      for (const row of rows) {
        // Source data occasionally has two fighters tagged with the same
        // rank in one snapshot (real anomaly, not a parsing bug — verified
        // 2026-08-17 on Men's Featherweight, 2016-12-19: both Charles
        // Oliveira and Dennis Bermudez tagged rank 7, rank 8 skipped
        // entirely, presumably a data-entry slip on the source site
        // itself). `standings.position` is unique per result_tab, so the
        // second one is skipped rather than guessing which fighter really
        // held the spot — a visible gap over a fabricated correction.
        if (usedRanks.has(row.rank)) {
          console.log(`      ? Duplicate rank ${row.rank} for "${row.fighter}" (${weightClass}, ${year}) — source data anomaly, skipped`);
          totalSkipped++;
          continue;
        }
        const fighter = await findFighterBySlug(row.fighter);
        if (!fighter) {
          console.log(`      ? No entity match for "${row.fighter}" (${weightClass}, ${year}) — skipped`);
          totalSkipped++;
          continue;
        }
        usedRanks.add(row.rank)
        try {
          await q(
            `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats, created_at, updated_at)
             VALUES ($1, $2, $3, 'fighter', $4, NOW(), NOW())`,
            [resultTabId, row.rank, fighter.id, JSON.stringify({
              is_champion: row.rank === 0,
              source: 'andrewlor_historical',
              snapshot_date: snapshotDate,
            })]
          );
          ranked++;
          totalRanked++;
        } catch (err) {
          // One bad row (any other unforeseen data anomaly) shouldn't take
          // down the whole run the way the unguarded duplicate-rank case
          // did on the first real run — log and keep going.
          console.log(`      ! Insert failed for "${row.fighter}" (${weightClass}, ${year}): ${err.message}`);
          totalSkipped++;
        }
      }
      console.log(`    ${gender === 'F' ? "Women's" : "Men's"} ${weightClass}: ${ranked}/${rows.length} ranked fighters matched`);
    }
  }

  console.log(`\n✅ ${DRY_RUN ? 'Would rank' : 'Ranked'} ${totalRanked} fighter-snapshots, ${totalSkipped} unmatched (skipped)`);
  console.log('\nDone.');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  require('./ingestufc').pool.end();
  process.exit(1);
});
