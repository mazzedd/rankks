import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Layout.module.css'

const nav = [
  { to: '/',             label: 'Dashboard',    icon: '⊞' },
  { to: '/providers',    label: 'Providers',    icon: '🔌' },
  { to: '/competitions', label: 'Competitions', icon: '🏆' },
  { to: '/default-page', label: 'Default Page', icon: '🎯' },
  { to: '/clubs',        label: 'Clubs',        icon: '🏟️' },
  { to: '/brands',       label: 'Brands',       icon: '🤝' },
  { to: '/match-videos',    label: 'Match Videos',    icon: '🎬' },
  { to: '/iconic-moments',  label: 'Iconic Moments',  icon: '⭐' },
  { to: '/entities',     label: 'Entities',     icon: '🏛' },
  { to: '/athletes',     label: 'Athletes',     icon: '👤' },
  {
    group: 'Subtitles', icon: '📝',
    items: [
      { to: '/subtitles',          label: 'Subtitles' },
      { to: '/competition-naming', label: 'Competition Naming' },
      { to: '/race-naming',        label: 'Race Naming' },
    ],
  },
  {
    group: 'Followers', icon: '⭐',
    items: [
      { to: '/followers/leagues', label: 'Leagues' },
    ],
  },
  { to: '/competition-logos',  label: 'Competition Logos',  icon: '🖼️' },
  { to: '/entity-logos',       label: 'Entity Logos',       icon: '🎨' },
  { to: '/reports',            label: 'My Reports',         icon: '📄' },
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
          {nav.map(item => item.group ? (
            <div key={item.group} className={styles.navGroup}>
              <div className={styles.navGroupLabel}>
                <span className={styles.navIcon}>{item.icon}</span>
                {item.group}
              </div>
              {item.items.map(sub => (
                <NavLink
                  key={sub.to}
                  to={sub.to}
                  className={({ isActive }) =>
                    `${styles.navItem} ${styles.navSubItem} ${isActive ? styles.active : ''}`
                  }
                >
                  {sub.label}
                </NavLink>
              ))}
            </div>
          ) : (
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
