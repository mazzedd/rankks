import { useEffect, useRef, useState } from 'react'
import styles from './SearchableSelect.module.css'

// A "select" that opens a small panel with a search box pinned at the top
// followed by the filtered option list — for a long options list (e.g.
// "All Teams" across 90+ World Cup nations) where scrolling a plain
// native <select> to find one name is slow. Visually matches the
// existing .filter-label select trigger; only the open panel is custom.
export default function SearchableSelect({ value, onChange, options, placeholder, allLabel = 'All' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) { setQuery(''); inputRef.current?.focus() }
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options
  const selected = options.find(o => o.value === value)

  const pick = (val) => { onChange(val); setOpen(false) }

  return (
    <div className={styles.root} ref={rootRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen(o => !o)}>
        {selected ? selected.label : (placeholder || allLabel)}
      </button>
      {open && (
        <div className={styles.panel}>
          <input
            ref={inputRef}
            className={styles.search}
            placeholder="Search..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className={styles.list}>
            <div className={`${styles.option} ${!value ? styles.optionActive : ''}`} onClick={() => pick('')}>
              {allLabel}
            </div>
            {filtered.map(o => (
              <div
                key={o.value}
                className={`${styles.option} ${value === o.value ? styles.optionActive : ''}`}
                onClick={() => pick(o.value)}
              >
                {o.label}
              </div>
            ))}
            {filtered.length === 0 && <div className={styles.empty}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  )
}
