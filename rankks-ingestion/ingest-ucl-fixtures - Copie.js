// ingest-ucl-fixtures.js
// Pulls all fixtures for a UCL season, routes each into the correct
// result_tab (one of 8 groups or one of 4 knockout rounds), and skips
// qualifying-stage fixtures entirely.
const { queryOne, query, queryAll } = require('./db');
const { computeGroupStandings } = require('./ucl-standings');

// Maps API-Sports round strings to our result_tabs.tab_key values.
// Anything not matched here (Preliminary Round, 1st/2nd/3rd Qualifying
// Round, Play-offs) is intentionally skipped — see ingest-ucl.js header.
//
// Two distinct round-naming eras exist in API-Sports' UCL data:
//   2015-2020: "Group Stage - N" (no group letter), knockout R16 = "8th Finals"
//   2021+:     "Group A - N"..."Group H - N", knockout R16 = "Round of 16"
// Group membership for the older era must come from team_id lookups
// against the /standings endpoint (passed in as teamGroupMap), since the
// round string alone doesn't carry it.
function parseRound(apiRound, homeTeamId, awayTeamId, teamGroupMap) {
  if (!apiRound) return null;

  // Era 2: group letter embedded directly in the round string
  const groupMatchNew = apiRound.match(/^Group ([A-H]) - (\d+)$/i);
  if (groupMatchNew) {
    return {
      kind: 'group',
      group: groupMatchNew[1],
      matchday: parseInt(groupMatchNew[2], 10),
      tabKey: `group-${groupMatchNew[1].toLowerCase()}`,
    };
  }

  // Era 1: "Group Stage - N", group letter must come from teamGroupMap.
  // Case-insensitive: API-Sports returns "Group Stage - N" for 2015-2020
  // but "Group stage - N" (lowercase 's') for at least the 2013-14 season —
  // a strict case-sensitive match silently skips every group fixture for
  // the older year while knockout rounds (exact-case matches) still pass.
  const groupMatchOld = apiRound.match(/^Group stage - (\d+)$/i);
  if (groupMatchOld) {
    const group = teamGroupMap?.get(homeTeamId) || teamGroupMap?.get(awayTeamId);
    if (!group) return null; // can't determine group — skip rather than misfile
    return {
      kind: 'group',
      group,
      matchday: parseInt(groupMatchOld[1], 10),
      tabKey: `group-${group.toLowerCase()}`,
    };
  }

  const KNOCKOUT_MAP = {
    'round of 16':    'round-of-16',
    '8th finals':     'round-of-16', // pre-2021 label for the same round
    'quarter-finals': 'quarter-finals',
    'semi-finals':    'semi-finals',
    'final':          'final',
  };
  const knockoutKey = apiRound.toLowerCase();
  if (KNOCKOUT_MAP[knockoutKey]) {
    return { kind: 'knockout', tabKey: KNOCKOUT_MAP[knockoutKey] };
  }

  return null; // qualifying / preliminary — skip
}

// Fetches /standings for the season and builds a team_id -> group letter
// map, needed for pre-2021 seasons where the round string itself doesn't
// carry the group. Returns an empty map (not null) on any failure, so
// callers can use it unconditionally without extra null checks.
async function buildTeamGroupMap(config, callApi, season) {
  const map = new Map();
  try {
    const data = await callApi('standings', { league: config.leagueId, season });
    const groups = data?.[0]?.league?.standings || [];
    for (const group of groups) {
      for (const row of group) {
        const m = row.group?.match(/Group ([A-H])/);
        if (m && row.team?.id) map.set(row.team.id, m[1]);
      }
    }
  } catch (err) {
    console.log(`     ⚠️  Could not fetch standings for group mapping: ${err.message}`);
  }
  return map;
}

