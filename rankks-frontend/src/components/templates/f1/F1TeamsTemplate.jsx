// templates/f1/F1TeamsTemplate.jsx
// Columns: Pos | Team | Country | Wins | Podiums | Poles | Sprint |
// Fast. Lap | Points
//
// Same treatment as F1DriversTemplate.jsx:
//   - Team cell: logo + 2-line stack (team name, "Engine: X" beneath).
//   - Podiums: 2-line stack — total (wins+p2+p3) on top, "W/2nd/3rd"
//     breakdown beneath (0 rule — always rendered, even at 0).
//   - Poles / Fast. Lap: added columns, same season-scoped counts as the
//     drivers table (aggregated across both of the team's drivers).
//   - Sort by: Wins/Podiums/Poles/Sprint/Fast. Lap, always descending —
//     highlights the active column (sortRowsHighlight) same as Drivers. No
//     "All teams" filter here (unlike Drivers' "All teams") — every row
//     on this page already IS a team, so filtering by team name would
//     just duplicate the search box. "All engines" still applies since
//     several teams can share one engine manufacturer.
//
// CSS — shared templates/f1/f1.module.css.
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

const DEFAULT_LOGO = '/media/default/club.png' // shared default across every sport, not a per-sport asset

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

export default function F1TeamsTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [engineFilter, setEngineFilter] = useState('')
  const [sortStat, setSortStat] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1Standings(seasonId, 'teams')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'formula-1-world-championship', 'Standings', 'Teams', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  if (loading) return <Skeleton />
  if (!data?.standings?.length) return <Empty />

  const engines = [...new Set(data.standings.map(r => r.stats?.engine_name).filter(Boolean))].sort()

  let rows = data.standings.filter(r => {
    if (search && !r.canonical_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (engineFilter && r.stats?.engine_name !== engineFilter) return false
    return true
  })

  // "Sort by" dropdown — default ('') keeps the API's own finishing-position
  // order. Every option is a numeric stat, always descending (best first).
  if (sortStat === 'podiums') {
    const podiums = r => (r.stats?.wins ?? 0) + (r.stats?.p2 ?? 0) + (r.stats?.p3 ?? 0)
    rows = [...rows].sort((a, b) => podiums(b) - podiums(a))
  } else if (sortStat) {
    rows = [...rows].sort((a, b) => (Number(b.stats?.[sortStat]) || 0) - (Number(a.stats?.[sortStat]) || 0))
  }

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search team" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={engineFilter} onChange={e => setEngineFilter(e.target.value)}>
          <option value="">All Engines</option>
          {engines.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          <option value="wins">Wins</option>
          <option value="podiums">Podiums</option>
          <option value="poles">Poles</option>
          <option value="sprint_wins">Sprint</option>
          <option value="fastest_laps">Fast. Lap</option>
        </select>
        {(search || engineFilter || sortStat) && (
          <button className="filter-reset" onClick={() => { setSearch(''); setEngineFilter(''); setSortStat('') }}>
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
            <th className="table-label" style={th('left')}>Country</th>
            <th className={`table-label ${sortStat === 'wins' ? 'sortRowsHighlight' : ''}`} style={th('center')}>Wins</th>
            <th className={`table-label ${sortStat === 'podiums' ? 'sortRowsHighlight' : ''}`} style={th('center')}>
              <div className="stat-stack">
                <span>Podiums</span>
                <span className="cell-meta">1st/2nd/3rd</span>
              </div>
            </th>
            <th className={`table-label ${sortStat === 'poles' ? 'sortRowsHighlight' : ''}`} style={th('center')}>Poles</th>
            <th className={`table-label ${sortStat === 'sprint_wins' ? 'sortRowsHighlight' : ''}`} style={th('center')}>Sprint</th>
            <th className={`table-label ${sortStat === 'fastest_laps' ? 'sortRowsHighlight' : ''}`} style={th('center')}>Fast. Lap</th>
            <th className="table-label" style={th('right')}>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const logo = resolveImg(row.logo_url)
            return (
              <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}><span className="event-rank">{row.position}</span></td>
                <td>
                  <div className={styles.team}>
                    <div className={styles.logoSlot}>
                      <img
                        src={logo || DEFAULT_LOGO}
                        alt={row.name_raw}
                        className={styles.logo}
                        onError={e => {
                          if (e.target.src !== new URL(DEFAULT_LOGO, window.location.href).href) {
                            e.target.src = DEFAULT_LOGO
                          }
                        }}
                      />
                    </div>
                    <div className="entity-stack">
                      <span className="club-name">{row.name_raw}</span>
                      {row.stats?.engine_name && (
                        <span className="cell-meta">{row.stats.engine_name}</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="stats-light" style={td('left')}>
                  <div className="entity-meta-row">
                    <Flag iso2={row.country_iso2} name={row.country_name} className="flag" />
                    <span>{row.country_name || '—'}</span>
                  </div>
                </td>
                <td className={`stats-light ${sortStat === 'wins' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.wins ?? 0}</td>
                <td className={`stats-light ${sortStat === 'podiums' ? 'sortRowsHighlight' : ''}`} style={td('center')}>
                  <div className="stat-stack">
                    <span className="stat-stack-value">{(row.stats?.wins ?? 0) + (row.stats?.p2 ?? 0) + (row.stats?.p3 ?? 0)}</span>
                    <span className="cell-meta">{row.stats?.wins ?? 0}/{row.stats?.p2 ?? 0}/{row.stats?.p3 ?? 0}</span>
                  </div>
                </td>
                <td className={`stats-light ${sortStat === 'poles' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.poles ?? 0}</td>
                <td className={`stats-light ${sortStat === 'sprint_wins' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.sprint_wins ?? 0}</td>
                <td className={`stats-light ${sortStat === 'fastest_laps' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.fastest_laps ?? 0}</td>
                <td className="stats-strong" style={td('right')}>{row.stats?.points ?? 0}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(5)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No team data available.</div>
}
