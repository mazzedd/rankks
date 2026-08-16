import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'
import useUserStore from '../../store/useUserStore'
import useVideoPlayerStore from '../../store/useVideoPlayerStore'
import { StatusBadge } from '../EventBlock/EventBlock'
import styles from './MatchVideo.module.css'

function getYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)
  return match ? match[1] : null
}

// The button itself only ever swaps between the two size variants below
// (see MatchVideo.jsx call sites) — the player used to render inline in
// its place, which broke badly wherever the button sits inside a <table>
// (F1/MotoGP session tables): the 520px iframe had no grid to anchor its
// `grid-column: 1 / -1` reset against, so it just spilled out of the
// table's flow. Now the button always stays put and the player opens in
// a fixed slide-in drawer instead (portalled to document.body so it's
// never at the mercy of whatever ancestor — table cell, flex row — the
// button happens to sit inside).
export default function MatchVideo({ videoUrl, source, embeddable, thumbnailUrl, inline, videoId, videoType, title, subtitle, status }) {
  // Keyed off the video itself (not local component state) — see
  // useVideoPlayerStore: guarantees only one drawer/iframe can ever be
  // alive at once, so opening a different video can't leave a previous
  // one silently playing in the background.
  const videoKey = videoId && videoType ? `${videoType}:${videoId}` : videoUrl
  const open = useVideoPlayerStore(s => s.openKey === videoKey)
  const openVideo = useVideoPlayerStore(s => s.openVideo)
  const closeVideo = useVideoPlayerStore(s => s.closeVideo)
  const [stats, setStats] = useState(null)
  const viewTracked = useRef(false)
  const isFavourited = useUserStore(s => videoId && videoType ? s.isFavourited(videoType, videoId) : false)
  const toggleFavourite = useUserStore(s => s.toggleFavourite)
  const openAuthModal = useUserStore(s => s.openAuthModal)

  // Stats fetch + one-time view increment, only once the drawer actually
  // opens (not on mount) — a session-table row shouldn't count as
  // "viewed" just because it rendered.
  useEffect(() => {
    if (!open || !videoId || !videoType) return
    api.getVideoStats(videoType, videoId).then(setStats).catch(() => {})
    if (!viewTracked.current) {
      viewTracked.current = true
      api.trackVideoView(videoType, videoId).then(res => {
        if (res) setStats(s => s ? { ...s, views: res.views } : s)
      })
    }
  }, [open, videoId, videoType])

  if (!videoUrl) return null

  const youtubeId = source === 'youtube' ? getYouTubeId(videoUrl) : null
  const canEmbed  = embeddable && youtubeId

  const handleFavClick = async () => {
    if (!videoId || !videoType) return
    const result = await toggleFavourite(videoType, videoId)
    if (result.signedOut) { openAuthModal(); return }
    if (result.added || result.removed) {
      setStats(s => s ? { ...s, favourited: Math.max(0, s.favourited + (result.added ? 1 : -1)) } : s)
    }
  }

  return (
    <>
      <button className={inline ? styles.watchBtnInline : styles.watchBtn} onClick={() => openVideo(videoKey)}>
        <span className={styles.playIcon} />
        Watch
      </button>

      {open && createPortal(
        <>
          <div className={styles.drawerBackdrop} onClick={closeVideo} />
          <div className={styles.drawer}>
            <button className={styles.drawerCloseBtn} onClick={closeVideo} aria-label="Close">
              ✕
            </button>

            {(title || subtitle) && (
              <div className={styles.header}>
                {subtitle && <div className={styles.headerSubtitle}>{subtitle}</div>}
                <div className={styles.headerTitleRow}>
                  {title && <div className={styles.headerTitle}>{title}</div>}
                  {status && <StatusBadge status={status} />}
                </div>
              </div>
            )}

            {canEmbed ? (
              <div className={styles.drawerVideoWrap}>
                <iframe
                  width="100%"
                  height="100%"
                  src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
                  title="Match summary"
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className={styles.drawerLinkOut}>
                {thumbnailUrl && <img src={thumbnailUrl} alt="" className={styles.videoThumb} />}
                <a href={videoUrl} target="_blank" rel="noreferrer" className={styles.videoLinkOutLink}>
                  Watch on {source === 'atp' ? 'ATP' : source === 'wta' ? 'WTA' : 'official site'} ↗
                </a>
              </div>
            )}

            {videoId && videoType && (
              <div className={styles.statsRow}>
                <span className={styles.statItem} title="Views">
                  <svg viewBox="0 0 24 24" className={styles.statIcon}>
                    <path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
                  </svg>
                  {stats?.views ?? '—'}
                </span>
                <button className={styles.statItem} onClick={handleFavClick} title="Favourite">
                  <svg viewBox="0 0 24 24" className={`${styles.statIcon} ${isFavourited ? styles.statIconActive : ''}`}>
                    <path d="M12 2.5l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 18.27l-6.18 3.23L7 14.63l-5-4.87 6.91-1z" />
                  </svg>
                  {stats?.favourited ?? '—'}
                </button>
                <button className={styles.statItem} disabled title="Share (coming soon)">
                  <svg viewBox="0 0 24 24" className={styles.statIcon}>
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <path d="M8.6 10.6l6.8-3.9M8.6 13.4l6.8 3.9" stroke="currentColor" strokeWidth="2" fill="none" />
                  </svg>
                  Share
                </button>
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  )
}
