import { useState, useEffect, useMemo } from 'react'
import api from '../api/client'
import styles from './CompetitionLogos.module.css'

// Flat table of every league-level favouritable row — competitions (Ligue 1,
// Wimbledon, ...) plus the ATP/WTA tour entities (a tennis fan follows the
// whole tour, not one week's tournament — see followers.js's UNION query).
// "Followers" is real (real_count) + admin-set base_count (the "dvalue"),
// computed live by /api/admin/followers/leagues.
export default function FollowersLeagues() {
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [sportFilter, setSportFilter] = useState('')
  const [search, setSearch]     = useState('')
  const [savingId, setSavingId] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/followers/leagues')
      .then(r => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const sports = useMemo(() => [...new Set(rows.map(r => r.sport_name).filter(Boolean))].sort(), [rows])

  const filtered = rows
    .filter(r => !sportFilter || r.sport_name === sportFilter)
    .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))

  const saveBaseCount = async (row, value) => {
    const base = parseInt(value)
    if (!Number.isInteger(base) || base < 0 || base === row.base_count) return
    const key = `${row.entity_type}-${row.entity_id}`
    setSavingId(key)
    setRows(prev => prev.map(r => (r.entity_type === row.entity_type && r.entity_id === row.entity_id) ? { ...r, base_count: base } : r))
    try {
      await api.put('/followers/leagues', { entity_type: row.entity_type, entity_id: row.entity_id, base_count: base })
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.error || err.message))
      load()
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Followers — Leagues</h1>
        <p className={styles.subtitle}>Official followers = real favourites + the base value below. Set a base value to seed a league's follower count.</p>
      </div>

      <div className={styles.drilldown} style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 16 }}>
        <select className={styles.fieldInput} value={sportFilter} onChange={e => setSportFilter(e.target.value)}>
          <option value="">All sports</option>
          {sports.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          className={styles.fieldInput}
          placeholder="Search leagues..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.table}>
        <div className={styles.tableHeader} style={{ gridTemplateColumns: '2.5fr 1fr 1fr 1fr' }}>
          <span>League</span>
          <span>Sport</span>
          <span>Followers</span>
          <span>Base value</span>
        </div>

        {loading ? (
          <div className={styles.tableEmpty}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className={styles.tableEmpty}>No leagues match</div>
        ) : (
          filtered.map(row => {
            const key = `${row.entity_type}-${row.entity_id}`
            const total = parseInt(row.real_count) + row.base_count
            return (
              <div key={key} className={styles.tableRow} style={{ gridTemplateColumns: '2.5fr 1fr 1fr 1fr' }}>
                <span>{row.name}{row.entity_type === 'tour' && <span className={styles.colPath} style={{ marginLeft: 6 }}>(tour)</span>}</span>
                <span className={styles.colPath}>{row.sport_name}</span>
                <span className={styles.colCurrent}>{total.toLocaleString()}</span>
                <input
                  className={styles.fieldInput}
                  type="number"
                  min="0"
                  defaultValue={row.base_count}
                  disabled={savingId === key}
                  onBlur={e => saveBaseCount(row, e.target.value)}
                />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
