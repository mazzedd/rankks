// Checklist dropdown for the Category/Surface criteria (Mohamed 2026-08-20:
// "I dont want to see pills but a ddown where I can check options"). "All"
// is its own checkbox — checking it clears the specific selections (and is
// itself shown checked whenever nothing specific is picked), matching the
// exclusive-default behavior already agreed for these two filters.
import { useState, useEffect, useRef } from 'react'
import styles from './Reports.module.css'

export default function CheckDropdown({ label, options, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const summary = selected.length
    ? options.filter(o => selected.includes(o.key)).map(o => o.label).join(', ')
    : 'All'

  return (
    <div className={styles.ddWrap} ref={wrapRef}>
      <button type="button" className={styles.ddButton} onClick={() => setOpen(o => !o)}>
        <span className={styles.ddLabel}>{label}</span>
        <span className={styles.ddSummary}>{summary}</span>
      </button>
      {open && (
        <div className={styles.ddMenu}>
          <label className={styles.ddOption}>
            <input type="checkbox" checked={selected.length === 0} onChange={onClear} />
            <span>All</span>
          </label>
          {options.map(o => (
            <label key={o.key} className={styles.ddOption}>
              <input type="checkbox" checked={selected.includes(o.key)} onChange={() => onToggle(o.key)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
