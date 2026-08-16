// components/MotoGP/MotoGPContentArea.jsx
//
// Navigation pattern (onboarding-motogp.md Section 1):
//   Line A: "Final Standings" + one tab per GP, in round order — same
//     shape as F1's own Line A, reused unmodified. Category-agnostic:
//     switching Moto GP/Moto 2/Moto 3 never changes which Line A tab is
//     selected.
//   Line B: CategoryPills (generic component, not MotoGP-specific)
//     prepended to whichever category-scoped sub-tabs apply — Riders/
//     Teams/Constructors/Races/Poles under Final Standings (see
//     STANDINGS_LINE_B_BASE below for why Teams alone stays a lean
//     points-only view), or the session list (read off the API, never
//     hardcoded) under a GP. All-Time has its own Rider/Constructor/Race
//     Stats sub-tabs, same shape as F1's own All-Time mode.
//
// IMPORTANT DESIGN RULE, same as F1ContentArea.jsx and for the same
// reason — activeTab (global store) holds ONLY the Line A selection
// ('motogp-standings' or `gp-{slug}`), never the category or Line B
// selection. category/standingsSubTab/activeSessionId are local state so
// switching them can never clobber Line A's own selection.
import { useEffect, useRef, useState, useCallback, Suspense, lazy } from 'react'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import LineA from '../navigation/LineA'
import CategoryPills from '../shared/CategoryPills'
import { MotoGPChampionshipBlock, MotoGPTeamsBlock, MotoGPGPBlock, MotoGPAllTimeBlock, MotoGPIconicMomentsBlock, MotoGPHomeBlock } from './MotoGPEventBlock'
import { StatusBadge } from '../EventBlock/EventBlock'
import lineBStyles from '../navigation/LineB.module.css'
import styles from './MotoGPContentArea.module.css'
import { shortGpLabel } from '../../utils/gpLabel'
import { classifyByDate } from '../../utils/eventStatus'
import { formatScheduleRange } from '../../utils/scheduleRange'

const IconicMomentsTemplate = lazy(() => import('../templates/media/iconic_moments_template'))

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

// Line A tabs show a short, sentence-case GP label ("Thailand") instead of
// the raw stored name ("GRAND PRIX OF THAILAND") — the full stored name
// isn't lost, it's still used as-is everywhere else (GP page breadcrumb,
// MotoGPGPBlock's banner title) as the fuller "subtitle" version.
// shortGpLabel now lives in utils/gpLabel.js — shared with
// MotoGPRacesTemplate/MotoGPPoleTemplate/MotoGPEventBlock instead of
// being redefined per file.

