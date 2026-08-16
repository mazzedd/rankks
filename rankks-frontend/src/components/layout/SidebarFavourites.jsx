import useUserStore from '../../store/useUserStore'
import useAppStore from '../../store/useAppStore'
import styles from './sidebarStyles.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

// Mirrors rankks-api/src/config/favouriteCaps.js's competition cap — the
// number shown in the empty-state hint below, since this sidebar panel
// only ever exposes favouriting a competition (via CompBtn's star).
const COMPETITION_CAP = 5

function FavRow({ f, entityType }) {
  const { changeCompetitionWithSport, setTab } = useAppStore()

  // Only competition rows navigate anywhere — clubs/athletes have no
  // standalone page of their own yet. Lands on the competition's Home
  // tab (see Sidebar.jsx's goToCompetitionHome for the Topics-list
  // equivalent), using f.slug/f.sport_slug (the joined display fields
  // favourites.js's GET route returns for entity_type='competition').
  const goHome = entityType === 'competition' && f.slug && f.sport_slug
    ? () => { changeCompetitionWithSport(f.sport_slug, f.slug, f.category_slug); setTab('home') }
    : undefined

  return (
    <div className={styles.row} onClick={goHome} style={goHome ? { cursor: 'pointer' } : undefined}>
      {f.image_url
        ? <img src={resolveImg(f.image_url)} alt="" className={styles.rowImg} />
        : <span className={styles.rowFallback}>{(f.name || '?')[0]}</span>}
      <span className={`${styles.rowName} ${styles.sidebarSport}`}>{f.name || `#${f.entity_id}`}</span>
      {/* Wired to real "new result" detection later — stays inert until
          the API actually returns has_news on a favourite row. */}
      {f.has_news && <span className={styles.notifyDot} title="New result" />}
    </div>
  )
}

// Full-panel FAVOURITES view for the sidebar's TOPICS/FAVOURITES toggle
// (Sidebar.jsx) — three states depending on auth/data, no collapse chrome
// since it now occupies the whole panel rather than a small stacked card.
export default function SidebarFavourites() {
  const user             = useUserStore(s => s.user)
  const favourites       = useUserStore(s => s.favourites)
  const openAccountModal = useUserStore(s => s.openAccountModal)
  const openAuthModal    = useUserStore(s => s.openAuthModal)

  if (!user) {
    return (
      <div className={styles.favouritesPanel}>
        <span className={`${styles.emptyHint} ${styles.sidebarSport}`}>
          Sign up to follow your favourite leagues, clubs and athletes.
        </span>
        <button type="button" className={styles.manageLink} onClick={() => openAuthModal('signup')}>
          Create account now
        </button>
      </div>
    )
  }

  const competitions = favourites.competition || []
  const clubs        = favourites.club || []
  const athletes      = favourites.athlete || []
  const total = competitions.length + clubs.length + athletes.length

  if (total === 0) {
    return (
      <div className={styles.favouritesPanel}>
        <span className={`${styles.emptyHint} ${styles.sidebarSport}`}>
          Add up to {COMPETITION_CAP} favourites — star a league, club or athlete to follow it here.
        </span>
      </div>
    )
  }

  return (
    <div className={styles.favouritesPanel}>
      {competitions.length > 0 && (
        <div className={styles.favGroup}>
          <div className={styles.sidebarFavouriteTitle}>Leagues</div>
          {competitions.map(f => <FavRow key={f.id} f={f} entityType="competition" />)}
        </div>
      )}

      {clubs.length > 0 && (
        <div className={styles.favGroup}>
          <div className={styles.sidebarFavouriteTitle}>Clubs</div>
          {clubs.map(f => <FavRow key={f.id} f={f} />)}
        </div>
      )}

      {athletes.length > 0 && (
        <div className={styles.favGroup}>
          <div className={styles.sidebarFavouriteTitle}>Athletes</div>
          {athletes.map(f => <FavRow key={f.id} f={f} />)}
        </div>
      )}

      <button type="button" className={styles.manageLink} onClick={openAccountModal}>
        Manage Favourites
      </button>
    </div>
  )
}
