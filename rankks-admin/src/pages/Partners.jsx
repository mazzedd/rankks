import { useState, useEffect } from 'react'
import api, { API_ORIGIN } from '../api/client'
import CountrySelect from '../components/CountrySelect'
import SearchSelect from '../components/SearchSelect'
import SplitPathInput from '../components/SplitPathInput'
import styles from './Partners.module.css'

const EMPTY_PARTNER = { name: '', logo_url: '', country_id: '', category_id: '', website: '' }

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'JPY', 'AUD', 'CAD']

// Maps the UI's "kind" radio to the entity_type values that endpoint filters on.
const ENTITY_KIND_TYPES = {
  athlete: 'player,driver,fighter',
  club: 'club,f1_team,motogp_team,tour',
  national_team: 'national_team',
}

// Reverse mapping (subject_entity_type from the API -> UI kind), used when
// opening an existing partnership for edit.
const entityTypeToKind = (entityType) => {
  if (['player', 'driver', 'fighter'].includes(entityType)) return 'athlete'
  if (['club', 'f1_team', 'motogp_team', 'tour'].includes(entityType)) return 'club'
  if (entityType === 'national_team') return 'national_team'
  return 'athlete'
}

// Manufacturer subcategory options, per sport — only relevant when tier =
// "Official manufacturer" AND the subject is an Athlete (Mohamed: "these
// subcategories are only tied to athlete's partnership" — not clubs,
// competitions, or races). Sport is resolved from the picked athlete
// themselves (GET /entities/:id/sport), shown read-only, never picked
// manually.
const MANUFACTURER_OPTIONS_BY_SPORT = {
  Football:   ['Boots', 'Outfit', 'Other'],
  Tennis:     ['Boots', 'Outfit', 'Racket', 'Other'],
  UFC:        ['Outfit', 'Other'],
  Basketball: ['Boots', 'Outfit', 'Other'],
  Racing:     ['Boots', 'Outfit', 'Other'],
}

// DB sports.name -> the bucket keys above.
const DB_SPORT_TO_BUCKET = {
  Football: 'Football',
  Tennis: 'Tennis',
  Basketball: 'Basketball',
  Racing: 'Racing',
  'Moto Racing': 'Racing',
  'Combat Sport': 'UFC',
}

const EMPTY_PARTNERSHIP_FORM = {
  partner_id: '',
  name: '',
  subcategories: [],   // checked standard options, e.g. ['Boots', 'Outfit']
  subcategoryOther: '', // free text — replaces the literal 'Other' entry when non-empty
  subject_kind: 'athlete',
  entity_id: '',
  competition_id: '',
  race_sport: 'f1',
  race_gp_slug: '',
  tier_id: '',
  start_year: '',
  end_year: '',
  value_amount: '',
  value_currency: '',
  displayed_in_name: false,
  notes: '',
}

