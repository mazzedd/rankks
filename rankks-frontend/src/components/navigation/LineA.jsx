import { useRef, useState, useLayoutEffect, useCallback } from 'react'
import styles from './LineA.module.css'
import useAppStore from '../../store/useAppStore'
import Flag from '../shared/Flag'
import { shortTournamentLabel } from '../../utils/tournamentLabel'

// Iconic Moments and All-Time are identified by convention, not by a
// per-sport flag: tab_key 'videos' / event.is_gallery for Iconic Moments,
// tab_key 'all-time' / event.name 'All-Time' for All-Time. Any sport that
// provides a tab or event matching these gets the pinned treatment for
// free — no per-sport branching needed (see CLAUDE.md: convention over
// configuration). Both render icon-only (alt text "Watch center"/
// "All-time stats"), pinned RIGHT at the very end of the bar, after the
// scrollable main items — not grouped with Home and not in the scrollable
// strip itself.
// Home is pinned to the LEFT, outside the scrollable region entirely
// (Part 1 of Line A) — always visible with every other Line A item
// scrolling underneath it, rather than scrolling away as a regular first
// tab would. Iconic Moments/Totals (Part 3) are pinned separately on the
// RIGHT — see pinnedRightEls/watchTotalsRightEls below.
// No house icon (removed 2026-08-16, Mohamed: "button remains, only HOME
// ICON is removed, keep purple bgcolor, just the icon is removed") — the
// purple pinned badge and its label (e.g. "ATP"/"Home"/a tab's own name)
// stay exactly as before, just text-only now.
function HomeButton({ label, active, onClick }) {
  return (
    <button
      className={`${styles.tab} ${styles.homePinned}${active ? ' ' + styles.active : ''}`}
      onClick={onClick}
    >
      <span className={styles.label}>{label || 'Home'}</span>
    </button>
  )
}

