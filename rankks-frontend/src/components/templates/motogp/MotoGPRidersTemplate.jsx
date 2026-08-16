// templates/motogp/MotoGPRidersTemplate.jsx
// Columns: Pos | Rider | Age | Seasons | Team | Wins | Podiums | Poles |
// Sprint | Sprint Pod. | Points — full parity with F1DriversTemplate.jsx,
// same stat set except Fast. Lap (no data source for it in MotoGP — see
// motogp.js's /standings/:seasonId/riders route header comment) traded for
// Sprint Podiums, which MotoGP does track. "Engine:" relabeled
// "Constructor:" per instruction.
//
// Sprint/Sprint Pod. columns (and the Sprint sort optgroup) only render
// for the `motogp` category — sprint races don't exist for Moto2/Moto3,
// so showing them there would just be a column of zeroes.
//
// fallback="letter" on AthleteAvatar (not 'silhouette') — matches F1/
// basketball/tennis's existing convention, confirmed by reading
// AthleteAvatar.jsx directly. Rider portrait images are deferred (see
// onboarding-motogp.md Section 5), so every row falls through to this.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import styles from '../f1/f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

export default function MotoGPRidersTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [constructorFilter, setConstructorFilter] = useState('')
  const [sortStat, setSortStat] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getMotoGPStandings(seasonId, 'riders')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'motogp', 'Standings', 'Riders', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  if (loading) return <Skeleton />
  if (!data?.standings?.length) return <Empty />

  const hasSprint = data.category === 'motogp'
  const teams = [...new Set(data.standings.map(r => r.stats?.team_name).filter(Boolean))].sort()
  const constructors = [...new Set(data.standings.map(r => r.stats?.constructor_name).filter(Boolean))].sort()

  let rows = data.standings.filter(r => {
    if (search && !r.canonical_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && r.stats?.team_name !== teamFilter) return false
    if (constructorFilter && r.stats?.constructor_name !== constructorFilter) return false
    return true
  })

  if (sortStat === 'podiums') {
    const podiums = r => (r.stats?.wins ?? 0) + (r.stats?.p2 ?? 0) + (r.stats?.p3 ?? 0)
    rows = [...rows].sort((a, b) => podiums(b) - podiums(a))
  } else if (sortStat === 'sprint_podiums') {
    const sprintPodiums = r => (r.stats?.sprint_wins ?? 0) + (r.stats?.sprint_p2 ?? 0) + (r.stats?.sprint_p3 ?? 0)
    rows = [...rows].sort((a, b) => sprintPodiums(b) - sprintPodiums(a))
  } else if (sortStat) {
    rows = [...rows].sort((a, b) => (Number(b.stats?.[sortStat]) || 0) - (Number(a.stats?.[sortStat]) || 0))
  }

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search rider" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={constructorFilter} onChange={e => setConstructorFilter(e.target.value)}>
          <option value="">All Constructors</option>
          {constructors.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          <option value="points">Points</option>
          <option value="poles">Poles</option>
          <option value="seasons_count">Seasons</option>
          <optgroup label="Race">
            <option value="wins">Wins</option>
            <option value="podiums">Podiums</option>
          </optgroup>
          {hasSprint && (
            <optgroup label="Sprint">
              <option value="sprint_wins">Wins</option>
              <option value="sprint_podiums">Podiums</option>
            </optgroup>
          )}
        </select>
        {(search || teamFilter || constructorFilter || sortStat) && (
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setConstructorFilter(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} riders</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos} style={{ width: '5%' }}></th>
            <th className="table-label" style={{ ...th('left'), width: hasSprint ? '19%' : '20%' }}>Rider</th>
            <th className="table-label" style={{ ...th('center'), width: hasSprint ? '8%' : '9%' }}>Age</th>
            <th className={`table-label ${sortStat === 'seasons_count' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: hasSprint ? '9%' : '10%' }}>Seasons</th>
            <th className="table-label" style={{ ...th('left'), width: hasSprint ? '14%' : '22%' }}>Team</th>
            <th className={`table-label ${sortStat === 'wins' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: hasSprint ? '6%' : '7%' }}>Wins</th>
            <th className={`table-label ${sortStat === 'podiums' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: hasSprint ? '10%' : '12%' }}>
              <div className="stat-stack">
                <span>Podiums</span>
                <span className="cell-meta">1st/2nd/3rd</span>
              </div>
            </th>
            <th className={`table-label ${sortStat === 'poles' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: hasSprint ? '6%' : '7%' }}>Poles</th>
            {hasSprint && (
              <>
                <th className={`table-label ${sortStat === 'sprint_wins' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '7%' }}>Sprint</th>
                <th className={`table-label ${sortStat === 'sprint_podiums' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '9%' }}>
                  <div className="stat-stack">
                    <span>Sprint Pod.</span>
                    <span className="cell-meta">1st/2nd/3rd</span>
                  </div>
                </th>
              </>
            )}
            <th className={`table-label ${sortStat === 'points' ? 'sortRowsHighlight' : ''}`} style={{ ...th('right'), width: hasSprint ? '7%' : '8%' }}>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const img = resolveImg(row.logo_url)
            const age = calcAge(row.birth_date, `${year}-11-30`, row.death_date)
            const birth = fmtBirth(row.birth_date)
            return (
              <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}><span className="event-rank">{row.position}</span></td>
                <td>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={row.canonical_name} sport="moto-racing" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span className="club-name" style={{ whiteSpace: 'nowrap' }}>
                        {row.canonical_name}
                        {row.car_number != null && <span className="athletePosition"> - {row.car_number}</span>}
                      </span>
                      <div className="entity-meta-row">
                        <Flag iso2={row.country_iso2} name={row.country_name} className="flag" />
                        <span className="cell-meta">{row.country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={td('center')}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{age}</span>
                      <span className="cell-meta">{birth}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className={`stats-light ${sortStat === 'seasons_count' ? 'sortRowsHighlight' : ''}`} style={td('center')}>
                  {row.stats?.seasons_count != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{row.stats.seasons_count}</span>
                      <span className="cell-meta">
                        {row.stats.active_from === row.stats.active_to ? `${row.stats.active_from}` : `${row.stats.active_from}-${row.stats.active_to}`}
                      </span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={td('left')}>
                  {row.stats?.team_name ? (
                    <div className="entity-stack">
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{row.stats.team_name}</span>
                      {row.stats.constructor_name && (
                        <span className="cell-meta">{row.stats.constructor_name}</span>
                      )}
                    </div>
                  ) : row.stats?.constructor_name ? (
                    <span className="club-name" style={{ fontWeight: 'normal' }}>{row.stats.constructor_name}</span>
                  ) : '—'}
                </td>
                <td className={`stats-light ${sortStat === 'wins' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.wins ?? 0}</td>
                <td className={`stats-light ${sortStat === 'podiums' ? 'sortRowsHighlight' : ''}`} style={td('center')}>
                  <div className="stat-stack">
                    <span className="stat-stack-value">{(row.stats?.wins ?? 0) + (row.stats?.p2 ?? 0) + (row.stats?.p3 ?? 0)}</span>
                    <span className="cell-meta">{row.stats?.wins ?? 0}/{row.stats?.p2 ?? 0}/{row.stats?.p3 ?? 0}</span>
                  </div>
                </td>
                <td className={`stats-light ${sortStat === 'poles' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.poles ?? 0}</td>
                {hasSprint && (
                  <>
                    <td className={`stats-light ${sortStat === 'sprint_wins' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.sprint_wins ?? 0}</td>
                    <td className={`stats-light ${sortStat === 'sprint_podiums' ? 'sortRowsHighlight' : ''}`} style={td('center')}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">{(row.stats?.sprint_wins ?? 0) + (row.stats?.sprint_p2 ?? 0) + (row.stats?.sprint_p3 ?? 0)}</span>
                        <span className="cell-meta">{row.stats?.sprint_wins ?? 0}/{row.stats?.sprint_p2 ?? 0}/{row.stats?.sprint_p3 ?? 0}</span>
                      </div>
                    </td>
                  </>
                )}
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No rider standings available.</div>
}
