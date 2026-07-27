import useUserStore from '../../store/useUserStore'
import styles from './SidebarFollowing.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

// Compact "Following" card pinned at the top of the Sidebar — the athlete/
// club counterpart to ShortcutBar's favourited-competitions row. Global
// across sports (matches ESPN's own sidebar Favorites card), not scoped to
// the currently active sport, so a football club follow still shows up
// while browsing tennis. Hidden entirely when signed out or empty — no
// dedicated top-level nav row for this (see Build Log discussion).
export default function SidebarFollowing() {
  const user             = useUserStore(s => s.user)
  const favourites       = useUserStore(s => s.favourites)
  const openAccountModal = useUserStore(s => s.openAccountModal)

  if (!user) return null

  const items = [...(favourites.club || []), ...(favourites.athlete || [])]
  if (!items.length) return null

  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.title}>Following</span>
        <button
          type="button"
          className={styles.gearBtn}
          onClick={openAccountModal}
          aria-label="Manage favourites"
          title="Manage favourites"
        >
          ⚙
        </button>
      </div>

      {items.map(f => (
        <div key={f.id} className={styles.row}>
          {f.image_url
            ? <img src={resolveImg(f.image_url)} alt="" className={styles.rowImg} />
            : <span className={styles.rowFallback}>{(f.name || '?')[0]}</span>}
          <span className={styles.rowName}>{f.name || `#${f.entity_id}`}</span>
        </div>
      ))}

      <button type="button" className={styles.manageLink} onClick={openAccountModal}>
        Manage Favourites
      </button>
    </div>
  )
}
