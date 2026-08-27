import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import useAppStore from '../../store/useAppStore'
import { pathForYearFromHome, homeYearClickAction } from '../../routing/urlSchema'
import { isModifiedClick } from '../../routing/isModifiedClick'
import styles from './YearSelector.module.css'

// Full real-world range per competition: founded_year (or earlier valid_from
// for time-bounded categories) through today, or dissolved_year if the
// competition no longer runs. Years with no ingested data still render and
// are clickable — the content area's existing empty-state logic (no_data /
// cancelled / not_founded in seasons.js) handles what's shown once selected.
// 1968 remains only as a last-resort fallback for any competition that
// somehow has no founded_year set at all.
//
// editionYears (optional, e.g. [2014, 2018, 2022, 2026] for World Cup):
// quadrennial/irregular competitions pass their competitions.edition_years
// array here. Any year in the full min-max range NOT in that set is frozen
// — visually disabled and unclickable, and skipped entirely by the ‹/›
// arrows — rather than staying clickable and only showing an empty state
// after the fact. When this prop is omitted (every regular annual
// competition), behaviour is unchanged from before this feature existed.
// validFrom/validTo (optional): the SPECIFIC competition's own real
// lifetime, when it's narrower than the full foundedYear-dissolvedYear
// strip passed in (that strip is now widened to cover every sibling
// competition sharing the same category — see ContentArea's yearRange
// effect). Years inside the strip but outside [validFrom, validTo] are
// real years, just ones this competition had no edition in — greyed via
// .outOfRange (still clickable, unlike .frozen below) so the empty state
// that appears on click ("There was no event scheduled") is reachable
// instead of the year being a dead end.
export default function YearSelector({ foundedYear, dissolvedYear, editionYears, validFrom, validTo }) {
  const store = useAppStore()
  const { activeYear, changeYear, setTab, setMmaSection, setTennisSchedule } = store
  // Clicking a different year while a sport's Home dashboard is showing
  // must land on its real Schedule page, not stay on Home — Home has no
  // per-year content of its own (see homeYearClickAction's own comment).
  // null for every other sport/tab (year click behaves as before).
  const homeYearAction = homeYearClickAction(store)
  const applyHomeYearAction = () => {
    if (homeYearAction?.setTab) setTab(homeYearAction.setTab)
    if (homeYearAction?.setMmaSection) setMmaSection(homeYearAction.setMmaSection)
    if (homeYearAction?.setTennisSchedule) setTennisSchedule(true)
  }
  const minYear = foundedYear || 1968
  // +1 (not the real calendar year) — a start-year-convention competition's
  // CURRENT season displays one year ahead of the real calendar year (Ligue
  // 1's 2026 DB row, season Aug 2026-May 2027, displays as "2027"; see
  // EventBlock.jsx's own dbYear/toDisplayYear pair). This generic fallback
  // has no yearConvention of its own to check, so it just always allows one
  // year further than "today" — harmless for every other competition
  // (clicking an unscheduled future year already shows the normal empty
  // state, same as any other not-yet-ingested year per this file's own
  // header comment), but load-bearing here: without it, Ligue 1 2026/27
  // was ingested and fully reachable by direct URL, yet never appeared as
  // a clickable year at all (Mohamed 2026-08-26: "no 2027 new year in Year
  // Selector").
  const maxYear = dissolvedYear || (new Date().getFullYear() + 1)
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)

  const editionSet = editionYears?.length ? new Set(editionYears) : null
  const isFrozen = (y) => editionSet ? !editionSet.has(y) : false
  const isOutOfRange = (y) => (validFrom != null && y < validFrom) || (validTo != null && y > validTo)

  const activeRef = useRef(null)
  const ref = useRef(null)

  // Track the range from the PREVIOUS render so we can tell whether this
  // effect run was triggered by a competition swap (range changed) or by
  // ordinary year navigation within the same competition (range unchanged,
  // only activeYear changed). Those two cases need different scroll
  // behaviour:
  //   - Range changed (competition swap): snap instantly. The old scroll
  //     position belongs to a different competition's track entirely and
  //     has no spatial relationship to the new one — animating across 90
  //     years of empty track looks like the strip "sliding in from the
  //     left", which is the bug being fixed here.
  //   - Range unchanged (arrow click / year pill click / Rule 1 year swap):
  //     keep the smooth scroll — that animation is wanted, it's what makes
  //     clicking ‹ / › feel like moving along a timeline.
  const prevRangeRef = useRef({ minYear, maxYear })

  useEffect(() => {
    const rangeChanged =
      prevRangeRef.current.minYear !== minYear ||
      prevRangeRef.current.maxYear !== maxYear

    activeRef.current?.scrollIntoView({
      behavior: rangeChanged ? 'auto' : 'smooth',
      inline: 'center',
      block: 'nearest',
    })

    prevRangeRef.current = { minYear, maxYear }
  }, [activeYear, minYear, maxYear])

  // Navigable years for the ‹/› arrows — every year normally, but only
  // real edition years when editionYears is active, so the arrows always
  // land on actual content instead of stepping onto a frozen year first.
  const navigableYears = editionSet ? years.filter(y => editionSet.has(y)) : years
  const prevYear = [...navigableYears].reverse().find(y => y < activeYear)
  const nextYear = navigableYears.find(y => y > activeYear)

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.arrow}
        onClick={() => { if (!prevYear) return; changeYear(prevYear); applyHomeYearAction() }}
        disabled={!prevYear}
      >‹</button>
      <div className={styles.track} ref={ref}>
        {years.map(y => {
          const frozen = isFrozen(y)
          const outOfRange = !frozen && isOutOfRange(y)
          // Frozen years have no real destination (see the header comment
          // above) — stay a plain disabled button, not a Link (Mohamed
          // 2026-08-21: hover should show the URL, but there's no page to
          // link a frozen year to).
          if (frozen) {
            return (
              <button
                key={y}
                className={`${styles.year} ${styles.frozen}`}
                disabled
              >
                {y}
              </button>
            )
          }
          return (
            <Link
              key={y}
              ref={y === activeYear ? activeRef : null}
              to={pathForYearFromHome(store, y)}
              className={`${styles.year}${y === activeYear ? ' ' + styles.active : ''}${outOfRange ? ' ' + styles.outOfRange : ''}`}
              onClick={e => {
                if (isModifiedClick(e)) return
                changeYear(y)
                applyHomeYearAction()
              }}
              title={outOfRange ? 'There was no event scheduled' : undefined}
            >
              {y}
            </Link>
          )
        })}
      </div>
      <button
        className={styles.arrow}
        onClick={() => { if (!nextYear) return; changeYear(nextYear); applyHomeYearAction() }}
        disabled={!nextYear}
      >›</button>
    </div>
  )
}
