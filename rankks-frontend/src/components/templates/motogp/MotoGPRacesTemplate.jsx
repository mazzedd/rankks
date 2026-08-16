// templates/motogp/MotoGPRacesTemplate.jsx
// Season race overview — one row per RACE SESSION (winner only), same
// shape as F1RacesTemplate.jsx: Race | Winner | Age | Team | Time | Pole |
// Laps | Type. A sprint weekend contributes two rows (Sprint Saturday,
// Grand Prix Sunday), each tagged by is_sprint_race.
//
// SPRINT ERA — unlike F1 (hardcoded SPRINT_ERA_START_YEAR = 2021, one
// competition-wide format change), MotoGP sprints only exist for the
// motogp category from 2023 on — Moto2/Moto3 never race sprints at all
// (onboarding-motogp.md). Rather than hardcode both a year AND a category
// check, the Regular/Sprint toggle is only shown when the season's own
// data actually contains a sprint row — self-describing, matches this
// project's "convention over configuration" rule, and needs no update if
// the sprint format ever expands to Moto2/Moto3.
//
// "Engine:" relabeled "Constructor:" per instruction, same as the other
// MotoGP templates.
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

export default function MotoGPRacesTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter]     = useState('')
  const [riderFilter, setRiderFilter]   = useState('')
  const [showRegular, setShowRegular]   = useState(false)
  const [showSprint, setShowSprint]     = useState(false)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getMotoGPRaces(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'motogp', 'Standings', 'Races', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => {
    setSearch(''); setTeamFilter(''); setRiderFilter(''); setShowRegular(false); setShowSprint(false)
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.races?.length) return <Empty />

  const teams  = [...new Set(data.races.map(r => r.team_name_raw || r.constructor_name).filter(Boolean))].sort()
  const riders = [...new Set(data.races.map(r => r.rider_name).filter(Boolean))].sort()
  const hasSprintEra = data.races.some(r => r.is_sprint_race)

  const onlyRegular = hasSprintEra && showRegular && !showSprint
  const onlySprint  = hasSprintEra && showSprint && !showRegular

  const races = data.races.filter(r => {
    if (search && !r.gp_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && (r.team_name_raw || r.constructor_name) !== teamFilter) return false
    if (riderFilter && r.rider_name !== riderFilter) return false
    if (onlyRegular && r.is_sprint_race) return false
    if (onlySprint && !r.is_sprint_race) return false
    return true
  })

  const hasActiveFilter = search || teamFilter || riderFilter || showRegular || showSprint

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
        {hasSprintEra && (
          <div className={styles.statusToggle}>
            <button
              type="button"
              className={`${styles.statusBtn} ${showRegular ? styles.statusBtnActive : ''}`}
              onClick={() => setShowRegular(v => !v)}
            >
              Regular
            </button>
            <button
              type="button"
              className={`${styles.statusBtn} ${showSprint ? styles.statusBtnActive : ''}`}
              onClick={() => setShowSprint(v => !v)}
            >
              Sprint
            </button>
          </div>
        )}
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setRiderFilter(''); setShowRegular(false); setShowSprint(false) }}>
            Clear
          </button>
        )}
        <span className="filter-total">{races.length} races</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos} style={{ width: '4%' }}></th>
            <th className="table-label" style={{ ...th('left'), width: '17%' }}>Race</th>
            <th className="table-label" style={{ ...th('left'), width: '18%' }}>Winner</th>
            <th className="table-label" style={{ ...th('center'), width: '8%' }}>Age</th>
            <th className="table-label" style={{ ...th('left'), width: '13%' }}>Team</th>
            <th className="table-label" style={{ ...th('center'), width: '11%' }}>Time</th>
            <th className="table-label" style={{ ...th('left'), width: '14%' }}>Pole</th>
            <th className="table-label" style={{ ...th('center'), width: '6%' }}>Laps</th>
            <th className="table-label" style={{ ...th('left'), paddingLeft: '18px', width: '9%' }}>Type</th>
          </tr>
        </thead>
        <tbody>
          {races.map((race, i) => {
            const img = resolveImg(race.rider_image)
            const age = calcAge(race.birth_date, race.event_date, race.death_date)
            return (
              <tr key={race.session_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}>
                  <span className="event-rank">{race.round_order}</span>
                </td>
                <td>
                  <div className="entity-stack">
                    <div className={styles.gpCell}>
                      <Flag iso2={race.circuit_country_iso2} name={race.circuit_country_name} className={styles.gpFlag} />
                      <span className={styles.gpName} style={{ fontWeight: 700 }}>{shortGpLabel(race.gp_name)}</span>
                    </div>
                    <span className="cell-meta">{fmtDate(race.event_date)}</span>
                  </div>
                </td>
                <td style={{ textAlign: 'left' }}>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={race.rider_name} sport="moto-racing" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                        {race.rider_name}
                        {race.car_number != null && <span className="athletePosition"> - {race.car_number}</span>}
                      </span>
                      <div className="entity-meta-row">
                        <Flag iso2={race.rider_country_iso2} name={race.rider_country_name} className="flag" />
                        <span className="cell-meta">{race.rider_country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{age}</span>
                      <span className="cell-meta">{fmtBirth(race.birth_date)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'left' }}>
                  {race.team_name_raw ? (
                    <div className="entity-stack">
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{race.team_name_raw}</span>
                      {race.constructor_name && (
                        <span className="cell-meta">{race.constructor_name}</span>
                      )}
                    </div>
                  ) : race.constructor_name ? (
                    <span className="club-name" style={{ fontWeight: 'normal' }}>{race.constructor_name}</span>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{race.time_result || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'left' }}>{race.pole_rider_name || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{race.laps ?? '—'}</td>
                <td className={styles.typeCell} style={{ textAlign: 'left' }}>
                  <span className={`${styles.badge} ${race.is_sprint_race ? styles.sprint : styles.regular}`}>
                    {race.is_sprint_race ? 'Sprint' : 'Regular'}
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
