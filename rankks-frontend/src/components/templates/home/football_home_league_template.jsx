// templates/home/football_home_league_template.jsx
// Schedule tab for a round-robin football league (Ligue 1, Premier League,
// Bundesliga, La Liga, Serie A — 2026-08-25, "same rule" as World Cup/NBA's
// own Schedule tables) — every game of the browsed season in one flat,
// filterable table: dot status + Date + Matchweek + Team/Score/Team +
// Location, a Matchweek dropdown, a Team A/Team B pair (faceted against
// each other, same convention as nba_home_template.jsx's own teamA/teamB),
// aggregate All/Past/Ongoing/Next/Future status pills, defaulting to only
// Past+Next rows displayed (Mohamed 2026-08-26, correcting the same-day
// "collapse to 2 pills" attempt: "show all 4 PILLS. then content display
// rule: dont display all the games, only PAST and NEXT" — see
// DEFAULT_STATUS_FILTER's own comment), and a Leaders card
// (Champion/Most Wins/Best Attack/Best Defense/Most Assists — see the
// backend's /results/home-league-leaders/:seasonId for how each is
// computed and why Champion == standings.position 1, not a Final game).
//
// Reuses the existing /results/games/:seasonId/final_tour route (the one
// flat "Results" tab every one of these leagues seeds — see
// ingest-standings.js) rather than a new backend endpoint: that route
// groups by round server-side (games_by_round), so this just flattens it
// back out and re-sorts by match_date itself, same as every other Schedule
// table in this app already does regardless of what order its own backend
// route happens to return.
//
// Optional `tabGroup` prop (2026-08-26, UCL's own Schedule tab — "based
// upon Ligue 1 model") switches the fetch to /results/games-by-group
// instead — UCL's League Phase is 8 separate result_tabs rows (R1..R8)
// under tab_group='league_phase', not one flat tab_key, but the returned
// games_by_round/round shape is identical either way, so every filter/
// sort/label helper below works unchanged. The Leaders card is skipped
// entirely in this mode (its fetch is guarded on `!tabGroup`) — "Champion"
// there means standings.position = 1, which is meaningless for a League
// Phase table; the real trophy comes from the Final, not finishing top of
// this phase.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import SearchableSelect from '../../shared/SearchableSelect'
import ChevronIcon from '../../shared/ChevronIcon'
import { fmtDate } from '../../../utils/calcAge'
import { classifyByDate, STATUS_LABEL } from '../../../utils/eventStatus'
import f1Styles from '../f1/f1.module.css'

const STATUS_DOT_COLOR = { past: '#9e9e9e', ongoing: '#4caf52', next: '#ff8c00', upcoming: '#ffb400' }
function StatusDot({ status }) {
  return <span className={f1Styles.eventStatusDot} style={{ background: STATUS_DOT_COLOR[status] }} title={STATUS_LABEL[status]} />
}

const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

// Default visible rows: Past + Next only (Mohamed 2026-08-26: "show all 4
// PILLS. then content display rule: dont display all the games, only PAST
// and NEXT") — all 4 pills (Past/Ongoing/Next/Future) stay real, individually
// toggleable filters (classifyByDate's own real classification, not
// collapsed), but the table's OWN default — before the user touches any
// pill — only shows what already happened plus the single next fixture,
// not all ~300 games in the season including ones months away. Clicking
// "All" clears this default and shows every status; clicking "Ongoing" or
// "Future" adds those categories in on top of the default selection (same
// additive Set toggle every status pill already uses).
const DEFAULT_STATUS_FILTER = () => new Set(['past', 'next'])

const LEADER_CATEGORIES = [
  { key: 'champion', label: 'Champion', suffix: ' pts' },
  { key: 'most_wins', label: 'Most Wins' },
  { key: 'best_attack', label: 'Best Attack' },
  { key: 'best_defense', label: 'Best Defense' },
  { key: 'most_assists', label: 'Most Assists' },
]

