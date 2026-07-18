// templates/f1/F1DriversTemplate.jsx
// Columns per RANKKS F1 Master Spec §3: Pos | Driver | Age | Team | No |
// Wins | 2nd | 3rd | Wins (Sprint) | Points
//
// Matrix matched exactly to the tennis Player-list table:
//   - Driver cell: avatar image, then a stacked name (bold) with a
//     flag + country line underneath — not side-by-side.
//   - Age: centered, age number bold with birthdate underneath.
//   - No / Wins / 2nd / 3rd / Wins (Sprint): centered.
//   - Team: left (no tennis equivalent — this is F1-specific).
//   - Points: right (matches tennis's rightmost column).
//   - Every header label is explicitly bold.
//
// AGE — now uses the shared calcAge(birthDate, refDate) util (unified
// rule across football/tennis/F1: age is computed as of the event date,
// not today's date). Since this table is season-level, refDate is
// data.season_end_date — the last race of the season, returned by the
// backend as MAX(event_date) across this season's GPs (F1 has no single
// season.end_date column, so this is computed rather than stored).
//
// CSS — now imports the shared templates/f1/f1.module.css (was its own
// module CSS, byte-identical to the other 5 F1 templates). The
// avatar+name+flag/country cell and the age value+birthdate stack now
// use the global .entity-cell/.entity-stack/.entity-meta-row/.cell-meta
// and .stat-stack/.stat-stack-value/.cell-meta classes from index.css,
// replacing inline style={{...}} that repeated identical color/size
// values across every F1 template.
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

export default function F1DriversTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1Standings(seasonId, 'drivers')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.standings?.length) return <Empty />

  const teams = [...new Set(data.standings.map(r => r.stats?.team_name).filter(Boolean))]

  const rows = data.standings.filter(r => {
    if (search && !r.canonical_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && r.stats?.team_name !== teamFilter) return false
    return true
  })

  return (
    <div className={styles.wrap}>
      <div className="page-title">Drivers</div>

      <div className="filter-bar">
        <input className="search-input" placeholder="Search driver" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="filter-total">{rows.length} drivers</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos}></th>
            <th className="table-label" style={th('left')}>Driver</th>
            <th className="table-label" style={th('center')}>Age</th>
            <th className="table-label" style={th('left')}>Team</th>
            <th className="table-label" style={th('center')}>No</th>
            <th className="table-label" style={th('center')}>Wins</th>
            <th className="table-label" style={th('center')}>2nd</th>
            <th className="table-label" style={th('center')}>3rd</th>
            <th className="table-label" style={th('center')}>Wins (Sprint)</th>
            <th className="table-label" style={th('right')}>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const img = resolveImg(row.logo_url)
            const age = calcAge(row.birth_date, data.season_end_date, row.death_date)
            const birth = fmtBirth(row.birth_date)
            return (
              <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}><span className="event-rank">{row.position}</span></td>
                <td>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={row.canonical_name} sport="f1" gender="M" className="avatar" />
                    <div className="entity-stack">
                      <span className="club-name">{row.canonical_name}</span>
                      <div className="entity-meta-row">
                        <Flag iso2={row.country_iso2} name={row.country_name} className="flag" />
                        <span className="cell-meta">{row.country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={td('center')}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value">{age}</span>
                      <span className="cell-meta">{birth}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={td('left')}>{row.stats?.team_name || '—'}</td>
                <td className="stats-light" style={td('center')}>{row.stats?.number ?? '—'}</td>
                <td className="stats-light" style={td('center')}>{row.stats?.wins ?? 0}</td>
                <td className="stats-light" style={td('center')}>{row.stats?.p2 ?? '—'}</td>
                <td className="stats-light" style={td('center')}>{row.stats?.p3 ?? '—'}</td>
                <td className="stats-light" style={td('center')}>{row.stats?.sprint_wins ?? '—'}</td>
                <td className="stats-strong" style={td('right')}>{row.stats?.points ?? 0}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No driver data available.</div>
}
