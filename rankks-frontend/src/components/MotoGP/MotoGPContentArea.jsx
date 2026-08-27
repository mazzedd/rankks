// components/MotoGP/MotoGPContentArea.jsx
//
// Navigation pattern (onboarding-motogp.md Section 1, brought to parity
// with F1ContentArea.jsx 2026-08-23 — "assign to MotoGP/2/3 the same
// changes we did before"):
//   Line A: Home (blank landing) + Schedule (full session calendar,
//     HomeMotoGPTemplate) + "Final Standings" + one tab per GP, in round
//     order, + All-Time. Category-agnostic: switching Moto GP/Moto 2/
//     Moto 3 never changes which Line A tab is selected. The season-wide
//     Iconic Moments tab was removed — superseded by a per-GP Watch
//     Center on each Grand Prix's own Line B (see WATCH_TAB_ID).
//   Line B: Riders/Teams/Constructors/Races/Poles under Final Standings
//     (see STANDINGS_LINE_B_BASE below for why Teams alone stays a lean
//     points-only view), or the session list (read off the API, never
//     hardcoded, sorted chronologically) under a GP with Watch Center
//     pinned last. All-Time has its own Rider/Constructor/Race Stats
//     sub-tabs, same shape as F1's own All-Time mode. The Moto GP/Moto 2/
//     Moto 3 category picker that used to prepend this row (a CategoryPills
//     dropdown) was removed (Mohamed 2026-08-23: "Moto 2 and Moto 3 seat
//     now under Moto GP in sidebar. No more category dropdown needed on
//     Line B") — that choice is made in Sidebar.jsx now.
//
// IMPORTANT DESIGN RULE, same as F1ContentArea.jsx and for the same
// reason — activeTab (global store) holds ONLY the Line A selection
// ('motogp-standings' or `gp-{slug}`), never the category or Line B
// selection. category comes from the global store (activeMotoCategory,
// settable from Sidebar.jsx); standingsSubTab/activeSessionId stay local
// state so switching them can never clobber Line A's own selection.
import { useEffect, useRef, useState, useCallback, Suspense, lazy } from 'react'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import LineA from '../navigation/LineA'
import { MotoGPChampionshipBlock, MotoGPTeamsBlock, MotoGPGPBlock, MotoGPGPWatchBlock, MotoGPAllTimeBlock, MotoGPHomeBlock } from './MotoGPEventBlock'
import { StatusBadge, SportHomeBanner } from '../EventBlock/EventBlock'
import ebStyles from '../EventBlock/EventBlock.module.css'
import lineBStyles from '../navigation/LineB.module.css'
import styles from './MotoGPContentArea.module.css'
import { shortGpLabel } from '../../utils/gpLabel'
import { classifyByDate } from '../../utils/eventStatus'

// Per-GP Watch Center (Mohamed 2026-08-23: "assign to MotoGP/2/3 the same
// changes we did before... Watch Video per race") — same combined Match
// Videos + Iconic Moments template F1's own per-GP Watch Center uses
// (F1ContentArea.jsx), minus the Men/Women split.
const WatchCenterTemplate = lazy(() => import('../templates/media/WatchCenterTemplate'))
// Home tab (Mohamed 2026-08-23: "now create Homepage for Moto Gp and F1")
// — same shared ongoing/next/future events browser ATP/WTA's own tour-
// scoped Home page already uses, see renderContent()'s isHomeMode branch.
const HomepageTemplate = lazy(() => import('../templates/homepage/HomepageTemplate'))

const HomeMotoGPTemplate           = lazy(() => import('../templates/motogp/HomeMotoGPTemplate'))
const MotoGPRidersTemplate         = lazy(() => import('../templates/motogp/MotoGPRidersTemplate'))
const MotoGPTeamsTemplate          = lazy(() => import('../templates/motogp/MotoGPTeamsTemplate'))
const MotoGPPointsStandingsTemplate = lazy(() => import('../templates/motogp/MotoGPPointsStandingsTemplate'))
const MotoGPRacesTemplate          = lazy(() => import('../templates/motogp/MotoGPRacesTemplate'))
const MotoGPPoleTemplate           = lazy(() => import('../templates/motogp/MotoGPPoleTemplate'))
const MotoGPRidersAllTimeTemplate       = lazy(() => import('../templates/motogp/MotoGPRidersAllTimeTemplate'))
const MotoGPConstructorsAllTimeTemplate = lazy(() => import('../templates/motogp/MotoGPConstructorsAllTimeTemplate'))
const MotoGPRacesAllTimeTemplate        = lazy(() => import('../templates/motogp/MotoGPRacesAllTimeTemplate'))
const MotoGPSessionResultsTemplate = lazy(() => import('../templates/motogp/MotoGPSessionResultsTemplate'))

