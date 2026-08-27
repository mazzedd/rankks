// templates/home/nba_home_template.jsx
// NBA's "Schedule" tab content (Mohamed 2026-08-26: "Home becomes
// Schedule... no more 5 blocs, all in one table" then, same day: "Schedule
// becomes a regular Line A item. Keep home button for NBA") — same flat,
// filterable single-table shape F1/MotoGP/Tennis/UFC's own Schedule pages
// use (dot status + relative-day date column, a Type dropdown, Team
// pickers, aggregate All/Past/Ongoing/Next/Future status pills),
// replacing the earlier collapsed-by-default 5-bloc/sub-bloc structure
// this file used to have (2026-08-16 build). Rendered via home_template.jsx
// (mode="schedule") for activeTab === 'schedule' — a REGULAR (non-pinned)
// Line A entry sitting among Regular Season/Finals/etc., NOT the pinned
// Home button (that stays pinned, its own separate blank-banner landing —
// see home_template.jsx/ContentArea.jsx/LineA.jsx). NBA Cup's own
// Quarterfinal/Semifinal/Championship games are folded into this one
// table too (backend's home-nba route — see its own header comment for
// why that's a deliberate second row, not a dupe).
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import SearchableSelect from '../../shared/SearchableSelect'
import ChevronIcon from '../../shared/ChevronIcon'
import { fmtDate } from '../../../utils/calcAge'
import { classifyByDate, STATUS_LABEL } from '../../../utils/eventStatus'
import f1Styles from '../f1/f1.module.css'

// Type filter options (Mohamed 2026-08-26) — labels match nbaHomeBloc's
// own bloc.label values 1:1 (results.js's /home-nba/:year route).
const TYPE_OPTIONS = ['Regular Season', 'NBA Finals', 'Conference Finals', 'Playoffs', 'Play-in', 'NBA Cup']

// "Leaders" card (Mohamed 2026-08-26: "add the Leader box after sort
// options (check F1/Moto GP)... we'll use only the default layout, no
// display when user selects option from Ddown") — same .leadersCard/
// .leadersGrid/.leaderStat shell HomeF1Template.jsx's own Leaders box
// uses, but without that box's second "selected driver" variant: this one
// only ever shows the all-time league-wide leader per category (hidden
// entirely, not swapped to a per-selection view, the moment any filter is
// active). Backed by /results/home-nba-leaders/:year — see that route's
// own comment for how each count is computed.
const LEADER_CATEGORIES = [
  { key: 'nba_champion', label: 'NBA Champion' },
  { key: 'east_champion', label: 'East Champion' },
  { key: 'west_champion', label: 'West Champion' },
  { key: 'east_standings', label: 'East Standings' },
  { key: 'west_standings', label: 'West Standings' },
  { key: 'nba_cup', label: 'NBA Cup' },
]

// Aggregate, independently-toggleable status pills (Mohamed 2026-08-26:
// "add the ALL PAST ONGOING NEXT FUTURE pills / aggregate results") — same
// F1/MotoGP/Tennis/UFC STATUS_ORDER/statusFilter Set convention
// (HomeF1Template.jsx). Empty Set already means "show everything" (see the
// filter below), so All's own job is just to reset back to that state.
const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

// Same rounded status dot every other sport's own Schedule table uses in
// place of the old text pill (HomeF1Template.jsx/HomeTennisTemplate.jsx/
// MmaEventTemplate.jsx's own STATUS_DOT_COLOR/StatusDot).
const STATUS_DOT_COLOR = { past: '#9e9e9e', ongoing: '#4caf52', next: '#ff8c00', upcoming: '#ffb400' }
function StatusDot({ status }) {
  return <span className={f1Styles.eventStatusDot} style={{ background: STATUS_DOT_COLOR[status] }} title={STATUS_LABEL[status]} />
}

// "in 14 days" / "3 days ago" / "Today" — same Schedule Date-column second
// line as F1/MMA's own Schedule tables, compared at whole-day granularity.
function relativeDayLabel(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const diffDays = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000)
  if (diffDays === 0) return 'Today'
  return diffDays > 0 ? `in ${diffDays} day${diffDays === 1 ? '' : 's'}` : `${-diffDays} day${diffDays === -1 ? '' : 's'} ago`
}

