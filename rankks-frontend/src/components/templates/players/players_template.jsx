import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import SearchableSelect from '../../shared/SearchableSelect'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import { basketballSubtitleParams } from '../../../utils/basketballSubtitleMap'
import { getPositionCode } from '../../../utils/positionCode'
import styles from './players_template.module.css'

const PAGE_SIZE = 25

// Award-voting tabs (NBA MVP/DPOY/6MOY/MIP/ROY/Finals MVP) all share the same
// candidate-list shape — one result_tab per award, ranked by vote share —
// so they reuse one column set rather than repeating it per award. Box-score
// columns (FGM/3PM/FTM/Ast/Reb/Blk) are pulled from the player's Regular
// Season row (see ingest-nba-awards.js's getRegularSeasonStats) since Award
// Shares itself has no box-score data. Share is a sub-value under Pts Won
// rather than its own column.
const AWARD_COLS = [
  { key: 'games_played',      label: 'GP/Min', subKeyRaw: 'minutes' },
  { key: 'points',            label: 'Pts', bold: true },
  { key: 'fgm',               label: 'FGM', subKey: 'fg_pct' },
  { key: 'tpm',               label: '3PM', subKey: 'tp_pct' },
  { key: 'ftm',               label: 'FTM', subKey: 'ft_pct' },
  { key: 'assists',           label: 'Ast' },
  { key: 'rebounds',          label: 'Reb' },
  { key: 'blocks',            label: 'Blk' },
  { key: 'pts_won',           label: 'Pts Won', subKey: 'share', bold: true },
  { key: 'first_place_votes', label: '1st Votes' },
]

// End of Season Teams (All-NBA/All-Defense) — same shape as AWARD_COLS,
// vote-count column differs (three team tiers instead of one first-place count).
const EOST_COLS = [
  { key: 'games_played',     label: 'GP/Min', subKeyRaw: 'minutes' },
  { key: 'points',           label: 'Pts', bold: true },
  { key: 'fgm',              label: 'FGM', subKey: 'fg_pct' },
  { key: 'tpm',              label: '3PM', subKey: 'tp_pct' },
  { key: 'ftm',              label: 'FTM', subKey: 'ft_pct' },
  { key: 'assists',          label: 'Ast' },
  { key: 'rebounds',         label: 'Reb' },
  { key: 'blocks',           label: 'Blk' },
  { key: 'pts_won',          label: 'Pts Won', subKey: 'share', bold: true },
]

// All-NBA 1st Team specifically has meaningful "1st Team Votes" data (a
// unanimous selection shows e.g. 100/100) unlike lower tiers where it's
// always near-zero — merged into the Pts Won column as a second line
// instead of its own column. Other EOST tiers just drop the column
// entirely (see EOST_COLS above, which no longer carries it at all).
const EOST_COLS_1ST = EOST_COLS.map(c =>
  c.key === 'pts_won' ? { ...c, subKey: undefined, subKeyRaw: 'first_team_votes' } : c
)

// NBA Cup Teams (All-Tournament Team) — same box-score columns as EOST_COLS,
// minus Pts Won/1st Team Votes: no vote-share data exists for this honor
// (never published, unlike All-NBA/All-Defense's real balloting), so those
// two columns would just be permanently empty here.
const NBA_CUP_TEAM_COLS = EOST_COLS.filter(c => c.key !== 'pts_won' && c.key !== 'first_team_votes')

// NBA Cup MVP — same as AWARD_COLS minus Pts Won/1st Votes, for the
// identical reason: no vote-share data exists for this award.
const NBA_CUP_MVP_COLS = AWARD_COLS.filter(c => c.key !== 'pts_won' && c.key !== 'first_place_votes')

// Finals MVP — same as AWARD_COLS minus Pts Won/1st Votes: it's a single
// media-panel pick per year (see ingest-nba-finals-mvp.js), not a full vote
// tally, so those two columns are always empty here.
const FINALS_MVP_COLS = AWARD_COLS.filter(c => c.key !== 'pts_won' && c.key !== 'first_place_votes')

// All-Star — same as AWARD_COLS minus Pts Won/1st Votes: this is a roster
// (who was selected, see ingest-nba-all-star.js), not a vote tally.
const ALL_STAR_COLS = AWARD_COLS.filter(c => c.key !== 'pts_won' && c.key !== 'first_place_votes')

