// utils/gpLabel.js
// Short, sentence-case GP label ("Thailand") from the raw stored name
// ("GRAND PRIX OF THAILAND") — the full stored name isn't lost, it's
// still used as-is wherever the fuller "subtitle" version is wanted (GP
// page breadcrumb, banner titles). Historical GP names span 5+ languages
// and ~10 different word orders ("GRAND PRIX OF X", "X GRAND PRIX",
// "GRAN PREMIO DE X", "MOTORRAD GRAND PRIX X"...) — this strips any
// "grand prix"-family phrase plus leading connector words (of/the/de/
// la/...) rather than assuming one fixed prefix, so it degrades
// gracefully instead of only handling the modern "GRAND PRIX OF ..."
// pattern. Originally built for MotoGP's Line A tabs; shared here so
// Races/Poles templates, the GP event block, and the All-Time Race
// Stats table render the same label instead of each re-deriving it.
const GP_PHRASE_RE = /\b(grand prix|gran premi[oi]?|grande pr[eé]mio|grande premio)\b/gi
const LEADING_CONNECTORS = new Set(['of', 'the', 'and', 'e', 'de', 'del', 'della', 'dell', 'di', 'do', 'von', 'la', 'le', 'el'])
const SHORT_LABEL_ACRONYMS = new Set(['TT', 'FIM'])

// A big share of pre-2000s MotoGP names are the nationality ADJECTIVE
// ("ARGENTINIAN GRAND PRIX", "BRITISH GRAND PRIX") rather than the place
// NOUN — title-casing alone leaves "Argentinian"/"British" on screen, not
// "Argentina"/"Great Britain". Checked against the full leftover phrase
// first (multi-word demonyms like "south african"), then per remaining
// word — see shortGpLabel. Verified against every distinct raw name in
// motogp_grands_prix (2026-08-10), not guessed.
// Exported — reused as-is by utils/tournamentLabel.js (tennis Line A
// names have the same "demonym adjective instead of place noun" problem
// as MotoGP GP names, e.g. "Canadian Open" -> "Canada").
export const DEMONYM_TO_PLACE = {
  'american': 'United States',
  'argentine': 'Argentina',
  'argentinian': 'Argentina',
  'australian': 'Australia',
  'austrian': 'Austria',
  'belgian': 'Belgium',
  'brasilian': 'Brazil',
  'brazilian': 'Brazil',
  'british': 'Great Britain',
  'canadian': 'Canada',
  'chinese': 'China',
  'czechoslovakian': 'Czechoslovakia',
  'dutch': 'Netherlands',
  'european': 'Europe',
  'finnish': 'Finland',
  'french': 'France',
  'german': 'Germany',
  'hungarian': 'Hungary',
  'indonesian': 'Indonesia',
  'italian': 'Italy',
  'japanese': 'Japan',
  'malaysian': 'Malaysia',
  'mexican': 'Mexico',
  'portuguese': 'Portugal',
  'south african': 'South Africa',
  'spanish': 'Spain',
  'swedish': 'Sweden',
  'us': 'United States',
  'yugoslavian': 'Yugoslavia',
}

// Irregular cases the generic strip-and-title-case pass can't reach —
// contracted connectors ("dell'", "d'"), non-Latin/accented country nouns
// in their own language ("Deutschland", "Österreich", "České republiky"),
// and a handful of one-off long-form names that are simpler said as just
// the region ("... and the Rimini Riviera" -> "San Marino"). Keyed by the
// exact raw name (case-insensitive) — checked before the generic pass, so
// it never has to guess at a language it hasn't seen. Add a row here only
// once confirmed against real motogp_grands_prix.name data, same rule as
// motogp.js's TEAM_NAME_ALIASES.
const NAME_OVERRIDES = {
  "BADEN-WÜRTEMBERG": 'Baden-Württemberg',
  'DUTCH TT': 'Netherlands',
  "GRAN PREMIO D'ITALIA": 'Italy',
  'GRAN PREMIO DE ARAGÓN': 'Aragon',
  'GRAN PREMIO DE ESPAÑA': 'Spain',
  'GRAN PREMIO DE EUROPA': 'Europe',
  'GRAN PREMIO DE LA COMUNITAT VALENCIANA': 'Valencia',
  'GRAN PREMIO DE LA REPÚBLICA ARGENTINA': 'Argentina',
  "GRAN PREMIO DELL'EMILIA-ROMAGNA": 'Emilia-Romagna',
  "GRAN PREMIO DELL'EMILIA ROMAGNA E DELLA RIVIERA DI RIMINI": 'Emilia-Romagna',
  'GRAN PREMIO DI SAN MARINO E DELLA RIVIERA DI RIMINI': 'San Marino',
  'GRAND PRIX ČESKÉ REPUBLIKY': 'Czech Republic',
  'GRAND PRIX OF SAN MARINO AND THE RIMINI RIVIERA': 'San Marino',
  'GRAND PRIX OF THE VALENCIAN COMMUNITY': 'Valencia',
  'MALAYSIAN MOTORCYCLE GRAND PRIX': 'Malaysia',
  'MOTORRAD GRAND PRIX DEUTSCHLAND': 'Germany',
  'MOTORRAD GRAND PRIX VON ÖSTERREICH': 'Austria',
  'SOLIDARITY GRAND PRIX OF BARCELONA': 'Barcelona',
  'U.S. GRAND PRIX': 'United States',
  'VITESSE DU MANS GRAND PRIX': 'Le Mans',
}

function titleCaseWord(word) {
  const bare = word.replace(/[^\p{L}]/gu, '').toUpperCase()
  if (SHORT_LABEL_ACRONYMS.has(bare)) return bare
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

export function shortGpLabel(name) {
  if (!name) return name

  const override = NAME_OVERRIDES[name.trim().toUpperCase()]
  if (override) return override

  let words = name.replace(GP_PHRASE_RE, ' ').trim().split(/\s+/).filter(Boolean)
  while (words.length > 1 && LEADING_CONNECTORS.has(words[0].toLowerCase())) words.shift()
  if (!words.length) words = name.split(/\s+/)

  const phraseKey = words.join(' ').toLowerCase()
  if (DEMONYM_TO_PLACE[phraseKey]) return DEMONYM_TO_PLACE[phraseKey]

  return words.map(w => {
    const bare = w.replace(/[^\p{L}]/gu, '').toLowerCase()
    return DEMONYM_TO_PLACE[bare] || titleCaseWord(w)
  }).join(' ')
}