function resolveLogo(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

// Column widths sum to 100% of the table (Mohamed 2026-08-26: "use the
// full table width to display col proportionally" / "spread and align
// proportionally"). Sized to each column's actual content need rather
// than dumping 100% of the leftover width into a single column — Location
// only needs ~180-200px for "Oklahoma City, OK" + "Paycom Center", and
// piling the whole remainder onto it (27%) or onto Team vs Team (56%) both
// left an obviously oversized block once the video column was dropped.
// A little slack in the narrower text columns (Date/Type/Location) is
// normal for a fixed-width table and isn't the same failure mode — the
// goal is no single column standing out as blatantly empty, not literal
// zero whitespace anywhere.
const COL_WIDTH = { dot: '4%', date: '10%', type: '13%', teams: '50%', location: '23%' }

// Score column shifted toward the LEFT team (Mohamed 2026-08-26: "move the
// score col left so as to give more space with team col right") — with
// both team names left-aligned, an even 1fr/1fr split left a big gap
// between the (usually short) left name and the score, while the right
// team's own space was comparatively tight. The middle track itself was
// widened from 64px to 84px too — a 3-digit score each side ("150 I 150")
// was tight enough at 64px to butt right up against the away team's logo
// (Mohamed: "i need space here!"), and the left/right ratio was eased back
// from 0.7fr to 0.82fr so that extra room doesn't just re-crowd the same
// spot. Shared by the header and every row so the columns stay aligned.
const TEAM_GRID_COLS = '0.82fr 84px 1fr'

function GameRow({ r, status }) {
  const homeStrong = r.home_won === true
  const awayStrong = r.home_won === false
  const hasScore = r.score?.home != null && r.score?.away != null
  const relDay = relativeDayLabel(r.match_date)
  return (
    <tr className="table-row" style={{ verticalAlign: 'top' }}>
      <td style={{ textAlign: 'center', width: COL_WIDTH.dot, paddingTop: 6 }}>
        <StatusDot status={status} />
      </td>
      <td className="stats-light" style={{ textAlign: 'left', width: COL_WIDTH.date }}>
        <div>{fmtDate(r.match_date)}</div>
        {relDay && <div className={f1Styles.eventDateRelative}>{relDay}</div>}
      </td>
      <td className="stats-light" style={{ textAlign: 'left', width: COL_WIDTH.type }}>{r.bloc_label}</td>
      <td style={{ textAlign: 'left', width: COL_WIDTH.teams }}>
        <div style={{ display: 'grid', gridTemplateColumns: TEAM_GRID_COLS, alignItems: 'start', gap: 8 }}>
          {/* Both team blocks left-aligned (Mohamed 2026-08-26: "teams must
              be aligned left") — a prior attempt at symmetric score-hugging
              (justifySelf: 'end' here) was reverted; plain left alignment,
              same as every other column in this table (Date/Type/Location). */}
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

// Date column sort toggle (Mohamed 2026-08-26: "add arrow top/bottom to
// change order") — same ChevronIcon-in-header pattern HomeF1Template.jsx's
// own Date column uses; 'desc' (latest first) is the existing default.
function GamesTable({ games, statusByGameId, sortDir, onToggleSort }) {
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
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.type }}>Type</th>
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
          {games.map(r => <GameRow key={r.id} r={r} status={statusByGameId.get(r.id)} />)}
        </tbody>
      </table>
    </div>
  )
}

