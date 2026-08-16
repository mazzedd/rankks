import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'
import useVideoPlayerStore from '../../store/useVideoPlayerStore'
import Flag from './Flag'
import DeceasedMark from './DeceasedMark'
import styles from './F1GPHistoryDrawer.module.css'

// "All-Time Results" for one Grand Prix — MotoGP counterpart of
// F1GPHistoryDrawer.jsx (same P1/P2/P3 podium model, reuses its CSS
// module directly), plus the category param every MotoGP route needs.
function PodiumSpot({ rank, spot }) {
  if (!spot) return (
    <div className={styles.podiumRow}>
      <span className={styles.rank}>{rank}.</span>
      <span className="cell-meta">—</span>
    </div>
  )
  return (
    <div className={styles.podiumRow}>
      <span className={styles.rank}>{rank}.</span>
      <Flag iso2={spot.iso2} name={spot.name} className={styles.flag} />
      <span className={`${styles.name}${rank === 1 ? ` ${styles.nameP1}` : ''}`}>
        {spot.name}
        {spot.ordinal != null && ` (${spot.ordinal})`}
      </span>
      {spot.death_date && <DeceasedMark />}
      <span className={styles.team}>{spot.team || '—'}</span>
    </div>
  )
}

// hideTrigger — same as F1GPHistoryDrawer's identical prop; see its
// comment for the rationale.
export default function MotoGPGPHistoryDrawer({ slug, year, category, categoryLabel = 'MotoGP', gpName, hideTrigger = false }) {
  const key = `motogp-gp-history:${slug}:${year}:${category}`
  const open = useVideoPlayerStore(s => s.openKey === key)
  const openDrawer = useVideoPlayerStore(s => s.openVideo)
  const closeDrawer = useVideoPlayerStore(s => s.closeVideo)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !slug) return
    setLoading(true)
    api.getMotoGPGPHistory(slug, year, category)
      .then(d => setRows(d?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [open, slug, year, category])

  if (!slug) return null

  return (
    <>
      {!hideTrigger && <button className={styles.link} onClick={() => openDrawer(key)}>All-Time Results</button>}

      {open && createPortal(
        <>
          <div className={styles.backdrop} onClick={closeDrawer} />
          <div className={styles.drawer}>
            <button className={styles.closeBtn} onClick={closeDrawer} aria-label="Close">✕</button>
            <div className={styles.header}>
              <div className={styles.headerTitleRow}>
                <div className={styles.headerTitle}>{categoryLabel} I {gpName}</div>
              </div>
              <div className={styles.headerSubtitleRow}>
                <div className={styles.headerSubtitle}>All-Time Results</div>
              </div>
            </div>

            <div className={styles.tableWrap}>
              {loading ? (
                <div className={styles.state}>Loading...</div>
              ) : !rows.length ? (
                <div className={styles.state}>No results available.</div>
              ) : (
                rows.map(r => (
                  <div key={r.year} className={styles.editionRow}>
                    <div className={styles.yearCol}>
                      <div className={styles.year}>{r.year}</div>
                      {r.edition != null && <div className={styles.edition}>Edition {r.edition}</div>}
                    </div>
                    <div className={styles.podiumCol}>
                      <PodiumSpot rank={1} spot={r.p1} />
                      <PodiumSpot rank={2} spot={r.p2} />
                      <PodiumSpot rank={3} spot={r.p3} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
