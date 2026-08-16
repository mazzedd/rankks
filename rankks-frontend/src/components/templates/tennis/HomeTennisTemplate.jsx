// templates/tennis/HomeTennisTemplate.jsx
//
// ATP/WTA Home hub — one row per tournament edition of the active year,
// across every category that belongs to this tour. Filter bar follows
// HomeF1Template's exact shape: "All Tournaments" and "All Players" are
// DROPDOWNS that filter the one table down to a single tournament/player
// (same role as F1's "All Races"/"All Drivers" selects), not a view
// toggle — an earlier version wrongly built them as a two-view pill switch
// instead of matching the reference template (corrected 2026-08-09).
// "All Players" is a SearchableSelect (not a plain <select>) — the tour's
// full player list is long enough that scrolling a native dropdown to find
// one name is slow (Mohamed 2026-08-16).
//
// WINNER/RUNNER-UP — the backend (/competitions/home/:tour/:year) resolves
// these from the singles draw's Final-round game. Team events (Various —
// World Team Cup/Championship) come back with winner/runner_up always
// null: that data is stored as individual round-robin rubbers with no
// single team/tie result anywhere, so rather than guess, those rows show
// "—" (confirmed with Mohamed rather than fabricating a team result).
//
// STATUS — per-row StatusBadge (Past/Ongoing/Next/Future), positioned right
// before the Full Results/Watch actions column, same classification
// (getStatus + is_next) the filter pills use.
//
// FULL RESULTS — opens TennisResultsDrawer (slide-in from the right, same
// mechanism as F1/MotoGP's "Full Standings"), not a navigation away from
// this page.
//
// Latest event first (start_date descending) — undated rows (a future
// tournament with no schedule yet, e.g. Next Gen Finals before ATP
// publishes dates) sort as if "latest", since they represent something
// further out than every dated row.
import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import MatchVideo from '../../shared/MatchVideo'
import TennisResultsDrawer from '../../shared/TennisResultsDrawer'
import SearchableSelect from '../../shared/SearchableSelect'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { StatusBadge, getStatus } from '../../EventBlock/EventBlock'
import { STATUS_LABEL } from '../../../utils/eventStatus'
import { fmtDateRange } from '../../../utils/calcAge'
import styles from '../f1/f1.module.css'

const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

function displayStatus(row) {
  const s = getStatus(row)
  if (s !== 'future') return s
  return row.is_next ? 'next' : 'upcoming'
}

