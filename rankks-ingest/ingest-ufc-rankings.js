/**
 * RANKKS - UFC Rankings Ingestion
 *
 * Source: www.ufc-fr.com's per-division ranking pages (a French UFC fan
 * site — see ufc-fr-source.js's header comment for why this is a second
 * source alongside ingestufc.js's Greco1899 CSVs, which carry no ranking
 * data at all). Re-runnable: rankings change ~weekly, so each run wipes
 * and rewrites the `standings` rows for every division rather than trying
 * to diff — simplest correct behaviour for a full-snapshot source like
 * this (no partial-update case exists: the page always lists everyone
 * currently ranked).
 *
 * Schema: one `standings` row per ranked fighter, grouped by a dedicated
 * `result_tabs` row per division (tab_key='rankings-<gender>-<weightclass>',
 * typology='standings') under the UFC competition's CURRENT season — same
 * `standings` table F1/NBA already use for their own tables, no new table.
 * The champion (crown icon, no number on the site) gets position=0;
 * ranked contenders keep the site's own 1-15 numbering.
 *
 * Usage:
 *   node ingest-ufc-rankings.js [--dry-run]
 */
require('dotenv').config({ path: '../rankks-api/.env' });
const { slugify, q, getUfcCompetitionId } = require('./ingestufc');
const { fetchHtml, parseRecord, findOrCreateFighter, resolveCountryId } = require('./ufc-fr-source');

const DRY_RUN = process.argv.includes('--dry-run');

// Matches the site's own "Classements Hommes"/"Classements Femmes" nav
// exactly (verified 2026-08-17) — UFC currently has no ranked top-15 list
// for women's Featherweight (too few active fighters) or Atomweight (not
// a real UFC division), so those are correctly absent here, not a gap.
const DIVISIONS = [
  { path: 'classement-homme-poids-mouches.html',    weightClass: 'Flyweight',         gender: 'M' },
  { path: 'classement-homme-poids-coqs.html',       weightClass: 'Bantamweight',      gender: 'M' },
  { path: 'classement-homme-poids-plumes.html',     weightClass: 'Featherweight',     gender: 'M' },
  { path: 'classement-homme-poids-legers.html',     weightClass: 'Lightweight',       gender: 'M' },
  { path: 'classement-homme-poids-mi-moyens.html',  weightClass: 'Welterweight',      gender: 'M' },
  { path: 'classement-homme-poids-moyens.html',     weightClass: 'Middleweight',      gender: 'M' },
  { path: 'classement-homme-poids-mi-lourds.html',  weightClass: 'Light Heavyweight', gender: 'M' },
  { path: 'classement-homme-poids-lourds.html',     weightClass: 'Heavyweight',       gender: 'M' },
  { path: 'classement-femme-poids-pailles.html',    weightClass: 'Strawweight',       gender: 'F' },
  { path: 'classement-femme-poids-mouches.html',    weightClass: 'Flyweight',         gender: 'F' },
  { path: 'classement-femme-poids-coqs.html',       weightClass: 'Bantamweight',      gender: 'F' },
];

async function upsertRankingResultTab(seasonId, division) {
  const genderSlug = division.gender === 'F' ? 'women' : 'men';
  const wcSlug = slugify(division.weightClass);
  const tabKey = `rankings-${genderSlug}-${wcSlug}`;
  const existing = await q(`SELECT id FROM result_tabs WHERE season_id = $1 AND tab_key = $2`, [seasonId, tabKey]);
  if (existing.rows[0]) return existing.rows[0].id;
  const tabName = `${division.gender === 'F' ? "Women's" : "Men's"} ${division.weightClass} Rankings`;
  const res = await q(
    `INSERT INTO result_tabs (season_id, tab_name, tab_key, typology, display_order, is_default, created_at)
     VALUES ($1, $2, $3, 'standings', 0, false, NOW()) RETURNING id`,
    [seasonId, tabName, tabKey]
  );
  return res.rows[0].id;
}

