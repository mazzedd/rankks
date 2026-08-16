import { useEffect } from 'react'
import './index.css'
import ShortcutBar from './components/layout/ShortcutBar'
import MainNav from './components/layout/MainNav'
import YearSelector from './components/navigation/YearSelector'
import Sidebar from './components/layout/Sidebar'
import ContentArea from './components/ContentArea/ContentArea'
import Footer from './components/layout/Footer'
import AuthModal from './components/shared/AuthModal'
import MyAccountModal from './components/shared/MyAccountModal'
import useUserStore from './store/useUserStore'
import useAppStore from './store/useAppStore'
import styles from './App.module.css'

export default function App() {
  const token = useUserStore(s => s.token)
  const loadFavourites = useUserStore(s => s.loadFavourites)
  const yearRange = useAppStore(s => s.yearRange)

  // Rehydrate favourites once on load if a session was persisted from a
  // previous visit (zustand's persist middleware only restores token/user,
  // never the favourites list itself — see useUserStore's partialize).
  useEffect(() => {
    if (token) loadFavourites()
  }, [])

  return (
    <div className={styles.wrapper}>
      <div className={styles.shell}>
        <ShortcutBar />
        <MainNav />
        {/* Full-width row, own grid track — see App.module.css. Range
            (min/max/edition years) is published by whichever content area
            is active via useAppStore's yearRange, not passed as a prop —
            this bar no longer lives inside any one sport's content area. */}
        <YearSelector
          foundedYear={yearRange.minYear}
          dissolvedYear={yearRange.maxYear}
          editionYears={yearRange.editionYears}
          validFrom={yearRange.validFrom}
          validTo={yearRange.validTo}
        />
        <Sidebar />
        <ContentArea />
        <Footer />
      </div>
      <AuthModal />
      <MyAccountModal />
    </div>
  )
}
