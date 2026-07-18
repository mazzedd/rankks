import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import { getBasketballPageText } from '../../../utils/basketballSubtitles'
import styles from './teams_template.module.css'

// "Sort" dropdown — always descending (high to low), options listed A-Z.
// MVP + Finals MVP + DPOY (in that order) is the default sort when
// nothing is selected — see the fallback branch below, same
// cascading-tiebreak pattern the Team Stats page (teams_template.jsx)
// uses for NBA Titles + Seasons.
const SORT_OPTIONS = [
  { key: 'mvp',        label: 'MVP' },
  { key: 'finals_mvp', label: 'Finals MVP' },
  { key: 'dpoy',       label: 'DPOY' },
  { key: 'smoy',       label: '6MOY' },
  { key: 'mip',        label: 'MIP' },
  { key: 'roy',        label: 'ROY' },
  { key: 'nba_cup_mvp', label: 'NBA Cup MVP' },
  { key: 'all_nba_1',  label: 'All-NBA 1st' },
  { key: 'all_def_1',  label: 'All-Defense 1st' },
].sort((a, b) => a.label.localeCompare(b.label))

function getTeamLogo(t) {
  if (t.logo_url) {
    if (t.logo_url.startsWith('http://') || t.logo_url.startsWith('https://')) return null
    if (t.logo_url.startsWith('/media/')) return t.logo_url
    if (t.logo_url.startsWith('/')) return `/media${t.logo_url}`
    return `/media/${t.logo_url}`
  }
  return null
}

// All-time cumulative individual awards credited to the team a player was
// on when they won them — MVP/Finals MVP/DPOY/6MOY/MIP/ROY/NBA Cup MVP/
// All-NBA 1st-2nd-3rd/All-Defense 1st-2nd, "through <year>". All-Star/MVP has no
// data source yet (all-star-4828 has zero seasons ingested) — the column
// ships now as a "—" placeholder per Mohamed's call, backfilled later.
export default function TeamHonoursTemplate({ seasonId, tabKey, activeEvent, isPast }) {
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
    api.getTeamHonours(seasonId)
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
    teams = [...teams].sort((a, b) => {
      const d = (Number(b[sortStat]) || 0) - (Number(a[sortStat]) || 0)
      return d !== 0 ? d : (a.canonical_name || '').localeCompare(b.canonical_name || '')
    })
  } else {
    teams = [...teams].sort((a, b) => {
      const byMvp = (b.mvp || 0) - (a.mvp || 0)
      if (byMvp !== 0) return byMvp
      const byFinalsMvp = (b.finals_mvp || 0) - (a.finals_mvp || 0)
      if (byFinalsMvp !== 0) return byFinalsMvp
      const byDpoy = (b.dpoy || 0) - (a.dpoy || 0)
      if (byDpoy !== 0) return byDpoy
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
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
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
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.rank}></th>
              <th className={`${styles.teamH} table-label-left`}>Team</th>
              <th className={`table-label ${sorted('mvp')}`}>MVP</th>
              <th className={`table-label ${sorted('finals_mvp')}`}>Fin. MVP</th>
              <th className="table-label">All-Star / MVP</th>
              <th className={`table-label ${sorted('dpoy')}`}>DPOY</th>
              <th className={`table-label ${sorted('smoy')}`}>6MOY</th>
              <th className={`table-label ${sorted('mip')}`}>MIP</th>
              <th className={`table-label ${sorted('roy')}`}>ROY</th>
              <th className={`table-label ${sorted('nba_cup_mvp')}`}>NBA Cup MVP</th>
              <th className={`table-label ${sorted('all_nba_1')}`}>NBA 1st/2nd/3rd</th>
              <th className="table-label">Def. 1st/2nd</th>
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
                  <td className={`${styles.stat} stats-strong ${sorted('mvp')}`}>{t.mvp}</td>
                  <td className={`${styles.stat} stats-light ${sorted('finals_mvp')}`}>{t.finals_mvp}</td>
                  <td className={`${styles.stat} stats-light`}>—</td>
                  <td className={`${styles.stat} stats-light ${sorted('dpoy')}`}>{t.dpoy}</td>
                  <td className={`${styles.stat} stats-light ${sorted('smoy')}`}>{t.smoy}</td>
                  <td className={`${styles.stat} stats-light ${sorted('mip')}`}>{t.mip}</td>
                  <td className={`${styles.stat} stats-light ${sorted('roy')}`}>{t.roy}</td>
                  <td className={`${styles.stat} stats-light ${sorted('nba_cup_mvp')}`}>{t.nba_cup_mvp}</td>
                  <td className={`${styles.stat} stats-light ${sorted('all_nba_1')}`}>{t.all_nba_1}/{t.all_nba_2}/{t.all_nba_3}</td>
                  <td className={`${styles.stat} stats-light`}>{t.all_def_1}/{t.all_def_2}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
