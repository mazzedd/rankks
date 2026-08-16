// CategoryPills.jsx
// Generic Line B category switcher — see module.css header and
// onboarding-motogp.md Section 1 for why this lives in shared/ rather than
// any one sport's folder: any sport with "one competition, several
// season-level variants sharing one event calendar" (the category
// dimension on `seasons`) should reuse this component instead of forking
// it. First user is MotoGP (Moto GP / Moto 2 / Moto 3).
//
// Switching category is a LOCAL prop callback only — it does NOT touch
// Line A (which GP or Final Standings is active). That's the whole point
// of the design: 2012 / Final Standings / Moto GP -> click Moto 2 ->
// 2012 / Final Standings / Moto 2, never reset. The parent component owns
// that invariant by simply not resetting its own Line A state when this
// fires onChange.
import { useState, useRef, useEffect } from 'react'
import styles from './CategoryPills.module.css'

export default function CategoryPills({ categories, active, onChange }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const current = categories.find(c => c.slug === active) || categories[0]
  if (!current) return null

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button className={styles.pill} onClick={() => setOpen(o => !o)}>
        {current.label}
        <span className={styles.chevron}>▾</span>
      </button>
      <div className={`${styles.menu}${open ? ' ' + styles.menuOpen : ''}`}>
        {categories.map(c => (
          <button
            key={c.slug}
            className={`${styles.row}${c.slug === active ? ' ' + styles.rowActive : ''}`}
            onClick={() => { onChange(c.slug); setOpen(false) }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className={styles.divider} />
    </div>
  )
}
