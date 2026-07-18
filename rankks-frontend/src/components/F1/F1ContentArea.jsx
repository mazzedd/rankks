// components/F1/F1ContentArea.jsx
//
// Navigation pattern FOR1-NAV-01 (RANKKS F1 Master Spec §1):
//   Line A: "Final Standings" + one tab per GP, in round order.
//   Line B under Standings: Drivers / Teams / Races / Fastest Lap.
//   Line B under a GP: whichever sessions that GP actually has, in
//     display_order (Race Results, Qualifying, Sprint, Sprint
//     Qualifying, Practice N...) — read off the API, never hardcoded,
//     since this varies by era and by weekend type.
//
// IMPORTANT DESIGN RULE — activeTab (global store) holds ONLY the Line A
// selection: 'f1-standings' or `gp-{slug}`. It never holds a Line B
// value. An earlier version of this file used activeTab for BOTH axes
// at once, which meant clicking a standings sub-tab (Drivers/Teams/...)
// overwrote activeTab away from 'f1-standings', and Line A's "Final
// Standings" tab (which highlights via strict activeTab === tab_key)
// lost its highlight. Line B's own selection is local component state
// instead — correct, since Line B here is a custom component reading a
// plain `activeKey` prop, not the shared LineB.jsx (which reads global
// activeTab itself).
//
// YEAR-CHANGE NAV PRESERVATION (fixed in this version) — previously,
// switching years unconditionally reset BOTH the standings sub-tab
// (back to Drivers) AND Line A (back to Final Standings), even when
// the current selection was still perfectly valid in the new year
// (e.g. 2021/Final Standings/Teams -> 2020 incorrectly landed on
// 2021/Final Standings/Drivers). Fixed so that:
//   - Final Standings sub-tab (Drivers/Teams/Races/Fastest Lap) is
//     left untouched on year change, since Final Standings always
//     exists for every year.
//   - A selected GP is only redirected to Final Standings if it
//     genuinely doesn't exist in the new year's calendar (e.g. Austria
//     existed in 2021 but not 2020).
//   - If the same GP persists across the year change, its session
//     sub-tab is restored by session_type (e.g. stays on Qualifying)
//     rather than always resetting to the first session.
import { useEffect, useRef, useState, useCallback, useLayoutEffect, Suspense, lazy } from 'react'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import YearSelector from '../navigation/YearSelector'
import LineA from '../navigation/LineA'
import { F1ChampionshipBlock, F1GPBlock, F1TeamsChampionshipBlock } from './F1EventBlock'
import lineBStyles from '../navigation/LineB.module.css'
import styles from './F1ContentArea.module.css'

const F1DriversTemplate    = lazy(() => import('../templates/f1/F1DriversTemplate'))
const F1TeamsTemplate      = lazy(() => import('../templates/f1/F1TeamsTemplate'))
const F1RacesTemplate      = lazy(() => import('../templates/f1/F1RacesTemplate'))
const F1FastestLapTemplate = lazy(() => import('../templates/f1/F1FastestLapTemplate'))
const F1SessionResults     = lazy(() => import('../templates/f1/F1SessionResultsTemplate'))
const F1QualifyingTemplate = lazy(() => import('../templates/f1/F1QualifyingTemplate'))
const F1DriversAllTimeTemplate = lazy(() => import('../templates/f1/F1DriversAllTimeTemplate'))
const F1TeamsAllTimeTemplate   = lazy(() => import('../templates/f1/F1TeamsAllTimeTemplate'))
const F1RacesAllTimeTemplate   = lazy(() => import('../templates/f1/F1RacesAllTimeTemplate'))
// Reused as-is (not F1-specific) — same gallery UI football/tennis use,
// pointed at F1's own iconic-moments endpoint via the fetchMoments prop.
const IconicMomentsTemplate = lazy(() => import('../templates/media/iconic_moments_template'))

const STANDINGS_LINE_B_BASE = [
  { tab_key: 'f1-drivers',     tab_name: 'Drivers' },
  { tab_key: 'f1-teams',       tab_name: 'Teams' },
  { tab_key: 'f1-races',       tab_name: 'Races' },
  { tab_key: 'f1-fastest-lap', tab_name: 'Fastest Lap' },
]
// All-Time's own Line B — Drivers is the first (and, for now, only)
// item. More (Teams/Races/Fastest Lap) come later once those templates
// are built; adding a tab here is all that'll be needed then.
const ALL_TIME_LINE_B_BASE = [
  { tab_key: 'f1-at-drivers', tab_name: 'Driver Stats' },
  { tab_key: 'f1-at-teams',   tab_name: 'Team Stats' },
  { tab_key: 'f1-at-races',   tab_name: 'Race Stats' },
]
// Iconic Moments lives on Line A now (tab_key 'videos', pinned right —
// see LineA.jsx's PinnedTab), not as a Line B child of Final Standings.
// Still gated on seasonData.has_iconic_moments, same conditional-visibility
// rule Section 30 applies to football/tennis's Videos tab.

