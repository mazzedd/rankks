import styles from './LineB.module.css'
import useAppStore from '../../store/useAppStore'

export default function LineB({ events, tabs, competitionShortName, areaLabel }) {
  const { activeEvent, setEvent, activeTab, setTab } = useAppStore()

  if (events?.length) {
    return (
      <div className={styles.bar}>
        <div className={styles.tabs}>
          {events.map(ev => (
            <button
              key={ev.slug}
              className={`${styles.tab}${activeEvent === ev.slug ? ' ' + styles.active : ''}`}
              onClick={() => setEvent(ev.slug)}
            >
              <span className={styles.label}>{ev.name}</span>
            </button>
          ))}
        </div>
        {competitionShortName && <div className={styles.area}><span>{competitionShortName}</span></div>}
      </div>
    )
  }

  if (!tabs?.length) return null
  return (
    <div className={styles.bar}>
      <div className={styles.tabs}>
        {tabs.map(t => (
          <button
            key={t.tab_key}
            className={`${styles.tab}${activeTab === t.tab_key ? ' ' + styles.active : ''}`}
            onClick={() => setTab(t.tab_key)}
          >
            <span className={styles.label}>{t.tab_name}</span>
          </button>
        ))}
      </div>
      {areaLabel && <div className={styles.area}><span>{areaLabel}</span></div>}
    </div>
  )
}
