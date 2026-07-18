import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import { getBasketballPageText } from '../../../utils/basketballSubtitles'
import styles from './teams_template.module.css'

// "Sort" dropdown — lets the user rank the list by any individual stat,
// always descending (high to low). NBA Titles + Seasons (in that order) is
// the default sort when nothing is selected — see the fallback branch below.
const SORT_OPTIONS = [
  { key: 'nba_titles',        label: 'NBA Titles' },
  { key: 'nba_finals',        label: 'NBA Finals' },
  { key: 'conf_titles',       label: 'Conf. Titles' },
  { key: 'conf_finals',       label: 'Conf. Finals' },
  { key: 'seasons',           label: 'Seasons' },
  { key: 'reg_season_won',    label: 'Reg. Season Wins' },
  { key: 'reg_season_played', label: 'Reg. Season Played' },
  { key: 'playoffs_won',      label: 'Playoffs Wins' },
  { key: 'playoffs_played',   label: 'Playoffs Played' },
  { key: 'standings_all_nba', label: 'Standings Leader (All NBA)' },
  { key: 'standings_conf',    label: 'Standings Leader (Conf.)' },
  { key: 'players_american',     label: 'US Players' },
  { key: 'players_international', label: 'International Players' },
]

// NBA Cup (the in-season tournament) started with the 2023-24 season —
// DB year 2024 under this competition's end-year convention. Displayed as
// "Finals/Titles" in one column (see nba_cup_finals/nba_cup_titles from
// /results/teams), gated to seasons where the tournament actually existed.
const NBA_CUP_INTRO_YEAR = 2024

function getTeamLogo(t) {
  if (t.logo_url) {
    if (t.logo_url.startsWith('http://') || t.logo_url.startsWith('https://')) return null
    if (t.logo_url.startsWith('/media/')) return t.logo_url
    if (t.logo_url.startsWith('/')) return `/media${t.logo_url}`
    return `/media/${t.logo_url}`
  }
  return null
}

