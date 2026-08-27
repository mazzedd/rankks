// templates/motogp/HomeMotoGPTemplate.jsx
//
// MotoGP's Schedule tab (Line A, 2nd entry, right after Home — Mohamed
// 2026-08-23: "assign to MotoGP/2/3 the same changes we did before...
// Schedule page", same "current Home page becomes Line A Schedule" split
// F1 got) — a calendar of whichever season is currently selected via the
// YearSelector (seasonId/year props, same as every other MotoGP template —
// MotoGPContentArea resolves them from activeYear), NOT hardcoded to the
// latest year. One row per GP's Race session by default — dot | Date |
// Grand Prix | Session | Winner | Team — with an expand chevron on the
// Race row that reveals that GP's Practice/Qualifying/Sprint/Warm Up
// sessions inline, sorted into their correct chronological position
// alongside the Race row (see `sorted` below). Home itself
// (MotoGPContentArea's isHomeMode) is now blank — this table used to
// render there directly.
//
// The one real structural difference from F1's Home page: MotoGP/Moto2/
// Moto3 share one physical GP calendar but have their own category-scoped
// sessions/results (see motogp.js's file header) — `category` (owned by
// MotoGPContentArea, sourced from the global store) still drives which of
// the three this page fetches/labels. Its own in-page CategoryPills
// switcher was removed (Mohamed 2026-08-23: "remove it, no use" — category
// selection now lives entirely in Sidebar.jsx's Moto GP/Moto 2/Moto 3
// nesting).
//
// SESSION DATE — motogp_sessions.session_date is fully populated across
// every season (confirmed via direct query: 8953/8953 rows), unlike F1's
// which only has real per-session dates from 2026 on — no fallback gap
// here. Status is classified per SESSION (see statusBySessionId below),
// not per round, same reasoning as HomeF1Template.jsx.
//
// VIDEO — removed from this page (Mohamed 2026-08-23: "Watch Video per
// race") — the race's summary video now lives on its own Line B tab
// (MotoGPContentArea.jsx's isWatchMode / MotoGPGPWatchBlock), not inline
// here.
//
// WINNER DATA GAP — /motogp/home-sessions/:seasonId LEFT JOINs to session
// results, so a session with no result yet has a null rider — falls back
// to the current championship points leader only when the round is
// 'ongoing', same rule as F1.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import FullStandingsDrawer from '../../shared/FullStandingsDrawer'
import ChevronIcon from '../../shared/ChevronIcon'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { CATEGORIES, sessionLabel } from '../../MotoGP/MotoGPContentArea'
import { classifyByDate, STATUS_LABEL } from '../../../utils/eventStatus'
import { shortGpLabel } from '../../../utils/gpLabel'
import styles from '../f1/f1.module.css'

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

// Schedule page "Leaders" card buckets (Mohamed 2026-08-23: "display by
// default all leaders for each session (race, qualifying, etc.)") — backed
// by /motogp/session-leaders/:seasonId (motogp.js). Practice/Warm-up have
// no real "win" concept (timed sessions, not head-to-head) — the count is
// "times fastest in that session" instead, same idea as a pole (fastest in
// Qualifying), just not spelled out separately in the label per the mockup.
const LEADER_CATEGORIES = [
  { key: 'race_wins', label: 'Races' },
  { key: 'race_podiums', label: 'Podiums' },
  { key: 'poles', label: 'Poles' },
  { key: 'sprint_wins', label: 'Sprints' },
  { key: 'practice_tops', label: 'Practices' },
  { key: 'warmup_tops', label: 'Warm-ups' },
]

const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

// Same hex values EventBlock.module.css's .status_past/_ongoing/_next/
// _upcoming pills use — rounded dot instead of a text pill, same as
// HomeF1Template.jsx's own StatusDot.
const STATUS_DOT_COLOR = { past: '#9e9e9e', ongoing: '#4caf52', next: '#ff8c00', upcoming: '#ffb400' }
function StatusDot({ status }) {
  return <span className={styles.eventStatusDot} style={{ background: STATUS_DOT_COLOR[status] }} title={STATUS_LABEL[status]} />
}

