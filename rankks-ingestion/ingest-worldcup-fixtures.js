// ingest-worldcup-fixtures.js
// Pulls all fixtures for the World Cup 2026 season, routes each into the
// correct result_tab, computes group standings after group-stage games.
//
// Shape confirmed against live API-Sports data (league=1, season=2026),
// NOT assumed:
//   - "Group Stage - N" (N = 1..3) — group letter NOT embedded in the
//     round string (same older-style label UCL used pre-2021), so a
//     team_id -> group letter map is required, built from /standings.
//   - Knockout: "Round of 32" (16 fixtures confirmed) -> "Round of 16"
//     -> "Quarter-finals" -> "Semi-finals" -> "Final". Five rounds, one
//     more than UCL's four — Round of 32 exists here because 32 teams
//     (not 16) enter the knockout stage (12 groups x top 2 = 24, plus
//     8 best third-place = 32).
//   - Single edition only (2026) — no format-branching needed, unlike
//     ingest-ucl-fixtures.js which handles two eras. If 2014/2018/2022
//     are ever added under their own navigation pattern, this script's
//     scope stays limited to 2026 — do not extend seasons here.
//
// Entities are national_team, not club — findOrCreateNationalTeam
// replaces findOrCreateClub, resolving country via iso3 code match
// first (API-Sports team.code, e.g. "BRA") then name match with the
// same override-table pattern ucl-fixtures.js uses for country name
// mismatches.
const { queryOne, query, queryAll } = require('./db');
const { computeGroupStandings } = require('./worldcup-standings');

// Maps API-Sports round strings to our result_tabs.tab_key values.
// Anything not matched here (qualifying/playoff rounds prior to the
// tournament proper, if any appear) is intentionally skipped.
function parseRound(apiRound, homeTeamId, awayTeamId, teamGroupMap) {
  if (!apiRound) return null;

  // Group Stage - N. Group letter comes from teamGroupMap since the
  // round string itself doesn't carry it (confirmed via live data).
  const groupMatch = apiRound.match(/^Group Stage - (\d+)$/i);
  if (groupMatch) {
    const group = teamGroupMap?.get(homeTeamId) || teamGroupMap?.get(awayTeamId);
    if (!group) return null; // can't determine group — skip rather than misfile
    return {
      kind: 'group',
      group,
      matchday: parseInt(groupMatch[1], 10),
      tabKey: `group-${group.toLowerCase()}`,
    };
  }

  const KNOCKOUT_MAP = {
    'round of 32':      'round-of-32',
    'round of 16':      'round-of-16',
    '8th finals':       'round-of-16', // alternate label used in some archived seasons (e.g. 2010) — "huitièmes de finale"
    'quarter-finals':   'quarter-finals',
    'semi-finals':      'semi-finals',
    '3rd place final':  '3rd-place',
    'final':            'final',
  };
  const knockoutKey = apiRound.toLowerCase();
  if (KNOCKOUT_MAP[knockoutKey]) {
    return { kind: 'knockout', tabKey: KNOCKOUT_MAP[knockoutKey] };
  }

  return null; // qualifying / unmapped — skip
}

// Fallback group assignments for seasons where the live /standings
// endpoint returns no data (confirmed: standings coverage flag = false
// for 2010 and 2014 — verified via check-worldcup-2010-standings.js
// returning an empty response, not just an unreliable flag). Derived by
// clustering fixture team-ID pairings into connected groups of 4 (teams
// that played each other in the group stage are provably in the same
// group — a graph-clustering problem, no guessing involved), then
// cross-checked against the real historical group letters. Keyed by
// API-Sports team ID, never by name, so there's no risk of a
// name-matching mismatch (accents, "USA" vs "United States", etc.).
const GROUP_FALLBACKS = {
  2010: {
    1531: 'A', 16: 'A', 7: 'A', 2: 'A',       // South Africa, Mexico, Uruguay, France
    17: 'B', 1117: 'B', 26: 'B', 19: 'B',      // South Korea, Greece, Argentina, Nigeria
    10: 'C', 2384: 'C', 1532: 'C', 1091: 'C',  // England, USA, Algeria, Slovenia
    14: 'D', 1504: 'D', 25: 'D', 20: 'D',      // Serbia, Ghana, Germany, Australia
    1118: 'E', 21: 'E', 12: 'E', 1530: 'E',    // Netherlands, Denmark, Japan, Cameroon
    768: 'F', 2380: 'F', 4673: 'F', 773: 'F',  // Italy, Paraguay, New Zealand, Slovakia
    1501: 'G', 27: 'G', 6: 'G', 1561: 'G',     // Ivory Coast, Portugal, Brazil, North Korea
    4672: 'H', 2383: 'H', 9: 'H', 15: 'H',     // Honduras, Chile, Spain, Switzerland
  },
  // 2014 also has standings coverage = false — verified via
  // check-worldcup-2014-groups.js, clustered the same way as 2010.
  2014: {
    6: 'A', 3: 'A', 16: 'A', 1530: 'A',        // Brazil, Croatia, Mexico, Cameroon
    9: 'B', 1118: 'B', 2383: 'B', 20: 'B',     // Spain, Netherlands, Chile, Australia
    8: 'C', 1117: 'C', 12: 'C', 1501: 'C',     // Colombia, Greece, Japan, Ivory Coast
    7: 'D', 29: 'D', 10: 'D', 768: 'D',        // Uruguay, Costa Rica, England, Italy
    15: 'E', 2382: 'E', 2: 'E', 4672: 'E',     // Switzerland, Ecuador, France, Honduras
    26: 'F', 1113: 'F', 22: 'F', 19: 'F',      // Argentina, Bosnia & Herzegovina, Iran, Nigeria
    25: 'G', 27: 'G', 1504: 'G', 2384: 'G',    // Germany, Portugal, Ghana, USA
    1: 'H', 1532: 'H', 4: 'H', 17: 'H',        // Belgium, Algeria, Russia, South Korea
  },
};

