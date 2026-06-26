import { useState, useEffect } from 'react'
import { HexColorPicker } from 'react-colorful'
import api, { publicApi } from '../api/client'
import BannerPreview from '../components/BannerPreview'
import styles from './Competitions.module.css'

const CATEGORY_MAP = {
  'Grand Slam':                  { label: 'Grand Slam',     order: 1 },
  'ATP World Tour Masters 1000': { label: 'Masters 1000',   order: 2 },
  'ATP World Tour Masters 500':  { label: 'ATP 500',        order: 3 },
  'ATP World Tour Masters 250':  { label: 'ATP 250',        order: 4 },
  'ATP Challenger Tour':         { label: 'ATP Challenger', order: 5 },
  'WTA 1000':                    { label: 'WTA 1000',       order: 6 },
  'WTA 500':                     { label: 'WTA 500',        order: 7 },
  'WTA 250':                     { label: 'WTA 250',        order: 8 },
  'WTA 125':                     { label: 'WTA 125',        order: 9 },
}

const getCatLabel = name => CATEGORY_MAP[name]?.label || name
const getCatOrder = name => CATEGORY_MAP[name]?.order ?? 99

const SURFACE_COLORS = {
  Grass: '#2d6a3f',
  Clay:  '#b5541a',
  Hard:  '#1a4a8a',
}

const SURFACE_LABELS = {
  grass: 'Grass',
  clay:  'Clay',
  hard:  'Hard',
}

// ── Year options ─────────────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear()
const FOUNDING_YEARS = Array.from({ length: CURRENT_YEAR - 1849 }, (_, i) => CURRENT_YEAR - i)

