// src/utils/positionCode.js
// Single source of truth for football's 2-letter position code, shown next
// to a player's name across every football page (Scorers/Passers/Players,
// Player Stats All-Time, etc). Kept distinct from POSITIONS_BY_SPORT's
// filter grouping in players_template.jsx, which still merges
// Attacker/Forward under one "Attacker" filter option — that's a filtering
// concern, this is a display concern, and the two are allowed to disagree
// (a player stored as "Forward" filters under "Attacker" but still shows FW).
//
// Two raw vocabularies exist in player_attributes.attribute_value depending
// on ingestion source: API-Sports (Goalkeeper/Defender/Midfielder/Attacker)
// and the worldfootball.net pre-2010 backfill (Goalkeeper/Defence/Midfield/
// Forward). Defence/Midfield map to the same DE/MD code as their API-Sports
// counterparts (Mohamed only distinguished Attacker vs Forward explicitly);
// Attacker and Forward are kept as separate codes (AT/FW) per that spec,
// even though both mean the same real-world attacking position.
const POSITION_CODES = {
  Goalkeeper: 'GK',
  Defender:   'DE',
  Defence:    'DE',
  Midfielder: 'MD',
  Midfield:   'MD',
  Attacker:   'AT',
  Forward:    'FW',
}

export function getPositionCode(position) {
  return POSITION_CODES[position] || null
}

// Filtering concern (kept separate from display above) — groups both
// vocabularies' variants under the 4 canonical position buckets so a
// "Defender" filter also matches players stored as "Defence", etc.
const POSITION_GROUPS = {
  Goalkeeper: 'Goalkeeper',
  Defender:   'Defender',
  Defence:    'Defender',
  Midfielder: 'Midfielder',
  Midfield:   'Midfielder',
  Attacker:   'Attacker',
  Forward:    'Attacker',
}

export function getPositionGroup(position) {
  return POSITION_GROUPS[position] || null
}
