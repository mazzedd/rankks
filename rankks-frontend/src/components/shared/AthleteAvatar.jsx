// src/components/shared/AthleteAvatar.jsx
// Single shared avatar component — photo with a two-tier fallback to
// the sport/gender silhouette from utils/portraits.js:
//   1. No src at all (never had a photo)          → silhouette
//   2. src present but the file 404s/fails to load → silhouette
// Previously each table handled only case 1, usually with a plain
// CSS initial-circle (.avatar-placeholder) instead of the illustrated
// silhouette, and case 2 just hid the broken <img> outright
// (onError={e => e.target.style.display = 'none'}), leaving a blank
// gap — the same class of bug already fixed once in EventBlock.jsx/
// F1EventBlock.jsx, now fixed at the component level so it can't
// silently reappear per-table again. Same split-logic/presentation
// pattern as Flag.jsx and MatchVideo.jsx.
import { useState } from 'react'
import { getDefaultSilhouette } from '../../utils/portraits'

export default function AthleteAvatar({ src, name, sport, gender, className = 'avatar' }) {
  const [failed, setFailed] = useState(false)
  const showReal = !!src && !failed

  if (showReal) {
    return (
      <img
        src={src}
        alt={name || ''}
        className={className}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <img
      src={getDefaultSilhouette(sport, gender)}
      alt={name || ''}
      className={className}
    />
  )
}
