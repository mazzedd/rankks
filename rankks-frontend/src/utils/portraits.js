// src/utils/portraits.js
// Default silhouette fallback for winner/champion/player portraits —
// shown when the real photo is missing or fails to load.
//
// Convention over configuration: every sport gets its own image at
// /media/default/{sport}/portrait.png (or portrait-{male|female}.png
// for gendered sports) with NO per-sport branching required in code.
// Adding NBA, or any future sport, means dropping in the right image
// file — never touching this function. This replaces an earlier
// version with an if/else chain per sport, which silently fell through
// to tennis's silhouette for any unlisted sport (would have shown a
// wrong-sport image for NBA with no error) and required a code change
// per sport, contradicting the platform's own "zero code change to add
// a sport" principle (Spec §10).
//
// GENDERED_SPORTS: sports whose competitions can be run as separate
// men's/women's editions needing visually distinct silhouettes.
// Football and tennis already split this way; F1 added ahead of
// women's car racing ingestion. Add to this array (not a new if-branch)
// when a future sport needs the same split — everything else
// automatically gets a single ungendered image.
// basketball added despite being single-gender in scope (NBA only, no WNBA
// yet) — the actual uploaded default assets are portrait-male.png/
// portrait-female.png, not the single ungendered portrait.png the original
// onboarding plan assumed. Files on disk are ground truth; adapting the code
// to match rather than the other way round.
const GENDERED_SPORTS = ['football', 'tennis', 'f1', 'basketball']

export function getDefaultSilhouette(sport, activeGender) {
  if (GENDERED_SPORTS.includes(sport)) {
    const folder = activeGender === 'F' ? 'female' : 'male'
    return `/media/default/${sport}/portrait-${folder}.png`
  }
  return `/media/default/${sport}/portrait.png`
}
