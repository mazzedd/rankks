import { useState, useEffect } from 'react'
import api from '../api/client'
import styles from './CompetitionLogos.module.css'

const EMPTY_FORM = { full_title: '', start_year: '', end_year: '' }
const SPORTS = [
  { key: 'f1', label: 'Formula 1' },
  { key: 'motogp', label: 'MotoGP' },
]

// Era-ranged sponsor name per Grand Prix — same start_year/end_year
// (blank = ongoing) pattern as CompetitionNaming.jsx, just scoped by
// (sport, gp_slug) instead of competition_id since a GP isn't its own
// `competitions` row. Replaced an earlier flat "one full_title per exact
// year row" design (2026-08-10) that required a fresh edit every single
// year even when a sponsor name held for a decade — a range like "2010
// to 2019" now covers every year in between with one row, same as how
// Indian Wells' sponsor eras work in CompetitionNaming.jsx.
export default function RaceNaming() {
  const [sport, setSport] = useState('f1')
  const [gps, setGps] = useState([])
  const [gpSearch, setGpSearch] = useState('')
  const [selectedSlug, setSelectedSlug] = useState('')
  const [rows, setRows] = useState([])
  const [loadingRows, setLoadingRows] = useState(false)
  const [selected, setSelected] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // ── Load GP picker when sport changes ──
  useEffect(() => {
    setSelectedSlug('')
    setGpSearch('')
    api.get(`/race-naming/gps?sport=${sport}`).then(r => setGps(r.data)).catch(console.error)
  }, [sport])

  const gpsFiltered = gps.filter(g => !gpSearch || g.name.toLowerCase().includes(gpSearch.toLowerCase()))
  const selectedGp = gps.find(g => g.slug === selectedSlug)

  // ── Load era rows when GP changes ──
  useEffect(() => {
    setSelected(null)
    setEditing(false)
    if (!selectedSlug) { setRows([]); return }
    setLoadingRows(true)
    api.get(`/race-naming?sport=${sport}&gp_slug=${selectedSlug}`)
      .then(r => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoadingRows(false))
  }, [selectedSlug, sport])

  const startNew = () => {
    setSelected(null)
    setForm(EMPTY_FORM)
    setEditing(true)
    setSaved(false)
  }

  const selectRow = (row) => {
    setSelected(row)
    setForm({
      full_title: row.full_title || '',
      start_year: row.start_year ?? '',
      end_year: row.end_year ?? '',
    })
    setEditing(true)
    setSaved(false)
  }

  const save = async () => {
    if (!form.full_title || !form.start_year) return
    setSaving(true)
    const payload = {
      sport,
      gp_slug: selectedSlug,
      full_title: form.full_title,
      start_year: parseInt(form.start_year),
      end_year: form.end_year ? parseInt(form.end_year) : null,
    }
    try {
      if (selected) {
        const { data } = await api.put(`/race-naming/${selected.id}`, payload)
        setRows(prev => prev.map(r => r.id === selected.id ? data : r))
        setSelected(data)
      } else {
        const { data } = await api.post('/race-naming', payload)
        setRows(prev => [...prev, data])
        setSelected(data)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row) => {
    if (!confirm(`Delete this name override (${row.start_year}${row.end_year ? '–' + row.end_year : '–ongoing'})?`)) return
    try {
      await api.delete(`/race-naming/${row.id}`)
      setRows(prev => prev.filter(r => r.id !== row.id))
      if (selected?.id === row.id) { setEditing(false); setSelected(null) }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Race Naming</h1>
        <p className={styles.subtitle}>Era-specific sponsor name overrides for one Grand Prix — e.g. "Rolex Australian Grand Prix" 2010–2019, "Qatar Airways Australian Grand Prix" 2020–ongoing. Shown as the page subtitle on the public site for whichever year is being viewed. A race with no override here shows no subtitle at all.</p>
      </div>

      <div className={styles.drilldown}>
        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Sport</div>
          <div className={styles.drillList}>
            {SPORTS.map(s => (
              <button
                key={s.key}
                className={`${styles.drillItem} ${sport === s.key ? styles.drillItemActive : ''}`}
                onClick={() => setSport(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Grand Prix</div>
          <input
            className={styles.drillSearch}
            placeholder="Search..."
            value={gpSearch}
            onChange={e => setGpSearch(e.target.value)}
          />
          <div className={styles.drillList}>
            {gpsFiltered.length === 0 ? (
              <div className={styles.drillEmpty}>No match</div>
            ) : gpsFiltered.map(g => (
              <button
                key={g.slug}
                className={`${styles.drillItem} ${selectedSlug === g.slug ? styles.drillItemActive : ''}`}
                onClick={() => setSelectedSlug(g.slug)}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!selectedSlug ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🏁</span>
          <span>Select a sport and Grand Prix to manage its era names</span>
        </div>
      ) : (
        <>
          <div className={styles.tableToolbar}>
            <button className={styles.addBtn} onClick={startNew}>+ Add era name</button>
          </div>

          <div className={styles.table}>
            <div className={styles.tableHeader} style={{ gridTemplateColumns: '2.5fr 1fr 1fr 160px' }}>
              <span>Full (sponsor) name</span>
              <span>Start Year</span>
              <span>End Year</span>
              <span></span>
            </div>

            {loadingRows ? (
              <div className={styles.tableEmpty}>Loading...</div>
            ) : rows.length === 0 ? (
              <div className={styles.tableEmpty}>No era overrides yet — {selectedGp?.name} shows no name subtitle for any year.</div>
            ) : (
              rows.slice().sort((a, b) => b.start_year - a.start_year).map(row => (
                <div key={row.id} className={styles.tableRow} style={{ gridTemplateColumns: '2.5fr 1fr 1fr 160px' }}>
                  <span>{row.full_title}</span>
                  <span className={styles.colStart}>{row.start_year}</span>
                  <span className={styles.colEnd}>{row.end_year ?? '—'}</span>
                  <span className={styles.colActions}>
                    <button className={styles.rowActionBtn} onClick={() => selectRow(row)}>Edit</button>
                    <button className={styles.rowActionBtnDelete} onClick={() => remove(row)}>Delete</button>
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {editing && (
        <div className={styles.editorOverlay} onClick={() => setEditing(false)}>
          <div className={styles.editor} onClick={e => e.stopPropagation()}>
            <div className={styles.editorHeader}>
              <div>
                <div className={styles.editorTitle}>
                  {selected ? 'Edit era name' : 'New era name'}
                </div>
                <div className={styles.editorMeta}>
                  {selected ? <span className={styles.idBadge}>ID {selected.id}</span> : 'Not saved yet'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
                  onClick={save}
                  disabled={saving || !form.full_title || !form.start_year}
                >
                  {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
                </button>
                <button className={styles.closeEditorBtn} onClick={() => setEditing(false)}>✕</button>
              </div>
            </div>

            <div className={styles.fieldSection}>
              <div className={styles.fieldGrid}>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Full (sponsor) name</label>
                  <input
                    className={styles.fieldInputWide}
                    value={form.full_title}
                    onChange={e => setForm(p => ({ ...p, full_title: e.target.value }))}
                    placeholder={`Formula 1 ... ${selectedGp?.name || ''} Grand Prix`}
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Start year</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    value={form.start_year}
                    onChange={e => setForm(p => ({ ...p, start_year: e.target.value }))}
                    placeholder="2010"
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>End year (optional)</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    value={form.end_year}
                    onChange={e => setForm(p => ({ ...p, end_year: e.target.value }))}
                    placeholder="Leave blank = ongoing"
                  />
                </div>

              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
