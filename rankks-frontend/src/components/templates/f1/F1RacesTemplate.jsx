// templates/f1/F1RacesTemplate.jsx
// Season race overview — per locked spec: ONE ROW per race, winner only
// (not podium/top-3). Columns: Race | Driver | Team | Time | Laps |
// Date | Race type (Sprint/Regular)
//
// AVATAR + FLAG — uses driver_image and driver_country_iso2/
// driver_country_name, both added to the /f1/races/:seasonId backend
// route alongside this fix (previously neither was selected at all).
//
// CIRCUIT FLAG — uses circuit_country_iso2/circuit_country_name, added
// to the /f1/races/:seasonId backend route via a LEFT JOIN countries
// gpco ON gpco.id = gp.country_id. Previously called
// <Flag iso2={null} .../>, which never resolved to an actual flag since
// Flag keys off iso2, not the display name. Backfilled via
// gp.country_id (added directly on f1_grands_prix; f1_circuits was
// empty/unused).
//
// FLAG SIZING — driver flag now uses the shared .flag class (18×12),
// matching every other F1 table (Drivers/Qualifying/SessionResults/
// Teams). Previously used .gpFlag (20×13) for the driver too, which was
// drift, not a deliberate size — .gpFlag is now reserved for the
// circuit flag only.
//
// Per explicit design note for this table specifically: the driver name
// here is regular weight, NOT bold — a deliberate deviation from the
// Drivers/Teams standings tables where the name column is bold.
//
// ALIGNMENT — Race column bold + left (unchanged, via the gpCell class).
// Laps: centered. Every other column left-aligned. Every header label
// is explicitly bold.
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
import AthleteAvatar from '../../shared/AthleteAvatar'
import { calcAge, fmtBirth, fmtDate } from '../../../utils/calcAge'
import styles from './f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })

export default function F1RacesTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1Races(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.races?.length) return <Empty />

  const races = data.races.filter(r =>
    !search || r.gp_name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.wrap}>
      <div className="page-title">Races</div>

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
            <th className="table-label" style={th('center')}>Laps</th>
            <th className="table-label" style={th('center')}>Date</th>
            <th className="table-label" style={{ ...th('left'), paddingLeft: '18px' }}>Type</th>
          </tr>
        </thead>
        <tbody>
          {races.map((race, i) => {
            const img = resolveImg(race.driver_image)
            const age = calcAge(race.birth_date, race.event_date, race.death_date)
            return (
              <tr key={race.race_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td>
                  <div className={styles.gpCell}>
                    <Flag iso2={race.circuit_country_iso2} name={race.circuit_country_name} className={styles.gpFlag} />
                    <div className={styles.gpName}>{race.gp_name}</div>
                  </div>
                </td>
                <td style={{ textAlign: 'left' }}>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={race.driver_name} sport="f1" gender="M" className="avatar" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 'normal' }}>{race.driver_name}</span>
                      <div className="entity-meta-row">
                        <Flag iso2={race.driver_country_iso2} name={race.driver_country_name} className="flag" />
                        <span className="cell-meta">{race.driver_country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value">{age}</span>
                      <span className="cell-meta">{fmtBirth(race.birth_date)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'left' }}>{race.team_name || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{race.time_result || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{race.laps ?? '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{fmtDate(race.event_date)}</td>
                <td className={styles.typeCell} style={{ textAlign: 'left' }}>
                  <span className={`${styles.badge} ${race.is_sprint_weekend ? styles.sprint : styles.regular}`}>
                    {race.is_sprint_weekend ? 'Sprint' : 'Regular'}
                  </span>
                </td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No race data available.</div>
}
