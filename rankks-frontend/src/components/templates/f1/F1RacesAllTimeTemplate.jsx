// templates/f1/F1RacesAllTimeTemplate.jsx
// All-Time > Race Stats — per-Grand-Prix career records "through <year>".
// Backed by /f1/races-all-time/:seasonId, which groups every
// f1_grands_prix row by slug (the stable cross-season GP identity — see
// that route's comment) and finds the driver with the most Race wins /
// Qualifying poles / Sprint wins at each GP, all capped to already-raced
// editions with year <= the selected year.
//
// Unlike Driver/Team Stats, each row here is a Grand Prix (not a
// person/team) — Age/Seas.-Champ don't apply; instead: 1st GP (debut
// year), Nb of races (editions held), and the "Greater Wins/Poles/Sprint
// Wins" record-holder columns.
//
// Title/subtitle text, fixed rule:
//   ongoing season -> "All-Time race stats - <year> (season in progress)"
//   past season    -> "All-Time race stats through <year>"
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import styles from './f1.module.css'

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

const SORT_OPTIONS = [
  { key: 'race_count',  label: 'Nb of races' },
  { key: 'first_year',  label: '1st GP (oldest)' },
  { key: 'wins',        label: 'Greater Wins' },
  { key: 'poles',       label: 'Greater Poles' },
  { key: 'sprint_wins', label: 'Greater Sprint Wins' },
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

// The cross only makes sense once the "through <year>" context is past
// the death itself — see F1DriversAllTimeTemplate.jsx's identical helper
// for the full reasoning. Shows starting the year AFTER death.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

function RecordCell({ record, highlightDriver, year }) {
  if (!record) return <span className="cell-meta">—</span>
  const isHighlighted = highlightDriver && record.driver_name === highlightDriver
  return (
    <span className={styles.recordInline}>
      <span className={`club-name ${isHighlighted ? styles.nameHighlight : ''}`}>
        {record.driver_name}
        {showDeceasedMark(record.death_date, year) && <span className="deceased-mark" title="Deceased">✝</span>}
      </span>
      <span className="cell-meta">{record.count}</span>
    </span>
  )
}

// Every distinct driver appearing as the record-holder in ANY of the 3
// "Greater" columns (Wins/Poles/Sprint Wins), across the full unfiltered
// dataset — not just the current page/filtered rows, same convention as
// the countries dropdown above.
function raceMatchesDriver(race, driverName) {
  return race.stats.greater_wins?.driver_name === driverName
    || race.stats.greater_poles?.driver_name === driverName
    || race.stats.greater_sprint_wins?.driver_name === driverName
}

export default function F1RacesAllTimeTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [driverFilter, setDriverFilter]   = useState('')
  const [sortStat, setSortStat]           = useState('')
  const [page, setPage]                   = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1RacesAllTime(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setCountryFilter(''); setDriverFilter(''); setSortStat(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, countryFilter, driverFilter, sortStat])

  if (loading) return <Skeleton />
  if (!data?.races?.length) return <Empty />

  const countries = [...new Map(
    data.races.filter(r => r.country_iso2).map(r => [r.country_iso2, r.country_name || r.country_iso2])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  const drivers = [...new Set(data.races.flatMap(r => [
    r.stats.greater_wins?.driver_name,
    r.stats.greater_poles?.driver_name,
    r.stats.greater_sprint_wins?.driver_name,
  ].filter(Boolean)))].sort((a, b) => a.localeCompare(b))

  let rows = data.races.filter(r => {
    if (search && !r.name?.toLowerCase().includes(search.toLowerCase())) return false
    if (countryFilter && r.country_iso2 !== countryFilter) return false
    if (driverFilter && !raceMatchesDriver(r, driverFilter)) return false
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
    // Default: greater number of races, oldest first on a tie.
    rows = [...rows].sort((a, b) => {
      const byRaces = b.stats.race_count - a.stats.race_count
      if (byRaces !== 0) return byRaces
      const byYear = a.first_year - b.first_year
      if (byYear !== 0) return byYear
      return getName(a).localeCompare(getName(b))
    })
  }

  const subtitle = data.season_status === 'current'
    ? `All-Time race stats - ${data.year} (season in progress)`
    : `All-Time race stats through ${data.year}`

  const hasActiveFilter = search || countryFilter || driverFilter || sortStat
  const sorted = key => sortStat === key ? 'sorted-col' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className={styles.wrap}>
      <div className="page-title">Races</div>
      <div className={styles.subtitle}>{subtitle}</div>

      <div className="filter-bar">
        <input className="search-input" placeholder="Search Grand Prix" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={driverFilter} onChange={e => setDriverFilter(e.target.value)}>
          <option value="">All drivers</option>
          {drivers.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All countries</option>
          {countries.map(([iso2, name]) => <option key={iso2} value={iso2}>{name}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setCountryFilter(''); setDriverFilter(''); setSortStat('') }}>
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
              <th className={`table-label ${sorted('first_year')}`} style={th('center')}>1st GP</th>
              <th className={`table-label ${sorted('race_count')}`} style={th('center')}>Nb of races</th>
              <th className={`table-label ${sorted('wins')}`} style={th('left')}>Greater Wins</th>
              <th className={`table-label ${sorted('poles')}`} style={th('left')}>Greater Poles</th>
              <th className={`table-label ${sorted('sprint_wins')}`} style={th('left')}>Greater Sprint Wins</th>
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
                      <div className={styles.gpName}>{r.name}</div>
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('first_year')}`} style={td('center')}>{r.first_year}</td>
                  <td className={`stats-strong ${sorted('race_count')}`} style={td('center')}>{r.stats.race_count}</td>
                  <td className={sorted('wins')} style={td('left')}><RecordCell record={r.stats.greater_wins} highlightDriver={driverFilter} year={data.year} /></td>
                  <td className={sorted('poles')} style={td('left')}><RecordCell record={r.stats.greater_poles} highlightDriver={driverFilter} year={data.year} /></td>
                  <td className={sorted('sprint_wins')} style={td('left')}><RecordCell record={r.stats.greater_sprint_wins} highlightDriver={driverFilter} year={data.year} /></td>
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
