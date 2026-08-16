// utils/tournamentLabel.js
// Short "country or city only" label for tennis Line A tabs (Mohamed
// 2026-08-16: "Canadian Open to Canada, Cincinnati Open to Cincinnati...
// Only country or city name in Line A"). Same idea as gpLabel.js's
// shortGpLabel for MotoGP/F1 — strips generic tour/format qualifier words
// rather than assuming one fixed suffix, and reuses gpLabel's own
// demonym-adjective-to-place map (the "Canadian"->"Canada" problem is
// identical to MotoGP's "Argentinian Grand Prix"->"Argentina" one). Full
// stored name is untouched — this only changes what Line A displays.
//
// Built by checking every distinct competitions.name value for sport_id=2
// (tennis, ~500 rows spanning the modern tour back through the 1970s WCT/
// NTL circuits), not guessed from a couple of examples — see the
// QUALIFIER_WORDS/NAME_OVERRIDES comments below for what that pass found.
import { DEMONYM_TO_PLACE } from './gpLabel'

// Generic tour/format qualifier words that carry no place information —
// safe to strip from the end of a name regardless of era. "Cup" is
// deliberately NOT included: every "* Cup" name in the real data (Grand
// Slam Cup, Nations Cup, United Cup, Laver Cup, WCT World Cup...) is an
// event name with no place noun in front of it, so stripping "Cup" would
// produce nonsense ("Grand Slam", "Nations") rather than a place.
// "Olympics" is deliberately NOT included either — Olympic tennis is a
// distinct, notable event worth keeping visible, not folding into the
// same bare city label as that city's regular tour stop.
const QUALIFIER_WORDS = new Set([
  'open', 'masters', 'indoor', 'indoors', 'outdoor', 'outdoors',
  'wct', 'ntl', 'championships', 'chps', 'international', 'trophy',
  'round', 'robin',
])

// Exact-match irregulars the generic pass can't reach correctly — either
// because the qualifier word isn't trailing ("ATP Rio de Janeiro"), the
// place noun isn't the expected token ("Japan Open Tokyo"/"Tokyo Japan
// Open" both really mean Tokyo, not "Japan"), a sponsor name sits between
// the place and "Open" ("Shanghai Heineken Open"), or trailing "WCT" is
// actually part of the event's own name rather than a stripped-off tour
// qualifier ("Tournament of Champions WCT" isn't a place either way, so
// it's pinned here rather than let the generic pass truncate it to
// "Tournament of Champions"). Keyed by the exact raw name.
const NAME_OVERRIDES = {
  'ATP Rio de Janeiro': 'Rio de Janeiro',
  'Japan Open Tokyo': 'Tokyo',
  'Tokyo Japan Open': 'Tokyo',
  'Shanghai Heineken Open': 'Shanghai',
  'Tournament of Champions WCT': 'Tournament of Champions WCT',
  // Grand Slams are branded, universally-recognized event names in their
  // own right — unlike a Masters/500/250 tour stop, shortening them to
  // just the demonym's place name loses recognizability rather than
  // reducing clutter (Mohamed 2026-08-16: "revert United States to US
  // Open"). Australian Open pinned the same way — same category, same
  // demonym-stripping problem ('australian' -> 'Australia').
  'US Open': 'US Open',
  'Australian Open': 'Australian Open',
}

export function shortTournamentLabel(name) {
  if (!name) return name

  const override = NAME_OVERRIDES[name.trim()]
  if (override) return override

  let words = name.trim().split(/\s+/)

  // A trailing numeric index ("Boston 2", "Sao Paulo NTL 1") marks a
  // genuinely different competition from the same city in the same era —
  // preserved rather than stripped, so two distinct Line A tabs don't end
  // up showing the identical label.
  let trailingIndex = ''
  const last = words[words.length - 1]
  if (words.length > 1 && /^-?\d+$/.test(last)) {
    trailingIndex = ' ' + last
    words = words.slice(0, -1)
  }

  while (words.length > 1 && QUALIFIER_WORDS.has(words[words.length - 1].toLowerCase())) {
    words = words.slice(0, -1)
  }

  const phraseKey = words.join(' ').toLowerCase()
  if (DEMONYM_TO_PLACE[phraseKey]) return DEMONYM_TO_PLACE[phraseKey] + trailingIndex

  return words.join(' ') + trailingIndex
}
