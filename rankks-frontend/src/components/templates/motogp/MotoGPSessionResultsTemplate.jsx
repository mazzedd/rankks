// templates/motogp/MotoGPSessionResultsTemplate.jsx
// Race/Sprint: Pos | Rider | Age | Team | Time/Retired | Laps | Pts.
// Practice/Qualifying/Warm Up: Pos | Rider | Age | Team | Best Lap |
// Top Speed | Laps (no points column) — MotoGP's source gives best_lap_time
// + top_speed for these, not a Time/Gap column like F1's practice sessions.
// Same "Constructor:" relabel as MotoGPRidersTemplate.jsx.
//
// VIDEO — removed from this page (Mohamed 2026-08-23: "assign to MotoGP/2/3
// the same changes we did before... Watch Video per race", same "Video
// icon: completely remove... add a Line B 'Watch Center'" F1 got) — the
// race's summary video now lives on its own Line B tab
// (MotoGPContentArea.jsx's isWatchMode / MotoGPGPWatchBlock), not inline
// here.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import SearchableSelect from '../../shared/SearchableSelect'
import { calcAge, fmtBirth, fmtDate } from '../../../utils/calcAge'
import { STATUS_LABEL } from '../../../utils/eventStatus'
import styles from '../f1/f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })

export default function MotoGPSessionResultsTemplate({ sessionId, gpName, year, status, pageSubtitle, sessionType }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [teamFilter, setTeamFilter] = useState('')
  const [riderFilter, setRiderFilter] = useState('')
  const [constructorFilter, setConstructorFilter] = useState('')

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    api.getMotoGPSessionResults(sessionId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => { setTeamFilter(''); setRiderFilter(''); setConstructorFilter('') }, [sessionId])

  if (loading) return <Skeleton />

  // No real results yet — a future round hasn't been raced (status
  // 'next'/'upcoming'), or this exact session hasn't run even though the
  // GP weekend as a whole is 'ongoing' (e.g. Practice/Qualifying already
  // raced but Sunday's Race hasn't happened yet). Keyed off
  // data.is_placeholder (the backend's own "no real rows, fell back to
  // standings" signal — see motogp.js) rather than status alone, same
  // fix F1SessionResultsTemplate.jsx got (Mohamed 2026-08-23: "remove any
  // content from Netherlands / Race since we dont have any result yet").
  // The message names THIS exact session and its own real date, not the
  // whole weekend's range.
  if (status === 'next' || status === 'upcoming' || data?.is_placeholder) {
    const label = (data?.is_placeholder && status === 'ongoing') ? STATUS_LABEL.next : STATUS_LABEL[status]
    return (
      <div className={styles.wrap}>
        <div className="page-subtitle">{pageSubtitle || gpName} - {year}{sessionType ? ` - ${sessionType}` : ''}</div>
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>
          {label} {sessionType || 'Session'} — scheduled {fmtDate(data?.session?.event_date)}
        </div>
      </div>
    )
  }

  if (!data?.results?.length) return <Empty />

  const isRaceType = data.session?.session_type === 'RAC' || data.session?.session_type === 'SPR'
  const eventDate = data.session?.event_date

  const teams = [...new Set(data.results.map(r => r.team_name).filter(Boolean))].sort()
  const riders = [...new Set(data.results.map(r => r.rider_name).filter(Boolean))].sort()
  const constructors = [...new Set(data.results.map(r => r.constructor_name).filter(Boolean))].sort()
  const results = data.results.filter(r => {
    if (teamFilter && r.team_name !== teamFilter) return false
    if (riderFilter && r.rider_name !== riderFilter) return false
    if (constructorFilter && r.constructor_name !== constructorFilter) return false
    return true
  })

  return (
    <div className={styles.wrap}>
      {/* Admin-set sponsor name (race_naming era override) when one
          covers this year, else the plain GP name — both suffixed
          with the year, same convention F1's GP pages use. */}
      <div className="page-subtitle">{pageSubtitle || gpName} - {year}{sessionType ? ` - ${sessionType}` : ''}</div>

      <div className="filter-bar">
        <SearchableSelect
          value={riderFilter}
          onChange={setRiderFilter}
          options={riders.map(r => ({ value: r, label: r }))}
          allLabel="All Riders"
        />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={constructorFilter} onChange={e => setConstructorFilter(e.target.value)}>
          <option value="">All Constructors</option>
          {constructors.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(teamFilter || riderFilter || constructorFilter) && (
          <button className="filter-reset" onClick={() => { setTeamFilter(''); setRiderFilter(''); setConstructorFilter('') }}>Clear</button>
        )}
        <span className="filter-total">{results.length} results</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos}></th>
            <th className="table-label" style={th('left')}>Rider</th>
            <th className="table-label" style={th('center')}>Age</th>
            <th className="table-label" style={th('center')}>Seasons</th>
            <th className="table-label" style={th('left')}>Team</th>
            {isRaceType ? (
              <>
                <th className="table-label" style={th('center')}>Time / Retired</th>
                <th className="table-label" style={th('center')}>Laps</th>
                <th className="table-label" style={th('right')}>Pts.</th>
              </>
            ) : (
              <>
                <th className="table-label" style={th('center')}>Best Lap</th>
                <th className="table-label" style={th('center')}>Top Speed</th>
                <th className="table-label" style={th('center')}>Laps</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const isDNF = !r.time_result && isRaceType && r.position == null
            const img = resolveImg(r.rider_image)
            const age = calcAge(r.birth_date, eventDate, r.death_date)
            return (
              <tr key={r.rider_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}>
                  <span className={`event-rank ${isDNF ? styles.dnf : ''}`}>{r.position ?? '—'}</span>
                </td>
                <td>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={r.rider_name} sport="moto-racing" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 700 }}>{r.rider_name}</span>
                      <div className="entity-meta-row">
                        <Flag iso2={r.rider_country_iso2} name={r.rider_country_name} className="flag" />
                        <span className="cell-meta">{r.rider_country_name || '—'}</span>
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
                  {r.team_name ? (
                    <div className={styles.team}>
                      <div className={styles.logoSlot}>
                        {resolveImg(r.team_logo) && (
                          <img src={resolveImg(r.team_logo)} alt={r.team_name} className={styles.logo} onError={e => { e.target.style.display = 'none' }} />
                        )}
                      </div>
                      <div className="entity-stack">
                        <span className="club-name" style={{ fontWeight: 'normal' }}>{r.team_name}</span>
                        {r.constructor_name && <span className="cell-meta">{r.constructor_name}</span>}
                      </div>
                    </div>
                  ) : r.constructor_name ? (
                    <div className={styles.team}>
                      <div className={styles.logoSlot} />
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{r.constructor_name}</span>
                    </div>
                  ) : '—'}
                </td>
                {isRaceType ? (
                  <>
                    <td className={`stats-light ${isDNF ? styles.dnfTime : ''}`} style={{ textAlign: 'center' }}>{r.time_result || r.gap_to_first || '—'}</td>
                    <td className="stats-light" style={{ textAlign: 'center' }}>{r.laps ?? '—'}</td>
                    <td className="stats-strong" style={{ textAlign: 'right' }}>{r.points ?? '—'}</td>
                  </>
                ) : (
                  <>
                    <td className="stats-light" style={{ textAlign: 'center' }}>{r.best_lap_time || '—'}</td>
                    <td className="stats-light" style={{ textAlign: 'center' }}>{r.top_speed ? `${r.top_speed} km/h` : '—'}</td>
                    <td className="stats-light" style={{ textAlign: 'center' }}>{r.laps ?? '—'}</td>
                  </>
                )}
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
