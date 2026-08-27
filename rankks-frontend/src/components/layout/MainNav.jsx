import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import useAppStore from '../../store/useAppStore'   // ← singular: matches your actual folder
import useUserStore from '../../store/useUserStore'
import { api } from '../../services/api'
import { stateToPath, pathForSport, pathForCompetition, pathForTennisHub } from '../../routing/urlSchema'
import { isModifiedClick } from '../../routing/isModifiedClick'
import styles from './MainNav.module.css'

// RANKKS logo + Sign in/account absorbed from the removed ShortcutBar
// (Mohamed 2026-08-21: "full remove shortcut bar... Place
// logo-rankks-neutral.png first item before Football, Tennis, etc. And
// sign in at the very right") — same goHome/openAuthModal/openAccountModal
// actions ShortcutBar used, just relocated into this single top bar.
export default function MainNav() {
  const store = useAppStore()
  const { sports, setSports, activeSport, activeCategory, activeCompetition, setSport, changeCompetitionWithSport, goToTennisHub, goHome } = store
  const { openAccountPage } = store
  const user             = useUserStore(s => s.user)
  const openAuthModal    = useUserStore(s => s.openAuthModal)
  const initial = (user?.display_name || user?.email || '?')[0].toUpperCase()

  useEffect(() => {
    api.getSports().then(s => setSports(s || [])).catch(console.error)
  }, [])

  // Tennis has no single "the" competition the way football/basketball/
  // racing do (their own default_competition_slug — Ligue 1/NBA/F1 — is
  // the right landing page for those) — it's a tour spanning many
  // tournaments, same reason Sidebar.jsx/ContentArea.jsx already give it
  // its own branches throughout. The backend's default_competition_slug
  // for tennis is 'wimbledon', which used to send "Tennis" clicks straight
  // to Wimbledon's own page instead of the Home ATP hub (found 2026-08-10,
  // same bug class as the ShortcutBar ATP icon). goToTennisHub is the same
  // action that icon uses.
  const handleClick = (s) => {
    if (s.slug === 'tennis') { goToTennisHub('atp'); return }
    if (s.default_competition_slug) {
      changeCompetitionWithSport(s.slug, s.default_competition_slug, s.default_competition_category_slug)
    } else {
      setSport(s.slug)
    }
  }

  // href mirrors handleClick's own branches exactly, so hover/copy-link on
  // the <Link> below shows the real destination (Mohamed 2026-08-21: "On
  // mouse over, i dont see URL").
  const hrefFor = (s) => {
    if (s.slug === 'tennis') return pathForTennisHub(store, 'atp')
    if (s.default_competition_slug) {
      return pathForCompetition(store, s.slug, s.default_competition_slug, s.default_competition_category_slug)
    }
    return pathForSport(store, s.slug)
  }

  // Homepage silently defaults activeSport to 'tennis' just so the
  // Sidebar has real content to show (HomepageTemplate.jsx) — that's not
  // the user actually navigating into Tennis, so it shouldn't light up
  // this tab too (Mohamed 2026-08-20: "clicking RANKKS home again, tennis
  // in main bar is underlined pink. remove that"). No other sport reaches
  // activeSport===slug without a real category/competition already being
  // set (every other click path sets one immediately), so this check is
  // scoped to tennis only rather than applied to every sport.
  const isActive = (s) => {
    if (activeSport !== s.slug) return false
    if (s.slug === 'tennis') return !!(activeCategory || activeCompetition)
    return true
  }

  return (
    <nav className={styles.nav}>
      <Link to={stateToPath({ ...store, activeSport: null, activeCompetition: null, activeCategory: null })} className={styles.logoBtn} onClick={e => !isModifiedClick(e) && goHome()} title="RANKKS Home">
        <img src="/media/logos/rankks-logo-neutral.png" alt="RANKKS" className={styles.logo} />
      </Link>
      {sports.map(s => (
        <Link
          key={s.slug}
          to={hrefFor(s)}
          className={`${styles.item}${isActive(s) ? ' ' + styles.active : ''}`}
          onClick={e => !isModifiedClick(e) && handleClick(s)}
        >
          {s.name}
        </Link>
      ))}
      <div className={styles.accountArea}>
        {user ? (
          <Link
            to={stateToPath({ ...store, accountPage: true })}
            className={styles.avatarBtn}
            onClick={e => !isModifiedClick(e) && openAccountPage()}
            title="My Account"
          >
            {initial}
          </Link>
        ) : (
          <button type="button" className={styles.signInBtn} onClick={() => openAuthModal('login')}>
            Sign in
          </button>
        )}
      </div>
    </nav>
  )
}
