// src/utils/portraits.js
// Default silhouette fallback for winner/champion/player portraits —
// shown when the real photo is missing or fails to load.
//
// One shared default per gender (/media/default/portrait-{male|female}.png)
// across every sport, not a per-sport subfolder — this used to be
// /media/default/{sport}/portrait-{male|female}.png, requiring a real
// uploaded image per sport before that sport's fallback worked at all.
// `sport` is kept in the signature so call sites don't need to change if
// a sport-specific override is ever needed again, but is otherwise unused.
export function getDefaultSilhouette(sport, activeGender) {
  const folder = activeGender === 'F' ? 'female' : 'male'
  return `/media/default/portrait-${folder}.png`
}
