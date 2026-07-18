import { useRef, useState, useLayoutEffect, useCallback } from 'react'
import styles from './LineA.module.css'
import useAppStore from '../../store/useAppStore'

function ScrollableTabs({ children, brand }) {
  const scrollRef = useRef(null)
  const [canLeft,  setCanLeft]  = useState(false)
  const [canRight, setCanRight] = useState(false)

  const check = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 2)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  // useLayoutEffect runs after every render — catches children updates reliably
  useLayoutEffect(() => {
    check()
  })

  // Scroll listener
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
        style={{ visibility: canLeft ? 'visible' : 'hidden' }}
      >
        ‹
      </button>

      <div className={styles.tabs} ref={scrollRef}>
        {children}
      </div>

      <button
        className={`${styles.arrow} ${styles.arrowRight}`}
        onClick={() => scroll(1)}
        aria-label="Scroll right"
        style={{ visibility: canRight ? 'visible' : 'hidden' }}
      >
        ›
      </button>

      {brand && <div className={styles.brand}>{brand}</div>}
    </div>
  )
}

export default function LineA({ events, competitions, tabs, onTabClick, activeGroupKey, areaLabel, areaIso2 }) {
  const { activeEvent, setEvent, activeCompetition, changeCompetitionWithSport, activeSport, activeTab, setTab } = useAppStore()
  const flagSrc = areaIso2 ? `/media/flags/${areaIso2.toLowerCase()}.svg` : null

  // A synthetic group header (e.g. "Final Tour") is active whenever the
  // real activeTab is one of its children — activeGroupKey is computed
  // by the parent (which has the full, uncollapsed tab list) and passed
  // straight through here, since this component only ever sees the
  // collapsed list and can't determine group membership on its own.
  const isTabActive = (t) => {
    if (t.__isGroupHeader) return t.__groupKey === activeGroupKey
    return activeTab === t.tab_key
  }

  const handleClick = (tabKey) => {
    if (onTabClick) onTabClick(tabKey)
    else setTab(tabKey)
  }

  const brandEl = (areaLabel || flagSrc) ? (
    <>
      {areaLabel && <span className={styles.areaLabel}>{areaLabel}</span>}
      {flagSrc && (
        <img src={flagSrc} alt={areaLabel} className={styles.flag}
          onError={e => e.target.style.display = 'none'} />
      )}
    </>
  ) : null

  if (competitions?.length) {
    return (
      <div className={styles.bar}>
        <ScrollableTabs>
          {competitions.map(c => (
            <button
              key={c.slug}
              className={`${styles.tab}${activeCompetition === c.slug ? ' ' + styles.active : ''}`}
              onClick={() => changeCompetitionWithSport(activeSport, c.slug)}
            >
              <span className={styles.label}>{c.name}</span>
            </button>
          ))}
        </ScrollableTabs>
      </div>
    )
  }

  if (tabs?.length) {
    // Same split LineB uses: keep the videos tab out of the generic loop
    // so it always renders with the ▶ icon, matching Line B exactly.
    const mainTabs  = tabs.filter(t => t.tab_key !== 'videos')
    const videosTab = tabs.find(t  => t.tab_key === 'videos')

    return (
      <div className={styles.bar}>
        <ScrollableTabs brand={brandEl}>
          {mainTabs.map(t => (
            <button
              key={t.tab_key}
              className={`${styles.tab}${isTabActive(t) ? ' ' + styles.active : ''}`}
              onClick={() => handleClick(t.tab_key)}
            >
              <span className={styles.label}>{t.tab_name}</span>
            </button>
          ))}
          {videosTab && (
            <button
              key={videosTab.tab_key}
              className={`${styles.tab}${activeTab === videosTab.tab_key ? ' ' + styles.active : ''}`}
              onClick={() => handleClick(videosTab.tab_key)}
            >
              <span className={styles.label}>▶ {videosTab.tab_name}</span>
            </button>
          )}
        </ScrollableTabs>
      </div>
    )
  }

  if (!events?.length) return null
  return (
    <div className={styles.bar}>
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
    </div>
  )
}
