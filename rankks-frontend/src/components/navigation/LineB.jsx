import { useRef, useState, useLayoutEffect, useCallback } from 'react'
import styles from './LineB.module.css'
import useAppStore from '../../store/useAppStore'

function ScrollableTabs({ children }) {
  const scrollRef = useRef(null)
  const [canLeft,  setCanLeft]  = useState(false)
  const [canRight, setCanRight] = useState(false)

  const check = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 2)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useLayoutEffect(() => { check() })

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', check, { passive: true })
    return () => el.removeEventListener('scroll', check)
  }, [check])

  const scroll = (dir) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }

  return (
    <div className={styles.scrollWrapper}>
      <button
        className={`${styles.arrow} ${styles.arrowLeft}`}
        onClick={() => scroll(-1)}
        aria-label="Scroll left"
        style={{ display: canLeft ? 'flex' : 'none' }}
      >‹</button>

      <div className={styles.tabs} ref={scrollRef}>
        {children}
      </div>

      <button
        className={`${styles.arrow} ${styles.arrowRight}`}
        onClick={() => scroll(1)}
        aria-label="Scroll right"
        style={{ display: canRight ? 'flex' : 'none' }}
      >›</button>
    </div>
  )
}

export default function LineB({ events, tabs, competitionShortName, muted }) {
  const { activeEvent, setEvent, activeTab, setTab } = useAppStore()

  if (events?.length) {
    return (
      <div className={`${styles.bar}${muted ? ' ' + styles.barMuted : ''}`}>
        <ScrollableTabs>
          {events.map(ev => (
            <button
              key={ev.slug}
              className={`${styles.tab}${activeEvent === ev.slug ? ' ' + styles.active : ''}`}
              onClick={() => setEvent(ev.slug)}
            >
              <span className={styles.label}>{ev.name}</span>
            </button>
          ))}
        </ScrollableTabs>
        {competitionShortName && <div className={styles.area}><span>{competitionShortName}</span></div>}
      </div>
    )
  }

  if (!tabs?.length) return null

  // Three groups, rendered in this order: main result tabs, players-list tabs, videos tab last.
  const mainTabs    = tabs.filter(t => !t.tab_key.startsWith('players-') && t.tab_key !== 'videos')
  const playersTabs = tabs.filter(t =>  t.tab_key.startsWith('players-'))
  const videosTab   = tabs.find(t  =>  t.tab_key === 'videos')

  return (
    <div className={`${styles.bar}${muted ? ' ' + styles.barMuted : ''}`}>
      <ScrollableTabs>
        {mainTabs.map(t => (
          <button
            key={t.tab_key}
            className={`${styles.tab}${activeTab === t.tab_key ? ' ' + styles.active : ''}`}
            onClick={() => setTab(t.tab_key)}
          >
            <span className={styles.label}>{t.tab_name}</span>
          </button>
        ))}
        {playersTabs.map(t => (
          <button
            key={t.tab_key}
            className={[
              styles.tab,
              styles['players-list'],
              activeTab === t.tab_key ? styles.active : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setTab(t.tab_key)}
          >
            <span className={styles.label}>{t.tab_name}</span>
          </button>
        ))}
        {videosTab && (
          <button
            key={videosTab.tab_key}
            className={`${styles.tab}${activeTab === videosTab.tab_key ? ' ' + styles.active : ''}`}
            onClick={() => setTab(videosTab.tab_key)}
          >
            <span className={styles.label}>▶ {videosTab.tab_name}</span>
          </button>
        )}
      </ScrollableTabs>
    </div>
  )
}