// "in 2 months" / "in 24 days" countdown shown under the Date cell — same
// helper as HomeF1Template.jsx.
function countdown(dateStr) {
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000)
  if (days <= 0) return null
  if (days >= 60) return `in ${Math.round(days / 30)} months`
  return `in ${days} day${days === 1 ? '' : 's'}`
}

// Groups the raw session_type codes into the "Sort by" filter's buckets —
// FP/P/PR (Free Practice, various eras' codes) all fold into Practice,
// Q/QP (modern two-part quali / legacy single session) fold into
// Qualifying — same "fold the variants, keep the real ones distinct" idea
// typeBucket uses for F1's own Practice N.
function typeBucket(sessionType) {
  if (sessionType === 'FP' || sessionType === 'P' || sessionType === 'PR') return 'Practice'
  if (sessionType === 'Q' || sessionType === 'QP') return 'Qualifying'
  if (sessionType === 'RAC') return 'Race'
  if (sessionType === 'SPR') return 'Sprint'
  if (sessionType === 'WUP') return 'Warm Up'
  return sessionType
}
// A-Z (Mohamed 2026-08-23: "assign to MotoGP/2/3 the same changes... i
// told u to sort by options A-Z" — same "Sort by:" dropdown option order
// F1's TYPE_OPTIONS got).
const TYPE_OPTIONS = ['Practice', 'Qualifying', 'Race', 'Sprint', 'Warm Up']

// FullStandingsDrawer expects F1's driver_*/team_name_raw field names —
// MotoGP's /session/:sessionId/results returns rider_*/team_name instead
// (see motogp.js), so this adapts the response shape at the call site
// rather than changing the shared drawer component itself.
function fetchMotoGPResults(sessionId) {
  return api.getMotoGPSessionResults(sessionId).then(d => ({
    ...d,
    results: (d?.results || []).map(r => ({
      ...r,
      driver_id: r.rider_id,
      driver_name: r.rider_name,
      driver_image: r.rider_image,
      driver_country_iso2: r.rider_country_iso2,
      driver_country_name: r.rider_country_name,
      team_name_raw: r.team_name,
    })),
  }))
}

