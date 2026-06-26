import { useState, useEffect } from 'react'
import { HexColorPicker } from 'react-colorful'
import api from '../api/client'
import BannerPreview from '../components/BannerPreview'
import styles from './EntityPage.module.css'

export default function Entities() {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [editing, setEditing]   = useState(null)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [activePicker, setActivePicker] = useState(null)

  useEffect(() => {
    api.get('/entities')
      .then(r => setItems(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const types = [...new Set(items.map(i => i.type).filter(Boolean))]

  const filtered = items.filter(i => {
    const matchSearch = (i.name || i.slug || '').toLowerCase().includes(search.toLowerCase())
    const matchType   = typeFilter ? i.type === typeFilter : true
    return matchSearch && matchType
  })

  const select = item => {
    setSelected(item)
    setEditing({
      primary_color:   item.primary_color   || '#1a1a2e',
      secondary_color: item.secondary_color || '#2a2a4e',
      third_color:     item.third_color     || '',
    })
    setActivePicker(null)
    setSaved(false)
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const { data } = await api.put(`/entities/${selected.id}`, editing)
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
        <h1 className={styles.title}>Entities</h1>
        <p className={styles.subtitle}>Clubs, national teams and venues</p>
      </div>

      <div className={styles.layout}>
        <div className={styles.list}>
          <input
            className={styles.search}
            placeholder="Search entities..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            className={styles.filter}
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          {loading && <div className={styles.loading}>Loading...</div>}
          {filtered.map(item => (
            <div
              key={item.id}
              className={`${styles.listItem} ${selected?.id === item.id ? styles.listItemActive : ''}`}
              onClick={() => select(item)}
            >
              <div className={styles.listItemColors}>
                <span className={styles.colorDot} style={{ background: item.primary_color || '#333' }} />
                <span className={styles.colorDot} style={{ background: item.secondary_color || '#333' }} />
              </div>
              <div className={styles.listItemInfo}>
                <div className={styles.listItemName}>{item.name || item.slug}</div>
                <div className={styles.listItemMeta}>{item.type}</div>
              </div>
            </div>
          ))}
        </div>

        {selected && editing ? (
          <div className={styles.editor}>
            <div className={styles.editorHeader}>
              <div>
                <div className={styles.editorTitle}>{selected.name || selected.slug}</div>
                <div className={styles.editorMeta}>{selected.type} · ID {selected.id}</div>
              </div>
              <button
                className={`${styles.saveBtn} ${saved ? styles.saveBtnSaved : ''}`}
                onClick={save}
                disabled={saving}
              >
                {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
              </button>
            </div>

            <div className={styles.colorSection}>
              {[
                { key: 'primary_color',   label: 'Primary' },
                { key: 'secondary_color', label: 'Secondary' },
                { key: 'third_color',     label: 'Third (optional)' },
              ].map(({ key, label }) => (
                <div key={key} className={styles.colorRow}>
                  <div className={styles.colorLabel}>{label}</div>
                  <div className={styles.colorInputRow}>
                    <div
                      className={styles.colorSwatch}
                      style={{ background: editing[key] || '#333' }}
                      onClick={() => setActivePicker(activePicker === key ? null : key)}
                    />
                    <input
                      className={styles.colorInput}
                      value={editing[key] || ''}
                      onChange={e => setEditing(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder="#000000"
                      maxLength={7}
                    />
                  </div>
                  {activePicker === key && (
                    <div className={styles.pickerWrap}>
                      <HexColorPicker
                        color={editing[key] || '#000000'}
                        onChange={color => setEditing(prev => ({ ...prev, [key]: color }))}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className={styles.previewSection}>
              <div className={styles.previewLabel}>Live Preview</div>
              <BannerPreview
                name={selected.name || selected.slug}
                category={selected.type || 'Entity'}
                primary={editing.primary_color}
                secondary={editing.secondary_color}
                third={editing.third_color}
              />
            </div>
          </div>
        ) : (
          <div className={styles.emptyEditor}>
            <div className={styles.emptyIcon}>🏛</div>
            <div>Select an entity to edit</div>
          </div>
        )}
      </div>
    </div>
  )
}
