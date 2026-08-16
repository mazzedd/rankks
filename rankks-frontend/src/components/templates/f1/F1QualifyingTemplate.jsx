// templates/f1/F1QualifyingTemplate.jsx
// Columns per RANKKS F1 Master Spec §3, reordered per design matrix:
// Pos | Driver | Age | No | Team | Q1 | Q2 | Q3 | Laps
//
// Unlike the pre-teardown version of this file, Q1/Q2/Q3 are already
// merged into one row per driver by the loader (see lib/sessionType.js
// mergeQualifyingFiles) — this template just reads q1_time/q2_time/
// q3_time directly off one API call, no client-side merging of 3
// separate session fetches needed anymore.
//
// FLAG + COUNTRY / AGE — uses driver_country_iso2/driver_country_name
// and birth_date, both added to the shared /f1/session/:sessionId/results
// backend route (same route Race Results/Practice use) alongside the
// earlier fix. AVATAR uses the real driver_image field via resolveImg,
// replacing the old hardcoded-guessed-path helper.
//
// AGE — now uses the shared calcAge(birthDate, refDate) util, with
// refDate = data.session.event_date, same as F1SessionResultsTemplate
// (same backend route, same session object). Previously used today's
// date via a local calcAge(birthDate) — unified now.
//
// Driver name is bold; Age/Team/Laps are regular weight (same convention
// as F1SessionResultsTemplate/F1RacesTemplate). Every header label is
// bold. Team is left-aligned.
//
// CSS — now imports the shared templates/f1/f1.module.css (was its own
// module CSS, byte-identical to the other 5 F1 templates). Avatar+name
// +flag/country cell and the age value+birthdate stack now use the
// global .entity-cell/.entity-stack/.entity-meta-row/.stat-stack/
// .stat-stack-value/.cell-meta classes from index.css.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import { STATUS_LABEL } from '../../../utils/eventStatus'
import styles from './f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })

export default function F1QualifyingTemplate({ sessionId, gpName, year, status, scheduleRange, pageSubtitle, sessionType }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter]     = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [engineFilter, setEngineFilter] = useState('')

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    api.getF1SessionResults(sessionId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    setSearch(''); setTeamFilter(''); setDriverFilter(''); setEngineFilter('')
  }, [sessionId])

  if (loading) return <Skeleton />

  // Next/Future GPs — no driver list, just state when the weekend happens —
  // see F1SessionResultsTemplate.jsx's identical block for the full
  // rationale.
  if (status === 'next' || status === 'upcoming') {
    return (
      <div className={styles.wrap}>
        {gpName && <div className="page-subtitle">{pageSubtitle || gpName} - {year}{sessionType ? ` - ${sessionType}` : ''}</div>}
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>
          {STATUS_LABEL[status]} Grand Prix — scheduled {scheduleRange || '—'}
        </div>
      </div>
    )
  }

  if (!data?.results?.length) return <Empty />

  const teams   = [...new Set(data.results.map(r => r.team_name_raw).filter(Boolean))].sort()
  const drivers = [...new Set(data.results.map(r => r.driver_name).filter(Boolean))].sort()
  const engines = [...new Set(data.results.map(r => r.engine_name).filter(Boolean))].sort()

  const results = data.results.filter(r => {
    if (search && !r.driver_name?.toLowerCase().includes(search.toLowerCase()) &&
        !r.team_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && r.team_name_raw !== teamFilter) return false
    if (driverFilter && r.driver_name !== driverFilter) return false
    if (engineFilter && r.engine_name !== engineFilter) return false
    return true
  })

  const hasActiveFilter = search || teamFilter || driverFilter || engineFilter

  const eventDate = data.session?.event_date

  return (
    <div className={styles.wrap}>
      {/* Admin-set sponsor name (race_naming era override) when one covers
          this year, else the plain GP name — see F1SessionResultsTemplate's
          identical block for the full rationale. */}
      {gpName && <div className="page-subtitle">{pageSubtitle || gpName} - {year}</div>}

      {data.is_placeholder && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
          Entry list based on current season standings — results not published yet.
        </div>
      )}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search driver or team" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={driverFilter} onChange={e => setDriverFilter(e.target.value)}>
          <option value="">All Drivers</option>
          {drivers.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="filter-label" value={engineFilter} onChange={e => setEngineFilter(e.target.value)}>
          <option value="">All Engines</option>
          {engines.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setDriverFilter(''); setEngineFilter('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{results.length} results</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos}></th>
            <th className="table-label" style={th('left')}>Driver</th>
            <th className="table-label" style={th('center')}>Age</th>
            <th className="table-label" style={th('center')}>No</th>
            <th className="table-label" style={th('left')}>Team</th>
            <th className="table-label" style={th('center')}>Q1</th>
            <th className="table-label" style={th('center')}>Q2</th>
            <th className="table-label" style={th('center')}>Q3</th>
            <th className="table-label" style={th('center')}>Laps</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const img = resolveImg(r.driver_image)
            const age = calcAge(r.birth_date, eventDate, r.death_date)
            return (
              <tr key={r.driver_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}><span className="event-rank">{r.position}</span></td>
                <td>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={r.driver_name} sport="f1" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 700 }}>{r.driver_name}</span>
                      <div className="entity-meta-row">
                        <Flag iso2={r.driver_country_iso2} name={r.driver_country_name} className="flag" />
                        <span className="cell-meta">{r.driver_country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{age}</span>
                      <span className="cell-meta">{fmtBirth(r.birth_date)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{r.car_number ?? '—'}</td>
                <td className="stats-light" style={{ textAlign: 'left' }}>
                  {r.team_name_raw ? (
                    <div className={styles.team}>
                      <div className={styles.logoSlot}>
                        {resolveImg(r.team_logo) && (
                          <img src={resolveImg(r.team_logo)} alt={r.team_name_raw} className={styles.logo} onError={e => { e.target.style.display = 'none' }} />
                        )}
                      </div>
                      <div className="entity-stack">
                        <span className="club-name" style={{ fontWeight: 'normal' }}>{r.team_name_raw}</span>
                        {r.engine_name && (
                          <span className="cell-meta">{r.engine_name}</span>
                        )}
                      </div>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-strong" style={{ textAlign: 'center' }}>{r.q1_time || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{r.q2_time || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{r.q3_time || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{r.laps ?? '—'}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No qualifying data available.</div>
}