// Regular Season's box-score stat leaders (BASK-NAV-01 page 9's Players
// Template) — per-game averages from PlayerStatisticsExtended.csv aggregation.
// Keyed separately from football's 'players' entry below since both sports
// use the same tab_key='players' but mean entirely different things by it.
const BASKETBALL_PLAYERS = {
  title:   'Players',
  description: (comp, season) => `The table shows the ${comp} players for the ${season} season.`,
  sortKey: 'points',
  cols: [
    { key: 'games_played', label: 'GP/Min', subKeyRaw: 'minutes' },
    { key: 'points',     label: 'Pts', bold: true },
    { key: 'fgm',        label: 'FGM' },
    { key: 'fga',        label: 'FGA', subKey: 'fg_pct' },
    { key: 'tpm',        label: '3PM' },
    { key: 'tpa',        label: '3PA', subKey: 'tp_pct' },
    { key: 'ftm',        label: 'FTM' },
    { key: 'fta',        label: 'FTA', subKey: 'ft_pct' },
    { key: 'rebounds',   label: 'Reb' },
    { key: 'assists',    label: 'Ast' },
    { key: 'blocks',     label: 'Blk' },
    { key: 'turnovers',  label: 'To' },
  ],
}

// "Sort by" dropdown for basketball's Players tab — lets the user rank the
// list by any individual box-score stat, always descending (high to low).
// Points is the default sort (cfg.sortKey above) and deliberately left out
// of this list rather than duplicated as a 14th option.
// Grouped into <optgroup>s (fixed order given by product, not alphabetical
// like the flat list this replaced — FGA before FGM before FG% reads as a
// deliberate progression, not a list to re-sort). Same shape as the
// All-Time page's SORT_GROUPS, minus the Titles group (not applicable to
// a single-season page).
const BASKETBALL_SORT_GROUPS = [
  {
    label: 'Games',
    options: [
      { key: 'games_played', label: 'Games Played' },
      { key: 'minutes',      label: 'Minutes' },
    ],
  },
  {
    label: 'Shots',
    options: [
      { key: 'fga',    label: 'FGA' },
      { key: 'fgm',    label: 'FGM' },
      { key: 'fg_pct', label: 'FG%' },
      { key: 'tpa',    label: '3PA' },
      { key: 'tpm',    label: '3PM' },
      { key: 'tp_pct', label: '3P%' },
      { key: 'fta',    label: 'FTA' },
      { key: 'ftm',    label: 'FTM' },
      { key: 'ft_pct', label: 'FT%' },
    ],
  },
  {
    label: 'Others',
    options: [
      { key: 'assists',   label: 'Assists' },
      { key: 'blocks',    label: 'Blocks' },
      { key: 'steals',    label: 'Steals' },
      { key: 'turnovers', label: 'Turnovers' },
    ],
  },
]

// Football's Scorers/Passers/Players tabs now share one fixed column set
// and layout (Goals, Assists, Played, Mins, always in that order) — only
// the default SORT differs per mode (see FOOTBALL_DEFAULT_SORT below), and
// the "primary" column is shown via the dynamic highlight (isFootballUnified
// below), not by reordering or a static bold flag like basketball's cols.
const FOOTBALL_STAT_COLS = [
  { key: 'goals',        label: 'Goals' },
  { key: 'assists',      label: 'Assists' },
  { key: 'games_played', label: 'Played' },
  { key: 'minutes',      label: 'Mins' },
]
const FOOTBALL_SORT_OPTIONS = [
  { key: 'goals',        label: 'Goals' },
  { key: 'assists',      label: 'Assists' },
  { key: 'games_played', label: 'Games Played' },
]
// Cascading tiebreak order for each mode's default (no explicit "Sort by"
// chosen) sort — Mohamed's spec: Scorers/Players rank by Goals first, then
// Assists, then Games Played; Passers ranks by Assists first, then Goals,
// then Games Played. The first key also drives the "Sort by:" dropdown's
// own placeholder label (see effectiveSortStat below) — no longer
// column bold/highlight, both removed 2026-08-13.
const FOOTBALL_DEFAULT_SORT = {
  scorers: ['goals', 'assists', 'games_played'],
  players: ['goals', 'assists', 'games_played'],
  passers: ['assists', 'goals', 'games_played'],
}

// Football's Scorers/Passers/Players tabs are real catalog rows in the
// Subtitles admin (item_a exactly matches the mode, capitalized, no
// item_b) — resolved live below instead of a hardcoded map, so admin
// edits actually reach the page.
const FOOTBALL_ITEM_A = {
  scorers: 'Scorers',
  passers: 'Passers',
  players: 'Players',
}

