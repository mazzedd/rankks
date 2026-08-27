import { useState, useEffect, useRef } from 'react'
import styles from './CountrySelect.module.css'

// Generic searchable dropdown, same interaction/visuals as CountrySelect but
// takes its options as a prop instead of fetching countries itself — reused
// wherever an admin page needs to pick one item out of a searchable list
// (partners, entities, competitions, races...).
export default function SearchSelect({ value, onChange, options, placeholder = 'Select...', getLabel, getSublabel, allowClear = true }) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const label = (opt) => (getLabel ? getLabel(opt) : opt.name)
  const sublabel = (opt) => (getSublabel ? getSublabel(opt) : null)

  const selected = options.find(o => String(o.id) === String(value))
  const filtered = search
    ? options.filter(o => label(o).toLowerCase().includes(search.toLowerCase()))
    : options

  const pick = (id) => {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen(o => !o)}>
        <span className={selected ? styles.value : styles.placeholder}>
          {selected ? label(selected) : placeholder}
        </span>
        <span className={styles.chevron}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <input
            className={styles.search}
            autoFocus
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className={styles.list}>
            {allowClear && (
              <button type="button" className={styles.option} onClick={() => pick(null)}>
                — None —
              </button>
            )}
            {filtered.map(o => (
              <button
                type="button"
                key={o.id}
                className={`${styles.option} ${String(o.id) === String(value) ? styles.optionActive : ''}`}
                onClick={() => pick(o.id)}
              >
                {label(o)}
                {sublabel(o) && <span className={styles.iso}> {sublabel(o)}</span>}
              </button>
            ))}
            {filtered.length === 0 && <div className={styles.empty}>No match</div>}
          </div>
        </div>
      )}
    </div>
  )
}
