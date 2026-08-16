import { useState, useEffect } from 'react'
import api, { publicApi } from '../api/client'
import styles from './CompetitionLogos.module.css'

const EMPTY_FORM = { official_name: '', title_sponsor: '', partner: '', prize_money: '', start_year: '', end_year: '', allYears: false }

// Same era-versioned pattern as CompetitionLogos.jsx (reuses its exact CSS
// module — identical shape, no need for a second stylesheet). A
// tournament's official name changes as it changes title sponsors — e.g.
// Indian Wells has been "Indian Wells Masters" and "BNP Paribas Open" in
// different eras — so this manages multiple start_year/end_year rows per
// competition instead of a single field (replaces an earlier single-row
// editor on the Competitions page, removed 2026-08-10 — that version could
// only ever represent "the name going forward," never a past sponsor era).
export default function CompetitionNaming() {
  const [competitions, setCompetitions] = useState([])
  const [selectedSport, setSelectedSport] = useState('')
  const [selectedComp, setSelectedComp]   = useState('')
  const [compSearch, setCompSearch]       = useState('')
  const [rows, setRows]                   = useState([])
  const [loadingRows, setLoadingRows]     = useState(false)
  const [selected, setSelected]           = useState(null)
  const [editing, setEditing]             = useState(false)
  const [form, setForm]                   = useState(EMPTY_FORM)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)

  useEffect(() => {
    publicApi.get('/competitions')
      .then(r => setCompetitions(r.data.data))
      .catch(console.error)
  }, [])

  // Deep-link support: Competitions page's "Manage names →" block links
  // here with ?competition_id=X so the drill-down opens pre-scoped instead
  // of making the user re-pick sport + competition from scratch.
  useEffect(() => {
    if (competitions.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const deepLinkId = params.get('competition_id')
    if (!deepLinkId) return
    const match = competitions.find(c => String(c.id) === deepLinkId)
    if (match) {
      setSelectedSport(match.sport_name)
      setSelectedComp(String(match.id))
    }
  }, [competitions])

  const sports = [...new Set(competitions.map(c => c.sport_name).filter(Boolean))].sort()

  const compsForSport = competitions
    .filter(c => c.sport_name === selectedSport)
    .filter(c => !compSearch || c.name.toLowerCase().includes(compSearch.toLowerCase()))

  const selectedCompObj = competitions.find(c => String(c.id) === selectedComp)

  useEffect(() => {
    setSelected(null)
    setEditing(false)
    if (!selectedComp) { setRows([]); return }
    setLoadingRows(true)
    api.get(`/competition-naming?competition_id=${selectedComp}`)
      .then(r => setRows(r.data))
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
      official_name: row.official_name || '',
      title_sponsor: row.title_sponsor || '',
      partner: row.partner || '',
      prize_money: row.prize_money ?? '',
      start_year: row.start_year ?? '',
      end_year: row.end_year ?? '',
      allYears: row.start_year == null,
    })
    setEditing(true)
    setSaved(false)
  }

  const save = async () => {
    if (!form.official_name || (!form.allYears && !form.start_year)) return
    setSaving(true)
    const payload = {
      competition_id: selectedComp,
      official_name: form.official_name,
      title_sponsor: form.title_sponsor || null,
      partner: form.partner || null,
      prize_money: form.prize_money ? parseInt(form.prize_money) : null,
      start_year: form.allYears ? null : parseInt(form.start_year),
      end_year: form.allYears ? null : (form.end_year ? parseInt(form.end_year) : null),
    }
    try {
      if (selected) {
        const { data } = await api.put(`/competition-naming/${selected.id}`, payload)
        setRows(prev => prev.map(r => r.id === selected.id ? data : r))
        setSelected(data)
      } else {
        const { data } = await api.post('/competition-naming', payload)
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
      await api.delete(`/competition-naming/${row.id}`)
      setRows(prev => prev.filter(r => r.id !== row.id))
      if (selected?.id === row.id) { setEditing(false); setSelected(null) }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Tournament Names</h1>
        <p className={styles.subtitle}>Era-specific official name overrides — e.g. Indian Wells' name as sponsors have changed over time. Shown as the page subtitle on the public site for whichever year is being viewed. A competition with no override here shows no subtitle at all.</p>
      </div>

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
          <span>Select a sport and competition to manage its era names</span>
        </div>
      ) : (
        <>
          <div className={styles.tableToolbar}>
            <button className={styles.addBtn} onClick={startNew}>+ Add era name</button>
          </div>

          <div className={styles.table}>
            <div className={styles.tableHeader} style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 160px' }}>
              <span>Official Name</span>
              <span>Title Sponsor</span>
              <span>Start Year</span>
              <span>End Year</span>
              <span></span>
            </div>

            {loadingRows ? (
              <div className={styles.tableEmpty}>Loading...</div>
            ) : rows.length === 0 ? (
              <div className={styles.tableEmpty}>No era overrides yet — this competition shows no name subtitle for any year.</div>
            ) : (
              rows.slice().sort((a, b) => (b.start_year ?? -Infinity) - (a.start_year ?? -Infinity)).map(row => (
                <div key={row.id} className={styles.tableRow} style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 160px' }}>
                  <span>{row.official_name}</span>
                  <span className={styles.colPath}>{row.title_sponsor || '—'}</span>
                  <span className={styles.colStart}>{row.start_year ?? 'All years'}</span>
                  <span className={styles.colEnd}>{row.start_year == null ? '—' : (row.end_year ?? '—')}</span>
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
                  disabled={saving || !form.official_name || (!form.allYears && !form.start_year)}
                >
                  {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
                </button>
                <button className={styles.closeEditorBtn} onClick={() => setEditing(false)}>✕</button>
              </div>
            </div>

            <div className={styles.fieldSection}>
              <div className={styles.fieldGrid}>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Official name</label>
                  <input
                    className={styles.fieldInputWide}
                    value={form.official_name}
                    onChange={e => setForm(p => ({ ...p, official_name: e.target.value }))}
                    placeholder="Indian Wells BNP Paribas Open"
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Title sponsor (optional)</label>
                  <input
                    className={styles.fieldInput}
                    value={form.title_sponsor}
                    onChange={e => setForm(p => ({ ...p, title_sponsor: e.target.value }))}
                    placeholder="BNP Paribas"
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Partner (optional)</label>
                  <input
                    className={styles.fieldInput}
                    value={form.partner}
                    onChange={e => setForm(p => ({ ...p, partner: e.target.value }))}
                    placeholder=""
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Start year</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    value={form.start_year}
                    onChange={e => setForm(p => ({ ...p, start_year: e.target.value }))}
                    placeholder="2006"
                    disabled={form.allYears}
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
                    disabled={form.allYears}
                  />
                </div>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.allYears}
                      onChange={e => setForm(p => ({ ...p, allYears: e.target.checked, start_year: '', end_year: '' }))}
                    />
                    Applies to all years (this name is used for the entire era, no start/end year)
                  </label>
                </div>

              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
