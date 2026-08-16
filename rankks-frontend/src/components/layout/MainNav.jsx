import { useEffect } from 'react'
import useAppStore from '../../store/useAppStore'   // ← singular: matches your actual folder
import { api } from '../../services/api'
import styles from './MainNav.module.css'

export default function MainNav() {
  const { sports, setSports, activeSport, setSport, changeCompetitionWithSport, goToTennisHub } = useAppStore()

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

  return (
    <nav className={styles.nav}>
      {sports.map(s => (
        <button
          key={s.slug}
          className={`${styles.item}${activeSport === s.slug ? ' ' + styles.active : ''}`}
          onClick={() => handleClick(s)}
        >
          {s.name}
        </button>
      ))}
    </nav>
  )
}
