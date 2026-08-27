// templates/f1/HomeF1Template.jsx
//
// F1's Schedule tab (Line A, 2nd entry, right after Home — Mohamed
// 2026-08-22: "current Home page becomes Line A Schedule") — a calendar of
// whichever season is currently selected via the YearSelector (seasonId/
// year props, same as every other F1 template — F1ContentArea resolves
// them from activeYear), NOT hardcoded to the latest year. One row per
// GP's Race session by default — dot | Date | Grand Prix | Session |
// Winner | Team — with an expand chevron on the Race row (2026-08-10) that
// reveals that GP's Practice/Qualifying/Sprint sessions inline, sorted
// into their correct chronological position alongside the Race row (see
// `sorted` below). Home itself (F1ContentArea's isHomeMode) is now blank —
// this table used to render there directly.
//
// SESSION DATE — f1_sessions.session_date now holds each session's own
// real date (scraped per-session from the calendar pages since 2026, see
// load-calendar.js) — /f1/home-sessions/:seasonId falls back to the
// round's shared event_date for any session without one (every pre-2026
// season). Status is classified per SESSION (see statusBySessionId
// below), not per round — a Saturday Qualifying that's already happened
// must show PAST even while Sunday's Race on the same round still shows
// NEXT (2026-08-10 fix — previously every session of a round shared one
// status, so Browsing the day after Qualifying but before the Race still
// showed Qualifying as NEXT/FUTURE).
//
// STATUS — past/ongoing/next/upcoming via the shared classifyByDate
// (utils/eventStatus.js): 'ongoing' is a session actually in its own date
// window right now; 'next' is the single earliest session after that;
// 'upcoming' is every other future session. Shown as a colored dot in
// column 1 (Mohamed 2026-08-22, mirroring HomeTennisTemplate.jsx's own
// StatusDot), not a text pill column anymore.
//
// WINNER DATA GAP — /f1/home-sessions/:seasonId LEFT JOINs to session
// results, so a session with no result yet has a null winner — falls
// back to the current championship points leader only when the round is
// 'ongoing' (in progress, some sessions may already have results); a
// 'next'/'upcoming' round shows a plain — instead, since there's
// nothing meaningful to attribute yet.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import FullStandingsDrawer from '../../shared/FullStandingsDrawer'
import ChevronIcon from '../../shared/ChevronIcon'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { classifyByDate, STATUS_LABEL } from '../../../utils/eventStatus'
import { shortGpLabel } from '../../../utils/gpLabel'
import styles from './f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

// Same hex values EventBlock.module.css's .status_past/_ongoing/_next/
// _upcoming pills use — rounded dot instead of a text pill (Mohamed
// 2026-08-22, mirroring HomeTennisTemplate.jsx's own StatusDot: "Remove
// col status" / "Add the status col before date: pills become rounded
// dot, same color").
const STATUS_DOT_COLOR = { past: '#9e9e9e', ongoing: '#4caf52', next: '#ff8c00', upcoming: '#ffb400' }
function StatusDot({ status }) {
  return <span className={styles.eventStatusDot} style={{ background: STATUS_DOT_COLOR[status] }} title={STATUS_LABEL[status]} />
}

// "in 2 months" / "in 24 days" countdown shown under the Date cell now
// (used to sit under the removed Status column) — months once far enough
// out that a day count stops being useful.
function countdown(dateStr) {
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000)
  if (days <= 0) return null
  if (days >= 60) return `in ${Math.round(days / 30)} months`
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// Groups the raw session_type values into the 5 buckets the "Sort by"
// filter offers — every Practice N folds into Practice, everything else
// (Race/Sprint/Qualifying/Sprint Qualifying) is its own bucket.
function typeBucket(sessionType) {
  if (sessionType?.startsWith('Practice')) return 'Practice'
  return sessionType
}
// A-Z (Mohamed 2026-08-23: "i told u to sort by options A-Z" — this is
// the "Sort by:" dropdown's own option order, not a table sort).
const TYPE_OPTIONS = ['Practice', 'Qualifying', 'Race', 'Sprint', 'Sprint Qualifying']

