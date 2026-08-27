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
import TennisResultsDrawer from '../../shared/TennisResultsDrawer'
import SearchableSelect from '../../shared/SearchableSelect'
import MultiCheckSelect from '../../shared/MultiCheckSelect'
import ChevronIcon from '../../shared/ChevronIcon'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { getStatus } from '../../EventBlock/EventBlock'
import { STATUS_LABEL } from '../../../utils/eventStatus'
import { CONTINENTS, continentForIso2 } from '../../../utils/countryContinent'
import styles from '../f1/f1.module.css'

const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

function displayStatus(row) {
  const s = getStatus(row)
  if (s !== 'future') return s
  return row.is_next ? 'next' : 'upcoming'
}

// Same hex values EventBlock.module.css's .status_past/_ongoing/_next/
// _upcoming pills use — rounded dots here instead of pills (Mohamed
// 2026-08-24: "pills become rounded dot, same color").
const STATUS_DOT_COLOR = { past: '#9e9e9e', ongoing: '#4caf52', next: '#ff8c00', upcoming: '#ffb400' }

function StatusDot({ status }) {
  return <span className={styles.eventStatusDot} style={{ background: STATUS_DOT_COLOR[status] }} title={STATUS_LABEL[status]} />
}

// This table's own date format (Mohamed 2026-08-24: "Date format is: 25.05
// I 29.05 2026 (repeat month even is tournament start/end is in the same
// month)") — always shows both DD.MM in full, never the shared
// fmtDateRange() utility's "25–29.05.2026" shared-month shorthand.
function fmtEventDateRange(startStr, endStr) {
  if (!startStr) return '—'
  const start = new Date(startStr)
  const end = endStr ? new Date(endStr) : start
  if (isNaN(start) || isNaN(end)) return '—'
  const pad = n => String(n).padStart(2, '0')
  const startDay = pad(start.getDate())
  const startMonth = pad(start.getMonth() + 1)
  const endDay = pad(end.getDate())
  const endMonth = pad(end.getMonth() + 1)
  const year = end.getFullYear()
  if (start.getTime() === end.getTime()) return `${startDay}.${startMonth} ${year}`
  return `${startDay}.${startMonth} I ${endDay}.${endMonth} ${year}`
}

