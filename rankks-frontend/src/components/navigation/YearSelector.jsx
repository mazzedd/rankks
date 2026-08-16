import { useRef, useEffect } from 'react'
import useAppStore from '../../store/useAppStore'
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
  const { activeYear, changeYear } = useAppStore()
  const minYear = foundedYear || 1968
  const maxYear = dissolvedYear || new Date().getFullYear()
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
        onClick={() => prevYear && changeYear(prevYear)}
        disabled={!prevYear}
      >‹</button>
      <div className={styles.track} ref={ref}>
        {years.map(y => {
          const frozen = isFrozen(y)
          const outOfRange = !frozen && isOutOfRange(y)
          return (
            <button
              key={y}
              ref={y === activeYear ? activeRef : null}
              className={`${styles.year}${y === activeYear ? ' ' + styles.active : ''}${frozen ? ' ' + styles.frozen : ''}${outOfRange ? ' ' + styles.outOfRange : ''}`}
              onClick={() => !frozen && changeYear(y)}
              disabled={frozen}
              title={outOfRange ? 'There was no event scheduled' : undefined}
            >
              {y}
            </button>
          )
        })}
      </div>
      <button
        className={styles.arrow}
        onClick={() => nextYear && changeYear(nextYear)}
        disabled={!nextYear}
      >›</button>
    </div>
  )
}
