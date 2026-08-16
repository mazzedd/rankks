// templates/f1/F1FastestLapTemplate.jsx
// Columns per RANKKS F1 Master Spec §3: Race | Driver | Team | Time
//
// FILTERS — "All Teams"/"All Drivers" dropdowns added alongside the
// existing search box, plus a Clear button once any filter is active
// (same bare-name filters and same convention F1RacesTemplate/
// F1SessionResultsTemplate use, not a "Team + Engine" combined string).
//
// RACE — date moved beneath the GP name (same treatment as
// F1RacesTemplate): flag + name share one row so the flag centers
// against just the name, not the whole 2-line block; date sits on its
// own line underneath both. No longer its own column.
//
// TEAM — 2-line stack, team name + "Engine: X" beneath (same as
// F1RacesTemplate's Team cell) — was a single flattened "Team Engine"
// string before; /f1/fastest-laps/:seasonId now exposes team_name_raw/
// engine_name separately instead of only the combined display string.
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
// BOLD RULE — Race name is the ONLY bold/strong value in this table;
// Driver name, Age, Team, Time are all normal weight (same "one strong
// column" rule as F1RacesTemplate/F1PoleTemplate).
//
// COLUMN WIDTHS — table-layout: fixed (.fixedTable) with an explicit
// width % on every <th>, summing to 100% — see F1RacesTemplate's own
// comment for why (auto-layout's leftover-space distribution across
// unwidthed columns is not predictable once even one column is forced
// narrower).
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

export default function F1FastestLapTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter]     = useState('')
  const [driverFilter, setDriverFilter] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1FastestLaps(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'formula-1-world-championship', 'Standings', 'Fastest Lap', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => {
    setSearch(''); setTeamFilter(''); setDriverFilter('')
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.laps?.length) return <Empty />

  const teams   = [...new Set(data.laps.map(l => l.team_name_raw).filter(Boolean))].sort()
  const drivers = [...new Set(data.laps.map(l => l.driver_name).filter(Boolean))].sort()

  const laps = data.laps.filter(l => {
    if (search && !l.gp_name?.toLowerCase().includes(search.toLowerCase()) &&
        !l.driver_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && l.team_name_raw !== teamFilter) return false
    if (driverFilter && l.driver_name !== driverFilter) return false
    return true
  })

  const hasActiveFilter = search || teamFilter || driverFilter

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search race" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={driverFilter} onChange={e => setDriverFilter(e.target.value)}>
          <option value="">All Drivers</option>
          {drivers.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setDriverFilter('') }}>
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
            <th className="table-label" style={{ ...th('left'), width: '17%' }}>Driver</th>
            <th className="table-label" style={{ ...th('center'), width: '10%' }}>Age</th>
            <th className="table-label" style={{ ...th('left'), width: '27%' }}>Team</th>
            <th className="table-label" style={{ ...th('center'), width: '24%' }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {laps.map((lap, i) => {
            const img = resolveImg(lap.driver_image)
            const age = calcAge(lap.birth_date, lap.event_date, lap.death_date)
            return (
              <tr key={i} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}>
                  <span className="event-rank">{lap.round_order}</span>
                </td>
                <td>
                  <div className="entity-stack">
                    <div className={styles.gpCell}>
                      <Flag iso2={lap.circuit_country_iso2} name={lap.circuit_country_name} className={styles.gpFlag} />
                      <span style={{ fontWeight: 700 }}>{lap.gp_name}</span>
                    </div>
                    <span className="cell-meta">{fmtDate(lap.event_date)}</span>
                  </div>
                </td>
                <td style={{ textAlign: 'left' }}>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={lap.driver_name} sport="f1" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                        {lap.driver_name || '—'}
                        {lap.car_number != null && <span className="athletePosition"> - {lap.car_number}</span>}
                      </span>
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
                      <span className="stat-stack-value-light">{age}</span>
                      <span className="cell-meta">{fmtBirth(lap.birth_date)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'left' }}>
                  {lap.team_name_raw ? (
                    <div className="entity-stack">
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{lap.team_name_raw}</span>
                      {lap.engine_name && <span className="cell-meta">{lap.engine_name}</span>}
                    </div>
                  ) : '—'}
                </td>
                <td style={{ textAlign: 'center', fontWeight: 'normal' }}>{lap.time_result || '—'}</td>
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
