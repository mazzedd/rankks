import { useState, useEffect } from 'react'
import api, { publicApi, API_ORIGIN } from '../api/client'
import styles from './CompetitionLogos.module.css'

const EMPTY_FORM = { logo_url: '', start_year: '', end_year: '', is_current: false }

export default function CompetitionLogos() {
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

  // Deep-link support: Competitions page's "Manage logos →" block links here
  // with ?competition_id=X so the drill-down opens pre-scoped instead of
  // making the user re-pick sport + competition from scratch.
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
    api.get(`/competition-logos?competition_id=${selectedComp}`)
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
      logo_url: row.logo_url || '',
      start_year: row.start_year ?? '',
      end_year: row.end_year ?? '',
      is_current: !!row.is_current,
    })
    setEditing(true)
    setSaved(false)
  }

  const save = async () => {
    if (!form.logo_url || !form.start_year) return
    setSaving(true)
    const payload = {
      competition_id: selectedComp,
      logo_url: form.logo_url,
      start_year: parseInt(form.start_year),
      end_year: form.end_year ? parseInt(form.end_year) : null,
      is_current: form.is_current,
    }
    try {
      if (selected) {
        const { data } = await api.put(`/competition-logos/${selected.id}`, payload)
        setRows(prev => prev.map(r => r.id === selected.id ? data : r))
        setSelected(data)
      } else {
        const { data } = await api.post('/competition-logos', payload)
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
    if (!confirm(`Delete this logo override (${row.start_year}${row.end_year ? '–' + row.end_year : '–ongoing'})?`)) return
    try {
      await api.delete(`/competition-logos/${row.id}`)
      setRows(prev => prev.filter(r => r.id !== row.id))
      if (selected?.id === row.id) { setEditing(false); setSelected(null) }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  const resolveImgSrc = (path) => {
    if (!path) return null
    return path.startsWith('http') ? path : `${API_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Competition Logos</h1>
        <p className={styles.subtitle}>Era-specific logo overrides — e.g. FIFA World Cup 2026 vs 2022's different design. The competition's default logo (set on the Competitions page) is used for any year with no override here.</p>
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
          <span className={styles.emptyIcon}>🖼️</span>
          <span>Select a sport and competition to manage its era logos</span>
        </div>
      ) : (
        <>
          {selectedCompObj?.logo_url && (
            <div className={styles.defaultLogoNote}>
              <img src={resolveImgSrc(selectedCompObj.logo_url)} alt="" className={styles.defaultLogoThumb} />
              <span>Default logo (used when no era override applies below)</span>
            </div>
          )}

          <div className={styles.tableToolbar}>
            <button className={styles.addBtn} onClick={startNew}>+ Add era logo</button>
          </div>

          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colLogo}>Logo</span>
              <span className={styles.colPath}>Path</span>
              <span className={styles.colStart}>Start Year</span>
              <span className={styles.colEnd}>End Year</span>
              <span className={styles.colCurrent}>Current</span>
              <span className={styles.colActions}></span>
            </div>

            {loadingRows ? (
              <div className={styles.tableEmpty}>Loading...</div>
            ) : rows.length === 0 ? (
              <div className={styles.tableEmpty}>No era overrides yet — this competition uses its default logo for every year.</div>
            ) : (
              rows.slice().sort((a, b) => b.start_year - a.start_year).map(row => (
                <div key={row.id} className={styles.tableRow}>
                  <span className={styles.colLogo}>
                    <img src={resolveImgSrc(row.logo_url)} alt="" className={styles.rowThumb} onError={e => e.target.style.visibility = 'hidden'} />
                  </span>
                  <span className={styles.colPath}>{row.logo_url}</span>
                  <span className={styles.colStart}>{row.start_year}</span>
                  <span className={styles.colEnd}>{row.end_year ?? '—'}</span>
                  <span className={styles.colCurrent}>{row.is_current ? '✓' : ''}</span>
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
                  {selected ? 'Edit era logo' : 'New era logo'}
                </div>
                <div className={styles.editorMeta}>
                  {selected ? <span className={styles.idBadge}>ID {selected.id}</span> : 'Not saved yet'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
                  onClick={save}
                  disabled={saving || !form.logo_url || !form.start_year}
                >
                  {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
                </button>
                <button className={styles.closeEditorBtn} onClick={() => setEditing(false)}>✕</button>
              </div>
            </div>

            <div className={styles.fieldSection}>
              <div className={styles.fieldGrid}>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Logo path</label>
                  <input
                    className={styles.fieldInputWide}
                    value={form.logo_url}
                    onChange={e => setForm(p => ({ ...p, logo_url: e.target.value }))}
                    placeholder="/media/logos/competitions/football/international/fifa-world-cup-2026.png"
                  />
                  {form.logo_url && (
                    <div className={styles.previewWrap}>
                      <img src={resolveImgSrc(form.logo_url)} alt="" className={styles.previewImg} onError={e => e.target.style.visibility = 'hidden'} />
                    </div>
                  )}
                </div>

                <div>
                  <label className={styles.fieldLabel}>Start year</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    value={form.start_year}
                    onChange={e => setForm(p => ({ ...p, start_year: e.target.value }))}
                    placeholder="2026"
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

                <div>
                  <label className={styles.fieldLabel}>Current</label>
                  <div className={styles.toggleRow}>
                    <button
                      type="button"
                      className={`${styles.toggleBtn} ${form.is_current ? styles.toggleActive : ''}`}
                      onClick={() => setForm(p => ({ ...p, is_current: !p.is_current }))}
                    >
                      {form.is_current ? '✓ Marked current' : 'Mark as current'}
                    </button>
                  </div>
                </div>

              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}
