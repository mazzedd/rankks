// Maps basketball's (eventSlug, tabKey) to the { itemA, itemB } pair
// api.getSubtitle needs to resolve the admin-configured subtitle text.
// This mapping (which real event/tab belongs under which catalog item)
// is app logic, not hardcoded subtitle text — the text itself lives
// 100% in rankks-admin's Subtitles page. Replaces the old
// basketballSubtitles.js, which hardcoded both the mapping AND the
// English text together.
const EVENT_KEYS = ['regular-season', 'finals', 'playoffs', 'play-in', 'nba-cup', 'all-star', 'awards', 'team-of-the-year', 'all-time']

// Event slugs carry a "-<competitionId>" suffix (e.g. "regular-season-4828").
function eventKeyFromSlug(eventSlug) {
  if (!eventSlug) return null
  return EVENT_KEYS.find(k => eventSlug.startsWith(k)) || null
}

const ITEM_A_BY_EVENT_KEY = {
  'regular-season':   'Regular Season',
  finals:             'Finals',
  playoffs:           'Playoffs',
  'play-in':          'Play-in',
  'nba-cup':          'NBA Cup',
  'all-star':         'All-Star',
  awards:             'Awards',
  'team-of-the-year': 'Team of the Year',
  'all-time':         'All-Time',
}

// item_b per tab_key, keyed by event — mirrors the real result_tabs.tab_name text.
const ITEM_B_BY_EVENT_TAB = {
  'regular-season': { standings: 'Standings', results: 'Results', players: 'Players' },
  finals: { 'nba-finals': 'NBA Finals', 'eastern-finals': 'Eastern Finals', 'western-finals': 'Western Finals' },
  playoffs: { 'eastern-conference': 'Eastern Conf.', 'western-conference': 'Western Conf.', players: 'Players' },
  'play-in': { 'eastern-conference': 'Eastern Conf.', 'western-conference': 'Western Conf.' },
  'nba-cup': { final: 'Final', rounds: 'Rounds', 'eastern-conference-groups': 'Eastern Conf. Groups', 'western-conference-groups': 'Western Conf. Groups' },
  // Captain-draft (2018-2023) and mini-tournament (2025-2026) roster tabs
  // are named per-year off the source data (team-giannis, team-lebron,
  // team-stars, etc.) — unlike the fixed conference/results/mvp tabs they
  // can't be enumerated here, so any unmatched tab_key falls through to
  // item_b=null (the event's own generic "All-Star" default row).
  'all-star': { results: 'Results', mvp: 'MVP', 'eastern-conference': 'Eastern Conf.', 'western-conference': 'Western Conf.' },
  awards: { mvp: 'MVP', 'finals-mvp': 'Finals MVP', dpoy: 'DPOY', smoy: '6MOY', mip: 'MIP', roy: 'ROY', 'nba-cup-mvp': 'NBA Cup MVP' },
  'team-of-the-year': {
    'all-nba-1st': 'All NBA 1st', 'all-nba-2nd': 'All NBA 2nd', 'all-nba-3rd': 'All NBA 3rd',
    'all-defense-1st': 'All Def. 1st', 'all-defense-2nd': 'All Def. 2nd',
    'all-rookie-1st': 'All-Rookie 1st', 'all-rookie-2nd': 'All-Rookie 2nd', 'nba-cup-teams': 'NBA Cup Team',
  },
  'all-time': {
    'all-time-players': 'Player Stats', 'all-time-teams': 'Team Stats',
    'all-time-player-awards': 'Player Awards', 'all-time-team-honours': 'Team Honours',
    'all-time-champion-history': 'Champion History',
  },
}

// Awards/All-Time have no "in progress" concept — an award isn't decided
// until the season ends, and career totals aren't tied to one season's
// progress — so isPast is never passed through for these two events.
const NO_PROGRESS_SUFFIX_EVENTS = new Set(['awards', 'all-time'])

// The NBA Cup runs within one calendar year (Oct/Nov-Dec) but the DB
// stores the season's END year (2025-26 season = year 2026) — every
// NBA-Cup-context subtitle uses year-1 to match the tournament's real
// branding (e.g. "2025 NBA Cup" per Wikipedia/NBA.com), not the season label.
function isCupContext(eventKey, tabKey) {
  return eventKey === 'nba-cup' || tabKey === 'nba-cup-mvp' || tabKey === 'nba-cup-teams'
}

// All-Time is an aggregate ("through <year>") subtitle, same convention
// as every other sport's Totals/All-Time pages.
const AGGREGATE_EVENTS = new Set(['all-time'])

/**
 * @param {string} eventSlug activeEvent (e.g. "regular-season-4828")
 * @param {string} tabKey activeTab (e.g. "standings")
 * @param {number} year display year (UI year, not stored/DB year)
 * @param {boolean} isPast season status — true for 'past', false for ongoing/future
 * @returns {{itemA: string, itemB: string|null, year: number, isPast: boolean|undefined, isTotalsStyle: boolean} | null}
 */
export function basketballSubtitleParams(eventSlug, tabKey, year, isPast) {
  const eventKey = eventKeyFromSlug(eventSlug)
  if (!eventKey) return null
  return {
    itemA: ITEM_A_BY_EVENT_KEY[eventKey],
    itemB: ITEM_B_BY_EVENT_TAB[eventKey]?.[tabKey] || null,
    year: isCupContext(eventKey, tabKey) ? year - 1 : year,
    isPast: NO_PROGRESS_SUFFIX_EVENTS.has(eventKey) ? undefined : isPast,
    isTotalsStyle: AGGREGATE_EVENTS.has(eventKey),
  }
}
