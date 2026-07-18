import { useState } from 'react'
import styles from './MatchVideo.module.css'

function getYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)
  return match ? match[1] : null
}

export default function MatchVideo({ videoUrl, source, embeddable, thumbnailUrl }) {
  const [open, setOpen] = useState(false)
  if (!videoUrl) return null

  const youtubeId = source === 'youtube' ? getYouTubeId(videoUrl) : null
  const canEmbed  = embeddable && youtubeId

  if (!open) {
    return (
      <button className={styles.watchBtn} onClick={() => setOpen(true)}>
        ▶ Watch summary
      </button>
    )
  }

  if (canEmbed) {
    return (
      <div className={styles.videoEmbed}>
        <iframe
          width="100%"
          height="520"
          src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
          title="Match summary"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <button className={styles.watchBtnClose} onClick={() => setOpen(false)}>Close</button>
      </div>
    )
  }

  // Not embeddable (e.g. ATP/WTA official pages) — link out instead
  return (
    <div className={styles.videoLinkOut}>
      {thumbnailUrl && <img src={thumbnailUrl} alt="" className={styles.videoThumb} />}
      <a href={videoUrl} target="_blank" rel="noreferrer" className={styles.videoLinkOutLink}>
        Watch on {source === 'atp' ? 'ATP' : source === 'wta' ? 'WTA' : 'official site'} ↗
      </a>
      <button className={styles.watchBtnClose} onClick={() => setOpen(false)}>Close</button>
    </div>
  )
}
