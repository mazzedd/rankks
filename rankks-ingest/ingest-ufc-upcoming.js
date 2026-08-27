/**
 * RANKKS - UFC Upcoming Events Ingestion
 *
 * Source: www.ufc-fr.com — see ufc-fr-source.js's header comment for why
 * this exists as a second UFC source: ingestufc.js's Greco1899 CSVs only
 * ever carry decided fights (0 of ~8860 rows have an empty OUTCOME), so
 * `ingestufc.js upcoming` has never had anything to seed. This site
 * publishes full fight cards for events that haven't happened yet —
 * date, venue, both fighters, weight class, title-fight flag — which is
 * exactly the gap.
 *
 * Discovery: scrapes the "Carte des combats" (fight-card carousel) on
 * prochain-evenement.html for its list of evenement-<id>.html links —
 * verified 2026-08-17 this is specifically the upcoming-events widget
 * (the page also has a smaller recent-results ticker mixed in below it,
 * which this deliberately does NOT read from). If ufc-fr.com restructures
 * that page, this is the one place to fix the discovery step.
 *
 * Each fight is written via ingestufc.js's own upsertFight — same
 * `games` row shape decided fights use, just `stats.status = 'scheduled'`
 * and no winner/method/finish data. Reuses upsertSeason/upsertResultTab
 * too, so a scheduled fight lands in the SAME season/result_tab a
 * decided one would (year comes from the event's own date) — meaning
 * once ingestufc.js's `live`/`history` catches up post-event with real
 * results (matched on the same round name + entity pair), it UPDATES
 * this same row rather than creating a duplicate. That reconciliation
 * depends on the event name string matching exactly between the two
 * sources — a known, accepted risk (same class of risk ingestufc.js's
 * own markHeadliner already documents for imperfect name matching), not
 * something this script tries to solve further.
 *
 * Safety: a scheduled write NEVER overwrites a fight that already has a
 * decided result (status: 'final') in our DB — guards against this
 * script accidentally reverting a real result back to "scheduled" if
 * ufc-fr.com's own "upcoming" list is ever stale.
 *
 * Usage:
 *   node ingest-ufc-upcoming.js [--dry-run]
 */
require('dotenv').config({ path: '../rankks-api/.env' });
const {
  int, eventKind, getUfcCompetitionId, upsertSeason, upsertResultTab, upsertFight, q,
} = require('./ingestufc');
const {
  fetchHtml, parseFrenchDate, normalizeEventName, parseCatLabel, parseRecord,
  lookupFighterGender, findOrCreateFighter, resolveCountryId,
} = require('./ufc-fr-source');

const DRY_RUN = process.argv.includes('--dry-run');

async function discoverUpcomingEventIds() {
  const $ = await fetchHtml('prochain-evenement.html');
  const ids = new Set();
  $('a[href*="evenement-"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/evenement-(\d+)\.html/);
    if (m) ids.add(m[1]);
  });
  return [...ids];
}

// Some announced-but-not-official bouts render a "Combat non confirmé"
// (fight not confirmed) badge in place of the usual "Combat Categorie -
// Poids X" weight-class label — e.g. a fighter pulled out and no
// replacement is locked in yet (verified 2026-08-17 on evenement-816,
// UFC 332). Not real matchup data, so these are skipped rather than
// seeded with a garbage weight_class.
function parseFightCard($, container) {
  const $c = $(container);
  const catLabelText = $c.find('.fight-header .cat-label').text();
  if (/non confirm|annul/i.test(catLabelText)) return null;
  const { weightClass, isTitleFight } = parseCatLabel(catLabelText);

  const left = $c.find('.fighter-side').eq(0);
  const right = $c.find('.fighter-side').eq(1);

  const readSide = ($side) => {
    const nameEl = $side.find('.fighter-name.nom');
    const href = nameEl.attr('href') || '';
    const idMatch = href.match(/combattant-(\d+)\.html/);
    return {
      name: nameEl.text().trim(),
      ufcfrId: idMatch ? idMatch[1] : null,
      record: parseRecord($side.find('.palmares').text()),
      flagSrc: $side.find('.flag-img').attr('src') || '',
    };
  };

  return { weightClass, isTitleFight, a: readSide(left), b: readSide(right) };
}

