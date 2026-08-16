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
  { key: 'championships',        label: 'Championships' },
  { key: 'driver_championships', label: 'Driver Championships' },
  { key: 'fastest_laps',  label: 'Fastest Lap' },
  { key: 'podiums',       label: 'Podiums' },
  { key: 'points',        label: 'Points' },
  { key: 'poles',         label: 'Poles' },
  { key: 'races',         label: 'Races' },
  { key: 'seasons',       label: 'Seasons' },
  { key: 'sprint_wins',   label: 'Sprint' },
]

function getName(t) { return (t.canonical_name || '').toLowerCase() }

const PAGE_SIZE = 25

export default function F1TeamsAllTimeTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [showActive, setShowActive]       = useState(false)
  const [showRetired, setShowRetired]     = useState(false)
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

  // Admin-configured subtitle line — see TennisTournamentStatsTemplate.jsx's
  // identical block for the full rationale.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'formula-1-world-championship', 'Totals', 'Team Stats', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => { setSearch(''); setCountryFilter(''); setShowActive(false); setShowRetired(false); setSortStat(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, countryFilter, showActive, showRetired, sortStat])

  if (loading) return <Skeleton />
  if (!data?.teams?.length) return <Empty />

  // Country dropdown shows a team-count per country — same "(count)"
  // convention F1DriversAllTimeTemplate.jsx's own country filter uses.
  const countryCounts = new Map()
  data.teams.forEach(t => {
    if (!t.country_iso2) return
    const entry = countryCounts.get(t.country_iso2) || { name: t.country_name || t.country_iso2, count: 0 }
    entry.count++
    countryCounts.set(t.country_iso2, entry)
  })
  const countries = [...countryCounts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))

  // Active = on the real current F1 grid (latest season on record, e.g.
  // 2026) — fixed regardless of which year is being viewed, so Active
  // means the same teams whether browsing through 2026 or through 1990.
  // Retired = raced at some point through the selected year but isn't on
  // the current grid; neither applies to a team with zero career
  // appearances through this year (last_season_year null).
  const isActiveNow = t => t.is_current_grid === true
  const isRetiredNow = t => t.last_season_year != null && !t.is_current_grid
  const onlyActive  = showActive && !showRetired
  const onlyRetired = showRetired && !showActive

  let rows = data.teams.filter(t => {
    if (search && !t.canonical_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (countryFilter && t.country_iso2 !== countryFilter) return false
    if (onlyActive && !isActiveNow(t)) return false
    if (onlyRetired && !isRetiredNow(t)) return false
    return true
  })

  if (sortStat === 'podiums') {
    rows = [...rows].sort((a, b) => {
      const podiums = x => (x.stats?.wins || 0) + (x.stats?.p2 || 0) + (x.stats?.p3 || 0)
      const d = podiums(b) - podiums(a)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else if (sortStat) {
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

  const hasActiveFilter = search || countryFilter || showActive || showRetired || sortStat
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="search Team" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(([iso2, c]) => <option key={iso2} value={iso2}>{c.name} ({c.count})</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <div className={styles.statusToggle}>
          <button
            type="button"
            className={`${styles.statusBtn} ${showActive ? styles.statusBtnActive : ''}`}
            onClick={() => setShowActive(v => !v)}
          >
            Active
          </button>
          <button
            type="button"
            className={`${styles.statusBtn} ${showRetired ? styles.statusBtnActive : ''}`}
            onClick={() => setShowRetired(v => !v)}
          >
            Retired
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setCountryFilter(''); setShowActive(false); setShowRetired(false); setSortStat('') }}>
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
              <th className={`table-label ${sorted('championships')}`} style={th('center')}>Seas. I Champ.</th>
              <th className={`table-label ${sorted('driver_championships')}`} style={th('center')}>Driver Champ.</th>
              <th className={`table-label ${sorted('races')}`} style={th('center')}>Races</th>
              <th className={`table-label ${sorted('wins')}`} style={th('center')}>Wins</th>
              <th className={`table-label ${sorted('podiums')}`} style={th('center')}>
                <div className="stat-stack">
                  <span>Podiums</span>
                  <span className="cell-meta">1st I 2nd I 3rd</span>
                </div>
              </th>
              <th className={`table-label ${sorted('sprint_wins')}`} style={th('center')}>Sprint</th>
              <th className={`table-label ${sorted('poles')}`} style={th('center')}>Poles</th>
              <th className={`table-label ${sorted('fastest_laps')}`} style={th('center')}>Fastest Lap</th>
              <th className={`table-label ${sorted('points')}`} style={th('right')}>Pts</th>
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
                      <span className="club-name">{t.canonical_name}</span>
                    </div>
                  </td>
                  <td className={sorted('championships')} style={td('center')}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{t.stats.seasons} I <strong>{t.stats.championships}</strong></span>
                      {t.first_season_year && <span className="cell-meta">{t.first_season_year}-{t.last_season_year || data.year}</span>}
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('driver_championships')}`} style={td('center')}>{t.stats.driver_championships}</td>
                  <td className={`stats-light ${sorted('races')}`} style={td('center')}>{t.stats.races}</td>
                  <td className={`stats-light ${sorted('wins')}`} style={td('center')}>{t.stats.wins}</td>
                  <td className={sorted('podiums')} style={td('center')}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{t.stats.wins + t.stats.p2 + t.stats.p3}</span>
                      <span className="cell-meta">{t.stats.wins} I {t.stats.p2} I {t.stats.p3}</span>
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('sprint_wins')}`} style={td('center')}>{t.stats.sprint_wins}</td>
                  <td className={`stats-light ${sorted('poles')}`} style={td('center')}>{t.stats.poles}</td>
                  <td className={`stats-light ${sorted('fastest_laps')}`} style={td('center')}>{t.stats.fastest_laps}</td>
                  <td className={`stats-light ${sorted('points')}`} style={td('right')}><strong>{t.stats.points ?? 0}</strong></td>
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
