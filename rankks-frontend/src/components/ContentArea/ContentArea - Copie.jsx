import { useEffect, useRef, useState } from 'react'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import YearSelector from '../YearSelector/YearSelector'
import LineA from '../LineA/LineA'
import LineB from '../LineB/LineB'
import EventBlock from '../EventBlock/EventBlock'
import StandingsTemplate from '../templates/StandingsTemplate'
import GameTemplate from '../templates/GameTemplate'
import TennisDrawTemplate from '../templates/TennisDrawTemplate'
import PlayersTemplate from '../templates/PlayersTemplate'
import ScorersTemplate from '../templates/ScorersTemplate'
import EmptyState from '../EmptyState/EmptyState'
import VideoStrip from '../VideoStrip/VideoStrip'
import styles from './ContentArea.module.css'
import TennisPlayersTemplate from '../templates/TennisPlayersTemplate'
export default function ContentArea() {
  const {
    activeCompetition, activeEvent, activeTab, activeYear, activeCategory,
    setTab, setEvent, changeYear, activeSport,
  } = useAppStore()

  const [competition, setComp] = useState(null)
  const [season, setSeason]    = useState(null)
  const [naming, setNaming]    = useState(null)
  const [loading, setLoading]  = useState(false)
  const [categoryComps, setCategoryComps] = useState([])

  const apiYear = activeYear

  const activeTabRef = useRef(activeTab)
  useEffect(() => { activeTabRef.current = activeTab }, [activeTab])

  useEffect(() => {
    if (!activeCategory || !activeSport) { setCategoryComps([]); return }
    api.getCompetitionsByCategory(activeSport, activeCategory)
      .then(d => setCategoryComps(Array.isArray(d) ? d : []))
      .catch(() => setCategoryComps([]))
  }, [activeCategory, activeSport])

  useEffect(() => {
    if (!activeCompetition) { setComp(null); return }
    setComp(null)
    api.getCompetition(activeCompetition).then(c => {
      setComp(c)
      if (c.events?.length && !activeEvent) setEvent(c.events[0].slug)
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
        const tabs = d.seasons?.flatMap(s => s.result_tabs) || []
        const currentTab = activeTabRef.current
        const preserved  = currentTab && tabs.find(t => t.tab_key === currentTab)
        if (!preserved) {
          const def = tabs.find(t => t.is_default)
            || tabs.find(t => t.tab_key === 'draw-singles-m')
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

  if (!activeCompetition && !activeCategory) return (
    <div className={styles.area}>
      <YearSelector />
      <div className={styles.empty}>
        <span style={{ fontSize: 64, opacity: 0.3 }}>🏆</span>
        <p>Select a sport and competition to get started</p>
      </div>
    </div>
  )

  const genderForTab = (activeTab === 'draw-singles-m' || activeTab === 'players-m') ? 'M' : (activeTab === 'draw-singles-f' || activeTab === 'players-f') ? 'F' : null
  const cur = season?.seasons?.find(s => s.year === apiYear && (genderForTab ? s.gender === genderForTab : true))
            || season?.seasons?.find(s => s.year === apiYear)
            || season?.seasons?.[0]

  const allSeasonTabs = season?.seasons
    ?.filter(s => s.year === apiYear)
    ?.sort((a, b) => a.gender === 'M' ? -1 : 1)
    ?.flatMap(s => s.result_tabs || []) || []

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
    if (!cur || !curTab) return (
      <EmptyState type="no_data" message={`No data available for ${competition?.name || ''} ${activeYear}.`} />
    )

    switch (curTab.typology) {
      case 'standings':
        return <StandingsTemplate seasonId={cur.id} tabKey={activeTab} columnConfig={competition?.column_config} />

      case 'game':
        if (activeSport === 'tennis') {
          return <TennisDrawTemplate seasonId={cur.id} tabKey={activeTab} />
        }
        return <GameTemplate seasonId={cur.id} tabKey={activeTab} sport={activeSport} activeEvent={activeEvent} />

      case 'standings_game':
        return <>
          <StandingsTemplate seasonId={cur.id} tabKey={activeTab} columnConfig={competition?.column_config} />
          <GameTemplate seasonId={cur.id} tabKey={activeTab + '_games'} sport={activeSport} activeEvent={activeEvent} />
        </>

      case 'players':
        if (activeTab === 'players-m') return <TennisPlayersTemplate seasonId={cur.id} gender="M" />
        if (activeTab === 'players-f') return <TennisPlayersTemplate seasonId={cur.id} gender="F" />
        return <ScorersTemplate
          key={activeTab}
          seasonId={cur.id}
          tabKey={activeTab}
          mode={activeTab}
        />
      default:
        return <EmptyState type="default" message="This view is coming soon." />
    }
  }

  return (
    <div className={styles.area}>
      <YearSelector />

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
        <EventBlock competition={competition} season={season} naming={naming} activeYear={activeYear} activeGender={genderForTab} />
      )}

      <div className={styles.content}>
        {renderContent()}
        {cur && activeCompetition && <VideoStrip seasonId={cur.id} />}
      </div>
    </div>
  )
}
