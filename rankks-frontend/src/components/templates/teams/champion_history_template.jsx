import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import DeceasedMark from '../../shared/DeceasedMark'
import { basketballSubtitleParams } from '../../../utils/basketballSubtitleMap'
import styles from './champion_history_template.module.css'

const DEFAULT_LOGO = '/media/default/club.png' // shared default across every sport, not a per-sport asset

function getLogo(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return null
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

// Same year-after-death rule as every other All-Time page's deceased
// cross (F1/players_all_time) — activeYear is the page's own "through
// <year>" vantage point, not the historical row's year, since a player
// who won an award decades ago was obviously alive then.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

// Champion/Runner-Up — logo + team name, ordinal title count inline on
// name for Champion, Finals game-win score stacked beneath (per Mohamed's
// spec: "results of the final — 4 (champion) / 1 (runner up)"). Team name
// gets the grey "All Teams" filter highlight when it matches.
function TeamCell({ team, ordinal, wins, teamFilter }) {
  if (!team) return <span className="athlete-profile-small">—</span>
  const logo = getLogo(team.logo_url)
  const hit = teamFilter && team.canonical_name === teamFilter
  return (
    <div className="athlete-profile">
      <img
        src={logo || DEFAULT_LOGO}
        alt={team.canonical_name}
        className={styles.teamLogo}
        onError={e => {
          if (e.target.src !== new URL(DEFAULT_LOGO, window.location.href).href) {
            e.target.src = DEFAULT_LOGO
          }
        }}
      />
      <div>
        <div className="athlete-name">
          <span className={hit ? styles.nameHighlight : ''}>{team.canonical_name}</span>
          {ordinal != null && <span className="athlete-profile-small"> ({ordinal})</span>}
        </div>
        <div className="athlete-profile-small">{wins}</div>
      </div>
    </div>
  )
}

// Season Standing Leader — the single best record league-wide that year
// on line 1 (bold, with W-L), whichever conference that's NOT in on line
// 2 (smaller, per Mohamed's spec: "if West is first of conf, display
// East second line and vice-versa"). Text only, no logo.
function StandingCell({ standing, teamFilter }) {
  if (!standing?.top) return <span className="athlete-profile-small">—</span>
  const topHit = teamFilter && standing.top.canonical_name === teamFilter
  const otherHit = teamFilter && standing.other?.canonical_name === teamFilter
  return (
    <div>
      <div className="athlete-name">
        <span className={topHit ? styles.nameHighlight : ''}>{standing.top.canonical_name}</span>{' '}
        <span className="stat-stack-value">{standing.top.wins}-{standing.top.losses}</span>
      </div>
      {standing.other && (
        <div className="athlete-profile-small">
          <span className={otherHit ? styles.nameHighlight : ''}>{standing.other.canonical_name}</span> {standing.other.wins}-{standing.other.losses}
        </div>
      )}
    </div>
  )
}

// MVP/Finals MVP — player name + ordinal ("Nth time this player won"),
// club name + its own ordinal ("Nth time this team produced a winner")
// stacked beneath, per Mohamed's spec. Deceased cross next to the player
// name, player/club name highlighted grey when it matches the "All Teams"/
// "All Players" filter.
function AwardCell({ award, teamFilter, playerFilter, activeYear }) {
  if (!award) return <span className="athlete-profile-small">—</span>
  const clubHit = teamFilter && award.club?.canonical_name === teamFilter
  const playerHit = playerFilter && award.canonical_name === playerFilter
  return (
    <div>
      <div className="athlete-name">
        <span className={playerHit ? styles.nameHighlight : ''}>{award.canonical_name}</span>
        {showDeceasedMark(award.death_date, activeYear) && <DeceasedMark />}
        {award.player_no != null && <span className="athlete-profile-small"> ({award.player_no})</span>}
      </div>
      {award.club && (
        <div className="athlete-profile-small">
          <span className={clubHit ? styles.nameHighlight : ''}>{award.club.canonical_name}</span>
          {award.club.team_no != null && ` (${award.club.team_no})`}
        </div>
      )}
    </div>
  )
}

function rowMatchesSearch(r, q) {
  const names = [
    r.champion?.canonical_name, r.runner_up?.canonical_name,
    r.standing_leader?.top?.canonical_name, r.standing_leader?.other?.canonical_name,
    r.mvp?.canonical_name, r.mvp?.club?.canonical_name,
    r.finals_mvp?.canonical_name, r.finals_mvp?.club?.canonical_name,
  ]
  return names.some(n => n && n.toLowerCase().includes(q))
}

function rowHasTeam(r, team) {
  const names = [
    r.champion?.canonical_name, r.runner_up?.canonical_name,
    r.standing_leader?.top?.canonical_name, r.standing_leader?.other?.canonical_name,
    r.mvp?.club?.canonical_name, r.finals_mvp?.club?.canonical_name,
  ]
  return names.includes(team)
}

function rowHasPlayer(r, player) {
  return r.mvp?.canonical_name === player || r.finals_mvp?.canonical_name === player
}

export default function ChampionHistoryTemplate({ seasonId, tabKey, activeEvent, isPast }) {
  const { activeYear } = useAppStore()

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [basketballSubtitle, setBasketballSubtitle] = useState(null)
  useEffect(() => {
    const p = basketballSubtitleParams(activeEvent, tabKey, activeYear, isPast)
    if (!p) { setBasketballSubtitle(null); return }
    api.getSubtitle('basketball', null, p.itemA, p.itemB, p.year, p.isPast)
      .then(d => setBasketballSubtitle(d?.subtitle || null))
      .catch(() => setBasketballSubtitle(null))
  }, [activeEvent, tabKey, activeYear, isPast])

  const [allRows, setAllRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [playerFilter, setPlayerFilter] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllRows([])
    api.getChampionHistory(seasonId)
      .then(d => setAllRows(d?.rows || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setTeamFilter(''); setPlayerFilter('') }, [seasonId])

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  const teams = [...new Set(allRows.flatMap(r => [
    r.champion?.canonical_name, r.runner_up?.canonical_name,
    r.standing_leader?.top?.canonical_name, r.standing_leader?.other?.canonical_name,
  ].filter(Boolean)))].sort((a, b) => a.localeCompare(b))

  const players = [...new Set(allRows.flatMap(r => [
    r.mvp?.canonical_name, r.finals_mvp?.canonical_name,
  ].filter(Boolean)))].sort((a, b) => a.localeCompare(b))

  const q = search.trim().toLowerCase()
  const rows = allRows.filter(r =>
    (!q || rowMatchesSearch(r, q)) &&
    (!teamFilter || rowHasTeam(r, teamFilter)) &&
    (!playerFilter || rowHasPlayer(r, playerFilter))
  )

  const hasActiveFilter = search || teamFilter || playerFilter

  return (
    <div className={styles.wrap}>
      {basketballSubtitle && (
        <div className="page-subtitle">{basketballSubtitle}</div>
      )}

      <div className="filter-bar">
        <input
          className="search-input"
          placeholder="Search team or player..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={playerFilter} onChange={e => setPlayerFilter(e.target.value)}>
          <option value="">All Players</option>
          {players.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setPlayerFilter('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} seasons</span>
      </div>

      {rows.length === 0 ? (
        <div className={`${styles.empty} empty-state`}>No history found.</div>
      ) : (
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={`${styles.seasonH} table-label-left`}>Season</th>
              <th className={`${styles.teamH} table-label-left`}>Champion</th>
              <th className={`${styles.teamH} table-label-left`}>Runner-Up</th>
              <th className="table-label-left">Season Standing Leader</th>
              <th className="table-label-left">MVP</th>
              <th className="table-label-left">Finals MVP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.year} className="table-row">
                <td>
                  <div className="athlete-name">{r.year}</div>
                  <div className="athlete-profile-small">Edition {r.edition}</div>
                </td>
                <td>
                  <TeamCell team={r.champion} ordinal={r.champion?.title_no} wins={r.champion?.wins} teamFilter={teamFilter} />
                </td>
                <td>
                  <TeamCell team={r.runner_up} wins={r.runner_up?.wins} teamFilter={teamFilter} />
                </td>
                <td className={styles.stat}><StandingCell standing={r.standing_leader} teamFilter={teamFilter} /></td>
                <td className={styles.stat}><AwardCell award={r.mvp} teamFilter={teamFilter} playerFilter={playerFilter} activeYear={activeYear} /></td>
                <td className={styles.stat}><AwardCell award={r.finals_mvp} teamFilter={teamFilter} playerFilter={playerFilter} activeYear={activeYear} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
