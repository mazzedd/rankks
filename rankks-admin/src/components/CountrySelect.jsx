import { useState, useEffect, useRef } from 'react'
import api from '../api/client'
import styles from './CountrySelect.module.css'

// Cached at module scope — the country list (~250 rows) is static enough
// per session that every instance of this component across the app
// (Clubs, Athletes) shares one fetch instead of re-requesting it per field.
let cachedCountries = null

export default function CountrySelect({ value, onChange, placeholder = 'Select country...' }) {
  const [countries, setCountries] = useState(cachedCountries || [])
  const [open, setOpen]           = useState(false)
  const [search, setSearch]       = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (cachedCountries) return
    api.get('/countries')
      .then(r => { cachedCountries = r.data; setCountries(r.data) })
      .catch(console.error)
  }, [])

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

  const selected = countries.find(c => String(c.id) === String(value))
  const filtered = search
    ? countries.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.iso2.toLowerCase().includes(search.toLowerCase())
      )
    : countries

  const pick = (id) => {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button type="button" className={styles.trigger} onClick={() => setOpen(o => !o)}>
        <span className={selected ? styles.value : styles.placeholder}>
          {selected ? selected.name : placeholder}
        </span>
        <span className={styles.chevron}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <input
            className={styles.search}
            autoFocus
            placeholder="Search country..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className={styles.list}>
            <button type="button" className={styles.option} onClick={() => pick(null)}>
              — None —
            </button>
            {filtered.map(c => (
              <button
                type="button"
                key={c.id}
                className={`${styles.option} ${String(c.id) === String(value) ? styles.optionActive : ''}`}
                onClick={() => pick(c.id)}
              >
                <span className={styles.iso}>{c.iso2}</span> {c.name}
              </button>
            ))}
            {filtered.length === 0 && <div className={styles.empty}>No match</div>}
          </div>
        </div>
      )}
    </div>
  )
}