function resolveLogo(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

// "Regular Season - 15" (API-Sports' own raw round text) -> "MW 15" — same
// trailing-number extraction the backend already uses elsewhere for round
// ordering (results.js's regexp_match(g.round, '(\d+)$')), done here
// instead so the dropdown/column label can stay a plain client-side
// derivation with no backend shape change. Anything with no trailing
// number (a relegation playoff, etc.) just falls back to its raw text.
function matchweekNumber(round) {
  const m = String(round || '').match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}
function matchweekLabel(round) {
  const n = matchweekNumber(round)
  return n != null ? `MW ${n}` : (round || '—')
}
// When roundMeta is present (merged multi-group Schedule — UCL's League
// Phase + knockout stages), each round's own label was already decided at
// merge time (see the fetch effect below) with full context of which
// group it came from — NOT re-derived here from the round text alone.
// That distinction matters: "round-of-16" ends in a number too, so
// pattern-matching it here would misread it as "MW 16" instead of
// "Round of 16" — only knowing which group a round belongs to (numbered
// League Phase vs named knockout stage) disambiguates it correctly.
function labelFor(round, roundMeta) {
  return roundMeta?.get(round)?.label ?? matchweekLabel(round)
}

const COL_WIDTH = { dot: '4%', date: '10%', matchweek: '13%', teams: '50%', location: '23%' }
const TEAM_GRID_COLS = '0.82fr 84px 1fr'

function GameRow({ r, status, roundMeta }) {
  const homeStrong = r.home_won === true
  const awayStrong = r.home_won === false
  const hasScore = r.score?.home != null && r.score?.away != null
  return (
    <tr className="table-row" style={{ verticalAlign: 'top' }}>
      <td style={{ textAlign: 'center', width: COL_WIDTH.dot, paddingTop: 6 }}>
        <StatusDot status={status} />
      </td>
      <td className="stats-light" style={{ textAlign: 'left', width: COL_WIDTH.date }}>{fmtDate(r.match_date)}</td>
      <td className="stats-light" style={{ textAlign: 'left', width: COL_WIDTH.matchweek }}>{labelFor(r.round, roundMeta)}</td>
      <td style={{ textAlign: 'left', width: COL_WIDTH.teams }}>
        <div style={{ display: 'grid', gridTemplateColumns: TEAM_GRID_COLS, alignItems: 'start', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, justifySelf: 'start', minWidth: 0 }}>
            {resolveLogo(r.home.logo) && (
              <img src={resolveLogo(r.home.logo)} alt={r.home.name} style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} onError={e => { e.target.style.display = 'none' }} />
            )}
            <span className="athlete-name" style={{ whiteSpace: 'nowrap', fontWeight: homeStrong ? 600 : 400 }}>{r.home.name}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="stats-light" style={{ padding: 0 }}>
              {hasScore ? (
                <>
                  <span style={{ fontWeight: homeStrong ? 700 : 400 }}>{r.score.home}</span>
                  {' I '}
                  <span style={{ fontWeight: awayStrong ? 700 : 400 }}>{r.score.away}</span>
                </>
              ) : 'vs'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, justifySelf: 'start', minWidth: 0 }}>
            {resolveLogo(r.away.logo) && (
              <img src={resolveLogo(r.away.logo)} alt={r.away.name} style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} onError={e => { e.target.style.display = 'none' }} />
            )}
            <span className="athlete-name" style={{ whiteSpace: 'nowrap', fontWeight: awayStrong ? 600 : 400 }}>{r.away.name}</span>
          </div>
        </div>
      </td>
      <td style={{ textAlign: 'left', width: COL_WIDTH.location }}>
        <div className="stats-light" style={{ padding: 0, textAlign: 'left' }}>{r.venue_city || '—'}</div>
        {r.venue && <div className="athlete-profile-small" style={{ textAlign: 'left' }}>{r.venue}</div>}
      </td>
    </tr>
  )
}

function GamesTable({ games, statusByGameId, sortDir, onToggleSort, roundMeta }) {
  return (
    <div className={f1Styles.tableScroll}>
      <table className={`${f1Styles.table} ${f1Styles.fixedTable} table-thead-border`}>
        <thead>
          <tr>
            <th className="table-label" style={{ width: COL_WIDTH.dot }}></th>
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.date, whiteSpace: 'nowrap' }}>
              <button
                type="button"
                className={f1Styles.sortableHeader}
                onClick={onToggleSort}
                title={sortDir === 'asc' ? 'Earliest first — click for latest first' : 'Latest first — click for earliest first'}
              >
                Date <ChevronIcon open={sortDir === 'asc'} size={10} className={f1Styles.sortArrow} />
              </button>
            </th>
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.matchweek }}>Matchweek</th>
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.teams }}>
              <div style={{ display: 'grid', gridTemplateColumns: TEAM_GRID_COLS, gap: 8 }}>
                <span style={{ justifySelf: 'start' }}>Team</span>
                <span style={{ textAlign: 'center' }}>vs</span>
                <span style={{ justifySelf: 'start' }}>Team</span>
              </div>
            </th>
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.location }}>Location</th>
          </tr>
        </thead>
        <tbody>
          {games.map(r => <GameRow key={r.id} r={r} status={statusByGameId.get(r.id)} roundMeta={roundMeta} />)}
        </tbody>
      </table>
    </div>
  )
}