// iconOnly drops the text label entirely (icon + tooltip/aria-label only)
// — every current call site is icon-only, per the reference layout.
function PinnedTab({ label, icon, active, onClick, iconOnly }) {
  return (
    <button
      className={`${styles.pinnedTab}${active ? ' ' + styles.active : ''}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {icon === 'play' && (
        <span className={styles.playCircle}>
          <span className={styles.playIcon} />
        </span>
      )}
      {icon === 'bars' && (
        <svg viewBox="0 0 16 16" className={styles.barsIcon}>
          <rect x="1" y="9" width="3" height="6" />
          <rect x="6.5" y="5" width="3" height="10" />
          <rect x="12" y="1" width="3" height="14" />
        </svg>
      )}
      {!iconOnly && label}
    </button>
  )
}

function ScrollableTabs({ children, brand, pinned, pinnedLeft }) {
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
      {pinnedLeft && <div className={styles.pinnedLeftGroup}>{pinnedLeft}</div>}
      <button
        className={`${styles.arrow} ${styles.arrowLeft}`}
        onClick={() => scroll(-1)}
        aria-label="Scroll left"
        style={{ display: canLeft ? 'flex' : 'none' }}
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
        style={{ display: canRight ? 'flex' : 'none' }}
      >
        ›
      </button>

      {pinned && <div className={styles.pinnedGroup}>{pinned}</div>}
      {brand && <div className={styles.brand}>{brand}</div>}
    </div>
  )
}

export default function LineA({ events, competitions, tabs, onTabClick, activeGroupKey, areaLabel, areaIso2, hubLabel, onHubClick, hubActive, onTotalsClick, totalsActive, onWatchClick, watchActive, onRankingsClick, rankingsActive }) {
  const { activeEvent, setEvent, activeCompetition, changeCompetitionWithSport, activeSport, activeTab, setTab } = useAppStore()

  // ATP/WTA hub button (tennis only) — pinned first, left of everything
  // else including the per-competition Home button, so it's reachable
  // from any tennis page, not just the sidebar section label. See
  // ContentArea.jsx for where hubLabel/onHubClick come from.
  const hubButtonEl = hubLabel ? <HomeButton label={hubLabel} active={!!hubActive} onClick={onHubClick} /> : null

  // Rankings (tennis only) — pinned right after the hub button, same
  // "always reachable" guarantee (Mohamed 2026-08-16: "After Home button,
  // add a menu label = Rankings... displayed permanently for Grand slam,
  // master 1000, 500, WTA 1000 etc."). Only rendered alongside hubButtonEl
  // since onRankingsClick is only ever passed for tennis.
  const rankingsButtonEl = hubLabel && onRankingsClick ? (
    <button
      className={`${styles.tab}${rankingsActive ? ' ' + styles.active : ''}`}
      onClick={onRankingsClick}
    >
      <span className={styles.label}>Rankings</span>
    </button>
  ) : null

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

  // A category with no competitions this year (e.g. "Various" outside
  // 2000-2008) has nothing for the competitions/tabs/events branches below
  // to render — without this, the hub button would disappear right when
  // the empty-state message needs it most. Keeps the "always reachable"
  // guarantee even on an otherwise-empty page.
  //
  // Watch now goes to the tour-wide Watch Center (activeTennisWatch, wired
  // 2026-08-10), same cross-category reach as Totals.
  // Video (Watch center) is always shown, regardless of whether this
  // sport/competition/page actually has video content — it's a fixed
  // layout element (Part 3 of Line A: Video, then Totals, pinned at the
  // very end), not conditional on data existing. Totals/All-time still
  // only render when there's a real destination for them.
  const watchTotalsRightEls = (
    <>
      <PinnedTab label="Watch center" icon="play" iconOnly active={!!watchActive} onClick={onWatchClick} />
      <PinnedTab label="Totals" icon="bars" iconOnly active={!!totalsActive} onClick={onTotalsClick} />
    </>
  )

  if (!competitions?.length && !tabs?.length && !events?.length && hubLabel) {
    return (
      <div className={styles.bar}>
        <ScrollableTabs pinnedLeft={<>{hubButtonEl}{rankingsButtonEl}</>} pinned={watchTotalsRightEls} />
      </div>
    )
  }

  if (competitions?.length) {
    // Totals/Watch are their own pages, not a competition — a competition
    // left highlighted here while one of them is showing would wrongly
    // suggest it's still the active page (found 2026-08-10: Wimbledon
    // stayed bold after clicking Watch/Totals from its own page).
    const onTourWidePage = !!(totalsActive || watchActive || rankingsActive)
    return (
      <div className={styles.bar}>
        <ScrollableTabs pinnedLeft={<>{hubButtonEl}{rankingsButtonEl}</>} pinned={watchTotalsRightEls}>
          {competitions.map(c => (
            <button
              key={c.slug}
              className={`${styles.tab}${(!onTourWidePage && activeCompetition === c.slug) ? ' ' + styles.active : ''}${c.year_status === 'cancelled' ? ' ' + styles.tabCancelled : ''}`}
              onClick={() => changeCompetitionWithSport(activeSport, c.slug)}
              title={c.year_status === 'cancelled' ? `Cancelled${c.year_cancellation_reason ? ' - ' + c.year_cancellation_reason : ''}` : undefined}
            >
              {/* competitions branch is tennis-only (the only caller that
                  passes this prop — see ContentArea.jsx), so the tennis
                  place-name cleanup applies unconditionally here. */}
              <span className={styles.label}>{shortTournamentLabel(c.name)}</span>
            </button>
          ))}
        </ScrollableTabs>
      </div>
    )
  }

  if (tabs?.length) {
    // Iconic Moments (tab_key 'videos') and All-Time (tab_key 'all-time')
    // are pulled out of the scrollable loop entirely, same as Home —
    // always visible regardless of how many tabs there are to scroll
    // through (see LineA.module.css .pinnedLeftGroup/.pinnedGroup/.pinnedTab).
    const mainTabs   = tabs.filter(t => t.tab_key !== 'videos' && t.tab_key !== 'all-time' && t.tab_key !== 'home')
    const homeTab    = tabs.find(t  => t.tab_key === 'home')
    const videosTab  = tabs.find(t  => t.tab_key === 'videos')
    const allTimeTab = tabs.find(t  => t.tab_key === 'all-time')

    // Part 1 (Home) stays pinned LEFT. Part 3 (Video, then Totals/All-time)
    // is now pinned RIGHT, at the very end of the bar, after the scrollable
    // main tabs (Part 2) — not grouped with Home anymore. Video always
    // renders (layout-only; clicking is a no-op when there's no Iconic
    // Moments tab for this sport); All-time only renders when a real
    // destination tab exists.
    const pinnedLeftEls = (
      <>
        {hubButtonEl}
        {homeTab && <HomeButton label={homeTab.tab_name} active={isTabActive(homeTab)} onClick={() => handleClick(homeTab.tab_key)} />}
      </>
    )
    const pinnedRightEls = (
      <>
        <PinnedTab
          label="Watch center"
          icon="play"
          iconOnly
          square
          active={!!videosTab && activeTab === videosTab.tab_key}
          onClick={() => videosTab && handleClick(videosTab.tab_key)}
        />
        {allTimeTab && (
          <PinnedTab
            label="All-time stats"
            icon="bars"
            iconOnly
            active={isTabActive(allTimeTab)}
            onClick={() => handleClick(allTimeTab.tab_key)}
          />
        )}
      </>
    )

    return (
      <div className={styles.bar}>
        <ScrollableTabs
          brand={brandEl}
          pinnedLeft={pinnedLeftEls}
          pinned={pinnedRightEls}
        >
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
  const mainEvents = events.filter(ev => !ev.is_gallery && ev.name !== 'All-Time' && ev.slug !== 'home')
  const homeEv     = events.find(ev => ev.slug === 'home')
  const galleryEv  = events.find(ev => ev.is_gallery)
  const allTimeEv  = events.find(ev => ev.name === 'All-Time')

  // Selecting any real event (as opposed to the synthetic Home entry) must
  // also move activeTab off 'home' — ContentArea's tab-preservation effect
  // explicitly treats 'home' as an intentional landing state it will never
  // auto-overwrite (see its own comment), and setEvent alone never touches
  // activeTab. Without this, activeTab stayed stuck on 'home' forever after
  // the first sport-switch default, so ContentArea's `activeTab === 'home'`
  // early-return kept rendering the Home placeholder no matter which event
  // was clicked (found 2026-08-10: "no more NBA links work" — EVERY
  // basketball event, not just Home, was affected). Passing null (not the
  // event's own tab_key, which isn't known here) lets that effect resolve
  // the real default tab itself once the new event's season data loads.
  const selectEvent = (slug) => { setEvent(slug); setTab(null) }

  // Home stays pinned LEFT (Part 1). Video, then All-time (Part 3) are
  // pinned RIGHT, at the very end — same convention as the tabs branch
  // above. Video always renders regardless of gallery content.
  const pinnedLeftEvEls = homeEv && (
    <HomeButton label={homeEv.name} active={activeTab === 'home'} onClick={() => handleClick('home')} />
  )
  const pinnedRightEvEls = (
    <>
      <PinnedTab
        label="Watch center"
        icon="play"
        iconOnly
        square
        active={!!galleryEv && activeEvent === galleryEv.slug}
        onClick={() => galleryEv && selectEvent(galleryEv.slug)}
      />
      {allTimeEv && (
        <PinnedTab
          label="All-time stats"
          icon="bars"
          iconOnly
          active={activeEvent === allTimeEv.slug}
          onClick={() => selectEvent(allTimeEv.slug)}
        />
      )}
    </>
  )

  return (
    <div className={styles.bar}>
      <ScrollableTabs
        pinnedLeft={pinnedLeftEvEls}
        pinned={pinnedRightEvEls}
      >
        {mainEvents.map(ev => (
          <button
            key={ev.slug}
            className={`${styles.tab}${activeEvent === ev.slug ? ' ' + styles.active : ''}`}
            onClick={() => selectEvent(ev.slug)}
          >
            <span className={styles.label}>{ev.name}</span>
          </button>
        ))}
      </ScrollableTabs>
    </div>
  )
}
