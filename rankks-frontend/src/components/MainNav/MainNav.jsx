import { useEffect } from 'react'
import useAppStore from '../../store/useAppStore'   // ← singular: matches your actual folder
import { api } from '../../services/api'
import styles from './MainNav.module.css'

export default function MainNav() {
  const { sports, setSports, activeSport, setSport } = useAppStore()

  useEffect(() => {
    api.getSports().then(s => setSports(s || [])).catch(console.error)
  }, [])

  return (
    <nav className={styles.nav}>
      {sports.map(s => (
        <button
          key={s.slug}
          className={`${styles.item}${activeSport === s.slug ? ' ' + styles.active : ''}`}
          onClick={() => setSport(s.slug)}
        >
          {s.name}
        </button>
      ))}
    </nav>
  )
}
