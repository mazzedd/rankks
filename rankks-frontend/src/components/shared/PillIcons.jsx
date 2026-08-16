// Small white icons shown inside the pink competition pill (EventBlock's
// .eventCompetition) on Home/Totals/Video banners — lets the pill mirror
// which of LineA's three pinned buttons (Home/Totals/Watch center) the
// page is currently on (Mohamed 2026-08-16). Deliberately NOT shown on
// every other EventBlock variant (Rankings, per-season Championship/GP
// pages) — those don't correspond to one of LineA's three pinned icons.
// Same house/bars glyphs as LineA.jsx's own HomeIcon/.barsIcon (kept in
// sync visually with the nav buttons they mirror), pulled out here since
// this file is shared by EventBlock.jsx, F1EventBlock.jsx and
// MotoGPEventBlock.jsx rather than duplicated three times.
import styles from '../EventBlock/EventBlock.module.css'

export function PillHomeIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.eventCompetitionIcon}>
      <path d="M8 1.5 L1 7.5 V14.5 H6 V10 H10 V14.5 H15 V7.5 Z" />
    </svg>
  )
}

export function PillBarsIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.eventCompetitionIcon}>
      <rect x="1" y="9" width="3" height="6" />
      <rect x="6.5" y="5" width="3" height="10" />
      <rect x="12" y="1" width="3" height="14" />
    </svg>
  )
}

export function PillPlayIcon() {
  return (
    <svg viewBox="0 0 16 16" className={styles.eventCompetitionIcon}>
      <path d="M3 1.5 L14 8 L3 14.5 Z" />
    </svg>
  )
}
