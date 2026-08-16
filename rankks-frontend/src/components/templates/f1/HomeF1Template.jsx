// templates/f1/HomeF1Template.jsx
//
// F1's Home tab (Line A, first entry) — a calendar of whichever season is
// currently selected via the YearSelector (seasonId/year props, same as
// every other F1 template — F1ContentArea resolves them from activeYear),
// NOT hardcoded to the latest year. One row per GP's Race session by
// default — Date | Grand Prix | Type | Winner | Team | Status — with an
// expand chevron on the Race row (2026-08-10) that reveals that GP's
// Practice/Qualifying/Sprint sessions inline, sorted into their correct
// chronological position alongside the Race row (see `sorted` below).
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
// 'upcoming' is every other future session.
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
import MatchVideo from '../../shared/MatchVideo'
import { StatusBadge } from '../../EventBlock/EventBlock'
import FullStandingsDrawer from '../../shared/FullStandingsDrawer'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { classifyByDate, STATUS_LABEL } from '../../../utils/eventStatus'
import { shortGpLabel } from '../../../utils/gpLabel'
import styles from './f1.module.css'

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

// "in 2 months" / "in 24 days" countdown shown after the Next/Upcoming
// badge — months once far enough out that a day count stops being useful.
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
const TYPE_OPTIONS = ['Race', 'Sprint', 'Sprint Qualifying', 'Qualifying', 'Practice']