// All-time cumulative team stats "through <year>" (BASK-NAV-01 page 10's Teams
// Template) — NBA Finals/Titles, Seasons, Conf Finals/Titles, MVPs, Players,
// Reg. Season W-L/Playoffs W-L.
export default function TeamsTemplate({ seasonId, tabKey, activeEvent, isPast, competitionName = '' }) {
  const { activeYear } = useAppStore()
  const basketballPageText = getBasketballPageText(activeEvent, tabKey, activeYear, isPast)
  const [allTeams, setAllTeams] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [conference, setConference] = useState('')
  const [sortStat, setSortStat] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllTeams([])
    api.getTeams(seasonId)
      .then(d => setAllTeams(d?.teams || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setConference(''); setSortStat('') }, [seasonId])

  let teams = allTeams
  if (search) teams = teams.filter(t => (t.canonical_name || '').toLowerCase().includes(search.toLowerCase()))
  if (conference) teams = teams.filter(t => t.conference === conference)

  const conferences = [...new Set(allTeams.map(t => t.conference).filter(Boolean))].sort()

  if (sortStat) {
    // Always descending (high to low). Ties on the chosen stat break by
    // NBA Titles, then NBA Finals played, then name — same cascade
    // regardless of which stat was picked (Mohamed's explicit rule).
    teams = [...teams].sort((a, b) => {
      const dStat = (Number(b[sortStat]) || 0) - (Number(a[sortStat]) || 0)
      if (dStat !== 0) return dStat
      const dTitles = (b.nba_titles || 0) - (a.nba_titles || 0)
      if (dTitles !== 0) return dTitles
      const dFinals = (b.nba_finals || 0) - (a.nba_finals || 0)
      if (dFinals !== 0) return dFinals
      return (a.canonical_name || '').localeCompare(b.canonical_name || '')
    })
  } else {
    // Already ordered NBA Titles DESC, Seasons DESC, name ASC by the API —
    // re-sort defensively here too in case a future API change drops it.
    teams = [...teams].sort((a, b) => {
      const byTitles = (b.nba_titles || 0) - (a.nba_titles || 0)
      if (byTitles !== 0) return byTitles
      const bySeasons = (b.seasons || 0) - (a.seasons || 0)
      if (bySeasons !== 0) return bySeasons
      return (a.canonical_name || '').localeCompare(b.canonical_name || '')
    })
  }

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  const hasActiveFilter = search || conference || sortStat
  const sorted = key => sortStat === key ? 'sorted-col' : ''
  const showNbaCup = activeYear >= NBA_CUP_INTRO_YEAR
  const sortOptions = (showNbaCup ? [...SORT_OPTIONS, { key: 'nba_cup_titles', label: 'NBA Cup' }] : SORT_OPTIONS)
    .slice().sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className={styles.wrap}>

      {/* page-title — global */}
      <div className="page-title">Teams</div>
      {basketballPageText && (
        <div className={styles.subtitle}>{basketballPageText.subtitle}</div>
      )}
      <PageNotice />

      {/* filter-bar — global */}
      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 180 }}
          placeholder="Search team..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-label" value={conference} onChange={e => setConference(e.target.value)}>
          <option value="">All Conferences</option>
          {conferences.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setConference(''); setSortStat('') }}>
            Clear
          </button>
        )}
        {/* filter-total — global */}
        <span className="filter-total">{teams.length} teams</span>
      </div>

      {teams.length === 0 ? (
        <div className={`${styles.empty} empty-state`}>No teams found.</div>
      ) : (
        <>
          <table className={`${styles.table} table-thead-border`}>
            <thead>
              <tr>
                <th className={styles.rank}></th>
                <th className={`${styles.teamH} table-label-left`}></th>
                <th className={`table-label ${sorted('seasons')}`}>Seasons</th>
                <th className={`${styles.stat} ${styles.groupDivider} table-label`} colSpan={2}>NBA</th>
                {showNbaCup && <th className={`${styles.stat} ${styles.groupDivider} table-label ${sorted('nba_cup_titles')}`}>NBA Cup</th>}
                <th className={`${styles.stat} ${styles.groupDivider} table-label`} colSpan={2}>Conference</th>
                <th className={`${styles.stat} ${styles.groupDivider} table-label`} colSpan={2}>Standings Leader</th>
                <th className={`${styles.stat} ${styles.groupDivider} table-label`} colSpan={3}>Reg. Season / Playoffs</th>
                <th className={`${styles.stat} ${styles.groupDivider} table-label`} colSpan={2}>Players</th>
              </tr>
              <tr>
                <th className={styles.rank}></th>
                <th className="table-label-left">Team</th>
                <th className="table-label"></th>
                <th className={`${styles.stat} ${styles.groupDivider} table-label ${sorted('nba_finals')}`}>Finals</th>
                <th className={`${styles.stat} table-label ${sorted('nba_titles')}`}>Titles</th>
                {showNbaCup && <th className={`${styles.stat} ${styles.groupDivider} table-label`}>Fin./Tit.</th>}
                <th className={`${styles.stat} ${styles.groupDivider} table-label ${sorted('conf_finals')}`}>Finals</th>
                <th className={`${styles.stat} table-label ${sorted('conf_titles')}`}>Titles</th>
                <th className={`${styles.stat} ${styles.groupDivider} table-label ${sorted('standings_all_nba')}`}>All NBA</th>
                <th className={`${styles.stat} table-label ${sorted('standings_conf')}`}>Conf.</th>
                <th className={`${styles.stat} ${styles.groupDivider} table-label ${sorted('reg_season_played')} ${sorted('playoffs_played')}`}>Played</th>
                <th className={`${styles.stat} table-label ${sorted('reg_season_won')} ${sorted('playoffs_won')}`}>W</th>
                <th className={`${styles.stat} table-label`}>L</th>
                <th className={`${styles.stat} ${styles.groupDivider} table-label ${sorted('players_american')}`}>US</th>
                <th className={`${styles.stat} table-label ${sorted('players_international')}`}>Int.</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => {
                const globalRank = i + 1
                const logo = getTeamLogo(t)
                return (
                  <tr key={t.entity_id} className="table-row">
                    <td className={styles.rank}>
                      <span className="event-rank rank-badge">{globalRank}</span>
                    </td>
                    <td>
                      <div className="athlete-profile">
                        <img
                          src={logo || '/media/default/basketball/club.png'}
                          alt={t.canonical_name}
                          className={styles.teamLogo}
                          onError={e => {
                            if (e.target.src !== new URL('/media/default/basketball/club.png', window.location.href).href) {
                              e.target.src = '/media/default/basketball/club.png'
                            }
                          }}
                        />
                        <div>
                          <div className="athlete-name">{t.canonical_name}</div>
                          {t.former_names && (
                            <div className="athlete-profile-small">Former: {t.former_names}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={`${styles.stat} stats-light ${sorted('seasons')}`}>{t.seasons}</td>
                    <td className={`${styles.stat} ${styles.groupDivider} stats-strong ${sorted('nba_finals')}`}>{t.nba_finals}</td>
                    <td className={`${styles.stat} stats-strong ${sorted('nba_titles')}`}>{t.nba_titles}</td>
                    {showNbaCup && <td className={`${styles.stat} ${styles.groupDivider} stats-light ${sorted('nba_cup_titles')}`}>{t.nba_cup_finals}/{t.nba_cup_titles}</td>}
                    <td className={`${styles.stat} ${styles.groupDivider} stats-light ${sorted('conf_finals')}`}>{t.conf_finals}</td>
                    <td className={`${styles.stat} stats-light ${sorted('conf_titles')}`}>{t.conf_titles}</td>
                    <td className={`${styles.stat} ${styles.groupDivider} stats-light ${sorted('standings_all_nba')}`}>{t.standings_all_nba}</td>
                    <td className={`${styles.stat} stats-light ${sorted('standings_conf')}`}>{t.standings_conf}</td>
                    <td className={`${styles.stat} ${styles.groupDivider} ${sorted('reg_season_played')} ${sorted('playoffs_played')}`}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">{t.reg_season_played}</span>
                        <span className="athlete-profile-small">{t.playoffs_played}</span>
                      </div>
                    </td>
                    <td className={`${styles.stat} ${sorted('reg_season_won')} ${sorted('playoffs_won')}`}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">{t.reg_season_won}</span>
                        <span className="athlete-profile-small">{t.playoffs_won}</span>
                      </div>
                    </td>
                    <td className={styles.stat}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">{t.reg_season_lost}</span>
                        <span className="athlete-profile-small">{t.playoffs_lost}</span>
                      </div>
                    </td>
                    <td className={`${styles.stat} ${styles.groupDivider} stats-light ${sorted('players_american')}`}>{t.players_american}</td>
                    <td className={`${styles.stat} stats-light ${sorted('players_international')}`}>{t.players_international}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