// Exported — HomeMotoGPTemplate.jsx needs the same category list (for its
// own "before All Races" category bloc) and the same session_type ->
// display label mapping (sessionLabel below), so both stay in this one
// place instead of drifting out of sync with a second copy.
export const CATEGORIES = [
  { slug: 'motogp', label: 'Moto GP' },
  { slug: 'moto2',  label: 'Moto 2' },
  { slug: 'moto3',  label: 'Moto 3' },
]

// Standings has no separate Constructors tab (unlike All-Time below) —
// removed per explicit instruction; Teams already covers constructor info
// via its own "Constructor: X" line, so a standalone Constructors page
// was redundant at the season level.
const STANDINGS_LINE_B_BASE = [
  { tab_key: 'motogp-riders', tab_name: 'Riders' },
  { tab_key: 'motogp-teams', tab_name: 'Teams' },
  { tab_key: 'motogp-points-standings', tab_name: 'Points Standings' },
  { tab_key: 'motogp-races', tab_name: 'Races' },
  { tab_key: 'motogp-poles', tab_name: 'Poles' },
]
// All-Time's own Line B — no Teams entry, same reason Teams itself isn't
// a real derived-stats template yet (see STANDINGS_LINE_B_BASE comment).
const ALL_TIME_LINE_B_BASE = [
  { tab_key: 'motogp-at-riders',       tab_name: 'Rider Stats' },
  { tab_key: 'motogp-at-constructors', tab_name: 'Team Stats' },
  { tab_key: 'motogp-at-races',        tab_name: 'Race Stats' },
]

// Synthetic Line B id for the "Watch Center" tab, pinned last after every
// real session (Mohamed 2026-08-23: "assign to MotoGP/2/3 the same
// changes... Watch Video per race", same WATCH_TAB_ID sentinel pattern as
// F1ContentArea.jsx) — not a real motogp_sessions.id, so gpLineBTabs/
// handleLineBClick/activeSession all treat it as a sentinel rather than a
// session lookup key.
const WATCH_TAB_ID = 'watch'

// Line A tabs show a short, sentence-case GP label ("Thailand") instead of
// the raw stored name ("GRAND PRIX OF THAILAND") — the full stored name
// isn't lost, it's still used as-is everywhere else (GP page breadcrumb,
// MotoGPGPBlock's banner title) as the fuller "subtitle" version.
// shortGpLabel now lives in utils/gpLabel.js — shared with
// MotoGPRacesTemplate/MotoGPPoleTemplate/MotoGPEventBlock instead of
// being redefined per file.

