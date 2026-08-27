// templates/teams/football_champion_history_template.jsx
// Football All-Time > Champion History — one row per season, "Last season
// top" order (backend already sorts ORDER BY year DESC). Backed by
// /results/champion-history-football/:seasonId — see that route's comment
// for exactly how Champion/Runner-Up/Third (standings position 1/2/3) and
// Top Scorer/Assist Leader (season-wide max goals/assists, with a running
// "Nth time" ordinal for both player and club) are derived.
import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import DeceasedMark from '../../shared/DeceasedMark'
import SearchableSelect from '../../shared/SearchableSelect'
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

// Champion/2nd/3rd — one shared cell shape for all 3 standings-position
// columns (Mohamed 2026-08-25: "Remove 2nd team under champion / Add 2
// col: 2nd... 3rd... Under the 3 columns: 135 pts") — logo + team name,
// ordinal count of times this team has finished in that exact position
// inline on the name, points total for that season on its own line below.
// Only Champion's own name is bold (Mohamed: "CSS strong: team only") —
// 2nd/3rd stay normal weight, same fontWeight toggle convention the
// Schedule tables use for winner/loser.
function TeamCell({ team, ordinal, teamFilter, strong }) {
  if (!team) return <span className="athlete-profile-small">—</span>
  const logo = getLogo(team.logo_url)
  const hit = teamFilter && team.canonical_name === teamFilter
  return (
    <div className="athlete-profile">
      {logo && <img src={logo} alt={team.canonical_name} className={styles.teamLogo} onError={e => { e.target.style.display = 'none' }} />}
      <div>
        <div className="athlete-name" style={{ fontWeight: strong ? 700 : 400 }}>
          <span className={hit ? styles.nameHighlight : ''}>{team.canonical_name}</span>
          {ordinal != null && <span className="athlete-profile-small"> ({ordinal})</span>}
        </div>
        {team.points != null && <div className="athlete-profile-small">{team.points} pts</div>}
      </div>
    </div>
  )
}

// Top Scorer/Assist Leader — player name + this season's value + ordinal
// ("Nth time this player led the league") e.g. "E. Lepaul 16 (1)", club
// name + its own ordinal ("Nth time this club produced the leader")
// stacked beneath. Deceased cross next to the player name, player/club
// name highlighted grey when it matches the "All Players"/"All Teams"
// filter. `value` generic so the same component serves both Goals
// (top_scorer) and Assists (assist_leader).
function ScorerCell({ scorer, value, teamFilter, playerFilter, activeYear }) {
  if (!scorer) return <span className="athlete-profile-small">—</span>
  const clubHit = teamFilter && scorer.club?.canonical_name === teamFilter
  const playerHit = playerFilter && scorer.canonical_name === playerFilter
  return (
    <div>
      <div className="athlete-name" style={{ fontWeight: 400 }}>
        <span className={playerHit ? styles.nameHighlight : ''}>{scorer.canonical_name}</span>
        {showDeceasedMark(scorer.death_date, activeYear) && <DeceasedMark />}
        {' '}{value}
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

function rowHasTeam(r, team) {
  return [
    r.champion?.canonical_name, r.runner_up?.canonical_name, r.third?.canonical_name,
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

export default function FootballChampionHistoryTemplate({ seasonId, yearConvention, competitionSlug, minYear }) {
  const { activeYear } = useAppStore()
  const [allRows, setAllRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [teamFilter, setTeamFilter] = useState('')
  const [playerFilter, setPlayerFilter] = useState('')

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — falls
  // back to "Champion History - <first season>-<year>" (Mohamed 2026-08-26:
  // the old "through <year>" wording implied coverage from zero, when this
  // page only covers from the competition's first ingested season) when
  // nothing's configured.
  const SUBTITLE_FALLBACK = minYear && minYear < activeYear
    ? `Champion History - from ${minYear} to ${activeYear}`
    : `Champion History - through ${activeYear}`
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !activeYear) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Champions', activeYear)
      .then(d => setPageSubtitle(d?.subtitle || SUBTITLE_FALLBACK))
      .catch(() => setPageSubtitle(SUBTITLE_FALLBACK))
  }, [competitionSlug, activeYear, minYear]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllRows([])
    api.getFootballChampionHistory(seasonId)
      .then(d => setAllRows(d?.rows || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setTeamFilter(''); setPlayerFilter('') }, [seasonId])

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  // Faceted — Teams' own list/count reflects the active Player filter (and
  // vice versa), never itself, same convention as every other faceted
  // dropdown in this app.
  const teamCounts = new Map()
  for (const r of allRows) {
    if (!playerFilter || rowHasPlayer(r, playerFilter)) {
      for (const name of [r.champion?.canonical_name, r.runner_up?.canonical_name, r.third?.canonical_name, r.top_scorer?.club?.canonical_name, r.assist_leader?.club?.canonical_name]) {
        if (name) teamCounts.set(name, (teamCounts.get(name) || 0) + 1)
      }
    }
  }
  const teams = [...teamCounts.keys()].sort((a, b) => a.localeCompare(b))

  const players = [...new Set(
    allRows.filter(r => !teamFilter || rowHasTeam(r, teamFilter))
      .flatMap(r => [r.top_scorer?.canonical_name, r.assist_leader?.canonical_name].filter(Boolean))
  )].sort((a, b) => a.localeCompare(b))

  const rows = allRows.filter(r =>
    (!teamFilter || rowHasTeam(r, teamFilter)) &&
    (!playerFilter || rowHasPlayer(r, playerFilter))
  )

  const hasActiveFilter = teamFilter || playerFilter

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <SearchableSelect
          value={teamFilter}
          onChange={setTeamFilter}
          options={teams.map(t => ({ value: t, label: t }))}
          allLabel="All Teams"
        />
        <SearchableSelect
          value={playerFilter}
          onChange={setPlayerFilter}
          options={players.map(p => ({ value: p, label: p }))}
          allLabel="All Players"
        />
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setTeamFilter(''); setPlayerFilter('') }}>
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
                <th className={`${styles.teamH} table-label-left`}>2nd</th>
                <th className={`${styles.teamH} table-label-left`}>3rd</th>
                <th className={`${styles.stat} table-label-left`}>Top Scorer</th>
                <th className={`${styles.stat} table-label-left`}>Assist Leader</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.year} className="table-row">
                  <td className={styles.seasonH}>
                    <div className="athlete-name">{toDisplayYear(r.year, yearConvention)}</div>
                    <div className="athlete-profile-small">Edition {r.edition}</div>
                  </td>
                  <td className={styles.teamH}>
                    <TeamCell team={r.champion} ordinal={r.champion?.title_no} teamFilter={teamFilter} strong />
                  </td>
                  <td className={styles.teamH}>
                    <TeamCell team={r.runner_up} ordinal={r.runner_up?.title_no} teamFilter={teamFilter} />
                  </td>
                  <td className={styles.teamH}>
                    <TeamCell team={r.third} ordinal={r.third?.title_no} teamFilter={teamFilter} />
                  </td>
                  <td className={styles.stat}>
                    <ScorerCell scorer={r.top_scorer} value={r.top_scorer?.goals} teamFilter={teamFilter} playerFilter={playerFilter} activeYear={activeYear} />
                  </td>
                  <td className={styles.stat}>
                    <ScorerCell scorer={r.assist_leader} value={r.assist_leader?.assists} teamFilter={teamFilter} playerFilter={playerFilter} activeYear={activeYear} />
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
