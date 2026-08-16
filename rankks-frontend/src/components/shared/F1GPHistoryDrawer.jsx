import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'
import useVideoPlayerStore from '../../store/useVideoPlayerStore'
import Flag from './Flag'
import DeceasedMark from './DeceasedMark'
import styles from './F1GPHistoryDrawer.module.css'

// "All-Time Results" for one Grand Prix — every Race podium (P1/P2/P3)
// since its 1st edition, most recent on top, capped through the currently
// selected year. Own dedicated CSS/layout, not a reuse of tennis's
// TournamentHistoryDrawer — a Grand Prix result is a 3-way podium, not a
// 2-player final, so the winner/runner-up "d." shape didn't fit (2026-
// 08-10 correction). No cancelled-edition concept for F1 (a GP that
// didn't run in a given year simply has no row).
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

// hideTrigger — Race Stats makes the GP's own name the clickable trigger
// instead (opening this same `f1-gp-history:` key directly via
// useVideoPlayerStore), in which case this component is still mounted
// per-row just to render the drawer/portal itself, with its own built-in
// text-link trigger suppressed to avoid a duplicate.
export default function F1GPHistoryDrawer({ slug, year, gpName, hideTrigger = false }) {
  const key = `f1-gp-history:${slug}:${year}`
  const open = useVideoPlayerStore(s => s.openKey === key)
  const openDrawer = useVideoPlayerStore(s => s.openVideo)
  const closeDrawer = useVideoPlayerStore(s => s.closeVideo)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !slug) return
    setLoading(true)
    api.getF1GPHistory(slug, year)
      .then(d => setRows(d?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [open, slug, year])

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
                <div className={styles.headerTitle}>F1 I {gpName}</div>
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
