import { useAuth } from '../context/AuthContext'
import styles from './Dashboard.module.css'

const cards = [
  { label: 'Competitions', desc: 'Manage colours and metadata', to: '/competitions', icon: '🏆' },
  { label: 'Entities',     desc: 'Clubs, national teams, venues', to: '/entities',     icon: '🏛' },
  { label: 'Athletes',     desc: 'Portrait paths and profiles',  to: '/athletes',     icon: '👤' },
]

export default function Dashboard() {
  const { username } = useAuth()

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Dashboard</h1>
          <p className={styles.welcome}>Welcome back, {username}</p>
        </div>
        <div className={styles.version}>v2.0</div>
      </div>

      <div className={styles.grid}>
        {cards.map(c => (
          <a href={c.to} key={c.to} className={styles.card}>
            <div className={styles.cardIcon}>{c.icon}</div>
            <div className={styles.cardLabel}>{c.label}</div>
            <div className={styles.cardDesc}>{c.desc}</div>
          </a>
        ))}
      </div>
    </div>
  )
}
