import { useEffect, useRef, useState, Suspense, lazy } from 'react'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import LineA from '../navigation/LineA'
import LineB from '../navigation/LineB'
import EventBlock, { StatusBadge, getStatus, TennisHomeBlock, TennisTotalsBlock, TennisWatchBlock, TennisRankingsBlock } from '../EventBlock/EventBlock'
import EmptyState from '../EmptyState/EmptyState'
import VideoStrip from '../VideoStrip/VideoStrip'
import FavouriteView from './FavouriteView'
import MyAccountPage from '../templates/account/MyAccountPage'
import PartnersTemplate from '../templates/partners/PartnersTemplate'
import styles from './ContentArea.module.css'
import { TEMPLATES, resolveTemplateKey } from '../templates/registry'
import { fmtDateRange, fmtSeasonYearRange } from '../../utils/calcAge'
import F1ContentArea from '../F1/F1ContentArea'
import MotoGPContentArea from '../MotoGP/MotoGPContentArea'
import HomeTemplate from '../templates/home/home_template'
import HomeTennisTemplate from '../templates/tennis/HomeTennisTemplate'
// Lazy — see the WatchCenterTemplate import below for why a static import
// of a component like this broke React's CJS interop under Rolldown's
// chunking. F1ContentArea/MotoGPContentArea already lazy-load this same
// component — do not go back to a static import here.
const HomepageTemplate = lazy(() => import('../templates/homepage/HomepageTemplate'))
import TennisTournamentStatsTemplate from '../templates/tennis/TennisTournamentStatsTemplate'
import TennisPlayerStatsTemplate from '../templates/tennis/TennisPlayerStatsTemplate'
import TennisRankingsTemplate from '../templates/tennis/TennisRankingsTemplate'
import lineBStyles from '../navigation/LineB.module.css'
// Lazy — a static top-level import here creates a circular chunk
// dependency back into the eagerly-loaded main bundle (this file is part
// of the app shell), which broke React's CJS interop under Rolldown's
// chunking and crashed the whole app on load. F1ContentArea/
// MotoGPContentArea already use this same lazy pattern for the same
// component — do not go back to a static import here.
const WatchCenterTemplate = lazy(() => import('../templates/media/WatchCenterTemplate'))

