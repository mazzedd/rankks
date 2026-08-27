// templates/media/WatchCenterTemplate.jsx
// Unified Watch Center — Match Videos + Iconic Moments on one page (Mohamed
// 2026-08-19: "compile Match Videos and Iconic moments in a single page.
// after search, place 2 pills: VIDEO SUMMARY and ICONIC MOMENTS"). Same
// generic fetchMoments-prop reuse pattern the old card-grid
// IconicMomentsTemplate established (any sport can pass its own fetch
// functions) — that component is left as-is for F1/MotoGP's own Watch
// pages, which don't have match_summary video data yet; this one is wired
// into tennis's Watch Center only for now.
import { useEffect, useState, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../../services/api'
import PageNotice from '../../PageNotice/PageNotice'
import FavouriteStar from '../../shared/FavouriteStar'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import styles from './WatchCenterTemplate.module.css'

function getYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)
  return match ? match[1] : null
}

function fmtDuration(seconds) {
  if (!seconds && seconds !== 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

// One row — either a Match Video (round + opponents) or an Iconic Moment
// (title + tags) driven by `variant`. Opens in the site's existing
// right-side slide-in drawer (Mohamed 2026-08-19: "video opens in right
// sliding window") — same useVideoPlayerStore + SlideDrawer.module.css
// shell MatchVideo.jsx already built for every other "Watch" button on the
// site, and the same GET/POST /api/video-stats calls it uses for views/
// favourited, rather than a second parallel tracking system (an earlier
// pass here added its own /api/media/:id/view before this was found —
// removed in favour of this one). The eye/star/share counts stay visible
// on the row itself (not just inside the drawer) since that's what the
// Match Videos/Iconic Moments list specifically asked for, on top of what
// MatchVideo already does.
// Exported — My Account's Videos tab reuses this unmodified for favourited
// videos (Mohamed 2026-08-20: "my account / videos. use the same pattern
// to display my videos") instead of a second row layout.
export function MediaRow({ item, variant }) {
  const videoKey = `media:${item.id}`
  const open = useVideoPlayerStore(s => s.openKey === videoKey)
  const openVideoDrawer = useVideoPlayerStore(s => s.openVideo)
  const closeVideoDrawer = useVideoPlayerStore(s => s.closeVideo)
  const [stats, setStats] = useState({ views: item.view_count ?? 0, favourited: 0 })
  const viewTracked = useRef(false)

  useEffect(() => {
    api.getVideoStats('media', item.id).then(setStats).catch(() => {})
  }, [item.id])

  useEffect(() => {
    if (!open || viewTracked.current) return
    viewTracked.current = true
    api.trackVideoView('media', item.id).then(res => {
      if (res) setStats(s => ({ ...s, views: res.views }))
    })
  }, [open, item.id])

  const youtubeId = item.source === 'youtube' ? getYouTubeId(item.video_url) : null
  const canEmbed = item.embeddable && youtubeId
  const thumb = item.thumbnail_url || (youtubeId ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg` : null)
  const duration = fmtDuration(item.duration_seconds)

  const title = variant === 'match'
    ? [item.home_name, item.away_name].filter(Boolean).join(' vs ')
    : (item.title || 'Iconic moment')
  const subtitle = variant === 'match' ? item.competition_name : item.competition_name

  return (
    <div className={styles.row}>
      <button type="button" className={styles.rowMain} onClick={() => openVideoDrawer(videoKey)}>
        <div className={styles.thumbWrap}>
          {thumb ? <img src={thumb} alt="" className={styles.thumb} /> : <div className={styles.thumbPlaceholder} />}
        </div>
        <div className={styles.rowTitle}>
          <span className={styles.rowTitleText}>{title}</span>
          {variant === 'moment' && item.tags?.length > 0 && (
            <div className={styles.tagRow}>
              {item.tags.map(t => <span key={t} className={styles.tagChip}>{t}</span>)}
            </div>
          )}
        </div>
        <div className={styles.rowMeta}>{variant === 'match' ? item.round : null}</div>
        <div className={styles.rowDuration}>{duration || '—'}</div>
      </button>

      <div className={styles.statIcons}>
        <div className={styles.statIcon}>
          <svg viewBox="0 0 24 24" className={styles.icon}><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" /></svg>
          <span>{stats.views ?? 0}</span>
        </div>
        <div className={styles.statIcon}>
          <FavouriteStar
            entityType="media"
            entityId={item.id}
            variant="icon"
            size="md"
            className={styles.favIcon}
            onToggled={() => api.getVideoStats('media', item.id).then(setStats).catch(() => {})}
          />
          <span>{stats.favourited ?? 0}</span>
        </div>
        <div className={styles.statIcon}>
          <svg viewBox="0 0 24 24" className={styles.icon}><path d="M18 16.08a2.9 2.9 0 0 0-1.94.75L8.91 12.7a3 3 0 0 0 0-1.4l7.05-4.11a3 3 0 1 0-.99-1.72L7.92 9.58a3 3 0 1 0 0 4.84l7.15 4.19a3 3 0 1 0 2.93-2.53z" /></svg>
          <span>0</span>
        </div>
      </div>

      {open && createPortal(
        <>
          <div className={styles.drawerBackdrop} onClick={closeVideoDrawer} />
          <div className={styles.drawer}>
            <button className={styles.drawerCloseBtn} onClick={closeVideoDrawer} aria-label="Close">✕</button>
            <div className={styles.header}>
              <div className={styles.headerTitleRow}>
                <div className={styles.headerTitle}>{title}</div>
              </div>
              {subtitle && (
                <div className={styles.headerSubtitleRow}>
                  <div className={styles.headerSubtitle}>{subtitle}</div>
                </div>
              )}
            </div>
            {canEmbed ? (
              <div className={styles.drawerVideoWrap}>
                <iframe
                  width="100%"
                  height="100%"
                  src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
                  title={title}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className={styles.drawerLinkOut}>
                {thumb && <img src={thumb} alt="" className={styles.linkOutThumb} />}
                <a href={item.video_url} target="_blank" rel="noreferrer" className={styles.linkOutLink}>
                  Watch on {item.source === 'atp' ? 'ATP' : item.source === 'wta' ? 'WTA' : 'official site'} ↗
                </a>
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

const PILLS = [
  { key: 'videos',  label: 'Video Summary' },
  { key: 'moments', label: 'Iconic Moments' },
]

// genderTabs (optional) — [{ key: 'M', label: 'Men', seasonId: '4332' }, { key:
// 'F', label: 'Women', seasonId: '5406' }] — Grand Slam events run both
// draws under one competition+year (Mohamed 2026-08-20: "For G slam, since
// we have Women and Men. Can u create horizontal tab: Men and Women. Men
// is b default"), so the Match Videos/Iconic Moments underneath need their
// own gender split, same content shape for both tabs. Omitted entirely for
// a single-gender tournament (every ATP/WTA-only event) — falls back to
// the plain `seasonId` prop, unchanged from before this existed.
export default function WatchCenterTemplate({ seasonId, genderTabs, fetchMatchVideos, fetchMoments, year }) {
  const [activeGenderTab, setActiveGenderTab] = useState(genderTabs?.[0]?.key ?? null)
  const effectiveSeasonId = genderTabs
    ? (genderTabs.find(t => t.key === activeGenderTab) || genderTabs[0])?.seasonId
    : seasonId

  const [matchVideos, setMatchVideos] = useState([])
  const [moments, setMoments]         = useState([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [search, setSearch]           = useState('')
  const [activePill, setActivePill]   = useState('') // '' = both
  const [tagFilter, setTagFilter]     = useState('')

  // Reset to the first tab (Men) whenever the underlying competition/year
  // changes — otherwise navigating from one Grand Slam to another could
  // land on a stale "Women" selection the new page never asked for.
  useEffect(() => {
    setActiveGenderTab(genderTabs?.[0]?.key ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId])

  useEffect(() => {
    if (!effectiveSeasonId) return
    setLoading(true)
    setError(null)
    setSearch('')
    setActivePill('')
    setTagFilter('')
    Promise.all([
      fetchMatchVideos ? fetchMatchVideos(effectiveSeasonId) : Promise.resolve({ items: [] }),
      fetchMoments ? fetchMoments(effectiveSeasonId) : Promise.resolve({ items: [] }),
    ])
      .then(([mv, im]) => { setMatchVideos(mv?.items || []); setMoments(im?.items || []) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSeasonId])

  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) { setPageSubtitle(null); return }
    api.getSubtitle(null, null, 'Video', null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  // Tags derived from whatever Iconic Moments are actually in the current
  // list — no more admin-configured category taxonomy driving the filter
  // (Mohamed 2026-08-19: "No more related categories (unty in admin). Only
  // tags that are now displayed in the list").
  const momentTags = useMemo(() => {
    const set = new Set()
    moments.forEach(m => (m.tags || []).forEach(t => set.add(t)))
    return [...set].sort()
  }, [moments])

  const q = search.trim().toLowerCase()
  const matchesSearch = (title) => !q || (title || '').toLowerCase().includes(q)

  const filteredMatchVideos = matchVideos.filter(m =>
    matchesSearch([m.home_name, m.away_name].filter(Boolean).join(' vs '))
  )
  const filteredMoments = moments.filter(m => {
    if (tagFilter && !(m.tags || []).includes(tagFilter)) return false
    if (q) {
      const inTags  = (m.tags || []).some(t => t.toLowerCase().includes(q))
      const inTitle = (m.title || '').toLowerCase().includes(q)
      if (!inTags && !inTitle) return false
    }
    return true
  })

  const showVideos  = activePill === '' || activePill === 'videos'
  const showMoments = activePill === '' || activePill === 'moments'
  const hasActiveFilter = search || activePill || tagFilter
  const clearFilters = () => { setSearch(''); setActivePill(''); setTagFilter('') }

  if (loading) return (
    <div className={styles.wrapper}>
      {[...Array(4)].map((_, i) => <div key={i} className={styles.skeletonRow} />)}
    </div>
  )

  if (error) return <div className={styles.wrapper}><p className="empty-state">Could not load videos.</p></div>

  return (
    <div className={styles.wrapper}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      <PageNotice />

      {genderTabs && genderTabs.length > 1 && (
        <div className={styles.genderTabs}>
          {genderTabs.map(t => (
            <button
              key={t.key}
              type="button"
              className={`${styles.genderTab}${activeGenderTab === t.key ? ' ' + styles.genderTabActive : ''}`}
              onClick={() => setActiveGenderTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="filter-bar">
        <input
          type="text"
          className="filter-label"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 200 }}
        />
        {PILLS.map(p => (
          <button
            key={p.key}
            type="button"
            className={`${styles.pill}${activePill === p.key ? ' ' + styles.pillActive : ''}`}
            onClick={() => setActivePill(a => a === p.key ? '' : p.key)}
          >
            {p.label.toUpperCase()}
          </button>
        ))}
        {hasActiveFilter && (
          <button type="button" className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
      </div>

      {showVideos && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Match Videos</div>
          {filteredMatchVideos.length === 0 ? (
            <p className="empty-state">{matchVideos.length === 0 ? 'No match videos for the moment.' : 'No videos match your search.'}</p>
          ) : (
            <div className={styles.rows}>
              {filteredMatchVideos.map(item => <MediaRow key={item.id} item={item} variant="match" />)}
            </div>
          )}
        </div>
      )}

      {showMoments && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Iconic Moments</div>
          {momentTags.length > 0 && (
            <div className={styles.tagFilterBar}>
              {momentTags.map(t => (
                <button
                  key={t}
                  type="button"
                  className={`filter-btn ${tagFilter === t ? 'active' : ''}`}
                  onClick={() => setTagFilter(f => f === t ? '' : t)}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
          {filteredMoments.length === 0 ? (
            <p className="empty-state">{moments.length === 0 ? 'No iconic moments for the moment.' : 'No videos match your filters.'}</p>
          ) : (
            <div className={styles.rows}>
              {filteredMoments.map(item => <MediaRow key={item.id} item={item} variant="moment" />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