export default function Competitions() {
  const [items, setItems]               = useState([])
  const [loading, setLoading]           = useState(true)
  const [selected, setSelected]         = useState(null)
  const [editing, setEditing]           = useState(null)
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [activePicker, setActivePicker] = useState(null)
  const [search, setSearch]             = useState('')
  const [collapsed, setCollapsed]       = useState({})

  useEffect(() => {
    publicApi.get('/competitions')
      .then(r => setItems(r.data?.data ?? r.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const grouped = items
    .filter(i => !search || (i.name || i.slug || '').toLowerCase().includes(search.toLowerCase()))
    .reduce((acc, item) => {
      const sport    = item.sport_name    || 'Other'
      const category = item.category_name || 'Other'
      if (!acc[sport]) acc[sport] = {}
      if (!acc[sport][category]) acc[sport][category] = []
      acc[sport][category].push(item)
      return acc
    }, {})

  const toggleCollapse = key =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  const select = async item => {
    // Set editing from list item immediately so editor stays visible
    setSelected(item)
    setEditing({
      primary_color:      item.primary_color      || '#1a1a2e',
      secondary_color:    item.secondary_color    || '#2a2a4e',
      third_color:        item.third_color        || '',
      surface:            item.surface            || '',
      founding_year:      item.founding_year      || '',
      cancelled_editions: item.cancelled_editions || [],
      logo_url:           item.logo_url           || '',
    })
    setActivePicker(null)
    setSaved(false)
    // Then fetch full detail to get cancelled_editions
    try {
      const { data } = await publicApi.get(`/competitions/${item.slug}`)
      const full = data.data ?? data
      setSelected(full)
      setEditing({
        primary_color:      full.primary_color      || '#1a1a2e',
        secondary_color:    full.secondary_color    || '#2a2a4e',
        third_color:        full.third_color        || '',
        surface:            full.surface            || '',
        founding_year:      full.founding_year      || '',
        cancelled_editions: full.cancelled_editions || [],
        logo_url:           full.logo_url           || '',
      })
    } catch (err) {
      console.error('Failed to load competition detail', err)
    }
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const { data } = await publicApi.put(`/competitions/${selected.id}`, editing)
      setItems(prev => prev.map(i => i.id === selected.id ? { ...i, ...data } : i))
      setSelected(prev => ({ ...prev, ...data }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const surfaceLabel = SURFACE_LABELS[editing?.surface?.toLowerCase()] || editing?.surface || ''
  const surfaceColor = SURFACE_COLORS[surfaceLabel] || '#333'

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Competitions</h1>
        <p className={styles.subtitle}>Manage colours for tournaments and leagues</p>
      </div>

      <div className={styles.layout}>

        {/* ── Grouped sidebar ── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            <input
              className={styles.search}
              placeholder="Search competitions..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {loading
            ? <div className={styles.loading}>Loading...</div>
            : (
              <div className={styles.tree}>
                {Object.keys(grouped).sort().map(sport => (
                  <div key={sport} className={styles.sportGroup}>

                    <div
                      className={styles.sportHeader}
                      onClick={() => toggleCollapse(`s-${sport}`)}
                    >
                      <span className={styles.chevron}>
                        {collapsed[`s-${sport}`] ? '▶' : '▼'}
                      </span>
                      <span className={styles.sportName}>{sport}</span>
                      <span className={styles.badge}>
                        {Object.values(grouped[sport]).flat().length}
                      </span>
                    </div>

                    {!collapsed[`s-${sport}`] && Object.keys(grouped[sport])
                      .sort((a, b) => getCatOrder(a) - getCatOrder(b))
                      .map(cat => (
                      <div key={cat} className={styles.catGroup}>

                        <div
                          className={styles.catHeader}
                          onClick={() => toggleCollapse(`c-${sport}-${cat}`)}
                        >
                          <span className={styles.chevron}>
                            {collapsed[`c-${sport}-${cat}`] ? '▶' : '▼'}
                          </span>
                          <span className={styles.catName}>{getCatLabel(cat)}</span>
                          <span className={styles.badge}>
                            {grouped[sport][cat].length}
                          </span>
                        </div>

                        {!collapsed[`c-${sport}-${cat}`] &&
                          [...grouped[sport][cat]]
                            .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                            .map(item => (
                              <div
                                key={item.id}
                                className={`${styles.item} ${selected?.id === item.id ? styles.itemActive : ''}`}
                                onClick={() => select(item)}
                              >
                                <div className={styles.dots}>
                                  <span className={styles.dot} style={{ background: item.primary_color   || '#444' }} />
                                  <span className={styles.dot} style={{ background: item.secondary_color || '#444' }} />
                                </div>
                                <div className={styles.itemBody}>
                                  <span className={styles.itemName}>{item.name || item.slug}</span>
                                  {item.surface && (
                                    <span
                                      className={styles.surfacePill}
                                      style={{ background: SURFACE_COLORS[SURFACE_LABELS[item.surface?.toLowerCase()]] || '#555' }}
                                    >
                                      {item.surface}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))
                        }
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )
          }
        </div>

        {/* ── Editor ── */}
        {selected && editing ? (
          <div className={styles.editor}>
            <div className={styles.editorHeader}>
              <div>
                <div className={styles.editorTitle}>{selected.name || selected.slug}</div>
                <div className={styles.editorMeta}>
                  {selected.sport_name}
                  {selected.category_name && <> · {selected.category_name}</>}
                  {surfaceLabel && (
                    <span className={styles.surfaceBadge} style={{ background: surfaceColor }}>
                      {surfaceLabel}
                    </span>
                  )}
                  <span className={styles.idBadge}>ID {selected.id}</span>
                </div>
              </div>
              <button
                className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
              </button>
            </div>

            {/* ── Logo ── */}
            <div className={styles.colorSection}>
              <div className={styles.colorSectionTitle}>Logo</div>
              <div className={styles.logoRow}>
                <div className={styles.infoField}>
                  <label className={styles.infoLabel}>Logo path</label>
                  <input
                    className={styles.infoInput}
                    value={editing.logo_url || ''}
                    onChange={e => setEditing(p => ({ ...p, logo_url: e.target.value }))}
                    placeholder="/media/logos/competitions/ligue1.png"
                  />
                </div>
                {editing.logo_url && (
                  <div className={styles.logoPreview}>
                    <img
                      src={editing.logo_url}
                      alt="Logo preview"
                      className={styles.logoPreviewImg}
                      onError={e => { e.target.style.display = 'none' }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ── Tournament info ── */}
            <div className={styles.colorSection}>
              <div className={styles.colorSectionTitle}>Tournament info</div>
              <div className={styles.infoGrid}>
                <div className={styles.infoField}>
                  <label className={styles.infoLabel}>Founded in</label>
                  <div className={styles.yearRow}>
                    <input
                      className={styles.infoInput}
                      type="number"
                      min="1850"
                      max="2100"
                      value={editing.founding_year || ''}
                      onChange={e => setEditing(p => ({ ...p, founding_year: e.target.value ? parseInt(e.target.value) : '' }))}
                      placeholder="e.g. 1877"
                    />
                    <select
                      className={styles.yearSelect}
                      value={editing.founding_year || ''}
                      onChange={e => setEditing(p => ({ ...p, founding_year: e.target.value ? parseInt(e.target.value) : '' }))}
                    >
                      <option value="">— Pick —</option>
                      {FOUNDING_YEARS.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

{/* ── Cancelled editions ── */}
<div className={styles.colorSection}>
  <div className={styles.colorSectionTitle}>Cancelled editions</div>
  <div className={styles.cancelledWrap}>

    {/* Existing entries */}
    <div className={styles.cancelledList}>
      {(editing.cancelled_editions || []).length === 0 && (
        <span className={styles.cancelledEmpty}>No cancelled editions</span>
      )}
      {(editing.cancelled_editions || [])
        .slice()
        .sort((a, b) => a.year - b.year)
        .map(entry => (
          <div key={entry.year} className={styles.cancelledRow}>
            <span className={styles.cancelledYear}>{entry.year}</span>
            <input
              className={styles.cancelledReason}
              value={entry.reason || ''}
              placeholder="Reason (e.g. WWI, COVID)"
              onChange={e => {
                const val = e.target.value
                setEditing(p => ({
                  ...p,
                  cancelled_editions: p.cancelled_editions.map(x =>
                    x.year === entry.year ? { ...x, reason: val } : x
                  )
                }))
              }}
            />
            <button
              className={styles.cancelledRemove}
              onClick={() => setEditing(p => ({
                ...p,
                cancelled_editions: p.cancelled_editions.filter(x => x.year !== entry.year)
              }))}
            >×</button>
          </div>
        ))
      }
    </div>

    {/* Add year */}
    <div className={styles.cancelledAdd}>
      <select
        className={styles.yearSelect}
        defaultValue=""
        onChange={e => {
          const y = parseInt(e.target.value)
          if (!y) return
          setEditing(p => {
            if ((p.cancelled_editions || []).find(x => x.year === y)) return p
            return {
              ...p,
              cancelled_editions: [...(p.cancelled_editions || []), { year: y, reason: '' }]
                .sort((a, b) => a.year - b.year)
            }
          })
          e.target.value = ''
        }}
      >
        <option value="">+ Add year</option>
        {FOUNDING_YEARS
          .filter(y => !(editing.cancelled_editions || []).find(x => x.year === y))
          .map(y => <option key={y} value={y}>{y}</option>)
        }
      </select>
    </div>
  </div>
</div>

            {/* ── Surface ── */}
            <div className={styles.colorSection}>
              <div className={styles.colorSectionTitle}>Surface</div>
              <select
                className={styles.surfaceSelect}
                value={editing.surface || ''}
                onChange={e => setEditing(p => ({ ...p, surface: e.target.value }))}
              >
                <option value="">— Not set —</option>
                <option value="grass">Grass</option>
                <option value="clay">Clay</option>
                <option value="hard">Hard</option>
              </select>
            </div>

            {/* ── Colour scheme ── */}
            <div className={styles.colorSection}>
              <div className={styles.colorSectionTitle}>Colour scheme</div>
              <div className={styles.colorGrid}>
                {[
                  { key: 'primary_color',   label: 'Primary' },
                  { key: 'secondary_color', label: 'Secondary' },
                  { key: 'third_color',     label: 'Third (optional)' },
                ].map(({ key, label }) => (
                  <div key={key} className={styles.colorCol}>
                    <div className={styles.colorLabel}>{label}</div>
                    <div className={styles.colorRow}>
                      <div
                        className={styles.swatch}
                        style={{ background: editing[key] || '#2a2a2a' }}
                        onClick={() => setActivePicker(activePicker === key ? null : key)}
                      />
                      <input
                        className={styles.colorInput}
                        value={editing[key] || ''}
                        onChange={e => setEditing(p => ({ ...p, [key]: e.target.value }))}
                        placeholder="#000000"
                        maxLength={7}
                      />
                    </div>
                    {activePicker === key && (
                      <div className={styles.picker}>
                        <HexColorPicker
                          color={editing[key] || '#000000'}
                          onChange={c => setEditing(p => ({ ...p, [key]: c }))}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── Live Preview ── */}
            <div className={styles.previewSection}>
              <div className={styles.previewLabel}>Live Preview</div>
              <BannerPreview
                name={selected.name || selected.slug}
                category={selected.category_name || selected.sport_name || ''}
                surface={surfaceLabel}
                primary={editing.primary_color}
                secondary={editing.secondary_color}
                third={editing.third_color}
              />
            </div>
          </div>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>🏆</span>
            <span>Select a competition to edit</span>
          </div>
        )}
      </div>
    </div>
  )
}
