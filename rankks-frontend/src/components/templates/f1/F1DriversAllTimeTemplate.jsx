// templates/f1/F1DriversAllTimeTemplate.jsx
// All-Time > Drivers — career cumulative stats "through <year>", the F1
// counterpart of players_all_time_template.jsx. Backed by
// /f1/drivers-all-time/:seasonId, which sums f1_driver_standings rows
// (points/wins/2nd/3rd/sprint wins) and derives races/poles/fastest laps
// from f1_session_results/f1_fastest_laps, all scoped to season.year <=
// the selected year — see that route's comment for the "through year"
// convention (career-wide, not just the active grid).
//
// Title/subtitle text is a fixed rule (not the basketball all-time
// pattern, which has no "ongoing" concept):
//   ongoing season -> "All-Time driver stats - <year> (season in progress)"
//   past season    -> "All-Time driver stats through <year>"
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
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
  { key: 'seasons',       label: 'Seasons' },
  { key: 'championships', label: 'Championships' },
  { key: 'points',        label: 'Points' },
  { key: 'races',         label: 'Races' },
  { key: 'wins',          label: 'Wins' },
  { key: 'p2',            label: '2nd' },
  { key: 'p3',            label: '3rd' },
  { key: 'sprint_wins',   label: 'Sprint' },
  { key: 'poles',         label: 'Poles' },
  { key: 'fastest_laps',  label: 'Fastest Lap' },
]

function getName(d) { return (d.canonical_name || '').toLowerCase() }

// The cross only makes sense once the "through <year>" context is past
// the death itself — viewing "through 1993" for a driver who died in
// 1994 shouldn't mark him deceased yet (he was alive that whole year).
// Shows starting the year AFTER death (death year + 1), not the death
// year itself, since a mid-year death still leaves the death year's own
// stats reflecting a driver who was alive for part of it.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

const PAGE_SIZE = 25

