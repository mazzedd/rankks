import { useState, useEffect } from 'react'
import api, { publicApi } from '../api/client'
import styles from './Subtitles.module.css'

// Sentinel for the "Shared" competition-dropdown option — the sport-wide
// tier (sport_id set, competition_id NULL), i.e. one row that cascades to
// every competition of that sport unless a competition overrides it.
// Never sent to the backend as competition_id; only sport_id is sent.
const SHARED = '__shared__'

export default function Subtitles() {
  const [competitions, setCompetitions] = useState([])
  const [selectedSport, setSelectedSport] = useState('') // '' = All Sports (global tier)
  const [selectedComp, setSelectedComp]   = useState('') // '' = All Competitions (sport-wide tier)
  const [rows, setRows]                   = useState([])
  const [loadingRows, setLoadingRows]     = useState(false)
  const [subtitleSuggestions, setSubtitleSuggestions] = useState([])
  const [editingId, setEditingId]         = useState(null)
  const [editForm, setEditForm]           = useState({ subtitle_kind: '', is_totals_style: false })
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)

  useEffect(() => {
    publicApi.get('/competitions')
      .then(r => setCompetitions(r.data.data))
      .catch(console.error)
    api.get('/subtitles/subtitle-suggestions')
      .then(r => setSubtitleSuggestions(r.data.subtitles))
      .catch(console.error)
  }, [])

  const sports = [...new Set(competitions.map(c => c.sport_name).filter(Boolean))].sort()

  const sportId = selectedSport
    ? competitions.find(c => c.sport_name === selectedSport)?.sport_id
    : null

  const compsForSport = competitions
    .filter(c => c.sport_name === selectedSport)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  // A sport is never viewable on its own — as soon as one's picked (or the
  // competitions list loads), jump straight to its first real competition
  // alphabetically. "All competitions" is not a state you can land on;
  // the Competition column must always name one real competition (Mohamed:
  // "I should never see 'all competitions'").
  useEffect(() => {
    if (selectedSport && compsForSport.length && !selectedComp) {
      setSelectedComp(String(compsForSport[0].id))
    }
  }, [selectedSport, compsForSport, selectedComp])

  useEffect(() => {
    if (selectedSport && !selectedComp) return // waiting on the auto-select above
    setEditingId(null)
    setLoadingRows(true)
    const params = {}
    if (selectedComp === SHARED) {
      params.sport_id = sportId
    } else if (selectedComp) {
      params.competition_id = selectedComp
      params.sport_id = sportId
    }
    api.get('/subtitles', { params })
      .then(r => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoadingRows(false))
  }, [selectedComp, sportId, selectedSport])

  const [customText, setCustomText] = useState(false)

  const startEdit = (row) => {
    setEditingId(row.id)
    setEditForm({ subtitle_kind: row.subtitle_kind, is_totals_style: row.is_totals_style })
    setCustomText(!subtitleSuggestions.includes(row.subtitle_kind))
    setSaved(false)
  }

  const save = async (row) => {
    if (!editForm.subtitle_kind) return
    setSaving(true)
    try {
      const { data } = await api.put(`/subtitles/${row.id}`, editForm)
      setRows(prev => prev.map(r => r.id === row.id ? data : r))
      setSaved(true)
      setTimeout(() => { setSaved(false); setEditingId(null) }, 900)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const scopeLabel = selectedSport || 'All Sport'

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Subtitles</h1>
        <p className={styles.subtitle}>The subtitle line shown under every Line A/B item. Every item is created here automatically when it's built — this page only edits the text, it never adds or removes rows. Year suffix is added automatically: "Year" type → "– 2026", "Aggregate" type → "– through 2026".</p>
      </div>

      <div className={styles.filtersBar}>
        <select
          className={styles.filterSelect}
          value={selectedSport}
          onChange={e => { setSelectedSport(e.target.value); setSelectedComp('') }}
        >
          <option value="">All Sports</option>
          {sports.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          className={styles.filterSelect}
          value={selectedComp}
          onChange={e => setSelectedComp(e.target.value)}
          disabled={!selectedSport || !compsForSport.length}
        >
          {!selectedComp && <option value="">Loading...</option>}
          <option value={SHARED}>Shared (all {selectedSport || 'competitions'})</option>
          {compsForSport.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <span className={styles.scopeLabel}>{scopeLabel}</span>
      </div>

      <div className={styles.table}>
        <div className={styles.tableHeader}>
          <span className={styles.colSport}>Sport</span>
          <span className={styles.colComp}>Competition</span>
          <span className={styles.colItemA}>Item A</span>
          <span className={styles.colItemB}>Item B</span>
          <span className={styles.colKind}>Subtitle</span>
          <span className={styles.colType}>Type</span>
          <span className={styles.colActions}></span>
        </div>

        {loadingRows ? (
          <div className={styles.tableEmpty}>Loading...</div>
        ) : rows.length === 0 ? (
          <div className={styles.tableEmpty}>No items in this scope yet.</div>
        ) : (
          rows.map(row => {
            const isEditing = editingId === row.id
            return (
              <div key={row.id} className={`${styles.tableRow} ${isEditing ? styles.tableRowEditing : ''}`}>
                <span className={styles.colSport}>{row.sport_name || 'All sports'}</span>
                <span className={styles.colComp}>{selectedComp === SHARED ? `Shared (${selectedSport})` : (row.competition_name || 'All competitions')}</span>
                <span className={styles.colItemA}>{row.item_a}</span>
                <span className={styles.colItemB}>{row.item_b || 'n/a'}</span>

                {isEditing ? (
                  <>
                    <span className={styles.colKind}>
                      {customText ? (
                        <div className={styles.customRow}>
                          <input
                            className={styles.editInput}
                            value={editForm.subtitle_kind}
                            onChange={e => setEditForm(p => ({ ...p, subtitle_kind: e.target.value }))}
                            autoFocus
                          />
                          <button
                            type="button"
                            className={styles.backToListBtn}
                            onClick={() => setCustomText(false)}
                            title="Back to the list"
                          >
                            ☰
                          </button>
                        </div>
                      ) : (
                        <select
                          className={styles.editSelect}
                          value={editForm.subtitle_kind}
                          onChange={e => {
                            if (e.target.value === '__custom__') { setCustomText(true); return }
                            setEditForm(p => ({ ...p, subtitle_kind: e.target.value }))
                          }}
                          autoFocus
                        >
                          {!subtitleSuggestions.includes(editForm.subtitle_kind) && (
                            <option value={editForm.subtitle_kind}>{editForm.subtitle_kind}</option>
                          )}
                          {subtitleSuggestions.map(s => <option key={s} value={s}>{s}</option>)}
                          <option value="__custom__">✎ Type custom text...</option>
                        </select>
                      )}
                    </span>
                    <span className={styles.colType}>
                      <select
                        className={styles.editSelect}
                        value={editForm.is_totals_style ? 'aggregate' : 'year'}
                        onChange={e => setEditForm(p => ({ ...p, is_totals_style: e.target.value === 'aggregate' }))}
                      >
                        <option value="year">Year</option>
                        <option value="aggregate">Aggregate</option>
                      </select>
                    </span>
                    <span className={styles.colActions}>
                      <button
                        className={`${styles.rowActionBtn} ${saved ? styles.saved : ''}`}
                        onClick={() => save(row)}
                        disabled={saving || !editForm.subtitle_kind}
                      >
                        {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
                      </button>
                      <button className={styles.rowActionBtn} onClick={() => setEditingId(null)}>Cancel</button>
                    </span>
                  </>
                ) : (
                  <>
                    <span className={styles.colKind}>{row.subtitle_kind}</span>
                    <span className={styles.colType}>{row.is_totals_style ? 'Aggregate' : 'Year'}</span>
                    <span className={styles.colActions}>
                      <button className={styles.rowActionBtn} onClick={() => startEdit(row)}>Edit</button>
                    </span>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}