export default function Partners() {
  const [partners, setPartners]     = useState([])
  const [categories, setCategories] = useState([])
  const [tiers, setTiers]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [collapsed, setCollapsed]   = useState({})

  const [selected, setSelected]   = useState(null) // null = nothing selected, {id:null} = new
  const [form, setForm]           = useState(EMPTY_PARTNER)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)

  const [partnerships, setPartnerships]       = useState([])
  const [loadingPartnerships, setLoadingPartnerships] = useState(false)
  const [editingPS, setEditingPS]             = useState(false)
  const [psForm, setPsForm]                   = useState(EMPTY_PARTNERSHIP_FORM)
  const [editingPSId, setEditingPSId]         = useState(null)
  const [savingPS, setSavingPS]               = useState(false)

  const [entityOptions, setEntityOptions] = useState({}) // { athlete: [...], club: [...], national_team: [...] }
  const [competitions, setCompetitions]   = useState([])
  const [races, setRaces]                 = useState([])
  const [athleteSport, setAthleteSport]   = useState(null) // { sport_name, sport_slug } | null, for the picked athlete
  const [rawSubcategory, setRawSubcategory] = useState([]) // saved subcategory array, held here until the sport resolves so it can be split into standard vs. "Other" checks below

  useEffect(() => {
    api.get('/partners').then(r => setPartners(r.data)).catch(console.error).finally(() => setLoading(false))
    api.get('/partner-categories').then(r => setCategories(r.data)).catch(console.error)
    api.get('/partnership-tiers').then(r => setTiers(r.data)).catch(console.error)
    api.get('/competitions').then(r => setCompetitions(r.data)).catch(console.error)
    api.get('/races').then(r => setRaces(r.data)).catch(console.error)
  }, [])

  // Resolve the picked athlete's sport (read-only display, drives the
  // subcategory options) — only relevant for the athlete subject kind.
  useEffect(() => {
    if (psForm.subject_kind !== 'athlete' || !psForm.entity_id) { setAthleteSport(null); return }
    let cancelled = false
    api.get(`/entities/${psForm.entity_id}/sport`)
      .then(r => { if (!cancelled) setAthleteSport(r.data) })
      .catch(() => { if (!cancelled) setAthleteSport(null) })
    return () => { cancelled = true }
  }, [psForm.subject_kind, psForm.entity_id])

  // Split the raw saved subcategory array into checked-standard vs. "Other"
  // once the sport (and so the standard option list) is known — can't do
  // this synchronously in editPartnership since athleteSport resolves async.
  useEffect(() => {
    if (!rawSubcategory.length) return
    const bucket = DB_SPORT_TO_BUCKET[athleteSport?.sport_name] || ''
    const standardList = (MANUFACTURER_OPTIONS_BY_SPORT[bucket] || []).filter(o => o !== 'Other')
    const std = rawSubcategory.filter(v => standardList.includes(v))
    const other = rawSubcategory.filter(v => !standardList.includes(v))
    setPsForm(p => ({
      ...p,
      subcategories: std,
      otherChecked: other.length > 0,
      subcategoryOther: other.filter(v => v !== 'Other').join(', '),
    }))
  }, [athleteSport, rawSubcategory])

  const loadEntityKind = (kind) => {
    if (entityOptions[kind]) return
    api.get(`/entities?type=${ENTITY_KIND_TYPES[kind]}`)
      .then(r => setEntityOptions(prev => ({ ...prev, [kind]: r.data })))
      .catch(console.error)
  }

  const categoriesAZ = categories.slice().sort((a, b) => a.name.localeCompare(b.name))

  const grouped = partners
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .reduce((acc, p) => {
      const cat = p.category_name || 'Uncategorised'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(p)
      return acc
    }, {})

  const toggleCollapse = key => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  const resolveImgSrc = (path) => {
    if (!path) return null
    if (path.startsWith('http')) return path
    const mediaPath = path.startsWith('/media/') ? path : `/media/${path}`
    return `${API_ORIGIN}${mediaPath}`
  }

  const selectPartner = (p) => {
    setSelected(p)
    setForm({
      name: p.name || '',
      logo_url: p.logo_url || '',
      country_id: p.country_id || '',
      category_id: p.category_id || '',
      website: p.website || '',
    })
    setSaved(false)
    loadPartnerships(p.id)
  }

  const startNewPartner = () => {
    setSelected({ id: null })
    setForm(EMPTY_PARTNER)
    setSaved(false)
    setPartnerships([])
  }

  const loadPartnerships = (partnerId) => {
    setLoadingPartnerships(true)
    api.get(`/partners/${partnerId}/partnerships`)
      .then(r => setPartnerships(r.data))
      .catch(console.error)
      .finally(() => setLoadingPartnerships(false))
  }

  const savePartner = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      if (selected?.id) {
        const { data } = await api.put(`/partners/${selected.id}`, form)
        setPartners(prev => prev.map(p => p.id === data.id ? { ...p, ...data, category_name: categories.find(c => c.id === data.category_id)?.name, country_name: null } : p))
        setSelected(data)
      } else {
        const { data } = await api.post('/partners', form)
        const full = { ...data, category_name: categories.find(c => c.id === data.category_id)?.name, partnership_count: 0 }
        setPartners(prev => [...prev, full])
        setSelected(full)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const deletePartner = async () => {
    if (!selected?.id) return
    if (!confirm(`Delete "${selected.name}"? This removes all ${partnerships.length} partnership(s) linked to it too.`)) return
    try {
      await api.delete(`/partners/${selected.id}`)
      setPartners(prev => prev.filter(p => p.id !== selected.id))
      setSelected(null)
      setPartnerships([])
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  const startNewPartnership = () => {
    setEditingPSId(null)
    setPsForm(EMPTY_PARTNERSHIP_FORM)
    setRawSubcategory([])
    loadEntityKind('athlete')
    setEditingPS(true)
  }

  const editPartnership = (ps) => {
    const kind = ps.subject_type === 'competition' ? 'competition'
      : ps.subject_type === 'race' ? 'race'
      : entityTypeToKind(ps.subject_entity_type)
    if (ps.subject_type === 'entity') loadEntityKind(kind)
    setEditingPSId(ps.id)
    setRawSubcategory(ps.subcategory || [])
    setPsForm({
      partner_id: ps.partner_id || selected.id,
      name: ps.name || '',
      subcategories: [],
      otherChecked: false,
      subcategoryOther: '',
      subject_kind: kind,
      entity_id: ps.entity_id || '',
      competition_id: ps.competition_id || '',
      race_sport: ps.race_sport || 'f1',
      race_gp_slug: ps.race_gp_slug || '',
      tier_id: ps.tier_id || '',
      start_year: ps.start_year ?? '',
      end_year: ps.end_year ?? '',
      value_amount: ps.value_amount ?? '',
      value_currency: ps.value_currency || '',
      displayed_in_name: !!ps.displayed_in_name,
      notes: ps.notes || '',
    })
    setEditingPS(true)
  }

  const savePartnership = async () => {
    const subject_type = psForm.subject_kind === 'competition' ? 'competition'
      : psForm.subject_kind === 'race' ? 'race' : 'entity'

    if (editingPSId && !psForm.partner_id) return alert('Pick a brand')
    if (subject_type === 'entity' && !psForm.entity_id) return alert('Pick who this partnership is with')
    if (subject_type === 'competition' && !psForm.competition_id) return alert('Pick a competition')
    if (subject_type === 'race' && !psForm.race_gp_slug) return alert('Pick a race')
    if (!psForm.tier_id) return alert('Pick a partnership tier')
    if (!psForm.start_year) return alert('Start year is required')

    const isOfficialManufacturerNow = tiers.find(t => String(t.id) === String(psForm.tier_id))?.slug === 'official-manufacturer'
    const needsSubcategory = isOfficialManufacturerNow && subject_type === 'entity' && psForm.subject_kind === 'athlete'
    const subcategoryArray = needsSubcategory
      ? [...psForm.subcategories, ...(psForm.otherChecked ? [psForm.subcategoryOther.trim() || 'Other'] : [])]
      : []
    if (needsSubcategory && subcategoryArray.length === 0) return alert('Pick at least one subcategory')

    const payload = {
      partner_id: psForm.partner_id || selected.id,
      name: psForm.name.trim() || null,
      subcategory: subcategoryArray.length ? subcategoryArray : null,
      subject_type,
      entity_id: subject_type === 'entity' ? psForm.entity_id : null,
      competition_id: subject_type === 'competition' ? psForm.competition_id : null,
      race_sport: subject_type === 'race' ? psForm.race_sport : null,
      race_gp_slug: subject_type === 'race' ? psForm.race_gp_slug : null,
      tier_id: psForm.tier_id,
      start_year: parseInt(psForm.start_year),
      end_year: psForm.end_year ? parseInt(psForm.end_year) : null,
      value_amount: psForm.value_amount ? parseFloat(psForm.value_amount) : null,
      value_currency: psForm.value_amount ? (psForm.value_currency || null) : null,
      displayed_in_name: psForm.displayed_in_name,
      notes: psForm.notes || null,
    }

    setSavingPS(true)
    try {
      if (editingPSId) {
        await api.put(`/partnerships/${editingPSId}`, payload)
      } else {
        await api.post(`/partners/${selected.id}/partnerships`, payload)
      }
      setEditingPS(false)
      loadPartnerships(selected.id)
      // Full refetch (not a local increment) — a reassigned partnership
      // moves its count from the old brand to the new one, which a single
      // "bump selected.id" update can't express correctly.
      api.get('/partners').then(r => setPartners(r.data)).catch(console.error)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSavingPS(false)
    }
  }

  const deletePartnership = async (ps) => {
    if (!confirm(`Delete this partnership (${ps.name ? ps.name + ', ' : ''}${ps.subject_name}, ${ps.tier_name})?`)) return
    try {
      await api.delete(`/partnerships/${ps.id}`)
      setPartnerships(prev => prev.filter(p => p.id !== ps.id))
      api.get('/partners').then(r => setPartners(r.data)).catch(console.error)
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  const racesForSport = races.filter(r => r.sport === psForm.race_sport)

  const isOfficialManufacturer = tiers.find(t => String(t.id) === String(psForm.tier_id))?.slug === 'official-manufacturer'
  const showSubcategory = isOfficialManufacturer && psForm.subject_kind === 'athlete' && psForm.entity_id
  const manufacturerSportBucket = DB_SPORT_TO_BUCKET[athleteSport?.sport_name] || ''
  const standardSubcategoryOptions = (MANUFACTURER_OPTIONS_BY_SPORT[manufacturerSportBucket] || []).filter(o => o !== 'Other')

  const toggleSubcategory = (opt) => setPsForm(p => ({
    ...p,
    subcategories: p.subcategories.includes(opt) ? p.subcategories.filter(v => v !== opt) : [...p.subcategories, opt],
  }))
  const toggleOther = () => setPsForm(p => ({
    ...p, otherChecked: !p.otherChecked, subcategoryOther: p.otherChecked ? '' : p.subcategoryOther,
  }))

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Brands</h1>
        <p className={styles.subtitle}>Partners (brands) and the partnerships that link them to athletes, clubs, national teams, competitions and races.</p>
      </div>

      <div className={styles.layout}>

        {/* ── Sidebar ── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            <input
              className={styles.search}
              placeholder="Search partners..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className={styles.tableToolbar} style={{ padding: '10px 14px 0' }}>
            <button className={styles.addBtn} onClick={startNewPartner}>+ New partner</button>
          </div>

          {loading ? (
            <div className={styles.loading}>Loading...</div>
          ) : (
            <div className={styles.tree}>
              {Object.keys(grouped).sort().map(cat => (
                <div key={cat} className={styles.sportGroup}>
                  <div className={styles.sportHeader} onClick={() => toggleCollapse(cat)}>
                    <span className={styles.chevron}>{collapsed[cat] ? '▶' : '▼'}</span>
                    <span className={styles.sportName}>{cat}</span>
                    <span className={styles.badge}>{grouped[cat].length}</span>
                  </div>
                  {!collapsed[cat] && grouped[cat]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(p => (
                      <div
                        key={p.id}
                        className={`${styles.item} ${selected?.id === p.id ? styles.itemActive : ''}`}
                        onClick={() => selectPartner(p)}
                      >
                        <div className={styles.itemBody}>
                          {p.logo_url && (
                            <img src={resolveImgSrc(p.logo_url)} alt="" className={styles.itemLogo} onError={e => e.target.style.visibility = 'hidden'} />
                          )}
                          <span className={styles.itemName}>{p.name}</span>
                        </div>
                        {p.partnership_count > 0 && <span className={styles.badge}>{p.partnership_count}</span>}
                      </div>
                    ))}
                </div>
              ))}
              {Object.keys(grouped).length === 0 && <div className={styles.loading}>No partners yet</div>}
            </div>
          )}
        </div>

        {/* ── Editor ── */}
        {!selected ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>🤝</span>
            <span>Select a partner, or create a new one</span>
          </div>
        ) : (
          <div>
            <div className={styles.editor}>
              <div className={styles.editorHeader}>
                <div>
                  <div className={styles.editorTitle}>{selected.id ? selected.name : 'New partner'}</div>
                  <div className={styles.editorMeta}>
                    {selected.id ? <span className={styles.idBadge}>ID {selected.id}</span> : 'Not saved yet'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`${styles.saveBtn} ${saved ? styles.saved : ''}`} onClick={savePartner} disabled={saving || !form.name.trim()}>
                    {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
                  </button>
                  {selected.id && (
                    <button className={styles.rowActionBtnDelete} onClick={deletePartner}>Delete</button>
                  )}
                </div>
              </div>

              <div className={styles.fieldGrid}>
                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Name</label>
                  <input
                    className={styles.fieldInput}
                    value={form.name}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="BMW"
                  />
                </div>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Logo path</label>
                  <SplitPathInput
                    inputClassName={styles.fieldInputWide}
                    value={form.logo_url}
                    onChange={v => setForm(p => ({ ...p, logo_url: v }))}
                    placeholder="logos/partners/bmw.png"
                  />
                  {form.logo_url && (
                    <div className={styles.previewWrap}>
                      <img src={resolveImgSrc(form.logo_url)} alt="" className={styles.previewImg} onError={e => e.target.style.visibility = 'hidden'} />
                    </div>
                  )}
                </div>

                <div>
                  <label className={styles.fieldLabel}>Country</label>
                  <CountrySelect value={form.country_id} onChange={id => setForm(p => ({ ...p, country_id: id }))} />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Category</label>
                  <SearchSelect
                    value={form.category_id}
                    onChange={id => setForm(p => ({ ...p, category_id: id }))}
                    options={categoriesAZ}
                    getLabel={c => c.name}
                    placeholder="Select category..."
                  />
                </div>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Website</label>
                  <input
                    className={styles.fieldInputWide}
                    value={form.website}
                    onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
                    placeholder="bmw.com"
                  />
                </div>
              </div>
            </div>

            {selected.id && (
              <div style={{ marginTop: 20 }}>
                <div className={styles.tableToolbar}>
                  <button className={styles.addBtn} onClick={startNewPartnership}>+ Add partnership</button>
                </div>

                <div className={styles.table}>
                  <div className={styles.psTableHeader}>
                    <span>Name</span>
                    <span>Subject</span>
                    <span>Tier</span>
                    <span>Years</span>
                    <span>Value</span>
                    <span>In name</span>
                    <span></span>
                  </div>

                  {loadingPartnerships ? (
                    <div className={styles.tableEmpty}>Loading...</div>
                  ) : partnerships.length === 0 ? (
                    <div className={styles.tableEmpty}>No partnerships yet for this brand.</div>
                  ) : partnerships.map(ps => (
                    <div key={ps.id} className={styles.psTableRow}>
                      <span>{ps.name || '—'}</span>
                      <span>
                        {ps.subject_name || '—'}
                        <span className={styles.subjectKind}> · {ps.subject_type}</span>
                      </span>
                      <span>{ps.tier_name}</span>
                      <span>{ps.start_year}–{ps.end_year ?? 'Today'}</span>
                      <span>{ps.value_amount ? `${Number(ps.value_amount).toLocaleString()} ${ps.value_currency || ''}` : '—'}</span>
                      <span>{ps.displayed_in_name ? '✓' : ''}</span>
                      <span className={styles.colActions}>
                        <button className={styles.rowActionBtn} onClick={() => editPartnership(ps)}>Edit</button>
                        <button className={styles.rowActionBtnDelete} onClick={() => deletePartnership(ps)}>Delete</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {editingPS && (
        <div className={styles.editorOverlay} onClick={() => setEditingPS(false)}>
          <div className={styles.editor} onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '100%' }}>
            <div className={styles.editorHeader}>
              <div className={styles.editorTitle}>{editingPSId ? 'Edit partnership' : 'New partnership'}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className={styles.saveBtn} onClick={savePartnership} disabled={savingPS}>
                  {savingPS ? 'Saving...' : 'Save'}
                </button>
                <button className={styles.closeEditorBtn} onClick={() => setEditingPS(false)}>✕</button>
              </div>
            </div>

            <div className={styles.fieldGrid}>
              {editingPSId && (
                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Brand</label>
                  <SearchSelect
                    value={psForm.partner_id}
                    onChange={id => setPsForm(p => ({ ...p, partner_id: id }))}
                    options={partners}
                    getLabel={p => p.name}
                    placeholder="Select brand..."
                    allowClear={false}
                  />
                </div>
              )}

              <div className={styles.fieldWide}>
                <label className={styles.fieldLabel}>Name</label>
                <input
                  className={styles.fieldInput}
                  value={psForm.name}
                  onChange={e => setPsForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Official Ball Supplier"
                />
              </div>

              <div className={styles.fieldWide}>
                <label className={styles.fieldLabel}>Linked to</label>
                <div className={styles.toggleRow}>
                  {['athlete', 'club', 'national_team', 'competition', 'race'].map(kind => (
                    <button
                      key={kind}
                      type="button"
                      className={`${styles.toggleBtn} ${psForm.subject_kind === kind ? styles.toggleActive : ''}`}
                      onClick={() => { setPsForm(p => ({ ...p, subject_kind: kind })); if (kind !== 'competition' && kind !== 'race') loadEntityKind(kind) }}
                    >
                      {kind === 'national_team' ? 'National Team' : kind[0].toUpperCase() + kind.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.fieldWide}>
                <label className={styles.fieldLabel}>
                  {psForm.subject_kind === 'competition' ? 'Competition' : psForm.subject_kind === 'race' ? 'Race' : 'Who'}
                </label>

                {psForm.subject_kind === 'competition' && (
                  <SearchSelect
                    value={psForm.competition_id}
                    onChange={id => setPsForm(p => ({ ...p, competition_id: id }))}
                    options={competitions}
                    getLabel={c => c.name}
                    getSublabel={c => c.sport_name}
                    placeholder="Select competition..."
                  />
                )}

                {psForm.subject_kind === 'race' && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <select
                      className={styles.fieldInput}
                      style={{ width: 120, flexShrink: 0 }}
                      value={psForm.race_sport}
                      onChange={e => setPsForm(p => ({ ...p, race_sport: e.target.value, race_gp_slug: '' }))}
                    >
                      <option value="f1">F1</option>
                      <option value="motogp">MotoGP</option>
                    </select>
                    <div style={{ flex: 1 }}>
                      <SearchSelect
                        value={psForm.race_gp_slug}
                        onChange={slug => setPsForm(p => ({ ...p, race_gp_slug: slug }))}
                        options={racesForSport.map(r => ({ id: r.slug, name: r.name }))}
                        getLabel={r => r.name}
                        placeholder="Select race..."
                      />
                    </div>
                  </div>
                )}

                {['athlete', 'club', 'national_team'].includes(psForm.subject_kind) && (
                  <SearchSelect
                    value={psForm.entity_id}
                    onChange={id => setPsForm(p => ({ ...p, entity_id: id }))}
                    options={entityOptions[psForm.subject_kind] || []}
                    getLabel={e => e.name}
                    placeholder={(entityOptions[psForm.subject_kind] ? 'Select...' : 'Loading...')}
                  />
                )}
              </div>

              <div className={styles.fieldWide}>
                <label className={styles.fieldLabel}>Tier</label>
                <SearchSelect
                  value={psForm.tier_id}
                  onChange={id => setPsForm(p => ({ ...p, tier_id: id }))}
                  options={tiers}
                  getLabel={t => t.name}
                  placeholder="Select tier..."
                  allowClear={false}
                />
              </div>

              {showSubcategory && (
                <>
                  <div>
                    <label className={styles.fieldLabel}>Sport</label>
                    <input className={styles.fieldInput} value={athleteSport?.sport_name || 'Resolving...'} disabled />
                  </div>
                  <div className={styles.fieldWide}>
                    <label className={styles.fieldLabel}>Subcategory (select one or more)</label>
                    <div className={styles.toggleRow}>
                      {standardSubcategoryOptions.map(opt => (
                        <button
                          key={opt}
                          type="button"
                          className={`${styles.toggleBtn} ${psForm.subcategories.includes(opt) ? styles.toggleActive : ''}`}
                          onClick={() => toggleSubcategory(opt)}
                          disabled={!manufacturerSportBucket}
                        >
                          {opt}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`${styles.toggleBtn} ${psForm.otherChecked ? styles.toggleActive : ''}`}
                        onClick={toggleOther}
                        disabled={!manufacturerSportBucket}
                      >
                        Other
                      </button>
                    </div>
                    {psForm.otherChecked && (
                      <input
                        className={styles.fieldInputWide}
                        style={{ marginTop: 8 }}
                        value={psForm.subcategoryOther}
                        onChange={e => setPsForm(p => ({ ...p, subcategoryOther: e.target.value }))}
                        placeholder="Specify..."
                      />
                    )}
                  </div>
                </>
              )}

              <div>
                <label className={styles.fieldLabel}>Start year</label>
                <input
                  className={styles.fieldInput}
                  type="number"
                  value={psForm.start_year}
                  onChange={e => setPsForm(p => ({ ...p, start_year: e.target.value }))}
                  placeholder="2024"
                />
              </div>

              <div>
                <label className={styles.fieldLabel}>End year (blank = ongoing)</label>
                <input
                  className={styles.fieldInput}
                  type="number"
                  value={psForm.end_year}
                  onChange={e => setPsForm(p => ({ ...p, end_year: e.target.value }))}
                  placeholder="Today"
                />
              </div>

              <div>
                <label className={styles.fieldLabel}>Value</label>
                <input
                  className={styles.fieldInput}
                  type="number"
                  value={psForm.value_amount}
                  onChange={e => setPsForm(p => ({ ...p, value_amount: e.target.value }))}
                  placeholder="1500000"
                />
              </div>

              <div>
                <label className={styles.fieldLabel}>Currency</label>
                <select
                  className={styles.fieldInput}
                  value={psForm.value_currency}
                  onChange={e => setPsForm(p => ({ ...p, value_currency: e.target.value }))}
                >
                  <option value="">—</option>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div className={styles.fieldWide}>
                <label className={styles.fieldLabel} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={psForm.displayed_in_name}
                    onChange={e => setPsForm(p => ({ ...p, displayed_in_name: e.target.checked }))}
                  />
                  Displayed in the official name (e.g. "BMW Australian Grand Prix", "Ligue 1 Uber Eats")
                </label>
              </div>

              <div className={styles.fieldWide}>
                <label className={styles.fieldLabel}>Notes</label>
                <textarea
                  className={styles.fieldInputWide}
                  rows={2}
                  value={psForm.notes}
                  onChange={e => setPsForm(p => ({ ...p, notes: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
