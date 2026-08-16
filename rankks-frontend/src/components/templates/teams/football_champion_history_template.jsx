// templates/teams/football_champion_history_template.jsx
// Football All-Time > Champion History — one row per season, "Last season
// top" order (backend already sorts ORDER BY year DESC). Backed by
// /results/champion-history-football/:seasonId — see that route's comment
// for exactly how Champion/Runner-Up (standings position 1/2) and Top
// Scorer/Assist Leader (season-wide max goals/assists, with a running
// "Nth time" ordinal for both player and club) are derived.
//
// Cup/Champion Trophy/League Cup have no ingested data yet — shown as a
// permanent "—" placeholder, same convention as the Team Stats/Player
// Stats All-Time pages.
import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import DeceasedMark from '../../shared/DeceasedMark'
import styles from './football_champion_history_template.module.css'

function getLogo(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return null
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

// Same year-after-death rule as every other All-Time page's deceased
// cross — activeYear is the page's own "through <year>" vantage point,
// not the historical row's year.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

// Champion/Runner-Up — logo + team name, ordinal title count inline on
// the champion's name. Runner-up (no ordinal) stacks beneath. Team name
// gets the grey "All teams" filter highlight when it matches.
function TeamCell({ team, ordinal, runnerUp, teamFilter }) {
  if (!team) return <span className="athlete-profile-small">—</span>
  const logo = getLogo(team.logo_url)
  const hit = teamFilter && team.canonical_name === teamFilter
  const runnerHit = teamFilter && runnerUp?.canonical_name === teamFilter
  return (
    <div className="athlete-profile">
      {logo && <img src={logo} alt={team.canonical_name} className={styles.teamLogo} onError={e => { e.target.style.display = 'none' }} />}
      <div>
        <div className="athlete-name">
          <span className={hit ? styles.nameHighlight : ''}>{team.canonical_name}</span>
          {ordinal != null && <span className="athlete-profile-small"> ({ordinal})</span>}
        </div>
        <div className="athlete-profile-small">
          {runnerUp ? <span className={runnerHit ? styles.nameHighlight : ''}>{runnerUp.canonical_name}</span> : '—'}
        </div>
      </div>
    </div>
  )
}

// Placeholder column (Cup/Champion Trophy/League Cup) — no ingested data
// yet, same 2-line dash shape as the real Champion column so the table
// doesn't jog when that data eventually lands.
function PlaceholderCell() {
  return (
    <div>
      <div className="athlete-name">—</div>
      <div className="athlete-profile-small">—</div>
    </div>
  )
}

// Top Scorer — player name + ordinal ("Nth time this player led the
// league"), club name + its own ordinal ("Nth time this club produced the
// top scorer") stacked beneath. Deceased cross next to the player name,
// player/club name highlighted grey when it matches the "All players"/
// "All teams" filter.
function ScorerCell({ scorer, teamFilter, playerFilter, activeYear }) {
  if (!scorer) return <span className="athlete-profile-small">—</span>
  const clubHit = teamFilter && scorer.club?.canonical_name === teamFilter
  const playerHit = playerFilter && scorer.canonical_name === playerFilter
  return (
    <div>
      <div className="athlete-name">
        <span className={playerHit ? styles.nameHighlight : ''}>{scorer.canonical_name}</span>
        {showDeceasedMark(scorer.death_date, activeYear) && <DeceasedMark />}
        {scorer.player_no != null && <span className="athlete-profile-small"> ({scorer.player_no})</span>}
      </div>
      {scorer.club && (
        <div className="athlete-profile-small">
          <span className={clubHit ? styles.nameHighlight : ''}>{scorer.club.canonical_name}</span>
          {scorer.club.team_no != null && ` (${scorer.club.team_no})`}
        </div>
      )}
    </div>
  )
}

function rowMatchesSearch(r, q) {
  const names = [
    r.champion?.canonical_name, r.runner_up?.canonical_name,
    r.top_scorer?.canonical_name, r.top_scorer?.club?.canonical_name,
    r.assist_leader?.canonical_name, r.assist_leader?.club?.canonical_name,
  ]
  return names.some(n => n && n.toLowerCase().includes(q))
}

function rowHasTeam(r, team) {
  return [
    r.champion?.canonical_name, r.runner_up?.canonical_name,
    r.top_scorer?.club?.canonical_name, r.assist_leader?.club?.canonical_name,
  ].includes(team)
}

function rowHasPlayer(r, player) {
  return r.top_scorer?.canonical_name === player || r.assist_leader?.canonical_name === player
}

// Ligue 1 stores season START year (year_convention='start') — DB year
// 2025 is the 2025/26 season, displayed everywhere else as "2026" (see
// EventBlock.jsx's identical dbYear/toDisplayYear pair). This table lists
// many historical rows at once, each carrying its own raw DB year, so it
// needs this same conversion applied per-row rather than once like the
// Team/Player Stats pages (which only ever show the single currently-
// viewed year, via activeYear straight from the store).
function toDisplayYear(rawYear, yearConvention) {
  return yearConvention === 'start' ? rawYear + 1 : rawYear
}

export default function FootballChampionHistoryTemplate({ seasonId, yearConvention, competitionSlug }) {
  const { activeYear } = useAppStore()
  const [allRows, setAllRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [playerFilter, setPlayerFilter] = useState('')

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !activeYear) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Champions', activeYear)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [competitionSlug, activeYear])

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllRows([])
    api.getFootballChampionHistory(seasonId)
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
    r.top_scorer?.club?.canonical_name, r.assist_leader?.club?.canonical_name,
  ].filter(Boolean)))].sort((a, b) => a.localeCompare(b))

  const players = [...new Set(allRows.flatMap(r => [
    r.top_scorer?.canonical_name, r.assist_leader?.canonical_name,
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
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input
          className="search-input"
          placeholder="Search team or player"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={playerFilter} onChange={e => setPlayerFilter(e.target.value)}>
          <option value="">All players</option>
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
        <div className={styles.tableScroll}>
          <table className={`${styles.table} table-thead-border`}>
            <thead>
              <tr>
                <th className={`${styles.seasonH} table-label-left`}>Season</th>
                <th className={`${styles.teamH} table-label-left`}>Champion</th>
                <th className="table-label-left">Cup</th>
                <th className="table-label-left">Champion Trophy</th>
                <th className="table-label-left">League Cup</th>
                <th className="table-label-left">Top Scorer</th>
                <th className="table-label-left">Assist Leader</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.year} className="table-row">
                  <td>
                    <div className="athlete-name">{toDisplayYear(r.year, yearConvention)}</div>
                    <div className="athlete-profile-small">Edition {r.edition}</div>
                  </td>
                  <td>
                    <TeamCell team={r.champion} ordinal={r.champion?.title_no} runnerUp={r.runner_up} teamFilter={teamFilter} />
                  </td>
                  <td className={styles.stat}><PlaceholderCell /></td>
                  <td className={styles.stat}><PlaceholderCell /></td>
                  <td className={styles.stat}><PlaceholderCell /></td>
                  <td className={styles.stat}>
                    <ScorerCell scorer={r.top_scorer} teamFilter={teamFilter} playerFilter={playerFilter} activeYear={activeYear} />
                  </td>
                  <td className={styles.stat}>
                    <ScorerCell scorer={r.assist_leader} teamFilter={teamFilter} playerFilter={playerFilter} activeYear={activeYear} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
