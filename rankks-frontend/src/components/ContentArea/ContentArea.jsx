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
import F1ContentArea from '../F1/F1ContentArea'

export default function ContentArea() {
  const {
    activeCompetition, activeEvent, activeTab, activeYear, activeCategory,
    setTab, setEvent, changeYear, activeSport, changeCompetition, activeSubEdition,
  } = useAppStore()

  const [competition, setComp] = useState(null)
  const [season, setSeason]    = useState(null)
  const [naming, setNaming]    = useState(null)
  const [logoOverride, setLogoOverride] = useState(null)
  const [loading, setLoading]  = useState(false)
  const [leadingPlayers, setLeadingPlayers] = useState([])
  const [seasonStats, setSeasonStats] = useState(null)
  const [categoryComps, setCategoryComps] = useState([])
  const [eventNaming, setEventNaming] = useState(null)
  const [yearEvents, setYearEvents] = useState(null)

  const apiYear = activeYear

  // F1 owns its own tables and its own tab semantics entirely (see
  // F1ContentArea) — every football/tennis-shaped effect below must skip
  // when F1 is active, otherwise they race F1's own state writes. This
  // exact bug (a stray/irrelevant competitions row causing setTab(null)
  // to fire against F1's activeTab) was found and fixed earlier; this
  // guard is what prevents it from ever recurring.
  const isF1 = activeSport === 'car-racing' && activeCompetition === 'formula-1-world-championship'

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
    if (isF1) return
    let cancelled = false
    setComp(null)
    api.getCompetition(activeCompetition).then(c => {
      if (cancelled) return
      setComp(c)
      if (c.events?.length && !activeEvent && activeSport !== 'tennis') setEvent(c.events[0].slug)
    }).catch(console.error)
    return () => { cancelled = true }
  }, [activeCompetition, isF1])

  useEffect(() => {
    if (!activeCompetition || !activeYear) return
    if (isF1) return
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
    }).catch(() => { if (!cancelled) { setSeason(null); setTab(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeCompetition, activeYear, activeEvent, isF1])

  useEffect(() => {
    if (!activeCompetition || !activeYear) return
    if (isF1) return
    setNaming(null)
    api.getNaming(activeCompetition, apiYear)
      .then(setNaming)
      .catch(() => setNaming(null))
  }, [activeCompetition, activeYear, isF1])

  // Era-specific logo (e.g. FIFA World Cup 2026 vs 2022) — same
  // separate-endpoint pattern as naming above, re-resolved on year
  // change without redoing the whole competition fetch.
  useEffect(() => {
    if (!activeCompetition || !activeYear) { setLogoOverride(null); return }
    if (isF1) return
    api.getCompetitionLogo(activeCompetition, apiYear)
      .then(setLogoOverride)
      .catch(() => setLogoOverride(null))
  }, [activeCompetition, activeYear, isF1])

  useEffect(() => {
    if (!activeCompetition || !activeYear) { setEventNaming(null); return }
    if (isF1) return
    fetch(`/api/competitions/${activeCompetition}/event-naming/${activeYear}`)
      .then(r => r.json())
      .then(d => setEventNaming(d?.data || null))
      .catch(() => setEventNaming(null))
  }, [activeCompetition, activeYear, isF1])

  // Year-scoped event list — only diverges from `competition.events` when an
  // event is gated on data (currently just Iconic Moments, hidden until a
  // video exists for that season). Kept as separate state rather than
  // folded into the main competition fetch so switching years doesn't
  // flash-reset colors/logo/naming that fetch also carries.
  useEffect(() => {
    if (!activeCompetition || !activeYear) { setYearEvents(null); return }
    if (isF1) return
    api.getCompetitionEvents(activeCompetition, activeYear)
      .then(setYearEvents)
      .catch(() => setYearEvents(null))
  }, [activeCompetition, activeYear, isF1])

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
  foundedYear={competition?.founded_year ?? competition?.valid_from}
  dissolvedYear={competition?.dissolved_year ?? competition?.valid_to}
  editionYears={competition?.edition_years}
/>
      <div className={styles.empty}>
        <span style={{ fontSize: 64, opacity: 0.3 }}>🏆</span>
        <p>Select a sport and competition to get started</p>
      </div>
    </div>
  )

  // F1 has its own dedicated content area — own tables, own nav semantics
  // (Standings + GP-by-round, rather than tennis/football's tab_group
  // system), so it doesn't attempt to fit through the templates/registry
  // path below at all.
  if (isF1) {
    return <F1ContentArea />
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

  const GROUP_LABELS = { final_tour: 'Final Tour', group_stages: 'Group Stages', league_phase: 'League Phase' }

  const lineATabs = groupKeys.length === 0
    ? tabs
    : (() => {
        const ungrouped = tabs.filter(t => !t.tab_group)
        const synthetic = groupKeys.map(gk => {
          const members = tabs.filter(t => t.tab_group === gk).sort((a, b) => a.display_order - b.display_order)
          return {
            tab_key: `__group__${gk}`,
            tab_name: GROUP_LABELS[gk] || gk,
            display_order: Math.min(...members.map(m => m.display_order)),
            is_default: members.some(m => m.is_default),
            __isGroupHeader: true,
            __groupKey: gk,
            __firstChildKey: members[0]?.tab_key,
          }
        })
        return [...ungrouped, ...synthetic].sort((a, b) => a.display_order - b.display_order)
      })()

  // Which tab_group is "active" — always derived from activeTab's own
  // data rather than tracked separately, so it can never drift out of
  // sync with what's actually rendering.
  //
  // activeTab may be either a real tab_key (curTabReal found) or the
  // synthetic '__results__<group>' key created below — resolved via
  // curTab further down, which checks both possibilities.
  const RESULTS_TAB_PREFIX = '__results__'
  const isResultsTabKey = activeTab?.startsWith(RESULTS_TAB_PREFIX)
  const activeResultsGroup = isResultsTabKey ? activeTab.slice(RESULTS_TAB_PREFIX.length) : null

  const curTabReal = tabs.find(t => t.tab_key === activeTab)
  const activeGroupKey = curTabReal?.tab_group || activeResultsGroup || null

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

  const lineBTabs = activeGroupKey
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

  // curTab: the thing renderContent/EventBlock actually key off. For the
  // synthetic Results tab there is no real result_tabs row, so a
  // lightweight stand-in is built here carrying just enough shape
  // (typology, tab_group, tab_name) for downstream code to treat it like
  // any other tab — renderContent's typology==='game' branch already
  // handles plain game tabs, it only additionally needs to know to pass
  // tabGroup instead of tabKey to GameTemplate (handled below).
  const curTab = curTabReal || (isResultsTabKey
    ? { tab_key: activeTab, tab_name: 'Results', typology: 'game', tab_group: activeResultsGroup, __isResultsCollapse: true }
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
          <Standings seasonId={cur.id} tabKey={activeTab} tabName={curTab.tab_group ? curTab.tab_name : null} columnConfig={competition?.column_config} competitionName={competition?.name || ''} yearConvention={yearConvention} />
          <Game seasonId={cur.id} tabKey={activeTab} tabName={curTab.tab_group ? curTab.tab_name : null} sport={activeSport} activeEvent={activeEvent} competitionName={competition?.name || ''} yearConvention={yearConvention} />
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
          <Template key={activeTab} seasonId={cur.id} tabKey={activeTab} mode={activeTab} sport={activeSport} activeEvent={activeEvent} isPast={cur.status === 'past'} competitionName={competition?.name || ''} yearConvention={yearConvention} endDate={cur.end_date} />
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
        />
      </Suspense>
    )
  }

  return (
    <div className={styles.area}>
<YearSelector 
  foundedYear={competition?.founded_year ?? competition?.valid_from}
  dissolvedYear={competition?.dissolved_year ?? competition?.valid_to}
  editionYears={competition?.edition_years}
/>

      {/* LINE A — category tournaments (tennis) OR result tabs (football),
          with grouped tabs (UCL Final Tour / Group Stages) collapsed to
          one synthetic header each via lineATabs */}
      {categoryComps.length > 0
        ? <LineA competitions={categoryComps} />
        : eventsAsLineA
          ? <LineA events={yearEvents || competition.events} />
          : <LineA
              tabs={activeSport !== 'tennis' ? lineATabs : []}
              onTabClick={handleLineATabClick}
              activeGroupKey={activeGroupKey}
              areaLabel={competition?.country_name || competition?.confederation}
              areaIso2={competition?.country_iso2}
            />
      }

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
        const isFlatStatTab = curTab?.typology === 'players' || curTab?.typology === 'clubs'
        if (activeSport === 'tennis' && tabs.length > 0) {
          return <LineB tabs={tabs} areaLabel={competition?.category_short || 'Grand Slam'} />
        }
        if (lineBTabs.length > 0) {
          return <LineB tabs={lineBTabs} />
        }
        if (eventsAsLineA) {
          return lineATabs.length > 0 ? <LineB tabs={lineATabs} /> : null
        }
        if (!isFlatStatTab && isAB && competition?.events?.length > 0) {
          return <LineB events={competition.events} competitionShortName={competition.category_short} />
        }
        return null
      })()}

      {activeCompetition && competition && (
        <EventBlock
          competition={competition} season={season} naming={naming} eventNaming={eventNaming}
          logoUrl={logoOverride?.logo_url}
          activeYear={activeYear} activeGender={genderForTab} activeTab={activeTab}
          activeTypology={curTab?.typology}
          activeTabGroup={activeGroupKey}
          activeEvent={activeEvent}
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