// Session label — "Race Results" unified across every weekend type per
// the locked spec decision (no special-casing sprint weekends).
function sessionLabel(sessionType) {
  return sessionType === 'Race' ? 'Race Results' : sessionType
}

export default function F1ContentArea() {
  const { activeYear, changeYear, activeTab, setTab } = useAppStore()

  const [availableYears, setAvailableYears] = useState([])
  const [seasonData, setSeasonData]         = useState(null)
  const [gpData, setGPData]                 = useState(null)
  const [loading, setLoading]               = useState(false)
  const [competition, setCompetition]       = useState(null) // holds primary_color/secondary_color from admin
  const [logoUrl, setLogoUrl]               = useState(null) // holds the year-resolved era logo (or default)

  const [standingsSubTab, setStandingsSubTab] = useState('f1-drivers') // Line B, standings mode — local, not global
  const [activeSessionId, setActiveSessionId] = useState(null)         // Line B, GP mode — local, not global
  const [allTimeSubTab, setAllTimeSubTab] = useState('f1-at-drivers')  // Line B, All-Time mode — local, not global

  // activeTab is the ONLY thing that decides GP vs standings mode —
  // see file header for why this must stay a single, narrowly-scoped variable.
  const activeGPSlug  = activeTab?.startsWith('gp-') ? activeTab.slice(3) : null
  const isIconicMode  = activeTab === 'videos'
  const isAllTimeMode = activeTab === 'all-time'
  const isStandings   = !activeGPSlug && !isIconicMode && !isAllTimeMode

  // Refs used only for year-change nav preservation (see file header).
  const prevGPSlugRef = useRef(null)
  const lastSessionTypeRef = useRef(null)

  // Declared early (rather than further below with the other derived
  // values) because the effects below reference it — it must exist
  // before those effects run.
  const activeSession = gpData?.sessions?.find(s => s.id === activeSessionId) || gpData?.sessions?.[0]

  // Also declared early, same reason — the era-logo effect below needs
  // it, and effects run in the order they're declared.
  const f1Year = availableYears.includes(activeYear) ? activeYear : (availableYears[0] || new Date().getFullYear())

  // Load available F1 years once
  useEffect(() => {
    api.getF1Years()
      .then(years => {
        setAvailableYears(years || [])
        if (years?.length && !years.includes(activeYear)) changeYear(years[0])
      })
      .catch(console.error)
  }, [])

  // Colors are NOT era-versioned in the schema (competitions.primary_color/
  // secondary_color are single columns) — fetch once on mount is correct.
  useEffect(() => {
    api.getCompetition('formula-1-world-championship')
      .then(setCompetition)
      .catch(() => setCompetition(null))
  }, [])

  // Logo IS era-versioned (competition_logos table, admin-managed per
  // year range) — must be refetched on every year change via the
  // dedicated endpoint, same one football/tennis's own ContentArea
  // already uses to feed EventBlock.jsx's logoUrl prop. Using
  // competition.logo_url here instead would only ever show the
  // default logo, never resolve an era override.
  useEffect(() => {
    if (!f1Year) { setLogoUrl(null); return }
    api.getCompetitionLogo('formula-1-world-championship', f1Year)
      .then(d => setLogoUrl(typeof d === 'string' ? d : d?.logo_url || null))
      .catch(() => setLogoUrl(null))
  }, [f1Year])

  // Default to standings on first mount
  useEffect(() => {
    if (!activeTab) setTab('f1-standings')
  }, [])

  // Load season GP list on year change; preserve nav position where possible.
  // Final Standings always exists, so its sub-tab (Drivers/Teams/etc.) is
  // left untouched. A selected GP is only redirected to Final Standings
  // if it genuinely doesn't exist in the new year's calendar.
  useEffect(() => {
    if (!f1Year || !availableYears.length) return
    setLoading(true)
    setSeasonData(null)
    const gpSlugBeforeSwitch = activeGPSlug
    api.getF1Season(f1Year)
      .then(data => {
        setSeasonData(data)
        if (gpSlugBeforeSwitch) {
          const stillExists = data?.gps?.some(gp => gp.slug === gpSlugBeforeSwitch)
          if (!stillExists) {
            setTab('f1-standings')
            setStandingsSubTab('f1-drivers')
          }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [f1Year, availableYears.length])

  // Track the session_type actually being viewed, so it can be restored
  // if the same GP carries over into another year.
  useEffect(() => {
    if (activeSession?.session_type) lastSessionTypeRef.current = activeSession.session_type
  }, [activeSession])

  // Load GP + sessions when a GP is selected (or its year changes).
  // If the same GP slug persisted across a year change, try to land on
  // the same session_type (e.g. stay on Qualifying) rather than always
  // defaulting to the first session.
  useEffect(() => {
    if (!activeGPSlug) { setGPData(null); prevGPSlugRef.current = null; return }
    const sameGPAcrossYear = prevGPSlugRef.current === activeGPSlug
    setActiveSessionId(null)
    api.getF1Gp(activeGPSlug, f1Year)
      .then(d => {
        setGPData(d)
        // Default to the first session in display_order (always "Race
        // Results" given how display_order is assigned in the loader),
        // unless the same GP persisted across a year change and its
        // previous session_type still exists this year.
        if (d?.sessions?.length) {
          let next = d.sessions[0]
          if (sameGPAcrossYear && lastSessionTypeRef.current) {
            const match = d.sessions.find(s => s.session_type === lastSessionTypeRef.current)
            if (match) next = match
          }
          setActiveSessionId(next.id)
        }
      })
      .catch(console.error)
    prevGPSlugRef.current = activeGPSlug
  }, [activeGPSlug, f1Year])

  const seasonId = seasonData?.season_id

  // Line A — Final Standings + GP list (scrollable), then Iconic Moments
  // and All-Time pinned to the right (see LineA.jsx's PinnedTab — tab_key
  // 'videos'/'all-time' is the same convention football/tennis/basketball
  // use). Iconic Moments stays gated on seasonData.has_iconic_moments;
  // All-Time has no backing content yet (renders a placeholder below) but
  // is always shown per spec — its templates come later.
  const lineATabs = [
    { tab_key: 'f1-standings', tab_name: 'Final Standings' },
    ...(seasonData?.gps?.map(gp => ({
      tab_key: `gp-${gp.slug}`,
      tab_name: gp.name,
    })) || []),
    ...(seasonData?.has_iconic_moments ? [{ tab_key: 'videos', tab_name: 'Iconic Moments' }] : []),
    { tab_key: 'all-time', tab_name: 'All-Time' },
  ]

  const gpLineBTabs = (gpData?.sessions || []).map(s => ({
    id: s.id,
    tab_name: sessionLabel(s.session_type),
    session_type: s.session_type,
  }))

  const standingsLineB = STANDINGS_LINE_B_BASE
  const allTimeLineB   = ALL_TIME_LINE_B_BASE

  // If the season changes (year swap) and Iconic Moments is no longer
  // available, fall back to Final Standings rather than leaving activeTab
  // pointed at a Line A tab that's no longer rendered.
  useEffect(() => {
    if (activeTab === 'videos' && seasonData && !seasonData.has_iconic_moments) {
      setTab('f1-standings')
    }
  }, [seasonData])

  const handleLineAClick = (tabKey) => setTab(tabKey)

  const handleLineBClick = (key) => {
    if (isStandings) setStandingsSubTab(key)
    else if (isAllTimeMode) setAllTimeSubTab(key)
    else setActiveSessionId(key)
  }

  const renderContent = () => {
    if (loading || !availableYears.length) return <Skeleton />
    if (!seasonData) return <Empty message={`No F1 data for ${f1Year}`} />

    if (isIconicMode) {
      if (!seasonId) return <Empty message="Season data unavailable" />
      return (
        <Suspense fallback={<Skeleton />}>
          <IconicMomentsTemplate
            seasonId={seasonId}
            competitionName="Formula 1"
            year={f1Year}
            sportSlug="car-racing"
            fetchMoments={api.getF1IconicMoments}
          />
        </Suspense>
      )
    }

    if (isAllTimeMode) {
      if (!seasonId) return <Empty message="Season data unavailable" />
      return (
        <Suspense fallback={<Skeleton />}>
          {allTimeSubTab === 'f1-at-drivers' && <F1DriversAllTimeTemplate seasonId={seasonId} />}
          {allTimeSubTab === 'f1-at-teams'   && <F1TeamsAllTimeTemplate seasonId={seasonId} />}
          {allTimeSubTab === 'f1-at-races'   && <F1RacesAllTimeTemplate seasonId={seasonId} />}
        </Suspense>
      )
    }

    if (isStandings) {
      if (!seasonId) return <Empty message="Season data unavailable" />
      return (
        <Suspense fallback={<Skeleton />}>
          {standingsSubTab === 'f1-drivers'     && <F1DriversTemplate seasonId={seasonId} />}
          {standingsSubTab === 'f1-teams'       && <F1TeamsTemplate seasonId={seasonId} />}
          {standingsSubTab === 'f1-races'       && <F1RacesTemplate seasonId={seasonId} />}
          {standingsSubTab === 'f1-fastest-lap' && <F1FastestLapTemplate seasonId={seasonId} />}
        </Suspense>
      )
    }

    if (!activeSession) return <Skeleton />
    const st = activeSession.session_type
    if (st === 'Qualifying' || st === 'Sprint Qualifying') {
      return <Suspense fallback={<Skeleton />}><F1QualifyingTemplate sessionId={activeSession.id} sessionType={st} /></Suspense>
    }
    return (
      <Suspense fallback={<Skeleton />}>
        <F1SessionResults
          sessionId={activeSession.id}
          sessionType={st}
          videoUrl={gpData?.gp?.video_url}
          source={gpData?.gp?.video_source}
          embeddable={gpData?.gp?.video_embeddable}
          thumbnailUrl={gpData?.gp?.video_thumbnail_url}
        />
      </Suspense>
    )
  }

  const minYear = availableYears.length ? Math.min(...availableYears) : 1950
  const maxYear = availableYears.length ? Math.max(...availableYears) : new Date().getFullYear()

  return (
    <div className={styles.area}>
      <YearSelector
        foundedYear={minYear}
        dissolvedYear={maxYear}
        editionYears={availableYears.length ? availableYears : undefined}
      />

      <LineA tabs={lineATabs} onTabClick={handleLineAClick} />

      <F1LineB
        tabs={isStandings ? standingsLineB : isAllTimeMode ? allTimeLineB : gpLineBTabs}
        activeKey={isStandings ? standingsSubTab : isAllTimeMode ? allTimeSubTab : activeSessionId}
        onTabClick={handleLineBClick}
        keyField={isStandings || isAllTimeMode ? 'tab_key' : 'id'}
      />

      {isStandings && seasonId && standingsSubTab === 'f1-teams' && (
        <F1TeamsChampionshipBlock seasonId={seasonId} year={f1Year} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} />
      )}
      {((isStandings && standingsSubTab !== 'f1-teams') || isIconicMode) && seasonId && (
        <F1ChampionshipBlock seasonId={seasonId} year={f1Year} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} />
      )}
      {!isStandings && gpData?.gp && (
        <F1GPBlock gp={gpData.gp} sessions={gpData.sessions} year={f1Year} primaryColor={competition?.primary_color} secondaryColor={competition?.secondary_color} logoUrl={logoUrl} />
      )}

      <div className={styles.content}>
        {renderContent()}
      </div>
    </div>
  )
}

// Line B here is deliberately a separate component, not the shared
// LineB.jsx — session tabs are local UI state (never mirrored into
// global activeTab, see file header), so it can't use LineB.jsx
// directly (that component reads activeTab from the store itself).
// But it MUST look identical to it, so it imports the exact same CSS
// module and replicates the exact same class structure (bar/tab/label,
// active = pink pill on the label, ScrollableTabs with left/right
// arrows) rather than inventing separate styling.
function F1LineB({ tabs, activeKey, onTabClick, keyField }) {
  if (!tabs?.length) return null
  return (
    <div className={lineBStyles.bar}>
      <F1ScrollableTabs>
        {tabs.map(t => {
          const key = t[keyField]
          const isIconic = t.tab_key === 'f1-iconic'
          return (
            <button
              key={key}
              className={`${lineBStyles.tab}${activeKey === key ? ' ' + lineBStyles.active : ''}`}
              onClick={() => onTabClick(key)}
            >
              <span className={lineBStyles.label}>{isIconic ? '▶ ' : ''}{t.tab_name}</span>
            </button>
          )
        })}
      </F1ScrollableTabs>
    </div>
  )
}

// Duplicated from LineB.jsx's internal (non-exported) ScrollableTabs —
// same scroll/arrow behavior, same CSS module, just needs its own copy
// since the original isn't exported for reuse.
function F1ScrollableTabs({ children }) {
  const scrollRef = useRef(null)
  const [canLeft, setCanLeft] = useState(false)
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
    <div className={lineBStyles.scrollWrapper}>
      <button className={`${lineBStyles.arrow} ${lineBStyles.arrowLeft}`} onClick={() => scroll(-1)} aria-label="Scroll left" style={{ display: canLeft ? 'flex' : 'none' }}>‹</button>
      <div className={lineBStyles.tabs} ref={scrollRef}>{children}</div>
      <button className={`${lineBStyles.arrow} ${lineBStyles.arrowRight}`} onClick={() => scroll(1)} aria-label="Scroll right" style={{ display: canRight ? 'flex' : 'none' }}>›</button>
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