// Override map for known API-Sports ↔ countries-table name mismatches.
// Mirrors the same kind of mapping already used for player nationality
// in results.js — extend this if new mismatches surface during ingestion.
const COUNTRY_NAME_OVERRIDES = {
  'Türkiye': 'Turkey',
  'Korea Republic': 'South Korea',
  'Congo DR': 'DR Congo',
  'Cape Verde Islands': 'Cape Verde',
  'Central African Republic': 'Central African Rep.',
};

async function resolveCountryId(apiCountryName) {
  if (!apiCountryName) return null;
  const lookupName = COUNTRY_NAME_OVERRIDES[apiCountryName] || apiCountryName;
  const row = await queryOne(`SELECT id FROM countries WHERE name ILIKE $1 LIMIT 1`, [lookupName]);
  return row?.id || null;
}

async function findOrCreateClub(name, teamId, config, callApi) {
  let club = await queryOne(
    `SELECT id FROM entities WHERE entity_type = 'club' AND canonical_name ILIKE $1`,
    [name]
  );
  if (club) return club;

  club = await queryOne(
    `SELECT e.id FROM entities e
     JOIN entity_aliases ea ON ea.entity_id = e.id
     WHERE e.entity_type = 'club' AND ea.alias ILIKE $1`,
    [name]
  );
  if (club) return club;

  // New club — resolve country via /teams before inserting, so country_id
  // is set immediately rather than left NULL (the gap this fix closes).
  // Only fires for genuinely new clubs, not on every lookup, so this adds
  // at most one extra API call per club ever discovered, not per game.
  let countryId = null;
  if (teamId) {
    try {
      const teamData = await callApi('teams', { id: teamId });
      const team = teamData?.[0]?.team;
      if (team?.country) countryId = await resolveCountryId(team.country);
    } catch (err) {
      console.log(`     ⚠️  Could not resolve country for new club ${name}: ${err.message}`);
    }
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  club = await queryOne(
    `INSERT INTO entities (canonical_name, slug, entity_type, country_id, external_ids, is_active, is_verified)
     VALUES ($1, $2, 'club', $3, $4, true, false) RETURNING id`,
    [name, slug, countryId, JSON.stringify(teamId ? { api_sports: String(teamId) } : {})]
  );
  console.log(`     ➕ Created club: ${name}${countryId ? '' : ' (country unresolved)'}`);
  return club;
}

async function ingestFixtures(season, config, callApi) {
  console.log(`  ⚽ Fixtures ${season}...`);

  const data = await callApi('fixtures', { league: config.leagueId, season });
  if (!data?.length) { console.log(`     ⚠️  No fixtures`); return; }

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.competitionSlug]);
  const dbYear = season + 1;
  const seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND event_id IS NULL`,
    [comp.id, dbYear]
  );
  if (!seasonRow) throw new Error(`Season ${dbYear} not found — run 'structure' first`);

  // Preload all 12 relevant tabs (8 groups + 4 knockout) for this season
  const tabs = await queryAll(
    `SELECT id, tab_key FROM result_tabs WHERE season_id = $1 AND tab_group IN ('group_stages', 'final_tour')`,
    [seasonRow.id]
  );
  const tabByKey = Object.fromEntries(tabs.map(t => [t.tab_key, t.id]));

  // Pre-2021 seasons need a team_id -> group letter map since the round
  // string alone doesn't carry group identity for those years. Building
  // this unconditionally (cheap: one extra API call) is simpler and safer
  // than detecting which era we're in before deciding whether to fetch it.
  const teamGroupMap = await buildTeamGroupMap(config, callApi, season);

  let inserted = 0, updated = 0, skippedClub = 0, skippedRound = 0;
  let eventsCalled = 0, eventsSkippedCached = 0, eventsFailed = 0;
  const touchedGroups = new Set();
  const skippedRoundLabels = new Map(); // round string -> count, for verification

  for (const item of data) {
    const f = item.fixture;
    const teams = item.teams;
    const goals = item.goals;
    const score = item.score;
    const league = item.league;

    const parsed = parseRound(league.round, teams.home.id, teams.away.id, teamGroupMap);
    if (!parsed) {
      skippedRound++;
      skippedRoundLabels.set(league.round, (skippedRoundLabels.get(league.round) || 0) + 1);
      continue;
    }

    const tabId = tabByKey[parsed.tabKey];
    if (!tabId) {
      console.log(`     ⚠️  No result_tab found for ${parsed.tabKey} — was 'structure' run?`);
      skippedRound++;
      continue;
    }
    if (parsed.kind === 'group') touchedGroups.add(parsed.group);

    const homeEntity = await findOrCreateClub(teams.home.name, teams.home.id, config, callApi);
    const awayEntity = await findOrCreateClub(teams.away.name, teams.away.id, config, callApi);
    if (!homeEntity || !awayEntity) { skippedClub++; continue; }

    const scoreJson = {
      home: goals.home,
      away: goals.away,
      halftime: { home: score.halftime?.home, away: score.halftime?.away },
      fulltime: { home: score.fulltime?.home, away: score.fulltime?.away },
      extratime: score.extratime?.home != null
        ? { home: score.extratime.home, away: score.extratime.away } : null,
      penalty: score.penalty?.home != null
        ? { home: score.penalty.home, away: score.penalty.away } : null,
      status: f.status?.short,
    };

    let winnerId = null, homeWon = null;
    const finished = ['FT', 'AET', 'PEN'].includes(f.status?.short);
    if (finished && goals.home !== null && goals.away !== null) {
      if (goals.home > goals.away) { winnerId = homeEntity.id; homeWon = true; }
      else if (goals.away > goals.home) { winnerId = awayEntity.id; homeWon = false; }
      else if (score.penalty?.home != null) {
        if (score.penalty.home > score.penalty.away) { winnerId = homeEntity.id; homeWon = true; }
        else { winnerId = awayEntity.id; homeWon = false; }
      }
    }

    // Goal scorers come from a SEPARATE endpoint — API-Sports' /fixtures
    // response does NOT include item.events (that field is always
    // undefined here), so this must be fetched per-match. To keep this
    // a true one-time backfill (per the project's no-runtime-API-dependency
    // principle), we skip the call entirely for matches that already have
    // scorers stored — re-running 'fixtures' on an already-ingested season
    // only fetches events for matches that still need them.
    //
    // A small delay between calls plus one retry-with-backoff keeps us
    // under the API's per-minute rate limit (separate from the daily
    // quota) — without this, a tight loop of ~100+ calls in a row
    // reliably trips "Too many requests" partway through.
    let scorers = [];
    if (finished) {
      const existingScorers = await queryOne(
        `SELECT scorers FROM games WHERE result_tab_id = $1 AND match_number = $2 LIMIT 1`,
        [tabId, f.id]
      );
      const alreadyHasScorers = existingScorers?.scorers && Array.isArray(existingScorers.scorers) && existingScorers.scorers.length > 0;

      if (!alreadyHasScorers) {
        await new Promise(r => setTimeout(r, 350)); // throttle: ~170 calls/min max

        let events = null;
        try {
          events = await callApi('fixtures/events', { fixture: f.id });
          eventsCalled++;
        } catch (err) {
          const isRateLimit = err.message.includes('rateLimit') || err.message.includes('Too many requests');
          if (isRateLimit) {
            console.log(`     ⏳ Rate limited on fixture ${f.id}, waiting 5s and retrying once...`);
            await new Promise(r => setTimeout(r, 5000));
            try {
              events = await callApi('fixtures/events', { fixture: f.id });
              eventsCalled++;
            } catch (retryErr) {
              console.log(`     ⚠️  Retry failed for fixture ${f.id}: ${retryErr.message}`);
              eventsFailed++;
            }
          } else {
            console.log(`     ⚠️  Could not fetch events for fixture ${f.id}: ${err.message}`);
            eventsFailed++;
          }
        }

        if (events) {
          scorers = events
            .filter(e => e.type === 'Goal')
            .map(e => ({
              player: e.player?.name, team: e.team?.name,
              minute: e.time?.elapsed, extra: e.time?.extra || null,
              detail: e.detail, assist: e.assist?.name || null,
            }));
        }
      } else {
        eventsSkippedCached++;
        scorers = existingScorers.scorers;
      }
    }

    // Two-legged knockout ties (R16 in this era) share the same two teams
    // under the same round. leg_number disambiguates them — derived from
    // fixture date order within the tie rather than trusting any single
    // API field, since API-Sports doesn't label legs explicitly.
    let legNumber = 1;
    if (parsed.kind === 'knockout') {
      const priorLegs = await queryOne(
        `SELECT COUNT(*) AS cnt FROM games
         WHERE result_tab_id = $1 AND round = $2
           AND ((home_entity_id = $3 AND away_entity_id = $4)
             OR (home_entity_id = $4 AND away_entity_id = $3))`,
        [tabId, parsed.tabKey, homeEntity.id, awayEntity.id]
      );
      legNumber = parseInt(priorLegs.cnt, 10) + 1;
    }

    const groupName = parsed.kind === 'group' ? parsed.group : null;
    const roundLabel = parsed.kind === 'group' ? `Matchday ${parsed.matchday}` : parsed.tabKey;

    const existing = await queryOne(
      `SELECT id FROM games WHERE result_tab_id = $1 AND match_number = $2`,
      [tabId, f.id]
    );

    if (existing) {
      await query(
        `UPDATE games SET
           match_date = $1, venue = $2, venue_city = $3,
           score = $4, winner_entity_id = $5, home_won = $6,
           scorers = $7, group_name = $8, updated_at = NOW()
         WHERE id = $9`,
        [
          f.date?.split('T')[0] || null,
          f.venue?.name || null, f.venue?.city || null,
          JSON.stringify(scoreJson), winnerId, homeWon,
          JSON.stringify(scorers), groupName, existing.id,
        ]
      );
      updated++;
    } else {
      await query(
        `INSERT INTO games (
           result_tab_id, round, match_number, leg_number,
           match_date, venue, venue_city,
           home_entity_id, away_entity_id,
           home_entity_type, away_entity_type,
           score, winner_entity_id, home_won, scorers, group_name
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'club','club',$10,$11,$12,$13,$14)`,
        [
          tabId, roundLabel, f.id, legNumber,
          f.date?.split('T')[0] || null,
          f.venue?.name || null, f.venue?.city || null,
          homeEntity.id, awayEntity.id,
          JSON.stringify(scoreJson), winnerId, homeWon,
          JSON.stringify(scorers), groupName,
        ]
      );
      inserted++;
    }
  }

  console.log(`     ✅ Fixtures: ${inserted} inserted, ${updated} updated, ${skippedClub} club-skipped, ${skippedRound} round-skipped (qualifying/unmapped)`);
  console.log(`     ✅ Events API: ${eventsCalled} fetched, ${eventsSkippedCached} already cached (skipped), ${eventsFailed} failed (re-run to retry)`);
  if (skippedRoundLabels.size) {
    console.log(`     ↪ Skipped round breakdown:`);
    for (const [label, count] of skippedRoundLabels) {
      console.log(`        - "${label}": ${count}`);
    }
  }

  // Recompute standings for every group that had at least one fixture this run
  for (const group of touchedGroups) {
    const tabId = tabByKey[`group-${group.toLowerCase()}`];
    await computeGroupStandings(tabId);
  }
  if (touchedGroups.size) {
    console.log(`     ✅ Standings recomputed for groups: ${[...touchedGroups].sort().join(', ')}`);
  }
}

module.exports = { ingestFixtures, parseRound };