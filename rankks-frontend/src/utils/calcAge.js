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
//
// deathDate (optional, 3rd arg) — an athlete's age must stop advancing
// once they've died, even though refDate (today, or a season-end date
// after their death) keeps moving forward. When deathDate is earlier
// than refDate, age is computed against deathDate instead — "frozen" at
// the age they died at, not their age-would-be-today. Callers pair this
// with a small cross mark in the UI (see index.css .deceased-mark) to
// make the frozen age visually distinct from a living athlete's age.
export function calcAge(birthDate, refDate, deathDate) {
  if (!birthDate || !refDate) return null
  const birth = new Date(birthDate)
  let ref = new Date(refDate)
  if (deathDate) {
    const death = new Date(deathDate)
    if (!isNaN(death) && death < ref) ref = death
  }
  if (isNaN(birth) || isNaN(ref)) return null
  return Math.floor((ref - birth) / (365.25 * 24 * 60 * 60 * 1000))
}

// Abbreviated month names with a trailing period — "15 Dec. 1998".
// Kept human-readable (not dd.mm.yyyy) since birthdates are read as
// prose, not scanned as data; abbreviated instead of the previous full
// month name ("15 December 1998") purely to save column width.
const MONTHS_ABBR = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']

export function fmtBirth(birthDate) {
  if (!birthDate) return null
  const d = new Date(birthDate)
  if (isNaN(d)) return null
  return `${d.getDate()} ${MONTHS_ABBR[d.getMonth()]} ${d.getFullYear()}`
}

// Canonical event/match date format across the whole platform —
// dd.mm.yyyy. Was previously reimplemented independently per sport
// (F1's own local fmtDate, football's formatMatchDate using en-GB
// slashes, tennis using en-GB long-form) — this is now the single
// source, same centralization pattern already applied to flags,
// rank badges, and stat-stacks.
export function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}.${mm}.${yyyy}`
}

// F1 race weekend span — per-session dates aren't scraped (only the race
// day itself is known, see f1.js), so the Friday-Sunday window is derived
// as raceDate minus 2 days through raceDate.
// Same month  ("02–04.07.2026"): day range joined by an en dash, month/year once.
// Cross month ("30.04 - 05.05.2026"): each side keeps its own day.month, year once.
// Cross year  (rare): falls back to two full dd.mm.yyyy dates.
export function fmtWeekendRange(raceDateStr) {
  if (!raceDateStr) return '—'
  const end = new Date(raceDateStr)
  if (isNaN(end)) return '—'
  const start = new Date(end)
  start.setDate(start.getDate() - 2)

  if (start.getFullYear() !== end.getFullYear()) {
    return `${fmtDate(start)} - ${fmtDate(end)}`
  }

  const pad = n => String(n).padStart(2, '0')
  const startDay   = pad(start.getDate())
  const startMonth = pad(start.getMonth() + 1)
  const endDay     = pad(end.getDate())
  const endMonth   = pad(end.getMonth() + 1)
  const year       = end.getFullYear()

  if (startMonth === endMonth) {
    return `${startDay}–${endDay}.${endMonth}.${year}`
  }
  return `${startDay}.${startMonth} - ${endDay}.${endMonth}.${year}`
}

// Generic start/end date range — same formatting convention as
// fmtWeekendRange above (same-month day range, cross-month each side
// keeps day.month, cross-year falls back to two full dates), but takes
// both dates explicitly instead of deriving one from the other.
export function fmtDateRange(startStr, endStr) {
  if (!startStr) return '—'
  const start = new Date(startStr)
  const end   = endStr ? new Date(endStr) : start
  if (isNaN(start) || isNaN(end)) return '—'

  if (start.getFullYear() !== end.getFullYear()) {
    return `${fmtDate(start)} - ${fmtDate(end)}`
  }

  const pad = n => String(n).padStart(2, '0')
  const startDay   = pad(start.getDate())
  const startMonth = pad(start.getMonth() + 1)
  const endDay     = pad(end.getDate())
  const endMonth   = pad(end.getMonth() + 1)
  const year       = end.getFullYear()

  if (start.getTime() === end.getTime()) {
    return `${startDay}.${startMonth}.${year}`
  }
  if (startMonth === endMonth) {
    return `${startDay}–${endDay}.${endMonth}.${year}`
  }
  return `${startDay}.${startMonth} - ${endDay}.${endMonth}.${year}`
}

// Season-level "Schedule" stat (Championship/Standings-page banners) —
// deliberately coarser than fmtDateRange above. A full-season range reading
// like "15.08.2025 - 17.05.2026" (football/NBA) or even the same-year
// "08.03 - 06.12.2026" (F1/MotoGP) is precision nobody asked for at the
// season-overview level; the year(s) alone is what a "which season is
// this" stat needs (Mohamed 2026-08-25: simplify Ligue 1/NBA's season
// Schedule stat to "2025-2026", matching how F1's single-year season
// already reads as just "2026"). The real start/end dates stay exactly as
// stored in the DB and keep showing in full everywhere else (individual
// races/tournaments/matches use fmtDateRange/fmtWeekendRange, untouched).
export function fmtSeasonYearRange(startStr, endStr) {
  if (!startStr) return '—'
  const start = new Date(startStr)
  const end   = endStr ? new Date(endStr) : start
  if (isNaN(start) || isNaN(end)) return '—'

  const startYear = start.getFullYear()
  const endYear   = end.getFullYear()
  return startYear === endYear ? `${startYear}` : `${startYear}-${endYear}`
}
