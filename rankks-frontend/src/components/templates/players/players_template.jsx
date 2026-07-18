import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import { getBasketballPageText } from '../../../utils/basketballSubtitles'
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
  { key: 'games_played',      label: 'GP' },
  { key: 'minutes',           label: 'Min' },
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
  { key: 'games_played',     label: 'GP' },
  { key: 'minutes',          label: 'Min' },
  { key: 'points',           label: 'Pts', bold: true },
  { key: 'fgm',              label: 'FGM', subKey: 'fg_pct' },
  { key: 'tpm',              label: '3PM', subKey: 'tp_pct' },
  { key: 'ftm',              label: 'FTM', subKey: 'ft_pct' },
  { key: 'assists',          label: 'Ast' },
  { key: 'rebounds',         label: 'Reb' },
  { key: 'blocks',           label: 'Blk' },
  { key: 'pts_won',          label: 'Pts Won', subKey: 'share', bold: true },
  { key: 'first_team_votes', label: '1st Team Votes' },
]

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

// Regular Season's box-score stat leaders (BASK-NAV-01 page 9's Players
// Template) — per-game averages from PlayerStatisticsExtended.csv aggregation.
// Keyed separately from football's 'players' entry below since both sports
// use the same tab_key='players' but mean entirely different things by it.
const BASKETBALL_PLAYERS = {
  title:   'Players',
  description: (comp, season) => `The table shows the ${comp} players for the ${season} season.`,
  sortKey: 'points',
  cols: [
    { key: 'games_played', label: 'GP' },
    { key: 'minutes',    label: 'Min' },
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
const BASKETBALL_SORT_OPTIONS = [
  { key: 'games_played', label: 'GP' },
  { key: 'minutes',      label: 'Min' },
  { key: 'fgm',        label: 'FGM' },
  { key: 'fga',        label: 'FGA' },
  { key: 'fg_pct',     label: 'FG%' },
  { key: 'tpm',        label: '3PM' },
  { key: 'tpa',        label: '3PA' },
  { key: 'tp_pct',     label: '3P%' },
  { key: 'ftm',        label: 'FTM' },
  { key: 'fta',        label: 'FTA' },
  { key: 'ft_pct',     label: 'FT%' },
  { key: 'rebounds',   label: 'Rebounds' },
  { key: 'assists',    label: 'Assists' },
  { key: 'blocks',     label: 'Blocks' },
  { key: 'turnovers',  label: 'Turnovers' },
].sort((a, b) => a.label.localeCompare(b.label))

const MODES = {
  scorers: {
    title:   'Top Scorers',
    description: (comp, season) => `The table shows the ${comp} top scorers for the ${season} season.`,
    sortKey: 'goals',
    cols: [
      { key: 'goals',        label: 'Goals',   bold: true },
      { key: 'assists',      label: 'Assists' },
      { key: 'games_played', label: 'Apps' },
      { key: 'minutes',      label: 'Mins' },
    ],
  },
  passers: {
    title:   'Assist Leaders',
    description: (comp, season) => `The table shows the ${comp} assist leaders for the ${season} season.`,
    sortKey: 'assists',
    cols: [
      { key: 'assists',      label: 'Assists', bold: true },
      { key: 'goals',        label: 'Goals' },
      { key: 'games_played', label: 'Apps' },
      { key: 'minutes',      label: 'Mins' },
    ],
  },
  players: {
    title:   'Player list',
    description: (comp, season) => `The table shows the ${comp} players for the ${season} season.`,
    sortKey: null,
    cols: [
      { key: 'games_played', label: 'Apps',    bold: true },
      { key: 'goals',        label: 'Goals' },
      { key: 'assists',      label: 'Assists' },
      { key: 'yellow_cards', label: '🟨' },
      { key: 'red_cards',    label: '🟥' },
    ],
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
  'all-nba-1st':     { title: 'All-NBA 1st',     description: (comp, season) => `The table shows the ${comp} All-NBA 1st Team voting for the ${season} season.`,     sortKey: 'pts_won', cols: EOST_COLS },
  'all-nba-2nd':     { title: 'All-NBA 2nd',     description: (comp, season) => `The table shows the ${comp} All-NBA 2nd Team voting for the ${season} season.`,     sortKey: 'pts_won', cols: EOST_COLS },
  'all-nba-3rd':     { title: 'All-NBA 3rd',     description: (comp, season) => `The table shows the ${comp} All-NBA 3rd Team voting for the ${season} season.`,     sortKey: 'pts_won', cols: EOST_COLS },
  'all-defense-1st': { title: 'All-Defense 1st', description: (comp, season) => `The table shows the ${comp} All-Defense 1st Team voting for the ${season} season.`, sortKey: 'pts_won', cols: EOST_COLS },
  'all-defense-2nd': { title: 'All-Defense 2nd', description: (comp, season) => `The table shows the ${comp} All-Defense 2nd Team voting for the ${season} season.`, sortKey: 'pts_won', cols: EOST_COLS },
  'nba-cup-mvp':   { title: 'NBA Cup MVP',   description: (comp, season) => `The table shows the ${comp} NBA Cup MVP voting for the ${season} season.`, sortKey: 'pts_won', cols: NBA_CUP_MVP_COLS },
  // The real NBA Cup All-Tournament Team is one fixed 5-player list
  // spanning both conferences (not split East/West) — see NBA_CUP_TEAM_COLS
  // above for why it drops the two vote-count columns EOST_COLS carries.
  'nba-cup-teams': { title: 'All-NBA Cup Team', description: (comp, season) => `The table shows the ${comp} NBA Cup All-Tournament Team for the ${season} season.`, sortKey: 'pts_won', cols: NBA_CUP_TEAM_COLS },
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
// into a usable <img src>. Same normalisation pattern as getClubLogo below,
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

// Resolve club logo — use API field if present. No more name-based slug
// guessing as a fallback: that broke for national teams (World Cup),
// where club_name is the country itself ("Tunisia") and no such club
// logo file exists. Same iso2 convention used everywhere else in the
// app now applies here too — when there's no explicit club_logo, the
// Club column falls back to the player's country flag via <Flag>
// (rendered in the JSX below, using country_iso2), rather than this
// function guessing a path that may not exist.
function getClubLogo(p) {
  if (p.club_logo) {
    if (p.club_logo.startsWith('http://') || p.club_logo.startsWith('https://')) return null // skip external
    if (p.club_logo.startsWith('/media/')) return p.club_logo
    if (p.club_logo.startsWith('/')) return `/media${p.club_logo}`
    return `/media/${p.club_logo}`
  }
  return null
}

// pct fields (fg_pct/tp_pct/ft_pct) are identical in per-game and total
// views (avg(a)/avg(b) === sum(a)/sum(b)) — ingestion only stores them once,
// so 'total' mode still reads the un-prefixed key for those.
const MODE_INDEPENDENT_KEYS = new Set(['fg_pct', 'tp_pct', 'ft_pct'])

// Award-voting/EOST tabs whose box-score columns have season totals
// available — Finals MVP is deliberately excluded (permanently empty tab,
// no source data at all per ingest-nba-awards.js).
const STAT_MODE_TOGGLE_MODES = new Set([
  'players', 'mvp', 'dpoy', 'smoy', 'mip', 'roy',
  'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd',
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

// Format year as "2022-2023" for end-year convention, or just "2023"
function formatSeasonYear(year, convention) {
  if (convention === 'end') return `${year - 1}–${year}`
  return `${year}`
}

// AGE — unified rule (RANKKS-wide, see src/utils/calcAge.js): age is
// computed as of the season's real end_date, not a raw year subtraction.
// Requires the parent (ContentArea.jsx) to pass the season's end_date
// down as `endDate` — already wired in ContentArea.jsx's players branch.
export default function ScorersTemplate({ seasonId, tabKey, mode = 'scorers', sport = 'football', activeEvent, isPast, competitionName = '', yearConvention = 'end', endDate }) {
  const POSITIONS = POSITIONS_BY_SPORT[sport] || POSITIONS_BY_SPORT.football
  const { activeYear } = useAppStore()
  const seasonLabel = formatSeasonYear(activeYear, yearConvention)
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

  // Same tab set as the Per Game/Total toggle (STAT_MODE_TOGGLE_MODES) —
  // Regular Season Players plus every Award/EOST tab with Playoffs box
  // scores available.
  const showSeasonTypeToggle = sport === 'basketball' && STAT_MODE_TOGGLE_MODES.has(mode)

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

  const cfg = (sport === 'basketball' && mode === 'players') ? BASKETBALL_PLAYERS : (MODES[mode] || MODES.scorers)
  const basketballPageText = sport === 'basketball' ? getBasketballPageText(activeEvent, tabKey, activeYear, isPast) : null

  // National-team competitions (World Cup) have club_name === country_name
  // for every player — Club and Country filters would be identical, so
  // show one merged "Countries" filter instead of two redundant ones.
  // Detected via club_entity_type ('national_team' vs 'club'), a real DB
  // field rather than a name-comparison guess — same tab is always
  // homogeneous, so checking the first row is reliable.
  const isNationalTeamScope = allPlayers[0]?.club_entity_type === 'national_team'

  // Faceted filter options: each dropdown's option list reflects every
  // OTHER active filter (search, position, and the opposite club/country
  // selection) but never its own current selection — selecting PSG
  // should narrow Country to PSG's actual nationalities, but the Club
  // dropdown itself must still show every club, not just PSG, or the
  // dropdown would collapse to one option the instant it's chosen.
  const matchesSearch   = p => !search   || (p.display_name || p.canonical_name || '').toLowerCase().includes(search.toLowerCase())
  const matchesPosition = p => !position || normalisePosition(p.position) === position
  const matchesClub     = p => !club     || p.club_name === club
  const matchesCountry  = p => !country  || p.country_name === country

  const playersForClubOptions = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesCountry(p)
  )
  const playersForCountryOptions = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesClub(p)
  )

  const clubs     = [...new Set(playersForClubOptions.map(p => p.club_name).filter(Boolean))].sort()
  const countries = [...new Set(playersForCountryOptions.map(p => p.country_name).filter(Boolean))].sort()

  // If the currently-selected club/country falls out of scope because of
  // a different filter narrowing the data (e.g. searching a name that no
  // longer matches anyone at the selected club), the selection itself is
  // left as-is rather than silently reset — the result list will simply
  // show zero players with a clear "no players found" state, which is
  // more honest than guessing a replacement value.

  let players = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesClub(p) && matchesCountry(p)
  )

  if (mode === 'scorers') {
    players = [...players].filter(p => (p.goals || 0) > 0)
      .sort((a, b) => { const d = (b.goals||0)-(a.goals||0); return d !== 0 ? d : getName(a).localeCompare(getName(b)) })
  } else if (mode === 'passers') {
    players = [...players].filter(p => (p.assists || 0) > 0)
      .sort((a, b) => { const d = (b.assists||0)-(a.assists||0); return d !== 0 ? d : getName(a).localeCompare(getName(b)) })
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
  const showStatModeToggle = sport === 'basketball' && STAT_MODE_TOGGLE_MODES.has(mode)
  const hasActiveFilter = search || position || club || country || sortStat

  const renderTable = (rows, rankOffset = 0) => (
    <table className={`${styles.table} table-thead-border`}>
      <thead>
        <tr>
          <th className={styles.rank}></th>
          {/* table-label / table-label-left — global */}
          <th className={`${styles.playerH} table-label-left`}>Player</th>
          <th className={`${styles.age} table-label`}>Age</th>
          <th className={`${styles.pos} table-label`}>Position</th>
          {sport !== 'basketball' && (
            <th className={`${styles.clubH} table-label-left`}>{isNationalTeamScope ? 'Country' : 'Club'}</th>
          )}
          {cfg.cols.map(c => (
            <th
              key={c.key}
              className={`${styles.stat} table-label ${sortStat && (c.key === sortStat || c.subKey === sortStat) ? 'sorted-col' : ''}`}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((p, i) => {
          const globalRank = rankOffset + i + 1
          const clubLogo   = getClubLogo(p)
          const posLabel   = POS_LABEL[p.position] || p.position || '—'
          return (
            <tr key={p.id} className="table-row">

              {/* event-rank + rank-badge — global */}
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
                    <span className="athlete-name">{p.display_name || p.canonical_name}</span>
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
                  <span className="stat-stack-value">{calcAge(p.birth_date, endDate, p.death_date) ?? '–'}</span>
                  {p.birth_date && <span className="athlete-profile-small">{fmtBirth(p.birth_date)}</span>}
                </div>
              </td>

              {/* Position — stats-light */}
              <td className={`${styles.pos} stats-light`}>
                {posLabel}
              </td>

              {/* Club — athlete-profile. Falls back to the country
                  flag when no explicit club_logo exists (national
                  teams — World Cup — where club_name IS the country).
                  Basketball shows a 3-letter team code next to Country
                  instead (see the Player column above) — too many
                  players per page for a full Club column to be worth
                  the width. */}
              {sport !== 'basketball' && (
                <td>
                  <div className="athlete-profile">
                    {clubLogo
                      ? <img src={clubLogo} alt={p.club_name} className={styles.clubLogo}
                          onError={e => e.target.style.display = 'none'} />
                      : <Flag iso2={p.country_iso2} name={p.club_name} className="flag" />
                    }
                    <span>{p.club_name || '—'}</span>
                  </div>
                </td>
              )}

              {/* Stats — stats-strong / stats-light. Attempts columns
                  (FGA/3PA/FTA) show their shooting % as a sub-value
                  beneath, same stat-stack pattern as Age/birth date. */}
              {cfg.cols.map(c => (
                <td
                  key={c.key}
                  className={`${styles.stat} ${c.bold ? 'stats-strong' : 'stats-light'} ${sortStat && (c.key === sortStat || c.subKey === sortStat) ? 'sorted-col' : ''}`}
                >
                  {c.subKey ? (
                    <div className="stat-stack">
                      <span className={c.bold ? 'stat-stack-value' : 'stat-stack-value-light'}>{getValue(p, c.key, statMode)}</span>
                      <span className="athlete-profile-small">{formatPct(getValue(p, c.subKey, statMode))}</span>
                    </div>
                  ) : getValue(p, c.key, statMode)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div className={styles.wrap}>

      {/* page-title — global */}
      <div className="page-title">{cfg.title}</div>
      {basketballPageText && (
        <div className={styles.subtitle}>{basketballPageText.subtitle}</div>
      )}
      <PageNotice />

      {/* filter-bar — global */}
      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 160 }}
          placeholder="Search player..."
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
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="filter-label" value={club} onChange={e => setClub(e.target.value)}>
          <option value="">{isNationalTeamScope ? 'All Countries' : 'All Clubs'}</option>
          {clubs.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {!isNationalTeamScope && (
          <select className="filter-label" value={country} onChange={e => setCountry(e.target.value)}>
            <option value="">All Countries</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {showSortDropdown && (
          <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
            <option value="">Sort by: Points</option>
            {BASKETBALL_SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
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