// Schedule page "Leaders" card buckets (Mohamed 2026-08-23: "assign same
// leader box to F1" — mirrors MotoGP's own LEADER_CATEGORIES, swapping
// MotoGP's Warm-up for F1's own Sprint Pole, the one category MotoGP's
// schema has no equivalent of). Backed by /f1/session-leaders/:seasonId.
const LEADER_CATEGORIES = [
  { key: 'race_wins', label: 'Races' },
  { key: 'race_podiums', label: 'Podiums' },
  { key: 'poles', label: 'Poles' },
  { key: 'sprint_wins', label: 'Sprints' },
  { key: 'sprint_poles', label: 'Sprint Poles' },
  { key: 'practice_tops', label: 'Practices' },
]

export default function HomeF1Template({ seasonId, year }) {
  const [rows, setRows] = useState(null)
  const [leader, setLeader] = useState(null)
  const [driverStandings, setDriverStandings] = useState(null)
  const [leaders, setLeaders] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pageSubtitle, setPageSubtitle] = useState(null)
  const [driverFilter, setDriverFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  // Set, not a single string (Mohamed 2026-08-22: "4 pills are aggregate",
  // same as HomeTennisTemplate.jsx's own status pills).
  const [statusFilter, setStatusFilter] = useState(() => new Set())
  // Date column sort direction (Mohamed 2026-08-22: "add arrow to sort
  // order") — 'desc' (latest first) is the existing default, the arrow
  // toggles to 'asc' (earliest first). The Grand Prix column's own sort
  // arrow was removed (Mohamed 2026-08-23: "remove arrow on label Grand
  // Prix") — Date is the only sortable column now.
  const [sortDir, setSortDir] = useState('desc')
  // Only each GP's Race row shows by default (2026-08-10) — its
  // Practice/Qualifying/Sprint siblings are collapsed behind an expand
  // chevron on the Race row until explicitly opened, keyed by gp_id.
  const [expandedGpIds, setExpandedGpIds] = useState(() => new Set())
  // Same key format FullStandingsDrawer builds internally
  // (`standings:${sessionId}`) — clicking the GP name on a given row opens
  // that row's own session standings (Practice row -> Practice, Race row
  // -> Race, etc.), same session Full Standings already opened on that row.
  const openVideo = useVideoPlayerStore(s => s.openVideo)
  const toggleExpand = (gpId) => setExpandedGpIds(prev => {
    const next = new Set(prev)
    next.has(gpId) ? next.delete(gpId) : next.add(gpId)
    return next
  })

  useEffect(() => {
    if (!seasonId) { setRows(null); setLeader(null); setDriverStandings(null); setLeaders(null); return }
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.getF1HomeSessions(seasonId).catch(() => null),
      api.getF1Standings(seasonId, 'drivers').catch(() => null),
      api.getF1SessionLeaders(seasonId).catch(() => null),
    ])
      .then(([sessionsData, standingsData, leadersData]) => {
        if (cancelled) return
        setLeader(standingsData?.standings?.[0] || null)
        setDriverStandings(standingsData?.standings || null)
        setRows(sessionsData?.sessions || [])
        setLeaders(leadersData?.drivers || [])
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId])

  useEffect(() => { setDriverFilter(''); setTeamFilter(''); setTypeFilter(''); setStatusFilter(new Set()); setExpandedGpIds(new Set()) }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — this
  // template backs the Schedule page now, not the blank Home page, so the
  // catalog lookup key is 'Schedule', not 'Home' (Mohamed 2026-08-22: "Add
  // the subtitle: Full Schedule and Results - 2026"), same fallback
  // pattern HomeTennisTemplate.jsx's own SCHEDULE_SUBTITLE_FALLBACK uses.
  const SCHEDULE_SUBTITLE_FALLBACK = `Full Schedule and Results - ${year}`
  useEffect(() => {
    if (!year) return
    api.getSubtitle(null, null, 'Schedule', null, year)
      .then(d => setPageSubtitle(d?.subtitle || SCHEDULE_SUBTITLE_FALLBACK))
      .catch(() => setPageSubtitle(SCHEDULE_SUBTITLE_FALLBACK))
  }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  // Whichever round is most immediately relevant starts pre-expanded —
  // that's the one round a user opening this page actually wants full
  // session detail on immediately, not buried a click away like every
  // other round's detail (2026-08-10). ONGOING takes priority over NEXT
  // (Mohamed 2026-08-23: "if there's an ONGOING, expand this one and make
  // NEXT unexpanded. If no ONGOING; expand NEXT") — a race weekend
  // actually in progress is more relevant than the upcoming one. Runs
  // once per fresh `rows` load (i.e. per season fetch), so a user who
  // manually collapses/expands afterward isn't fought — `add` only, never
  // replaces the whole set.
  useEffect(() => {
    if (!rows?.length) return
    const classified = classifyByDate(rows, r => r.session_date)
    const entryToExpand = classified.find(c => c.status === 'ongoing') || classified.find(c => c.status === 'next')
    if (entryToExpand) setExpandedGpIds(prev => new Set(prev).add(entryToExpand.item.gp_id))
  }, [rows])

  if (loading) return <Skeleton />
  if (!rows?.length) return <Empty year={year} />

  // Classify per SESSION now that each has its own real date (see file
  // header) — session_id is unique per row, so no dedup needed the way
  // the old per-round version needed uniqueRounds.
  const statusBySessionId = new Map(
    classifyByDate(rows, r => r.session_date).map(c => [c.item.session_id, c.status])
  )
  // A fully-concluded season (e.g. 2025) has nothing but 'past' sessions —
  // the Ongoing/Next/Upcoming filter pills would all be no-ops (0
  // matches), so there's nothing worth filtering by; skip the toggle
  // group entirely rather than show 3 dead buttons.
  const hasNonPastStatus = [...statusBySessionId.values()].some(s => s !== 'past')

  // The "next" round's gp_id — pinned to the very top of the list below,
  // ahead of even more-recent past rounds, since it's the one thing a
  // user opening Schedule actually wants to see first.
  const nextGpId = rows.find(r => statusBySessionId.get(r.session_id) === 'next')?.gp_id

  // Every session of that pinned round reads as NEXT, not just the single
  // earliest one classifyByDate picked — a mix of NEXT (Practice 1) and
  // FUTURE (Qualifying/Race) on the one round being pinned open read as
  // inconsistent (2026-08-10: "all 5 Netherlands sessions must be
  // considered as NEXT"). Every other round's per-session PAST/ONGOING/
  // UPCOMING status is untouched.
  if (nextGpId != null) {
    rows.forEach(r => { if (r.gp_id === nextGpId) statusBySessionId.set(r.session_id, 'next') })
  }

  // Next round's group first, then latest/earliest session (sortDir),
  // chronological within a round (Practice before Qualifying before
  // Race/Sprint) as a tie-breaker for same-day sessions.
  const sorted = [...rows].sort((a, b) => {
    if (nextGpId != null && (a.gp_id === nextGpId) !== (b.gp_id === nextGpId)) {
      return a.gp_id === nextGpId ? -1 : 1
    }
    const cmp = new Date(b.session_date) - new Date(a.session_date) || a.display_order - b.display_order
    return sortDir === 'desc' ? cmp : -cmp
  })

  const driverOptions = [...new Set(rows.map(r => r.driver_name).filter(Boolean))].sort()
  const teamOptions    = [...new Set(rows.map(r => r.team_name).filter(Boolean))].sort()

  const filtered = sorted.filter(r => {
    if (driverFilter && r.driver_name !== driverFilter) return false
    if (teamFilter && r.team_name !== teamFilter) return false
    if (typeFilter && typeBucket(r.session_type) !== typeFilter) return false
    // Only each GP's Race row shows by default — Practice/Qualifying/
    // Sprint siblings stay hidden until their GP is expanded, unless the
    // user explicitly asked for a specific session type via typeFilter,
    // or picked a driver (Mohamed 2026-08-16: "If driver A won Race 1,
    // sprint Race 2, practice 1 and practice 2 Race 3: i want to see the
    // 3 races expanded" — a driver's win might be buried in a
    // Practice/Qualifying/Sprint row that stays hidden behind the
    // collapse-by-default rule below; without this bypass, that whole GP
    // vanished from the filtered list entirely, since its only visible
    // row (Race) has a different winner and its matching row is hidden).
    // driverFilter alone still only matches rows this driver actually WON
    // (see the driver_name check above) — this just stops those wins from
    // being hidden when they happen outside the Race session.
    if (!typeFilter && !driverFilter && r.session_type !== 'Race' && !expandedGpIds.has(r.gp_id)) return false
    const status = statusBySessionId.get(r.session_id)
    // Pills OR together now, not exclusive (Mohamed 2026-08-22: "4 pills
    // can be aggregated" — Past+Ongoing both checked shows either).
    if (statusFilter.size) return statusFilter.has(status)
    // A specific driver/team was explicitly picked — show it regardless
    // of status (an Upcoming race like Mexico, or a driver's next round,
    // must still show up when searched for, not get silently hidden by
    // the default rule below, which only applies when browsing the full
    // unfiltered list).
    if (driverFilter || teamFilter) return true
    // The pinned "next" round's OTHER sessions (e.g. its Race, once an
    // earlier Practice/Qualifying has already claimed the single global
    // 'next' status) are still 'upcoming' individually — must not be
    // hidden by the rule below, or the round's own Race anchor row
    // could vanish from the default view entirely.
    if (r.gp_id === nextGpId) return true
    // No driver/team/status filter — hide the long tail of far-future
    // "Upcoming" rounds by default; Past/Ongoing/Next still show. Click
    // the Upcoming badge itself to see them.
    return status !== 'upcoming'
  })

  // !! so this is a real boolean, not a number — {hasActiveFilter && <button>}
  // rendered a stray literal "0" after the status pills whenever every
  // filter was empty (statusFilter.size is 0, and `'' || '' || '' || 0`
  // evaluates to 0 itself, not false, which React then prints as text
  // instead of rendering nothing — Mohamed 2026-08-23 screenshot, same bug
  // class HomeTennisTemplate.jsx's own hasActiveFilter already guards
  // against).
  const hasActiveFilter = !!(driverFilter || teamFilter || typeFilter || statusFilter.size)

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        {/* "All Races" removed (Mohamed 2026-08-22: "Remove All Races") —
            the Grand Prix column header's own sort arrow below now covers
            browsing by race. */}
        <select className="filter-label" value={driverFilter} onChange={e => setDriverFilter(e.target.value)}>
          <option value="">All Drivers</option>
          {driverOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teamOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="filter-label" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Sort by:</option>
          {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {hasNonPastStatus && (
          <div className={styles.statusToggle}>
            {/* Colored per status (Mohamed 2026-08-22: "Status pills: make
                color") and toggle-able independently — clicking one no
                longer clears the others ("4 pills are aggregate"). */}
            {STATUS_ORDER.map(s => (
              <button
                key={s}
                type="button"
                className={`${styles.statusBtn} ${styles[`statusBtn_${s}`]} ${statusFilter.has(s) ? styles.statusBtnActive : ''}`}
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
          <button className="filter-reset" onClick={() => { setDriverFilter(''); setTeamFilter(''); setTypeFilter(''); setStatusFilter(new Set()) }}>
            Clear
          </button>
        )}
        <span className="filter-total">{filtered.length} sessions</span>
      </div>

      {leaders?.length > 0 && (() => {
        const selected = driverFilter ? leaders.find(d => d.driver_name === driverFilter) : null
        return (
          <div className={styles.leadersCard}>
            {selected ? (
              <div className={styles.leadersRiderHeader}>
                <AthleteAvatar src={resolveImg(selected.driver_image)} name={selected.driver_name} sport="f1" gender="M" className={styles.leadersAvatar} fallback="letter" />
                <span className={styles.leadersRiderName}>{selected.driver_name}</span>
                <Flag iso2={selected.driver_country_iso2} name={selected.driver_country_name} className="flag" />
              </div>
            ) : (
              <div className={styles.leadersTitle}>Leaders</div>
            )}
            <div className={styles.leadersGrid}>
              {(() => {
                // Standings, first stat (Mohamed 2026-08-23: "add 1st stat:
                // Standings: 135pts: Beneath Driver/Rider name") — same
                // shape as every category below, just points-based:
                // reuses the driver standings already fetched for `leader`
                // above (no extra request), matched to the selected driver
                // by canonical_name (== driver_name in the session-leaders
                // data both draw from).
                const totalPoints = (driverStandings || []).reduce((sum, d) => sum + (Number(d.stats?.points) || 0), 0)
                const standingsRow = selected
                  ? (driverStandings || []).find(d => d.canonical_name === selected.driver_name)
                  : leader
                const points = Number(standingsRow?.stats?.points) || 0
                if (!standingsRow || !points) return null
                if (selected) {
                  const pct = totalPoints ? Math.round((points / totalPoints) * 100) : 0
                  return (
                    <div className={styles.leaderStat}>
                      <span className={styles.leaderStatLabel}>Standings | <b>{points}pts</b></span>
                      <span className={styles.leaderStatPct}>{pct}%</span>
                    </div>
                  )
                }
                return (
                  <div className={styles.leaderStat}>
                    <span className={styles.leaderStatLabel}>Standings | <b>{points}pts</b></span>
                    <span className={styles.leaderStatSub}>{standingsRow.canonical_name}</span>
                  </div>
                )
              })()}
              {LEADER_CATEGORIES.map(cat => {
                const total = leaders.reduce((sum, d) => sum + (d[cat.key] || 0), 0)
                if (!total) return null
                if (selected) {
                  const mine = selected[cat.key] || 0
                  const pct = Math.round((mine / total) * 100)
                  return (
                    <div key={cat.key} className={styles.leaderStat}>
                      <span className={styles.leaderStatLabel}>{cat.label} | <b>{mine}</b></span>
                      <span className={styles.leaderStatPct}>{pct}%</span>
                    </div>
                  )
                }
                const top = [...leaders].sort((a, b) => (b[cat.key] || 0) - (a[cat.key] || 0))[0]
                return (
                  <div key={cat.key} className={styles.leaderStat}>
                    <span className={styles.leaderStatLabel}>{cat.label} | <b>{top[cat.key]}</b></span>
                    <span className={styles.leaderStatSub}>{top.driver_name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              {/* Status dot column, before Date (Mohamed 2026-08-22:
                  "Col 1 = status dot" / "Remove col status"). */}
              <th className="table-label" style={{ textAlign: 'center', width: '3%' }}></th>
              <th className="table-label" style={{ textAlign: 'left', width: '12%', whiteSpace: 'nowrap' }}>
                <button
                  type="button"
                  className={styles.sortableHeader}
                  onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                  title={sortDir === 'asc' ? 'Earliest first — click for latest first' : 'Latest first — click for earliest first'}
                >
                  Date <ChevronIcon open={sortDir === 'asc'} size={10} className={styles.sortArrow} />
                </button>
              </th>
              {/* Sort arrow removed (Mohamed 2026-08-23: "remove arrow on
                  label Grand Prix") — plain header, Date is the only
                  sortable column. Widths spread across the full table
                  width now that Status/Video are gone (Mohamed 2026-08-23:
                  "Use all table to spread columns"). */}
              <th className="table-label" style={{ textAlign: 'left', width: '22%' }}>Grand Prix</th>
              {/* "Type" -> "Session" (Mohamed 2026-08-22: "Replace Type by
                  Session"). */}
              <th className="table-label" style={{ textAlign: 'left', width: '13%' }}>Session</th>
              <th className="table-label" style={{ textAlign: 'left', width: '20%' }}>Winner</th>
              <th className="table-label" style={{ textAlign: 'left', width: '16%' }}>Team</th>
              <th className="table-label" style={{ textAlign: 'right', width: '14%' }}></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Stripe by GROUP position (one GP = one group, whether
              // shown as just its collapsed Race row or fully expanded
              // to all 5 sessions), not by flat row index — an expanded
              // round's revealed sessions must all share the SAME
              // highlight state as their Race anchor, not re-stripe
              // individually (2026-08-10: "expanded highlighted lines
              // must stay highlighted (all sessions)"). Plain closure
              // vars instead of state: reset every render (filters can
              // reshuffle which gp_id is first), only ever read/written
              // in DOM order within this one map.
              let lastGpId = null
              let groupIndex = -1
              return filtered.map((r, i) => {
              if (r.gp_id !== lastGpId) { groupIndex++; lastGpId = r.gp_id }
              const isAltRow = groupIndex % 2 === 1
              const status = statusBySessionId.get(r.session_id)
              // No result yet on this session — a 'next'/'upcoming' session
              // has nothing meaningful to show (—); an 'ongoing' one
              // still shows the current points leader as context.
              const person = r.driver_name
                ? { name: r.driver_name, iso2: r.driver_country_iso2, country: r.driver_country_name, team: r.team_name, engine: r.engine_name }
                : (status === 'next' || status === 'upcoming')
                  ? null
                  : leader
                    ? { name: leader.canonical_name, iso2: leader.country_iso2, country: leader.country_name, team: leader.stats?.team_name_raw, engine: leader.stats?.engine_name }
                    : null
              // "McLaren (Mercedes)" — skip the parenthetical when the
              // team IS its own engine supplier (e.g. Ferrari (Ferrari)
              // would just be noise).
              const teamDisplay = person?.team
                ? (person.engine && !person.team.toLowerCase().includes(person.engine.toLowerCase())
                    ? `${person.team} (${person.engine})`
                    : person.team)
                : null
              const isExpanded = expandedGpIds.has(r.gp_id)
              const isAnchorRow = r.session_type === 'Race'
              const cd = (status === 'next' || status === 'upcoming') ? countdown(r.session_date) : null
              return (
                <tr key={r.session_id} className={`table-row ${styles.homeRow} ${isAltRow ? styles.altRow : ''}`} style={{ animationDelay: `${i * 0.03}s` }}>
                  <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: 6 }}>
                    <StatusDot status={status} />
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {/* The Race session's own real date (Mohamed 2026-08-23:
                        "Display Race date not entire session date") — every
                        row (anchor or expanded sub-session) shows its own
                        single session_date, no weekend-spanning range. */}
                    <div>{fmtDate(r.session_date)}</div>
                    {cd && <div className={styles.eventDateRelative}>{cd}</div>}
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    {/* .gpName goes ON the button itself now, not a
                        wrapping span (Mohamed 2026-08-23: "make col Grand
                        Prix CSS Strong (content, not only Label)") — a
                        native <button> doesn't inherit font-weight from an
                        ancestor the way a plain <span> would, so the
                        earlier wrapper-only placement left the name
                        un-bolded despite .gpName's font-weight:700. Same
                        same-element pairing F1RacesAllTimeTemplate.jsx/
                        MotoGPRacesAllTimeTemplate.jsx already use
                        (`${styles.gpName} ${styles.nameLinkPlain}` on one
                        button). */}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      <Flag iso2={r.gp_country_iso2} name={r.gp_country_name} className="flag" />
                      <button
                        type="button"
                        className={`${styles.gpName} ${styles.nameLinkPlain}`}
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                        onClick={() => openVideo(`standings:${r.session_id}`)}
                      >
                        {shortGpLabel(r.gp_name)}
                      </button>
                    </span>
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {r.session_type}
                      {isAnchorRow && (
                        <button
                          type="button"
                          className={styles.expandBtn}
                          onClick={() => toggleExpand(r.gp_id)}
                          aria-label={isExpanded ? 'Collapse sessions' : 'Expand sessions'}
                        >
                          {/* Shared ChevronIcon, not the old rotated unicode
                              glyph (Mohamed 2026-08-22: "replace the arrow by
                              the CSS new chevron: oriented top when expanded,
                              oriented bottom when unexpanded") — same
                              points-down-closed/points-up-open convention
                              every other expandable list on the site uses. */}
                          <ChevronIcon open={isExpanded} size={10} />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left' }}>
                    {person ? (
                      <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
                        <Flag iso2={person.iso2} name={person.country} className="flag" />
                        <span className={driverFilter && person.name === driverFilter ? styles.sortRowsHighlight : undefined}>
                          {person.name}
                        </span>
                      </span>
                    ) : '—'}
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left' }}>
                    {teamDisplay ? (
                      <span className={teamFilter && person.team === teamFilter ? styles.sortRowsHighlight : undefined}>
                        {teamDisplay}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {/* Video removed (Mohamed 2026-08-22: "Remove col
                        video") — Full Standings is the only row action
                        left. */}
                    <div className={styles.actionsRow}>
                      <FullStandingsDrawer
                        sessionId={r.session_id}
                        sessionType={r.session_type}
                        tourLabel="F1"
                        gpName={shortGpLabel(r.gp_name)}
                        year={year}
                        status={status}
                        sessionDate={r.session_date}
                        hideTrigger
                      />
                    </div>
                  </td>
                </tr>
              )
            })
            })()}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(6)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty({ year }) {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No race data available{year ? ` for ${year}` : ''}.</div>
}