export default function MotoGPContentArea() {
  // Moto GP/Moto 2/Moto 3 selection now lives in the global store (Mohamed
  // 2026-08-23: "Moto 2 and Moto 3 seat now under Moto GP in sidebar. No
  // more category dropdown needed on Line B") — Sidebar.jsx sets it
  // directly on click, same as every other sidebar-driven selection
  // (activeCategory, activeHomeHub, etc.). This file only ever READS it
  // now (renamed to `category` locally so the rest of the file needed no
  // further changes) — the setter lives solely in Sidebar.jsx since the
  // in-page switchers that used to call it (Line B's CategoryPills,
  // HomeMotoGPTemplate's own) were both removed the same day.
  const { activeYear, changeYear, activeTab, setTab, setYearRange, activeMotoCategory: category } = useAppStore()

  const [availableYears, setAvailableYears] = useState([])
  const [seasonData, setSeasonData]         = useState(null)
  const [gpData, setGPData]                 = useState(null)
  const [loading, setLoading]               = useState(false)
  const [competition, setCompetition]       = useState(null) // holds primary_color/secondary_color from admin
  const [logoUrl, setLogoUrl]               = useState(null) // holds the year-resolved era logo (or default)

  const [standingsSubTab, setStandingsSubTab] = useState('motogp-riders') // Line B, standings mode — local
  const [activeSessionId, setActiveSessionId] = useState(null)            // Line B, GP mode — local
  const [allTimeSubTab, setAllTimeSubTab] = useState('motogp-at-riders')  // Line B, All-Time mode — local

  const activeGPSlug  = activeTab?.startsWith('gp-') ? activeTab.slice(3) : null
  const isAllTimeMode = activeTab === 'all-time'
  const isHomeMode    = activeTab === 'home'
  // Schedule (Mohamed 2026-08-23: "assign to MotoGP/2/3 the same changes
  // we did before... Schedule page") — same Home-becomes-blank/Schedule-
  // gets-its-own-Line-A-tab split F1ContentArea.jsx got: the full session
  // calendar that used to render directly on Home now lives here instead.
  const isScheduleMode = activeTab === 'motogp-schedule'
  const isStandings   = !activeGPSlug && !isAllTimeMode && !isHomeMode && !isScheduleMode

  const lastSessionTypeRef = useRef(null)
  // The synthetic Watch Center tab (see WATCH_TAB_ID) isn't a real
  // session — checked before activeSession's own lookup so that lookup
  // doesn't silently fall back to sessions[0] (Race) while Watch Center
  // is showing, same guard F1ContentArea.jsx's isWatchMode uses.
  const isWatchMode = activeSessionId === WATCH_TAB_ID
  const activeSession = isWatchMode ? null : (gpData?.sessions?.find(s => s.id === activeSessionId) || gpData?.sessions?.[0])

  const motoYear = availableYears.includes(activeYear) ? activeYear : (availableYears[0] || new Date().getFullYear())

  // Reload available years whenever category changes — moto2/moto3's
  // lineage goes back to 1949 too (250cc/125cc), same range as motogp in
  // practice, but this stays category-scoped rather than assumed uniform.
  useEffect(() => {
    api.getMotoGPYears(category)
      .then(years => {
        setAvailableYears(years || [])
        if (years?.length && !years.includes(activeYear)) changeYear(years[years.length - 1])
      })
      .catch(console.error)
  }, [category])

  useEffect(() => {
    if (!activeTab) setTab('motogp-standings')
  }, [])

  // Colors are NOT era-versioned in the schema (competitions.primary_color/
  // secondary_color are single columns) — fetch once on mount, same as F1.
  useEffect(() => {
    api.getCompetition('motogp')
      .then(setCompetition)
      .catch(() => setCompetition(null))
  }, [])

  // Logo IS era-versioned (competition_logos, admin-managed per year range)
  // — refetched on every year change, same as F1ContentArea.
  useEffect(() => {
    if (!motoYear) { setLogoUrl(null); return }
    api.getCompetitionLogo('motogp', motoYear)
      .then(d => setLogoUrl(typeof d === 'string' ? d : d?.logo_url || null))
      .catch(() => setLogoUrl(null))
  }, [motoYear])

  // Load season GP list on year OR category change — preserves Line A
  // position (Section 1's core rule): a selected GP is only redirected to
  // Final Standings if it genuinely doesn't exist for this category/year.
  useEffect(() => {
    if (!motoYear || !availableYears.length) return
    setLoading(true)
    setSeasonData(null)
    const gpSlugBeforeSwitch = activeGPSlug
    api.getMotoGPSeason(motoYear, category)
      .then(data => {
        setSeasonData(data)
        if (gpSlugBeforeSwitch) {
          const stillExists = data?.gps?.some(gp => gp.slug === gpSlugBeforeSwitch)
          if (!stillExists) {
            setTab('motogp-standings')
            setStandingsSubTab('motogp-riders')
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [motoYear, availableYears.length, category])

  useEffect(() => {
    if (!activeGPSlug) { setGPData(null); return }
    setActiveSessionId(null)
    api.getMotoGPGp(activeGPSlug, motoYear, category)
      .then(d => {
        setGPData(d)
        if (d?.sessions?.length) {
          let next = d.sessions[0]
          if (lastSessionTypeRef.current) {
            const match = d.sessions.find(s => s.session_type === lastSessionTypeRef.current)
            if (match) next = match
          }
          setActiveSessionId(next.id)
        }
      })
      .catch(console.error)
  }, [activeGPSlug, motoYear, category])

  const seasonId = seasonData?.season_id

  // Green ongoing dot on whichever GP tab is currently in progress (same
  // ranked-against-the-whole-season classification gpStatus below uses for
  // the currently-viewed GP, just computed for every GP up front so Line A
  // can mark the right tab regardless of which one is actually open — see
  // F1ContentArea.jsx's identical gpStatusById).
  const gpStatusById = seasonData?.gps?.length
    ? new Map(classifyByDate(seasonData.gps, g => g.race_date).map(c => [c.item.id, c.status]))
    : new Map()

  // The season-wide Iconic Moments Line A tab was removed (Mohamed
  // 2026-08-23: "assign to MotoGP/2/3 the same changes we did before" —
  // same "Watch Center is tied to a race" restructure F1 got) — superseded
  // by the per-GP Watch Center on each Grand Prix's own Line B. Schedule
  // is placed 2nd, right after Home, same position as F1's.
  const lineATabs = [
    { tab_key: 'home', tab_name: competition?.short_code || 'Home' },
    { tab_key: 'motogp-schedule', tab_name: 'Schedule' },
    { tab_key: 'motogp-standings', tab_name: 'Standings' },
    ...(seasonData?.gps?.map(gp => ({
      tab_key: `gp-${gp.slug}`,
      tab_name: shortGpLabel(gp.name),
      isOngoing: gpStatusById.get(gp.id) === 'ongoing',
    })) || []),
    { tab_key: 'all-time', tab_name: 'All-Time' },
  ]

  // Left-to-right chronological order (Mohamed 2026-08-23: "assign to
  // MotoGP/2/3 the same changes... Item B order changes" — same "Practice
  // 1, 2....Race respecting chronology" fix F1's own Line B got). Every
  // MotoGP session already has a real per-session date (see
  // HomeMotoGPTemplate.jsx's file header — 8953/8953 rows confirmed), so
  // this sorts ascending by session_date directly rather than needing
  // F1's pre-2026 display_order fallback; display_order only breaks ties
  // for same-day sessions (e.g. Q1/Q2).
  const sessionStatusById = gpData?.sessions?.length
    ? new Map(classifyByDate(gpData.sessions, s => s.session_date).map(c => [c.item.id, c.status]))
    : new Map()

  const gpLineBTabs = [...(gpData?.sessions || [])]
    .sort((a, b) => {
      const ta = a.session_date ? new Date(a.session_date).getTime() : null
      const tb = b.session_date ? new Date(b.session_date).getTime() : null
      if (ta != null && tb != null && ta !== tb) return ta - tb
      return b.display_order - a.display_order
    })
    .map(s => ({
      id: s.id,
      tab_name: sessionLabel(s.session_type, s.session_number),
      session_type: s.session_type,
      isOngoing: sessionStatusById.get(s.id) === 'ongoing',
    }))
    // Watch Center pinned last, after every real session (Mohamed
    // 2026-08-23: "at the very end (last item)") — only once the GP is
    // actually loaded, same guard every other Line B list here follows.
    .concat(gpData?.gp ? [{ id: WATCH_TAB_ID, tab_name: 'Watch Center' }] : [])

  const handleLineAClick = (tabKey) => setTab(tabKey)

  const handleLineBClick = (key) => {
    if (isStandings) setStandingsSubTab(key)
    else if (isAllTimeMode) setAllTimeSubTab(key)
    else {
      const clicked = gpData?.sessions?.find(s => s.id === key)
      if (clicked?.session_type) lastSessionTypeRef.current = clicked.session_type
      setActiveSessionId(key)
    }
  }

  const renderContent = () => {
    if (loading || !availableYears.length) return <Skeleton />

    if (!seasonData) return <Empty message={`No MotoGP data for ${motoYear}`} />

    // Home now shows the real "Home of X"-style ongoing/next/future events
    // browser — scope="racing" merges F1 and MotoGP into one sport-wide hub
    // (Mohamed 2026-08-26: "No more Home of... Home of Racing", same merge
    // as Tennis/Football; F1/MotoGP's previously separate 'f1'/'motogp'
    // scopes retired the same day). Tab row within it: All/F1/Moto GP/
    // Moto 2/Moto 3. The old session-calendar table lives under Schedule
    // now; SportHomeBanner below replaces MotoGPHomeBlock's own banner for
    // this branch only — Schedule keeps MotoGPHomeBlock unchanged.
    if (isHomeMode) return <Suspense fallback={<Skeleton />}><HomepageTemplate scope="racing" /></Suspense>

    if (isScheduleMode) {
      if (!seasonId) return <Empty message="Season data unavailable" />
      return (
        <Suspense fallback={<Skeleton />}>
          <HomeMotoGPTemplate
            seasonId={seasonId}
            year={motoYear}
            category={category}
          />
        </Suspense>
      )
    }

    if (isAllTimeMode) {
      if (!seasonId) return <Empty message="Season data unavailable" />
      return (
        <Suspense fallback={<Skeleton />}>
          {allTimeSubTab === 'motogp-at-riders'       && <MotoGPRidersAllTimeTemplate seasonId={seasonId} />}
          {allTimeSubTab === 'motogp-at-constructors' && <MotoGPConstructorsAllTimeTemplate seasonId={seasonId} />}
          {allTimeSubTab === 'motogp-at-races'        && <MotoGPRacesAllTimeTemplate seasonId={seasonId} />}
        </Suspense>
      )
    }

    if (isStandings) {
      if (!seasonId) return <Empty message="Season data unavailable" />
      return (
        <Suspense fallback={<Skeleton />}>
          {standingsSubTab === 'motogp-riders' && <MotoGPRidersTemplate seasonId={seasonId} year={motoYear} />}
          {standingsSubTab === 'motogp-teams' && <MotoGPTeamsTemplate seasonId={seasonId} year={motoYear} />}
          {standingsSubTab === 'motogp-points-standings' && <MotoGPPointsStandingsTemplate seasonId={seasonId} year={motoYear} />}
          {standingsSubTab === 'motogp-races' && <MotoGPRacesTemplate seasonId={seasonId} year={motoYear} />}
          {standingsSubTab === 'motogp-poles' && <MotoGPPoleTemplate seasonId={seasonId} year={motoYear} />}
        </Suspense>
      )
    }

    if (isWatchMode) {
      const gp = gpData?.gp
      if (!gp) return <Skeleton />
      // The GP's own single race-summary video (motogp_race_videos — one
      // row per (grand_prix_id, category), see motogp.js) reshaped into
      // WatchCenterTemplate's "match video" item shape — same "no real
      // home/away side" adaptation F1ContentArea.jsx's fetchGpMatchVideos
      // uses.
      const fetchGpMatchVideos = () => Promise.resolve({
        items: gp.video_url ? [{
          id: gp.video_id, video_url: gp.video_url, source: gp.video_source,
          embeddable: gp.video_embeddable, thumbnail_url: gp.video_thumbnail_url,
          home_name: gp.name, away_name: null, round: 'Race', competition_name: 'MotoGP',
        }] : [],
      })
      // Scoped to just this race + category now (Mohamed 2026-08-23:
      // "assign to MotoGP/2/3 the same changes... iconic moment may be
      // tied to a Grand Prix" — motogp_iconic_moments.grand_prix_id,
      // nullable, added alongside this). A moment with no grand_prix_id
      // set is season-wide and only surfaced by a direct season-wide fetch
      // (none exists on the frontend anymore, same as F1's own state after
      // its season-wide Iconic Moments tab was removed).
      const fetchGpMoments = () => api.getMotoGPIconicMoments(seasonId, null, null, gp.id)
      return (
        <Suspense fallback={<Skeleton />}>
          <WatchCenterTemplate
            seasonId={`motogp-gp-${gp.id}-${category}`}
            fetchMatchVideos={fetchGpMatchVideos}
            fetchMoments={fetchGpMoments}
            year={String(motoYear)}
          />
        </Suspense>
      )
    }

    if (!activeSession) return <Skeleton />
    return (
      <Suspense fallback={<Skeleton />}>
        <MotoGPSessionResultsTemplate
          sessionId={activeSession.id}
          gpName={gpData?.gp?.name}
          year={motoYear}
          status={gpStatus}
          pageSubtitle={gpData?.gp?.full_title}
          sessionType={sessionLabel(activeSession.session_type, activeSession.session_number)}
        />
      </Suspense>
    )
  }

  const minYear = availableYears.length ? Math.min(...availableYears) : 1949
  const maxYear = availableYears.length ? Math.max(...availableYears) : new Date().getFullYear()

  // Publish this competition's year range to the shared YearSelector
  // (App.jsx) — see useAppStore's yearRange comment.
  useEffect(() => {
    // Home used to publish its own frozen range (only HOMEPAGE_YEAR
    // clickable) and this effect skipped while it was active — removed
    // 2026-08-26 per Mohamed: "disable the frozen home year rule so that
    // years become clickable" (forcing a Line A click first read as
    // unintuitive). Home now gets the same real, browsable range as every
    // other tab, same fix applied to ContentArea.jsx/F1ContentArea.jsx.
    setYearRange({ minYear, maxYear, editionYears: availableYears.length ? availableYears : undefined })
  }, [minYear, maxYear, availableYears.length])

  // Past/Ongoing/Next/Upcoming for the currently-viewed GP, ranked
  // against every GP in the season — computed once here so both
  // MotoGPGPBlock's own badge AND the breadcrumb below use the same
  // resolved value (see F1ContentArea's identical comment).
  const gpStatus = (gpData?.gp && seasonData?.gps?.length)
    ? (classifyByDate(seasonData.gps, g => g.race_date).find(c => c.item.id === gpData.gp.id)?.status || 'upcoming')
    : null

  // Season-wide status for the Standings/Home/Schedule breadcrumb —
  // 'ongoing' once the season has both a raced round and a remaining one,
  // 'past' once every round is done, 'upcoming' if none has raced yet.
  // Same shape as F1ContentArea's own homeStatus, derived client-side from
  // the same seasonData.gps this file already has (MotoGP's own gp rows
  // only carry race_date, no first_session_date like F1's).
  const homeStatus = seasonData?.gps?.length ? (() => {
    const now = new Date()
    const hasPast   = seasonData.gps.some(g => new Date(g.race_date) < now)
    const hasFuture = seasonData.gps.some(g => new Date(g.race_date) >= now)
    return hasPast && hasFuture ? 'ongoing' : hasPast ? 'past' : 'upcoming'
  })() : null

  // All-Time drops its own Line A segment (Mohamed 2026-08-26: "the total
  // page actually says ALL TIME which is false since data is displayed
  // from 1st season ingested to year selection" — same fix as F1ContentArea/
  // football/basketball's own Totals pages). Real coverage now shown via
  // the year pill below instead (minYear-motoYear).
  const lineALabel = isHomeMode ? 'Home'
    : isScheduleMode ? 'Schedule'
    : isAllTimeMode ? null
    : isStandings ? 'Standings'
    : (gpData?.gp?.name || null)
  const lineBLabel = isStandings ? (STANDINGS_LINE_B_BASE.find(t => t.tab_key === standingsSubTab)?.tab_name || null)
    : isAllTimeMode ? (ALL_TIME_LINE_B_BASE.find(t => t.tab_key === allTimeSubTab)?.tab_name || null)
    : isWatchMode ? 'Watch Center'
    : (activeSession ? sessionLabel(activeSession.session_type, activeSession.session_number) : null)
  const catLabel = CATEGORIES.find(c => c.slug === category)?.label
  const motoPageTitleLabel = [catLabel, lineALabel, lineBLabel].filter(Boolean).join(' I ')
  // Every page ends with a real StatusBadge pill, not plain joined text —
  // same convention F1ContentArea's own f1PageTitle uses: GP pages
  // (Race/Qualifying/Practice/Watch Center) show the round's own gpStatus;
  // Standings/Home/Schedule are season-scoped (homeStatus);
  // All-Time has no single status to show (a "through <year>" cumulative
  // view spans many seasons).
  const breadcrumbStatus = isAllTimeMode ? null
    : (isHomeMode || isScheduleMode || isStandings) ? homeStatus
    : gpStatus
  const motoPageTitleYear = isAllTimeMode ? (minYear < motoYear ? `${minYear}-${motoYear}` : motoYear) : motoYear
  const motoPageTitle = (
    <>
      MotoGP I <span className="page-title-year">{motoPageTitleYear}</span>{motoPageTitleLabel && ` I ${motoPageTitleLabel}`}
      {breadcrumbStatus && <> <StatusBadge status={breadcrumbStatus} /></>}
    </>
  )

  return (
    <div className={styles.area}>
      {/* No Line A on Home (Mohamed 2026-08-26: "when u click sidebar
          Master 500, etc. dont show line A. Assign same behaviour for all
          sports") — Home now shows the sport-wide merged hub instead. */}
      {!isHomeMode && <LineA tabs={lineATabs} onTabClick={handleLineAClick} />}

      {!isHomeMode && !isScheduleMode && (
        <MotoGPLineB
          tabs={isStandings ? STANDINGS_LINE_B_BASE : isAllTimeMode ? ALL_TIME_LINE_B_BASE : gpLineBTabs}
          activeKey={isStandings ? standingsSubTab : isAllTimeMode ? allTimeSubTab : activeSessionId}
          onTabClick={handleLineBClick}
          keyField={isStandings || isAllTimeMode ? 'tab_key' : 'id'}
        />
      )}

      {isStandings && seasonId && standingsSubTab === 'motogp-teams' && (
        <MotoGPTeamsBlock
          seasonId={seasonId} year={motoYear} category={category} type="teams"
          primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl}
          pageTitle={motoPageTitle} competitionId={competition?.id}
        />
      )}
      {isStandings && standingsSubTab !== 'motogp-teams' && seasonId && (
        <MotoGPChampionshipBlock seasonId={seasonId} year={motoYear} category={category} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} competitionId={competition?.id} />
      )}
      {!isStandings && !isAllTimeMode && !isWatchMode && gpData?.gp && (
        <MotoGPGPBlock gp={gpData.gp} sessions={gpData.sessions} year={motoYear} category={category} status={gpStatus} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} competitionId={competition?.id} />
      )}
      {isWatchMode && gpData?.gp && (
        <MotoGPGPWatchBlock gpName={gpData.gp.name} year={motoYear} category={category} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} />
      )}
      {isAllTimeMode && (
        <MotoGPAllTimeBlock primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} competitionId={competition?.id} />
      )}
      {isHomeMode && (
        <SportHomeBanner icon={<img src="/media/icons/sports/icon-racing.png" alt="" className={ebStyles.eventCompetitionIconStandalone} />} label="Racing" />
      )}
      {isScheduleMode && (
        <MotoGPHomeBlock schedule year={motoYear} category={category} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} competitionId={competition?.id} />
      )}

      <div className={styles.content}>{renderContent()}</div>
    </div>
  )
}