const MODES = {
  scorers: {
    title:   'Top Scorers',
    description: (comp, season) => `The table shows the ${comp} top scorers for the ${season} season.`,
    sortKey: 'goals',
    cols: FOOTBALL_STAT_COLS,
  },
  passers: {
    title:   'Assist Leaders',
    description: (comp, season) => `The table shows the ${comp} assist leaders for the ${season} season.`,
    sortKey: 'assists',
    cols: FOOTBALL_STAT_COLS,
  },
  players: {
    title:   'Player list',
    description: (comp, season) => `The table shows the ${comp} players for the ${season} season.`,
    sortKey: 'goals',
    cols: FOOTBALL_STAT_COLS,
  },
  // sortKey is pts_won, not share: share is pts_won/pts_max, which only some
  // ingestion sources provide (the manually-compiled 2025/26 sheet doesn't,
  // so it's left null there) — pts_won is always present and monotonic with
  // share within one balloting, so it ranks candidates identically.
  mvp:         { title: 'MVP',        description: (comp, season) => `The table shows the ${comp} MVP voting for the ${season} season.`,        sortKey: 'pts_won', cols: AWARD_COLS },
  'finals-mvp': { title: 'Finals MVP', description: (comp, season) => `The table shows the ${comp} Finals MVP voting for the ${season} season.`, sortKey: 'pts_won', cols: FINALS_MVP_COLS },
  dpoy:        { title: 'DPOY',       description: (comp, season) => `The table shows the ${comp} Defensive Player of the Year voting for the ${season} season.`, sortKey: 'pts_won', cols: AWARD_COLS },
  smoy:        { title: '6MOY',       description: (comp, season) => `The table shows the ${comp} Sixth Man of the Year voting for the ${season} season.`,        sortKey: 'pts_won', cols: AWARD_COLS },
  mip:         { title: 'MIP',        description: (comp, season) => `The table shows the ${comp} Most Improved Player voting for the ${season} season.`,          sortKey: 'pts_won', cols: AWARD_COLS },
  roy:         { title: 'ROY',        description: (comp, season) => `The table shows the ${comp} Rookie of the Year voting for the ${season} season.`,            sortKey: 'pts_won', cols: AWARD_COLS },
  'all-nba-1st':     { title: 'All NBA 1st',     description: (comp, season) => `The table shows the ${comp} All-NBA 1st Team voting for the ${season} season.`,     sortKey: 'pts_won', cols: EOST_COLS_1ST },
  'all-nba-2nd':     { title: 'All NBA 2nd',     description: (comp, season) => `The table shows the ${comp} All-NBA 2nd Team voting for the ${season} season.`,     sortKey: 'pts_won', cols: EOST_COLS },
  'all-nba-3rd':     { title: 'All NBA 3rd',     description: (comp, season) => `The table shows the ${comp} All-NBA 3rd Team voting for the ${season} season.`,     sortKey: 'pts_won', cols: EOST_COLS },
  'all-defense-1st': { title: 'All Def. 1st', description: (comp, season) => `The table shows the ${comp} All-Defense 1st Team voting for the ${season} season.`, sortKey: 'pts_won', cols: EOST_COLS },
  'all-defense-2nd': { title: 'All Def. 2nd', description: (comp, season) => `The table shows the ${comp} All-Defense 2nd Team voting for the ${season} season.`, sortKey: 'pts_won', cols: EOST_COLS },
  'all-rookie-1st':  { title: 'All-Rookie 1st', description: (comp, season) => `The table shows the ${comp} All-Rookie 1st Team voting for the ${season} season.`, sortKey: 'pts_won', cols: EOST_COLS_1ST },
  'all-rookie-2nd':  { title: 'All-Rookie 2nd', description: (comp, season) => `The table shows the ${comp} All-Rookie 2nd Team voting for the ${season} season.`, sortKey: 'pts_won', cols: EOST_COLS },
  'nba-cup-mvp':   { title: 'NBA Cup MVP',   description: (comp, season) => `The table shows the ${comp} NBA Cup MVP voting for the ${season} season.`, sortKey: 'pts_won', cols: NBA_CUP_MVP_COLS },
  // The real NBA Cup All-Tournament Team is one fixed 5-player list
  // spanning both conferences (not split East/West) — see NBA_CUP_TEAM_COLS
  // above for why it drops the two vote-count columns EOST_COLS carries.
  'nba-cup-teams': { title: 'NBA Cup Team', description: (comp, season) => `The table shows the ${comp} NBA Cup All-Tournament Team for the ${season} season.`, sortKey: 'pts_won', cols: NBA_CUP_TEAM_COLS },
  // All-Star tabs (roster or MVP — 'all-star'/'eastern-conference'/
  // 'western-conference'/'mvp'/any dynamic per-team tab_key) are NOT listed
  // here — handled generically below via isAllStarEvent, since All-Star's
  // own 'mvp' tab_key would otherwise collide with this MODES.mvp entry.
}

