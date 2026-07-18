import { useState, useEffect } from 'react'
import api, { publicApi } from '../api/client'
import styles from './TabTitles.module.css'

const EMPTY_FORM = {
  matchType: 'tab_key',   // 'tab_key' | 'tab_group' — which of the two the form is targeting
  tab_key: '', tab_group: '', section: 'default',
  title_template: '', valid_from: '', valid_to: '',
}

const SECTIONS = [
  { value: 'default',   label: 'Default (single-content tabs — Scorers, Players, Countries...)' },
  { value: 'standings', label: 'Standings (the table half of a Group Stage tab)' },
  { value: 'game',      label: 'Games (the match-list half of a Group Stage tab)' },
]

export default function TabTitles() {
  const [competitions, setCompetitions] = useState([])
  const [selectedSport, setSelectedSport] = useState('')
  const [selectedComp, setSelectedComp]   = useState('')
  const [compSearch, setCompSearch]       = useState('')
  const [rows, setRows]                   = useState([])
  const [loadingRows, setLoadingRows]     = useState(false)
  const [tabOptions, setTabOptions]       = useState({ tab_keys: [], tab_groups: [] })
  const [selected, setSelected]           = useState(null) // null = new item mode
  const [editing, setEditing]             = useState(false)
  const [form, setForm]                   = useState(EMPTY_FORM)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)

  useEffect(() => {
    publicApi.get('/competitions')
      .then(r => setCompetitions(r.data.data))
      .catch(console.error)
  }, [])

  // Sports derived from the competitions list — Column 1 (same pattern as IconicMoments)
  const sports = [...new Set(competitions.map(c => c.sport_name).filter(Boolean))].sort()

  // Competitions for the selected sport — Column 2
  const compsForSport = competitions
    .filter(c => c.sport_name === selectedSport)
    .filter(c => !compSearch || c.name.toLowerCase().includes(compSearch.toLowerCase()))

  // Load existing title overrides + real tab options when competition changes
  useEffect(() => {
    setSelected(null)
    setEditing(false)
    if (!selectedComp) { setRows([]); setTabOptions({ tab_keys: [], tab_groups: [] }); return }
    setLoadingRows(true)
    Promise.all([
      api.get(`/tab-titles?competition_id=${selectedComp}`),
      api.get(`/tab-titles/tab-options?competition_id=${selectedComp}`),
    ])
      .then(([rowsRes, optsRes]) => {
        setRows(rowsRes.data)
        setTabOptions(optsRes.data)
      })
      .catch(console.error)
      .finally(() => setLoadingRows(false))
  }, [selectedComp])

  const startNew = () => {
    setSelected(null)
    setForm(EMPTY_FORM)
    setEditing(true)
    setSaved(false)
  }

  const selectRow = (row) => {
    setSelected(row)
    setForm({
      matchType: row.tab_key ? 'tab_key' : 'tab_group',
      tab_key: row.tab_key || '',
      tab_group: row.tab_group || '',
      section: row.section || 'default',
      title_template: row.title_template || '',
      valid_from: row.valid_from ?? '',
      valid_to: row.valid_to ?? '',
    })
    setEditing(true)
    setSaved(false)
  }

  const save = async () => {
    if (!form.title_template || !form.valid_from) return
    if (form.matchType === 'tab_key' && !form.tab_key) return
    if (form.matchType === 'tab_group' && !form.tab_group) return

    setSaving(true)
    const payload = {
      competition_id: selectedComp,
      tab_key: form.matchType === 'tab_key' ? form.tab_key : null,
      tab_group: form.matchType === 'tab_group' ? form.tab_group : null,
      section: form.section,
      title_template: form.title_template,
      valid_from: parseInt(form.valid_from),
      valid_to: form.valid_to ? parseInt(form.valid_to) : null,
    }
    try {
      if (selected) {
        const { data } = await api.put(`/tab-titles/${selected.id}`, payload)
        setRows(prev => prev.map(r => r.id === selected.id ? data : r))
        setSelected(data)
      } else {
        const { data } = await api.post('/tab-titles', payload)
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
    if (!confirm(`Delete title override "${row.title_template}"?`)) return
    try {
      await api.delete(`/tab-titles/${row.id}`)
      setRows(prev => prev.filter(r => r.id !== row.id))
      if (selected?.id === row.id) { setEditing(false); setSelected(null) }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  const describeMatch = (row) => row.tab_key
    ? `Tab: ${row.tab_key}`
    : `Tab group: ${row.tab_group} (all matching tabs)`

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Tab Titles</h1>
        <p className={styles.subtitle}>Page-content titles per competition/tab/era — e.g. "Group standings" for UCL pre-2024 vs "League standings" from 2024+</p>
      </div>

      {/* ── 2-column drill-down: Sport / Competition ── */}
      <div className={styles.drilldown}>
        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Sport</div>
          <div className={styles.drillList}>
            {sports.map(sport => (
              <button
                key={sport}
                className={`${styles.drillItem} ${selectedSport === sport ? styles.drillItemActive : ''}`}
                onClick={() => { setSelectedSport(sport); setSelectedComp(''); setCompSearch('') }}
              >
                {sport}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Competition</div>
          {selectedSport && (
            <input
              className={styles.drillSearch}
              placeholder="Search..."
              value={compSearch}
              onChange={e => setCompSearch(e.target.value)}
            />
          )}
          <div className={styles.drillList}>
            {!selectedSport ? (
              <div className={styles.drillEmpty}>Select a sport</div>
            ) : compsForSport.length === 0 ? (
              <div className={styles.drillEmpty}>No match</div>
            ) : compsForSport.map(c => (
              <button
                key={c.id}
                className={`${styles.drillItem} ${selectedComp === String(c.id) ? styles.drillItemActive : ''}`}
                onClick={() => setSelectedComp(String(c.id))}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!selectedComp ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🏷️</span>
          <span>Select a sport and competition to manage its tab titles</span>
        </div>
      ) : (
        <>
          <div className={styles.tableToolbar}>
            <button className={styles.addBtn} onClick={startNew}>+ Add title override</button>
          </div>

          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colMatch}>Matches</span>
              <span className={styles.colSection}>Section</span>
              <span className={styles.colTitleTemplate}>Title</span>
              <span className={styles.colValidFrom}>Valid From</span>
              <span className={styles.colValidTo}>Valid To</span>
              <span className={styles.colActions}></span>
            </div>

            {loadingRows ? (
              <div className={styles.tableEmpty}>Loading...</div>
            ) : rows.length === 0 ? (
              <div className={styles.tableEmpty}>No title overrides yet — this competition uses the default hardcoded titles.</div>
            ) : (
              rows
                .slice()
                .sort((a, b) => b.valid_from - a.valid_from)
                .map(row => (
                  <div key={row.id} className={styles.tableRow}>
                    <span className={styles.colMatch}>{describeMatch(row)}</span>
                    <span className={styles.colSection}>{row.section}</span>
                    <span className={styles.colTitleTemplate}>{row.title_template}</span>
                    <span className={styles.colValidFrom}>{row.valid_from}</span>
                    <span className={styles.colValidTo}>{row.valid_to ?? '—'}</span>
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

      {/* ── Editor (shown only when adding or editing) ── */}
      {editing && (
        <div className={styles.editorOverlay} onClick={() => setEditing(false)}>
          <div className={styles.editor} onClick={e => e.stopPropagation()}>
            <div className={styles.editorHeader}>
              <div>
                <div className={styles.editorTitle}>
                  {selected ? 'Edit title override' : 'New title override'}
                </div>
                <div className={styles.editorMeta}>
                  {selected ? <span className={styles.idBadge}>ID {selected.id}</span> : 'Not saved yet'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
                  onClick={save}
                  disabled={saving || !form.title_template || !form.valid_from || (form.matchType === 'tab_key' ? !form.tab_key : !form.tab_group)}
                >
                  {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
                </button>
                <button className={styles.closeEditorBtn} onClick={() => setEditing(false)}>✕</button>
              </div>
            </div>

            <div className={styles.fieldSection}>
              <div className={styles.fieldSectionTitle}>What this title applies to</div>
              <div className={styles.fieldGrid}>

                <div>
                  <label className={styles.fieldLabel}>Match type</label>
                  <div className={styles.toggleRow}>
                    <button
                      type="button"
                      className={`${styles.toggleBtn} ${form.matchType === 'tab_key' ? styles.toggleActive : ''}`}
                      onClick={() => setForm(p => ({ ...p, matchType: 'tab_key' }))}
                    >
                      One specific tab
                    </button>
                    <button
                      type="button"
                      className={`${styles.toggleBtn} ${form.matchType === 'tab_group' ? styles.toggleActive : ''}`}
                      onClick={() => setForm(p => ({ ...p, matchType: 'tab_group' }))}
                    >
                      Whole tab group
                    </button>
                  </div>
                </div>

                {form.matchType === 'tab_key' ? (
                  <div>
                    <label className={styles.fieldLabel}>Tab</label>
                    <select
                      className={styles.fieldSelect}
                      value={form.tab_key}
                      onChange={e => setForm(p => ({ ...p, tab_key: e.target.value }))}
                    >
                      <option value="">Select tab...</option>
                      {tabOptions.tab_keys.map(t => (
                        <option key={t.tab_key} value={t.tab_key}>{t.tab_name} ({t.tab_key})</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className={styles.fieldLabel}>Tab group</label>
                    <select
                      className={styles.fieldSelect}
                      value={form.tab_group}
                      onChange={e => setForm(p => ({ ...p, tab_group: e.target.value }))}
                    >
                      <option value="">Select tab group...</option>
                      {tabOptions.tab_groups.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className={styles.fieldLabel}>Section</label>
                  <select
                    className={styles.fieldSelect}
                    value={form.section}
                    onChange={e => setForm(p => ({ ...p, section: e.target.value }))}
                  >
                    {SECTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>

              </div>
            </div>

            <div className={styles.fieldSection}>
              <div className={styles.fieldSectionTitle}>Title</div>
              <div className={styles.fieldGrid}>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>
                    Title template
                    {form.matchType === 'tab_group' && <span className={styles.required}> — use {'{group_name}'} for per-group text, e.g. "Standings - {'{group_name}'}"</span>}
                  </label>
                  <input
                    className={styles.fieldInputWide}
                    value={form.title_template}
                    onChange={e => setForm(p => ({ ...p, title_template: e.target.value }))}
                    placeholder={form.matchType === 'tab_group' ? 'Standings - {group_name}' : 'Top Scorers'}
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Valid from (year)</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    value={form.valid_from}
                    onChange={e => setForm(p => ({ ...p, valid_from: e.target.value }))}
                    placeholder="2026"
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Valid to (year, optional)</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    value={form.valid_to}
                    onChange={e => setForm(p => ({ ...p, valid_to: e.target.value }))}
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