export default function HomeF1Template({ seasonId, year }) {
  const [rows, setRows] = useState(null)
  const [leader, setLeader] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pageSubtitle, setPageSubtitle] = useState(null)
  const [raceFilter, setRaceFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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
    if (!seasonId) { setRows(null); setLeader(null); return }
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.getF1HomeSessions(seasonId).catch(() => null),
      api.getF1Standings(seasonId, 'drivers').catch(() => null),
    ])
      .then(([sessionsData, standingsData]) => {
        if (cancelled) return
        setLeader(standingsData?.standings?.[0] || null)
        setRows(sessionsData?.sessions || [])
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId])

  useEffect(() => { setRaceFilter(''); setDriverFilter(''); setTeamFilter(''); setTypeFilter(''); setStatusFilter(''); setExpandedGpIds(new Set()) }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — Home
  // is shared across every sport, resolves at the pure global tier.
  useEffect(() => {
    if (!year) return
    api.getSubtitle(null, null, 'Home', null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  // The single "next" session's round starts pre-expanded and pinned to
  // the top of the list (see the sort below) — that's the one round a
  // user opening this page actually wants full session detail on
  // immediately, not buried a click away like every other round's detail
  // (2026-08-10). Runs once per fresh `rows` load (i.e. per season
  // fetch), so a user who manually collapses it afterward isn't
  // fought — `add` only, never replaces the whole set.
  useEffect(() => {
    if (!rows?.length) return
    const nextEntry = classifyByDate(rows, r => r.session_date).find(c => c.status === 'next')
    if (nextEntry) setExpandedGpIds(prev => new Set(prev).add(nextEntry.item.gp_id))
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
  // user opening Home actually wants to see first.
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

  // Next round's group first, then latest session first — session date
  // descending, chronological within a round (Practice before Qualifying
  // before Race/Sprint) as a tie-breaker for same-day sessions.
  const sorted = [...rows].sort((a, b) => {
    if (nextGpId != null && (a.gp_id === nextGpId) !== (b.gp_id === nextGpId)) {
      return a.gp_id === nextGpId ? -1 : 1
    }
    return new Date(b.session_date) - new Date(a.session_date) || a.display_order - b.display_order
  })

  const raceOptions  = [...new Set(rows.map(r => r.gp_name))].sort()
  const driverOptions = [...new Set(rows.map(r => r.driver_name).filter(Boolean))].sort()
  const teamOptions    = [...new Set(rows.map(r => r.team_name).filter(Boolean))].sort()

  const filtered = sorted.filter(r => {
    if (raceFilter && r.gp_name !== raceFilter) return false
    if (driverFilter && r.driver_name !== driverFilter) return false
    if (teamFilter && r.team_name !== teamFilter) return false
    if (typeFilter && typeBucket(r.session_type) !== typeFilter) return false
    // Only each GP's Race row shows by default — Practice/Qualifying/
    // Sprint siblings stay hidden until their GP is expanded, unless the
    // user explicitly asked for a specific session type via typeFilter
    // (that's a more specific request than the default view, so it wins).
    if (!typeFilter && r.session_type !== 'Race' && !expandedGpIds.has(r.gp_id)) return false
    const status = statusBySessionId.get(r.session_id)
    if (statusFilter) return status === statusFilter
    // A specific race/driver/team was explicitly picked — show it
    // regardless of status (an Upcoming race like Mexico, or a driver's
    // next round, must still show up when searched for, not get silently
    // hidden by the default rule below, which only applies when browsing
    // the full unfiltered list).
    if (raceFilter || driverFilter || teamFilter) return true
    // The pinned "next" round's OTHER sessions (e.g. its Race, once an
    // earlier Practice/Qualifying has already claimed the single global
    // 'next' status) are still 'upcoming' individually — must not be
    // hidden by the rule below, or the round's own Race anchor row
    // could vanish from the default view entirely.
    if (r.gp_id === nextGpId) return true
    // No race/driver/team/status filter — hide the long tail of
    // far-future "Upcoming" rounds by default; Past/Ongoing/Next still
    // show. Click the Upcoming badge itself to see them.
    return status !== 'upcoming'
  })

  const hasActiveFilter = raceFilter || driverFilter || teamFilter || typeFilter || statusFilter

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <select className="filter-label" value={raceFilter} onChange={e => setRaceFilter(e.target.value)}>
          <option value="">All Races</option>
          {raceOptions.map(name => <option key={name} value={name}>{shortGpLabel(name)}</option>)}
        </select>
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
            {STATUS_ORDER.map(s => (
              <button
                key={s}
                type="button"
                className={`${styles.statusBtn} ${statusFilter === s ? styles.statusBtnActive : ''}`}
                onClick={() => setStatusFilter(f => f === s ? '' : s)}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setRaceFilter(''); setDriverFilter(''); setTeamFilter(''); setTypeFilter(''); setStatusFilter('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{filtered.length} sessions</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              <th className="table-label" style={{ textAlign: 'left', width: '11%' }}>Date</th>
              <th className="table-label" style={{ textAlign: 'left', width: '18%' }}>Grand Prix</th>
              <th className="table-label" style={{ textAlign: 'left', width: '12%' }}>Type</th>
              <th className="table-label" style={{ textAlign: 'left', width: '16%' }}>Winner</th>
              <th className="table-label" style={{ textAlign: 'left', width: '13%' }}>Team</th>
              <th className="table-label" style={{ textAlign: 'center', width: '16%' }}>Status</th>
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
              return (
                <tr key={r.session_id} className={`table-row ${styles.homeRow} ${isAltRow ? styles.altRow : ''}`} style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className="stats-light" style={{ textAlign: 'left' }}>{fmtDate(r.session_date)}</td>
                  <td className="stats-light" style={{ textAlign: 'left', fontWeight: 700 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', width: '100%', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                      <Flag iso2={r.gp_country_iso2} name={r.gp_country_name} className="flag" />
                      <button
                        type="button"
                        className={styles.nameLinkPlain}
                        style={{ marginLeft: 6, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        onClick={() => openVideo(`standings:${r.session_id}`)}
                      >
                        {shortGpLabel(r.gp_name)}
                      </button>
                    </span>
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {r.session_type}
                      {r.session_type === 'Race' && (
                        <button
                          type="button"
                          className={`${styles.expandBtn} ${isExpanded ? styles.expandBtnOpen : ''}`}
                          onClick={() => toggleExpand(r.gp_id)}
                          aria-label={isExpanded ? 'Collapse sessions' : 'Expand sessions'}
                        >
                          ▶
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
                  <td style={{ textAlign: 'center' }}>
                    <StatusBadge status={status} />
                    {(status === 'next' || status === 'upcoming') && countdown(r.session_date) && (
                      <span className="cell-meta" style={{ display: 'block', marginTop: 2 }}>{countdown(r.session_date)}</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
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
                      {/* Video is tied to the race weekend as a whole, not
                          one session — only the Race row shows the button,
                          same rule the GP page's own video button follows.
                          The slot itself is unconditional though — always
                          reserving its width so Full Standings sits at the
                          same X on every row instead of drifting left/right
                          depending on whether Watch happens to render. */}
                      <span className={styles.watchSlot}>
                        {r.session_type === 'Race' && (
                          <MatchVideo
                            videoUrl={r.video_url}
                            source={r.video_source}
                            embeddable={r.video_embeddable}
                            thumbnailUrl={r.video_thumbnail_url}
                            inline
                            videoId={r.video_id}
                            videoType="f1_race_video"
                            title="Race"
                            subtitle={`${shortGpLabel(r.gp_name)} ${year}`}
                            status={status}
                          />
                        )}
                      </span>
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
