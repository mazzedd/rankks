// templates/f1/F1FastestLapTemplate.jsx
// Columns per RANKKS F1 Master Spec §3: Race | Driver | Team | Time | Date
//
// AVATAR + FLAG — uses driver_image and driver_country_iso2/
// driver_country_name, both added to the /f1/fastest-laps/:seasonId
// backend route alongside this fix.
//
// CIRCUIT FLAG — uses circuit_country_iso2/circuit_country_name, added
// to the /f1/fastest-laps/:seasonId backend route via a LEFT JOIN
// countries gpco ON gpco.id = gp.country_id. Previously called
// <Flag iso2={null} .../>, which never resolved to an actual flag —
// same fix and backend join pattern as F1RacesTemplate.
//
// FLAG SIZING — driver flag now uses the shared .flag class (18×12),
// matching every other F1 table. Previously used .gpFlag (20×13) for
// the driver too, which was drift — .gpFlag is now reserved for the
// circuit flag only.
//
// Per explicit design note for this table: Race (gp_name) and Time are
// regular weight, NOT bold — a deliberate deviation from other tables
// where these would normally be emphasised.
//
// Every header label is explicitly bold. Date uses dd.mm.yyyy.
//
// CSS — now imports the shared templates/f1/f1.module.css (was its own
// module CSS, byte-identical to the other 5 F1 templates). Avatar+name
// +flag/country cell and the age value+birthdate stack now use the
// global .entity-cell/.entity-stack/.entity-meta-row/.stat-stack/
// .stat-stack-value/.cell-meta classes from index.css.
//
// DATE — fmtDate is now imported from utils/calcAge.js (dd.mm.yyyy),
// the same shared function football/tennis also use. Was previously
// defined locally in this file; F1's version was already correct and
// became the canonical one when centralized.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import { calcAge, fmtBirth, fmtDate } from '../../../utils/calcAge'
import styles from './f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })

export default function F1FastestLapTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1FastestLaps(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.laps?.length) return <Empty />

  const laps = data.laps.filter(l =>
    !search || l.gp_name?.toLowerCase().includes(search.toLowerCase()) ||
    l.driver_name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.wrap}>
      <div className="page-title">Fastest Laps</div>

      <div className="filter-bar">
        <input className="search-input" placeholder="Search race" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
        <thead>
          <tr>
            <th className="table-label" style={th('left')}>Race</th>
            <th className="table-label" style={th('left')}>Driver</th>
            <th className="table-label" style={th('center')}>Age</th>
            <th className="table-label" style={th('left')}>Team</th>
            <th className="table-label" style={th('center')}>Time</th>
            <th className="table-label" style={th('center')}>Date</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((lap, i) => {
            const img = resolveImg(lap.driver_image)
            const age = calcAge(lap.birth_date, lap.event_date)
            return (
              <tr key={i} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td>
                  <div className={styles.gpCell}>
                    <Flag iso2={lap.circuit_country_iso2} name={lap.circuit_country_name} className={styles.gpFlag} />
                    <span style={{ fontWeight: 'normal' }}>{lap.gp_name}</span>
                  </div>
                </td>
                <td style={{ textAlign: 'left' }}>
                  <div className="entity-cell">
                    {img
                      ? <img src={img} alt={lap.driver_name} className="avatar" onError={e => { e.target.style.display = 'none' }} />
                      : <div className="avatar-placeholder">{(lap.driver_name || '?').charAt(0)}</div>
                    }
                    <div className="entity-stack">
                      <span style={{ fontWeight: 'normal' }}>{lap.driver_name || '—'}</span>
                      <div className="entity-meta-row">
                        <Flag iso2={lap.driver_country_iso2} name={lap.driver_country_name} className="flag" />
                        <span className="cell-meta">{lap.driver_country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value">{age}</span>
                      <span className="cell-meta">{fmtBirth(lap.birth_date)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'left' }}>{lap.team_name || '—'}</td>
                <td style={{ textAlign: 'center', fontWeight: 'normal' }}>{lap.time_result || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{fmtDate(lap.event_date)}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No fastest lap data available.</div>
}
