import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './SearchableSelect.module.css'

// A "select" that opens a small panel with a search box pinned at the top
// followed by the filtered option list — for a long options list (e.g.
// "All Teams" across 90+ World Cup nations) where scrolling a plain
// native <select> to find one name is slow. Visually matches the
// existing .filter-label select trigger; only the open panel is custom.
//
// Panel renders through a portal to document.body instead of as a normal
// child (Mohamed 2026-08-16: "check also the ddown which doesnt show
// entirely") — ContentArea.module.css's .area wrapper (every page's main
// content column) sets overflow:hidden for horizontal table-scroll
// containment, and as a plain absolutely-positioned child the panel got
// silently clipped by that ancestor whenever it extended past .area's own
// bounds. Portaling escapes every ancestor's overflow/stacking context;
// position is computed from the trigger's own getBoundingClientRect() and
// kept in sync on scroll/resize while open instead.
export default function SearchableSelect({ value, onChange, options, placeholder, allLabel = 'All' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [coords, setCoords] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    // panelRef too — the panel is portaled out of rootRef's DOM subtree,
    // so a click inside it no longer registers as "inside" rootRef and
    // would otherwise be treated as an outside click and close it instantly.
    const onDocClick = (e) => {
      if (rootRef.current?.contains(e.target)) return
      if (panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
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

  // Recomputed on open, and kept in sync on scroll (any scrollable
  // ancestor, not just window — capture:true) / resize while open, since
  // position:fixed coordinates are viewport-relative and would otherwise
  // drift away from the trigger as soon as the page scrolls.
  useLayoutEffect(() => {
    if (!open) return
    const updateCoords = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    }
    updateCoords()
    window.addEventListener('scroll', updateCoords, true)
    window.addEventListener('resize', updateCoords)
    return () => {
      window.removeEventListener('scroll', updateCoords, true)
      window.removeEventListener('resize', updateCoords)
    }
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter(o => o.label.toLowerCase().includes(q)) : options
  const selected = options.find(o => o.value === value)

  const pick = (val) => { onChange(val); setOpen(false) }

  return (
    <div className={styles.root} ref={rootRef}>
      <button type="button" ref={triggerRef} className={styles.trigger} onClick={() => setOpen(o => !o)}>
        {selected ? selected.label : (placeholder || allLabel)}
      </button>
      {open && coords && createPortal(
        <div
          ref={panelRef}
          className={styles.panel}
          style={{ position: 'fixed', top: coords.top, left: coords.left, minWidth: coords.width }}
        >
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
        </div>,
        document.body
      )}
    </div>
  )
}