// Fetches /standings for the season and builds a team_id -> group letter
// map. Same principle as ucl-fixtures.js's buildTeamGroupMap, extended
// to 12 groups (A-L) instead of 8 (A-H). Returns an empty map (not null)
// on any failure, so callers can use it unconditionally.
async function buildTeamGroupMap(config, callApi, season) {
  const map = new Map();
  try {
    const data = await callApi('standings', { league: config.leagueId, season });
    const groups = data?.[0]?.league?.standings || [];
    for (const group of groups) {
      for (const row of group) {
        const m = row.group?.match(/Group ([A-L])/);
        if (m && row.team?.id) map.set(row.team.id, m[1]);
      }
    }
  } catch (err) {
    console.log(`     ⚠️  Could not fetch standings for group mapping: ${err.message}`);
  }

  // Live API returned nothing — fall back to a verified team-ID-based
  // map for seasons where that's known to happen (2010 confirmed; add
  // more years to GROUP_FALLBACKS above as they're discovered).
  if (map.size === 0 && GROUP_FALLBACKS[season]) {
    console.log(`     ↪ No live standings data for group mapping — using verified fallback for season ${season}`);
    for (const [teamId, group] of Object.entries(GROUP_FALLBACKS[season])) {
      map.set(parseInt(teamId), group);
    }
  }

  return map;
}

// Same override pattern as ucl-fixtures.js — extend here if new
// World Cup-specific mismatches surface during ingestion (national team
// names sometimes differ from club-context country names, e.g. "IR Iran"
// vs "Iran", "USA" vs "United States").
const COUNTRY_NAME_OVERRIDES = {
  'Türkiye': 'Turkey',
  'Korea Republic': 'South Korea',
  'Congo DR': 'DR Congo',
  'Cape Verde Islands': 'Cape Verde',
  'Central African Republic': 'Central African Rep.',
  'IR Iran': 'Iran',
  'USA': 'United States',
};

// Tries iso3 code match first (API-Sports team.code, e.g. "BRA"), falls
// back to name match with the override table. iso3 is more reliable
// than name for national teams since API-Sports naming occasionally
// diverges from the countries table's canonical name.
async function resolveCountryId(apiCountryName, apiCode) {
  if (apiCode) {
    const byCode = await queryOne(`SELECT id FROM countries WHERE iso3 ILIKE $1 LIMIT 1`, [apiCode]);
    if (byCode) return byCode.id;
  }
  if (!apiCountryName) return null;
  const lookupName = COUNTRY_NAME_OVERRIDES[apiCountryName] || apiCountryName;
  const row = await queryOne(`SELECT id FROM countries WHERE name ILIKE $1 LIMIT 1`, [lookupName]);
  return row?.id || null;
}

