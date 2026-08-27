// My Account > My Reports (Mohamed 2026-08-20 comparison-report feature).
// List of saved reports + a builder for creating/reopening one — mounted
// from MyAccountPage.jsx same as the other accountSection blocks.
import { useState, useEffect, useCallback } from 'react'
import useUserStore from '../../../store/useUserStore'
import { api } from '../../../services/api'
import ReportBuilder from './ReportBuilder'
import styles from './Reports.module.css'

const CATEGORY_LABELS = {
  grand_slam: 'Grand Slam', masters_1000: '1000', masters_500: '500', masters_250: '250', challenger: 'Challenger',
}

function filterSummary(list, labels) {
  if (!list || !list.length) return 'All'
  return list.map(k => labels?.[k] || k).join(' + ')
}

export default function ReportsSection() {
  const token = useUserStore(s => s.token)
  const [reports, setReports] = useState(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('list') // 'list' | 'builder'
  const [openReport, setOpenReport] = useState(null)

  const load = useCallback(() => {
    if (!token) return
    setLoading(true)
    api.getMyReports(token)
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  const openNew = () => { setOpenReport(null); setView('builder') }
  const openExisting = (r) => {
    setOpenReport({
      name: r.name,
      gender: r.gender,
      category_filter: r.category_filter || [],
      surface_filter: r.surface_filter || [],
      players: r.player_entity_ids.map((id, i) => ({ id, canonical_name: r.player_names[i] })),
    })
    setView('builder')
  }
  const remove = async (id) => {
    await api.deleteReport(token, id)
    load()
  }
  const backToList = () => { setView('list'); setOpenReport(null); load() }

  if (view === 'builder') {
    return <ReportBuilder initial={openReport} onSaved={backToList} onCancel={backToList} />
  }

  return (
    <div className={styles.listWrap}>
      <div className={styles.listHeader}>
        <button type="button" className={styles.primaryBtn} onClick={openNew}>+ New Report</button>
      </div>

      {loading && <p className="empty-state">Loading…</p>}
      {!loading && reports && reports.length === 0 && (
        <p className="empty-state">No saved reports yet — compare 2 to 4 players and save the result here.</p>
      )}
      {!loading && reports && reports.length > 0 && (
        <div className={styles.reportsList}>
          {reports.map(r => (
            <div key={r.id} className={styles.reportListRow}>
              <div className={styles.reportListMain} onClick={() => openExisting(r)}>
                <span className={styles.reportListName}>{r.name}</span>
                <span className={styles.reportListMeta}>
                  {r.gender === 'F' ? 'WTA' : 'ATP'} · {r.player_names.join(' vs ')}
                </span>
                <span className={styles.reportListMeta}>
                  Category: {filterSummary(r.category_filter, CATEGORY_LABELS)} · Surface: {filterSummary(r.surface_filter)}
                </span>
              </div>
              <button type="button" className={styles.reportRemove} onClick={() => remove(r.id)} aria-label={`Delete ${r.name}`}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
