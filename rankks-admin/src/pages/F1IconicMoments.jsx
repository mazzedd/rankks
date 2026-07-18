import { useState, useEffect } from 'react'
import api, { publicApi } from '../api/client'
import styles from './IconicMoments.module.css'

// F1 equivalent of IconicMoments.jsx — same editor overlay, tag input,
// and save/remove logic verbatim, but a 2-column drill-down (Category ->
// Season) instead of 4-column (Sport -> Competition -> Category ->
// Season), since F1 has only one competition and its own dedicated
// tables (f1_seasons, f1_iconic_moments) rather than the generic schema.
// Categories still come from the shared iconic_moment_categories table,
// scoped to sport_slug=car-racing (Build Log v2.1's per-sport taxonomy),
// via the same public endpoint the generic page already uses.

const EMPTY_FORM = {
  video_url: '', source: 'youtube', embeddable: true,
  title: '', category: '', tags: [], thumbnail_url: '', display_order: 0,
}

function normalizeTag(t) {
  return t.trim().toLowerCase()
}

function TagInput({ tags, onChange, allTags }) {
  const [inputValue, setInputValue] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  const suggestions = inputValue
    ? allTags.filter(t =>
        t.toLowerCase().includes(inputValue.toLowerCase()) &&
        !tags.some(existing => normalizeTag(existing) === normalizeTag(t))
      ).slice(0, 6)
    : []

  const addTag = (raw) => {
    const value = raw.trim()
    if (!value) return
    if (tags.some(t => normalizeTag(t) === normalizeTag(value))) {
      setInputValue('')
      return
    }
    onChange([...tags, value])
    setInputValue('')
    setShowSuggestions(false)
  }

  const removeTag = (tagToRemove) => {
    onChange(tags.filter(t => t !== tagToRemove))
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && tags.length) {
      removeTag(tags[tags.length - 1])
    }
  }

  return (
    <div className={styles.tagInputWrap}>
      <div className={styles.tagChips}>
        {tags.map(tag => (
          <span key={tag} className={styles.tagChip}>
            {tag}
            <button
              type="button"
              className={styles.tagChipRemove}
              onClick={() => removeTag(tag)}
              aria-label={`Remove ${tag}`}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          className={styles.tagChipInput}
          value={inputValue}
          onChange={e => { setInputValue(e.target.value); setShowSuggestions(true) }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 120)}
          placeholder={tags.length ? '' : 'overtake, crash, pole...'}
        />
      </div>
      {showSuggestions && suggestions.length > 0 && (
        <div className={styles.tagSuggestions}>
          {suggestions.map(s => (
            <button
              key={s}
              type="button"
              className={styles.tagSuggestion}
              onClick={() => addTag(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function F1IconicMoments() {
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedSeason, setSelectedSeason]     = useState('')
  const [seasons, setSeasons]                   = useState([])   // for the "new video" season picker
  const [newSeasonId, setNewSeasonId]           = useState('')
  const [items, setItems]                       = useState([])   // ALL F1 iconic moments, all years
  const [loadingItems, setLoadingItems]         = useState(true)
  const [selected, setSelected]                 = useState(null) // null = new item mode
  const [editing, setEditing]                   = useState(false)
  const [form, setForm]                         = useState(EMPTY_FORM)
  const [saving, setSaving]                     = useState(false)
  const [saved, setSaved]                       = useState(false)
  const [allTags, setAllTags]                   = useState([])
  const [categoryOptions, setCategoryOptions]   = useState([])   // car-racing taxonomy, fetched once

  // ── Load everything once — items, tags, categories, seasons ──
  useEffect(() => {
    setLoadingItems(true)
    api.get('/f1/iconic-moments')
      .then(r => setItems(r.data))
      .catch(console.error)
      .finally(() => setLoadingItems(false))
    api.get('/f1/iconic-moments/tags')
      .then(r => setAllTags(r.data))
      .catch(console.error)
    publicApi.get('/iconic-moment-categories?sport_slug=car-racing')
      .then(r => setCategoryOptions([{ value: '', label: '— None —' }, ...r.data.data]))
      .catch(console.error)
    api.get('/f1/seasons')
      .then(r => setSeasons(r.data))
      .catch(console.error)
  }, [])

  // Categories actually present in the data — Column 1
  const categoriesPresent = [...new Set(items.map(i => i.category).filter(Boolean))]
    .sort()
    .map(value => ({ value, label: categoryOptions.find(c => c.value === value)?.label || value }))

  // Items after the category filter (used to drive the Season column)
  const itemsAfterCategory = selectedCategory
    ? items.filter(i => i.category === selectedCategory)
    : items

  // Seasons actually present within the current category selection — Column 2
  const seasonsForCategory = [...new Set(itemsAfterCategory.map(i => i.year))]
    .filter(y => y != null)
    .sort((a, b) => b - a)

  // Rows to display: filtered by category AND season
  const visibleItems = selectedSeason
    ? itemsAfterCategory.filter(i => String(i.year) === selectedSeason)
    : itemsAfterCategory

  const startNew = () => {
    setSelected(null)
    setForm({ ...EMPTY_FORM, category: selectedCategory, display_order: visibleItems.length })
    setNewSeasonId('')
    setEditing(true)
    setSaved(false)
  }

  const selectItem = (item) => {
    setSelected(item)
    setForm({
      video_url: item.video_url || '',
      source: item.source || 'youtube',
      embeddable: item.embeddable !== undefined ? item.embeddable : true,
      title: item.title || '',
      category: item.category || '',
      tags: item.tags || [],
      thumbnail_url: item.thumbnail_url || '',
      display_order: item.display_order ?? 0,
    })
    setEditing(true)
    setSaved(false)
  }

  const save = async () => {
    const targetSeasonId = selected ? selected.season_id : newSeasonId
    if (!targetSeasonId || !form.video_url) return
    setSaving(true)
    const payload = {
      video_url: form.video_url,
      source: form.source,
      embeddable: form.embeddable,
      title: form.title || null,
      category: form.category || null,
      tags: form.tags.length ? form.tags : null,
      thumbnail_url: form.thumbnail_url || null,
      display_order: form.display_order,
    }
    try {
      if (selected) {
        const { data } = await api.put(`/f1/iconic-moments/${selected.id}`, payload)
        setItems(prev => prev.map(i => i.id === selected.id ? { ...i, ...data } : i))
        setSelected(prev => ({ ...prev, ...data }))
      } else {
        const { data } = await api.post('/f1/iconic-moments', {
          season_id: targetSeasonId,
          ...payload,
        })
        const seasonInfo = seasons.find(s => String(s.id) === String(targetSeasonId))
        const enriched = { ...data, year: seasonInfo?.year }
        setItems(prev => [...prev, enriched])
        setSelected(enriched)
      }
      if (payload.tags) {
        setAllTags(prev => [...new Set([...prev, ...payload.tags])].sort())
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item) => {
    if (!confirm(`Delete "${item.title || item.video_url}"?`)) return
    try {
      await api.delete(`/f1/iconic-moments/${item.id}`)
      setItems(prev => prev.filter(i => i.id !== item.id))
      if (selected?.id === item.id) { setEditing(false); setSelected(null) }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>F1 Iconic Moments</h1>
        <p className={styles.subtitle}>Season-level video gallery — not tied to a specific race</p>
      </div>

      {/* ── 2-column drill-down: Category / Season — F1 has one competition,
          so no Sport/Competition columns are needed here ── */}
      <div className={styles.drilldown}>
        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Category</div>
          <div className={styles.drillList}>
            {loadingItems ? (
              <div className={styles.drillEmpty}>Loading...</div>
            ) : categoriesPresent.length === 0 ? (
              <div className={styles.drillEmpty}>No videos yet</div>
            ) : (
              <>
                <button
                  className={`${styles.drillItem} ${selectedCategory === '' ? styles.drillItemActive : ''}`}
                  onClick={() => { setSelectedCategory(''); setSelectedSeason('') }}
                >
                  All categories ({items.length})
                </button>
                {categoriesPresent.map(cat => (
                  <button
                    key={cat.value}
                    className={`${styles.drillItem} ${selectedCategory === cat.value ? styles.drillItemActive : ''}`}
                    onClick={() => { setSelectedCategory(cat.value); setSelectedSeason('') }}
                  >
                    {cat.label} ({items.filter(i => i.category === cat.value).length})
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Season</div>
          <div className={styles.drillList}>
            {seasonsForCategory.length === 0 ? (
              <div className={styles.drillEmpty}>No videos yet</div>
            ) : (
              <>
                <button
                  className={`${styles.drillItem} ${selectedSeason === '' ? styles.drillItemActive : ''}`}
                  onClick={() => setSelectedSeason('')}
                >
                  All seasons ({itemsAfterCategory.length})
                </button>
                {seasonsForCategory.map(year => {
                  const count = itemsAfterCategory.filter(i => i.year === year).length
                  return (
                    <button
                      key={year}
                      className={`${styles.drillItem} ${selectedSeason === String(year) ? styles.drillItemActive : ''}`}
                      onClick={() => setSelectedSeason(String(year))}
                    >
                      {year} ({count})
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </div>
      </div>

      <div className={styles.tableToolbar}>
        <button className={styles.addBtn} onClick={startNew}>+ Add video</button>
      </div>

      {/* ── Flat table ── */}
      <div className={styles.table}>
        <div className={styles.tableHeader}>
          <span className={styles.colTitle}>Title</span>
          <span className={styles.colCategory}>Category</span>
          <span className={styles.colSeason}>Season</span>
          <span className={styles.colSource}>Source</span>
          <span className={styles.colActions}></span>
        </div>

        {loadingItems ? (
          <div className={styles.tableEmpty}>Loading...</div>
        ) : visibleItems.length === 0 ? (
          <div className={styles.tableEmpty}>No videos yet</div>
        ) : (
          visibleItems
            .slice()
            .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (a.display_order ?? 0) - (b.display_order ?? 0))
            .map(item => (
              <div key={item.id} className={styles.tableRow}>
                <span className={styles.colTitle}>{item.title || '(untitled)'}</span>
                <span className={styles.colCategory}>
                  {categoryOptions.find(c => c.value === item.category)?.label || item.category || '—'}
                </span>
                <span className={styles.colSeason}>{item.year || '—'}</span>
                <span className={styles.colSource}>{item.source}</span>
                <span className={styles.colActions}>
                  <button className={styles.rowActionBtn} onClick={() => selectItem(item)}>Edit</button>
                  <button className={styles.rowActionBtnDelete} onClick={() => remove(item)}>Delete</button>
                </span>
              </div>
            ))
        )}
      </div>

      {/* ── Editor (shown only when adding or editing) ── */}
      {editing && (
        <div className={styles.editorOverlay} onClick={() => setEditing(false)}>
          <div className={styles.editor} onClick={e => e.stopPropagation()}>
            <div className={styles.editorHeader}>
              <div>
                <div className={styles.editorTitle}>
                  {selected ? 'Edit video' : 'New video'}
                </div>
                <div className={styles.editorMeta}>
                  {selected ? <span className={styles.idBadge}>ID {selected.id}</span> : 'Not saved yet'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
                  onClick={save}
                  disabled={saving || !form.video_url || (!selected && !newSeasonId)}
                >
                  {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
                </button>
                <button className={styles.closeEditorBtn} onClick={() => setEditing(false)}>✕</button>
              </div>
            </div>

            {!selected && (
              <div className={styles.fieldSection}>
                <div className={styles.fieldSectionTitle}>Season</div>
                <select
                  className={styles.fieldSelect}
                  value={newSeasonId}
                  onChange={e => setNewSeasonId(e.target.value)}
                >
                  <option value="">Select season/year...</option>
                  {[...seasons]
                    .sort((a, b) => b.year - a.year)
                    .map(s => (
                      <option key={s.id} value={s.id}>{s.year}</option>
                    ))}
                </select>
              </div>
            )}

            <div className={styles.fieldSection}>
              <div className={styles.fieldSectionTitle}>Video</div>
              <div className={styles.fieldGrid}>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Video URL</label>
                  <input
                    className={styles.fieldInputWide}
                    value={form.video_url}
                    onChange={e => setForm(p => ({ ...p, video_url: e.target.value }))}
                    placeholder="https://youtube.com/watch?v=... or official link"
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Source</label>
                  <select
                    className={styles.fieldSelect}
                    value={form.source}
                    onChange={e => setForm(p => ({ ...p, source: e.target.value }))}
                  >
                    <option value="youtube">YouTube</option>
                    <option value="official">Official</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className={styles.fieldLabel}>Embeddable</label>
                  <div className={styles.toggleRow}>
                    <button
                      type="button"
                      className={`${styles.toggleBtn} ${form.embeddable ? styles.toggleActive : ''}`}
                      onClick={() => setForm(p => ({ ...p, embeddable: true }))}
                    >
                      Yes — iframe
                    </button>
                    <button
                      type="button"
                      className={`${styles.toggleBtn} ${!form.embeddable ? styles.toggleActive : ''}`}
                      onClick={() => setForm(p => ({ ...p, embeddable: false }))}
                    >
                      No — link out
                    </button>
                  </div>
                </div>

                {!form.embeddable && (
                  <div className={styles.fieldWide}>
                    <label className={styles.fieldLabel}>Thumbnail URL <span className={styles.required}>(required when not embeddable)</span></label>
                    <input
                      className={styles.fieldInputWide}
                      value={form.thumbnail_url}
                      onChange={e => setForm(p => ({ ...p, thumbnail_url: e.target.value }))}
                      placeholder="/media/thumbnails/bahrain-2017-race.jpg"
                    />
                  </div>
                )}

              </div>
            </div>

            <div className={styles.fieldSection}>
              <div className={styles.fieldSectionTitle}>Display</div>
              <div className={styles.fieldGrid}>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Title</label>
                  <input
                    className={styles.fieldInputWide}
                    value={form.title}
                    onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Verstappen's last-lap overtake"
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Category</label>
                  <select
                    className={styles.fieldSelect}
                    value={form.category}
                    onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  >
                    {categoryOptions.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={styles.fieldLabel}>Display order</label>
                  <input
                    className={styles.fieldInput}
                    type="number"
                    value={form.display_order}
                    onChange={e => setForm(p => ({ ...p, display_order: parseInt(e.target.value) || 0 }))}
                  />
                </div>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Tags</label>
                  <TagInput
                    tags={form.tags}
                    onChange={(newTags) => setForm(p => ({ ...p, tags: newTags }))}
                    allTags={allTags}
                  />
                </div>

              </div>
            </div>

            {form.video_url && (
              <div className={styles.fieldSection}>
                <div className={styles.fieldSectionTitle}>Preview</div>
                <a href={form.video_url} target="_blank" rel="noreferrer" className={styles.previewLink}>
                  {form.video_url}
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
