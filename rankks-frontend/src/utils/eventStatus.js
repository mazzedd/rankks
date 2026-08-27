// utils/eventStatus.js
// Shared past/ongoing/next/upcoming classification for any list of dated
// events (F1/MotoGP Grands Prix, a Home tab's session feed...). Replaces
// the old per-event "is today within this one event's own date window"
// check used in isolation, which left every future round labelled the
// same ("upcoming") with no way to single out the very next one.
//
// - past: the event's own date window has fully ended.
// - ongoing: today falls within the event's own window (race weekend in
//   progress) — same 2-day-before-through-end-of-day heuristic as before.
// - next: the single earliest event that's neither past nor ongoing —
//   the next thing on the calendar once the current one (if any) wraps.
// - upcoming: every other non-past, non-ongoing event, i.e. everything
//   after "next".
//
// classifyByDate needs the FULL list to rank against (an isolated event
// can be past/ongoing, but "is this the very next one" is only knowable
// relative to its siblings) — pass every event in the same
// season/competition, not just the one being displayed.
// Display text shared by every status badge/label in the app — StatusBadge
// (EventBlock.jsx), the F1/MotoGP GP-page breadcrumb, and HomeF1Template's
// filter buttons all read from this one map so a rename never drifts out
// of sync between them.
export const STATUS_LABEL = { past: 'Past', ongoing: 'Ongoing', next: 'Next', upcoming: 'Future' }

// preDays: how many days before the event's own date "ongoing" starts
// counting. Default 2 fits a multi-day race weekend (F1/MotoGP — practice
// starts ~2 days before the raceday this function is fed). A single dated
// event — one football/NBA match, one MMA card — has no such lead-in, so
// callers for those pass preDays: 0; without it, a match still 2 days out
// read as already "ongoing" (Mohamed 2026-08-26, football home league box:
// "why game in ONGOING whereas it is scheduled 28.08.26, we're only
// 26.08.26" — exactly the 2-day window kicking in early).
export function classifyByDate(events, getDate, { preDays = 2 } = {}) {
  const now = new Date()
  const withMeta = events.map(e => {
    const raw = new Date(getDate(e))
    if (isNaN(raw)) return { item: e, date: raw, base: 'upcoming' }
    const start = new Date(raw)
    start.setDate(start.getDate() - preDays)
    start.setHours(0, 0, 0, 0)
    const endOfDay = new Date(raw)
    endOfDay.setHours(23, 59, 59, 999)
    let base
    if (endOfDay < now) base = 'past'
    else if (now >= start) base = 'ongoing'
    else base = 'future'
    return { item: e, date: raw, base }
  })

  const futures = withMeta.filter(x => x.base === 'future').sort((a, b) => a.date - b.date)
  const nextEntry = futures[0]

  return withMeta.map(x => ({
    item: x.item,
    status: x.base === 'future' ? (x === nextEntry ? 'next' : 'upcoming') : x.base,
  }))
}
