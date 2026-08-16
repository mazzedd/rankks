import useAppStore from '../../store/useAppStore'
import useUserStore from '../../store/useUserStore'
import styles from './ShortcutBar.module.css'

// Static logo shortcuts — add sport_slug + competition_slug to make clickable
const LOGOS = [
  {
    key: 'ligue-1',
    src: '/media/shortcut/ligue-1.png',
    alt: 'Ligue 1',
    sport_slug: 'football',
    competition_slug: 'ligue-1-france',
  },
  {
    key: 'ucl',
    src: '/media/shortcut/champions-league.png',
    alt: 'Champions League',
    sport_slug: 'football',
    competition_slug: 'champions-league-uefa',
  },
  {
    key: 'atp',
    src: '/media/shortcut/atp.png',
    alt: 'ATP',
    // ATP has no single competition_slug of its own (it's a tour spanning
    // several categories) — tennisHub routes through goToTennisHub instead
    // of the generic sport_slug+competition_slug -> changeCompetitionWithSport
    // path every other icon here uses.
    tennisHub: 'atp',
  },
  {
    key: 'nba',
    src: '/media/shortcut/nba.png',
    alt: 'NBA',
    sport_slug: null,
    competition_slug: null,
  },
  {
    key: 'pga',
    src: '/media/shortcut/pga.png',
    alt: 'PGA',
    sport_slug: null,
    competition_slug: null,
  },
  {
    key: 'premier-league',
    src: '/media/shortcut/premier-league.png',
    alt: 'Premier League',
    sport_slug: null,
    competition_slug: null,
  },
]

export default function ShortcutBar() {
  const { activeSport, activeCompetition, activeHomeHub, changeCompetitionWithSport, goToTennisHub, goHome } = useAppStore()
  const user             = useUserStore(s => s.user)
  const openAuthModal    = useUserStore(s => s.openAuthModal)
  const openAccountModal = useUserStore(s => s.openAccountModal)

  const initial = (user?.display_name || user?.email || '?')[0].toUpperCase()

  const isActive = (item) => item.tennisHub
    ? activeSport === 'tennis' && activeHomeHub === item.tennisHub
    : activeCompetition === item.competition_slug
  const isDisabled = (item) => !item.tennisHub && !item.competition_slug

  return (
    // Outer element is what App.module.css's `.shell > :nth-child(1)` rule
    // pins sticky + full-bleeds (see .stickyRow::before below) — kept
    // separate from .bar itself because .bar has its own overflow-x:auto
    // (lets the whole row scroll horizontally on narrow viewports) and any
    // element's own overflow clips its descendants' painted area, which
    // silently ate the ::before bleed when it lived directly on .bar
    // (found 2026-08-16: the RANKKS-logo bar kept showing white margins on
    // wide screens while MainNav/YearSelector, no overflow on their own
    // root, bled correctly).
    <div className={styles.stickyRow}>
      <div className={styles.bar}>
        <button type="button" className={styles.logoBtnLink} onClick={goHome} title="RANKKS Home">
          <img src="/media/logos/rankks-logo.png" alt="RANKKS" className={styles.logo} />
        </button>
        <div className={styles.divider} />
        <div className={styles.logos}>
          {LOGOS.map(item => (
            <button
              key={item.key}
              className={`${styles.logoBtn}${isActive(item) ? ' ' + styles.active : ''}${isDisabled(item) ? ' ' + styles.disabled : ''}`}
              onClick={() => {
                if (item.tennisHub) goToTennisHub(item.tennisHub)
                else if (item.sport_slug && item.competition_slug) changeCompetitionWithSport(item.sport_slug, item.competition_slug)
              }}
              title={item.alt}
            >
              <img src={item.src} alt={item.alt} className={styles.logoImg} />
            </button>
          ))}
        </div>

        <div className={styles.accountArea}>
          {user ? (
            <button type="button" className={styles.avatarBtn} onClick={openAccountModal} title="My Account">
              {initial}
            </button>
          ) : (
            <button type="button" className={styles.signInBtn} onClick={() => openAuthModal('login')}>
              Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
