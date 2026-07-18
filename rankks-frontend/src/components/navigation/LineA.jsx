import { useRef, useState, useLayoutEffect, useCallback } from 'react'
import styles from './LineA.module.css'
import useAppStore from '../../store/useAppStore'
import Flag from '../shared/Flag'

// Iconic Moments and All-Time are identified by convention, not by a
// per-sport flag: tab_key 'videos' / event.is_gallery for Iconic Moments,
// tab_key 'all-time' / event.name 'All-Time' for All-Time. Any sport that
// provides a tab or event matching these gets the pinned treatment for
// free — no per-sport branching needed (see CLAUDE.md: convention over
// configuration).
function PinnedTab({ label, icon, active, onClick }) {
  return (
    <button
      className={`${styles.pinnedTab}${active ? ' ' + styles.active : ''}`}
      onClick={onClick}
    >
      {icon && <span className={styles.playIcon} />}
      {label}
    </button>
  )
}

function ScrollableTabs({ children, brand, pinned }) {
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

      {pinned && <div className={styles.pinnedGroup}>{pinned}</div>}
      {brand && <div className={styles.brand}>{brand}</div>}
    </div>
  )
}

export default function LineA({ events, competitions, tabs, onTabClick, activeGroupKey, areaLabel, areaIso2 }) {
  const { activeEvent, setEvent, activeCompetition, changeCompetitionWithSport, activeSport, activeTab, setTab } = useAppStore()

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

  const brandEl = (areaLabel || areaIso2) ? (
    <>
      {areaLabel && <span className={styles.areaLabel}>{areaLabel}</span>}
      <Flag iso2={areaIso2} name={areaLabel} className={styles.flag} />
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
    // Iconic Moments (tab_key 'videos') and All-Time (tab_key 'all-time')
    // are pulled out of the scrollable loop entirely and pinned to the
    // right — always visible regardless of how many tabs there are to
    // scroll through (see LineA.module.css .pinnedGroup/.pinnedTab).
    const mainTabs   = tabs.filter(t => t.tab_key !== 'videos' && t.tab_key !== 'all-time')
    const videosTab  = tabs.find(t  => t.tab_key === 'videos')
    const allTimeTab = tabs.find(t  => t.tab_key === 'all-time')

    const pinnedEls = (videosTab || allTimeTab) ? (
      <>
        {videosTab && (
          <PinnedTab
            label={videosTab.tab_name}
            icon
            active={activeTab === videosTab.tab_key}
            onClick={() => handleClick(videosTab.tab_key)}
          />
        )}
        {allTimeTab && (
          <PinnedTab
            label={allTimeTab.tab_name}
            active={activeTab === allTimeTab.tab_key}
            onClick={() => handleClick(allTimeTab.tab_key)}
          />
        )}
      </>
    ) : null

    return (
      <div className={styles.bar}>
        <ScrollableTabs brand={brandEl} pinned={pinnedEls}>
          {mainTabs.map(t => (
            <button
              key={t.tab_key}
              className={`${styles.tab}${isTabActive(t) ? ' ' + styles.active : ''}`}
              onClick={() => handleClick(t.tab_key)}
            >
              <span className={styles.label}>{t.tab_name}</span>
            </button>
          ))}
        </ScrollableTabs>
      </div>
    )
  }

  if (!events?.length) return null

  // Same pinning convention as the tabs-branch above, keyed off the
  // computed is_gallery flag (Iconic Moments) and the event's name
  // (All-Time) since events don't carry a tab_key.
  const mainEvents = events.filter(ev => !ev.is_gallery && ev.name !== 'All-Time')
  const galleryEv  = events.find(ev => ev.is_gallery)
  const allTimeEv  = events.find(ev => ev.name === 'All-Time')

  const pinnedEvEls = (galleryEv || allTimeEv) ? (
    <>
      {galleryEv && (
        <PinnedTab
          label={galleryEv.name}
          icon="▶ "
          active={activeEvent === galleryEv.slug}
          onClick={() => setEvent(galleryEv.slug)}
        />
      )}
      {allTimeEv && (
        <PinnedTab
          label={allTimeEv.name}
          active={activeEvent === allTimeEv.slug}
          onClick={() => setEvent(allTimeEv.slug)}
        />
      )}
    </>
  ) : null

  return (
    <div className={styles.bar}>
      <ScrollableTabs pinned={pinnedEvEls}>
        {mainEvents.map(ev => (
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