// API-Sports returns 'Attacker' and 'Forward' for the same role
const POSITIONS_BY_SPORT = {
  football:   ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker'],
  basketball: ['PG', 'SG', 'SF', 'PF', 'C'],
}
const POS_LABEL = {
  Goalkeeper: 'Goalkeeper',
  Defender:   'Defender',
  Midfielder: 'Midfielder',
  Attacker:   'Attacker',
  Forward:    'Attacker', // API-Sports alias — displayed as Attacker
}
// Normalise position for filtering so 'Forward' matches 'Attacker' filter
function normalisePosition(pos) {
  if (!pos) return null
  return POS_LABEL[pos] || pos
}

// fg_pct/tp_pct/ft_pct are stored as decimals (0.519) — displayed as "51.9%"
function formatPct(value) {
  const n = Number(value)
  if (value == null || value === '—' || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

// Resolves entities.image_url (whatever the admin panel actually saved —
// an absolute CDN URL like NBA headshots, or a bare/relative local path)
// into a usable <img src>. Same normalisation pattern as resolveClubLogoPath below,
// but without skipping external URLs — basketball portraits are often
// genuinely external (cdn.nba.com), unlike club logos which never are.
function resolveImageUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  if (url.startsWith('media/')) return `/${url}`
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

function getName(p) { return (p.display_name || p.canonical_name || '').toLowerCase() }

// Resolve a raw logo path (club_logo or real_club_logo) into a usable
// <img src> — same normalisation as resolveImageUrl above, minus the
// external-URL passthrough (club logos are never genuinely external).
function resolveClubLogoPath(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return null // skip external
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

// Football's Club column: for a club competition, this IS the player's
// club already (club_entity_id points straight at it). For a national-team
// competition (World Cup), club_entity_id points at the country instead —
// the real domestic club (see real_club_name's own comment, results.js) is
// a separate derived field, '-' when no club-league data exists for that
// player/era (most of 1930-2006, and plenty of 2010+ players too).
function getClubDisplay(p) {
  if (p.club_entity_type === 'national_team') return p.real_club_name || null
  return p.club_name || null
}
function getClubDisplayLogo(p) {
  if (p.club_entity_type === 'national_team') return resolveClubLogoPath(p.real_club_logo)
  return resolveClubLogoPath(p.club_logo)
}

// pct fields (fg_pct/tp_pct/ft_pct) are identical in per-game and total
// views (avg(a)/avg(b) === sum(a)/sum(b)) — ingestion only stores them once,
// so 'total' mode still reads the un-prefixed key for those.
const MODE_INDEPENDENT_KEYS = new Set(['fg_pct', 'tp_pct', 'ft_pct'])

// Award-voting/EOST tabs whose box-score columns have season totals
// available — Finals MVP is deliberately excluded (permanently empty tab,
// no source data at all per ingest-nba-awards.js). All-Star tabs (fixed or
// dynamic per-team) are handled separately via isAllStarEvent, not listed
// here individually.
const STAT_MODE_TOGGLE_MODES = new Set([
  'players', 'mvp', 'dpoy', 'smoy', 'mip', 'roy',
  'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd', 'all-rookie-1st', 'all-rookie-2nd',
  'nba-cup-mvp',
])

function getValue(player, key, statMode = 'per_game') {
  if (statMode === 'total') {
    // Min/Pts on Awards tabs come from a live join to the Regular Season
    // row (results.js's regularSeasonId fallback), not a copy baked into
    // this row's own stats — total_minutes/total_points are that same
    // fallback's total-mode counterpart, resolved server-side.
    if (key === 'minutes' && player.total_minutes != null) return player.total_minutes
    if (key === 'points' && player.total_points != null) return player.total_points
    if (!MODE_INDEPENDENT_KEYS.has(key)) {
      const totalVal = player.stats?.totals?.[key]
      if (totalVal != null) return totalVal
    }
  }
  if (key === 'minutes') return player.stats?.minutes || player.minutes_played || '—'
  // Award-voting columns (share/pts_won/first_place_votes) live in the
  // free-form stats jsonb rather than as top-level player_season_stats
  // columns — falls back there for any key not found at the top level,
  // same free-form pattern used elsewhere (games.stats, standings.stats).
  if (player[key] != null) return player[key]
  return player.stats?.[key] ?? '—'
}

// AGE — unified rule (RANKKS-wide, see src/utils/calcAge.js): age is
// computed as of the season's real end_date, not a raw year subtraction.
// Requires the parent (ContentArea.jsx) to pass the season's end_date
// down as `endDate` — already wired in ContentArea.jsx's players branch.
export default function ScorersTemplate({ seasonId, tabKey, tabName, mode = 'scorers', sport = 'football', activeEvent, isPast, endDate, competitionSlug }) {
  const POSITIONS = POSITIONS_BY_SPORT[sport] || POSITIONS_BY_SPORT.football
  const { activeYear } = useAppStore()
  const [allPlayers, setAllPlayers] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [position, setPosition]     = useState('')
  const [club, setClub]             = useState('')
  const [country, setCountry]       = useState('')
  const [page, setPage]             = useState(1)
  const [sortStat, setSortStat]     = useState('')
  const [statMode, setStatMode]     = useState('per_game')
  const [seasonType, setSeasonType] = useState('regular')
  const [pageSubtitle, setPageSubtitle] = useState(null)
  const [basketballSubtitle, setBasketballSubtitle] = useState(null)

  // Admin-configured subtitle line (rankks-admin's Subtitles page) —
  // football's Scorers/Passers/Players only.
  const isFootballUnified = sport === 'football' && (mode === 'scorers' || mode === 'passers' || mode === 'players')
  useEffect(() => {
    if (!isFootballUnified || !competitionSlug || !activeYear) { setPageSubtitle(null); return }
    api.getSubtitle('football', competitionSlug, FOOTBALL_ITEM_A[mode], null, activeYear)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [isFootballUnified, competitionSlug, mode, activeYear])

  // Admin-configured subtitle line (rankks-admin's Subtitles page) —
  // basketball. Only one competition (NBA) exists for this sport, so it
  // resolves sport-wide rather than needing a competitionSlug.
  useEffect(() => {
    if (sport !== 'basketball') { setBasketballSubtitle(null); return }
    const p = basketballSubtitleParams(activeEvent, tabKey, activeYear, isPast)
    if (!p) { setBasketballSubtitle(null); return }
    api.getSubtitle('basketball', null, p.itemA, p.itemB, p.year, p.isPast)
      .then(d => setBasketballSubtitle(d?.subtitle || null))
      .catch(() => setBasketballSubtitle(null))
  }, [sport, activeEvent, tabKey, activeYear, isPast])

  // All-Star's tab_key varies every year (fixed 'eastern-conference'/
  // 'western-conference' for conference-format years, a dynamic per-team
  // slug like 'team-lebron' for captain-picked/tournament years — see
  // ingest-nba-all-star.js) — detected via activeEvent (stable across every
  // year) rather than an exhaustive tab_key list, so new team names in
  // future seasons need no code change here.
  const isAllStarEvent = sport === 'basketball' && !!activeEvent?.startsWith('all-star')

  // Same tab set as the Per Game/Total toggle (STAT_MODE_TOGGLE_MODES) —
  // Regular Season Players plus every Award/EOST tab with Playoffs box
  // scores available.
  const showSeasonTypeToggle = sport === 'basketball' && (STAT_MODE_TOGGLE_MODES.has(mode) || isAllStarEvent)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllPlayers([])
    api.getPlayers(seasonId, tabKey, showSeasonTypeToggle ? seasonType : undefined)
      .then(d => setAllPlayers(d?.players || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId, tabKey, showSeasonTypeToggle, seasonType])

  useEffect(() => {
    setSearch(''); setPosition(''); setClub(''); setCountry(''); setPage(1); setSortStat(''); setStatMode('per_game'); setSeasonType('regular')
  }, [mode])

  useEffect(() => { setPage(1) }, [search, position, club, country])

  // Checked before MODES[mode] (not after) — All-Star's own MVP tab reuses
  // tab_key='mvp', which would otherwise collide with Awards' regular
  // MODES.mvp entry (real vote-share columns that don't apply here; this
  // tab's MVP is a single winner, see ingest-nba-all-star-results.js).
  const cfg = (sport === 'basketball' && mode === 'players')
    ? BASKETBALL_PLAYERS
    : isAllStarEvent
      ? { title: tabName || 'All-Star', description: (comp, season) => `The table shows the ${comp} ${tabName || 'All-Star'} for the ${season} season.`, sortKey: null, cols: ALL_STAR_COLS }
      : (MODES[mode] || MODES.scorers)

  // Football's Scorers/Passers/Players tabs share one unified layout —
  // Position/Club/Country always shown as 3 independent filters (no more
  // merging Club into Country for national-team competitions: Club now
  // means the player's real domestic club, a genuinely different thing
  // from Country, see getClubDisplay above), plus the Goals/Assists/Played
  // "Sort by" dropdown and cascading default sort (FOOTBALL_DEFAULT_SORT).
  // (isFootballUnified itself is declared above, alongside the subtitle fetch.)

  // Faceted filter options: each dropdown's option list (and count) reflects
  // every OTHER active filter but never its own current selection —
  // selecting PSG should narrow Country to PSG's actual nationalities, but
  // the Club dropdown itself must still show every club, not just PSG, or
  // the dropdown would collapse to one option the instant it's chosen.
  const matchesSearch   = p => !search   || (p.display_name || p.canonical_name || '').toLowerCase().includes(search.toLowerCase())
  const matchesPosition = p => !position || normalisePosition(p.position) === position
  const matchesClub     = p => !club     || getClubDisplay(p) === club
  const matchesCountry  = p => !country  || p.country_name === country

  const playersForPositionOptions = allPlayers.filter(p =>
    matchesSearch(p) && matchesClub(p) && matchesCountry(p)
  )
  const playersForClubOptions = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesCountry(p)
  )
  const playersForCountryOptions = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesClub(p)
  )

  // key -> count map, used to render "Argentina (23)" style option labels.
  function countBy(list, keyFn) {
    const m = new Map()
    for (const p of list) { const k = keyFn(p); if (k) m.set(k, (m.get(k) || 0) + 1) }
    return m
  }
  const positionCounts = countBy(playersForPositionOptions, p => normalisePosition(p.position))
  const clubCounts     = countBy(playersForClubOptions,     p => getClubDisplay(p))
  const countryCounts  = countBy(playersForCountryOptions,  p => p.country_name)

  const clubs     = [...clubCounts.keys()].sort()
  const countries = [...countryCounts.keys()].sort()

  // If the currently-selected position/club/country falls out of scope
  // because of a different filter narrowing the data (e.g. searching a
  // name that no longer matches anyone at the selected club), the
  // selection itself is left as-is rather than silently reset — the
  // result list will simply show zero players with a clear "no players
  // found" state, which is more honest than guessing a replacement value.

  let players = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesClub(p) && matchesCountry(p)
  )

  // Effective sort key for both the actual sort AND the column highlight
  // (see renderTable below) — the user's explicit "Sort by" choice always
  // wins; otherwise falls back to the mode's own primary stat (first entry
  // of FOOTBALL_DEFAULT_SORT), so the highlight lands somewhere sensible
  // even before the user ever touches the dropdown.
  const effectiveSortStat = isFootballUnified ? (sortStat || FOOTBALL_DEFAULT_SORT[mode][0]) : sortStat

  if (isFootballUnified) {
    if (mode === 'scorers') players = players.filter(p => (p.goals || 0) > 0)
    if (mode === 'passers') players = players.filter(p => (p.assists || 0) > 0)

    if (sortStat) {
      // User picked a specific "Sort by" stat — single-key descending,
      // same as basketball's own sortStat behavior below.
      players = [...players].sort((a, b) => {
        const d = (Number(getValue(b, sortStat)) || 0) - (Number(getValue(a, sortStat)) || 0)
        return d !== 0 ? d : getName(a).localeCompare(getName(b))
      })
    } else {
      // Default: cascading tiebreak through the mode's 3 stats in priority order.
      const [k1, k2, k3] = FOOTBALL_DEFAULT_SORT[mode]
      players = [...players].sort((a, b) => {
        const d1 = (Number(getValue(b, k1)) || 0) - (Number(getValue(a, k1)) || 0); if (d1) return d1
        const d2 = (Number(getValue(b, k2)) || 0) - (Number(getValue(a, k2)) || 0); if (d2) return d2
        const d3 = (Number(getValue(b, k3)) || 0) - (Number(getValue(a, k3)) || 0); if (d3) return d3
        return getName(a).localeCompare(getName(b))
      })
    }
  } else if (sortStat) {
    // Basketball's "Sort by" dropdown — always descending (high to low),
    // whatever stat the user picked overrides the default points sort.
    players = [...players].sort((a, b) => {
      const d = (Number(getValue(b, sortStat, statMode)) || 0) - (Number(getValue(a, sortStat, statMode)) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else if (cfg.sortKey) {
    // Award-voting tabs (MVP/DPOY/etc.) rank by vote share, not alphabetically —
    // sortKey comes from stats jsonb via getValue's fallback, same as the cols above.
    players = [...players].sort((a, b) => {
      const d = (Number(getValue(b, cfg.sortKey, statMode)) || 0) - (Number(getValue(a, cfg.sortKey, statMode)) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    players = [...players].sort((a, b) => getName(a).localeCompare(getName(b)))
  }

  const totalPages = Math.ceil(players.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = players.slice(pageStart, pageStart + PAGE_SIZE)

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  const showSortDropdown = sport === 'basketball' && mode === 'players'
  const showStatModeToggle = sport === 'basketball' && (STAT_MODE_TOGGLE_MODES.has(mode) || isAllStarEvent)
  const hasActiveFilter = search || position || club || country || sortStat

  const renderTable = (rows, rankOffset = 0) => (
    <table className={`${styles.table} table-thead-border`}>
      <thead>
        <tr>
          <th className={styles.rank}></th>
          {/* table-label / table-label-left — global */}
          <th className={`${styles.playerH} table-label-left`}>Player</th>
          <th className={`${styles.age} table-label`}>Age</th>
          {sport !== 'basketball' && (
            <th className={`${styles.clubH} table-label-left`}>Club</th>
          )}
          {cfg.cols.map(c => (
            <th
              key={c.key}
              className={`${styles.stat} table-label ${isFootballUnified ? (sortStat === c.key ? 'sortRowsHighlight' : '') : (sortStat && (c.key === sortStat || c.subKey === sortStat || c.subKeyRaw === sortStat) ? 'sortRowsHighlight' : '')}`}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => {
          const globalRank = rankOffset + i + 1
          const clubDisplay = getClubDisplay(p)
          const clubLogo    = getClubDisplayLogo(p)
          // Display uses the 2-letter code (GK/DE/MD/AT/FW) — kept separate
          // from POS_LABEL/normalisePosition above, which still merges
          // Attacker/Forward for FILTERING only. Basketball positions
          // (PG/SG/SF/PF/C) aren't in getPositionCode's map, so they fall
          // through to the raw value unchanged, same as before.
          const posLabel   = getPositionCode(p.position) || p.position || '—'
          return (
            <tr key={p.id} className="table-row">

              {/* event-rank + rank-badge — global, weight overridden inline
                  (not by editing .event-rank itself, which is shared by
                  every other rank badge site-wide) — this page's own rule
                  (2026-08-13) is only the Name is bold; Rank/Age/Club/stats
                  are all normal weight. */}
              <td className={styles.rank}>
                <span className="event-rank rank-badge">{globalRank}</span>
              </td>

              {/* Player: avatar + name + flag + country */}
              <td>
                <div className={styles.player}>
                  <img
                    src={`/media/athletes/${sport}/male/profile/${p.slug}.png`}
                    alt={p.display_name || p.canonical_name}
                    className="avatar"
                    onError={e => {
                      // 1st failure: the conventional local slug path
                      // doesn't exist — try whatever's actually saved in
                      // entities.image_url (e.g. an admin-edited path, or
                      // NBA's CDN headshot URL).
                      const fallback = resolveImageUrl(p.image_url)
                      if (fallback && e.target.src !== fallback) {
                        e.target.src = fallback
                      // 2nd failure: neither real path worked — letter
                      // avatar (same rule as tennis's draw template),
                      // not the generic silhouette, which would just
                      // mask the missing photo instead of flagging it.
                      } else {
                        e.target.style.display = 'none'
                        e.target.nextSibling.style.display = 'flex'
                      }
                    }}
                  />
                  <div className="avatar-placeholder" style={{ display: 'none' }}>
                    {(p.display_name || p.canonical_name)?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className={styles.playerMeta}>
                    <span>
                      <span className="athlete-name">{p.display_name || p.canonical_name}</span>
                      {posLabel !== '—' && <span className="athletePosition"> - {posLabel}</span>}
                      {isAllStarEvent && p.stats?.replaced && (
                        <span className="replacement-mark" title="Injury replacement">(R)</span>
                      )}
                    </span>
                    <div className={styles.countryRow}>
                      <Flag iso2={p.country_iso2} name={p.country_name} className="flag" />
                      <span className="athlete-profile-small">{p.country_name || p.country_iso2 || '—'}</span>
                      {sport === 'basketball' && p.club_code && (
                        <span className={`athlete-profile-small ${styles.clubCode}`}>{p.club_code}</span>
                      )}
                    </div>
                  </div>
                </div>
              </td>

              {/* Age — calcAge(birth_date, endDate), the season's real
                  end_date, instead of the previous year-only subtraction */}
              <td className={styles.age} style={{ textAlign: 'center' }}>
                <div className="stat-stack">
                  <span className="stat-stack-value-light">{calcAge(p.birth_date, endDate, p.death_date) ?? '–'}</span>
                  {p.birth_date && <span className="athlete-profile-small">{fmtBirth(p.birth_date)}</span>}
                </div>
              </td>

              {/* Club — the player's real domestic club (getClubDisplay
                  above) — '-' when there's no club-league data for this
                  player/era (most of 1930-2006, and plenty of 2010+
                  players too — see results.js's real_club_name comment).
                  Basketball shows a 3-letter team code next to Country
                  instead (see the Player column above) — too many
                  players per page for a full Club column to be worth
                  the width. */}
              {sport !== 'basketball' && (
                <td>
                  <div className={styles.clubRow}>
                    {clubLogo && (
                      <img src={clubLogo} alt={clubDisplay} className={styles.clubLogo}
                        onError={e => e.target.style.display = 'none'} />
                    )}
                    <span className={styles.clubName}>{clubDisplay || '-'}</span>
                  </div>
                </td>
              )}

              {/* Stats — stats-strong / stats-light. Attempts columns
                  (FGA/3PA/FTA) show their shooting % as a sub-value
                  beneath, same stat-stack pattern as Age/birth date.
                  GP/Min uses subKeyRaw instead of subKey — Min is a plain
                  number, not a percentage, so it skips formatPct. Football's
                  3 unified modes: NO stat column is ever bold (2026-08-13:
                  "said only name CSS Strong. rank, age, club, goals =
                  NORMAL") — Name is the only strong text on this page now.
                  The grey sortRowsHighlight is still its own separate thing
                  (2026-08-13: "remove default highlighted grey"), driven by
                  the RAW sortStat with no fallback, so it only lights up
                  once the user actually picks a Sort by option. */}
              {cfg.cols.map(c => {
                const isBold = isFootballUnified
                  ? false
                  : c.bold
                const isHi = isFootballUnified
                  ? sortStat === c.key
                  : (sortStat && (c.key === sortStat || c.subKey === sortStat || c.subKeyRaw === sortStat))
                return (
                  <td
                    key={c.key}
                    className={`${styles.stat} ${isBold ? 'stats-strong' : 'stats-light'} ${isHi ? 'sortRowsHighlight' : ''}`}
                  >
                    {c.subKey ? (
                      <div className="stat-stack">
                        <span className={isBold ? 'stat-stack-value' : 'stat-stack-value-light'}>{getValue(p, c.key, statMode)}</span>
                        <span className="athlete-profile-small">{formatPct(getValue(p, c.subKey, statMode))}</span>
                      </div>
                    ) : c.subKeyRaw ? (
                      <div className="stat-stack">
                        <span className={isBold ? 'stat-stack-value' : 'stat-stack-value-light'}>{getValue(p, c.key, statMode)}</span>
                        <span className="athlete-profile-small">{getValue(p, c.subKeyRaw, statMode)}</span>
                      </div>
                    ) : getValue(p, c.key, statMode)}
                  </td>
                )
              })}
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div className={styles.wrap}>

      {basketballSubtitle && (
        <div className="page-subtitle">{basketballSubtitle}</div>
      )}
      {isFootballUnified && pageSubtitle && (
        <div className="page-subtitle">{pageSubtitle}</div>
      )}
      <PageNotice />

      {/* filter-bar — global */}
      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 160 }}
          placeholder="Search Player"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {showSeasonTypeToggle && (
          <select className="filter-label" value={seasonType} onChange={e => setSeasonType(e.target.value)}>
            <option value="regular">Regular Season</option>
            <option value="playoffs">Playoffs</option>
          </select>
        )}
        <select className="filter-label" value={position} onChange={e => setPosition(e.target.value)}>
          <option value="">All Positions</option>
          {POSITIONS.map(p => <option key={p} value={p}>{p} ({positionCounts.get(p) || 0})</option>)}
        </select>
        <SearchableSelect
          value={club}
          onChange={setClub}
          options={clubs.map(c => ({ value: c, label: `${c} (${clubCounts.get(c) || 0})` }))}
          allLabel={sport === 'basketball' ? 'All Teams' : 'All Clubs'}
        />
        <SearchableSelect
          value={country}
          onChange={setCountry}
          options={countries.map(c => ({ value: c, label: `${c} (${countryCounts.get(c) || 0})` }))}
          allLabel="All Countries"
        />
        {showSortDropdown && (
          <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
            <option value="">Sort by: Points</option>
            {BASKETBALL_SORT_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        {isFootballUnified && (
          <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
            <option value="">Sort by: {FOOTBALL_SORT_OPTIONS.find(o => o.key === effectiveSortStat)?.label}</option>
            {FOOTBALL_SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        )}
        {showStatModeToggle && (
          <div className={styles.statModeToggle}>
            <button
              type="button"
              className={`${styles.statModeBtn} ${statMode === 'per_game' ? styles.statModeBtnActive : ''}`}
              onClick={() => setStatMode('per_game')}
            >
              Per Game
            </button>
            <button
              type="button"
              className={`${styles.statModeBtn} ${statMode === 'total' ? styles.statModeBtnActive : ''}`}
              onClick={() => setStatMode('total')}
            >
              Total
            </button>
          </div>
        )}
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setPosition(''); setClub(''); setCountry(''); setSortStat('') }}>
            Clear
          </button>
        )}
        {/* filter-total — global */}
        <span className="filter-total">{players.length} players</span>
      </div>

      {players.length === 0 ? (
        <div className={`${styles.empty} empty-state`}>No players found.</div>
      ) : (
        <>
          {renderTable(pageSlice, pageStart)}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
                ‹ Prev
              </button>
              <span className="pagination-info">Page {safePage} / {totalPages}</span>
              <button className="pagination-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
                Next ›
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