export default function ContentArea() {
  const {
    activeCompetition, activeEvent, activeTab, activeYear, activeCategory,
    setTab, setEvent, changeYear, activeSport, activeSubEdition,
    favouriteViewCompetition, closeFavouriteView, setYearRange, activeHomeHub,
    accountPage, partnersPage,
    activeTennisTour, setHomeHub, activeTennisTotals, setTennisTotals,
    activeTennisWatch, setTennisWatch,
    activeTennisRankings, setTennisRankings,
    activeTennisSchedule, setTennisSchedule,
    activeMmaSection,
  } = useAppStore()

  // Tennis hub pinned Line A button — always visible so the user can jump
  // to the hub from any tennis page, not just the sidebar section label.
  // One sport-wide hub now (Mohamed 2026-08-26: "No more Home of ATP
  // neither Home of WTA"), so this reads "Tennis" and goes there
  // regardless of which tour's category page it's clicked from.
  const tennisHubLabel   = activeSport === 'tennis' ? 'Tennis' : null
  const handleTennisHubClick = () => setHomeHub('tennis')
  // Always lands back on Player Stats (the first Totals Line B item), even
  // if Tournament Stats was left active on a previous visit — clicking the
  // pinned Totals button is a fresh entry into the page, not a "resume
  // where I left off" (Mohamed 2026-08-10). totalsSubTab's own useState
  // default only covers the very first mount; this covers every later click.
  const handleTennisTotalsClick = () => { setTennisTotals(true); setTotalsSubTab('tennis-totals-players') }
  // Tour-wide Watch Center is parked, not deleted (Mohamed 2026-08-20:
  // "Remove link from Video Icon line A, but keep the icon, we'll tackle
  // it later" — the icon stays visible on Line A, same spot, it just no
  // longer navigates; each tournament's own "Watch Center" Line B tab is
  // the real entry point now — see ContentArea.jsx's 'iconic_moments' key
  // branch and EventBlock.jsx's isIconicEvent tennis branch).
  const handleTennisWatchClick  = () => {}
  const handleTennisRankingsClick = () => setTennisRankings(true)
  const handleTennisScheduleClick = () => setTennisSchedule(true)

  // Totals > Tournament Stats (Line B, local state — same "never mirror a
  // Line B sub-tab into global activeTab" rule F1ContentArea documents in
  // its own file header, since tennis's real Line B already uses activeTab
  // for Men's/Women's Singles etc.). Player Stats first (default landing
  // tab), Tournament Stats second (Mohamed 2026-08-10).
  const [totalsSubTab, setTotalsSubTab] = useState('tennis-totals-players')
  const TOTALS_LINE_B = [
    { tab_key: 'tennis-totals-players', tab_name: 'Player Stats' },
    { tab_key: 'tennis-totals-tournaments', tab_name: 'Tournament Stats' },
  ]


  const [competition, setComp] = useState(null)
  const [season, setSeason]    = useState(null)
  const [naming, setNaming]    = useState(null)
  const [categoryEra, setCategoryEra] = useState(null)
  const [logoOverride, setLogoOverride] = useState(null)
  const [loading, setLoading]  = useState(false)
  const [leadingPlayers, setLeadingPlayers] = useState([])
  const [seasonStats, setSeasonStats] = useState(null)
  const [categoryComps, setCategoryComps] = useState([])
  const [eventNaming, setEventNaming] = useState(null)
  const [yearEvents, setYearEvents] = useState(null)
  const [yearRangeData, setYearRangeData] = useState(null)

  const apiYear = activeYear

  // F1 owns its own tables and its own tab semantics entirely (see
  // F1ContentArea) — every football/tennis-shaped effect below must skip
  // when F1 is active, otherwise they race F1's own state writes. This
  // exact bug (a stray/irrelevant competitions row causing setTab(null)
  // to fire against F1's activeTab) was found and fixed earlier; this
  // guard is what prevents it from ever recurring.
  const isF1 = activeSport === 'car-racing' && activeCompetition === 'formula-1-world-championship'
  // Same reasoning as isF1 above — MotoGPContentArea owns its own tables,
  // its own category dimension, and its own tab semantics entirely.
  // Lives under the SAME sport as F1 ('car-racing') — MotoGP is reached
  // via the sidebar competition list (alongside Formula 1), not its own
  // top-nav sport tab, per instruction.
  const isMotoGP = activeSport === 'car-racing' && activeCompetition === 'motogp'

  // Convert display year → stored year based on competition's year_convention.
  // 'start' → DB stores the start year, so stored = display - 1
  //           e.g. display 2024 = stored 2023 (season 2023-2024)
  // 'end'   → DB stores the end year, so stored = display
  //           e.g. display 2024 = stored 2024
  // Default to 'start' — all current football and tennis competitions use this.
  const yearConvention = competition?.year_convention || 'start'
  const storedYear = yearConvention === 'start' ? apiYear - 1 : apiYear

  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  const [loadingCategoryComps, setLoadingCategoryComps] = useState(false)

  useEffect(() => {
    if (!activeCategory || !activeSport) { setCategoryComps([]); return }
    setLoadingCategoryComps(true)
    api.getCompetitionsByCategory(activeSport, activeCategory, activeYear)
      .then(d => setCategoryComps(Array.isArray(d) ? d : []))
      .catch(() => setCategoryComps([]))
      .finally(() => setLoadingCategoryComps(false))
  }, [activeCategory, activeSport, activeYear])

  // No auto-select-first-tournament here (deliberately removed 2026-08-09) —
  // landing on a category with nothing chosen yet, or a year change that
  // invalidates the current pick, falls straight through to the Home of
  // ATP/WTA page instead (see the categoryComps-driven branch below).
  // Picking a specific tournament off that category's own Line A row is
  // what sets activeCompetition and switches to its normal page.

  useEffect(() => {
    if (!activeCompetition) { setComp(null); return }
    if (isF1 || isMotoGP) return
    let cancelled = false
    setComp(null)
    api.getCompetition(activeCompetition).then(c => {
      if (cancelled) return
      setComp(c)
      if (c.events?.length && !activeEvent && activeSport !== 'tennis') setEvent(c.events[0].slug)
    }).catch(console.error)
    return () => { cancelled = true }
  }, [activeCompetition, isF1, isMotoGP])

  useEffect(() => {
    if (!activeCompetition || !activeYear) return
    if (isF1 || isMotoGP) return
    // Stale-response guard: switching competitions (e.g. Tennis → NBA) fires
    // this effect once with the OLD activeEvent (still unset — the sibling
    // effect above hasn't set it to the new competition's first event yet)
    // before firing again, correctly, once activeEvent updates. The first
    // call has no event filter and fetches EVERY event's season rows for
    // that competition/year (e.g. all 7 NBA events' result_tabs merged into
    // one garbled Line A/B) — if it resolves after the second, correctly
    // filtered call (plausible: no filter = more data = often slower), it
    // silently clobbers the correct state. `cancelled` (set by the cleanup
    // function React runs before every re-fire) makes the stale call's
    // resolution a no-op instead.
    let cancelled = false
    setLoading(true)
    setSeason(null)
    api.getSeason(activeCompetition, apiYear, activeEvent).then(d => {
      if (cancelled) return
      if (!d) {
        setSeason(null)
        setTab(null)
      } else {
        setSeason(d)
        const seen = new Set()
        const tabs = (d.seasons || [])
          .sort((a, b) => (a.gender === 'M' ? -1 : 1) || (a.sub_edition || 1) - (b.sub_edition || 1))
          .flatMap(s => s.result_tabs || [])
          .filter(t => { if (seen.has(t.tab_key)) return false; seen.add(t.tab_key); return true })
        const currentTab = activeTabRef.current
        // 1. Exact same tab_key exists in new competition → keep it.
        // 'home' is a synthetic tab_key (prepended to Line A at render
        // time, never a real result_tabs row — see the render below), so
        // it never actually matches a `tabs` entry here; without this
        // explicit case this effect used to immediately overwrite an
        // intentional landing on Home (e.g. changeCompetitionWithSport's
        // own activeTab: 'home' default) with whatever real tab happens
        // to be is_default, the moment the season data loaded.
        const preserved = currentTab === 'home' || currentTab === 'schedule' || currentTab === 'videos' || (currentTab && tabs.find(t => t.tab_key === currentTab))
        if (!preserved) {
          const genderSuffix = currentTab?.endsWith('-f') ? '-f' : '-m'
          const def = tabs.find(t => t.is_default)
            // 2. Same gender draw tab (e.g. was on Women Single → stay on Women Single)
            || tabs.find(t => t.tab_key === 'draw-singles' + genderSuffix)
            // 3. Men Single fallback
            || tabs.find(t => t.tab_key === 'draw-singles-m')
            // 4. First available tab
            || tabs[0]
          if (def) setTab(def.tab_key)
        }
      }
    }).catch(() => { if (!cancelled) { setSeason(null); setTab(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeCompetition, activeYear, activeEvent, isF1, isMotoGP])

  useEffect(() => {
    if (!activeCompetition || !activeYear) return
    if (isF1 || isMotoGP) return
    setNaming(null)
    api.getNaming(activeCompetition, apiYear)
      .then(setNaming)
      .catch(() => setNaming(null))
  }, [activeCompetition, activeYear, isF1, isMotoGP])

  // Tennis tier original-name-by-era (e.g. Indian Wells 1992 was "ATP
  // Championship Series Single Week", not yet "Masters 1000") — same
  // separate-endpoint-per-year pattern as naming above. Only tennis has
  // event_category_eras rows today, but this is harmless no-op elsewhere
  // (getCategoryEra just resolves to null for any other sport).
  useEffect(() => {
    if (!activeCompetition || !activeYear) { setCategoryEra(null); return }
    if (isF1 || isMotoGP) return
    setCategoryEra(null)
    api.getCategoryEra(activeCompetition, apiYear)
      .then(setCategoryEra)
      .catch(() => setCategoryEra(null))
  }, [activeCompetition, activeYear, isF1, isMotoGP])

  // Era-specific logo (e.g. FIFA World Cup 2026 vs 2022) — same
  // separate-endpoint pattern as naming above, re-resolved on year
  // change without redoing the whole competition fetch.
  useEffect(() => {
    if (!activeCompetition || !activeYear) { setLogoOverride(null); return }
    if (isF1 || isMotoGP) return
    api.getCompetitionLogo(activeCompetition, apiYear)
      .then(setLogoOverride)
      .catch(() => setLogoOverride(null))
  }, [activeCompetition, activeYear, isF1, isMotoGP])

  useEffect(() => {
    if (!activeCompetition || !activeYear) { setEventNaming(null); return }
    if (isF1 || isMotoGP) return
    fetch(`/api/competitions/${activeCompetition}/event-naming/${activeYear}`)
      .then(r => r.json())
      .then(d => setEventNaming(d?.data || null))
      .catch(() => setEventNaming(null))
  }, [activeCompetition, activeYear, isF1, isMotoGP])

  // Year-scoped event list — only diverges from `competition.events` when an
  // event is gated on data (currently just Iconic Moments, hidden until a
  // video exists for that season). Kept as separate state rather than
  // folded into the main competition fetch so switching years doesn't
  // flash-reset colors/logo/naming that fetch also carries.
  useEffect(() => {
    if (!activeCompetition || !activeYear) { setYearEvents(null); return }
    if (isF1 || isMotoGP) return
    api.getCompetitionEvents(activeCompetition, activeYear)
      .then(setYearEvents)
      .catch(() => setYearEvents(null))
  }, [activeCompetition, activeYear, isF1, isMotoGP])

  const genderForTab = (activeTab === 'draw-singles-m' || activeTab === 'players-m') ? 'M'
    : (activeTab === 'draw-singles-f' || activeTab === 'players-f') ? 'F' : null

  // Match season by storedYear (what's actually in the DB) not displayYear
  const cur = season?.seasons?.find(s => s.year === storedYear && (genderForTab ? s.gender === genderForTab : true) && (s.sub_edition || 1) === activeSubEdition)
           || season?.seasons?.find(s => s.year === storedYear && (genderForTab ? s.gender === genderForTab : true))
           || season?.seasons?.find(s => s.year === storedYear)
           || season?.seasons?.[0]

  const seasonId = season?.seasons?.find(s => s.year === storedYear)?.id
                || season?.seasons?.[0]?.id

  useEffect(() => {
    if (!seasonId) { setSeasonStats(null); return }
    api.getSeasonStats(seasonId)
      .then(d => setSeasonStats(d))
      .catch(() => setSeasonStats(null))
  }, [seasonId])

  // Full navigable span for the year strip — MIN/MAX across every
  // competition sharing this one's category, not just this competition's
  // own founded/dissolved (2026-08-10: Next Gen Finals founded 2017 shares
  // its category with Masters Finals founded 1990 — bounding the strip to
  // 2017-2026 alone made it look truncated). Falls back to this
  // competition's own founded/dissolved (set below) while the fetch is in
  // flight or if it fails.
  useEffect(() => {
    if (!activeCompetition || isF1 || isMotoGP) { setYearRangeData(null); return }
    let cancelled = false
    api.getYearRange(activeCompetition)
      .then(d => { if (!cancelled) setYearRangeData(d) })
      .catch(() => { if (!cancelled) setYearRangeData(null) })
    return () => { cancelled = true }
  }, [activeCompetition, isF1, isMotoGP])

  // ATP/WTA Totals has no single competition of its own to key the above
  // off — sport-wide firstDataYear instead (Mohamed 2026-08-26: "take into
  // account the oldest competition in ATP or WTA"), same real-coverage
  // fix as every other sport's Totals breadcrumb.
  const [tennisTotalsMinYear, setTennisTotalsMinYear] = useState(null)
  useEffect(() => {
    if (!activeTennisTotals) return
    let cancelled = false
    api.getSportYearRange('tennis')
      .then(d => { if (!cancelled) setTennisTotalsMinYear(d?.firstDataYear ?? null) })
      .catch(() => { if (!cancelled) setTennisTotalsMinYear(null) })
    return () => { cancelled = true }
  }, [activeTennisTotals])

  // Publish this competition's year range to the shared YearSelector
  // (App.jsx) — see useAppStore's yearRange comment. Runs unconditionally
  // (before any of this component's early returns below) so it stays
  // correct across the favouriteView/empty/main branches alike; null
  // founded/dissolved falls through to YearSelector's own 1968/this-year
  // defaults, same as passing no props used to.
  useEffect(() => {
    // Skip only for the TRUE root "/" homepage (no sport chosen at all —
    // none of activeCompetition/activeCategory/activeHomeHub/any tennis
    // tour-wide page is set). That page has no competition of any kind to
    // pull a range from, so it keeps HomepageTemplate's own hard-frozen
    // range (Mohamed 2026-08-21: "only current year must be active, freeze
    // all the rest").
    //
    // Every OTHER "Home"-shaped page — basketball/MMA's own Home tabs, and
    // (since 2026-08-26) tennis's own ATP/WTA Home hub — falls through to
    // the real setYearRange below instead of being skipped: basketball/MMA
    // already have one real competition (NBA/UFC) loaded here; the tennis
    // hub has none, so competition/yearRangeData resolve to null and this
    // publishes null/null, which YearSelector's own fallback turns into a
    // fully open, unfrozen 1968-current strip — same "disable the frozen
    // home year rule so that years become clickable" fix as the others,
    // just with a generic fallback range instead of a real founded_year
    // (no sport-wide tennis year-range endpoint exists to pull a precise
    // one from — see HomepageTemplate.jsx's own comment for the full
    // history of this fix across every sport).
    //
    // Totals/Rankings/Schedule/Watch are tour-wide too (no activeCompetition/
    // activeCategory of their own) — already real per-year browsable pages
    // before this fix, so they were never part of the skip condition's
    // problem, just listed here so the root-homepage-only check above
    // doesn't accidentally re-skip them.
    if (!activeCompetition && !activeCategory && !activeHomeHub && !activeTennisTotals && !activeTennisRankings && !activeTennisSchedule && !activeTennisWatch) return
    setYearRange({
      minYear: yearRangeData?.minYear ?? competition?.founded_year ?? competition?.valid_from ?? null,
      maxYear: yearRangeData?.maxYear ?? competition?.dissolved_year ?? competition?.valid_to ?? null,
      // This competition's OWN founded/dissolved — used only to grey out
      // years that are inside the widened strip above but outside this
      // specific competition's real lifetime (e.g. Next Gen Finals shown
      // across 1990-2026, but only 2017-2026 are years it actually ran).
      validFrom: competition?.founded_year ?? competition?.valid_from ?? null,
      validTo: competition?.dissolved_year ?? competition?.valid_to ?? null,
      // Frozen-year selector removed for tennis (2026-08 — broke World Cup's
      // own year selector by nulling this out for every non-tennis sport,
      // sending year clicks somewhere unrelated). Passing the raw DB column
      // straight through again: null for every tennis competition (frozen
      // years off, back to a fully clickable range), unchanged for World
      // Cup's own manually curated quadrennial edition_years.
      editionYears: competition?.edition_years,
    })
  }, [competition, yearRangeData, activeCompetition, activeCategory, activeHomeHub, activeTennisTotals, activeTennisRankings, activeTennisSchedule, activeTennisWatch, activeSport, activeMmaSection, activeTab])

  useEffect(() => {
    if (!seasonId || (activeTab !== 'scorers' && activeTab !== 'passers')) {
      setLeadingPlayers([])
      return
    }
    const genderForTabLocal = (activeTab === 'draw-singles-m' || activeTab === 'players-m') ? 'M'
      : (activeTab === 'draw-singles-f' || activeTab === 'players-f') ? 'F' : null
    const curLocal = season?.seasons?.find(s => s.year === storedYear && (genderForTabLocal ? s.gender === genderForTabLocal : true))
                  || season?.seasons?.find(s => s.year === storedYear)
                  || season?.seasons?.[0]
    if (!curLocal?.id) { setLeadingPlayers([]); return }
    const sortKey = activeTab === 'scorers' ? 'goals' : 'assists'
    api.getPlayers(curLocal.id)
      .then(d => {
        const all = (d?.players || [])
          .filter(p => (p[sortKey] || 0) > 0)
          .sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0))
        if (!all.length) { setLeadingPlayers([]); return }
        const top = all[0][sortKey]
        const tied = all.filter(p => (p[sortKey] || 0) === top)
        setLeadingPlayers(tied)
      })
      .catch(err => { console.error('getPlayers error:', err); setLeadingPlayers([]) })
  }, [seasonId, activeTab])

  // Real routed /account page (Mohamed 2026-08-19: "time to create a real
  // page 'MY ACCOUNT', not a popup. Keep sidebar") — checked first, same
  // "unpaired overlay-ish top-level state" priority as favouriteViewCompetition
  // right below, so it renders regardless of whatever sport/competition was
  // last active. Sidebar/MainNav/YearSelector are siblings of ContentArea in
  // App.jsx, not children of it, so they keep rendering around this exactly
  // like they do around every other page.
  if (accountPage) {
    return (
      <div className={styles.area}>
        <MyAccountPage />
      </div>
    )
  }

  // Real routed /partners page ("Official Partnerships") — same "unpaired
  // overlay-ish top-level state" priority as accountPage right above.
  if (partnersPage) {
    return (
      <div className={styles.area}>
        <PartnersTemplate />
      </div>
    )
  }

  // Favourited-competition click (Sidebar's FAVOURITE block) opens this
  // simplified view instead of the normal Line A/B standings page — see
  // useAppStore's openFavouriteView. Deliberately checked before the
  // no-competition-selected empty state below and independent of
  // activeCompetition/competition: it's an unpaired overlay, not a
  // navigation, so it must render regardless of normal browsing state and
  // never pull in that state's data. Test scaffold (FavouriteView) only for now.
  if (favouriteViewCompetition) {
    return (
      <div className={styles.area}>
        <FavouriteView onClose={closeFavouriteView} />
      </div>
    )
  }

  // ATP/WTA Totals (Line A pinned Totals button) — tour-wide aggregated
  // stats, checked before activeHomeHub/category branches below for the
  // same reason as those: no single competition/category of its own to
  // drive a season fetch. Layers on top of whichever category's Line A
  // tournament list (categoryComps) was already showing, same as F1's
  // All-Time tab sitting alongside the GP list rather than replacing it.
  if (activeTennisTotals) {
    const totalsTour = activeTennisTour === 'wta' ? 'wta' : 'atp'
    const totalsLineBLabel = TOTALS_LINE_B.find(t => t.tab_key === totalsSubTab)?.tab_name
    // Real coverage — oldest ATP/WTA competition's first ingested season
    // through the browsed year — not the single active year alone (same
    // fix as every other sport's Totals breadcrumb). Collapses to the bare
    // year if they're equal, same convention as everywhere else.
    const totalsPageYear = tennisTotalsMinYear && tennisTotalsMinYear < activeYear
      ? `${tennisTotalsMinYear}-${activeYear}`
      : activeYear
    // "Totals" segment dropped (Mohamed 2026-08-26: "remove TOTALS from
    // breadcrumb" — same redundant-with-the-year-range wording already
    // removed from every other sport's own Totals/All-Time breadcrumb).
    const totalsPageTitle = (
      <>
        {totalsTour.toUpperCase()} I <span className="page-title-year">{totalsPageYear}</span>{totalsLineBLabel && ` I ${totalsLineBLabel}`}
      </>
    )
    return (
      <div className={styles.area}>
        <LineA competitions={categoryComps} hubLabel={tennisHubLabel} onHubClick={handleTennisHubClick} onTotalsClick={handleTennisTotalsClick} totalsActive onWatchClick={handleTennisWatchClick} onRankingsClick={handleTennisRankingsClick} onScheduleClick={handleTennisScheduleClick} />
        <TennisTotalsLineB tabs={TOTALS_LINE_B} activeKey={totalsSubTab} onTabClick={setTotalsSubTab} />
        <TennisTotalsBlock tour={totalsTour} pageTitle={totalsPageTitle} />
        <div className={styles.content}>
          {totalsSubTab === 'tennis-totals-tournaments' && (
            <TennisTournamentStatsTemplate tour={totalsTour} year={activeYear} />
          )}
          {totalsSubTab === 'tennis-totals-players' && (
            <TennisPlayerStatsTemplate tour={totalsTour} year={activeYear} />
          )}
        </div>
      </div>
    )
  }

  // ATP/WTA Rankings (Line A pinned button, right after Home) — tour-wide
  // list of currently-ranked players, same cross-category reach/layering
  // as Totals/Watch above (Mohamed 2026-08-16).
  if (activeTennisRankings) {
    const rankingsTour = activeTennisTour === 'wta' ? 'wta' : 'atp'
    return (
      <div className={styles.area}>
        <LineA competitions={categoryComps} hubLabel={tennisHubLabel} onHubClick={handleTennisHubClick} onTotalsClick={handleTennisTotalsClick} onWatchClick={handleTennisWatchClick} onRankingsClick={handleTennisRankingsClick} onScheduleClick={handleTennisScheduleClick} rankingsActive />
        <TennisRankingsBlock tour={rankingsTour} year={activeYear} />
        <div className={styles.content}>
          <TennisRankingsTemplate tour={rankingsTour} year={activeYear} />
        </div>
      </div>
    )
  }

  // ATP/WTA Schedule (Line A pinned button, right after Home, before
  // Rankings) — the full tournament-schedule banner+table that used to
  // render directly on the Home hub itself (Mohamed 2026-08-24: "Create a
  // Line A item 'Schedule' displayed first before Rankings... Use the
  // same page, remove table, keep only Home of ATP (blank content) as the
  // default Home page"). Same tour-wide cross-category reach/layering as
  // Totals/Watch/Rankings above.
  if (activeTennisSchedule) {
    const scheduleTour = activeTennisTour === 'wta' ? 'wta' : 'atp'
    return (
      <div className={styles.area}>
        <LineA competitions={categoryComps} hubLabel={tennisHubLabel} onHubClick={handleTennisHubClick} onTotalsClick={handleTennisTotalsClick} onWatchClick={handleTennisWatchClick} onRankingsClick={handleTennisRankingsClick} onScheduleClick={handleTennisScheduleClick} scheduleActive />
        <TennisHomeBlock tour={scheduleTour} schedule />
        <HomeTennisTemplate tour={scheduleTour} />
      </div>
    )
  }

  // ATP/WTA Watch Center (Line A pinned play-icon button) — tour-wide,
  // one page for both Match Videos and Iconic Moments (Mohamed 2026-08-19:
  // "compile Match Videos and Iconic moments in a single page"), same
  // cross-category reach as Totals above and checked in the same place for
  // the same reason (no single competition/category of its own to drive a
  // season fetch). seasonId is just the effect's re-fetch key here, not a
  // real season id. F1/MotoGP's own Watch pages still use the older
  // card-grid IconicMomentsTemplate (no match_summary video data for
  // those sports yet) — left untouched.
  if (activeTennisWatch) {
    const watchTour = activeTennisTour === 'wta' ? 'wta' : 'atp'
    const fetchTennisWatchMoments = () => api.getTennisIconicMomentsTotals(watchTour, activeYear)
    const fetchTennisMatchVideos = () => api.getTennisMatchVideosTotals(watchTour, activeYear)
    return (
      <div className={styles.area}>
        <LineA competitions={categoryComps} hubLabel={tennisHubLabel} onHubClick={handleTennisHubClick} onTotalsClick={handleTennisTotalsClick} onWatchClick={handleTennisWatchClick} onRankingsClick={handleTennisRankingsClick} onScheduleClick={handleTennisScheduleClick} watchActive />
        <TennisWatchBlock tour={watchTour} />
        <div className={styles.content}>
          <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
            <WatchCenterTemplate
              seasonId={`${watchTour}-${activeYear}`}
              fetchMatchVideos={fetchTennisMatchVideos}
              fetchMoments={fetchTennisWatchMoments}
              year={String(activeYear)}
            />
          </Suspense>
        </div>
      </div>
    )
  }

  // ATP/WTA Home hub (sidebar section label click) — a cross-category
  // landing page (Grand Slam + Masters/WTA 1000/500/250 combined), content
  // TBD. Checked before the normal competition/category branches below
  // since it has no single competition or category of its own to drive
  // Line A/B or a season fetch.
  if (activeHomeHub) {
    return (
      <div className={styles.area}>
        {/* No LineA here (Mohamed 2026-08-26: "Update Home of Tennis...
            Remove Line A") — this is now the sport-wide hub, not a
            per-competition page with its own tab row. tour={activeTennisTour},
            not activeHomeHub — activeHomeHub is always the single value
            'tennis' now (a scope, not a real tour), which 404'd/400'd
            TennisHomeBlock's own internal getTennisHome/getEntityLogo
            fetches when passed straight through as `tour`. Their results
            are unused by the Home banner anyway (see SportHomeBanner
            branch) but the fetch itself still fired with a bad param. */}
        <TennisHomeBlock tour={activeTennisTour} />
        {/* HomepageTemplate.jsx generalized to a `scope` prop (Mohamed
            2026-08-25: "I want to duplicate the homepage and create home
            of ATP... instead of showing ALL TENNIS UFC, etc., place ALL
            GRAND SLAM MASTER 1000 500 250 etc" → "my next updates (design,
            font, colors, etc.) should be assigned to all page: Home, Home
            of ATP, home of F1") — one shared implementation behind every
            "Home of X" variant instead of a duplicated file, so a future
            design pass only has to touch it once. */}
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <HomepageTemplate scope={activeHomeHub} />
        </Suspense>
      </div>
    )
  }

  // New app landing page (Mohamed 2026-08-20 mockup, "test UX" prototype)
  // — replaces the old bare "Select a sport" placeholder. Forces
  // activeSport to tennis on mount (see HomepageTemplate's own comment)
  // so the Sidebar shows real content instead of its own empty state.
  if (!activeCompetition && !activeCategory) return (
    <div className={styles.area}>
      <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
        <HomepageTemplate />
      </Suspense>
    </div>
  )

  // A tennis category page with no specific tournament actively selected —
  // either nothing picked yet (fresh sidebar click), the prior pick doesn't
  // belong to this category, or the category is genuinely empty this
  // year (e.g. "Various" outside 2000-2008). Shows the tour's Home page as
  // the default content instead of an arbitrary "first tournament" or a
  // blank dead end (Mohamed 2026-08-09: "I want to see the homepage
  // instead" of auto-picking one). Line A still shows this category's own
  // tournaments (when it has any) so picking one directly switches to its
  // normal page — see the render below for how selecting from that list
  // sets activeCompetition and escapes this branch.
  //
  // Membership check also accepts competition?.category_slug (not just
  // categoryComps, which is year-filtered) — 2026-08-10: a deliberately
  // selected competition (e.g. Next Gen Finals) navigated to a year outside
  // its own founded/dissolved range has no season row for that year, so it
  // drops out of categoryComps entirely. Without this OR, that bounced the
  // user to "Home of ATP" instead of showing the competition's own "There
  // was no event scheduled" empty state (see the year-range/outOfRange
  // greying in YearSelector.jsx + ContentArea's yearRange effect).
  const activeCompInCategory = !!(activeCompetition && (
    categoryComps.some(c => c.slug === activeCompetition) ||
    competition?.category_slug === activeCategory
  ))
  if (activeCategory && !activeCompInCategory && !loadingCategoryComps) {
    const fallbackTour = activeTennisTour === 'wta' ? 'wta' : 'atp'
    return (
      <div className={styles.area}>
        {/* No LineA here either (Mohamed 2026-08-26: "when u click sidebar
            Master 500, etc. dont show line A. Assign same behaviour for
            all sports") — this falls back to the exact same sport-wide
            Home of Tennis content the hub itself shows (scope="tennis"
            below), so it gets the exact same no-Line-A treatment as that
            hub, not the old per-category tournament tab row. */}
        <TennisHomeBlock tour={fallbackTour} />
        {/* scope="tennis", not fallbackTour — ONE merged hub now (Mohamed
            2026-08-26: "No more Home of ATP neither Home of WTA"), same
            content this category's own empty-selection state falls back to
            regardless of which tour it happened on. */}
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <HomepageTemplate scope="tennis" />
        </Suspense>
      </div>
    )
  }

  // F1 has its own dedicated content area — own tables, own nav semantics
  // (Standings + GP-by-round, rather than tennis/football's tab_group
  // system), so it doesn't attempt to fit through the templates/registry
  // path below at all.
  if (isF1) {
    return <F1ContentArea />
  }

  // Same reasoning as F1 above — MotoGP has its own dedicated content
  // area (Standings + GP-by-round, plus the category dimension F1
  // doesn't need), doesn't go through templates/registry either.
  if (isMotoGP) {
    return <MotoGPContentArea />
  }

  // Use storedYear to filter season tabs — deduplicate by tab_key for multi-edition years (e.g. AO 1977)
  const allSeasonTabs = (() => {
    const seasonRows = season?.seasons?.filter(s => s.year === storedYear) || []
    if (seasonRows[0]?.merged_tabs) return seasonRows[0].merged_tabs
    const seen = new Set()
    return seasonRows
      .flatMap(s => s.result_tabs || [])
      .sort((a, b) => a.display_order - b.display_order)
      .filter(t => { if (seen.has(t.tab_key)) return false; seen.add(t.tab_key); return true })
  })()

  const tabs   = activeCompetition ? (allSeasonTabs.length > 0 ? allSeasonTabs : (cur?.result_tabs || [])) : []
  const isAB   = competition?.events?.length > 0

  // ── tab_group collapsing (UCL: Final Tour / Group Stages) ──────────
  // Tabs carrying a tab_group value (e.g. 'final_tour', 'group_stages')
  // are Line B children, not standalone Line A entries. Line A instead
  // shows one synthetic header per distinct tab_group, positioned at
  // that group's lowest display_order. Tabs with no tab_group (Ligue 1,
  // tennis, and UCL's own Scorers/Passers/Players/Videos) pass straight
  // through — this whole block is a no-op when no tab has a tab_group,
  // so existing sports are unaffected.
  const groupKeys = [...new Set(tabs.filter(t => t.tab_group).map(t => t.tab_group))]

  const GROUP_LABELS = { final_tour: 'Final Tour', group_stages: 'Group Stages', league_phase: 'League Phase', all_time: 'All-Time' }

  // Round-robin football leagues (Ligue 1, Premier League, Bundesliga, La
  // Liga, Serie A today — 2026-08-25) get their own 'schedule' Line A
  // entry — data-driven off a literal tab_key === 'final_tour' (the one
  // flat "Results" tab every one of these leagues seeds — ingest-
  // standings.js), not a hardcoded competition slug list.
  const hasLeagueFinalTour = tabs.some(t => t.tab_key === 'final_tour')
  // UCL's own shape (2026-08-26, Mohamed: "create the Schedule page for
  // Champions League based upon Ligue 1 model") — a 'league_phase'
  // tab_group (R1..R8 + its own Standings tab) instead of
  // hasLeagueFinalTour's single flat tab_key. Data-driven off the
  // tab_group convention, not a hardcoded competition slug, so any future
  // UEFA-style competition seeded the same way (Europa League, Conference
  // League, ...) picks up the same treatment with zero further wiring.
  const hasLeaguePhase = tabs.some(t => t.tab_group === 'league_phase')
  // UCL's OLDER (pre-2024) shape — Group A..H, each a 'standings_game' tab
  // under tab_group='group_stages', rather than League Phase's numbered
  // rounds. Kept deliberately separate from hasLeaguePhase (which also
  // drives the Standings/Results Line A merge — "stay on 2025 and 2026 new
  // scheme" per the original request) — this one only extends the
  // Schedule tab itself to every UCL season (Mohamed 2026-08-27: "create
  // schedule page for all UCL seasons"), leaving the older seasons' own
  // Line A/B nav (Group Stages/Final Tour headers) untouched.
  const hasGroupStages = tabs.some(t => t.tab_group === 'group_stages')

  // Which tab_group is "active" — always derived from activeTab's own
  // data rather than tracked separately, so it can never drift out of
  // sync with what's actually rendering.
  //
  // activeTab may be either a real tab_key (curTabReal found) or the
  // synthetic '__results__<group>' key created below — resolved via
  // curTab further down, which checks both possibilities. Computed here,
  // before lineATabs, so the merged-Results branch below can read it
  // while building that header's own active-state key.
  const RESULTS_TAB_PREFIX = '__results__'
  const isResultsTabKey = activeTab?.startsWith(RESULTS_TAB_PREFIX)
  const activeResultsGroup = isResultsTabKey ? activeTab.slice(RESULTS_TAB_PREFIX.length) : null

  const curTabReal = tabs.find(t => t.tab_key === activeTab)
  // 'all-time' itself is a synthetic key with no real result_tabs row (see
  // lineATabs above) — handleLineATabClick redirects clicks straight to
  // its first child, so activeTab should never actually settle on it, but
  // this guards the one-render gap between click and redirect from
  // resolving to no group at all.
  const activeGroupKey = curTabReal?.tab_group || activeResultsGroup || (activeTab === 'all-time' ? 'all_time' : null)

  const buildGroupHeader = gk => {
    const members = tabs.filter(t => t.tab_group === gk).sort((a, b) => a.display_order - b.display_order)
    return {
      // 'all_time' gets the literal tab_key 'all-time' — the same
      // sentinel LineA.jsx already pins to the right (see its
      // convention comment), same as F1's own hardcoded All-Time tab.
      // Every other group keeps the synthetic __group__<key> key,
      // which has no such special meaning to LineA.
      tab_key: gk === 'all_time' ? 'all-time' : `__group__${gk}`,
      tab_name: GROUP_LABELS[gk] || gk,
      display_order: Math.min(...members.map(m => m.display_order)),
      is_default: members.some(m => m.is_default),
      __isGroupHeader: true,
      __groupKey: gk,
      __firstChildKey: members[0]?.tab_key,
    }
  }

  // UCL's modern Swiss-format seasons only (2025/26+, hasLeaguePhase —
  // older seasons still on 'group_stages' are untouched, per Mohamed
  // 2026-08-26: "stay on 2025 and 2026 new scheme"): Final Tour + League
  // Phase merge into ONE Line A "Results" entry instead of two separate
  // group headers, and League Phase's own Standings tab is promoted to
  // its own direct Line A entry (was a Line B child) — "Move Line B
  // Standings -> Line A Standings, after SCHEDULE. Create a Results item
  // -> Line A, just after Standings."
  const MERGED_GROUP_KEYS = new Set(['league_phase', 'final_tour'])
  const isMergedResultsShape = hasLeaguePhase && groupKeys.includes('league_phase') && groupKeys.includes('final_tour')

  // Moved up from just above lineBTabs (still used there) so resultsHeader
  // below can also read it — the promoted Standings tab has
  // tab_group === 'league_phase' too, same as League Phase's own Results
  // rounds, so activeGroupKey alone can't tell them apart.
  const isPromotedStandingsActive = isMergedResultsShape && curTabReal?.tab_group === 'league_phase' && curTabReal?.typology === 'standings'

  const lineATabs = groupKeys.length === 0
    ? tabs
    : isMergedResultsShape
      ? (() => {
          const ungrouped = tabs.filter(t => !t.tab_group)
          const standingsTab = tabs.find(t => t.tab_group === 'league_phase' && t.typology === 'standings')
          const otherSynthetic = groupKeys.filter(gk => !MERGED_GROUP_KEYS.has(gk)).map(buildGroupHeader)
          // __groupKey tracks whichever of the two merged groups is
          // actually active (falls back to a sentinel that can never equal
          // a real activeGroupKey when neither is, e.g. viewing Scorers) —
          // LineA.jsx's own active-state check is a bare
          // `t.__groupKey === activeGroupKey` equality, so this is what
          // makes this header highlight correctly regardless of which
          // merged group the user is actually inside. The promoted
          // Standings tab is EXCLUDED even though its own tab_group is
          // also 'league_phase' — otherwise both it and Results read as
          // active together (Mohamed 2026-08-27 screenshot: both pills
          // bordered at once) since a bare 'league_phase' fallback would
          // coincidentally equal activeGroupKey while browsing Standings.
          const resultsHeader = {
            tab_key: '__merged_results__',
            tab_name: 'Results',
            display_order: 51,
            is_default: false,
            __isGroupHeader: true,
            __groupKey: (MERGED_GROUP_KEYS.has(activeGroupKey) && !isPromotedStandingsActive) ? activeGroupKey : '__none__',
            __firstChildKey: `${RESULTS_TAB_PREFIX}league_phase`,
          }
          const standingsEntry = standingsTab ? { ...standingsTab, display_order: 50 } : null
          return [...ungrouped, ...(standingsEntry ? [standingsEntry] : []), resultsHeader, ...otherSynthetic]
            .sort((a, b) => a.display_order - b.display_order)
        })()
      : [...tabs.filter(t => !t.tab_group), ...groupKeys.map(buildGroupHeader)].sort((a, b) => a.display_order - b.display_order)

  // Per-group collapsing rule: ONLY league_phase's numbered rounds
  // (r1..r8) collapse into one synthetic "Results" tab — they're
  // interchangeable numbered rounds with no individual navigational
  // significance. final_tour's members (Final/Semis/QF/R16/Playoffs)
  // are semantically distinct named stages and must stay as individual
  // tabs regardless of how many there are — this is keyed explicitly on
  // tab_group identity, not a count heuristic, so adding a 6th knockout
  // round later can never accidentally trigger collapsing.
  const COLLAPSIBLE_GROUPS = new Set(['league_phase'])

  const collapseGroupTabs = (groupKey, members) => {
    if (!COLLAPSIBLE_GROUPS.has(groupKey)) return members
    const gameMembers = members.filter(m => m.typology === 'game')
    const otherMembers = members.filter(m => m.typology !== 'game')
    if (!gameMembers.length) return members
    const resultsTab = {
      tab_key: `${RESULTS_TAB_PREFIX}${groupKey}`,
      tab_name: 'Results',
      typology: 'game',
      tab_group: groupKey,
      display_order: Math.min(...gameMembers.map(m => m.display_order)),
      is_default: gameMembers.some(m => m.is_default),
      __isResultsCollapse: true,
      __collapsedGroupKey: groupKey,
    }
    return [...otherMembers, resultsTab].sort((a, b) => a.display_order - b.display_order)
  }

  // While the promoted Standings tab itself is active, Line B stays empty
  // — it's a direct Line A peer now (like Schedule/Scorers), not nested
  // under anything, so it gets no sub-tabs of its own. (isPromotedStandingsActive
  // itself now lives above, next to isMergedResultsShape.)

  const lineBTabs = isPromotedStandingsActive
    ? []
    : isMergedResultsShape && MERGED_GROUP_KEYS.has(activeGroupKey)
      ? (() => {
          // League Phase's own Results collapse (R1-R8 merged, Standings
          // excluded — it's promoted to Line A above, not a Line B child
          // here anymore) first, then the knockout stages in actual play
          // order: final_tour's own display_order is bracket order (Final
          // lowest, so it lists first everywhere else it's used) — sorting
          // descending here reverses that into Playoffs -> Round of 16 ->
          // Quarter Finals -> Semifinals -> Final, matching Mohamed's own
          // listed order.
          // collapseGroupTabs names this collapsed entry "Results" — the
          // correct label when it's the flat leagues' OWN Results tab, but
          // redundant/confusing here where "Results" is already the Line A
          // label it sits under (Mohamed's own listed order names this
          // first item "League Phase", not "Results").
          const leaguePhaseResults = collapseGroupTabs(
            'league_phase',
            tabs.filter(t => t.tab_group === 'league_phase').sort((a, b) => a.display_order - b.display_order)
          ).filter(t => t.typology === 'game').map(t => ({ ...t, tab_name: 'League Phase' }))
          const finalTourMembers = tabs.filter(t => t.tab_group === 'final_tour').sort((a, b) => b.display_order - a.display_order)
          return [...leaguePhaseResults, ...finalTourMembers]
        })()
      : activeGroupKey
        ? collapseGroupTabs(
            activeGroupKey,
            tabs.filter(t => t.tab_group === activeGroupKey).sort((a, b) => a.display_order - b.display_order)
          )
        : []

  // Sports that drive top-level navigation off the legacy `events` table
  // (currently only basketball — tennis is excluded explicitly below, and
  // UCL's tab_group sports always have groupKeys.length > 0) belong with
  // events as Line A (Regular Season/Playoffs/etc.) and the active
  // event's own result_tabs as Line B (e.g. Standings under Regular
  // Season) — the reverse of the old fallback further down, which put
  // events in Line B and left Line A showing just the active event's
  // single result tab.
  const eventsAsLineA = activeSport !== 'tennis' && groupKeys.length === 0 && isAB && competition?.events?.length > 0

  // World Cup (and any future quadrennial/biennial competition) gets its
  // own 'schedule' synthetic Line A entry, same treatment basketball's own
  // Schedule tab already has (Mohamed 2026-08-25: "Schedule must be a
  // regular item. Keep the purple placeholder for Home of World Cup" —
  // correcting the same-day attempt to just rename the pinned Home button
  // itself, same correction NBA already needed 2026-08-26). A REGULAR
  // (non-pinned) tab, not the pinned Home button — see the tabs array
  // below and home_template.jsx's own isSchedule branch.
  const isQuadOrBiennial = competition?.competition_type === 'quadrennial' || competition?.competition_type === 'biennial'

  // hasLeagueFinalTour/hasLeaguePhase are defined earlier (above
  // lineATabs) — the merged-Results branch there needs them before this
  // point.

  // curTab: the thing renderContent/EventBlock actually key off. For the
  // synthetic Results tab there is no real result_tabs row, so a
  // lightweight stand-in is built here carrying just enough shape
  // (typology, tab_group, tab_name) for downstream code to treat it like
  // any other tab — renderContent's typology==='game' branch already
  // handles plain game tabs, it only additionally needs to know to pass
  // tabGroup instead of tabKey to GameTemplate (handled below).
  const curTab = curTabReal || (isResultsTabKey
    ? {
        tab_key: activeTab,
        // Same rename as lineBTabs' own leaguePhaseResults entry above —
        // "Results" is already the Line A label this sits under in the
        // merged shape, so this specific collapse reads as "League Phase"
        // there instead (every other collapsible group, if one's ever
        // added, keeps the plain "Results" name).
        tab_name: (isMergedResultsShape && activeResultsGroup === 'league_phase') ? 'League Phase' : 'Results',
        typology: 'game', tab_group: activeResultsGroup, __isResultsCollapse: true,
      }
    : undefined)

  // Clicking a Line A group header (e.g. "Group Stages") should select
  // that group's leftmost child tab, not the synthetic header key itself
  // (which has no template and no underlying data).
  const handleLineATabClick = (tabKey) => {
    const clicked = lineATabs.find(t => t.tab_key === tabKey)
    if (clicked?.__isGroupHeader) {
      setTab(clicked.__firstChildKey)
    } else {
      setTab(tabKey)
    }
  }

  // Combined breadcrumb title ("2026 I Regular Season I Standings") —
  // replaces each template's own hardcoded page-title, built from
  // whichever nav levels are actually active/visible for the current
  // page: Year Selector I Line A I Line B. Applies to every sport/category
  // that reaches this shared ContentArea render path (F1/MotoGP still use
  // their own separate nav trees/EventBlocks, so they never reach this
  // code at all — not excluded by a flag here, just architecturally
  // elsewhere). Every template falls back to its own hardcoded title when
  // this is null, so an unhandled edge case here degrades gracefully
  // instead of showing a blank/broken title. Tennis has no true Line A
  // tier of its own (eventsAsLineA is explicitly false for tennis,
  // lineBTabs stays empty — see those two below) — its Men's Singles/
  // Player List tab bar is lineATabs here, so lineALabel alone (via the
  // lineATabs.find fallback) already resolves to the right tab name
  // ("Men's Player List") with no extra tennis-specific branching needed.
  const showBreadcrumbTitle = true
  // Whether this page is a Totals/All-Time aggregate (Player Stats/Team
  // Stats/Champion History — spanning every season ever ingested for this
  // competition, not literally "all time"). Football/UCL-style sports flag
  // this via curTab.tab_group ('all_time'); basketball flags it via its own
  // legacy `events` row instead (a literal 'all-time'-prefixed slug, e.g.
  // NBA's event 81 "All-Time") since it has no tab_group column of its own
  // — same two-source check EventBlock.jsx's own isAllTimeEvent already
  // uses, applied here too so the fix holds for every sport, not just
  // football (Mohamed 2026-08-26).
  const isAllTimeContext = activeGroupKey === 'all_time' || !!activeEvent?.startsWith('all-time')
  // The above drops its own Line A segment entirely (Mohamed 2026-08-26:
  // "the total page actually says ALL TIME which is false since data is
  // displayed from 1st season ingested to year selection" — that range is
  // now conveyed by pageTitleYear below instead, so the "All-Time" label,
  // which claimed a coverage this page never actually had, is redundant).
  const lineALabel = !showBreadcrumbTitle ? null : activeTab === 'home' ? 'Home'
    : activeTab === 'schedule' ? 'Schedule'
    : eventsAsLineA
    ? (isAllTimeContext ? null : (yearEvents || competition?.events || []).find(ev => ev.slug === activeEvent)?.name || null)
    // isPromotedStandingsActive: Standings' own tab_group is still
    // 'league_phase' in the DB (unchanged — only where it's SURFACED in
    // Line A moved), so activeGroupKey still resolves truthy here too;
    // without this it would show the group label "League Phase" instead
    // of "Standings", since it's no longer a group member from the user's
    // point of view.
    : activeGroupKey && !isPromotedStandingsActive
      ? (activeGroupKey === 'all_time'
          ? null
          // Same reasoning as isPromotedStandingsActive above — League
          // Phase's and Final Tour's own group labels no longer apply from
          // the user's point of view once merged; the breadcrumb should
          // read "Results" (the Line A entry they're actually under), not
          // "League Phase"/"Final Tour".
          : (isMergedResultsShape && MERGED_GROUP_KEYS.has(activeGroupKey))
            ? 'Results'
            : (GROUP_LABELS[activeGroupKey] || activeGroupKey))
      : lineATabs.find(t => t.tab_key === activeTab)?.tab_name || null
  // Line B only actually renders in these cases (mirrors the LineB render
  // logic further down) — omitted (not duplicated) when this page has no
  // separate Line B of its own, e.g. a flat football tab like Scorers.
  const lineBLabel = !showBreadcrumbTitle ? null : activeTab === 'videos' ? 'Watch Center'
    : (eventsAsLineA || lineBTabs.length > 0)
    ? (curTab?.tab_name || null)
    : null
  // Year renders as its own pill (.page-title-year — see index.css), the
  // rest of the breadcrumb (Line A/Line B labels) as plain text after it.
  const pageTitleLabel = [lineALabel, lineBLabel].filter(Boolean).join(' I ')
  // Tennis breadcrumb gets the tour (ATP/WTA) as its own leading segment,
  // same as the Home hub's own breadcrumb — 2026-08-09: "Add ATP in
  // breadcrumb". Not derivable from the competition row itself (Grand Slam
  // is shared gender 'X'), so it comes from activeTennisTour, same source
  // the sidebar/hub button already use.
  const tourPrefix = activeSport === 'tennis' ? (activeTennisTour === 'wta' ? 'WTA I ' : 'ATP I ') : ''
  // Season-sponsored competition name when configured for the browsed
  // year (Mohamed 2026-08-26: "All page titles must be: ... Ligue 1 Mc
  // Donalds 2026" — this breadcrumb pill, "LIGUE 1 I 2026 I STANDINGS" etc,
  // was still always the bare name). `naming` is null for any competition
  // with no competition_naming rows (every non-football sport today), so
  // this falls back to the exact same text as before everywhere else.
  // Totals/All-Time pages are the one exception (Mohamed 2026-08-26: "must
  // be Competition name in breadcrumb (Ligue 1) and not competition/year
  // based") — they aggregate across many seasons, potentially spanning
  // several different sponsor eras, so no single year's sponsored name is
  // correct here. Same bare-name rule EventBlock.jsx's own isAllTimeEvent
  // banner already applies to its "Aggregated Stats across the X Season"
  // heading — this just extends it to the breadcrumb pill underneath.
  const breadcrumbCompName = isAllTimeContext ? (competition?.name || '') : (naming?.official_name || competition?.name)
  // Football seasons span two calendar years (Aug-May) — the breadcrumb's
  // year pill shows the full "2026-2027" range (same fmtSeasonYearRange
  // already used by EventBlock's own Schedule stat block), not just
  // activeYear's single end-year (Mohamed 2026-08-26: breadcrumb showed
  // "2027" for the 2026/27 season). Every other sport keeps the bare
  // activeYear unchanged.
  // Totals pages ('all_time' group) aggregate from the competition's own
  // first ingested season through the year picked in the year selector,
  // never "all time" in the literal sense — the year pill now reflects
  // that real coverage (e.g. "1992-2027") instead of either the single
  // active year or the current season's own start-end range.
  // firstDataYear (not minYear!) — minYear is the wider founded_year/
  // category-based YearSelector strip bound, which can be years earlier
  // than any real ingested season (Mohamed 2026-08-26: Saudi Pro League's
  // founded_year is 1976 but only 2027 is actually ingested — using minYear
  // here claimed 51 years of coverage that don't exist). founded_year/
  // valid_from fallbacks below are wrong for the same reason and only
  // cover the brief gap before yearRangeData itself resolves.
  const allTimeMinYear = yearRangeData?.firstDataYear ?? competition?.founded_year ?? competition?.valid_from ?? null
  // Single ingested season shows just the one year, not "2027-2027" (e.g.
  // Saudi Pro League, only one real season so far) — same collapse
  // convention football_teams_all_time_template.jsx's own seasonRangeLabel
  // already uses for the per-player seasons column.
  const pageTitleYear = isAllTimeContext && allTimeMinYear
    ? (allTimeMinYear < activeYear ? `${allTimeMinYear}-${activeYear}` : String(activeYear))
    : activeSport === 'football' && cur
    ? fmtSeasonYearRange(cur.start_date, cur.end_date)
    : activeYear
  // Totals pages have no single season status to show (a real coverage
  // range spans many seasons, some past/some ongoing) — same reasoning
  // F1ContentArea/MotoGPContentArea's own breadcrumbStatus already applies
  // (Mohamed 2026-08-26: "remove STATUS pill from TOTALS breadcrumb on All
  // sports" — this generic football/basketball path was the one still
  // showing it).
  const pageTitle = showBreadcrumbTitle
    ? <>{tourPrefix}{breadcrumbCompName ? `${breadcrumbCompName} I ` : ''}<span className="page-title-year">{pageTitleYear}</span>{pageTitleLabel && ` I ${pageTitleLabel}`}{cur && !isAllTimeContext && <span style={{ marginLeft: 8 }}><StatusBadge status={getStatus(cur)} isLive={false} /></span>}</>
    : null

  const renderContent = () => {
    if (!activeCompetition) return null
    if (loading) return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 60, borderRadius: 6 }} />
        ))}
      </div>
    )
    // Home — synthetic tab, no real result_tabs row backing it, so it
    // bypasses the typology/registry lookup below entirely (same reason
    // F1ContentArea/MotoGPContentArea intercept isHomeMode before their
    // own season-data checks).
    if (activeTab === 'home') return <HomeTemplate competition={competition} naming={naming} pageTitle={pageTitle} seasonId={cur?.id} year={String(activeYear)} competitionSlug={activeCompetition} hasLeagueFinalTour={hasLeagueFinalTour} hasLeaguePhase={hasLeaguePhase} hasGroupStages={hasGroupStages} />
    // Schedule — basketball's new regular Line A tab (Mohamed 2026-08-26),
    // same synthetic/no-real-result_tabs-row treatment as Home above, just
    // rendering the full flat game table (nba_home_template.jsx) instead of
    // the blank banner.
    if (activeTab === 'schedule') return <HomeTemplate mode="schedule" competition={competition} naming={naming} pageTitle={pageTitle} seasonId={cur?.id} year={String(activeYear)} competitionSlug={activeCompetition} hasLeagueFinalTour={hasLeagueFinalTour} hasLeaguePhase={hasLeaguePhase} hasGroupStages={hasGroupStages} />
    if (!cur) {
      // Distinguish "this competition simply didn't run this year" (year is
      // outside its own founded_year/dissolved_year — e.g. Next Gen Finals
      // before 2017) from a genuine data gap inside its real lifetime.
      const validFrom = competition?.founded_year ?? competition?.valid_from ?? null
      const validTo = competition?.dissolved_year ?? competition?.valid_to ?? null
      const outOfRange = (validFrom != null && activeYear < validFrom) || (validTo != null && activeYear > validTo)
      return (
        <EmptyState
          type={outOfRange ? 'not_founded' : 'no_data'}
          message={outOfRange
            ? 'There was no event scheduled'
            : `No data available for ${competition?.name || ''} ${activeYear}.`}
        />
      )
    }