async function ingestDivision(division) {
  console.log(`\n  🏆 ${division.gender === 'F' ? "Women's" : "Men's"} ${division.weightClass}`);
  const $ = await fetchHtml(division.path);
  const rows = $('tr.ranking-list').toArray();
  if (!rows.length) { console.warn('    ! No ranking rows found — page structure may have changed'); return; }

  const parsed = rows.map(row => {
    const $row = $(row);
    const isChampion = $row.find('.fa-crown').length > 0;
    const rankText = $row.find('td.rank').text().trim();
    const position = isChampion ? 0 : (parseInt(rankText, 10) || null);
    const nameEl = $row.find('td.nom a');
    const href = nameEl.attr('href') || '';
    const idMatch = href.match(/combattant-(\d+)\.html/);
    const name = nameEl.text().trim();
    const recordText = $row.find('.badge-call-ranking-ufc').text().trim();
    const globalRankText = $row.find('.badge-call-ranking-alltime').text().replace('#', '').trim();
    const flagSrc = $row.find('td.flag img').attr('src') || '';
    return {
      position, name,
      ufcfrId: idMatch ? idMatch[1] : null,
      record: parseRecord(recordText),
      siteGlobalRank: parseInt(globalRankText, 10) || null,
      flagSrc,
      isChampion,
    };
  }).filter(r => r.name && r.ufcfrId);

  if (DRY_RUN) {
    parsed.forEach(r => console.log(
      `    ${r.isChampion ? '👑' : String(r.position).padStart(2)} ${r.name} — ${r.record ? `${r.record.wins}-${r.record.losses}-${r.record.draws}${r.record.note ? ', ' + r.record.note : ''}` : '?'}`
    ));
    return;
  }

  const competitionId = await getUfcCompetitionId();
  const currentSeason = await q(
    `SELECT id FROM seasons WHERE competition_id = $1 AND status = 'current' ORDER BY year DESC LIMIT 1`,
    [competitionId]
  );
  const seasonId = currentSeason.rows[0]?.id;
  if (!seasonId) { console.warn('    ! No "current" UFC season found — run ingestufc.js history first'); return; }
  const resultTabId = await upsertRankingResultTab(seasonId, division);

  await q(`DELETE FROM standings WHERE result_tab_id = $1`, [resultTabId]);

  let count = 0;
  for (const r of parsed) {
    try {
      const entityId = await findOrCreateFighter(r.name, r.ufcfrId, division.gender);
      const countryId = await resolveCountryId(r.flagSrc);
      if (countryId) await q(`UPDATE entities SET country_id = COALESCE(country_id, $2) WHERE id = $1`, [entityId, countryId]);

      await q(
        `INSERT INTO standings (result_tab_id, position, entity_id, entity_type, stats, created_at, updated_at)
         VALUES ($1, $2, $3, 'fighter', $4, NOW(), NOW())`,
        [resultTabId, r.position, entityId, JSON.stringify({
          wins: r.record?.wins ?? null,
          losses: r.record?.losses ?? null,
          draws: r.record?.draws ?? null,
          record_note: r.record?.note ?? null,
          is_champion: r.isChampion,
          site_global_rank: r.siteGlobalRank,
        })]
      );
      count++;
    } catch (err) {
      console.warn(`    ! ${r.name} skipped: ${err.message}`);
    }
  }
  console.log(`  ✅ ${count}/${parsed.length} fighters ranked`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  RANKKS — UFC Rankings Ingestion (ufc-fr.com)');
  if (DRY_RUN) console.log('  (dry run — no database writes)');
  console.log('═══════════════════════════════════════════════');

  const { pool } = require('./ingestufc');
  if (!DRY_RUN) {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  }

  for (const division of DIVISIONS) {
    await ingestDivision(division);
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  require('./ingestufc').pool.end();
  process.exit(1);
});
