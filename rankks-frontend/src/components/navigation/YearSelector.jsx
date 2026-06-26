import { useRef, useEffect } from 'react'
import useAppStore from '../../store/useAppStore'
import styles from './YearSelector.module.css'

const MIN = 1968
const MAX = new Date().getFullYear()

export default function YearSelector({ firstDataYear, dissolvedYear }) {
  const { activeYear, changeYear } = useAppStore()
  const years = Array.from({ length: MAX - MIN + 1 }, (_, i) => MIN + i)
  const activeRef = useRef(null)
  const ref = useRef(null)

  const isDisabled = (y) => {
    if (firstDataYear && y < firstDataYear) return true
    if (dissolvedYear && y > dissolvedYear) return true
    return false
  }

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [activeYear])

  const prevYear = [...years].reverse().find(y => y < activeYear && !isDisabled(y))
  const nextYear = years.find(y => y > activeYear && !isDisabled(y))

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
            className={`${styles.year}${y === activeYear ? ' ' + styles.active : ''}${isDisabled(y) ? ' ' + styles.disabled : ''}`}
            onClick={() => !isDisabled(y) && changeYear(y)}
            disabled={isDisabled(y)}
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