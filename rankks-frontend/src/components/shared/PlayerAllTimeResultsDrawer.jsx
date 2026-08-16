import { createPortal } from 'react-dom'
import useVideoPlayerStore from '../../store/useVideoPlayerStore'
import styles from './PlayerAllTimeResultsDrawer.module.css'

// "All-Time Results" per-athlete drawer — same shared slide-in shell as
// TournamentHistoryDrawer/F1GPHistoryDrawer/MotoGPGPHistoryDrawer, just
// keyed by athlete (entityId) instead of competition/GP. Body content is
// intentionally not built yet (Mohamed 2026-08-16: "leave content blank
// as of now") — this wires up the entry point (column + header) ahead of
// the data/route work for each sport's Totals > Player/Driver/Rider Stats
// pages.
// label — the trigger button's own text varies by page ("All-Time
// Results" on Totals/Driver/Rider Stats, "Full Results" on Rankings) even
// though every caller opens the exact same drawer shape underneath.
// hideTrigger — some pages (Rankings, Player List) make the player's own
// name the clickable trigger instead (opening this same `player-history:`
// key directly via useVideoPlayerStore), in which case this component is
// still mounted per-row just to render the drawer/portal itself, with its
// own built-in text-link trigger suppressed to avoid a duplicate.
export default function PlayerAllTimeResultsDrawer({ entityId, name, label = 'All-Time Results', hideTrigger = false }) {
  const key = `player-history:${entityId}`
  const open = useVideoPlayerStore(s => s.openKey === key)
  const openDrawer = useVideoPlayerStore(s => s.openVideo)
  const closeDrawer = useVideoPlayerStore(s => s.closeVideo)

  if (!entityId) return null

  return (
    <>
      {!hideTrigger && <button className={styles.link} onClick={() => openDrawer(key)}>{label}</button>}

      {open && createPortal(
        <>
          <div className={styles.backdrop} onClick={closeDrawer} />
          <div className={styles.drawer}>
            <button className={styles.closeBtn} onClick={closeDrawer} aria-label="Close">✕</button>
            <div className={styles.header}>
              <div className={styles.headerTitleRow}>
                <div className={styles.headerTitle}>{name}</div>
              </div>
              <div className={styles.headerSubtitleRow}>
                <div className={styles.headerSubtitle}>All-Time Results</div>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <div className={styles.state}>Coming soon.</div>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