export default function MotoGPContentArea() {
  const { activeYear, changeYear, activeTab, setTab, setYearRange } = useAppStore()

  const [category, setCategory] = useState('motogp') // Line B pill — local, never touches activeTab
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
  const isIconicMode  = activeTab === 'videos'
  const isHomeMode    = activeTab === 'home'
  const isStandings   = !activeGPSlug && !isAllTimeMode && !isIconicMode && !isHomeMode

  const lastSessionTypeRef = useRef(null)
  const activeSession = gpData?.sessions?.find(s => s.id === activeSessionId) || gpData?.sessions?.[0]

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

  const lineATabs = [
    { tab_key: 'home', tab_name: competition?.short_code || 'Home' },
    { tab_key: 'motogp-standings', tab_name: 'Standings' },
    ...(seasonData?.gps?.map(gp => ({
      tab_key: `gp-${gp.slug}`,
      tab_name: shortGpLabel(gp.name),
    })) || []),
    ...(seasonData?.has_iconic_moments ? [{ tab_key: 'videos', tab_name: 'Iconic Moments' }] : []),
    { tab_key: 'all-time', tab_name: 'All-Time' },
  ]

  // If the year/category changes and this (year, category) season has no
  // Iconic Moments, fall back to Standings rather than leaving activeTab
  // pointed at a Line A tab that's no longer rendered — same rule
  // F1ContentArea applies.
  useEffect(() => {
    if (activeTab === 'videos' && seasonData && !seasonData.has_iconic_moments) {
      setTab('motogp-standings')
    }
  }, [seasonData])

  const gpLineBTabs = (gpData?.sessions || []).map(s => ({
    id: s.id,
    tab_name: sessionLabel(s.session_type, s.session_number),
    session_type: s.session_type,
  }))

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

    if (isHomeMode) {
      return (
        <Suspense fallback={<Skeleton />}>
          <HomeMotoGPTemplate
            seasonId={seasonId}
            year={motoYear}
            category={category}
            onCategoryChange={setCategory}
          />
        </Suspense>
      )
    }

    if (!seasonData) return <Empty message={`No MotoGP data for ${motoYear}`} />

    if (isIconicMode) {
      if (!seasonId) return <Empty message="Season data unavailable" />
      return (
        <Suspense fallback={<Skeleton />}>
          <IconicMomentsTemplate
            seasonId={seasonId}
            competitionName={catLabel}
            year={motoYear}
            sportSlug="car-racing"
            fetchMoments={api.getMotoGPIconicMoments}
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

    if (!activeSession) return <Skeleton />
    return (
      <Suspense fallback={<Skeleton />}>
        <MotoGPSessionResultsTemplate
          sessionId={activeSession.id}
          gpName={gpData?.gp?.name}
          year={motoYear}
          status={gpStatus}
          scheduleRange={scheduleRange}
          videoUrl={gpData?.gp?.video_url}
          videoId={gpData?.gp?.video_id}
          source={gpData?.gp?.video_source}
          embeddable={gpData?.gp?.video_embeddable}
          thumbnailUrl={gpData?.gp?.video_thumbnail_url}
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
    setYearRange({ minYear, maxYear, editionYears: availableYears.length ? availableYears : undefined })
  }, [minYear, maxYear, availableYears.length])

  // Past/Ongoing/Next/Upcoming for the currently-viewed GP, ranked
  // against every GP in the season — computed once here so both
  // MotoGPGPBlock's own badge AND the breadcrumb below use the same
  // resolved value (see F1ContentArea's identical comment).
  const gpStatus = (gpData?.gp && seasonData?.gps?.length)
    ? (classifyByDate(seasonData.gps, g => g.race_date).find(c => c.item.id === gpData.gp.id)?.status || 'upcoming')
    : null

  // "30.08 - 13.09.2026" weekend span for the Next/Future placeholder
  // message — see MotoGPSessionResultsTemplate.jsx / F1ContentArea.jsx's
  // identical block for the full rationale.
  const scheduleRange = formatScheduleRange(gpData?.sessions)

  // Season-wide status for the Standings/Home/Iconic Moments breadcrumb —
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

  const lineALabel = isHomeMode ? 'Home'
    : isAllTimeMode ? 'All-Time'
    : isIconicMode ? 'Iconic Moments'
    : isStandings ? 'Standings'
    : (gpData?.gp?.name || null)
  const lineBLabel = isStandings ? (STANDINGS_LINE_B_BASE.find(t => t.tab_key === standingsSubTab)?.tab_name || null)
    : isAllTimeMode ? (ALL_TIME_LINE_B_BASE.find(t => t.tab_key === allTimeSubTab)?.tab_name || null)
    : (!isIconicMode && activeSession ? sessionLabel(activeSession.session_type, activeSession.session_number) : null)
  const catLabel = CATEGORIES.find(c => c.slug === category)?.label
  const motoPageTitleLabel = [catLabel, lineALabel, lineBLabel].filter(Boolean).join(' I ')
  // Every page ends with a real StatusBadge pill, not plain joined text —
  // same convention F1ContentArea's own f1PageTitle uses: GP pages
  // (Race/Qualifying/Practice/...) show the round's own gpStatus;
  // Standings/Home/Iconic Moments are season-scoped (homeStatus);
  // All-Time has no single status to show (a "through <year>" cumulative
  // view spans many seasons).
  const breadcrumbStatus = isAllTimeMode ? null
    : (isHomeMode || isStandings || isIconicMode) ? homeStatus
    : gpStatus
  const motoPageTitle = (
    <>
      MotoGP I <span className="page-title-year">{motoYear}</span>{motoPageTitleLabel && ` I ${motoPageTitleLabel}`}
      {breadcrumbStatus && <> <StatusBadge status={breadcrumbStatus} /></>}
    </>
  )

  return (
    <div className={styles.area}>
      <LineA tabs={lineATabs} onTabClick={handleLineAClick} />

      {!isIconicMode && !isHomeMode && (
        <MotoGPLineB
          categoryPill={<CategoryPills categories={CATEGORIES} active={category} onChange={setCategory} />}
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
          pageTitle={motoPageTitle}
        />
      )}
      {isStandings && standingsSubTab !== 'motogp-teams' && seasonId && (
        <MotoGPChampionshipBlock seasonId={seasonId} year={motoYear} category={category} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} />
      )}
      {isIconicMode && seasonId && (
        <MotoGPIconicMomentsBlock year={motoYear} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} />
      )}
      {!isStandings && !isAllTimeMode && gpData?.gp && (
        <MotoGPGPBlock gp={gpData.gp} sessions={gpData.sessions} year={motoYear} category={category} status={gpStatus} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} />
      )}
      {isAllTimeMode && (
        <MotoGPAllTimeBlock primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} />
      )}
      {isHomeMode && (
        <MotoGPHomeBlock primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} pageTitle={motoPageTitle} />
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
function MotoGPLineB({ categoryPill, tabs, activeKey, onTabClick, keyField }) {
  return (
    <div className={lineBStyles.bar}>
      {categoryPill}
      <div className={lineBStyles.tabs}>
        {(tabs || []).map(t => {
          const key = t[keyField]
          return (
            <button
              key={key}
              className={`${lineBStyles.tab}${activeKey === key ? ' ' + lineBStyles.active : ''}`}
              onClick={() => onTabClick(key)}
            >
              <span className={lineBStyles.label}>{t.tab_name}</span>
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
