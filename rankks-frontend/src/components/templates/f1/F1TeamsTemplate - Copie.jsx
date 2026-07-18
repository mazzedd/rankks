// templates/f1/F1TeamsTemplate.jsx
// Columns per RANKKS F1 Master Spec §3: Position | Team | Country |
// Wins | 2nd | 3rd | Wins (Sprint) | Points
//
// Matrix matched to the tennis Player-list table's alignment rule:
//   - Team cell: logo + bold name, left.
//   - Country: left (flag + text, unchanged).
//   - Wins / 2nd / 3rd / Wins (Sprint): centered (matches tennis's
//     centered stat columns, e.g. GS / M1000 / ATP 500 / ATP 250).
//   - Points: right (matches tennis's rightmost column).
//   - Every header label is explicitly bold.
//
// CSS — now imports the shared templates/f1/f1.module.css (was its own
// module CSS, byte-identical to the other 5 F1 templates).
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import styles from './f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

export default function F1TeamsTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1Standings(seasonId, 'teams')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.standings?.length) return <Empty />

  const rows = data.standings.filter(r =>
    !search || r.canonical_name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.wrap}>
      <div className="page-title">Teams</div>

      <div className="filter-bar">
        <input className="search-input" placeholder="Search team" value={search} onChange={e => setSearch(e.target.value)} />
        <span className="filter-total">{rows.length} teams</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos}></th>
            <th className="table-label" style={th('left')}>Team</th>
            <th className="table-label" style={th('left')}>Country</th>
            <th className="table-label" style={th('center')}>Wins</th>
            <th className="table-label" style={th('center')}>2nd</th>
            <th className="table-label" style={th('center')}>3rd</th>
            <th className="table-label" style={th('center')}>Wins (Sprint)</th>
            <th className="table-label" style={th('right')}>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const logo = resolveImg(row.logo_url)
            return (
              <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}><span className="event-rank">{row.position}</span></td>
                <td>
                  <div className={styles.team}>
                    {logo
                      ? <img src={logo} alt={row.canonical_name} className={styles.logo} onError={e => { e.target.style.display = 'none' }} />
                      : null
                    }
                    <span className="club-name">{row.canonical_name}</span>
                  </div>
                </td>
                <td className="stats-light" style={td('left')}>
                  <div className="entity-meta-row">
                    <Flag iso2={row.country_iso2} name={row.country_name} className="flag" />
                    <span>{row.country_name || '—'}</span>
                  </div>
                </td>
                <td className="stats-light" style={td('center')}>{row.stats?.wins ?? '—'}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No team data available.</div>
}