async function findOrCreateNationalTeam(name, teamId, config, callApi) {
  let team = await queryOne(
    `SELECT id FROM entities WHERE entity_type = 'national_team' AND canonical_name ILIKE $1`,
    [name]
  );
  if (team) return team;

  team = await queryOne(
    `SELECT e.id FROM entities e
     JOIN entity_aliases ea ON ea.entity_id = e.id
     WHERE e.entity_type = 'national_team' AND ea.alias ILIKE $1`,
    [name]
  );
  if (team) return team;

  // New national team — resolve country via /teams before inserting.
  let countryId = null;
  let apiCode = null;
  if (teamId) {
    try {
      const teamData = await callApi('teams', { id: teamId });
      const t = teamData?.[0]?.team;
      apiCode = t?.code || null;
      countryId = await resolveCountryId(t?.country || name, apiCode);
    } catch (err) {
      console.log(`     ⚠️  Could not resolve country for new national team ${name}: ${err.message}`);
    }
  }
  if (!countryId) {
    // Fallback: try resolving directly off the team name itself, since
    // for national teams name and country are usually identical.
    countryId = await resolveCountryId(name, apiCode);
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  team = await queryOne(
    `INSERT INTO entities (canonical_name, slug, entity_type, country_id, external_ids, is_active, is_verified)
     VALUES ($1, $2, 'national_team', $3, $4, true, false) RETURNING id`,
    [name, slug, countryId, JSON.stringify(teamId ? { api_sports: String(teamId) } : {})]
  );
  console.log(`     ➕ Created national team: ${name}${countryId ? '' : ' (country unresolved)'}`);
  return team;
}

async function ingestFixtures(season, config, callApi) {
  console.log(`  ⚽ Fixtures ${season}...`);

  const data = await callApi('fixtures', { league: config.leagueId, season });
  if (!data?.length) { console.log(`     ⚠️  No fixtures`); return; }

  const comp = await queryOne(`SELECT id FROM competitions WHERE slug = $1`, [config.competitionSlug]);
  if (!comp) throw new Error(`Competition not found: ${config.competitionSlug}`);

  const dbYear = season; // year_convention = 'start' — no offset
  const seasonRow = await queryOne(
    `SELECT id FROM seasons WHERE competition_id = $1 AND year = $2 AND event_id IS NULL`,
    [comp.id, dbYear]
  );
  if (!seasonRow) throw new Error(`Season ${dbYear} not found — run 'structure' first`);

  const tabs = await queryAll(
    `SELECT id, tab_key FROM result_tabs WHERE season_id = $1 AND tab_group IN ('group_stages', 'final_tour')`,
    [seasonRow.id]
  );
  const tabByKey = Object.fromEntries(tabs.map(t => [t.tab_key, t.id]));

  const teamGroupMap = await buildTeamGroupMap(config, callApi, season);

  let inserted = 0, updated = 0, skippedTeam = 0, skippedRound = 0;
  let eventsCalled = 0, eventsSkippedCached = 0, eventsFailed = 0;
  const touchedGroups = new Set();
  const skippedRoundLabels = new Map();

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

    const homeEntity = await findOrCreateNationalTeam(teams.home.name, teams.home.id, config, callApi);
    const awayEntity = await findOrCreateNationalTeam(teams.away.name, teams.away.id, config, callApi);
    if (!homeEntity || !awayEntity) { skippedTeam++; continue; }

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

    // Goal scorers from a separate endpoint, same throttle/retry pattern
    // as ucl-fixtures.js. Only fetched for matches that don't already
    // have scorers stored, so re-running is cheap.
    let scorers = [];
    if (finished) {
      const existingScorers = await queryOne(
        `SELECT scorers FROM games WHERE result_tab_id = $1 AND match_number = $2 LIMIT 1`,
        [tabId, f.id]
      );
      const alreadyHasScorers = existingScorers?.scorers && Array.isArray(existingScorers.scorers) && existingScorers.scorers.length > 0;

      if (!alreadyHasScorers) {
        await new Promise(r => setTimeout(r, 350));

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

    // Knockout stage is single-match (no two-legged ties in World Cup
    // format), so legNumber is always 1 in practice — logic kept for
    // schema consistency with UCL and future-proofing, harmless no-op
    // here since priorLegs will always be 0.
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
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'national_team','national_team',$10,$11,$12,$13,$14)`,
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

  console.log(`     ✅ Fixtures: ${inserted} inserted, ${updated} updated, ${skippedTeam} team-skipped, ${skippedRound} round-skipped (qualifying/unmapped)`);
  console.log(`     ✅ Events API: ${eventsCalled} fetched, ${eventsSkippedCached} already cached (skipped), ${eventsFailed} failed (re-run to retry)`);
  if (skippedRoundLabels.size) {
    console.log(`     ↪ Skipped round breakdown:`);
    for (const [label, count] of skippedRoundLabels) {
      console.log(`        - "${label}": ${count}`);
    }
  }

  for (const group of touchedGroups) {
    const tabId = tabByKey[`group-${group.toLowerCase()}`];
    await computeGroupStandings(tabId);
  }
  if (touchedGroups.size) {
    console.log(`     ✅ Standings recomputed for groups: ${[...touchedGroups].sort().join(', ')}`);
  }
}

module.exports = { ingestFixtures, parseRound };