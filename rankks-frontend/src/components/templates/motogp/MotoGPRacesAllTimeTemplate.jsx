// templates/motogp/MotoGPRacesAllTimeTemplate.jsx
// All-Time > Race Stats — per-Grand-Prix career records "through <year>".
// Same shape as F1RacesAllTimeTemplate.jsx: each row is a Grand Prix
// (grouped by slug, the stable cross-season identity — see
// /motogp/races-all-time/:seasonId's comment), with 1st GP / Nb of races /
// Greater Wins/Poles/Sprint Wins record-holder columns.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import DeceasedMark from '../../shared/DeceasedMark'
import MotoGPGPHistoryDrawer from '../../shared/MotoGPGPHistoryDrawer'
import SearchableSelect from '../../shared/SearchableSelect'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { shortGpLabel } from '../../../utils/gpLabel'
import styles from '../f1/f1.module.css'

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

// Same display labels as CategoryPills/MotoGPContentArea's CATEGORIES —
// duplicated here as a tiny literal map (rather than importing across
// from components/MotoGP/) since this page only has the category as a
// plain slug string off the fetched `data`, not the pill-switcher state.
const CATEGORY_LABEL = { motogp: 'Moto GP', moto2: 'Moto 2', moto3: 'Moto 3' }

// Sort dropdown limited to the 3 record columns (Wins/Poles/Sprint Wins),
// same convention as F1RacesAllTimeTemplate.jsx — Nb of races/1st GP are
// still shown as table columns and still drive the default (no-sort)
// ordering below, they just aren't offered as explicit sort options.
// Sprint format didn't exist before 2023 (confirmed via motogp_sessions —
// first SPR session_type row is 2023) — filtered against the selected
// year where used below, same "through <year>" pattern as F1's own
// 2021 sprint cutoff.
const SORT_OPTIONS = [
  { key: 'poles',       label: 'Poles' },
  { key: 'sprint_wins', label: 'Sprint Wins' },
  { key: 'wins',        label: 'Wins' },
]

function statValue(race, key) {
  if (key === 'race_count') return race.stats.race_count
  if (key === 'first_year') return race.first_year
  if (key === 'wins') return race.stats.greater_wins?.count || 0
  if (key === 'poles') return race.stats.greater_poles?.count || 0
  if (key === 'sprint_wins') return race.stats.greater_sprint_wins?.count || 0
  return 0
}

function getName(r) { return (r.name || '').toLowerCase() }

const PAGE_SIZE = 25

function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

function RecordCell({ record, highlightRider, year }) {
  if (!record) return <span className="cell-meta">—</span>
  const isHighlighted = highlightRider && record.rider_name === highlightRider
  return (
    <span className={styles.recordInline}>
      <Flag iso2={record.country_iso2} name={record.rider_name} className={styles.gpFlag} />
      <span className={`${styles.recordName} ${isHighlighted ? styles.nameHighlight : ''}`}>
        {record.rider_name}
        {showDeceasedMark(record.death_date, year) && <DeceasedMark />}
      </span>
      <span className="cell-meta">{record.count}</span>
    </span>
  )
}

function raceMatchesRider(race, riderName) {
  return race.stats.greater_wins?.rider_name === riderName
    || race.stats.greater_poles?.rider_name === riderName
    || race.stats.greater_sprint_wins?.rider_name === riderName
}

// Country filter is scoped to the RECORD-HOLDING RIDERS' nationality (Wins/
// Poles/Sprint Wins), not the Grand Prix's own location — 2026-08-10:
// "want to see countries of riders having a record either for Wins, Poles
// or Sprints" (the GP-location flag next to the Grand Prix name column is
// untouched, this only changes what the "All Countries" filter matches).
function raceMatchesCountry(race, iso2, includeSprintHolder) {
  return race.stats.greater_wins?.country_iso2 === iso2
    || race.stats.greater_poles?.country_iso2 === iso2
    || (includeSprintHolder && race.stats.greater_sprint_wins?.country_iso2 === iso2)
}

export default function MotoGPRacesAllTimeTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [riderFilter, setRiderFilter]     = useState('')
  const [showActive, setShowActive]       = useState(false)
  const [showDefunct, setShowDefunct]     = useState(false)
  const [sortStat, setSortStat]           = useState('')
  const [page, setPage]                   = useState(1)
  // Same key format MotoGPGPHistoryDrawer builds internally
  // (`motogp-gp-history:${slug}:${year}:${category}`) — clicking the GP
  // name opens the exact same drawer instance the row mounts (hidden
  // trigger) below.
  const openVideo = useVideoPlayerStore(s => s.openVideo)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getMotoGPRacesAllTime(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  // Admin-configured subtitle line — see MotoGPRidersAllTimeTemplate.jsx's
  // identical block for the full rationale.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!data?.year) return
    api.getSubtitle('car-racing', 'motogp', 'Totals', 'Race Stats', data.year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [data?.year])

  useEffect(() => { setSearch(''); setCountryFilter(''); setRiderFilter(''); setShowActive(false); setShowDefunct(false); setSortStat(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, countryFilter, riderFilter, showActive, showDefunct, sortStat])

  if (loading) return <Skeleton />
  if (!data?.races?.length) return <Empty />

  // Sprint format didn't exist before 2023 — hide the column (and its
  // sort option / filter entries) entirely for seasons through 2022,
  // rather than showing an all-dashes column. Same convention as
  // F1RacesAllTimeTemplate.jsx's showSprintCol (2020 cutoff there).
  const showSprintCol = data.year > 2022
  const sortOptions = showSprintCol ? SORT_OPTIONS : SORT_OPTIONS.filter(o => o.key !== 'sprint_wins')

  const countries = [...new Map(
    data.races.flatMap(r => [r.stats.greater_wins, r.stats.greater_poles, showSprintCol ? r.stats.greater_sprint_wins : null]
      .filter(rec => rec?.country_iso2)
      .map(rec => [rec.country_iso2, rec.country_name || rec.country_iso2]))
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const riders = [...new Set(data.races.flatMap(r => [
    r.stats.greater_wins?.rider_name,
    r.stats.greater_poles?.rider_name,
    showSprintCol ? r.stats.greater_sprint_wins?.rider_name : null,
  ].filter(Boolean)))].sort((a, b) => a.localeCompare(b))

  // Active = still on the REAL current calendar for this category
  // (is_current_calendar, from the backend — independent of the "through
  // <year>" being viewed AND of whether that edition has actually run
  // yet). Defunct = not on it. Independent toggle tags, not a radio
  // group, same convention as the Active/Retired pills on Rider/Team Stats.
  const isActiveGP = r => r.is_current_calendar
  const onlyActive  = showActive && !showDefunct
  const onlyDefunct = showDefunct && !showActive

  let rows = data.races.filter(r => {
    if (search && !r.name?.toLowerCase().includes(search.toLowerCase())) return false
    if (countryFilter && !raceMatchesCountry(r, countryFilter, showSprintCol)) return false
    if (riderFilter && !raceMatchesRider(r, riderFilter)) return false
    if (onlyActive && !isActiveGP(r)) return false
    if (onlyDefunct && isActiveGP(r)) return false
    return true
  })

  if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const asc = sortStat === 'first_year'
      const d = asc
        ? statValue(a, sortStat) - statValue(b, sortStat)
        : statValue(b, sortStat) - statValue(a, sortStat)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    rows = [...rows].sort((a, b) => {
      const byRaces = b.stats.race_count - a.stats.race_count
      if (byRaces !== 0) return byRaces
      const byYear = a.first_year - b.first_year
      if (byYear !== 0) return byYear
      return getName(a).localeCompare(getName(b))
    })
  }

  const hasActiveFilter = search || countryFilter || riderFilter || showActive || showDefunct || sortStat
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="search Grand Prix" value={search} onChange={e => setSearch(e.target.value)} />
        <SearchableSelect
          value={riderFilter}
          onChange={setRiderFilter}
          options={riders.map(name => ({ value: name, label: name }))}
          allLabel="All Riders"
        />
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(([iso2, name]) => <option key={iso2} value={iso2}>{name}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <div className={styles.statusToggle}>
          <button
            type="button"
            className={`${styles.statusBtn} ${showActive ? styles.statusBtnActive : ''}`}
            onClick={() => setShowActive(v => !v)}
          >
            Active GP
          </button>
          <button
            type="button"
            className={`${styles.statusBtn} ${showDefunct ? styles.statusBtnActive : ''}`}
            onClick={() => setShowDefunct(v => !v)}
          >
            Defunct GP
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setCountryFilter(''); setRiderFilter(''); setShowActive(false); setShowDefunct(false); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} races</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.pos}></th>
              <th className="table-label" style={th('left')}>Grand Prix</th>
              <th className="table-label" style={th('center')}>GP Time Span</th>
              <th className={`table-label ${sorted('race_count')}`} style={th('center')}>Nb of races</th>
              <th className={`table-label ${sorted('wins')}`} style={th('left')}>Most Wins</th>
              <th className={`table-label ${sorted('poles')}`} style={th('left')}>Most Poles</th>
              {showSprintCol && <th className={`table-label ${sorted('sprint_wins')}`} style={th('left')}>Most Sprint Wins</th>}
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((r, i) => {
              const globalRank = pageStart + i + 1
              return (
                <tr key={r.slug} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos}><span className="event-rank">{globalRank}</span></td>
                  <td>
                    <div className={styles.gpCell}>
                      <Flag iso2={r.country_iso2} name={r.country_name} className={styles.gpFlag} />
                      <button
                        type="button"
                        className={`${styles.gpName} ${styles.nameLinkPlain}`}
                        onClick={() => openVideo(`motogp-gp-history:${r.slug}:${data.year}:${data.category}`)}
                      >
                        {shortGpLabel(r.name)}
                      </button>
                      <MotoGPGPHistoryDrawer slug={r.slug} year={data.year} category={data.category} categoryLabel={CATEGORY_LABEL[data.category] || 'MotoGP'} gpName={r.name} hideTrigger />
                    </div>
                  </td>
                  <td className="stats-light" style={td('center')}>{r.first_year}-{r.is_current_calendar ? 'pres.' : r.last_year}</td>
                  <td className={`stats-light ${sorted('race_count')}`} style={td('center')}>{r.stats.race_count}</td>
                  <td className={sorted('wins')} style={td('left')}><RecordCell record={r.stats.greater_wins} highlightRider={riderFilter} year={data.year} /></td>
                  <td className={sorted('poles')} style={td('left')}><RecordCell record={r.stats.greater_poles} highlightRider={riderFilter} year={data.year} /></td>
                  {showSprintCol && <td className={sorted('sprint_wins')} style={td('left')}><RecordCell record={r.stats.greater_sprint_wins} highlightRider={riderFilter} year={data.year} /></td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

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
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(8)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No race data available.</div>
}
