// Small icons marking which of LineA's three pinned buttons (Home/Totals/
// Watch center) the current EventBlock banner corresponds to (Mohamed
// 2026-08-16). Deliberately NOT shown on every other EventBlock variant
// (Rankings, per-season Championship/GP pages) — those don't correspond to
// one of LineA's three pinned icons. Same house/bars glyphs as LineA.jsx's
// own HomeIcon/.barsIcon (kept in sync visually with the nav buttons they
// mirror), pulled out here since this file is shared by EventBlock.jsx,
// F1EventBlock.jsx and MotoGPEventBlock.jsx rather than duplicated three
// times.
//
// `standalone` (Mohamed 2026-08-26: "Pink pill completely removed. Replace
// by either the TOTALS or VIDEO icon" / "in PURPLE", then extended to every
// remaining instance: "u must remove it everywhere" / "remove pill and text
// inside pills") — every banner pill (background + competition-name text)
// is dropped; passing this prop swaps in the bigger, purple, un-pilled
// marker instead of the old small white in-pill one, text and all.
import styles from '../EventBlock/EventBlock.module.css'

export function PillHomeIcon({ standalone }) {
  return (
    <svg viewBox="0 0 16 16" className={standalone ? styles.eventCompetitionIconStandalone : styles.eventCompetitionIcon}>
      <path d="M8 1.5 L1 7.5 V14.5 H6 V10 H10 V14.5 H15 V7.5 Z" />
    </svg>
  )
}

export function PillBarsIcon({ standalone }) {
  return (
    <svg viewBox="0 0 16 16" className={standalone ? styles.eventCompetitionIconStandalone : styles.eventCompetitionIcon}>
      <rect x="1" y="9" width="3" height="6" />
      <rect x="6.5" y="5" width="3" height="10" />
      <rect x="12" y="1" width="3" height="14" />
    </svg>
  )
}

export function PillPlayIcon({ standalone }) {
  return (
    <svg viewBox="0 0 16 16" className={standalone ? styles.eventCompetitionIconStandalone : styles.eventCompetitionIcon}>
      <path d="M3 1.5 L14 8 L3 14.5 Z" />
    </svg>
  )
}

