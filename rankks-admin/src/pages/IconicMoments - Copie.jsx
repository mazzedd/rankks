import { useState, useEffect } from 'react'
import api from '../api/client'
import styles from './IconicMoments.module.css'

const CATEGORY_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'men_single', label: 'Men Single' },
  { value: 'women_single', label: 'Women Single' },
  { value: 'men_double', label: 'Men Double' },
  { value: 'women_double', label: 'Women Double' },
  { value: 'mixed_double', label: 'Mixed Double' },
  { value: 'general', label: 'General' },
]

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
    // Case-insensitive duplicate check — prevents "Federer" + "federer" both existing
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
          placeholder={tags.length ? '' : 'final, comeback, five-setter...'}
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

export default function IconicMoments() {
  const [competitions, setCompetitions]     = useState([])
  const [selectedComp, setSelectedComp]     = useState('')
  const [seasons, setSeasons]               = useState([])
  const [selectedSeason, setSelectedSeason] = useState('')
  const [items, setItems]                   = useState([])
  const [loadingItems, setLoadingItems]     = useState(false)
  const [selected, setSelected]             = useState(null)   // null = new item mode
  const [form, setForm]                     = useState(EMPTY_FORM)
  const [saving, setSaving]                 = useState(false)
  const [saved, setSaved]                   = useState(false)
  const [allTags, setAllTags]               = useState([])

  useEffect(() => {
    api.get('/competitions')
      .then(r => setCompetitions(r.data))
      .catch(console.error)
    api.get('/media/tags')
      .then(r => setAllTags(r.data))
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (!selectedComp) { setSeasons([]); setSelectedSeason(''); return }
    api.get(`/seasons?competition_id=${selectedComp}`)
      .then(r => setSeasons(r.data))
      .catch(console.error)
    setSelectedSeason('')
    setItems([])
  }, [selectedComp])

  const loadItems = () => {
    if (!selectedSeason) { setItems([]); return }
    setLoadingItems(true)
    api.get(`/media/iconic?season_id=${selectedSeason}`)
      .then(r => setItems(r.data))
      .catch(console.error)
      .finally(() => setLoadingItems(false))
  }

  useEffect(loadItems, [selectedSeason])

  const startNew = () => {
    setSelected(null)
    setForm({ ...EMPTY_FORM, display_order: items.length })
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
    setSaved(false)
  }

  const save = async () => {
    if (!selectedSeason || !form.video_url) return
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
        const { data } = await api.put(`/media/${selected.id}`, payload)
        setItems(prev => prev.map(i => i.id === selected.id ? data : i))
        setSelected(data)
      } else {
        const { data } = await api.post('/media', {
          media_type: 'iconic_moment',
          season_id: selectedSeason,
          ...payload,
        })
        setItems(prev => [...prev, data])
        setSelected(data)
      }
      // Refresh suggestion list so any newly-typed tag becomes suggestable right away
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
      await api.delete(`/media/${item.id}`)
      setItems(prev => prev.filter(i => i.id !== item.id))
      if (selected?.id === item.id) startNew()
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Iconic Moments</h1>
        <p className={styles.subtitle}>Event-level video gallery — not tied to a specific match</p>
      </div>

      <div className={styles.filters}>
        <select
          className={styles.select}
          value={selectedComp}
          onChange={e => setSelectedComp(e.target.value)}
        >
          <option value="">Select competition...</option>
          {competitions.map(c => (
            <option key={c.id} value={c.id}>{c.sport_name} — {c.name}</option>
          ))}
        </select>

        <select
          className={styles.select}
          value={selectedSeason}
          onChange={e => setSelectedSeason(e.target.value)}
          disabled={!selectedComp}
        >
          <option value="">Select season...</option>
          {seasons.map(s => (
            <option key={s.id} value={s.id}>{s.year}{s.gender ? ` (${s.gender})` : ''}</option>
          ))}
        </select>
      </div>

      {!selectedSeason ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>⭐</span>
          <span>Select a competition and season to manage its video gallery</span>
        </div>
      ) : (
        <div className={styles.layout}>

          {/* ── List ── */}
          <div className={styles.sidebar}>
            <div className={styles.sidebarTop}>
              <button className={styles.addBtn} onClick={startNew}>+ Add video</button>
            </div>

            {loadingItems ? (
              <div className={styles.loading}>Loading...</div>
            ) : items.length === 0 ? (
              <div className={styles.loading}>No videos yet</div>
            ) : (
              <div className={styles.list}>
                {items
                  .slice()
                  .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
                  .map(item => (
                    <div
                      key={item.id}
                      className={`${styles.item} ${selected?.id === item.id ? styles.itemActive : ''}`}
                      onClick={() => selectItem(item)}
                    >
                      <div className={styles.itemBody}>
                        <span className={styles.itemTitle}>{item.title || '(untitled)'}</span>
                        <span className={styles.itemMeta}>
                          {item.source}
                          {item.category && <> · {CATEGORY_OPTIONS.find(c => c.value === item.category)?.label || item.category}</>}
                        </span>
                      </div>
                      <button
                        className={styles.itemDelete}
                        onClick={(e) => { e.stopPropagation(); remove(item) }}
                        title="Delete"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* ── Editor ── */}
          <div className={styles.editor}>
            <div className={styles.editorHeader}>
              <div>
                <div className={styles.editorTitle}>
                  {selected ? 'Edit video' : 'New video'}
                </div>
                <div className={styles.editorMeta}>
                  {selected ? <span className={styles.idBadge}>ID {selected.id}</span> : 'Not saved yet'}
                </div>
              </div>
              <button
                className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
                onClick={save}
                disabled={saving || !form.video_url}
              >
                {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
              </button>
            </div>

            <div className={styles.fieldSection}>
              <div className={styles.fieldSectionTitle}>Video</div>
              <div className={styles.fieldGrid}>

                <div className={styles.fieldWide}>
                  <label className={styles.fieldLabel}>Video URL</label>
                  <input
                    className={styles.fieldInputWide}
                    value={form.video_url}
                    onChange={e => setForm(p => ({ ...p, video_url: e.target.value }))}
                    placeholder="https://youtube.com/watch?v=... or https://atptour.com/..."
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
                    <option value="atp">ATP</option>
                    <option value="wta">WTA</option>
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
                      placeholder="/media/thumbnails/wimbledon-2017-final.jpg"
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
                    placeholder="e.g. Federer's incredible tweener"
                  />
                </div>

                <div>
                  <label className={styles.fieldLabel}>Category</label>
                  <select
                    className={styles.fieldSelect}
                    value={form.category}
                    onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  >
                    {CATEGORY_OPTIONS.map(c => (
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
