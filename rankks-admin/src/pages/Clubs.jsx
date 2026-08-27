import { useState, useEffect } from 'react'
import { HexColorPicker } from 'react-colorful'
import api from '../api/client'
import BannerPreview from '../components/BannerPreview'
import CountrySelect from '../components/CountrySelect'
import SplitPathInput, { dirOf } from '../components/SplitPathInput'
import styles from './Clubs.module.css'

const CURRENT_YEAR = new Date().getFullYear()
const FOUNDING_YEARS = Array.from({ length: CURRENT_YEAR - 1849 }, (_, i) => CURRENT_YEAR - i)

export default function Clubs() {
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
    api.get('/clubs')
      .then(r => setItems(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const grouped = items
    .filter(i => !search || (i.canonical_name || '').toLowerCase().includes(search.toLowerCase()))
    .reduce((acc, item) => {
      const sport   = item.sport_name    || 'Other'
      const country = item.country_name  || 'Other'
      if (!acc[sport]) acc[sport] = {}
      if (!acc[sport][country]) acc[sport][country] = []
      acc[sport][country].push(item)
      return acc
    }, {})

  const toggleCollapse = key =>
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  const select = item => {
    setSelected(item)
    setEditing({
      primary_color:   item.primary_color   || '#1a1a2e',
      secondary_color: item.secondary_color || '#2a2a4e',
      third_color:     item.third_color     || '',
      founded_year:    item.founded_year    || '',
      logo_url:        item.logo_url        || '',
      sidebar_logo_url: item.sidebar_logo_url || '',
      country_id:      item.country_id      || '',
    })
    setActivePicker(null)
    setSaved(false)
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const { data } = await api.put(`/clubs/${selected.id}`, editing)
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

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Clubs</h1>
        <p className={styles.subtitle}>Manage colours and info for football clubs</p>
      </div>

      <div className={styles.layout}>

        {/* ── Sidebar ── */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            <input
              className={styles.search}
              placeholder="Search clubs..."
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
                      .sort()
                      .map(country => (
                        <div key={country} className={styles.catGroup}>

                          <div
                            className={styles.catHeader}
                            onClick={() => toggleCollapse(`c-${sport}-${country}`)}
                          >
                            <span className={styles.chevron}>
                              {collapsed[`c-${sport}-${country}`] ? '▶' : '▼'}
                            </span>
                            <span className={styles.catName}>{country}</span>
                            <span className={styles.badge}>
                              {grouped[sport][country].length}
                            </span>
                          </div>

                          {!collapsed[`c-${sport}-${country}`] &&
                            [...grouped[sport][country]]
                              .sort((a, b) => (a.canonical_name || '').localeCompare(b.canonical_name || ''))
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
                                    {item.logo_url
                                      ? <img
                                          src={`/media/${item.logo_url}`}
                                          alt=""
                                          className={styles.itemLogo}
                                          onError={e => e.target.style.display = 'none'}
                                        />
                                      : null
                                    }
                                    <span className={styles.itemName}>{item.canonical_name}</span>
                                  </div>
                                </div>
                              ))
                          }
                        </div>
                      ))
                    }
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
                <div className={styles.editorTitle}>{selected.canonical_name}</div>
                <div className={styles.editorMeta}>
                  {selected.sport_name}
                  {selected.country_name && <> · {selected.country_name}</>}
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

            {/* ── Club info ── */}
            <div className={styles.colorSection}>
              <div className={styles.colorSectionTitle}>Club info</div>
              <div className={styles.infoGrid}>

                <div className={styles.infoField}>
                  <label className={styles.infoLabel}>Founded in</label>
                  <div className={styles.yearRow}>
                    <input
                      className={styles.infoInput}
                      type="number"
                      min="1850"
                      max="2100"
                      value={editing.founded_year || ''}
                      onChange={e => setEditing(p => ({ ...p, founded_year: e.target.value ? parseInt(e.target.value) : '' }))}
                      placeholder="e.g. 1904"
                    />
                    <select
                      className={styles.yearSelect}
                      value={editing.founded_year || ''}
                      onChange={e => setEditing(p => ({ ...p, founded_year: e.target.value ? parseInt(e.target.value) : '' }))}
                    >
                      <option value="">— Pick —</option>
                      {FOUNDING_YEARS.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.infoField}>
                  <label className={styles.infoLabel}>Country</label>
                  <CountrySelect
                    value={editing.country_id}
                    onChange={id => setEditing(p => ({ ...p, country_id: id }))}
                  />
                </div>

                <div className={`${styles.infoField} ${styles.infoFieldWide}`}>
                  <label className={styles.infoLabel}>Logo path</label>
                  <SplitPathInput
                    inputClassName={styles.infoInputWide}
                    value={editing.logo_url || ''}
                    onChange={v => setEditing(p => ({ ...p, logo_url: v }))}
                    placeholder="logos/clubs/football/france/psg.png"
                  />
                  {editing.logo_url && (
                    <img
                      src={`/media/${editing.logo_url}`}
                      alt="logo preview"
                      className={styles.logoPreview}
                      onError={e => e.target.style.display = 'none'}
                    />
                  )}
                </div>

                {/* Sidebar logo — separate small-icon crop, same reasoning
                    as Competitions.jsx's own sidebar logo field: the main
                    crest often has too much padding to survive shrinking to
                    nav-icon size. Not consumed by any frontend nav yet
                    (clubs don't currently appear in Sidebar.jsx), added for
                    parity/future use per Mohamed's request 2026-08-25. */}
                <div className={`${styles.infoField} ${styles.infoFieldWide}`}>
                  <label className={styles.infoLabel}>Sidebar logo path</label>
                  <SplitPathInput
                    inputClassName={styles.infoInputWide}
                    value={editing.sidebar_logo_url || ''}
                    onChange={v => setEditing(p => ({ ...p, sidebar_logo_url: v }))}
                    fixedDir={dirOf(editing.logo_url)}
                    placeholder="psg-sidebar.png"
                  />
                  {editing.sidebar_logo_url && (
                    <img
                      src={`/media/${editing.sidebar_logo_url}`}
                      alt="sidebar logo preview"
                      className={styles.logoPreview}
                      onError={e => e.target.style.display = 'none'}
                    />
                  )}
                </div>

              </div>
            </div>

            {/* ── Club logos (link-out, single source of truth) ── */}
            <div className={styles.colorSection}>
              <div className={styles.colorSectionTitle}>Club logos</div>
              <p className={styles.blockHint}>
                Era-specific logo overrides (e.g. Seattle SuperSonics through 2008 vs Oklahoma City Thunder from 2008 on, same franchise) are managed on the dedicated Logos page to avoid duplicating that editor here.
              </p>
              <a
                className={styles.linkOutBtn}
                href={`/entity-logos?entity_id=${selected.id}`}
              >
                Manage logos →
              </a>
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

            {/* ── Preview ── */}
            <div className={styles.previewSection}>
              <div className={styles.previewLabel}>Live Preview</div>
              <BannerPreview
                name={selected.canonical_name}
                category={selected.country_name || selected.sport_name || ''}
                surface=""
                primary={editing.primary_color}
                secondary={editing.secondary_color}
                third={editing.third_color}
              />
            </div>
          </div>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>🏟️</span>
            <span>Select a club to edit</span>
          </div>
        )}
      </div>
    </div>
  )
}
