// templates/f1/F1SessionResultsTemplate.jsx
// Race Results (regular + sprint): Pos | Driver | Age | Seasons | Team |
// Time/Retired | Laps | Pts.
// Practice: Pos | Driver | Age | Seasons | Team | Time/Gap | Laps
//
// Car number ("No") is no longer its own column — moved inline as a
// muted " - N" suffix after the driver's name (same convention as
// F1DriversTemplate/F1RacesTemplate/F1FastestLapTemplate).
//
// SEASONS — same stat-stack shape as Age: count of distinct F1 seasons
// raced through this race's year bold on top (not a first-last year-span
// calculation, which would wrongly count a driver's career-gap years,
// e.g. a sabbatical/comeback, as "active"), the real first-last season
// range still shown beneath. Added to /f1/session/:sessionId/results
// (both the real-results query and the no-results-yet placeholder query)
// via the same career-span subquery F1DriversTemplate uses.
//
// COLUMN WIDTHS — table-layout: fixed (.fixedTable) with an explicit
// width % on every <th>, summing to 100% (two sets, since Practice drops
// the Pts. column — see F1RacesTemplate's own comment for why fixed
// layout is necessary at all: auto-layout's leftover-space distribution
// across unwidthed columns is not predictable once even one column is
// forced narrower).
//
// FLAG + COUNTRY — uses driver_country_iso2/driver_country_name, added
// to the /f1/session/:sessionId/results backend route alongside this
// fix. AVATAR now uses the real driver_image field via resolveImg,
// replacing the previous hardcoded-guessed-path helper (same class of
// bug already fixed elsewhere).
//
// AGE — now uses the shared calcAge(birthDate, refDate) util, with
// refDate = data.session.event_date (the GP's real date, now joined
// into the backend route). Previously used today's date, which meant a
// driver's age silently changed on every page view instead of being
// pinned to the race — same unified rule now applied across football,
// tennis, and F1.
//
// Per explicit design note: driver name is regular weight, NOT bold.
// Every header label is bold. Team left, Time right, Points right.
//
// VIDEO — reuses the shared MatchVideo component (Build Log v2.1), shown
// only on the Race tab.
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
import MatchVideo from '../../shared/MatchVideo'
import SearchableSelect from '../../shared/SearchableSelect'
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

export default function F1SessionResultsTemplate({ sessionId, sessionType, gpName, year, status, scheduleRange, videoUrl, videoId, source, embeddable, thumbnailUrl, pageSubtitle }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
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
    setTeamFilter(''); setDriverFilter(''); setEngineFilter('')
  }, [sessionId])

  if (loading) return <Skeleton />

  // Next/Future GPs — no driver list (a future round has no results, and
  // the backend's standings-based placeholder entry list is misleading
  // dressed up as one) — just state when the weekend happens, per
  // 2026-08-10: "remove drivers and riders list, display the sentence".
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

  // "Race Results" is the unified label per spec, but Sprint sessions use
  // the same points/columns as a race — both count as "race-type" here.
  const isRaceType = sessionType === 'Race' || sessionType === 'Sprint'
  // The video, however, is tied to the race weekend as a whole
  // (grand_prix_id) and only ever shown on the main Race tab, per
  // product decision — not duplicated onto Sprint or Practice tabs.
  const showVideo = sessionType === 'Race' && !!videoUrl

  const teams   = [...new Set(data.results.map(r => r.team_name_raw).filter(Boolean))].sort()
  const drivers = [...new Set(data.results.map(r => r.driver_name).filter(Boolean))].sort()
  const engines = [...new Set(data.results.map(r => r.engine_name).filter(Boolean))].sort()

  const results = data.results.filter(r => {
    if (teamFilter && r.team_name_raw !== teamFilter) return false
    if (driverFilter && r.driver_name !== driverFilter) return false
    if (engineFilter && r.engine_name !== engineFilter) return false
    return true
  })

  const hasActiveFilter = teamFilter || driverFilter || engineFilter

  const eventDate = data.session?.event_date

  return (
    <div className={styles.wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ alignSelf: 'flex-start' }}>
          {/* Admin-set sponsor name (race_naming era override) when one
              covers this year, else the plain GP name — both suffixed with
              the year, e.g. "Formula 1 Qatar Airways Australian Grand Prix
              - 2026" or, with no override entered, "Barcelona - 2026". */}
          {gpName && <div className="page-subtitle">{pageSubtitle || gpName} - {year}{sessionType ? ` - ${sessionType}` : ''}</div>}
        </div>
        {showVideo && (
          <MatchVideo
            videoUrl={videoUrl}
            source={source}
            embeddable={embeddable}
            thumbnailUrl={thumbnailUrl}
            inline
            videoId={videoId}
            videoType="f1_race_video"
            title="Race"
            subtitle={`${gpName} ${year}`}
            status={status}
          />
        )}
      </div>

      {data.is_placeholder && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
          Entry list based on current season standings — results not published yet.
        </div>
      )}

      <div className="filter-bar">
        <SearchableSelect
          value={driverFilter}
          onChange={setDriverFilter}
          options={drivers.map(d => ({ value: d, label: d }))}
          allLabel="All Drivers"
        />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={engineFilter} onChange={e => setEngineFilter(e.target.value)}>
          <option value="">All Engines</option>
          {engines.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setTeamFilter(''); setDriverFilter(''); setEngineFilter('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{results.length} results</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos} style={{ width: isRaceType ? '7%' : '8%' }}></th>
            <th className="table-label" style={{ ...th('left'), width: isRaceType ? '19%' : '19%' }}>Driver</th>
            <th className="table-label" style={{ ...th('center'), width: isRaceType ? '8%' : '8%' }}>Age</th>
            <th className="table-label" style={{ ...th('center'), width: isRaceType ? '11%' : '13%' }}>Seasons</th>
            <th className="table-label" style={{ ...th('left'), width: isRaceType ? '23%' : '27%' }}>Team</th>
            <th className="table-label" style={{ ...th('center'), width: isRaceType ? '17%' : '16%' }}>{isRaceType ? 'Time / Retired' : 'Time / Gap'}</th>
            <th className="table-label" style={{ ...th('center'), width: isRaceType ? '8%' : '9%' }}>Laps</th>
            {isRaceType && <th className="table-label" style={{ ...th('right'), width: '7%' }}>Pts.</th>}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const isDNF = r.time_result === 'DNF'
            const img = resolveImg(r.driver_image)
            const age = calcAge(r.birth_date, eventDate, r.death_date)
            return (
              <tr key={r.driver_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}>
                  <span className={`event-rank ${isDNF ? styles.dnf : ''}`}>{r.position}</span>
                </td>
                <td>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={r.driver_name} sport="f1" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {r.driver_name}
                        {r.car_number != null && <span className="athletePosition"> - {r.car_number}</span>}
                      </span>
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
                <td className="stats-light" style={{ textAlign: 'center' }}>
                  {r.seasons_count != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{r.seasons_count}</span>
                      <span className="cell-meta">
                        {r.active_from === r.active_to ? `${r.active_from}` : `${r.active_from}-${r.active_to}`}
                      </span>
                    </div>
                  ) : '—'}
                </td>
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
                <td className={`stats-light ${isDNF ? styles.dnfTime : ''}`} style={{ textAlign: 'center' }}>{r.time_result || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{r.laps ?? '—'}</td>
                {isRaceType && <td className="stats-strong" style={{ textAlign: 'right' }}>{r.points ?? '—'}</td>}
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No results available for this session.</div>
}
