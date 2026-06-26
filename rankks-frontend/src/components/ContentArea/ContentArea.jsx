import { useEffect, useRef, useState, Suspense } from 'react'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import YearSelector from '../navigation/YearSelector'
import LineA from '../navigation/LineA'
import LineB from '../navigation/LineB'
import EventBlock from '../EventBlock/EventBlock'
import EmptyState from '../EmptyState/EmptyState'
import VideoStrip from '../VideoStrip/VideoStrip'
import styles from './ContentArea.module.css'
import { TEMPLATES, resolveTemplateKey } from '../templates/registry'

export default function ContentArea() {
  const {
    activeCompetition, activeEvent, activeTab, activeYear, activeCategory,
    setTab, setEvent, changeYear, activeSport, changeCompetition, activeSubEdition,
  } = useAppStore()

  const [competition, setComp] = useState(null)
  const [season, setSeason]    = useState(null)
  const [naming, setNaming]    = useState(null)
  const [loading, setLoading]  = useState(false)
  const [leadingPlayers, setLeadingPlayers] = useState([])
  const [seasonStats, setSeasonStats] = useState(null)
  const [categoryComps, setCategoryComps] = useState([])
  const [eventNaming, setEventNaming] = useState(null)

  const apiYear = activeYear

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

  useEffect(() => {
    if (!activeCategory || !activeSport) { setCategoryComps([]); return }
    api.getCompetitionsByCategory(activeSport, activeCategory, activeYear)
      .then(d => setCategoryComps(Array.isArray(d) ? d : []))
      .catch(() => setCategoryComps([]))
  }, [activeCategory, activeSport, activeYear])

  useEffect(() => {
    if (!categoryComps.length || !activeCompetition) return
    const stillValid = categoryComps.find(c => c.slug === activeCompetition)
    if (!stillValid && categoryComps[0]) {
      changeCompetition(categoryComps[0].slug)
    }
  }, [categoryComps])

  useEffect(() => {
    if (!activeCompetition) { setComp(null); return }
    setComp(null)
    api.getCompetition(activeCompetition).then(c => {
      setComp(c)
      if (c.events?.length && !activeEvent && activeSport !== 'tennis') setEvent(c.events[0].slug)
    }).catch(console.error)
  }, [activeCompetition])

  useEffect(() => {
    if (!activeCompetition || !activeYear) return
    setLoading(true)
    setSeason(null)
    api.getSeason(activeCompetition, apiYear, activeEvent).then(d => {
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
        // 1. Exact same tab_key exists in new competition → keep it
        const preserved = currentTab && tabs.find(t => t.tab_key === currentTab)
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
    }).catch(() => { setSeason(null); setTab(null) }).finally(() => setLoading(false))
  }, [activeCompetition, activeYear, activeEvent])

  useEffect(() => {
    if (!activeCompetition || !activeYear) return
    setNaming(null)
    api.getNaming(activeCompetition, apiYear)
      .then(setNaming)
      .catch(() => setNaming(null))
  }, [activeCompetition, activeYear])

  useEffect(() => {
    if (!activeCompetition || !activeYear) { setEventNaming(null); return }
    fetch(`/api/competitions/${activeCompetition}/event-naming/${activeYear}`)
      .then(r => r.json())
      .then(d => setEventNaming(d?.data || null))
      .catch(() => setEventNaming(null))
  }, [activeCompetition, activeYear])

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

  if (!activeCompetition && !activeCategory) return (
    <div className={styles.area}>
<YearSelector 
  firstDataYear={competition?.first_data_year ?? competition?.valid_from}
  dissolvedYear={competition?.dissolved_year ?? competition?.valid_to}
/>
      <div className={styles.empty}>
        <span style={{ fontSize: 64, opacity: 0.3 }}>🏆</span>
        <p>Select a sport and competition to get started</p>
      </div>
    </div>
  )

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
  const curTab = tabs.find(t => t.tab_key === activeTab)

  const renderContent = () => {
    if (!activeCompetition) return null
    if (loading) return (
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="skeleton" style={{ height: 60, borderRadius: 6 }} />
        ))}
      </div>
    )
    if (!cur) return (
  <EmptyState type="no_data" message={`No data available for ${competition?.name || ''} ${activeYear}.`} />
)

