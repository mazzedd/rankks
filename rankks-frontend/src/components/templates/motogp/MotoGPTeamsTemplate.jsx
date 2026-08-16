// templates/motogp/MotoGPTeamsTemplate.jsx
// Columns: Pos | Team (+ Constructor beneath) | Country | Wins | Podiums |
// Poles | Sprint | Sprint Pod. | Points — same shape as F1TeamsTemplate.jsx.
// Logo/country come from entity_type='motogp_team' entities (created by
// rankks-ingestion/create-motogp-team-entities.js, matched by canonical
// name in motogp.js's /standings/:seasonId/teams — see that route's
// comment), populated via the admin Clubs page same as F1 teams. Null
// until entered there, not a bug.
// Wins/Podiums/Poles/Sprint are derived from motogp_session_results grouped
// by team_name, resolved through TEAM_NAME_ALIASES in motogp.js (see that
// file's comment) to correct for sponsor-variant spelling and substitute
// riders logged under a different name than their actual team — only
// verified season/category combinations get correct numbers this way;
// others fall through with raw (possibly undercounted) team_name grouping.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import styles from '../f1/f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const DEFAULT_LOGO = '/media/default/club.png' // shared default across every sport, not a per-sport asset

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

export default function MotoGPTeamsTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [constructorFilter, setConstructorFilter] = useState('')
  const [sortStat, setSortStat] = useState('')

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'motogp', 'Standings', 'Teams', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getMotoGPStandings(seasonId, 'teams')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.standings?.length) return <Empty />

  const constructors = [...new Set(data.standings.map(r => r.stats?.constructor_name).filter(Boolean))].sort()

  let rows = data.standings.filter(r => {
    if (search && !r.team_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (constructorFilter && r.stats?.constructor_name !== constructorFilter) return false
    return true
  })

  if (sortStat === 'podiums') {
    const podiums = r => (r.stats?.wins ?? 0) + (r.stats?.p2 ?? 0) + (r.stats?.p3 ?? 0)
    rows = [...rows].sort((a, b) => podiums(b) - podiums(a))
  } else if (sortStat === 'sprint_podiums') {
    const sprintPodiums = r => (r.stats?.sprint_wins ?? 0) + (r.stats?.sprint_p2 ?? 0) + (r.stats?.sprint_p3 ?? 0)
    rows = [...rows].sort((a, b) => sprintPodiums(b) - sprintPodiums(a))
  } else if (sortStat === 'points') {
    rows = [...rows].sort((a, b) => (Number(b.stats?.points) || 0) - (Number(a.stats?.points) || 0))
  } else if (sortStat) {
    rows = [...rows].sort((a, b) => (Number(b.stats?.[sortStat]) || 0) - (Number(a.stats?.[sortStat]) || 0))
  }

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search team" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={constructorFilter} onChange={e => setConstructorFilter(e.target.value)}>
          <option value="">All Constructors</option>
          {constructors.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          <option value="points">Points</option>
          <option value="poles">Poles</option>
          <optgroup label="Race">
            <option value="wins">Wins</option>
            <option value="podiums">Podiums</option>
          </optgroup>
          <optgroup label="Sprint">
            <option value="sprint_wins">Wins</option>
            <option value="sprint_podiums">Podiums</option>
          </optgroup>
        </select>
        {(search || constructorFilter || sortStat) && (
          <button className="filter-reset" onClick={() => { setSearch(''); setConstructorFilter(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} teams</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos} style={{ width: '5%' }}></th>
            <th className="table-label" style={{ ...th('left'), width: '20%' }}>Team</th>
            <th className="table-label" style={{ ...th('left'), width: '12%' }}>Country</th>
            <th className={`table-label ${sortStat === 'wins' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '8%' }}>Wins</th>
            <th className={`table-label ${sortStat === 'podiums' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '12%' }}>
              <div className="stat-stack">
                <span>Podiums</span>
                <span className="cell-meta">1st/2nd/3rd</span>
              </div>
            </th>
            <th className={`table-label ${sortStat === 'poles' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '8%' }}>Poles</th>
            <th className={`table-label ${sortStat === 'sprint_wins' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '8%' }}>Sprint</th>
            <th className={`table-label ${sortStat === 'sprint_podiums' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '12%' }}>
              <div className="stat-stack">
                <span>Sprint Pod.</span>
                <span className="cell-meta">1st/2nd/3rd</span>
              </div>
            </th>
            <th className={`table-label ${sortStat === 'points' ? 'sortRowsHighlight' : ''}`} style={{ ...th('right'), width: '8%' }}>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const logo = resolveImg(row.logo_url)
            return (
            <tr key={row.team_name} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
              <td className={styles.pos}><span className="event-rank">{row.position}</span></td>
              <td>
                <div className={styles.team}>
                  <div className={styles.logoSlot}>
                    <img
                      src={logo || DEFAULT_LOGO}
                      alt={row.team_name}
                      className={styles.logo}
                      onError={e => {
                        if (e.target.src !== new URL(DEFAULT_LOGO, window.location.href).href) {
                          e.target.src = DEFAULT_LOGO
                        }
                      }}
                    />
                  </div>
                  <div className="entity-stack">
                    <span className="club-name">{row.team_name}</span>
                    {row.stats?.constructor_name && (
                      <span className="cell-meta">{row.stats.constructor_name}</span>
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
              <td className={`stats-light ${sortStat === 'sprint_podiums' ? 'sortRowsHighlight' : ''}`} style={td('center')}>
                <div className="stat-stack">
                  <span className="stat-stack-value">{(row.stats?.sprint_wins ?? 0) + (row.stats?.sprint_p2 ?? 0) + (row.stats?.sprint_p3 ?? 0)}</span>
                  <span className="cell-meta">{row.stats?.sprint_wins ?? 0}/{row.stats?.sprint_p2 ?? 0}/{row.stats?.sprint_p3 ?? 0}</span>
                </div>
              </td>
              <td className={`stats-strong ${sortStat === 'points' ? 'sortRowsHighlight' : ''}`} style={td('right')}>{row.stats?.points ?? 0}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No team standings available.</div>
}
