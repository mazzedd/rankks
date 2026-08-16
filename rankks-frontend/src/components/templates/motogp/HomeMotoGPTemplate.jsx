// templates/motogp/HomeMotoGPTemplate.jsx
//
// MotoGP's Home tab (Line A, first entry) — same calendar-of-sessions shape
// as HomeF1Template.jsx (Date | Grand Prix | Type | Winner | Team | Status),
// brought up to full parity with it (2026-08-10): one row per GP's Race
// session by default, expand chevron reveals that GP's Practice/Qualifying/
// Sprint/Warm Up siblings, per-SESSION status (motogp_sessions.session_date
// is fully populated across every season, unlike F1's which only has real
// per-session dates from 2026 on — no fallback gap here), next round pinned
// to the top and forced uniformly NEXT + auto-expanded, and the same
// group-based (not flat-index) zebra stripe that stays consistent through
// expand/collapse.
//
// The one real structural difference from F1's Home page: MotoGP/Moto2/
// Moto3 share one physical GP calendar but have their own category-scoped
// sessions/results (see motogp.js's file header), so this page needs its
// own category switcher — added as the FIRST filter-bar item, before
// "All Races", using the same CategoryPills component/CATEGORIES list
// MotoGPLineB already uses (imported from MotoGPContentArea.jsx so both
// stay in sync). category/onCategoryChange are owned by MotoGPContentArea
// (local state, same as every other category-aware MotoGP template) — this
// component only renders the pill and forwards clicks up.
//
// WINNER DATA GAP — /motogp/home-sessions/:seasonId LEFT JOINs to session
// results, so a session with no result yet has a null rider — falls back
// to the current championship points leader only when the round is
// 'ongoing', same rule as F1.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import MatchVideo from '../../shared/MatchVideo'
import { StatusBadge } from '../../EventBlock/EventBlock'
import FullStandingsDrawer from '../../shared/FullStandingsDrawer'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import CategoryPills from '../../shared/CategoryPills'
import { CATEGORIES, sessionLabel } from '../../MotoGP/MotoGPContentArea'
import { classifyByDate, STATUS_LABEL } from '../../../utils/eventStatus'
import { shortGpLabel } from '../../../utils/gpLabel'
import styles from '../f1/f1.module.css'

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
// badge — same helper as HomeF1Template.jsx.
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
const TYPE_OPTIONS = ['Race', 'Sprint', 'Qualifying', 'Practice', 'Warm Up']

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

export default function HomeMotoGPTemplate({ seasonId, year, category, onCategoryChange }) {
  const [rows, setRows] = useState(null)
  const [leader, setLeader] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pageSubtitle, setPageSubtitle] = useState(null)
  const [raceFilter, setRaceFilter] = useState('')
  const [riderFilter, setRiderFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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
    if (!seasonId) { setRows(null); setLeader(null); return }
    let cancelled = false
    setLoading(true)
    Promise.all([
      api.getMotoGPHomeSessions(seasonId).catch(() => null),
      api.getMotoGPStandings(seasonId, 'riders').catch(() => null),
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

  useEffect(() => { setRaceFilter(''); setRiderFilter(''); setTeamFilter(''); setTypeFilter(''); setStatusFilter(''); setExpandedGpIds(new Set()) }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — Home
  // is shared across every sport, resolves at the pure global tier.
  useEffect(() => {
    if (!year) return
    api.getSubtitle(null, null, 'Home', null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  // The single "next" session's round starts pre-expanded and pinned to
  // the top of the list (see the sort below) — see HomeF1Template.jsx's
  // identical block for the full rationale.
  useEffect(() => {
    if (!rows?.length) return
    const nextEntry = classifyByDate(rows, r => r.session_date).find(c => c.status === 'next')
    if (nextEntry) setExpandedGpIds(prev => new Set(prev).add(nextEntry.item.gp_id))
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

  // Next round's group first, then latest session first — session date
  // descending, chronological within a round as a tie-breaker.
  const sorted = [...rows].sort((a, b) => {
    if (nextGpId != null && (a.gp_id === nextGpId) !== (b.gp_id === nextGpId)) {
      return a.gp_id === nextGpId ? -1 : 1
    }
    return new Date(b.session_date) - new Date(a.session_date) || a.display_order - b.display_order
  })

  const raceOptions  = [...new Set(rows.map(r => r.gp_name))].sort()
  const riderOptions = [...new Set(rows.map(r => r.rider_name).filter(Boolean))].sort()
  const teamOptions  = [...new Set(rows.map(r => r.team_name).filter(Boolean))].sort()

  const filtered = sorted.filter(r => {
    if (raceFilter && r.gp_name !== raceFilter) return false
    if (riderFilter && r.rider_name !== riderFilter) return false
    if (teamFilter && r.team_name !== teamFilter) return false
    if (typeFilter && typeBucket(r.session_type) !== typeFilter) return false
    // Only each GP's Race row shows by default — Practice/Qualifying/
    // Sprint/Warm Up siblings stay hidden until their GP is expanded,
    // unless the user explicitly asked for a specific session type.
    if (!typeFilter && r.session_type !== 'RAC' && !expandedGpIds.has(r.gp_id)) return false
    const status = statusBySessionId.get(r.session_id)
    if (statusFilter) return status === statusFilter
    if (raceFilter || riderFilter || teamFilter) return true
    // The pinned "next" round's OTHER sessions must not be hidden by the
    // rule below, or the round's own Race anchor row could vanish.
    if (r.gp_id === nextGpId) return true
    return status !== 'upcoming'
  })

  const hasActiveFilter = raceFilter || riderFilter || teamFilter || typeFilter || statusFilter

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <CategoryPills categories={CATEGORIES} active={category} onChange={onCategoryChange} />
        <select className="filter-label" value={raceFilter} onChange={e => setRaceFilter(e.target.value)}>
          <option value="">All Races</option>
          {raceOptions.map(name => <option key={name} value={name}>{shortGpLabel(name)}</option>)}
        </select>
        <select className="filter-label" value={riderFilter} onChange={e => setRiderFilter(e.target.value)}>
          <option value="">All Riders</option>
          {riderOptions.map(name => <option key={name} value={name}>{name}</option>)}
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
          <button className="filter-reset" onClick={() => { setRaceFilter(''); setRiderFilter(''); setTeamFilter(''); setTypeFilter(''); setStatusFilter('') }}>
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
                      {typeLabel}
                      {r.session_type === 'RAC' && (
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
                        sessionType={typeLabel}
                        tourLabel={CATEGORIES.find(c => c.slug === category)?.label || 'MotoGP'}
                        gpName={shortGpLabel(r.gp_name)}
                        year={year}
                        status={status}
                        sessionDate={r.session_date}
                        fetchResults={fetchMotoGPResults}
                        hideTrigger
                      />
                      {/* Video is tied to the race weekend + category as a
                          whole, not one session — only the Race row shows
                          the button, same rule F1's Home page follows. */}
                      <span className={styles.watchSlot}>
                        {r.session_type === 'RAC' && (
                          <MatchVideo
                            videoUrl={r.video_url}
                            source={r.video_source}
                            embeddable={r.video_embeddable}
                            thumbnailUrl={r.video_thumbnail_url}
                            inline
                            videoId={r.video_id}
                            videoType="motogp_race_video"
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