export default function NbaHomeTemplate({ year }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  // Two independent team pickers (Mohamed 2026-08-16: "add All Teams vs
  // All Teams") — mirrors the table's own "Team vs Team" column so the
  // filter bar can narrow down to one specific matchup regardless of which
  // side was home. Either one alone still works as a plain "every game
  // this team played" filter.
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState(() => new Set())
  // 'desc' (latest first) matches the backend's own ORDER BY match_date
  // DESC (results.js) — the arrow just lets the user flip it, same as
  // HomeF1Template.jsx's own Date column.
  const [sortDir, setSortDir] = useState('desc')
  const [leaders, setLeaders] = useState(null)

  useEffect(() => {
    if (!year) return
    api.getNbaHomeLeaders(year).then(setLeaders).catch(() => setLeaders(null))
  }, [year])

  // Admin-configured subtitle line — same global 'Schedule' catalog key
  // and fallback pattern every other sport's Schedule tab now uses
  // (HomeF1Template.jsx/HomeMotoGPTemplate.jsx/HomeTennisTemplate.jsx's
  // own SCHEDULE_SUBTITLE_FALLBACK).
  const SCHEDULE_SUBTITLE_FALLBACK = `Full Schedule and Results - ${year}`
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle(null, null, 'Schedule', null, year)
      .then(d => setPageSubtitle(d?.subtitle || SCHEDULE_SUBTITLE_FALLBACK))
      .catch(() => setPageSubtitle(SCHEDULE_SUBTITLE_FALLBACK))
  }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!year) return
    let cancelled = false
    setLoading(true)
    api.getNbaHome(year)
      .then(d => { if (!cancelled) setRows(d?.rows || []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year])

  useEffect(() => { setTeamA(''); setTeamB(''); setTypeFilter(''); setStatusFilter(new Set()) }, [year])

  if (loading) return <div className={f1Styles.wrap}><Skeleton /></div>
  if (!rows?.length) return <div className={f1Styles.wrap}><Empty /></div>

  // preDays: 0 — an NBA game is a single dated event, not a multi-day
  // weekend (see eventStatus.js's own comment; default 2 is tuned for
  // F1/MotoGP race weekends, and would otherwise read a game still days
  // away as already ONGOING).
  const statusByGameId = new Map(
    classifyByDate(rows, r => r.match_date, { preDays: 0 }).map(({ item, status }) => [item.id, status])
  )

  // Faceted filters (Mohamed 2026-08-26: "sort options must be tied. When
  // All Types = NBA Finals, All Teams must show only 2 teams: Spurs and
  // Knicks") — each filter's own option list reflects every OTHER active
  // filter, never itself, same convention CLAUDE.md's own faceted-filter-
  // counts pattern uses elsewhere (players_template.jsx's positionCounts).
  const matchesType = (r, t) => !t || r.bloc_label === t
  const matchesStatus = r => !statusFilter.size || statusFilter.has(statusByGameId.get(r.id))
  const matchesTeam = (r, team) => !team || r.home.name === team || r.away.name === team

  const typeOptions = TYPE_OPTIONS.filter(t =>
    rows.some(r => matchesType(r, t) && matchesStatus(r) && matchesTeam(r, teamA) && matchesTeam(r, teamB))
  )
  const teamAOptions = [...new Set(
    rows.filter(r => matchesType(r, typeFilter) && matchesStatus(r) && matchesTeam(r, teamB))
      .flatMap(r => [r.home.name, r.away.name])
  )].sort()
  const teamBOptions = [...new Set(
    rows.filter(r => matchesType(r, typeFilter) && matchesStatus(r) && matchesTeam(r, teamA))
      .flatMap(r => [r.home.name, r.away.name])
  )].sort()

  const filtered = rows
    .filter(r => matchesType(r, typeFilter) && matchesStatus(r) && matchesTeam(r, teamA) && matchesTeam(r, teamB))
    .sort((a, b) => {
      const cmp = new Date(b.match_date) - new Date(a.match_date)
      return sortDir === 'desc' ? cmp : -cmp
    })

  const hasActiveFilter = !!(teamA || teamB || typeFilter || statusFilter.size)

  // Status pills only make sense when there's something other than Past to
  // filter for (Mohamed 2026-08-26: "Status pills must shown only when
  // status = ONGOING, NEXT or FUTURE") — same hasNonPastStatus guard
  // HomeF1Template.jsx's own status pill bar uses. A fully concluded season
  // (every row 'past') hides the whole toggle rather than showing 5
  // pills where 4 of them would always return zero games.
  const hasNonPastStatus = rows.some(r => {
    const s = statusByGameId.get(r.id)
    return s === 'ongoing' || s === 'next' || s === 'upcoming'
  })

  return (
    <div className={f1Styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      <div className="filter-bar">
        <select className="filter-label" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
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
          <button className="filter-reset" onClick={() => { setTeamA(''); setTeamB(''); setTypeFilter(''); setStatusFilter(new Set()) }}>Clear</button>
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
                    {leader.name} ({leader.count})
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <GamesTable games={filtered} statusByGameId={statusByGameId} sortDir={sortDir} onToggleSort={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} />
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(5)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 44, marginBottom: 8, borderRadius: 10 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No games available.</div>
}