export default function HomeTennisTemplate({ tour }) {
  const { activeYear, setYearRange } = useAppStore()
  // Same key format TennisResultsDrawer builds internally
  // (`tennis-results:${seasonId}:${tabKey}`) — clicking the event name
  // opens the exact same drawer instance the row mounts (hidden trigger)
  // below.
  const openVideo = useVideoPlayerStore(s => s.openVideo)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pageSubtitle, setPageSubtitle] = useState(null)
  const [eventFilter, setEventFilter] = useState('')
  const [playerFilter, setPlayerFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getTennisHome(tour, activeYear)
      .then(d => {
        if (cancelled) return
        setData(d)
        if (d) setYearRange({ minYear: d.min_year, maxYear: d.max_year, editionYears: undefined })
      })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tour, activeYear])

  useEffect(() => { setEventFilter(''); setPlayerFilter(''); setCountryFilter(''); setSurfaceFilter(''); setTypeFilter(''); setStatusFilter('') }, [tour, activeYear])

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — Home
  // is shared across every sport, resolves at the pure global tier.
  useEffect(() => {
    if (!activeYear) return
    api.getSubtitle(null, null, 'Home', null, activeYear)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [activeYear])

  // Breadcrumb — "ATP I 2026 I Home [status]", same Tour/Year/LineA/status
  // shape F1ContentArea builds for HomeF1Template, just computed here
  // instead of in the parent: ContentArea.jsx has no season/rows data of
  // its own for the ATP/WTA hub (unlike F1ContentArea, which already
  // fetches seasonData), so status is derived from this template's own
  // fetched rows instead of being passed down as a prop.
  const tourLabel = tour === 'wta' ? 'WTA' : 'ATP'
  const rows = data?.rows || []
  const homeStatus = rows.length ? (() => {
    const now = new Date()
    const hasPast   = rows.some(r => r.end_date && new Date(r.end_date) < now)
    const hasFuture = rows.some(r => r.start_date && new Date(r.start_date) >= now)
    return hasPast && hasFuture ? 'ongoing' : hasPast ? 'past' : 'upcoming'
  })() : null
  const breadcrumb = (
    <>
      {tourLabel} I <span className="page-title-year">{activeYear}</span> I Home
      {homeStatus && <> <StatusBadge status={homeStatus} /></>}
    </>
  )

  if (loading) return <div className={styles.wrap}><div className="page-title">{breadcrumb}</div><Skeleton /></div>
  if (!rows.length) return <div className={styles.wrap}><div className="page-title">{breadcrumb}</div><Empty year={activeYear} /></div>


  // Latest first — undated rows (Infinity) sort to the very top, ahead of
  // every dated row, since they represent something further out in time
  // than anything with a confirmed schedule yet.
  const sorted = [...rows].sort((a, b) => {
    const ta = a.start_date ? new Date(a.start_date).getTime() : Infinity
    const tb = b.start_date ? new Date(b.start_date).getTime() : Infinity
    return tb - ta
  })

  const eventOptions = [...new Set(rows.map(r => r.competition_name))].sort()
  const playerOptions = [...new Set(rows.flatMap(r => [r.winner?.name, r.runner_up?.name]).filter(Boolean))].sort()
  // Count finalist APPEARANCES per country (winner + runner-up slots
  // across the year's events), not distinct players — a player who reached
  // multiple finals counts once per final, same as this table has one row
  // per event. Unlike the draw page's "All Countries" (distinct players in
  // one draw), this is a season-wide finals tally.
  const countryCounts = new Map()
  rows.forEach(r => {
    if (r.winner?.country) countryCounts.set(r.winner.country, (countryCounts.get(r.winner.country) || 0) + 1)
    if (r.runner_up?.country) countryCounts.set(r.runner_up.country, (countryCounts.get(r.runner_up.country) || 0) + 1)
  })
  const countryOptions = [...countryCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const surfaceOptions = [...new Set(rows.map(r => r.surface).filter(Boolean))].sort()
  const typeOptions = [...new Map(rows.map(r => [r.category_short_name, r.category_display_order])).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name)

  const filtered = sorted.filter(r => {
    if (eventFilter && r.competition_name !== eventFilter) return false
    if (playerFilter && r.winner?.name !== playerFilter && r.runner_up?.name !== playerFilter) return false
    if (countryFilter && r.winner?.country !== countryFilter && r.runner_up?.country !== countryFilter) return false
    if (surfaceFilter && r.surface !== surfaceFilter) return false
    if (typeFilter && r.category_short_name !== typeFilter) return false
    if (statusFilter) return displayStatus(r) === statusFilter
    // No explicit filter picked — same default HomeF1Template uses: only
    // show Past/Ongoing/Next, hide the long tail of far-future events.
    // Click the Future status pill (or pick a specific event/player/
    // country/surface/type) to see them.
    if (eventFilter || playerFilter || countryFilter || surfaceFilter || typeFilter) return true
    return displayStatus(r) !== 'upcoming'
  })

  const hasActiveFilter = eventFilter || playerFilter || countryFilter || surfaceFilter || typeFilter || statusFilter
  const clearFilters = () => { setEventFilter(''); setPlayerFilter(''); setCountryFilter(''); setSurfaceFilter(''); setTypeFilter(''); setStatusFilter('') }

  // Same convention as HomeF1Template: the Past/Ongoing/Next/Future pills
  // only make sense when at least one event this year isn't already
  // decided — a fully past year (nothing ongoing/next/future) has nothing
  // for them to filter, so hide the row entirely instead of showing dead
  // controls.
  const hasNonPastStatus = rows.some(r => displayStatus(r) !== 'past')

  return (
    <div className={styles.wrap}>
      <div className="page-title">{breadcrumb}</div>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <select className="filter-label" value={eventFilter} onChange={e => setEventFilter(e.target.value)}>
          <option value="">All Tournaments</option>
          {eventOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <SearchableSelect
          value={playerFilter}
          onChange={setPlayerFilter}
          options={playerOptions.map(name => ({ value: name, label: name }))}
          allLabel="All Players"
        />
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All Countries</option>
          {countryOptions.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
        </select>
        <select className="filter-label" value={surfaceFilter} onChange={e => setSurfaceFilter(e.target.value)}>
          <option value="">All Surfaces</option>
          {surfaceOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="filter-label" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Sort by:</option>
          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
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
          <button className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{filtered.length} events</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              <th className="table-label" style={{ textAlign: 'left', width: '17%', whiteSpace: 'nowrap' }}>Date</th>
              <th className="table-label" style={{ textAlign: 'left', width: '18%' }}>Tournament</th>
              <th className="table-label" style={{ textAlign: 'left', width: '10%' }}>Type</th>
              <th className="table-label" style={{ textAlign: 'left', width: '14%' }}>Winner</th>
              <th className="table-label" style={{ textAlign: 'left', width: '14%' }}>Runner-up</th>
              <th className="table-label" style={{ textAlign: 'center', width: '11%' }}>Status</th>
              <th className="table-label" style={{ textAlign: 'right', width: '16%' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const tabKey = `draw-singles-${tour === 'wta' ? 'f' : 'm'}`
              return (
                <tr key={`${r.competition_id}-${r.year}`} className={`table-row ${styles.homeRow}`} style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className="stats-light" style={{ textAlign: 'left', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{fmtDateRange(r.start_date, r.end_date)}</td>
                  <td className="stats-light" style={{ textAlign: 'left', fontWeight: 700, verticalAlign: 'top' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
                      <Flag iso2={r.competition_iso2} name={r.competition_country} className="flag" />
                      <button
                        type="button"
                        className={styles.nameLink}
                        onClick={() => openVideo(`tennis-results:${r.season_id}:${tabKey}`)}
                      >
                        {r.competition_name}
                      </button>
                    </span>
                    <TennisResultsDrawer seasonId={r.season_id} tabKey={tabKey} tour={tour} competitionName={r.competition_name} year={r.year} status={displayStatus(r)} startDate={r.start_date} endDate={r.end_date} hideTrigger />
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', verticalAlign: 'top' }}>{r.category_short_name}</td>
                  <td className="stats-light" style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    <PersonCell person={r.winner} highlight={playerFilter} />
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    <PersonCell person={r.runner_up} highlight={playerFilter} />
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'top' }}>
                    <StatusBadge status={displayStatus(r)} />
                  </td>
                  <td style={{ textAlign: 'right', verticalAlign: 'top' }}>
                    <div className={styles.actionsRow}>
                      <span className={styles.watchSlot}>
                        {r.video?.url && (
                          <MatchVideo
                            videoUrl={r.video.url}
                            source={r.video.source}
                            embeddable={r.video.embeddable}
                            thumbnailUrl={r.video.thumbnail_url}
                            inline
                            videoId={r.video.id}
                            videoType="media"
                            title="Final"
                            subtitle={`${r.competition_name} ${r.year}`}
                          />
                        )}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PersonCell({ person, highlight }) {
  if (!person) return '—'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
      <Flag iso2={person.iso2} name={person.country} className="flag" />
      <span className={highlight && person.name === highlight ? styles.sortRowsHighlight : undefined}>{person.name}</span>
    </span>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(6)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty({ year }) {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No tournament data available{year ? ` for ${year}` : ''}.</div>
}
