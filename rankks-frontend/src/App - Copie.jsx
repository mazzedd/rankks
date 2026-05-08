import './index.css'
import ShortcutBar from './components/ShortcutBar/ShortcutBar'
import MainNav from './components/MainNav/MainNav'
import Sidebar from './components/Sidebar/Sidebar'
import ContentArea from './components/ContentArea/ContentArea'
import Footer from './components/Footer/Footer'
import styles from './App.module.css'

export default function App() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.shell}>
        <ShortcutBar />
        <MainNav />
        <Sidebar />
        <ContentArea />
      </div>
      <Footer />
    </div>
  )
}
