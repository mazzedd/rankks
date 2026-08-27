import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import styles from './LineA.module.css'
import useAppStore from '../../store/useAppStore'
import Flag from '../shared/Flag'
import { shortTournamentLabel } from '../../utils/tournamentLabel'
import { getStatus } from '../EventBlock/EventBlock'
import { pathForCompetition, pathForTab, pathForEvent } from '../../routing/urlSchema'
import { isModifiedClick } from '../../routing/isModifiedClick'

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
// Competition short code as plain text — no icon (Mohamed 2026-08-26:
// "Home icon in purple fully removed. replaced by COMPETITION SHORTCODE...
// As of now, it's a new global layout rule", reversing the 2026-08-25
// "replace with home icon" call, which had itself reversed the original
// 2026-08-16 text-only version). `label` already resolves to
// competition?.short_code (falling back to "Home") at every real call site
// (ContentArea.jsx/F1ContentArea.jsx/MotoGPContentArea.jsx's own `tab_name:
// competition?.short_code || 'Home'`), so no new prop is needed here — this
// component just needs to render it instead of the old house glyph. The
// purple pinned badge itself is unchanged.
// href is optional — some callers (hub/totals/watch/rankings) drive state
// through props whose exact resulting URL isn't reliably computable from
// here, so those stay plain buttons; callers that DO know their own
// destination (Home tab/event, real competition/tab/event tabs) pass href
// and get a real <a> (Mohamed 2026-08-21: hover should show the URL).
function HomeButton({ label, active, onClick, href }) {
  const Tag = href ? Link : 'button'
  // Modifier check only matters (and only applies) when this is a real
  // Link — a plain button has no native ctrl/cmd-click "open in new tab"
  // behavior to preserve, so guarding its onClick too would just silently
  // swallow normal clicks on hub/totals/watch/rankings buttons.
  const handleClick = href ? (e => { if (!isModifiedClick(e)) onClick?.(e) }) : onClick
  return (
    <Tag
      {...(href ? { to: href } : {})}
      className={`${styles.tab} ${styles.homePinned}${active ? ' ' + styles.active : ''}`}
      onClick={handleClick}
      title={label || 'Home'}
      aria-label={label || 'Home'}
    >
      <span className={styles.label}>{label || 'Home'}</span>
    </Tag>
  )
}

// iconOnly drops the text label entirely (icon + tooltip/aria-label only)
// — every current call site is icon-only, per the reference layout.
function PinnedTab({ label, icon, active, onClick, iconOnly, href }) {
  const Tag = href ? Link : 'button'
  const handleClick = href ? (e => { if (!isModifiedClick(e)) onClick?.(e) }) : onClick
  return (
    <Tag
      {...(href ? { to: href } : {})}
      className={`${styles.pinnedTab}${active ? ' ' + styles.active : ''}`}
      onClick={handleClick}
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
    </Tag>
  )
}

function ScrollableTabs({ children, brand, pinned, pinnedLeft, scrollToKey }) {
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

  // Auto-scroll the active tab into view, centered, whenever the active
  // selection changes (Mohamed 2026-08-23: "from homepage F1, when u click
  // full competition, make it so that Netherlands is displayed center of
  // line A, currently is not visible") — landing on a GP/competition/event
  // via a direct link (Homepage's "Full competition", a bookmarked URL, a
  // Sidebar click) can point anywhere in the scrollable strip regardless
  // of round order, and the strip itself never auto-scrolled to reveal it,
  // only the manual ‹/› arrows did. Queries for the already-rendered
  // .active class rather than needing every caller to also pass a ref,
  // since `scrollToKey` (activeTab/activeCompetition/activeEvent) already
  // tells this effect exactly when to re-check.
  // behavior: 'instant', not 'smooth' — confirmed live that 'smooth' gets
  // silently interrupted (scrollLeft never actually moves) by a follow-up
  // re-render/layout pass shortly after this effect fires; 'instant'
  // completes synchronously before anything can cancel it.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const activeEl = el.querySelector(`[class*="${styles.active}"]`)
    if (activeEl) activeEl.scrollIntoView({ behavior: 'instant', inline: 'center', block: 'nearest' })
  }, [scrollToKey])

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

