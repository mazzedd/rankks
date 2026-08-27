import { useState, useEffect } from 'react'
import api, { publicApi } from '../api/client'
import styles from './CompetitionLogos.module.css'

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

// Admin oversight of every user's saved tennis comparison reports (Mohamed
// 2026-08-20: "in admin: display reports in a table: Sport, Date, Name,
// View and Generate PDF"). View/Generate PDF re-run the same public
// GET /api/reports/compare the report itself uses (query-param driven, not
// tied to a saved row per rankks-api/src/routes/reports.js's own design) —
// no separate admin-only stats logic to keep in sync.
export default function MyReports() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    api.get('/reports')
      .then(r => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const toggleView = async (row) => {
    if (openId === row.id) { setOpenId(null); setDetail(null); return }
    setOpenId(row.id)
    setDetail(null)
    setDetailLoading(true)
    try {
      const params = { gender: row.gender, players: row.player_entity_ids.join(',') }
      if (row.category_filter?.length) params.category = row.category_filter.join(',')
      if (row.surface_filter?.length) params.surface = row.surface_filter.join(',')
      const r = await publicApi.get('/reports/compare', { params })
      setDetail(r.data)
    } catch (err) {
      setDetail({ error: err.response?.data?.error || err.message })
    } finally {
      setDetailLoading(false)
    }
  }

  const generatePdf = async (row) => {
    if (openId !== row.id) await toggleView(row)
    setTimeout(() => window.print(), 300)
  }

  return (
    <div className={styles.page}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #reportPrintArea, #reportPrintArea * { visibility: visible; }
          #reportPrintArea { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>My Reports</h1>
        <p className={styles.subtitle}>Every user's saved tennis player comparison reports.</p>
      </div>

      <div className={styles.table}>
        <div className={styles.tableHeader} style={{ gridTemplateColumns: '1fr 1fr 2fr 1fr 1fr' }}>
          <span>Sport</span>
          <span>Date</span>
          <span>Name</span>
          <span>View</span>
          <span>Generate PDF</span>
        </div>

        {loading ? (
          <div className={styles.tableEmpty}>Loading...</div>
        ) : rows.length === 0 ? (
          <div className={styles.tableEmpty}>No saved reports yet</div>
        ) : (
          rows.map(row => (
            <div key={row.id}>
              <div className={styles.tableRow} style={{ gridTemplateColumns: '1fr 1fr 2fr 1fr 1fr' }}>
                <span className={styles.colPath}>{row.sport_slug === 'tennis' ? 'Tennis' : row.sport_slug}</span>
                <span>{fmtDate(row.created_at)}</span>
                <span>{row.name}</span>
                <button type="button" className={styles.fieldInput} onClick={() => toggleView(row)}>
                  {openId === row.id ? 'Hide' : 'View'}
                </button>
                <button type="button" className={styles.fieldInput} onClick={() => generatePdf(row)}>PDF</button>
              </div>
              {openId === row.id && (
                <div className={styles.tableRow} style={{ gridTemplateColumns: '1fr' }} id="reportPrintArea">
                  {detailLoading && <span>Loading report…</span>}
                  {detail?.error && <span>{detail.error}</span>}
                  {detail?.players && (
                    <div>
                      <strong>{row.player_names.join(' vs ')}</strong>
                      {' — '}
                      {row.gender === 'F' ? 'WTA' : 'ATP'}
                      {' · Category: '}{row.category_filter?.length ? row.category_filter.join(', ') : 'All'}
                      {' · Surface: '}{row.surface_filter?.length ? row.surface_filter.join(', ') : 'All'}
                      <table style={{ width: '100%', marginTop: 10 }}>
                        <thead>
                          <tr>
                            <th></th>
                            {detail.players.map(p => <th key={p.entity_id}>{p.name}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          <tr><td>Seasons</td>{detail.players.map(p => <td key={p.entity_id}>{p.seasons}</td>)}</tr>
                          <tr><td>Titles</td>{detail.players.map(p => <td key={p.entity_id}>{p.titles}</td>)}</tr>
                          <tr><td>Finals won (%)</td>{detail.players.map(p => <td key={p.entity_id}>{p.finals_won_pct ?? '—'}</td>)}</tr>
                          <tr><td>Best Ranking</td>{detail.players.map(p => <td key={p.entity_id}>{p.best_ranking ?? '—'}</td>)}</tr>
                          <tr><td>Times ranked No.1</td>{detail.players.map(p => <td key={p.entity_id}>{p.times_no1 ?? '—'}</td>)}</tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