if (cur.status === 'cancelled') return (
  <EmptyState type="cancelled" message={
    `${competition?.name || ''} ${activeYear} — Tournament Cancelled for the Following Reason: ${cur.cancellation_reason || 'Unknown'}`
  } />
)

// Season row exists but hasn't been played yet — dates may or may not be
// known yet (tours typically announce ~Nov/Dec for the following year).
// cur.is_next (computed server-side, seasons.js) is true only for the single
// earliest-dated future tournament across the whole tour side (ATP/WTA) —
// every other future tournament this season gets the plain "Future" wording.
if (cur.status === 'future') return (
  <EmptyState type="future" message={
    cur.is_next
      ? (cur.start_date
          ? `Next Tournament to be held ${fmtDateRange(cur.start_date, cur.end_date)}`
          : `Next Tournament in ${activeYear}`)
      : (cur.start_date
          ? `Future Tournament — scheduled ${fmtDateRange(cur.start_date, cur.end_date)}`
          : `Future Tournament in ${activeYear}`)
  } />
)

// Watch Center — basketball's per-event Line B destination (Mohamed
// 2026-08-26: "place Watch Center in Line B and remove Line video icon",
// same treatment as MMA's own Watch Center move earlier). Synthetic
// tab_key 'videos' injected into eventsAsLineA's own Line B tabs list
// below (LineB.jsx already pins any 'videos'-keyed tab last with a "▶ "
// label — the exact same mechanism tennis's own real 'videos' result_tabs
// row rides), so no real result_tabs row backs this either, same as
// Home/Schedule above. Match Videos are scoped to the CURRENTLY ACTIVE
// event's own season (Mohamed: "match videos are tied to a specific
// game" — Regular Season's Watch Center shouldn't show Playoffs games);
// Iconic Moments have no per-event FK in this schema (Mohamed: "Iconic
// are tied to a season. for me its'ok"), so every season id for this year
// across every basketball event is passed — same seasonIdsParam shape the
// OLD standalone Iconic Moments event page below already used.
if (activeTab === 'videos' && eventsAsLineA) {
  const allSeasonIdsForYear = (season?.seasons || []).filter(s => s.year === storedYear).map(s => s.id)
  const momentsSeasonIdsParam = allSeasonIdsForYear.length ? allSeasonIdsForYear.join(',') : cur.id
  return (
    <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
      <WatchCenterTemplate
        seasonId={cur.id}
        fetchMatchVideos={() => api.getMatchVideos(cur.id)}
        fetchMoments={() => api.getIconicMoments(momentsSeasonIdsParam)}
        year={String(activeYear)}
      />
    </Suspense>
  )
}

