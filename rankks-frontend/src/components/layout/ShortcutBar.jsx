import useAppStore from '../../store/useAppStore'
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
    sport_slug: null,
    competition_slug: null,
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
  const { activeCompetition, changeCompetitionWithSport } = useAppStore()

  return (
    <div className={styles.bar}>
      <span className={styles.logo}>RANKKS</span>
      <div className={styles.divider} />
      <div className={styles.logos}>
        {LOGOS.map(item => (
          <button
            key={item.key}
            className={`${styles.logoBtn}${activeCompetition === item.competition_slug ? ' ' + styles.active : ''}${!item.competition_slug ? ' ' + styles.disabled : ''}`}
            onClick={() => item.sport_slug && item.competition_slug && changeCompetitionWithSport(item.sport_slug, item.competition_slug)}
            title={item.alt}
          >
            <img src={item.src} alt={item.alt} className={styles.logoImg} />
          </button>
        ))}
      </div>
    </div>
  )
}