if (cur.status === 'cancelled') return (
  <EmptyState type="cancelled" message={`${competition?.name || ''} ${activeYear} was cancelled.`} />
)

if (!curTab) return (
  <EmptyState type="no_data" message={`No data available for ${competition?.name || ''} ${activeYear}.`} />
)

    const key = resolveTemplateKey(curTab.typology, activeSport, activeTab)

    if (curTab.typology === 'standings_game') {
      const Standings = TEMPLATES.standings
      const Game = TEMPLATES.game
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Standings seasonId={cur.id} tabKey={activeTab} columnConfig={competition?.column_config} competitionName={competition?.name || ''} yearConvention={yearConvention} />
          <Game seasonId={cur.id} tabKey={activeTab + '_games'} sport={activeSport} activeEvent={activeEvent} competitionName={competition?.name || ''} yearConvention={yearConvention} />
        </Suspense>
      )
    }

    if (!key) return <EmptyState type="default" message="This view is coming soon." />
    const Template = TEMPLATES[key]

    if (key === 'tennis_draw') {
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template seasonId={cur.id} tabKey={activeTab} competitionName={competition?.name || ''} year={String(activeYear)} />
        </Suspense>
      )
    }

    if (key === 'tennis_players') {
      const gender = activeTab === 'players-m' ? 'M' : 'F'
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template seasonId={cur.id} gender={gender} competitionName={competition?.name || ''} year={String(activeYear)} />
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
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template seasonId={seasonIdsParam} competitionName={competition?.name || ''} year={String(activeYear)} />
        </Suspense>
      )
    }

    if (key === 'players') {
      return (
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <Template key={activeTab} seasonId={cur.id} tabKey={activeTab} mode={activeTab} competitionName={competition?.name || ''} yearConvention={yearConvention} />
        </Suspense>
      )
    }

    // standings, game (non-tennis), and any future typology that needs
    // only the standard prop set fall through here.
    return (
      <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
        <Template seasonId={cur.id} tabKey={activeTab} sport={activeSport} activeEvent={activeEvent} columnConfig={competition?.column_config} competitionName={competition?.name || ''} yearConvention={yearConvention} />
      </Suspense>
    )
  }

  return (
    <div className={styles.area}>
<YearSelector 
  firstDataYear={competition?.first_data_year ?? competition?.valid_from}
  dissolvedYear={competition?.dissolved_year ?? competition?.valid_to}
/>

      {/* LINE A — category tournaments (tennis) OR result tabs (football) */}
      {categoryComps.length > 0
        ? <LineA competitions={categoryComps} />
        : <LineA
            tabs={activeSport !== 'tennis' ? tabs : []}
            areaLabel={competition?.country_name || competition?.confederation}
            areaIso2={competition?.country_iso2}
          />
      }

      {/* LINE B — tennis result tabs OR UCL sub-events */}
      {activeSport === 'tennis' && tabs.length > 0
        ? <LineB tabs={tabs} areaLabel={competition?.category_short || 'Grand Slam'} />
        : isAB && competition?.events?.length > 0
          ? <LineB events={competition.events} competitionShortName={competition.category_short} />
          : null
      }

      {activeCompetition && competition && (
        <EventBlock
          competition={competition} season={season} naming={naming} eventNaming={eventNaming}
          activeYear={activeYear} activeGender={genderForTab} activeTab={activeTab}
          leadingPlayers={leadingPlayers} seasonStats={seasonStats}
          hasVideosTab={tabs.some(t => t.tab_key === 'videos')}
        />
      )}

      <div className={styles.content}>
        {renderContent()}
        {cur && activeCompetition && <VideoStrip seasonId={cur.id} />}
      </div>
    </div>
  )
}
