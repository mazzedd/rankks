import { useRef, useState, useLayoutEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import styles from './LineB.module.css'
import useAppStore from '../../store/useAppStore'
import { pathForTab, pathForEvent } from '../../routing/urlSchema'
import { isModifiedClick } from '../../routing/isModifiedClick'

// Exported — MmaEventTemplate.jsx has no dedicated result_tabs-driven Line
// B of its own (it drives this bar from local component state instead),
// so it builds its tab buttons directly rather than through this file's
// own LineB() below. It still needs the SAME scroll-arrow behavior this
// wraps around `.tabs`, not a plain overflow:hidden div with no way to
// reach whatever's clipped off the right edge (Mohamed 2026-08-17: "no
// slide, hard/impossible to reach next item").
export function ScrollableTabs({ children }) {
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
  const store = useAppStore()
  const { activeEvent, setEvent, activeTab, setTab } = store

  if (events?.length) {
    return (
      <div className={`${styles.bar}${muted ? ' ' + styles.barMuted : ''}`}>
        <ScrollableTabs>
          {events.map(ev => (
            // tabAfter=store.activeTab (not the null LineA.jsx's selectEvent
            // uses) — this bare setEvent() call, unlike LineA's, doesn't
            // touch activeTab at all.
            <Link
              key={ev.slug}
              to={pathForEvent(store, ev.slug, store.activeTab)}
              className={`${styles.tab}${activeEvent === ev.slug ? ' ' + styles.active : ''}`}
              onClick={e => !isModifiedClick(e) && setEvent(ev.slug)}
            >
              <span className={styles.label}>{ev.name}</span>
            </Link>
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
          <Link
            key={t.tab_key}
            to={pathForTab(store, t.tab_key)}
            className={`${styles.tab}${activeTab === t.tab_key ? ' ' + styles.active : ''}`}
            onClick={e => !isModifiedClick(e) && setTab(t.tab_key)}
          >
            <span className={styles.label}>{t.tab_name}</span>
          </Link>
        ))}
        {playersTabs.map(t => (
          <Link
            key={t.tab_key}
            to={pathForTab(store, t.tab_key)}
            className={[
              styles.tab,
              styles['players-list'],
              activeTab === t.tab_key ? styles.active : '',
            ].filter(Boolean).join(' ')}
            onClick={e => !isModifiedClick(e) && setTab(t.tab_key)}
          >
            <span className={styles.label}>{t.tab_name}</span>
          </Link>
        ))}
        {videosTab && (
          <Link
            key={videosTab.tab_key}
            to={pathForTab(store, videosTab.tab_key)}
            className={`${styles.tab}${activeTab === videosTab.tab_key ? ' ' + styles.active : ''}`}
            onClick={e => !isModifiedClick(e) && setTab(videosTab.tab_key)}
          >
            <span className={styles.label}>▶ {videosTab.tab_name}</span>
          </Link>
        )}
      </ScrollableTabs>
    </div>
  )
}
