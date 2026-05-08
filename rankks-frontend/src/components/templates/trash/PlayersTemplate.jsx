import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import styles from './PlayersTemplate.module.css'

export default function PlayersTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [pos, setPos]         = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getPlayers(seasonId).then(setData).catch(console.error).finally(() => setLoading(false))
  }, [seasonId])

  const players = (data?.players || []).filter(p => !pos || p.position === pos)

  return (
    <div className={styles.wrap}>

      {/* filter-bar — global */}
      <div className="filter-bar">
        <select className="filter-label" value={pos} onChange={e => setPos(e.target.value)}>
          <option value="">All Positions</option>
          <option value="Goalkeeper">Goalkeeper</option>
          <option value="Defender">Defender</option>
          <option value="Midfielder">Midfielder</option>
          <option value="Striker">Striker</option>
        </select>
        {pos && (
          <button className="filter-reset" onClick={() => setPos('')}>Reset</button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>
          {[...Array(8)].map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 36, marginBottom: 4, borderRadius: 4 }} />
          ))}
        </div>
      ) : (
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              {/* table-th — global */}
              <th className="table-th">#</th>
              <th className={`${styles.left} table-th`}>Player</th>
              <th className="table-th">Position</th>
              <th className="table-th">Country</th>
              <th className="table-th">Club</th>
              <th className="table-th">Goals</th>
              <th className="table-th">Assists</th>
              <th className="table-th">Games</th>
            </tr>
          </thead>
          <tbody>
            {players.length ? players.map((p, i) => (
              <tr key={p.id} className="table-row">
                <td className={styles.n}>
                  {/* event-rank — global */}
                  <span className="event-rank">{i + 1}</span>
                </td>
                <td>
                  <div className={styles.pi}>
                    {p.image_url
                      ? <img src={p.image_url} alt={p.display_name} className={styles.av} />
                      : <div className={`${styles.avPh} avatar-placeholder`} />
                    }
                    {/* athlete-name — global */}
                    <span className="athlete-name">{p.display_name || p.canonical_name}</span>
                  </div>
                </td>
                {/* cell-data — global */}
                <td className={`${styles.c} cell-data`}>{p.position || '—'}</td>
                <td className={`${styles.c} cell-data`}>{p.country_iso2 || '—'}</td>
                <td className={`${styles.c} cell-data`}>{p.club_name || '—'}</td>
                <td className={`${styles.c} cell-data`}>{p.goals ?? '—'}</td>
                <td className={`${styles.c} cell-data`}>{p.assists ?? '—'}</td>
                <td className={`${styles.c} cell-data`}>{p.games_played ?? '—'}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: 32, color: 'var(--text3)' }}>
                  No player data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  )
}