// "In X days" under the date, NEXT/FUTURE status only — same wording
// HomepageTemplate.jsx's own daysUntilLabel uses (Mohamed 2026-08-24: "add
// in 4 days underneath date, align left").
function daysUntilLabel(status, dateStr) {
  if (status !== 'next' && status !== 'upcoming') return null
  if (!dateStr) return null
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((target - today) / 86400000)
  if (days <= 0) return null
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
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
  const [playerFilter, setPlayerFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  // Sets, not single strings (Mohamed 2026-08-24: "All Surfaces becomes a
  // check box (can select 1 or more options)" / "Add All Categories...
  // which is a select box: 1 or more check options") — MultiCheckSelect's
  // own shape, see that component's comment.
  const [surfaceFilter, setSurfaceFilter] = useState(() => new Set())
  const [categoryFilter, setCategoryFilter] = useState(() => new Set())
  // Continent of the tournament's host country (Mohamed 2026-08-25: "After
  // All Categories, add All Areas (Africa, Asia, Europe, Oceania, North
  // America, South-America) - one or more options") — see
  // utils/countryContinent.js for the iso2 -> continent lookup.
  const [areaFilter, setAreaFilter] = useState(() => new Set())
  // Set too, not a single string (Mohamed 2026-08-24: "4 pills can be
  // aggregated").
  const [statusFilter, setStatusFilter] = useState(() => new Set())
  // Date column sort direction (Mohamed 2026-08-25: "On Date label: add an
  // arrow enabling user to sort latest to recent") — 'desc' (latest first)
  // is the existing default; the arrow toggles to 'asc' (earliest first).
  const [dateSortDir, setDateSortDir] = useState('desc')

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

  useEffect(() => { setPlayerFilter(''); setCountryFilter(''); setSurfaceFilter(new Set()); setCategoryFilter(new Set()); setAreaFilter(new Set()); setStatusFilter(new Set()) }, [tour, activeYear])

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — this
  // template backs the Schedule page now, not the blank Home page, so the
  // catalog lookup key is 'Schedule', not 'Home'. Global tier row doesn't
  // exist in the DB yet (this environment has no DB write access to seed
  // it — see chat for the pgAdmin INSERT), so falls back to the literal
  // text locally for now (Mohamed 2026-08-25, 3rd ask: "Add a subtile:
  // Full Schedule and Results + extension - 2026") — once the real catalog
  // row is added, api.getSubtitle's real response takes over automatically
  // and this fallback stops being used.
  const SCHEDULE_SUBTITLE_FALLBACK = `Full Schedule and Results - ${activeYear}`
  useEffect(() => {
    if (!activeYear) return
    api.getSubtitle(null, null, 'Schedule', null, activeYear)
      .then(d => setPageSubtitle(d?.subtitle || SCHEDULE_SUBTITLE_FALLBACK))
      .catch(() => setPageSubtitle(SCHEDULE_SUBTITLE_FALLBACK))
  }, [activeYear]) // eslint-disable-line react-hooks/exhaustive-deps

  // Breadcrumb ("ATP I 2026 I Home [status]") now lives in TennisHomeBlock's
  // own banner card (EventBlock.jsx — Mohamed 2026-08-24: "Place breadcrumb
  // in title Box"), not as a separate .page-title row here.
  const rows = data?.rows || []

  if (loading) return <div className={styles.wrap}><Skeleton /></div>
  if (!rows.length) return <div className={styles.wrap}><Empty year={activeYear} /></div>


  // Latest first by default — undated rows (Infinity) sort to the very top
  // ahead of every dated row, since they represent something further out
  // in time than anything with a confirmed schedule yet. dateSortDir
  // flips this to earliest-first (Mohamed 2026-08-25: "On Date label: add
  // an arrow enabling user to sort latest to recent").
  const sorted = [...rows].sort((a, b) => {
    const ta = a.start_date ? new Date(a.start_date).getTime() : Infinity
    const tb = b.start_date ? new Date(b.start_date).getTime() : Infinity
    return dateSortDir === 'desc' ? tb - ta : ta - tb
  })

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

  // Counts for Surfaces/Categories/Areas — each one's counts reflect the
  // OTHER two active facet filters, never its own current selection, same
  // OTHER-facets-only convention players_template.jsx's positionCounts/
  // clubCounts/countryCounts already use (Mohamed 2026-08-19: "All
  // Surfaces, All Categories and All Areas must 'concatenate' counts... If
  // All Cat = Master 1000 and then selec All Surfaces = clay, Surf count
  // should show only clay within the cat Master 1000" — supersedes the
  // 2026-08-25 "count from this year's unfiltered rows" version). Player/
  // Country/status stay out of this cross-filtering, same as before.
  const matchesSurfaceFacet  = r => !surfaceFilter.size || surfaceFilter.has(r.surface)
  const matchesCategoryFacet = r => !categoryFilter.size || categoryFilter.has(r.category_short_name)
  const matchesAreaFacet     = r => !areaFilter.size || areaFilter.has(continentForIso2(r.competition_iso2))

  const rowsForSurfaceOptions  = rows.filter(r => matchesCategoryFacet(r) && matchesAreaFacet(r))
  const rowsForCategoryOptions = rows.filter(r => matchesSurfaceFacet(r) && matchesAreaFacet(r))
  const rowsForAreaOptions     = rows.filter(r => matchesSurfaceFacet(r) && matchesCategoryFacet(r))

  const surfaceCounts = new Map()
  rowsForSurfaceOptions.forEach(r => { if (r.surface) surfaceCounts.set(r.surface, (surfaceCounts.get(r.surface) || 0) + 1) })
  const surfaceOptions = [...surfaceCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const categoryCounts = new Map()
  rowsForCategoryOptions.forEach(r => { if (r.category_short_name) categoryCounts.set(r.category_short_name, (categoryCounts.get(r.category_short_name) || 0) + 1) })
  const categoryOptions = [...new Map(rows.map(r => [r.category_short_name, r.category_display_order])).entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => [name, categoryCounts.get(name) || 0])

  const areaCounts = new Map()
  rowsForAreaOptions.forEach(r => {
    const continent = continentForIso2(r.competition_iso2)
    if (continent) areaCounts.set(continent, (areaCounts.get(continent) || 0) + 1)
  })
  // Fixed 6-item list (see CONTINENTS' own comment) — every continent
  // shown regardless of count, including (0), not just the ones present.
  const areaOptions = CONTINENTS.map(name => [name, areaCounts.get(name) || 0])

  const filtered = sorted.filter(r => {
    if (playerFilter && r.winner?.name !== playerFilter && r.runner_up?.name !== playerFilter) return false
    if (countryFilter && r.winner?.country !== countryFilter && r.runner_up?.country !== countryFilter) return false
    if (surfaceFilter.size && !surfaceFilter.has(r.surface)) return false
    if (categoryFilter.size && !categoryFilter.has(r.category_short_name)) return false
    if (areaFilter.size && !areaFilter.has(continentForIso2(r.competition_iso2))) return false
    // Pills OR together now, not exclusive (Mohamed 2026-08-24: "4 pills
    // can be aggregated" — Past+Ongoing both checked shows either).
    if (statusFilter.size) return statusFilter.has(displayStatus(r))
    // No explicit filter picked — same default HomeF1Template uses: only
    // show Past/Ongoing/Next, hide the long tail of far-future events.
    // Click a status pill (or pick a specific player/country/surface/
    // category) to see them.
    if (playerFilter || countryFilter || surfaceFilter.size || categoryFilter.size || areaFilter.size) return true
    return displayStatus(r) !== 'upcoming'
  })

  // !! so this is a real boolean, not a number — {hasActiveFilter && <button>}
  // rendered a stray literal "0" whenever every filter was empty (surfaceFilter.size
  // etc. are 0, and `... || 0` evaluates to 0 itself, not false, which React
  // then prints as text instead of rendering nothing).
  const hasActiveFilter = !!(playerFilter || countryFilter || surfaceFilter.size || categoryFilter.size || areaFilter.size || statusFilter.size)
  const clearFilters = () => { setPlayerFilter(''); setCountryFilter(''); setSurfaceFilter(new Set()); setCategoryFilter(new Set()); setAreaFilter(new Set()); setStatusFilter(new Set()) }

  // Same convention as HomeF1Template: the Past/Ongoing/Next/Future pills
  // only make sense when at least one event this year isn't already
  // decided — a fully past year (nothing ongoing/next/future) has nothing
  // for them to filter, so hide the row entirely instead of showing dead
  // controls.
  const hasNonPastStatus = rows.some(r => displayStatus(r) !== 'past')

  return (
    <div className={styles.wrap}>
      {/* pageSubtitle resolves through the admin Subtitles catalog
          (api.getSubtitle above) — a "Schedule - 2026" line needs a
          catalog row added for ('Home', tennis, this year) via the admin
          panel, not a hardcoded string here (see CLAUDE.md's page-subtitle
          rule). */}
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        {/* "All Tournaments" removed (Mohamed 2026-08-24: "Remove All
            Tournaments"). */}
        <SearchableSelect
          value={playerFilter}
          onChange={setPlayerFilter}
          options={playerOptions.map(name => ({ value: name, label: name }))}
          allLabel="All Players"
        />
        {/* Searchable now (Mohamed 2026-08-24: "All Countries (add search
            feat.)"). */}
        <SearchableSelect
          value={countryFilter}
          onChange={setCountryFilter}
          options={countryOptions.map(([name, count]) => ({ value: name, label: `${name} (${count})` }))}
          allLabel="All Countries"
        />
        {/* Multi-select checkboxes now (Mohamed 2026-08-24: "All Surfaces
            becomes a check box (can select 1 or more options)"). */}
        <MultiCheckSelect
          values={surfaceFilter}
          onChange={setSurfaceFilter}
          options={surfaceOptions.map(([name, count]) => ({ value: name, label: `${name} (${count})` }))}
          allLabel="All Surfaces"
        />
        {/* Replaces the old mislabeled "Sort by:" select, which actually
            filtered by category, not sorted anything (Mohamed 2026-08-24:
            "Remove Sort by:" / "Add All Categories (Grand Slam, etc.)
            which is a select box: 1 or more check options"). */}
        <MultiCheckSelect
          values={categoryFilter}
          onChange={setCategoryFilter}
          options={categoryOptions.map(([name, count]) => ({ value: name, label: `${name} (${count})` }))}
          allLabel="All Categories"
        />
        {/* Continent of the host country (Mohamed 2026-08-25: "After All
            Categories, add All Areas (Africa, Asia, Europe, Oceania, North
            America, South-America) - one or more options") — fixed 6-item
            list (not derived from this year's rows, unlike Surfaces/
            Categories above), since the point is browsing by world region
            regardless of which ones happen to have an event this year. */}
        <MultiCheckSelect
          values={areaFilter}
          onChange={setAreaFilter}
          options={areaOptions.map(([name, count]) => ({ value: name, label: `${name} (${count})` }))}
          allLabel="All Areas"
        />
        {hasNonPastStatus && (
          <div className={styles.statusToggle}>
            {/* Colored per status (Mohamed 2026-08-24: "4 pills: make CSS
                color (grey, green, orange and yellow)") and toggle-able
                independently — clicking one no longer clears the others
                ("4 pills can be aggregated"). */}
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
          <button className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{filtered.length} events</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              {/* Status moved here, before Date, as a dot instead of the
                  removed pill column (Mohamed 2026-08-24: "Remove status
                  col" / "Add the status col before date: pills become
                  rounded dot, same color"). */}
              <th className="table-label" style={{ textAlign: 'center', width: '4%' }}></th>
              <th className="table-label" style={{ textAlign: 'left', width: '16%', whiteSpace: 'nowrap' }}>
                {/* Sort arrow (Mohamed 2026-08-25: "On Date label: add an
                    arrow enabling user to sort latest to recent" then "use
                    the arrow (homepage for expandable tables)" — same
                    ChevronIcon HomepageTemplate.jsx's league boxes use, not
                    a unicode ▲/▼ glyph). desc (latest first) points down,
                    same "expanded" resting direction the homepage chevron
                    uses; asc rotates it to point up. */}
                <button
                  type="button"
                  className={styles.sortableHeader}
                  onClick={() => setDateSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                  title={dateSortDir === 'desc' ? 'Latest first — click for earliest first' : 'Earliest first — click for latest first'}
                >
                  Date <ChevronIcon open={dateSortDir === 'asc'} size={10} className={styles.sortArrow} />
                </button>
              </th>
              <th className="table-label" style={{ textAlign: 'left', width: '20%' }}>Tournament</th>
              {/* "Type" -> "Category" (Mohamed 2026-08-24: "Label type
                  becomes Category"). */}
              <th className="table-label" style={{ textAlign: 'left', width: '12%' }}>Category</th>
              <th className="table-label" style={{ textAlign: 'left', width: '16%' }}>Winner</th>
              <th className="table-label" style={{ textAlign: 'left', width: '16%' }}>Runner-up</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const tabKey = `draw-singles-${tour === 'wta' ? 'f' : 'm'}`
              const status = displayStatus(r)
              const daysLabel = daysUntilLabel(status, r.start_date)
              return (
                <tr key={`${r.competition_id}-${r.year}`} className={`table-row ${styles.homeRow}`} style={{ animationDelay: `${i * 0.03}s` }}>
                  <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: 6 }}>
                    <StatusDot status={status} />
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    <div>{fmtEventDateRange(r.start_date, r.end_date)}</div>
                    {daysLabel && <div className={styles.eventDateRelative}>{daysLabel}</div>}
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', fontWeight: 700, verticalAlign: 'top' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Flag iso2={r.competition_iso2} name={r.competition_country} className="flag" />
                      <button
                        type="button"
                        className={styles.nameLink}
                        onClick={() => openVideo(`tennis-results:${r.season_id}:${tabKey}`)}
                      >
                        {r.competition_name}
                      </button>
                    </span>
                    {r.competition_country && <div className={styles.eventDateRelative}>{r.competition_country}</div>}
                    <TennisResultsDrawer seasonId={r.season_id} tabKey={tabKey} tour={tour} competitionName={r.competition_name} year={r.year} status={status} startDate={r.start_date} endDate={r.end_date} hideTrigger />
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    <div>{r.category_short_name}</div>
                    {r.surface && <div className={styles.eventDateRelative}>{r.surface}</div>}
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    <PersonCell person={r.winner} highlight={playerFilter} />
                  </td>
                  <td className="stats-light" style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    <PersonCell person={r.runner_up} highlight={playerFilter} />
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

// white-space:nowrap (Mohamed 2026-08-24: "player's name, no break, one
// line only") — Winner/Runner-up are fixed 14%-width columns
// (.fixedTable), narrow enough for a long name to wrap to 2 lines without it.
function PersonCell({ person, highlight }) {
  if (!person) return '—'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
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
