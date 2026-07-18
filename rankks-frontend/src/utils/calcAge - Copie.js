// src/utils/calcAge.js
// Unified "age at event date" rule — shared by football, tennis, and F1.
// Reference date is always the most specific date available for the
// context being displayed:
//   - Football: season.end_date
//   - Tennis: tournament/season.end_date
//   - F1 race-level tables (Session Results, Qualifying): the GP's
//     event_date
//   - F1 season-level tables (Drivers standings): the season's last
//     race date (season_end_date, computed server-side as
//     MAX(event_date) across that season's GPs — F1 has no single
//     season.end_date column, so this is the equivalent)
export function calcAge(birthDate, refDate) {
  if (!birthDate || !refDate) return null
  const birth = new Date(birthDate)
  const ref = new Date(refDate)
  if (isNaN(birth) || isNaN(ref)) return null
  return Math.floor((ref - birth) / (365.25 * 24 * 60 * 60 * 1000))
}

export function fmtBirth(birthDate) {
  if (!birthDate) return null
  const d = new Date(birthDate)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}
