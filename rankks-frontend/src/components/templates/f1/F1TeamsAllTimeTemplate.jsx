// templates/f1/F1TeamsAllTimeTemplate.jsx
// All-Time > Team Stats — career cumulative stats "through <year>", the
// constructor counterpart of F1DriversAllTimeTemplate.jsx. Backed by
// /f1/teams-all-time/:seasonId — see that route's comment for the "all
// teams, zero-stat ones included" and "through year" conventions.
//
// Title/subtitle text, fixed rule:
//   ongoing season -> "All-Time team stats - <year> (season in progress)"
//   past season    -> "All-Time team stats through <year>"
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import styles from './f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

const SORT_OPTIONS = [
  { key: 'seasons',              label: 'Seasons' },
  { key: 'championships',        label: 'Championships' },
  { key: 'driver_championships', label: "Driver Championships" },
  { key: 'points',        label: 'Points' },
  { key: 'races',         label: 'Races' },
  { key: 'wins',          label: 'Wins' },
  { key: 'p2',            label: '2nd' },
  { key: 'p3',            label: '3rd' },
  { key: 'sprint_wins',   label: 'Sprint' },
  { key: 'poles',         label: 'Poles' },
  { key: 'fastest_laps',  label: 'Fastest Lap' },
]

function getName(t) { return (t.canonical_name || '').toLowerCase() }

const PAGE_SIZE = 25

export default function F1TeamsAllTimeTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [sortStat, setSortStat]           = useState('')
  const [page, setPage]                   = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1TeamsAllTime(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setCountryFilter(''); setSortStat(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, countryFilter, sortStat])

  if (loading) return <Skeleton />
  if (!data?.teams?.length) return <Empty />

  const countries = [...new Map(
    data.teams.filter(t => t.country_iso2).map(t => [t.country_iso2, t.country_name || t.country_iso2])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  let rows = data.teams.filter(t => {
    if (search && !t.canonical_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (countryFilter && t.country_iso2 !== countryFilter) return false
    return true
  })

  if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const d = (Number(b.stats?.[sortStat]) || 0) - (Number(a.stats?.[sortStat]) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    rows = [...rows].sort((a, b) => {
      const byChamps = (b.stats?.championships || 0) - (a.stats?.championships || 0)
      if (byChamps !== 0) return byChamps
      const byPoints = (Number(b.stats?.points) || 0) - (Number(a.stats?.points) || 0)
      if (byPoints !== 0) return byPoints
      return getName(a).localeCompare(getName(b))
    })
  }

  const subtitle = data.season_status === 'current'
    ? `All-Time team stats - ${data.year} (season in progress)`
    : `All-Time team stats through ${data.year}`

  const hasActiveFilter = search || countryFilter || sortStat
  const sorted = key => sortStat === key ? 'sorted-col' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className={styles.wrap}>
      <div className="page-title">Teams</div>
      <div className={styles.subtitle}>{subtitle}</div>

      <div className="filter-bar">
        <input className="search-input" placeholder="Search team" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All countries</option>
          {countries.map(([iso2, name]) => <option key={iso2} value={iso2}>{name}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setCountryFilter(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} teams</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.pos}></th>
              <th className="table-label" style={th('left')}>Team</th>
              <th className={`table-label ${sorted('championships')}`} style={th('center')}>Seas./Champ</th>
              <th className={`table-label ${sorted('driver_championships')}`} style={th('center')}>Driver Champ.</th>
              <th className={`table-label ${sorted('points')}`} style={th('right')}>Pts</th>
              <th className={`table-label ${sorted('races')}`} style={th('center')}>Races</th>
              <th className={`table-label ${sorted('wins')}`} style={th('center')}>Wins</th>
              <th className={`table-label ${sorted('p2')}`} style={th('center')}>2nd</th>
              <th className={`table-label ${sorted('p3')}`} style={th('center')}>3rd</th>
              <th className={`table-label ${sorted('sprint_wins')}`} style={th('center')}>Sprint</th>
              <th className={`table-label ${sorted('poles')}`} style={th('center')}>Poles</th>
              <th className={`table-label ${sorted('fastest_laps')}`} style={th('center')}>Fastest Lap</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((t, i) => {
              const globalRank = pageStart + i + 1
              const logo = resolveImg(t.logo_url)
              return (
                <tr key={t.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos}><span className="event-rank">{globalRank}</span></td>
                  <td>
                    <div className={styles.team}>
                      {logo
                        ? <img src={logo} alt={t.canonical_name} className={styles.logo} onError={e => { e.target.style.display = 'none' }} />
                        : null
                      }
                      <div className="entity-stack">
                        <span className="club-name">{t.canonical_name}</span>
                        <div className="entity-meta-row">
                          <Flag iso2={t.country_iso2} name={t.country_name} className="flag" />
                          <span className="cell-meta">{t.country_name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={`${sorted('championships')}`} style={td('center')}>
                    <span className="stats-strong">{t.stats.seasons}/{t.stats.championships}</span>
                  </td>
                  <td className={`stats-light ${sorted('driver_championships')}`} style={td('center')}>{t.stats.driver_championships}</td>
                  <td className={`stats-strong ${sorted('points')}`} style={td('right')}>{t.stats.points ?? 0}</td>
                  <td className={`stats-light ${sorted('races')}`} style={td('center')}>{t.stats.races}</td>
                  <td className={`stats-light ${sorted('wins')}`} style={td('center')}>{t.stats.wins}</td>
                  <td className={`stats-light ${sorted('p2')}`} style={td('center')}>{t.stats.p2}</td>
                  <td className={`stats-light ${sorted('p3')}`} style={td('center')}>{t.stats.p3}</td>
                  <td className={`stats-light ${sorted('sprint_wins')}`} style={td('center')}>{t.stats.sprint_wins}</td>
                  <td className={`stats-light ${sorted('poles')}`} style={td('center')}>{t.stats.poles}</td>
                  <td className={`stats-light ${sorted('fastest_laps')}`} style={td('center')}>{t.stats.fastest_laps}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No team data available.</div>
}
