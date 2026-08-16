import { useState, useEffect } from 'react'
import api, { publicApi } from '../api/client'
import styles from './IconicMoments.module.css'

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

// Same page used for every sport, including Car Racing. F1 and MotoGP both
// have their own dedicated tables instead of the generic seasons/media
// schema — so item loading, the "new item" season picker, and save/remove
// all swap to their own equivalents. Discriminated by the COMPETITION's own
// slug (NOT sport_slug: F1 and MotoGP share sport_id 4/'car-racing' — same
// reason MatchVideos.jsx had to be fixed the same way; matching by
// sport_slug alone misrouted every MotoGP save into F1's f1_iconic_moments
// table instead). The UI, editor, and tag picker stay identical. Each
// loaded item is tagged with _isF1/_isMotoGP so save()/remove() know which
// endpoint to hit without re-deriving it from current selection state.
//
// MotoGP has 3 season rows per year (motogp/moto2/moto3 — see
// routes/motogp.js file header), all with gender='M', so the generic
// Season column's "{year} ({gender})" grouping would collapse all 3 classes
// into one indistinguishable bucket — every MotoGP item carries a
// `moto_category` field (from admin.js's GET /motogp/iconic-moments join)
// used as the grouping key instead of gender wherever it's present.
const MOTOGP_CATEGORIES = [
  { value: 'motogp', label: 'MotoGP' },
  { value: 'moto2', label: 'Moto2' },
  { value: 'moto3', label: 'Moto3' },
]
export default function IconicMoments() {
  const [competitions, setCompetitions]     = useState([])
  const [selectedSport, setSelectedSport]   = useState('')
  const [selectedComp, setSelectedComp]     = useState('')
  const [compSearch, setCompSearch]         = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedSeason, setSelectedSeason] = useState('')
  const [seasons, setSeasons]               = useState([])      // for the "new video" season picker only
  const [newSeasonId, setNewSeasonId]       = useState('')
  const [items, setItems]                   = useState([])      // ALL iconic moments for selected competition, all years
  const [loadingItems, setLoadingItems]     = useState(false)
  const [selected, setSelected]             = useState(null)   // null = new item mode
  const [editing, setEditing]               = useState(false)  // controls whether the editor panel shows
  const [form, setForm]                     = useState(EMPTY_FORM)
  const [saving, setSaving]                 = useState(false)
  const [saved, setSaved]                   = useState(false)
  const [allTags, setAllTags]               = useState([])
  const [categoryOptions, setCategoryOptions] = useState([]) // sport-scoped, fetched from DB

  useEffect(() => {
    publicApi.get('/competitions')
      .then(r => setCompetitions(r.data.data))
      .catch(console.error)
    // Tags are a global suggestion pool across every sport's videos —
    // merge the generic media tags with F1's own tag pool.
    Promise.all([
      api.get('/media/tags').catch(() => ({ data: [] })),
      api.get('/f1/iconic-moments/tags').catch(() => ({ data: [] })),
      api.get('/motogp/iconic-moments/tags').catch(() => ({ data: [] })),
    ]).then(([generic, f1, motogp]) => {
      setAllTags([...new Set([...(generic.data || []), ...(f1.data || []), ...(motogp.data || [])])].sort())
    })
  }, [])

  // Sports derived from the competitions list — Column 1
  const sports = [...new Set(competitions.map(c => c.sport_name).filter(Boolean))].sort()

  const selectedCompObj = competitions.find(c => String(c.id) === selectedComp)
  // Discriminate by the COMPETITION's own slug, not sport_slug — see file
  // header comment.
  const isF1Comp = selectedCompObj?.slug === 'formula-1-world-championship'
  const isMotoGPComp = selectedCompObj?.slug === 'motogp'

  // Categories are sport-specific (tennis vs football vs car racing each define
  // their own taxonomy) — refetch whenever the selected sport changes.
  useEffect(() => {
    setCategoryOptions([])
    if (!selectedSport) return
    const sportSlug = competitions.find(c => c.sport_name === selectedSport)?.sport_slug
    if (!sportSlug) return
    publicApi.get(`/iconic-moment-categories?sport_slug=${sportSlug}`)
      .then(r => setCategoryOptions([{ value: '', label: '— None —' }, ...r.data.data]))
      .catch(console.error)
  }, [selectedSport, competitions])

  // Competitions for the selected sport — Column 2
  const compsForSport = competitions
    .filter(c => c.sport_name === selectedSport)
    .filter(c => !compSearch || c.name.toLowerCase().includes(compSearch.toLowerCase()))

  // Load ALL iconic moments for the selected competition (every season/year) when competition changes
  useEffect(() => {
    setSelectedCategory('')
    setSelectedSeason('')
    setSelected(null)
    setEditing(false)
    if (!selectedComp) { setItems([]); return }
    setLoadingItems(true)
    const request = isF1Comp
      ? api.get('/f1/iconic-moments')
      : isMotoGPComp
      ? api.get('/motogp/iconic-moments')
      : api.get(`/media/iconic-by-competition?competition_id=${selectedComp}`)
    request
      .then(r => {
        const rows = isF1Comp
          ? r.data.map(i => ({ ...i, gender: null, competition_name: selectedCompObj?.name, _isF1: true }))
          : isMotoGPComp
          ? r.data.map(i => ({ ...i, gender: null, competition_name: selectedCompObj?.name, _isMotoGP: true }))
          : r.data.map(i => ({ ...i, _isF1: false }))
        setItems(rows)
      })
      .catch(console.error)
      .finally(() => setLoadingItems(false))
  }, [selectedComp, isF1Comp, isMotoGPComp])

  // Categories actually present for this competition — Column 3
  const categoriesForComp = [...new Set(items.map(i => i.category).filter(Boolean))]
    .sort()
    .map(value => ({ value, label: categoryOptions.find(c => c.value === value)?.label || value }))

  // Items after the category filter (used to drive the Season column + as fallback for "no category" case)
  const itemsAfterCategory = selectedCategory
    ? items.filter(i => i.category === selectedCategory)
    : items

  // Seasons actually present within the current category selection — Column 4.
  // MotoGP items use moto_category (motogp/moto2/moto3) as the grouping
  // dimension instead of gender — see file header comment for why gender
  // alone can't distinguish MotoGP's 3 classes.
  const seasonsForCategory = [...new Set(itemsAfterCategory.map(i =>
    JSON.stringify({ year: i.year, gender: i.gender, moto_category: i.moto_category })
  ))]
    .map(s => JSON.parse(s))
    .filter(s => s.year != null)
    .sort((a, b) => b.year - a.year || (a.moto_category || a.gender || '').localeCompare(b.moto_category || b.gender || ''))

  const seasonKey = (i) => `${i.year}|${i.moto_category || i.gender || ''}`
  const seasonDisplayLabel = (s) =>
    s.moto_category ? `${s.year} (${MOTOGP_CATEGORIES.find(c => c.value === s.moto_category)?.label || s.moto_category})`
      : `${s.year}${s.gender ? ` (${s.gender})` : ''}`

  // Rows to display: filtered by category AND season
  const visibleItems = selectedSeason
    ? itemsAfterCategory.filter(i => seasonKey(i) === selectedSeason)
    : itemsAfterCategory

  // Seasons for the "new video" form — only needed when adding, since the drill-down doesn't pin a year
  useEffect(() => {
    if (!selectedComp) { setSeasons([]); return }
    const request = isF1Comp
      ? api.get('/f1/seasons')
      : isMotoGPComp
      ? api.get('/motogp/seasons')
      : publicApi.get(`/seasons/by-competition?competition_id=${selectedComp}`)
    request
      .then(r => {
        const rows = isF1Comp ? r.data.map(s => ({ id: s.id, year: s.year, gender: null }))
          : isMotoGPComp ? r.data.map(s => ({ id: s.id, year: s.year, gender: null, moto_category: s.category }))
          : r.data.data
        setSeasons(rows)
      })
      .catch(console.error)
  }, [selectedComp, isF1Comp, isMotoGPComp])

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
    const isF1 = selected ? selected._isF1 : isF1Comp
    const isMotoGP = selected ? selected._isMotoGP : isMotoGPComp
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
        const { data } = isF1
          ? await api.put(`/f1/iconic-moments/${selected.id}`, payload)
          : isMotoGP
          ? await api.put(`/motogp/iconic-moments/${selected.id}`, payload)
          : await api.put(`/media/${selected.id}`, payload)
        setItems(prev => prev.map(i => i.id === selected.id ? { ...i, ...data } : i))
        setSelected(prev => ({ ...prev, ...data }))
      } else {
        const { data } = isF1
          ? await api.post('/f1/iconic-moments', { season_id: targetSeasonId, ...payload })
          : isMotoGP
          ? await api.post('/motogp/iconic-moments', { season_id: targetSeasonId, ...payload })
          : await api.post('/media', { media_type: 'iconic_moment', season_id: targetSeasonId, ...payload })
        // Enrich with year/gender/moto_category/competition_name so it
        // renders correctly in the table immediately
        const seasonInfo = seasons.find(s => String(s.id) === String(targetSeasonId))
        const compInfo = competitions.find(c => String(c.id) === String(selectedComp))
        const enriched = {
          ...data,
          year: seasonInfo?.year,
          gender: seasonInfo?.gender,
          moto_category: seasonInfo?.moto_category,
          competition_name: compInfo?.name,
          _isF1: isF1,
          _isMotoGP: isMotoGP,
        }
        setItems(prev => [...prev, enriched])
        setSelected(enriched)
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
      if (item._isF1) {
        await api.delete(`/f1/iconic-moments/${item.id}`)
      } else if (item._isMotoGP) {
        await api.delete(`/motogp/iconic-moments/${item.id}`)
      } else {
        await api.delete(`/media/${item.id}`)
      }
      setItems(prev => prev.filter(i => i.id !== item.id))
      if (selected?.id === item.id) { setEditing(false); setSelected(null) }
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  // Source options: ATP/WTA don't apply outside tennis, so hide them
  // whenever the relevant item/selection is an F1/MotoGP (or any
  // non-tennis) context.
  const currentIsF1 = selected ? selected._isF1 : isF1Comp
  const currentIsMotoGP = selected ? selected._isMotoGP : isMotoGPComp

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Iconic Moments</h1>
        <p className={styles.subtitle}>Event-level video gallery — not tied to a specific match</p>
      </div>

      {/* ── 4-column drill-down: Sport / Competition / Category / Season ── */}
      <div className={styles.drilldown}>
        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Sport</div>
          <div className={styles.drillList}>
            {sports.map(sport => (
              <button
                key={sport}
                className={`${styles.drillItem} ${selectedSport === sport ? styles.drillItemActive : ''}`}
                onClick={() => { setSelectedSport(sport); setSelectedComp(''); setSelectedCategory(''); setCompSearch('') }}
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

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Category</div>
          <div className={styles.drillList}>
            {!selectedComp ? (
              <div className={styles.drillEmpty}>Select a competition</div>
            ) : loadingItems ? (
              <div className={styles.drillEmpty}>Loading...</div>
            ) : categoriesForComp.length === 0 ? (
              <div className={styles.drillEmpty}>No videos yet</div>
            ) : (
              <>
                <button
                  className={`${styles.drillItem} ${selectedCategory === '' ? styles.drillItemActive : ''}`}
                  onClick={() => { setSelectedCategory(''); setSelectedSeason('') }}
                >
                  All categories ({items.length})
                </button>
                {categoriesForComp.map(cat => (
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
            {!selectedComp ? (
              <div className={styles.drillEmpty}>Select a competition</div>
            ) : seasonsForCategory.length === 0 ? (
              <div className={styles.drillEmpty}>No videos yet</div>
            ) : (
              <>
                <button
                  className={`${styles.drillItem} ${selectedSeason === '' ? styles.drillItemActive : ''}`}
                  onClick={() => setSelectedSeason('')}
                >
                  All seasons ({itemsAfterCategory.length})
                </button>
                {seasonsForCategory.map(s => {
                  const key = seasonKey(s)
                  const count = itemsAfterCategory.filter(i => seasonKey(i) === key).length
                  return (
                    <button
                      key={key}
                      className={`${styles.drillItem} ${selectedSeason === key ? styles.drillItemActive : ''}`}
                      onClick={() => setSelectedSeason(key)}
                    >
                      {seasonDisplayLabel(s)} ({count})
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {!selectedComp ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>⭐</span>
          <span>Select a sport and competition to manage its video gallery</span>
        </div>
      ) : (
        <>
          <div className={styles.tableToolbar}>
            <button className={styles.addBtn} onClick={startNew}>+ Add video</button>
          </div>

          {/* ── Flat table ── */}
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colTitle}>Title</span>
              <span className={styles.colComp}>Competition</span>
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
                    <span className={styles.colComp}>{item.competition_name || '—'}</span>
                    <span className={styles.colCategory}>
                      {categoryOptions.find(c => c.value === item.category)?.label || item.category || '—'}
                    </span>
                    <span className={styles.colSeason}>
                      {item.year ? seasonDisplayLabel(item) : '—'}
                    </span>
                    <span className={styles.colSource}>{item.source}</span>
                    <span className={styles.colActions}>
                      <button className={styles.rowActionBtn} onClick={() => selectItem(item)}>Edit</button>
                      <button className={styles.rowActionBtnDelete} onClick={() => remove(item)}>Delete</button>
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
                    // Iconic moments are only ever tied to the Regular Season
                    // event — competitions with no event split (event_slug
                    // null) have just one season row per year, which counts
                    // as "regular season" by default.
                    .filter(s => !s.event_slug || s.event_slug.startsWith('regular-season'))
                    .sort((a, b) => b.year - a.year || (a.moto_category || a.gender || '').localeCompare(b.moto_category || b.gender || ''))
                    .map(s => (
                      <option key={s.id} value={s.id}>{seasonDisplayLabel(s)}</option>
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
                    {!currentIsF1 && !currentIsMotoGP && <option value="atp">ATP</option>}
                    {!currentIsF1 && !currentIsMotoGP && <option value="wta">WTA</option>}
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