export default function HomeMotoGPTemplate({ seasonId, year, category }) {
  const [rows, setRows] = useState(null)
  const [leader, setLeader] = useState(null)
  const [riderStandings, setRiderStandings] = useState(null)
  const [leaders, setLeaders] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pageSubtitle, setPageSubtitle] = useState(null)
  const [riderFilter, setRiderFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  // Set, not a single string (Mohamed 2026-08-23: "4 pills are aggregate",
  // same as HomeF1Template.jsx's own status pills).
  const [statusFilter, setStatusFilter] = useState(() => new Set())
  // Date column sort direction — 'desc' (latest first) is the existing
  // default, the arrow toggles to 'asc' (earliest first).
  const [sortDir, setSortDir] = useState('desc')
  // Only each GP's Race row shows by default — its Practice/Qualifying/
  // Sprint/Warm Up siblings are collapsed behind an expand chevron on the
  // Race row until explicitly opened, keyed by gp_id — same pattern as
  // HomeF1Template.jsx.
  const [expandedGpIds, setExpandedGpIds] = useState(() => new Set())
  // Same key format FullStandingsDrawer builds internally
  // (`standings:${sessionId}`) — clicking the GP name on a given row opens
  // that row's own session standings, same session Full Standings already
  // opened on that row.
  const openVideo = useVideoPlayerStore(s => s.openVideo)
  const toggleExpand = (gpId) => setExpandedGpIds(prev => {
    const next = new Set(prev)
    next.has(gpId) ? next.delete(gpId) : next.add(gpId)
    return next
  })

  useEffect(() => {
    if (!seasonId) { setRows(null); setLeader(null); setRiderStandings(null); setLeaders(null); return }
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.getMotoGPHomeSessions(seasonId).catch(() => null),
      api.getMotoGPStandings(seasonId, 'riders').catch(() => null),
      api.getMotoGPSessionLeaders(seasonId).catch(() => null),
    ])
      .then(([sessionsData, standingsData, leadersData]) => {
        if (cancelled) return
        setLeader(standingsData?.standings?.[0] || null)
        setRiderStandings(standingsData?.standings || null)
        setRows(sessionsData?.sessions || [])
        setLeaders(leadersData?.riders || [])
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId])

  useEffect(() => { setRiderFilter(''); setTeamFilter(''); setTypeFilter(''); setStatusFilter(new Set()); setExpandedGpIds(new Set()) }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — this
  // template backs the Schedule page now, not the blank Home page, so the
  // catalog lookup key is 'Schedule', not 'Home' (same fallback pattern
  // HomeF1Template.jsx's own SCHEDULE_SUBTITLE_FALLBACK uses).
  const SCHEDULE_SUBTITLE_FALLBACK = `Full Schedule and Results - ${year}`
  useEffect(() => {
    if (!year) return
    api.getSubtitle(null, null, 'Schedule', null, year)
      .then(d => setPageSubtitle(d?.subtitle || SCHEDULE_SUBTITLE_FALLBACK))
      .catch(() => setPageSubtitle(SCHEDULE_SUBTITLE_FALLBACK))
  }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  // Whichever round is most immediately relevant starts pre-expanded —
  // ONGOING takes priority over NEXT (Mohamed 2026-08-23: "if there's an
  // ONGOING, expand this one and make NEXT unexpanded. If no ONGOING;
  // expand NEXT" — same priority fix F1's Home page got). Runs once per
  // fresh `rows` load, so a user who manually collapses/expands afterward
  // isn't fought — `add` only, never replaces the whole set.
  useEffect(() => {
    if (!rows?.length) return
    const classified = classifyByDate(rows, r => r.session_date)
    const entryToExpand = classified.find(c => c.status === 'ongoing') || classified.find(c => c.status === 'next')
    if (entryToExpand) setExpandedGpIds(prev => new Set(prev).add(entryToExpand.item.gp_id))
  }, [rows])

  if (loading) return <Skeleton />
  if (!rows?.length) return <Empty year={year} />

  // Classify per SESSION — motogp_sessions.session_date is fully populated
  // (confirmed via direct query: 8953/8953 rows), so unlike F1's own
  // pre-2026 fallback gap, every MotoGP session already has its real date.
  const statusBySessionId = new Map(
    classifyByDate(rows, r => r.session_date).map(c => [c.item.session_id, c.status])
  )
  const hasNonPastStatus = [...statusBySessionId.values()].some(s => s !== 'past')

  // The "next" round's gp_id — pinned to the very top of the list below.
  const nextGpId = rows.find(r => statusBySessionId.get(r.session_id) === 'next')?.gp_id

  // Every session of that pinned round reads as NEXT, not just the single
  // earliest one classifyByDate picked — see HomeF1Template.jsx's identical
  // block for the full rationale.
  if (nextGpId != null) {
    rows.forEach(r => { if (r.gp_id === nextGpId) statusBySessionId.set(r.session_id, 'next') })
  }

  // Next round's group first, then latest/earliest session (sortDir),
  // chronological within a round as a tie-breaker.
  const sorted = [...rows].sort((a, b) => {
    if (nextGpId != null && (a.gp_id === nextGpId) !== (b.gp_id === nextGpId)) {
      return a.gp_id === nextGpId ? -1 : 1
    }
    const cmp = new Date(b.session_date) - new Date(a.session_date) || a.display_order - b.display_order
    return sortDir === 'desc' ? cmp : -cmp
  })

  // Tied search (Mohamed 2026-08-23: "All Riders/Drivers and All Teams
  // must be tied in the search. Selecting Russell in All Drivers must
  // limit All Teams to Mercedes only and vice-versa") — each dropdown's
  // own option list is narrowed by whichever OTHER filter is already
  // picked, scoped to the same session-winners dataset (`rows`) both
  // dropdowns already draw from.
  const riderOptions = [...new Set(rows.filter(r => !teamFilter || r.team_name === teamFilter).map(r => r.rider_name).filter(Boolean))].sort()
  const teamOptions  = [...new Set(rows.filter(r => !riderFilter || r.rider_name === riderFilter).map(r => r.team_name).filter(Boolean))].sort()

  const filtered = sorted.filter(r => {
    if (riderFilter && r.rider_name !== riderFilter) return false
    if (teamFilter && r.team_name !== teamFilter) return false
    if (typeFilter && typeBucket(r.session_type) !== typeFilter) return false
    // Only each GP's Race row shows by default — Practice/Qualifying/
    // Sprint/Warm Up siblings stay hidden until their GP is expanded,
    // unless the user explicitly asked for a specific session type, or
    // picked a rider (same "a win buried in a non-Race session shouldn't
    // make the whole GP vanish" fix as F1's own driverFilter bypass).
    if (!typeFilter && !riderFilter && r.session_type !== 'RAC' && !expandedGpIds.has(r.gp_id)) return false
    const status = statusBySessionId.get(r.session_id)
    // Pills OR together, not exclusive (Mohamed 2026-08-23: "4 pills are
    // aggregate" — Past+Ongoing both checked shows either).
    if (statusFilter.size) return statusFilter.has(status)
    if (riderFilter || teamFilter) return true
    // The pinned "next" round's OTHER sessions must not be hidden by the
    // rule below, or the round's own Race anchor row could vanish.
    if (r.gp_id === nextGpId) return true
    return status !== 'upcoming'
  })

  // !! so this is a real boolean, not a number — see HomeF1Template.jsx's
  // identical comment for the stray-"0" bug this guards against.
  const hasActiveFilter = !!(riderFilter || teamFilter || typeFilter || statusFilter.size)

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <select className="filter-label" value={riderFilter} onChange={e => {
          const val = e.target.value
          setRiderFilter(val)
          // Vice-versa half of the tied search — an already-picked team
          // this rider never won for would leave the two selects showing
          // an impossible pairing, so clear it.
          if (val && teamFilter && !rows.some(r => r.rider_name === val && r.team_name === teamFilter)) setTeamFilter('')
        }}>
          <option value="">All Riders</option>
          {riderOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="filter-label" value={teamFilter} onChange={e => {
          const val = e.target.value
          setTeamFilter(val)
          if (val && riderFilter && !rows.some(r => r.team_name === val && r.rider_name === riderFilter)) setRiderFilter('')
        }}>
          <option value="">All Teams</option>
          {teamOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="filter-label" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Sort by:</option>
          {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {hasNonPastStatus && (
          <div className={styles.statusToggle}>
            {/* Colored per status and toggle-able independently — clicking
                one no longer clears the others ("4 pills are aggregate"). */}
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
          <button className="filter-reset" onClick={() => { setRiderFilter(''); setTeamFilter(''); setTypeFilter(''); setStatusFilter(new Set()) }}>
            Clear
          </button>
        )}
        <span className="filter-total">{filtered.length} sessions</span>
      </div>

      {leaders?.length > 0 && (() => {
        const selected = riderFilter ? leaders.find(r => r.rider_name === riderFilter) : null
        return (
          <div className={styles.leadersCard}>
            {selected ? (
              <div className={styles.leadersRiderHeader}>
                <AthleteAvatar src={resolveImg(selected.rider_image)} name={selected.rider_name} sport="motorcycle" gender="M" className={styles.leadersAvatar} fallback="letter" />
                <span className={styles.leadersRiderName}>{selected.rider_name}</span>
                <Flag iso2={selected.rider_country_iso2} name={selected.rider_country_name} className="flag" />
              </div>
            ) : (
              <div className={styles.leadersTitle}>Leaders</div>
            )}
            <div className={styles.leadersGrid}>
              {(() => {
                // Standings, first stat (Mohamed 2026-08-23: "add 1st stat:
                // Standings: 135pts: Beneath Driver/Rider name") — same
                // shape as every category below, just points-based: reuses
                // the rider standings already fetched for `leader` above
                // (no extra request), matched to the selected rider by
                // canonical_name (== rider_name in the session-leaders
                // data both draw from).
                const totalPoints = (riderStandings || []).reduce((sum, r) => sum + (Number(r.stats?.points) || 0), 0)
                const standingsRow = selected
                  ? (riderStandings || []).find(r => r.canonical_name === selected.rider_name)
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
                const total = leaders.reduce((sum, r) => sum + (r[cat.key] || 0), 0)
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
                    <span className={styles.leaderStatSub}>{top.rider_name}</span>
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
              {/* Status dot column, before Date. */}
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
              <th className="table-label" style={{ textAlign: 'left', width: '22%' }}>Grand Prix</th>
              {/* "Type" -> "Session". */}
              <th className="table-label" style={{ textAlign: 'left', width: '13%' }}>Session</th>
              <th className="table-label" style={{ textAlign: 'left', width: '20%' }}>Winner</th>
              <th className="table-label" style={{ textAlign: 'left', width: '16%' }}>Team</th>
              <th className="table-label" style={{ textAlign: 'right', width: '14%' }}></th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Stripe by GROUP position (one GP = one group, whether shown
              // collapsed or fully expanded) — see HomeF1Template.jsx's
              // identical block for the full rationale.
              let lastGpId = null
              let groupIndex = -1
              return filtered.map((r, i) => {
              if (r.gp_id !== lastGpId) { groupIndex++; lastGpId = r.gp_id }
              const isAltRow = groupIndex % 2 === 1
              const status = statusBySessionId.get(r.session_id)
              const person = r.rider_name
                ? { name: r.rider_name, iso2: r.rider_country_iso2, country: r.rider_country_name, team: r.team_name, constructor: r.constructor_name }
                : (status === 'next' || status === 'upcoming')
                  ? null
                  : leader
                    ? { name: leader.canonical_name, iso2: leader.country_iso2, country: leader.country_name, team: leader.stats?.team_name, constructor: leader.stats?.constructor_name }
                    : null
              // "Aprilia Racing (Aprilia)" — skip the parenthetical when the
              // team IS its own constructor (e.g. Ducati (Ducati) would
              // just be noise), same rule F1's Team(Engine) display uses.
              const teamDisplay = person?.team
                ? (person.constructor && !person.team.toLowerCase().includes(person.constructor.toLowerCase())
                    ? `${person.team} (${person.constructor})`
                    : person.team)
                : null
              const typeLabel = sessionLabel(r.session_type, r.session_number)
              const isExpanded = expandedGpIds.has(r.gp_id)
              const isAnchorRow = r.session_type === 'RAC'
              const cd = (status === 'next' || status === 'upcoming') ? countdown(r.session_date) : null
              return (
                <tr key={r.session_id} className={`table-row ${styles.homeRow} ${isAltRow ? styles.altRow : ''}`} style={{ animationDelay: `${i * 0.03}s` }}>
                  <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: 6 }}>
                    <StatusDot status={status} />
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <div>{fmtDate(r.session_date)}</div>
                    {cd && <div className={styles.eventDateRelative}>{cd}</div>}
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    {/* .gpName goes ON the button itself, not a wrapping
                        span — a native <button> doesn't inherit font-weight
                        from an ancestor the way a plain <span> would, same
                        fix HomeF1Template.jsx's own Grand Prix column got. */}
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
                      {typeLabel}
                      {isAnchorRow && (
                        <button
                          type="button"
                          className={styles.expandBtn}
                          onClick={() => toggleExpand(r.gp_id)}
                          aria-label={isExpanded ? 'Collapse sessions' : 'Expand sessions'}
                        >
                          <ChevronIcon open={isExpanded} size={10} />
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left' }}>
                    {person ? (
                      <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
                        <Flag iso2={person.iso2} name={person.country} className="flag" />
                        <span className={riderFilter && person.name === riderFilter ? styles.sortRowsHighlight : undefined}>
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
                    <div className={styles.actionsRow}>
                      <FullStandingsDrawer
                        sessionId={r.session_id}
                        sessionType={typeLabel}
                        tourLabel={CATEGORIES.find(c => c.slug === category)?.label || 'MotoGP'}
                        gpName={shortGpLabel(r.gp_name)}
                        year={year}
                        status={status}
                        sessionDate={r.session_date}
                        fetchResults={fetchMotoGPResults}
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