async function ingestEvent(eventId) {
  const $ = await fetchHtml(`evenement-${eventId}.html`);

  const rawEventName = $('h1 span').first().text().trim() || $('h1').text().trim();
  if (!rawEventName) { console.warn(`  ! evenement-${eventId}.html — no event name found, skipping`); return; }

  // The "Carte des combats" discovery carousel turned out to bundle
  // events from UFC-adjacent feeder promotions too — e.g. "UFC RTU
  // SHANGHAI 2026" (Road to UFC, a separate prospect tournament the
  // site's own nav lists under its own "MMA Promotions" section,
  // organisation-evenement-RTU.html — not the main UFC roster). Excluded
  // so the `ufc` competition only ever gets real UFC-roster fights.
  // Checked against the raw title (not the normalized one below) — clearer,
  // and doesn't depend on how normalizeEventName happens to reshape it.
  if (/\bRTU\b|Road to UFC|Contender Series|DWCS/i.test(rawEventName)) {
    console.log(`\n  📅 ${rawEventName} — feeder-promotion event, not main UFC roster, skipping`);
    return;
  }

  // "UFC 331 - VAN VS. PANTOJA 2" -> "UFC 331: Van vs. Pantoja 2" — see
  // normalizeEventName's own comment for why (matches ingestufc.js's CSV
  // naming convention exactly, which every frontend parser expects).
  const eventName = normalizeEventName(rawEventName);

  const dateLabel = $('.event-meta-list .meta-label, .event-meta-list .meta-content .meta-label')
    .filter((_, el) => $(el).text().trim() === 'Date').first();
  const dateText = dateLabel.parent().find('div').last().text().trim() || dateLabel.closest('div').next().text().trim();
  const eventDate = parseFrenchDate(dateText);

  const lieuLabel = $('.event-meta-list .meta-label').filter((_, el) => $(el).text().trim() === 'Lieu').first();
  const venue = lieuLabel.parent().find('.meta-value').first().text().trim() || null;

  console.log(`\n  📅 ${eventName} — ${eventDate || '?'} — ${venue || '?'}`);
  if (!eventDate) { console.warn('    ! No parseable date, skipping event'); return; }

  // prochain-evenement.html's "Carte des combats" carousel (this script's
  // event-id discovery source) turned out NOT to be purely upcoming when
  // checked live 2026-08-17 — it also carries the last several already-
  // happened events (e.g. UFC 329, already decided in our DB from CSV
  // history). Harmless either way since upsertFight's existing-row check
  // further down never downgrades a decided fight back to scheduled, but
  // skipping past dates outright keeps this script's actual behaviour
  // matching its name and avoids redundant writes every run.
  if (eventDate < new Date().toISOString().slice(0, 10)) {
    console.log('    (already past — skipping, not this script\'s concern)');
    return;
  }

  const containers = $('.fight-card-container').toArray();
  if (!containers.length) { console.warn('    ! No fight card published yet — shell only, skipping'); return; }

  const cards = containers.map(c => parseFightCard($, c)).filter(c => c && c.a.name && c.b.name);
  const kind = eventKind(eventName);
  const year = int(eventDate.slice(0, 4));

  if (DRY_RUN) {
    cards.forEach((c, i) => console.log(
      `    ${i === 0 ? '★ ' : '  '}${c.a.name} vs ${c.b.name} — ${c.weightClass}${c.isTitleFight ? ' (TITLE)' : ''}`
    ));
    return;
  }

  const competitionId = await getUfcCompetitionId();
  const seasonId = await upsertSeason(competitionId, year);
  const resultTabId = await upsertResultTab(seasonId);
  const cardMeta = { eventKind: kind, venue };

  let created = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    try {
      const knownGender = (await lookupFighterGender(c.a.name, c.a.ufcfrId)) || (await lookupFighterGender(c.b.name, c.b.ufcfrId));
      if (!knownGender) console.warn(`    ? Gender unknown for both "${c.a.name}" and "${c.b.name}" — defaulting weight class to men's naming`);
      const gender = knownGender || 'M';
      const weightClass = gender === 'F' && !c.weightClass.startsWith("Women's") ? `Women's ${c.weightClass}` : c.weightClass;

      const homeId = await findOrCreateFighter(c.a.name, c.a.ufcfrId, gender);
      const awayId = await findOrCreateFighter(c.b.name, c.b.ufcfrId, gender);

      const countryAId = await resolveCountryId(c.a.flagSrc);
      if (countryAId) await q(`UPDATE entities SET country_id = COALESCE(country_id, $2) WHERE id = $1`, [homeId, countryAId]);
      const countryBId = await resolveCountryId(c.b.flagSrc);
      if (countryBId) await q(`UPDATE entities SET country_id = COALESCE(country_id, $2) WHERE id = $1`, [awayId, countryBId]);

      // Never downgrade an already-decided fight back to scheduled (see
      // module header's Safety note).
      const existingStatus = await q(
        `SELECT stats->>'status' AS status FROM games
         WHERE result_tab_id = $1 AND round = $2
           AND ((home_entity_id = $3 AND away_entity_id = $4) OR (home_entity_id = $4 AND away_entity_id = $3))`,
        [resultTabId, eventName, homeId, awayId]
      );
      if (existingStatus.rows[0]?.status === 'final') {
        console.log(`    = ${c.a.name} vs ${c.b.name} already decided in our DB, leaving as-is`);
        continue;
      }

      await upsertFight(resultTabId, eventName, eventDate, cardMeta, {
        headliner: i === 0,
        weightClass,
        title: c.isTitleFight,
        titleName: c.isTitleFight ? `${weightClass} Title` : null,
        winner: null,
        method: null,
        finishRound: null,
        finishTime: null,
        status: 'scheduled',
      }, homeId, awayId);

      created++;
      console.log(`    ${i === 0 ? '★ ' : '  '}${c.a.name} vs ${c.b.name} — ${weightClass}${c.isTitleFight ? ' [TITLE]' : ''}`);
    } catch (err) {
      console.warn(`    ! ${c.a?.name} vs ${c.b?.name} skipped: ${err.message}`);
    }
  }
  console.log(`  ✅ ${created}/${cards.length} fights scheduled for ${eventName}`);
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  RANKKS — UFC Upcoming Events Ingestion (ufc-fr.com)');
  if (DRY_RUN) console.log('  (dry run — no database writes)');
  console.log('═══════════════════════════════════════════════');

  const { pool } = require('./ingestufc');
  if (!DRY_RUN) {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  }

  const ids = await discoverUpcomingEventIds();
  console.log(`Found ${ids.length} upcoming events to check.`);
  for (const id of ids) {
    await ingestEvent(id);
  }

  console.log('\nDone.');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  require('./ingestufc').pool.end();
  process.exit(1);
});
