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
export default function YearSelector({ foundedYear, dissolvedYear }) {
  const { activeYear, changeYear } = useAppStore()
  const minYear = foundedYear || 1968
  const maxYear = dissolvedYear || new Date().getFullYear()
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)
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

  const prevYear = [...years].reverse().find(y => y < activeYear)
  const nextYear = years.find(y => y > activeYear)

  return (
    <div className={styles.wrapper}>
      <button
        className={styles.arrow}
        onClick={() => prevYear && changeYear(prevYear)}
        disabled={!prevYear}
      >‹</button>
      <div className={styles.track} ref={ref}>
        {years.map(y => (
          <button
            key={y}
            ref={y === activeYear ? activeRef : null}
            className={`${styles.year}${y === activeYear ? ' ' + styles.active : ''}`}
            onClick={() => changeYear(y)}
          >
            {y}
          </button>
        ))}
      </div>
      <button
        className={styles.arrow}
        onClick={() => nextYear && changeYear(nextYear)}
        disabled={!nextYear}
      >›</button>
    </div>
  )
}