if (!curTab) return (
  <EmptyState type="no_data" message={`No data available for ${competition?.name || ''} ${activeYear}.`} />
)

    // UCL-shaped signal for Champion History's own routing (see
    // registry.js's own comment) — a literal 'final' tab_key, distinct from
    // hasLeagueFinalTour above (that one looks for tab_key === 'final_tour',
    // the round-robin leagues' single flat schedule tab; UCL has neither
    // that tab NOR a group-stage shape, just its own knockout-final tabs).
    const hasFinalRoundTab = tabs.some(t => t.tab_key === 'final' && t.typology === 'game')
    const key = resolveTemplateKey(curTab.typology, activeSport, activeTab, competition?.competition_type, hasFinalRoundTab)

    if (curTab.typology === 'standings_game') {
      const Standings = TEMPLATES.standings
      const Game = TEMPLATES.game
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Standings seasonId={cur.id} tabKey={activeTab} tabName={curTab.tab_group ? curTab.tab_name : null} sport={activeSport} columnConfig={competition?.column_config} competitionName={competition?.name || ''} yearConvention={yearConvention} competitionSlug={activeCompetition} year={String(activeYear)} />
          <Game seasonId={cur.id} tabKey={activeTab} tabName={curTab.tab_group ? curTab.tab_name : null} sport={activeSport} activeEvent={activeEvent} competitionName={competition?.name || ''} yearConvention={yearConvention} competitionSlug={activeCompetition} year={String(activeYear)} />
        </Suspense>
      )
    }

    if (!key) return <EmptyState type="default" message="This view is coming soon." />
    const Template = TEMPLATES[key]

    // Competition Naming (admin) is an override, not a requirement — a
    // competition with no era override configured still gets a sensible
    // subtitle from its own real name (e.g. "US Open"), same fallback
    // EventBlock.jsx already uses for the iconic-moments/all-time banners.
    const namingLine = naming?.official_name || competition?.name || ''
    const namingSubtitle = namingLine ? `${namingLine} - ${activeYear}` : null

    if (key === 'tennis_draw') {
      // Item B convention (Mohamed: match F1/MotoGP, "Item B placed after
      // Subtitle") — "Indian Wells - 2026 - Men's Singles". The draw
      // gender is per-request viewer data (which draw tab is open), so
      // it's appended after the resolved naming line, never mixed into it.
      const drawItemB = activeTab === 'draw-singles-m' ? "Men's Singles" : activeTab === 'draw-singles-f' ? "Women's Singles" : null
      const drawSubtitle = namingSubtitle && drawItemB ? `${namingSubtitle} - ${drawItemB}` : namingSubtitle
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template seasonId={cur.id} tabKey={activeTab} competitionName={competition?.name || ''} year={String(activeYear)} pageSubtitle={drawSubtitle} />
        </Suspense>
      )
    }

    if (key === 'tennis_players') {
      const gender = activeTab === 'players-m' ? 'M' : 'F'
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template seasonId={cur.id} gender={gender} competitionName={competition?.name || ''} year={String(activeYear)} pageSubtitle={namingSubtitle} />
        </Suspense>
      )
    }

    if (key === 'iconic_moments') {
      // Videos tab spans all genders/draws for this year — gather every
      // season id at storedYear (M, F, future doubles) into one gallery query.
      const allSeasonIdsForYear = (season?.seasons || [])
        .filter(s => s.year === storedYear)
        .map(s => s.id)
      const seasonIdsParam = allSeasonIdsForYear.length ? allSeasonIdsForYear.join(',') : cur.id
      // Tennis gets the combined Match Videos + Iconic Moments Watch
      // Center (Mohamed 2026-08-20: "Watch center of ATP shows actually
      // videos of Wimbledon 2017... page should be Watch Center of
      // Wimbledon 2017"), scoped to just this tournament+year instead of
      // the whole tour. Every other sport still reached by this same
      // 'iconic_moments' typology (football, NBA) keeps the older bare
      // gallery — untouched, per Mohamed: "assign tennis, we'll figure it
      // out later for other sport".
      if (activeSport === 'tennis') {
        // Grand Slam events run both draws under one competition+year —
        // give them a Men/Women split (Mohamed 2026-08-20: "For G slam,
        // since we have Women and Men... horizontal tab: Men and Women.
        // Men is b default"). Every other tennis event only ever has one
        // gender's seasons here, so this naturally stays empty/unused for
        // them — no separate "is this a Grand Slam" check needed.
        const seasonsForYear = (season?.seasons || []).filter(s => s.year === storedYear)
        const genderTabs = [
          { key: 'M', label: 'Men', seasonIds: seasonsForYear.filter(s => s.gender === 'M').map(s => s.id) },
          { key: 'F', label: 'Women', seasonIds: seasonsForYear.filter(s => s.gender === 'F').map(s => s.id) },
        ]
          .filter(t => t.seasonIds.length)
          .map(t => ({ key: t.key, label: t.label, seasonId: t.seasonIds.join(',') }))
        return (
          <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
            <WatchCenterTemplate
              seasonId={seasonIdsParam}
              genderTabs={genderTabs.length > 1 ? genderTabs : undefined}
              fetchMatchVideos={api.getMatchVideos}
              fetchMoments={api.getIconicMoments}
              year={String(activeYear)}
            />
          </Suspense>
        )
      }
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template seasonId={seasonIdsParam} competitionName={competition?.name || ''} year={String(activeYear)} />
        </Suspense>
      )
    }

    if (key === 'players') {
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template key={activeTab} seasonId={cur.id} tabKey={activeTab} tabName={curTab.tab_name} mode={activeTab} sport={activeSport} activeEvent={activeEvent} isPast={cur.status === 'past'} competitionName={competition?.name || ''} yearConvention={yearConvention} endDate={cur.end_date} competitionSlug={activeCompetition} year={String(activeYear)} />
        </Suspense>
      )
    }

    if (key === 'players_all_time') {
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template seasonId={cur.id} tabKey={activeTab} activeEvent={activeEvent} isPast={cur.status === 'past'} competitionName={competition?.name || ''} endDate={cur.end_date} />
        </Suspense>
      )
    }

    if (key === 'player_awards') {
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template seasonId={cur.id} tabKey={activeTab} activeEvent={activeEvent} isPast={cur.status === 'past'} endDate={cur.end_date} />
        </Suspense>
      )
    }

    // standings, game (non-tennis), and any future typology that needs
    // only the standard prop set fall through here. The synthetic
    // Results tab (curTab.__isResultsCollapse) has no real result_tab_id
    // of its own — it gets tabGroup instead of tabKey, which GameTemplate
    // uses to fetch the merged r1..r8 view via getGamesByGroup rather
    // than 404ing against a tab_key that doesn't exist in result_tabs.
    return (
      <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
        <Template
          seasonId={cur.id}
          tabKey={curTab.__isResultsCollapse ? null : activeTab}
          tabGroup={curTab.__isResultsCollapse ? curTab.tab_group : undefined}
          tabName={curTab.tab_group ? curTab.tab_name : null}
          sport={activeSport} activeEvent={activeEvent} isPast={cur.status === 'past'}
          columnConfig={competition?.column_config} competitionName={competition?.name || ''} yearConvention={yearConvention}
          endDate={cur.end_date}
          competitionSlug={activeCompetition} year={String(activeYear)}
          hasFinalRoundTab={hasFinalRoundTab}
          minYear={allTimeMinYear}
        />
      </Suspense>
    )
  }

  return (
    <div className={styles.area}>
      {/* LINE A — category tournaments (tennis) OR result tabs (football),
          with grouped tabs (UCL Final Tour / Group Stages) collapsed to
          one synthetic header each via lineATabs */}
      {/* MMA renders its own Line A (UFC Num / Fight Night / Totals) inside
          MmaEventTemplate — it has no result_tabs-driven nav of its own,
          so none of the branches below apply to it. Also hidden on Home
          for basketball/any round-robin football league — those now show
          the sport-wide merged hub there (HomepageTemplate scope="nba"/
          "football"), same no-Line-A treatment as Tennis's hub and its own
          category fallback (Mohamed 2026-08-26: "when u click sidebar
          Master 500, etc. dont show line A. Assign same behaviour for all
          sports"). World Cup's own Home (isQuadOrBiennial, not
          hasLeagueFinalTour) is untouched — it isn't part of any merge. */}
      {activeSport !== 'mma' && !(activeTab === 'home' && (activeSport === 'basketball' || hasLeagueFinalTour)) && (
        categoryComps.length > 0
          ? <LineA competitions={categoryComps} hubLabel={tennisHubLabel} onHubClick={handleTennisHubClick} onTotalsClick={handleTennisTotalsClick} onWatchClick={handleTennisWatchClick} onRankingsClick={handleTennisRankingsClick} onScheduleClick={handleTennisScheduleClick} />
          : eventsAsLineA
            // Same short_code-first convention the tabs branch below already
            // uses for its own synthetic Home entry (Mohamed 2026-08-16:
            // "Replace Home with NBA" — this events branch just hadn't been
            // brought in line with that existing pattern yet). Basketball
            // additionally gets a second synthetic entry, 'schedule' — a
            // REGULAR (non-pinned) tab sitting among Regular Season/Finals/
            // etc. (Mohamed 2026-08-26, correcting the earlier same-day
            // attempt that renamed the pinned Home button itself: "Schedule
            // becomes a regular Line A item. Keep home button for NBA").
            // Both 'home' and 'schedule' are driven by activeTab (not
            // activeEvent), same as 'home' always was — see LineA.jsx's own
            // special-case handling of the 'schedule' slug in its events
            // branch, and ContentArea.jsx's activeTab==='schedule' early
            // return below.
            ? <LineA events={[
                { slug: 'home', name: competition?.short_code || 'Home', is_gallery: false },
                ...(activeSport === 'basketball' ? [{ slug: 'schedule', name: 'Schedule', is_gallery: false }] : []),
                ...(yearEvents || competition.events),
              ]} />
            : <LineA
                tabs={activeSport !== 'tennis' ? [
                  { tab_key: 'home', tab_name: competition?.short_code || 'Home' },
                  ...((isQuadOrBiennial || hasLeagueFinalTour || hasLeaguePhase || hasGroupStages) ? [{ tab_key: 'schedule', tab_name: 'Schedule' }] : []),
                  ...lineATabs,
                ] : []}
                onTabClick={handleLineATabClick}
                activeGroupKey={activeGroupKey}
              />
      )}

      {/* LINE B — tennis result tabs, OR the active tab_group's children
          (UCL: Final Tour's 4 rounds, or Group Stages' 8 groups),
          OR legacy competition.events sub-events for anything still
          using that older mechanism.
          The events fallback must NOT fire for the flat stat tabs
          (Scorers/Passers/Players/Clubs) — those have no real Line B
          sub-categories, and without this guard the fallback incorrectly
          rendered UCL's knockout rounds (Final/Semis/QF/R16) underneath
          whichever flat tab was active, producing two simultaneously
          "active"-looking tab rows and a confusing double-navigation bar. */}
      {(() => {
        // MMA renders its own Line B (the individual cards) inside
        // MmaEventTemplate — same reasoning as the Line A guard above.
        if (activeSport === 'mma') return null
        // Home/Schedule have no Line B of their own — without this,
        // eventsAsLineA sports (basketball) would still show whatever real
        // event's sub-tabs were last selected underneath these pages.
        if (activeTab === 'home' || activeTab === 'schedule') return null
        const isFlatStatTab = curTab?.typology === 'players' || curTab?.typology === 'clubs'
        // Tennis always renders through its own path — never falls through
        // to the generic events+badge branch further down. That fallback is
        // built for OTHER sports (UCL knockout rounds etc.); a cancelled/
        // future tennis season with no result_tabs of its own used to
        // silently slip through to it, showing the competition's legacy
        // `events` table rows (wrong labels, a stale Doubles/Mixed split
        // tennis never actually tracked) plus an unwanted "Grand Slam"
        // badge that branch renders for its own real use case (found
        // 2026-08). The API now synthesizes real-shaped tabs (Men's
        // Singles/Men's Player List etc., reused from the competition's
        // most recent real season) for cancelled/future seasons, so `tabs`
        // is populated correctly here without any frontend fallback.
        if (activeSport === 'tennis') {
          // 'videos' used to be filtered out here — it was a redundant
          // duplicate of the pinned tour-wide Watch button (Line A, top
          // right). Now that that Line A icon's link is disabled (Mohamed
          // 2026-08-20: "Remove link from Video Icon line A, but keep the
          // icon, we'll tackle it later" — the tour-wide Watch Center is
          // parked, not deleted), this Line B tab (renamed "Watch Center"
          // in the DB, tab_key still 'videos') is the only way into a
          // tournament's own Watch Center, so it needs to show again.
          const lineBTennisTabs = tabs
          if (!lineBTennisTabs.length) return null
          const muted = !cur || cur.status === 'cancelled' || cur.status === 'future'
          return <LineB tabs={lineBTennisTabs} muted={muted} />
        }
        if (lineBTabs.length > 0) {
          return <LineB tabs={lineBTabs} />
        }
        if (eventsAsLineA) {
          // Watch Center pinned last (Mohamed 2026-08-26: "place Watch
          // Center in Line B and remove Line video icon") — synthetic
          // tab_key 'videos', same sentinel LineB.jsx already special-cases
          // (pins last, "▶ " label prefix) for tennis's own real 'videos'
          // result_tabs row. Always present regardless of whether the
          // active event has any real tabs of its own, since it's reachable
          // independent of them (see ContentArea's activeTab==='videos'
          // branch above, which needs no curTab either).
          return <LineB tabs={[...lineATabs, { tab_key: 'videos', tab_name: 'Watch Center' }]} />
        }
        // groupKeys.length === 0 — same guard eventsAsLineA already uses
        // above for this exact legacy events-based fallback. Missing here
        // before, it never actually fired for any tab_group competition
        // (UCL) because lineBTabs was always non-empty for every one of
        // its non-flat-stat tabs — until the new promoted Standings tab
        // (2026-08-26) became the first one with a deliberately empty
        // lineBTabs, resurrecting this dead branch and showing UCL's old
        // legacy Final/Semifinals/Quarter Finals/Round of 16 `events` rows
        // stacked above the real page.
        if (!isFlatStatTab && isAB && groupKeys.length === 0 && competition?.events?.length > 0) {
          return <LineB events={competition.events} competitionShortName={competition.category_short} />
        }
        return null
      })()}

      {/* MMA's event block (headliner result + schedule/edition/fights
          ribbon) lives inside MmaEventTemplate, scoped to the selected
          card rather than the season. */}
      {activeCompetition && competition && activeTab !== 'home' && activeTab !== 'schedule' && activeSport !== 'mma' && (
        <EventBlock
          competition={competition} season={season} naming={naming} eventNaming={eventNaming}
          categoryEra={categoryEra}
          logoUrl={logoOverride?.logo_url}
          activeYear={activeYear} activeGender={genderForTab} activeTab={activeTab}
          activeTypology={curTab?.typology}
          activeTabGroup={activeGroupKey}
          activeEvent={activeEvent}
          leadingPlayers={leadingPlayers} seasonStats={seasonStats}
          hasVideosTab={tabs.some(t => t.tab_key === 'videos')}
          pageTitle={pageTitle}
          tabName={curTab?.tab_name}
        />
      )}

      <div className={styles.content}>
        {renderContent()}
        {cur && activeCompetition && activeTab !== 'home' && activeTab !== 'schedule' && <VideoStrip seasonId={cur.id} />}
      </div>
    </div>
  )
}

// Totals' own Line B (Tournament Stats, more to come later) — local state,
// not the shared LineB.jsx, since that component reads/writes the global
// activeTab store value directly, which tennis's real Line B (Men's/
// Women's Singles etc.) already owns. Same reasoning + same duplicated-
// ScrollableTabs shape as F1ContentArea's own F1LineB/F1ScrollableTabs.
function TennisTotalsLineB({ tabs, activeKey, onTabClick }) {
  if (!tabs?.length) return null
  return (
    <div className={lineBStyles.bar}>
      <div className={lineBStyles.tabs}>
        {tabs.map(t => (
          <button
            key={t.tab_key}
            className={`${lineBStyles.tab}${activeKey === t.tab_key ? ' ' + lineBStyles.active : ''}`}
            onClick={() => onTabClick(t.tab_key)}
          >
            <span className={lineBStyles.label}>{t.tab_name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
