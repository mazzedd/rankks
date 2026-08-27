// src/components/shared/AthleteAvatar.jsx
// Single shared avatar component — photo with a fallback for when
// there's no real photo (never had one, or the file 404s/fails to
// load). Two fallback styles, picked via the `fallback` prop:
//   - 'silhouette' (default) — the illustrated sport/gender silhouette
//     from utils/portraits.js. Used in the big banner contexts
//     (EventBlock.jsx/F1EventBlock.jsx portraits), where a blank/empty
//     look would be jarring at that size.
//   - 'letter' — a plain circle with the athlete's first initial (the
//     shared .avatar-placeholder class also used by players_template.jsx's
//     own hand-rolled version of this same fallback), for compact table
//     rows — same convention basketball's player list already used,
//     now shared here instead of re-implemented per F1 table (was
//     previously always 'silhouette' for F1's driver tables, which read
//     as a wrong-sport-looking mismatch next to NBA's rows).
// Previously every table handled only "no src at all" case, usually
// with a plain CSS initial-circle instead of the illustrated
// silhouette, and the "src present but fails" case just hid the broken
// <img> outright (onError={e => e.target.style.display = 'none'}),
// leaving a blank gap — the same class of bug already fixed once in
// EventBlock.jsx/F1EventBlock.jsx, now fixed at the component level so
// it can't silently reappear per-table again. Same split-logic/
// presentation pattern as Flag.jsx and MatchVideo.jsx.
//
// PROFILE vs PORTRAIT — entities.image_url is a single column but covers
// two different asset types by folder convention: .../profile/... (a
// compact headshot, meant for table-row thumbnails) and .../portrait/...
// (a larger banner-style shot, meant for the big EventBlock/GP-block
// display). A 'letter' table row only ever wants the former — showing a
// portrait-typed image there is a wrong-context mismatch (confirmed via
// a real case: an entity had only a .../motor-racing/.../portrait/...
// file, no .../profile/... one at all, and it was leaking into the
// Riders standings table). 'silhouette' contexts (the big banners) have
// no such restriction — either type is fine there.
import { useState } from 'react'
import { getDefaultSilhouette } from '../../utils/portraits'

export default function AthleteAvatar({ src, name, sport, gender, className = 'avatar', fallback = 'silhouette' }) {
  const [failed, setFailed] = useState(false)
  // Club crests (/media/logos/clubs/...) are a legitimate 'letter'-mode
  // image too, same as an athlete's /profile/ headshot — neither convention
  // matched the other, so every football/NBA club logo fed to a 'letter'
  // avatar (HomepageTemplate's MatchupCard side panel) silently fell back
  // to the plain letter circle even when a real crest existed (Mohamed
  // 2026-08-26: "Populate logo club on right bloc").
  const usableSrc = fallback === 'letter' ? (src && (src.includes('/profile/') || src.includes('/logos/')) ? src : null) : src
  const showReal = !!usableSrc && !failed

  if (showReal) {
    return (
      <img
        src={usableSrc}
        alt={name || ''}
        className={className}
        onError={() => setFailed(true)}
      />
    )
  }
  if (fallback === 'letter') {
    // className merged in (not just the base 'avatar-placeholder') so a
    // caller's own size/shape (e.g. HomepageTemplate's 56px .matchupAvatar)
    // is honored here too — previously hardcoded to the base class's fixed
    // 40x40, so the fallback rendered smaller than the real photo it's
    // standing in for whenever a caller asked for a bigger avatar (Mohamed
    // 2026-08-24: "profile image is larger than default image").
    return (
      <div className={`avatar-placeholder ${className}`}>
        {(name || '')[0]?.toUpperCase() ?? '?'}
      </div>
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
