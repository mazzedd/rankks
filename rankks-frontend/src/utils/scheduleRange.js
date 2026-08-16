// utils/scheduleRange.js
// "30.08 - 13.09.2026" style date-range label for a GP weekend, built from
// its full session list (session_date across every Practice/Qualifying/
// Sprint/Race). Used on Next/Future GP pages in place of a driver list —
// nobody has results to show yet, so the page instead just states when the
// weekend happens. Start omits the year (assumed same as the end date,
// true for every real GP weekend); a single-session weekend collapses to
// one date instead of "X - X".
function pad2(n) { return String(n).padStart(2, '0') }
function dm(d) { return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}` }
function dmy(d) { return `${dm(d)}.${d.getFullYear()}` }

export function formatScheduleRange(sessions) {
  const dates = (sessions || [])
    .map(s => new Date(s.session_date))
    .filter(d => !isNaN(d))
  if (!dates.length) return null
  const start = new Date(Math.min(...dates))
  const end = new Date(Math.max(...dates))
  return start.toDateString() === end.toDateString() ? dmy(start) : `${dm(start)} - ${dmy(end)}`
}
