import { useEffect, useState, useMemo } from 'react'
import PageNotice from '../PageNotice/PageNotice'
import { api } from '../../services/api'
import styles from './IconicMomentsTemplate.module.css'

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

function VideoCard({ item }) {
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
        {item.category && (
          <span className={styles.cardCategory}>{CATEGORY_LABELS[item.category] || item.category}</span>
        )}
      </div>
    </button>
  )
}

export default function IconicMomentsTemplate({ seasonId, competitionName = '', year = '' }) {
  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [activeCategory, setActiveCategory] = useState('')
  const [tagSearch, setTagSearch]           = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setError(null)
    setActiveCategory('')
    setTagSearch('')
    api.getIconicMoments(seasonId)
      .then(d => setItems(d?.items || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [seasonId])

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

  const desc = competitionName
    ? `Iconic moments from ${competitionName} ${year}.`
    : ''

  if (loading) return (
    <div className={styles.wrapper}>
      <div className="page-title">Iconic Moments</div>
      <div className={styles.grid}>
        {[...Array(6)].map((_, i) => <div key={i} className={styles.skeletonCard} />)}
      </div>
    </div>
  )

  if (error) return <div className={styles.wrapper}><p className={styles.empty}>Could not load videos.</p></div>

  return (
    <div className={styles.wrapper}>
      <div className="page-title">Iconic Moments</div>
      {desc && <div className="page-description">{desc}</div>}
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
            {CATEGORY_LABELS[cat] || cat}
          </button>
        ))}
        {(activeCategory || tagSearch) && (
          <button className="filter-reset" onClick={() => { setActiveCategory(''); setTagSearch('') }}>Clear</button>
        )}
        <span className="filter-total">{filtered.length} video{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <p className={styles.empty}>No videos match your filters.</p>
      ) : (
        <div className={styles.grid}>
          {filtered.map(item => <VideoCard key={item.id} item={item} />)}
        </div>
      )}
    </div>
  )
}
