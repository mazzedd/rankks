import './index.css'
import ShortcutBar from './components/layout/ShortcutBar'
import MainNav from './components/layout/MainNav'
import Sidebar from './components/layout/Sidebar'
import ContentArea from './components/ContentArea/ContentArea'
import Footer from './components/layout/Footer'
import styles from './App.module.css'

export default function App() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.shell}>
        <ShortcutBar />
        <MainNav />
        <Sidebar />
        <ContentArea />
        <Footer />
      </div>
    </div>
  )
}
