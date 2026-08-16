// templates/f1/F1RacesTemplate.jsx
// Season race overview — one row per RACE SESSION (winner only, not
// podium/top-3). A sprint weekend has two separately-won races (Sprint
// Saturday, Grand Prix Sunday) so it contributes two rows now, each
// tagged by its own session type — was previously one row per GP only
// (always the Sunday result), which silently dropped every sprint
// weekend's Sprint winner entirely. Columns: Race | Winner | Age | Team |
// Time | Pole | Laps | Type.
//
// RACE — date moved beneath the GP name (same stat-stack shape as Age),
// no longer its own column. Race name is the ONLY bold/strong value in
// this table (Winner name, Age, Team, Time, Pole are all normal weight —
// same "one strong column" rule as F1FastestLapTemplate/F1PoleTemplate).
//
// COLUMN WIDTHS — table-layout: fixed (.fixedTable) with an explicit
// width % on every <th>, summing to 100%. Auto-layout (the default)
// gives unwidthed columns a share of the table's leftover space based on
// their own max-content size, which is fine when every column is
// unwidthed but breaks down the moment even one column is forced
// smaller (tried shrinking just Winner/Age to content-width — the
// browser dumped ALL the recovered space into Team instead of spreading
// it, an even worse gap one column over). Fixed layout + explicit
// percentages is the only way to make every column's width deterministic
// at once.
//
// POLE — the pole-sitter for whichever qualifying session actually set
// THIS row's grid: "Sprint Qualifying" for a Sprint row, plain
// "Qualifying" for a Race row (added via a second qualifying-session join
// in /f1/races/:seasonId — pole_driver_name). Name only, no flag/country
// — this column is a cross-reference, not a full entity cell like Winner.
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
// TEAM — plain 2-line stack, team name + "Engine: X" beneath — no logo
// (matches the Drivers standings table's own logo removal).
//
// FILTERS — All teams / All drivers dropdowns (bare names, not the
// "Team + Engine" combined display string, same reasoning as Drivers'
// own team filter). Regular/Sprint are independent toggle buttons (same
// "either, both, or neither active" pattern as the All-Time page's
// Alive/Deceased toggle) rather than a single-select dropdown, since a
// user comparing sprint vs. non-sprint weekends wants to flip between
// them quickly.
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

// Sprint race weekends didn't exist before 2021 (F1 introduced the
// format at that year's British GP) — the Regular/Sprint toggle is
// meaningless (and misleading, implying sprints might exist) for any
// earlier season, so it's only shown from 2021 onward.
const SPRINT_ERA_START_YEAR = 2021

export default function F1RacesTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter]     = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [showRegular, setShowRegular]   = useState(false)
  const [showSprint, setShowSprint]     = useState(false)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1Races(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'formula-1-world-championship', 'Standings', 'Races', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => {
    setSearch(''); setTeamFilter(''); setDriverFilter(''); setShowRegular(false); setShowSprint(false)
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.races?.length) return <Empty />

  const teams   = [...new Set(data.races.map(r => r.team_name_raw).filter(Boolean))].sort()
  const drivers = [...new Set(data.races.map(r => r.driver_name).filter(Boolean))].sort()
  const hasSprintEra = year >= SPRINT_ERA_START_YEAR

  // Independent toggles — both or neither active means no type filter
  // (show everything), same convention as the All-Time page's Alive/
  // Deceased toggle.
  const onlyRegular = hasSprintEra && showRegular && !showSprint
  const onlySprint  = hasSprintEra && showSprint && !showRegular

  const races = data.races.filter(r => {
    if (search && !r.gp_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && r.team_name_raw !== teamFilter) return false
    if (driverFilter && r.driver_name !== driverFilter) return false
    if (onlyRegular && r.is_sprint_race) return false
    if (onlySprint && !r.is_sprint_race) return false
    return true
  })

  const hasActiveFilter = search || teamFilter || driverFilter || showRegular || showSprint

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
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setDriverFilter(''); setShowRegular(false); setShowSprint(false) }}>
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
            const img = resolveImg(race.driver_image)
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
                      <span className={styles.gpName} style={{ fontWeight: 700 }}>{race.gp_name}</span>
                    </div>
                    <span className="cell-meta">{fmtDate(race.event_date)}</span>
                  </div>
                </td>
                <td style={{ textAlign: 'left' }}>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={race.driver_name} sport="f1" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                        {race.driver_name}
                        {race.car_number != null && <span className="athletePosition"> - {race.car_number}</span>}
                      </span>
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
                      <span className="stat-stack-value-light">{age}</span>
                      <span className="cell-meta">{fmtBirth(race.birth_date)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'left' }}>
                  {race.team_name_raw ? (
                    <div className="entity-stack">
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{race.team_name_raw}</span>
                      {race.engine_name && (
                        <span className="cell-meta">{race.engine_name}</span>
                      )}
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{race.time_result || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'left' }}>{race.pole_driver_name || '—'}</td>
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
