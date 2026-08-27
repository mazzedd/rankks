import { useState, useEffect } from 'react'
import api, { API_ORIGIN } from '../api/client'
import SplitPathInput from '../components/SplitPathInput'
import styles from './CompetitionLogos.module.css'

const EMPTY_FORM = { logo_url: '', start_year: '', end_year: '', is_current: false }

// Same era-versioned pattern as CompetitionLogos.jsx (that page's exact CSS
// module is reused here, not copied — identical shape, no need for a second
// stylesheet), just scoped to entities (clubs/teams) instead of
// competitions. Lets admin record e.g. Seattle SuperSonics' logo for
// 1967-2008 separately from Oklahoma City Thunder's from 2008 on, both
// against the same entity_id (franchise continuity). entities.image_url
// remains the default/fallback for any year with no override here.
export default function EntityLogos() {
  const [clubs, setClubs]                 = useState([])
  const [selectedSport, setSelectedSport] = useState('')
  const [selectedClub, setSelectedClub]   = useState('')
  const [clubSearch, setClubSearch]       = useState('')
  const [rows, setRows]                   = useState([])
  const [loadingRows, setLoadingRows]     = useState(false)
  const [selected, setSelected]           = useState(null)
  const [editing, setEditing]             = useState(false)
  const [form, setForm]                   = useState(EMPTY_FORM)
  const [saving, setSaving]               = useState(false)
  const [saved, setSaved]                 = useState(false)

  useEffect(() => {
    api.get('/clubs')
      .then(r => setClubs(r.data))
      .catch(console.error)
  }, [])

  // Deep-link support: Clubs page's "Manage logos →" block links here with
  // ?entity_id=X so the drill-down opens pre-scoped instead of making the
  // user re-pick sport + club from scratch.
  useEffect(() => {
    if (clubs.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const deepLinkId = params.get('entity_id')
    if (!deepLinkId) return
    const match = clubs.find(c => String(c.id) === deepLinkId)
    if (match) {
      setSelectedSport(match.sport_name)
      setSelectedClub(String(match.id))
    }
  }, [clubs])

  const sports = [...new Set(clubs.map(c => c.sport_name).filter(Boolean))].sort()

  const clubsForSport = clubs
    .filter(c => c.sport_name === selectedSport)
    .filter(c => !clubSearch || (c.canonical_name || '').toLowerCase().includes(clubSearch.toLowerCase()))

  const selectedClubObj = clubs.find(c => String(c.id) === selectedClub)

  useEffect(() => {
    setSelected(null)
    setEditing(false)
    if (!selectedClub) { setRows([]); return }
    setLoadingRows(true)
    api.get(`/entity-logos?entity_id=${selectedClub}`)
      .then(r => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoadingRows(false))
  }, [selectedClub])

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
      entity_id: selectedClub,
      logo_url: form.logo_url,
      start_year: parseInt(form.start_year),
      end_year: form.end_year ? parseInt(form.end_year) : null,
      is_current: form.is_current,
    }
    try {
      if (selected) {
        const { data } = await api.put(`/entity-logos/${selected.id}`, payload)
        setRows(prev => prev.map(r => r.id === selected.id ? data : r))
        setSelected(data)
      } else {
        const { data } = await api.post('/entity-logos', payload)
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
      await api.delete(`/entity-logos/${row.id}`)
      setRows(prev => prev.filter(r => r.id !== row.id))
      if (selected?.id === row.id) { setEditing(false); setSelected(null) }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  const resolveImgSrc = (path) => {
    if (!path) return null
    if (path.startsWith('http')) return path
    const mediaPath = path.startsWith('/media/') ? path : `/media/${path}`
    return `${API_ORIGIN}${mediaPath}`
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Club Logos</h1>
        <p className={styles.subtitle}>Era-specific logo overrides — e.g. Seattle SuperSonics through 2008 vs Oklahoma City Thunder from 2008 on, same franchise entity. The club's default logo (set on the Clubs page) is used for any year with no override here.</p>
      </div>

      <div className={styles.drilldown}>
        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Sport</div>
          <div className={styles.drillList}>
            {sports.map(sport => (
              <button
                key={sport}
                className={`${styles.drillItem} ${selectedSport === sport ? styles.drillItemActive : ''}`}
                onClick={() => { setSelectedSport(sport); setSelectedClub(''); setClubSearch('') }}
              >
                {sport}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Club</div>
          {selectedSport && (
            <input
              className={styles.drillSearch}
              placeholder="Search..."
              value={clubSearch}
              onChange={e => setClubSearch(e.target.value)}
            />
          )}
          <div className={styles.drillList}>
            {!selectedSport ? (
              <div className={styles.drillEmpty}>Select a sport</div>
            ) : clubsForSport.length === 0 ? (
              <div className={styles.drillEmpty}>No match</div>
            ) : clubsForSport.map(c => (
              <button
                key={c.id}
                className={`${styles.drillItem} ${selectedClub === String(c.id) ? styles.drillItemActive : ''}`}
                onClick={() => setSelectedClub(String(c.id))}
              >
                {c.canonical_name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!selectedClub ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🖼️</span>
          <span>Select a sport and club to manage its era logos</span>
        </div>
      ) : (
        <>
          {selectedClubObj?.logo_url && (
            <div className={styles.defaultLogoNote}>
              <img src={resolveImgSrc(selectedClubObj.logo_url)} alt="" className={styles.defaultLogoThumb} />
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
              <div className={styles.tableEmpty}>No era overrides yet — this club uses its default logo for every year.</div>
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
                  <label className={styles.fieldLabel}>
                    Logo path
                    <span style={{ textTransform: 'none', fontWeight: 400, letterSpacing: 'normal', opacity: 0.7 }}> — bare path, no leading "media/" (resolveLogoUrl adds it — a saved "media/..." value 404s as "/media/media/...", found 2026-08-10 on WTA's logo)</span>
                  </label>
                  <SplitPathInput
                    inputClassName={styles.fieldInputWide}
                    value={form.logo_url}
                    onChange={v => setForm(p => ({ ...p, logo_url: v }))}
                    placeholder="logos/clubs/basketball/nba/seattle-supersonics.png"
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
                    placeholder="1967"
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
