// src/utils/flags.js
// Single source of truth for resolving a flag image URL from an ISO2
// country code. Before this, the same `/media/flags/{iso2}.svg` string
// was rebuilt independently in EventBlock.jsx, LineA.jsx,
// clubs_template.jsx, and players_template.jsx — any future change to
// the path convention (CDN move, extension change, new fallback code)
// had to be made in four places by hand.
//
// The CDN fallback list previously only existed inside
// players_template.jsx (as getFlagPath) — UK home nations and French
// overseas territories don't have standard local SVGs, so those codes
// route to flagcdn.com instead. Centralizing here means every caller
// (clubs, players, EventBlock's tennis score rows, LineA's nav flag,
// and going forward World Cup's national_team entities) gets this
// fallback automatically, not just the one template that happened to
// have it written in.
const CDN_FALLBACK_CODES = ['gb-eng', 'gb-sct', 'gb-wls', 'gb-nir', 'gp', 'mq', 'gf'];

export function getFlagUrl(iso2) {
  if (!iso2) return null;
  const code = iso2.toLowerCase();
  if (CDN_FALLBACK_CODES.includes(code)) {
    return `https://flagcdn.com/w20/${code}.png`;
  }
  return `/media/flags/${code}.svg`;
}
