// Debounced server-side typeahead against GET /api/entities/search — the
// only existing "pick from a list" component (shared/SearchableSelect.jsx)
// filters an already-loaded array client-side and isn't shaped for live
// server search, so this is new (per the comparison-report plan).
import { useState, useEffect, useRef } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import styles from './Reports.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  return url.startsWith('/media/') ? url : `/media/${url}`
}

export default function PlayerSearchPicker({ gender, excludeIds = [], onSelect, onClear, placeholder = 'Choose player' }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      api.searchPlayers(query.trim(), gender)
        .then(rows => { if (!cancelled) setResults(rows.filter(r => !excludeIds.includes(r.id))) })
        .catch(() => { if (!cancelled) setResults([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, gender])

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = (entity) => {
    onSelect(entity)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className={styles.pickerWrap} ref={wrapRef}>
      <input
        type="text"
        className={styles.pickerInput}
        placeholder={placeholder}
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length >= 2 && (
        <div className={styles.pickerDropdown}>
          {loading && <div className={styles.pickerEmpty}>Searching…</div>}
          {!loading && results.length === 0 && <div className={styles.pickerEmpty}>No players found</div>}
          {!loading && results.map(r => (
            <button type="button" key={r.id} className={styles.pickerResult} onClick={() => pick(r)}>
              {r.image_url && <img src={resolveImg(r.image_url)} alt="" className={styles.pickerResultImg} />}
              <span>{r.canonical_name}</span>
              <Flag iso2={r.country_iso2} name={r.country_name} className={styles.pickerResultFlag} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