export default function LineA({ events, competitions, tabs, onTabClick, activeGroupKey, areaLabel, areaIso2, hubLabel, onHubClick, hubActive, onTotalsClick, totalsActive, onWatchClick, watchActive, onRankingsClick, rankingsActive, onScheduleClick, scheduleActive }) {
  const store = useAppStore()
  const { activeEvent, setEvent, activeCompetition, changeCompetitionWithSport, activeSport, activeTab, setTab } = store

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

  // Schedule (tennis only) — pinned right after the hub button, BEFORE
  // Rankings (Mohamed 2026-08-24: "Create a Line A item 'Schedule'
  // displayed first before Rankings"). Same plain-button shape as
  // rankingsButtonEl above (not a Link) for consistency with it.
  const scheduleButtonEl = hubLabel && onScheduleClick ? (
    <button
      className={`${styles.tab}${scheduleActive ? ' ' + styles.active : ''}`}
      onClick={onScheduleClick}
    >
      <span className={styles.label}>Schedule</span>
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
  // Video button removed from tennis's tour-wide Line A (Mohamed
  // 2026-08-22: "Completely remove the VIDEO button on line A") — Totals
  // remains, still only rendering when there's a real destination for it.
  const watchTotalsRightEls = (
    <>
      <PinnedTab label="Totals" icon="bars" iconOnly active={!!totalsActive} onClick={onTotalsClick} />
    </>
  )

  if (!competitions?.length && !tabs?.length && !events?.length && hubLabel) {
    return (
      <div className={styles.bar}>
        <ScrollableTabs pinnedLeft={<>{hubButtonEl}{scheduleButtonEl}{rankingsButtonEl}</>} pinned={watchTotalsRightEls} />
      </div>
    )
  }

  if (competitions?.length) {
    // Totals/Watch are their own pages, not a competition — a competition
    // left highlighted here while one of them is showing would wrongly
    // suggest it's still the active page (found 2026-08-10: Wimbledon
    // stayed bold after clicking Watch/Totals from its own page).
    const onTourWidePage = !!(totalsActive || watchActive || rankingsActive || scheduleActive)
    return (
      <div className={styles.bar}>
        <ScrollableTabs pinnedLeft={<>{hubButtonEl}{scheduleButtonEl}{rankingsButtonEl}</>} pinned={watchTotalsRightEls} scrollToKey={activeCompetition}>
          {competitions.map(c => {
            // Real "happening right now" check, not the stored year_status
            // column (same reasoning as is_next's 2026-08-20 fix) — reuses
            // EventBlock's own getStatus() rather than re-deriving the
            // liveOngoing/cancelled/dateless carve-outs a second time here.
            const isOngoingNow = getStatus({ start_date: c.year_start_date, end_date: c.year_end_date, status: c.year_status }) === 'ongoing'
            return (
              <Link
                key={c.slug}
                to={pathForCompetition(store, activeSport, c.slug)}
                className={`${styles.tab}${(!onTourWidePage && activeCompetition === c.slug) ? ' ' + styles.active : ''}${c.year_status === 'cancelled' ? ' ' + styles.tabCancelled : ''}`}
                onClick={e => !isModifiedClick(e) && changeCompetitionWithSport(activeSport, c.slug)}
                title={c.year_status === 'cancelled' ? `Cancelled${c.year_cancellation_reason ? ' - ' + c.year_cancellation_reason : ''}` : undefined}
              >
                {/* competitions branch is tennis-only (the only caller that
                    passes this prop — see ContentArea.jsx), so the tennis
                    place-name cleanup applies unconditionally here.
                    ongoing-dot-anchor wraps a NESTED span, not .label
                    itself — .label is height:100%/flex (fills the whole
                    tab pill to vertically center its text), so anchoring
                    the dot to it directly positioned the dot against the
                    pill's own top edge instead of the text (see index.css's
                    .ongoing-dot-anchor comment). */}
                <span className={styles.label}>
                  <span className="ongoing-dot-anchor">
                    {shortTournamentLabel(c.name)}
                    {isOngoingNow && <span className="ongoing-dot" />}
                  </span>
                </span>
              </Link>
            )
          })}
        </ScrollableTabs>
      </div>
    )
  }

  if (tabs?.length) {
    // Watch Center (tab_key 'videos') is now a REGULAR scrollable item,
    // not pinned (Mohamed 2026-08-26: "complete remove Video icon Line A,
    // and place Watch Center at the very end on Line A. Use same template
    // as NBA" — NBA already dropped its own icon-only Line A video button
    // in favor of a real "Watch Center" label, Mohamed 2026-08-26 earlier
    // the same day: "place Watch Center in Line B and remove Line video
    // icon"; football's own tabs live directly on Line A rather than a
    // separate per-event Line B, so it lands here instead). No manual
    // re-sort needed — this tab's own display_order (999 in the DB,
    // verified live) is already higher than every other football Line A
    // tab, so it naturally sorts last once it's no longer filtered out.
    // All-Time (tab_key 'all-time') stays pulled out of the scrollable
    // loop, same as Home — always visible regardless of how many tabs
    // there are to scroll through (see LineA.module.css
    // .pinnedLeftGroup/.pinnedGroup/.pinnedTab).
    const mainTabs   = tabs.filter(t => t.tab_key !== 'all-time' && t.tab_key !== 'home')
    const homeTab    = tabs.find(t  => t.tab_key === 'home')
    const allTimeTab = tabs.find(t  => t.tab_key === 'all-time')

    // Part 1 (Home) stays pinned LEFT. Part 3 (All-time) is pinned RIGHT,
    // at the very end of the bar, after the scrollable main tabs (Part 2)
    // — not grouped with Home anymore. Only renders when a real
    // destination tab exists (Mohamed 2026-08-23: "the line A is not
    // longer needed since Watch Center is tied to a race" — F1 dropped its
    // season-wide Iconic Moments tab in favor of a per-GP Watch Center on
    // Line B, so this pinned icon must actually disappear rather than sit
    // there as a dead layout-only button; previously it "always
    // render[ed]... layout-only, a no-op when there's no Iconic Moments
    // tab", same as MotoGP/NBA still get when they have no iconic moments
    // for a given season).
    // Group headers redirect to their first child on click (see
    // handleLineATabClick in ContentArea.jsx) — the href reflects that real
    // destination, not the synthetic header key itself (which has no page).
    const tabHref = (t) => pathForTab(store, t.__isGroupHeader ? t.__firstChildKey : t.tab_key)

    const pinnedLeftEls = (
      <>
        {hubButtonEl}
        {homeTab && <HomeButton label={homeTab.tab_name} active={isTabActive(homeTab)} onClick={() => handleClick(homeTab.tab_key)} href={tabHref(homeTab)} />}
      </>
    )
    const pinnedRightEls = (
      <>
        {allTimeTab && (
          <PinnedTab
            label="All-time stats"
            icon="bars"
            iconOnly
            active={isTabActive(allTimeTab)}
            onClick={() => handleClick(allTimeTab.tab_key)}
            href={tabHref(allTimeTab)}
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
          scrollToKey={activeTab}
        >
          {mainTabs.map(t => (
            <Link
              key={t.tab_key}
              to={tabHref(t)}
              className={`${styles.tab}${isTabActive(t) ? ' ' + styles.active : ''}`}
              onClick={e => !isModifiedClick(e) && handleClick(t.tab_key)}
            >
              {/* Video/play icon next to the label, Watch Center only
                  (Mohamed 2026-08-26: "add Video player icon to Watch
                  Center Line A" — this tab lost its old icon-only pinned
                  treatment the same day it became a regular scrollable
                  item; this restores a small icon alongside the text
                  rather than reverting to icon-only). Same play-triangle
                  glyph as PillIcons.jsx's own PillPlayIcon, sized for a
                  regular tab row rather than the tiny in-pill marker. */}
              {t.tab_key === 'videos' && (
                <svg viewBox="0 0 16 16" className={styles.tabPlayIcon} aria-hidden="true">
                  <path d="M3 1.5 L14 8 L3 14.5 Z" />
                </svg>
              )}
              {/* Green ongoing dot (Mohamed 2026-08-23: "add the following
                  green dot to ONGOING event") — opt-in per tab via
                  t.isOngoing (F1's own GP tabs set it; every other caller's
                  plain {tab_key, tab_name} objects just don't have the
                  field, so this is a no-op there), same shared
                  .ongoing-dot-anchor/.ongoing-dot convention (index.css)
                  Sidebar.jsx and the tennis competitions branch above
                  already use. */}
              <span className={styles.label}>
                <span className="ongoing-dot-anchor">
                  {/* "Watch Center" display label, not the DB's own
                      tab_name ("Iconic Moments") — matches NBA's own
                      synthetic 'videos' tab (ContentArea.jsx's
                      eventsAsLineA branch: { tab_key: 'videos', tab_name:
                      'Watch Center' }), same label wherever this tab_key
                      shows up. */}
                  {t.tab_key === 'videos' ? 'Watch Center' : t.tab_name}
                  {t.isOngoing && <span className="ongoing-dot" />}
                </span>
              </span>
            </Link>
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

  // Home is its own synthetic tab, decoupled from activeEvent — but
  // activeEvent itself doesn't get cleared just because Home is showing
  // (it's driven by whatever event's data ContentArea last loaded/
  // defaulted to), so without this guard the real event matching that
  // stale activeEvent value stayed visually "active" in the scrollable
  // list — and in the Watch/All-time pinned buttons — at the same time as
  // Home's own pinned button (found 2026-08-16: "Regular Season is active
  // when Home is shown"). Same "tour-wide page suppresses the stale
  // per-item active state" pattern the competitions branch above already
  // uses via its own onTourWidePage.
  const onHomePage = activeTab === 'home'
  // Schedule (basketball, Mohamed 2026-08-26: "Schedule becomes a regular
  // Line A item. Keep home button for NBA") — a REGULAR scrollable entry
  // among Regular Season/Finals/etc. (unlike Home, not pinned), but driven
  // by activeTab same as Home, not activeEvent (it's a synthetic
  // aggregate-across-events view, not a real event with its own season
  // row). Same stale-active-state suppression Home already needed above.
  const onSchedulePage = activeTab === 'schedule'
  const onSyntheticTabPage = onHomePage || onSchedulePage

  // Home stays pinned LEFT (Part 1). Video, then All-time (Part 3) are
  // pinned RIGHT, at the very end — same convention as the tabs branch
  // above. Video always renders regardless of gallery content.
  const pinnedLeftEvEls = homeEv && (
    <HomeButton label={homeEv.name} active={onHomePage} onClick={() => handleClick('home')} href={pathForTab(store, 'home')} />
  )
  const pinnedRightEvEls = (
    <>
      {/* Watch center icon removed (Mohamed 2026-08-26: "remove Line video
          icon") — Watch Center now lives pinned last in Line B instead
          (ContentArea.jsx's eventsAsLineA branch), scoped to whichever
          event tab is currently active, same move MMA's own Watch Center
          got earlier this session. */}
      {allTimeEv && (
        <PinnedTab
          label="All-time stats"
          icon="bars"
          iconOnly
          active={!onSyntheticTabPage && activeEvent === allTimeEv.slug}
          onClick={() => selectEvent(allTimeEv.slug)}
          href={pathForEvent(store, allTimeEv.slug)}
        />
      )}
    </>
  )

  return (
    <div className={styles.bar}>
      <ScrollableTabs
        pinnedLeft={pinnedLeftEvEls}
        pinned={pinnedRightEvEls}
        scrollToKey={onSchedulePage ? 'schedule' : activeEvent}
      >
        {mainEvents.map(ev => {
          const isSchedule = ev.slug === 'schedule'
          const isActive = isSchedule ? onSchedulePage : (!onSyntheticTabPage && activeEvent === ev.slug)
          return (
            <Link
              key={ev.slug}
              to={isSchedule ? pathForTab(store, 'schedule') : pathForEvent(store, ev.slug)}
              className={`${styles.tab}${isActive ? ' ' + styles.active : ''}`}
              onClick={e => { if (isModifiedClick(e)) return; isSchedule ? handleClick('schedule') : selectEvent(ev.slug) }}
            >
              <span className={styles.label}>{ev.name}</span>
            </Link>
          )
        })}
      </ScrollableTabs>
    </div>
  )
}
