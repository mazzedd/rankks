import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './MultiCheckSelect.module.css'

// Same trigger+portal-panel shape as SearchableSelect.jsx, but for a
// filter where more than one option can be active at once (Mohamed
// 2026-08-24: "All Surfaces becomes a check box (can select 1 or more
// options)" / "Add All Categories... which is a select box: 1 or more
// check options") — a plain <select> only ever holds one value, so this
// swaps the option rows for checkboxes and keeps `values` as a Set
// instead of a single string. Portaled to document.body for the same
// reason SearchableSelect is: ContentArea.module.css's .area wrapper
// clips anything that overflows it, and a plain absolutely-positioned
// child panel got cut off there.
export default function MultiCheckSelect({ values, onChange, options, allLabel = 'All' }) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState(null)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
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

  const toggle = (val) => {
    const next = new Set(values)
    next.has(val) ? next.delete(val) : next.add(val)
    onChange(next)
  }

  const triggerLabel = values.size === 0
    ? allLabel
    : values.size <= 2
      ? options.filter(o => values.has(o.value)).map(o => o.label).join(', ')
      : `${values.size} selected`

  return (
    <div className={styles.root} ref={rootRef}>
      <button type="button" ref={triggerRef} className={styles.trigger} onClick={() => setOpen(o => !o)}>
        {triggerLabel}
      </button>
      {open && coords && createPortal(
        <div
          ref={panelRef}
          className={styles.panel}
          style={{ position: 'fixed', top: coords.top, left: coords.left, minWidth: coords.width }}
        >
          <div className={styles.list}>
            {values.size > 0 && (
              <div className={styles.clearRow} onClick={() => onChange(new Set())}>Clear</div>
            )}
            {options.map(o => (
              <label key={o.value} className={styles.option}>
                <input type="checkbox" checked={values.has(o.value)} onChange={() => toggle(o.value)} />
                {o.label}
              </label>
            ))}
            {options.length === 0 && <div className={styles.empty}>No options</div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