export default function FootballHomeLeagueTemplate({ seasonId, competitionSlug, year, tabGroup = null }) {
  // UCL's Schedule (2026-08-26, "based upon Ligue 1 model") passes an
  // ARRAY here — ['league_phase', 'final_tour'] — to merge League Phase's
  // R1-R8 with the knockout stages into one flat table; every domestic
  // league still passes nothing (falls back to the single flat
  // /results/games/:seasonId/final_tour route below, untouched).
  const tabGroups = Array.isArray(tabGroup) ? tabGroup : (tabGroup ? [tabGroup] : null)
  // Stable primitive for the effect dependency arrays below — tabGroups
  // itself is a fresh array reference every render (recomputed above from
  // the tabGroup prop), which would otherwise refetch on every render.
  const tabGroupsKey = tabGroups ? tabGroups.join(',') : ''
  const [rows, setRows] = useState(null)
  const [roundMeta, setRoundMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [matchweekFilter, setMatchweekFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS_FILTER)
  const [sortDir, setSortDir] = useState('desc')
  const [leaders, setLeaders] = useState(null)

  useEffect(() => {
    if (!seasonId || tabGroups) return
    api.getFootballLeagueLeaders(seasonId).then(setLeaders).catch(() => setLeaders(null))
  }, [seasonId, tabGroupsKey])

  const SCHEDULE_SUBTITLE_FALLBACK = `Full Schedule and Results - ${year}`
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !year) return
    api.getSubtitle('football', competitionSlug, 'Schedule', null, year)
      .then(d => setPageSubtitle(d?.subtitle || SCHEDULE_SUBTITLE_FALLBACK))
      .catch(() => setPageSubtitle(SCHEDULE_SUBTITLE_FALLBACK))
  }, [competitionSlug, year]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    setLoading(true)

    const toRow = g => ({
      id: g.id,
      match_date: g.match_date,
      venue: g.venue,
      venue_city: g.venue_city,
      round: g.round,
      score: g.score,
      home_won: g.home_won,
      home: { name: g.home_display_name || g.home_name, logo: g.home_logo },
      away: { name: g.away_display_name || g.away_name, logo: g.away_logo },
    })

    if (tabGroups) {
      // Merge each group's games_by_round into one flat list, in the order
      // the caller listed the groups (League Phase, then the knockout
      // stages) — and build roundMeta so the Matchweek dropdown/column show
      // each stage's real name and sort in that same order, not the
      // generic "MW N" derivation (which knows nothing about named
      // knockout rounds). Every group's own rounds sort ascending by
      // display_order EXCEPT the final one — final_tour's own
      // display_order is bracket order (Final lowest, so it lists first
      // everywhere else it's used), which reads backwards for a plain
      // forward-in-time schedule; reversing just that group's internal
      // order turns it into Playoffs -> Round of 16 -> ... -> Final, the
      // actual play order, while every other (chronological-by-design)
      // group is untouched.
      Promise.all(tabGroups.map(g => api.getGamesByGroup(seasonId, g)))
        .then(responses => {
          if (cancelled) return
          const gamesByRound = {}
          const meta = new Map()
          responses.forEach((d, i) => {
            Object.assign(gamesByRound, d?.games_by_round || {})
            const isLast = i === responses.length - 1
            const ordered = [...(d?.rounds || [])].sort((a, b) =>
              isLast ? b.display_order - a.display_order : a.display_order - b.display_order
            )
            // League Phase's rounds are numbered matchweeks (R1..R8) —
            // label from the extracted number, not the DB's own terser
            // tab_name ("R1"), for consistency with every domestic
            // league's "MW N". Every other group (final_tour's named
            // knockout stages, OR Group Stages' own "Matchday N" text,
            // already human-readable as-is) uses its real tab_name — keyed
            // off the actual group name here, not array position, so
            // Group Stages (tabGroups[0] for pre-2024 seasons, same
            // position League Phase occupies for 2025/26+) doesn't
            // wrongly get the League Phase treatment (a knockout round's
            // own key can end in a number too, e.g. "round-of-16" —
            // deciding this by group, not by pattern-matching the round
            // text later, is what keeps that from being misread as
            // "MW 16").
            const isLeaguePhaseGroup = tabGroups[i] === 'league_phase'
            ordered.forEach((r, idx) => {
              const label = isLeaguePhaseGroup ? matchweekLabel(r.round) : (r.tab_name || r.round)
              meta.set(r.round, { label, order: i * 1000 + idx })
            })
          })
          setRoundMeta(meta)
          setRows(Object.values(gamesByRound).flat().map(toRow))
        })
        .catch(() => { if (!cancelled) setRows([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
      return () => { cancelled = true }
    }

    api.getGames(seasonId, 'final_tour')
      .then(d => {
        if (cancelled) return
        setRoundMeta(null)
        setRows(Object.values(d?.games_by_round || {}).flat().map(toRow))
      })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId, tabGroupsKey])

  useEffect(() => { setTeamA(''); setTeamB(''); setMatchweekFilter(''); setStatusFilter(DEFAULT_STATUS_FILTER()) }, [seasonId])

  if (loading) return <div className={f1Styles.wrap}><Skeleton /></div>
  if (!rows?.length) return <div className={f1Styles.wrap}><Empty /></div>

  // preDays: 0 — a football match is a single dated event, not a multi-day
  // weekend (classifyByDate's default 2-day-early "ongoing" window is
  // tuned for F1/MotoGP race weekends — see its own comment). Without
  // this, a match still days away read as already ONGOING (Mohamed
  // 2026-08-26).
  const statusByGameId = new Map(
    classifyByDate(rows, r => r.match_date, { preDays: 0 }).map(({ item, status }) => [item.id, status])
  )

  // A matchweek's fixtures spread across 3-4 days, so classifyByDate's own
  // "next" is just the single earliest game overall — leaving every OTHER
  // game in that same matchweek sitting in "past" (already played earlier
  // in the round) or "upcoming"/"future" (later in the round), invisible
  // under the Next pill (Mohamed 2026-08-26: "only 1 game can be displayed
  // because it corresponds to status NEXT... I want to show user all the
  // games of the NEXT matchweek"). nextRound is that single game's own
  // `round` value — matchesStatus below additionally matches the "next"
  // filter against ROUND membership, not just per-game status, so every
  // fixture in that matchweek qualifies regardless of whether it
  // individually already happened or hasn't yet. Per-game status (the row
  // dot color, and the Past/Ongoing/Future pills' own literal meaning)
  // is untouched — a Friday game already played inside the upcoming
  // matchweek still shows its real grey "past" dot, it just ALSO now
  // counts toward "Next" so the round reads as one complete group.
  const nextGame = rows.find(r => statusByGameId.get(r.id) === 'next')
  const nextRound = nextGame?.round ?? null

  // Faceted filters — each dropdown's own option list reflects every OTHER
  // active filter, never itself (Mohamed 2026-08-25: "Options are tied on
  // user selection" — same convention nba_home_template.jsx's own
  // typeOptions/teamAOptions/teamBOptions use).
  const matchesMatchweek = r => !matchweekFilter || r.round === matchweekFilter
  const matchesStatus = r => !statusFilter.size
    || statusFilter.has(statusByGameId.get(r.id))
    || (statusFilter.has('next') && nextRound != null && r.round === nextRound)
  const matchesTeam = (r, team) => !team || r.home.name === team || r.away.name === team

  const matchweekOptions = [...new Set(
    rows.filter(r => matchesStatus(r) && matchesTeam(r, teamA) && matchesTeam(r, teamB)).map(r => r.round)
  )].sort((a, b) => {
    // roundMeta's own order already encodes the full merged sequence
    // (League Phase R1..R8, then Playoffs -> ... -> Final) — use it
    // directly instead of the generic trailing-number guess below, which
    // doesn't know named knockout rounds have any order at all.
    if (roundMeta) return (roundMeta.get(a)?.order ?? 0) - (roundMeta.get(b)?.order ?? 0)
    const na = matchweekNumber(a), nb = matchweekNumber(b)
    if (na != null && nb != null) return na - nb
    if (na != null) return -1
    if (nb != null) return 1
    return String(a).localeCompare(String(b))
  })
  const teamAOptions = [...new Set(
    rows.filter(r => matchesMatchweek(r) && matchesStatus(r) && matchesTeam(r, teamB)).flatMap(r => [r.home.name, r.away.name])
  )].sort()
  const teamBOptions = [...new Set(
    rows.filter(r => matchesMatchweek(r) && matchesStatus(r) && matchesTeam(r, teamA)).flatMap(r => [r.home.name, r.away.name])
  )].sort()

  const filtered = rows
    .filter(r => matchesMatchweek(r) && matchesStatus(r) && matchesTeam(r, teamA) && matchesTeam(r, teamB))
    .sort((a, b) => {
      const cmp = new Date(b.match_date) - new Date(a.match_date)
      return sortDir === 'desc' ? cmp : -cmp
    })

  // statusFilter starts at DEFAULT_STATUS_FILTER (Past+Next), not empty —
  // "active" now means it differs from THAT baseline, not "is non-empty"
  // (an empty Set is its own distinct explicit state: the "All" pill).
  const isDefaultStatusFilter = statusFilter.size === 2 && statusFilter.has('past') && statusFilter.has('next')
  const hasActiveFilter = !!(teamA || teamB || matchweekFilter || !isDefaultStatusFilter)
  const clearFilters = () => { setTeamA(''); setTeamB(''); setMatchweekFilter(''); setStatusFilter(DEFAULT_STATUS_FILTER()) }

  const hasNonPastStatus = rows.some(r => {
    const s = statusByGameId.get(r.id)
    return s === 'ongoing' || s === 'next' || s === 'upcoming'
  })

  return (
    <div className={f1Styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      <div className="filter-bar">
        <select className="filter-label" value={matchweekFilter} onChange={e => setMatchweekFilter(e.target.value)}>
          <option value="">All Matchweeks</option>
          {matchweekOptions.map(r => <option key={r} value={r}>{labelFor(r, roundMeta)}</option>)}
        </select>
        <SearchableSelect
          value={teamA}
          onChange={setTeamA}
          options={teamAOptions.map(name => ({ value: name, label: name }))}
          allLabel="All Teams"
        />
        <span style={{ color: 'var(--text3)', fontSize: 13 }}>vs</span>
        <SearchableSelect
          value={teamB}
          onChange={setTeamB}
          options={teamBOptions.map(name => ({ value: name, label: name }))}
          allLabel="All Teams"
        />
        {hasNonPastStatus && (
          <div className={f1Styles.statusToggle}>
            <button
              type="button"
              className={`${f1Styles.statusBtn} ${statusFilter.size === 0 ? f1Styles.statusBtnActive : ''}`}
              onClick={() => setStatusFilter(new Set())}
            >
              All
            </button>
            {STATUS_ORDER.map(s => (
              <button
                key={s}
                type="button"
                className={`${f1Styles.statusBtn} ${f1Styles[`statusBtn_${s}`]} ${statusFilter.has(s) ? f1Styles.statusBtnActive : ''}`}
                onClick={() => setStatusFilter(prev => {
                  const next = new Set(prev)
                  next.has(s) ? next.delete(s) : next.add(s)
                  return next
                })}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        {hasActiveFilter && (
          <button className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{filtered.length} games</span>
      </div>

      {!hasActiveFilter && leaders && (
        <div className={f1Styles.leadersCard}>
          <div className={f1Styles.leadersTitle}>Leaders</div>
          <div className={f1Styles.leadersGrid}>
            {LEADER_CATEGORIES.map(cat => {
              const leader = leaders[cat.key]
              if (!leader) return null
              const logo = resolveLogo(leader.logo_url)
              return (
                <div key={cat.key} className={f1Styles.leaderStat}>
                  <span className={f1Styles.leaderStatLabel}>{cat.label}</span>
                  <span className={f1Styles.leaderStatSub} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {logo && (
                      <img src={logo} alt={leader.name} style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }} onError={e => { e.target.style.display = 'none' }} />
                    )}
                    {leader.name} {leader.value}{cat.suffix || ''}{leader.times_led ? ` (${leader.times_led})` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <GamesTable games={filtered} statusByGameId={statusByGameId} sortDir={sortDir} onToggleSort={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} roundMeta={roundMeta} />
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(8)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No games available.</div>
}
