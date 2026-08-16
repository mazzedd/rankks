// templates/motogp/MotoGPPoleTemplate.jsx
// Straight copy of F1PoleTemplate.jsx (Race | Rider | Age | Team | Time),
// sourced from /motogp/poles/:seasonId (Q session position-1 rider, time
// from best_lap_time). "Engine:" relabeled "Constructor:" per instruction,
// same as MotoGPRidersTemplate.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import { calcAge, fmtBirth, fmtDate } from '../../../utils/calcAge'
import { shortGpLabel } from '../../../utils/gpLabel'
import styles from '../f1/f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })

export default function MotoGPPoleTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter]     = useState('')
  const [riderFilter, setRiderFilter]   = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getMotoGPPoles(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'motogp', 'Standings', 'Poles', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => {
    setSearch(''); setTeamFilter(''); setRiderFilter('')
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.poles?.length) return <Empty />

  const teams  = [...new Set(data.poles.map(p => p.team_name_raw || p.constructor_name).filter(Boolean))].sort()
  const riders = [...new Set(data.poles.map(p => p.rider_name).filter(Boolean))].sort()

  const poles = data.poles.filter(p => {
    if (search && !p.gp_name?.toLowerCase().includes(search.toLowerCase()) &&
        !p.rider_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && (p.team_name_raw || p.constructor_name) !== teamFilter) return false
    if (riderFilter && p.rider_name !== riderFilter) return false
    return true
  })

  const hasActiveFilter = search || teamFilter || riderFilter

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search race" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={riderFilter} onChange={e => setRiderFilter(e.target.value)}>
          <option value="">All Riders</option>
          {riders.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setRiderFilter('') }}>
            Clear
          </button>
        )}
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos} style={{ width: '6%' }}></th>
            <th className="table-label" style={{ ...th('left'), width: '16%' }}>Race</th>
            <th className="table-label" style={{ ...th('left'), width: '17%' }}>Rider</th>
            <th className="table-label" style={{ ...th('center'), width: '10%' }}>Age</th>
            <th className="table-label" style={{ ...th('left'), width: '27%' }}>Team</th>
            <th className="table-label" style={{ ...th('center'), width: '24%' }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {poles.map((pole, i) => {
            const img = resolveImg(pole.rider_image)
            const age = calcAge(pole.birth_date, pole.event_date, pole.death_date)
            return (
              <tr key={i} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}>
                  <span className="event-rank">{pole.round_order}</span>
                </td>
                <td>
                  <div className="entity-stack">
                    <div className={styles.gpCell}>
                      <Flag iso2={pole.circuit_country_iso2} name={pole.circuit_country_name} className={styles.gpFlag} />
                      <span style={{ fontWeight: 700 }}>{shortGpLabel(pole.gp_name)}</span>
                    </div>
                    <span className="cell-meta">{fmtDate(pole.event_date)}</span>
                  </div>
                </td>
                <td style={{ textAlign: 'left' }}>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={pole.rider_name} sport="moto-racing" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                        {pole.rider_name || '—'}
                        {pole.car_number != null && <span className="athletePosition"> - {pole.car_number}</span>}
                      </span>
                      <div className="entity-meta-row">
                        <Flag iso2={pole.rider_country_iso2} name={pole.rider_country_name} className="flag" />
                        <span className="cell-meta">{pole.rider_country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{age}</span>
                      <span className="cell-meta">{fmtBirth(pole.birth_date)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'left' }}>
                  {pole.team_name_raw ? (
                    <div className="entity-stack">
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{pole.team_name_raw}</span>
                      {pole.constructor_name && <span className="cell-meta">{pole.constructor_name}</span>}
                    </div>
                  ) : pole.constructor_name ? (
                    <span className="club-name" style={{ fontWeight: 'normal' }}>{pole.constructor_name}</span>
                  ) : '—'}
                </td>
                <td style={{ textAlign: 'center', fontWeight: 'normal' }}>{pole.time_result || '—'}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No pole data available.</div>
}
