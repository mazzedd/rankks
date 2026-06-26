import { useEffect, useState } from 'react'
import useAppStore from '../../store/useAppStore'
import PageNotice from '../PageNotice/PageNotice'
import { api } from '../../services/api'
import styles from './StandingsTemplate.module.css'

export default function StandingsTemplate({ seasonId, tabKey, columnConfig, competitionName = '', yearConvention = 'end' }) {
  const { activeYear } = useAppStore()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!seasonId || !tabKey) return
    setLoading(true)
    api.getStandings(seasonId, tabKey)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId, tabKey])

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 42, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  if (!data?.standings?.length) return (
    <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>
      No standings data available.
    </div>
  )

  const cols = columnConfig || [
    { key: 'played',        label: 'Played' },
    { key: 'won',           label: 'Won' },
    { key: 'drawn',         label: 'Drawn' },
    { key: 'lost',          label: 'Lost' },
    { key: 'goals_for',     label: 'GF' },
    { key: 'goals_against', label: 'GA' },
    { key: 'goal_diff',     label: 'GD' },
    { key: 'points',        label: 'Points', bold: true },
  ]

  return (
    <div className={styles.wrap}>

      {/* Page title — global class */}
      <div className="page-title">League standings</div>
      <PageNotice />

      <table className={`${styles.table} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos}></th>
            {/* table-label-left for the Club column */}
            <th className="table-label-left">Club</th>
            {cols.map(c => (
              <th key={c.key} className="table-label">{c.label}</th>
            ))}
            <th />
          </tr>
        </thead>

        <tbody>
          {data.standings.map((row, i) => (
            <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>

              {/* Rank — global class */}
              <td className={styles.pos}>
                <span className={`event-rank ${styles.pn}`}>
                  {row.position}
                </span>
              </td>

              {/* Club logo + name */}
              <td>
                <div className={styles.club}>
                  {row.logo_url
                    ? <img
                        src={
  row.logo_url.startsWith('/media/')
    ? row.logo_url
    : row.logo_url.startsWith('/')
      ? row.logo_url
      : `/media/${row.logo_url}`
}
                        alt={row.display_name}
                        className={styles.clogo}
                      />
                    : <div className={`${styles.cph} logo-placeholder`} />
                  }
                  {/* club-name — global class */}
                  <span className="club-name">{row.display_name || row.canonical_name}</span>
                </div>
              </td>

              {/* Stats columns */}
              {cols.map(c => {
                const v = c.key === 'goal_diff'
                  ? ((row.stats?.goals_for || 0) - (row.stats?.goals_against || 0))
                  : (row.stats?.[c.key] ?? '—')
                return (
                  <td key={c.key} className={c.bold ? 'stats-strong' : 'stats-light'}>
                    {typeof v === 'number' && v > 0 && c.key === 'goal_diff' ? `+${v}` : v}
                  </td>
                )
              })}

              <td className={styles.more}>
                <button className={`${styles.mBtn} btn-more`} title="Coming soon">∨</button>
              </td>

            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
