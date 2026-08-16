import { useEffect, useState, useMemo } from 'react'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import styles from './iconic_moments_template.module.css'

// Fallback labels — used when no sportSlug is passed (existing
// football/tennis call sites) or if the dynamic category fetch fails.
// New sports should prefer passing sportSlug so labels come from the
// iconic_moment_categories table (Build Log v2.1) instead of being
// hardcoded here.
const CATEGORY_LABELS = {
  men_single: 'Men Single',
  women_single: 'Women Single',
  men_double: 'Men Double',
  women_double: 'Women Double',
  mixed_double: 'Mixed Double',
  general: 'General',
}

function getYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)
  return match ? match[1] : null
}

function VideoCard({ item, labelFor }) {
  const [open, setOpen] = useState(false)
  const youtubeId = item.source === 'youtube' ? getYouTubeId(item.video_url) : null
  const canEmbed   = item.embeddable && youtubeId
  const thumb = item.thumbnail_url
    || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null)

  if (open) {
    return (
      <div className={styles.cardOpen}>
        {canEmbed ? (
          <iframe
            width="100%"
            height="520"
            src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
            title={item.title || 'Iconic moment'}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className={styles.linkOut}>
            {thumb && <img src={thumb} alt="" className={styles.linkOutThumb} />}
            <a href={item.video_url} target="_blank" rel="noreferrer" className={styles.linkOutLink}>
              Watch on {item.source === 'atp' ? 'ATP' : item.source === 'wta' ? 'WTA' : 'official site'} ↗
            </a>
          </div>
        )}
        <div className={styles.cardFooter}>
          <span className={styles.cardTitle}>{item.title || 'Iconic moment'}</span>
          <button className={styles.closeBtn} onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <button className={styles.card} onClick={() => setOpen(true)}>
      <div className={styles.thumbWrap}>
        {thumb
          ? <img src={thumb} alt="" className={styles.thumb} />
          : <div className={styles.thumbPlaceholder}>▶</div>
        }
        <span className={styles.playOverlay}>▶</span>
      </div>
      <div className={styles.cardInfo}>
        <span className={styles.cardTitleClosed}>{item.title || 'Iconic moment'}</span>
        {item.competition_name && (
          <span className={styles.cardCategory}>{item.competition_name}</span>
        )}
        {item.category && (
          <span className={styles.cardCategory}>{labelFor(item.category)}</span>
        )}
      </div>
    </button>
  )
}

// sportSlug (optional) — when provided, category labels are fetched
// dynamically from GET /api/iconic-moment-categories?sport_slug=X (the
// same per-sport taxonomy the admin editor already uses, per Build Log
// v2.1) instead of relying on the hardcoded CATEGORY_LABELS map above,
// which only ever covered tennis values. Omitting it preserves the
// exact previous behavior for existing football/tennis call sites.
//
// fetchMoments (optional) — the function called with seasonId to load
// the gallery. Defaults to api.getIconicMoments (the generic media-table
// route). Sports with their own dedicated tables (e.g. F1) pass
// api.getF1IconicMoments instead, reusing this entire component/UI
// unmodified.
export default function IconicMomentsTemplate({ seasonId, competitionName = '', year = '', sportSlug = null, fetchMoments = api.getIconicMoments, pageTitle }) {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [activeCategory, setActiveCategory] = useState('')
  const [tagSearch, setTagSearch]           = useState('')
  const [dynamicLabels, setDynamicLabels]   = useState({})

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setError(null)
    setActiveCategory('')
    setTagSearch('')
    fetchMoments(seasonId)
      .then(d => setItems(d?.items || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId])

  useEffect(() => {
    if (!sportSlug) { setDynamicLabels({}); return }
    api.getIconicMomentCategories(sportSlug)
      .then(rows => {
        const map = {}
        ;(rows || []).forEach(r => { map[r.value] = r.label })
        setDynamicLabels(map)
      })
      .catch(() => setDynamicLabels({}))
  }, [sportSlug])

  const labelFor = (cat) => dynamicLabels[cat] || CATEGORY_LABELS[cat] || cat

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — Video
  // is shared across every sport (Mohamed: "same for every single sport
  // -> all sports/shared"), resolves at the pure global tier.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) { setPageSubtitle(null); return }
    api.getSubtitle(null, null, 'Video', null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  const categories = useMemo(() => {
    const set = new Set(items.map(i => i.category).filter(Boolean))
    return [...set]
  }, [items])

  const filtered = useMemo(() => {
    return items.filter(i => {
      if (activeCategory && i.category !== activeCategory) return false
      if (tagSearch) {
        const q = tagSearch.toLowerCase()
        const inTags  = (i.tags || []).some(t => t.toLowerCase().includes(q))
        const inTitle = (i.title || '').toLowerCase().includes(q)
        if (!inTags && !inTitle) return false
      }
      return true
    })
  }, [items, activeCategory, tagSearch])

  if (loading) return (
    <div className={styles.wrapper}>
      <div className={styles.grid}>
        {[...Array(6)].map((_, i) => <div key={i} className={styles.skeletonCard} />)}
      </div>
    </div>
  )

  if (error) return <div className={styles.wrapper}><p className={styles.empty}>Could not load videos.</p></div>

  return (
    <div className={styles.wrapper}>
      {/* page-title dropped — EventBlock's isIconicEvent branch now renders
          the Competition I Year I Videos breadcrumb (2026-08-14). */}
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      <PageNotice />

      <div className="filter-bar">
        <input
          type="text"
          className="filter-label"
          placeholder="Search tags or title..."
          value={tagSearch}
          onChange={e => setTagSearch(e.target.value)}
          style={{ minWidth: 200 }}
        />
        {categories.map(cat => (
          <button
            key={cat}
            className={`filter-btn ${activeCategory === cat ? 'active' : ''}`}
            onClick={() => setActiveCategory(activeCategory === cat ? '' : cat)}
          >
            {labelFor(cat)}
          </button>
        ))}
        {(activeCategory || tagSearch) && (
          <button className="filter-reset" onClick={() => { setActiveCategory(''); setTagSearch('') }}>Clear</button>
        )}
        <span className="filter-total">{filtered.length} video{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>
          {items.length === 0 ? 'No video content for the moment.' : 'No videos match your filters.'}
        </p>
      ) : (
        <div className={styles.grid}>
          {filtered.map(item => <VideoCard key={item.id} item={item} labelFor={labelFor} />)}
        </div>
      )}
    </div>
  )
}