export default function F1DriversAllTimeTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter]       = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [showAlive, setShowAlive]         = useState(false)
  const [showDeceased, setShowDeceased]   = useState(false)
  const [sortStat, setSortStat]           = useState('')
  const [page, setPage]                   = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1DriversAllTime(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setTeamFilter(''); setCountryFilter(''); setShowAlive(false); setShowDeceased(false); setSortStat(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, teamFilter, countryFilter, showAlive, showDeceased, sortStat])

  if (loading) return <Skeleton />
  if (!data?.drivers?.length) return <Empty />

  const teams = [...new Set(data.drivers.map(d => d.team_name).filter(Boolean))].sort()
  const countries = [...new Map(
    data.drivers.filter(d => d.country_iso2).map(d => [d.country_iso2, d.country_name || d.country_iso2])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  // Independent toggle tags, not a radio group — both active (or neither)
  // means no status filtering at all, only one active narrows the list.
  // Same "through <year>" rule as the cross mark itself — a driver who
  // died the very year being viewed isn't "Deceased" in that context yet.
  const onlyAlive    = showAlive && !showDeceased
  const onlyDeceased = showDeceased && !showAlive

  let rows = data.drivers.filter(d => {
    if (search && !d.canonical_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && d.team_name !== teamFilter) return false
    if (countryFilter && d.country_iso2 !== countryFilter) return false
    if (onlyAlive && showDeceasedMark(d.death_date, data.year)) return false
    if (onlyDeceased && !showDeceasedMark(d.death_date, data.year)) return false
    return true
  })

  if (sortStat) {
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

  const subtitle = data.season_status === 'current'
    ? `All-Time driver stats - ${data.year} (season in progress)`
    : `All-Time driver stats through ${data.year}`

  // Age reference date must track the selected year (this is a "through
  // <year>" page — scrolling to 1988 should show 1988 ages), not always
  // today. The ongoing season is the one exception: it isn't over yet,
  // so there's no real "end of year" date to use — today is the correct
  // reference until the season actually finishes.
  const ageRefDate = data.season_status === 'current' ? new Date() : new Date(`${data.year}-12-31`)

  const hasActiveFilter = search || teamFilter || countryFilter || showAlive || showDeceased || sortStat
  const sorted = key => sortStat === key ? 'sorted-col' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className={styles.wrap}>
      <div className="page-title">Drivers</div>
      <div className={styles.subtitle}>{subtitle}</div>

      <div className="filter-bar">
        <input className="search-input" placeholder="Search driver" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All countries</option>
          {countries.map(([iso2, name]) => <option key={iso2} value={iso2}>{name}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <div className={styles.statusToggle}>
          <button
            type="button"
            className={`${styles.statusBtn} ${showAlive ? styles.statusBtnActive : ''}`}
            onClick={() => setShowAlive(v => !v)}
          >
            Alive
          </button>
          <button
            type="button"
            className={`${styles.statusBtn} ${showDeceased ? styles.statusBtnActive : ''}`}
            onClick={() => setShowDeceased(v => !v)}
          >
            Deceased
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setCountryFilter(''); setShowAlive(false); setShowDeceased(false); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} drivers</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.pos}></th>
              <th className="table-label" style={th('left')}>Player</th>
              <th className="table-label" style={th('center')}>Age</th>
              <th className={`table-label ${sorted('championships')}`} style={th('center')}>Seas./Champ</th>
              <th className={`table-label ${sorted('points')}`} style={th('right')}>Pts</th>
              <th className={`table-label ${sorted('races')}`} style={th('center')}>Races</th>
              <th className={`table-label ${sorted('wins')}`} style={th('center')}>Wins</th>
              <th className={`table-label ${sorted('p2')}`} style={th('center')}>2nd</th>
              <th className={`table-label ${sorted('p3')}`} style={th('center')}>3rd</th>
              <th className={`table-label ${sorted('sprint_wins')}`} style={th('center')}>Sprint</th>
              <th className={`table-label ${sorted('poles')}`} style={th('center')}>Poles</th>
              <th className={`table-label ${sorted('fastest_laps')}`} style={th('center')}>Fastest Lap</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((d, i) => {
              const globalRank = pageStart + i + 1
              const img = resolveImg(d.logo_url)
              const age = calcAge(d.birth_date, ageRefDate, d.death_date)
              const birth = fmtBirth(d.birth_date)
              return (
                <tr key={d.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos}><span className="event-rank">{globalRank}</span></td>
                  <td>
                    <div className="entity-cell">
                      <AthleteAvatar src={img} name={d.canonical_name} sport="f1" gender="M" className="avatar" />
                      <div className="entity-stack">
                        <span className="club-name">{d.canonical_name}</span>
                        <div className="entity-meta-row">
                          <Flag iso2={d.country_iso2} name={d.country_name} className="flag" />
                          <span className="cell-meta">{d.country_name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={td('center')}>
                    {age != null ? (
                      <div className="stat-stack">
                        <span className="stat-stack-value">
                          {age}
                          {showDeceasedMark(d.death_date, data.year) && <span className="deceased-mark" title="Deceased">✝</span>}
                        </span>
                        <span className="cell-meta">{birth}</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className={`${sorted('championships')}`} style={td('center')}>
                    <span className="stats-strong">{d.stats.seasons}/{d.stats.championships}</span>
                  </td>
                  <td className={`stats-strong ${sorted('points')}`} style={td('right')}>{d.stats.points ?? 0}</td>
                  <td className={`stats-light ${sorted('races')}`} style={td('center')}>{d.stats.races}</td>
                  <td className={`stats-light ${sorted('wins')}`} style={td('center')}>{d.stats.wins}</td>
                  <td className={`stats-light ${sorted('p2')}`} style={td('center')}>{d.stats.p2}</td>
                  <td className={`stats-light ${sorted('p3')}`} style={td('center')}>{d.stats.p3}</td>
                  <td className={`stats-light ${sorted('sprint_wins')}`} style={td('center')}>{d.stats.sprint_wins}</td>
                  <td className={`stats-light ${sorted('poles')}`} style={td('center')}>{d.stats.poles}</td>
                  <td className={`stats-light ${sorted('fastest_laps')}`} style={td('center')}>{d.stats.fastest_laps}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No driver data available.</div>
}