export function sessionLabel(type, number) {
  const labels = { RAC: 'Race', SPR: 'Sprint', Q: 'Qualifying', FP: 'Practice', PR: 'Practice', WUP: 'Warm Up' }
  const base = labels[type] || type
  return number != null ? `${base} ${number}` : base
}

// Same visual system as F1ContentArea's own F1LineB — imports the shared
// LineB.module.css, adds the category pill in front. Kept as a local
// component (not the shared LineB.jsx) for the same reason F1's version
// is: session tabs are local UI state, not the global activeTab.
function MotoGPLineB({ tabs, activeKey, onTabClick, keyField }) {
  if (!tabs?.length) return null
  return (
    <div className={lineBStyles.bar}>
      <div className={lineBStyles.tabs}>
        {(tabs || []).map(t => {
          const key = t[keyField]
          // Play-icon prefix on the Watch Center tab, same "▶ " convention
          // F1LineB's own isIconic check uses.
          const isWatch = t.id === WATCH_TAB_ID
          return (
            <button
              key={key}
              className={`${lineBStyles.tab}${activeKey === key ? ' ' + lineBStyles.active : ''}`}
              onClick={() => onTabClick(key)}
            >
              <span className={lineBStyles.label}>
                <span className="ongoing-dot-anchor">
                  {isWatch ? '▶ ' : ''}{t.tab_name}
                  {t.isOngoing && <span className="ongoing-dot" />}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(4)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty({ message }) {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>{message || 'No data available.'}</div>
}
