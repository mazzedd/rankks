import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Layout.module.css'

const nav = [
  { to: '/',             label: 'Dashboard',    icon: '⊞' },
  { to: '/competitions', label: 'Competitions', icon: '🏆' },
  { to: '/clubs',        label: 'Clubs',        icon: '🏟️' },
  { to: '/match-videos',    label: 'Match Videos',    icon: '🎬' },
  { to: '/iconic-moments',  label: 'Iconic Moments',  icon: '⭐' },
  { to: '/entities',     label: 'Entities',     icon: '🏛' },
  { to: '/athletes',     label: 'Athletes',     icon: '👤' },
]

export default function Layout() {
  const { username, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <div className={styles.logo}>RANK<span>KS</span></div>
          <div className={styles.logoSub}>Admin</div>
        </div>

        <nav className={styles.nav}>
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.active : ''}`
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.sidebarBottom}>
          <div className={styles.user}>
            <div className={styles.userAvatar}>{username?.[0]?.toUpperCase()}</div>
            <span className={styles.userName}>{username}</span>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
