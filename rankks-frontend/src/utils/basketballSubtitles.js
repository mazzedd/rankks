// Basketball page Title/Subtitle table — verbatim from the reference nav
// spec (nba2.pdf). Keyed by event slug prefix + tab_key, since Playoffs
// and Play-in both reuse the SAME tab_keys (eastern-conference/
// western-conference) for genuinely different pages — tab_key alone
// can't disambiguate "Eastern Conference Playoffs" from "Eastern
// Conference Play-in".
//
// NOTE: `title` here only feeds EventBlock.jsx's own area-title line
// (`${kind} (${title})`) — it is NOT the content-area page's bold
// heading. That heading is sourced independently per template (e.g.
// players_template.jsx's own MODES/AWARD_COLS config, or a hardcoded
// literal in the *_all_time templates) and already matches the spec.
//
// { title, kind } — subtitle is built from `kind` + the resolved period
// phrase, format depends on the event group (see getBasketballPageText).
const TABLE = {
  'regular-season': {
    standings: { title: 'Standings', kind: 'Team Standings' },
    results:   { title: 'Results',   kind: 'Game Results' },
    players:   { title: 'Players',   kind: 'Player Stats' },
  },
  finals: {
    'nba-finals':     { title: 'NBA Finals',     kind: 'Game Results' },
    'eastern-finals':  { title: 'Eastern Finals', kind: 'Game Results' },
    'western-finals':  { title: 'Western Finals', kind: 'Game Results' },
  },
  playoffs: {
    'eastern-conference': { title: 'Eastern Conference Playoffs', kind: 'Game Results' },
    'western-conference': { title: 'Western Conference Playoffs', kind: 'Game Results' },
  },
  'play-in': {
    'eastern-conference': { title: 'Eastern Conference Play-in', kind: 'Game Results' },
    'western-conference': { title: 'Western Conference Play-in', kind: 'Game Results' },
  },
  'nba-cup': {
    final:                       { title: 'Final',                  kind: 'Game Results' },
    rounds:                      { title: 'Rounds',                 kind: 'Game Results' },
    'eastern-conference-groups': { title: 'Eastern Conf. Groups',   kind: 'Team Standings' },
    'western-conference-groups': { title: 'Western Conf. Groups',   kind: 'Team Standings' },
  },
  awards: {
    mvp:         { title: 'MVP',        kind: 'Most Valuable Player' },
    'finals-mvp': { title: 'Finals MVP', kind: 'Finals Most Valuable Player' },
    dpoy:        { title: 'DPOY',       kind: 'NBA Defensive Player of the Year' },
    smoy:        { title: '6MOY',       kind: '6th Man of the Year' },
    mip:         { title: 'MIP',        kind: 'Most Improved Player' },
    roy:         { title: 'ROY',        kind: 'NBA Rookie of the Year' },
    'all-nba-1st':     { title: 'All-NBA 1st',     kind: 'All-NBA 1st Team of the Year' },
    'all-nba-2nd':     { title: 'All-NBA 2nd',     kind: 'All-NBA 2nd Team of the Year' },
    'all-nba-3rd':     { title: 'All-NBA 3rd',     kind: 'All-NBA 3rd Team of the Year' },
    'all-defense-1st': { title: 'All-Def. 1st', kind: 'All-Defense 1st Team of the Year' },
    'all-defense-2nd': { title: 'All-Def. 2nd', kind: 'All-Defense 2nd of the Year' },
    'nba-cup-mvp':   { title: 'NBA Cup MVP',   kind: 'NBA Cup Most Valuable Player' },
    'nba-cup-teams': { title: 'All-NBA Cup Team', kind: 'All-NBA Cup Team of the Tournament' },
  },
  'all-time': {
    // `kind` is lowercase here — the All-Time subtitle format is
    // "All-Time {kind} through {year}" (e.g. "All-Time player stats
    // through 2025"), not "{kind} – {year}" like every other group.
    'all-time-players':       { title: 'Players All-Time',       kind: 'player stats' },
    'all-time-teams':         { title: 'Teams All-Time',         kind: 'team stats' },
    'all-time-player-awards': { title: 'Player Awards All-Time', kind: 'player awards' },
    'all-time-team-honours':  { title: 'Team Honours All-Time',  kind: 'team honours' },
  },
}

function eventKeyFromSlug(eventSlug) {
  if (!eventSlug) return null
  // Event slugs carry a "-<competitionId>" suffix (e.g. "regular-season-4828")
  return Object.keys(TABLE).find(k => eventSlug.startsWith(k)) || null
}

/**
 * @param {string} eventSlug  activeEvent (e.g. "regular-season-4828")
 * @param {string} tabKey     activeTab (e.g. "standings")
 * @param {number} year       display year (UI year, not stored/DB year)
 * @param {boolean} isPast    season status — true for 'past', false for ongoing/future
 * @returns {{title: string, kind: string, subtitle: string} | null}
 */
export function getBasketballPageText(eventSlug, tabKey, year, isPast) {
  const eventKey = eventKeyFromSlug(eventSlug)
  if (!eventKey) return null
  const entry = TABLE[eventKey]?.[tabKey]
  if (!entry) return null

  // The NBA Cup runs entirely within one calendar year (Oct/Nov–Dec),
  // unlike the full NBA season which spans two — our DB stores the
  // season's END year (the 2025-26 season is year=2026), but the Cup
  // itself happened in calendar year 2025 and is branded that way
  // everywhere real (Wikipedia's "2025 NBA Cup", NBA.com, etc). Every
  // NBA-Cup-specific subtitle uses year-1 so it matches the tournament's
  // real name instead of the season's end-year label.
  const isCupContext = eventKey === 'nba-cup' || tabKey === 'nba-cup-mvp' || tabKey === 'nba-cup-teams'
  const displayYear = isCupContext ? year - 1 : year

  let subtitle
  if (eventKey === 'all-time') {
    // No "ongoing" concept — all-time stats aren't tied to a single
    // season's progress, always the same phrasing regardless of status.
    // Keeps the real DB year — "through 2026" means through the 2025-26
    // season, not the Cup's own calendar-year branding.
    subtitle = `All-Time ${entry.kind} through ${year}`
  } else if (eventKey === 'awards') {
    // No "ongoing" concept either — an award isn't determined until the
    // season ends, so there's no distinct in-progress phrasing.
    subtitle = `${entry.kind} – ${displayYear}`
  } else {
    subtitle = isPast
      ? `${entry.kind} – ${displayYear}`
      : `${entry.kind} – ${displayYear} (season in progress)`
  }

  return { title: entry.title, kind: entry.kind, subtitle }
}
