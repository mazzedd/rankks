// templates/teams/football_champion_history_final_template.jsx
// Football All-Time > Champion History for a competition decided by a
// single Final match, with no season-long league table to read a Champion/
// Runner-Up/2nd/3rd shape off of (UEFA Champions League today — Mohamed
// 2026-08-26: "UCL: create content for totals... For Cham History, 2 cols
// only: Champion Score Runner-Up"). One row per edition — Champion (+
// running "Nth title" ordinal) / Score / Runner-Up (+ running "Nth runner-up"
// ordinal) / Top Scorer / Assist Leader (same day, same message: "Add col
// Top scorer and Assist Leader. Runner-Up (add number of finals lost)").
// Team/Player filters (same day: "Add All Teams + search All Players +
// search") reuse the exact faceted, no-count convention
// football_champion_history_template.jsx's own domestic-league version
// already settled on (2026-08-26: "remove count on All Teams Ddown").
// Backed by /results/champion-history-football-final/:seasonId — see that
// route's comment for exactly how each column is derived.
import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import SearchableSelect from '../../shared/SearchableSelect'
import styles from './football_champion_history_template.module.css'

function getLogo(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return null
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

function TeamCell({ team, ordinal, teamFilter, strong }) {
  if (!team) return <span className="athlete-profile-small">—</span>
  const logo = getLogo(team.logo_url)
  const hit = teamFilter && team.canonical_name === teamFilter
  return (
    <div className="athlete-profile">
      {logo && <img src={logo} alt={team.canonical_name} className={styles.teamLogo} onError={e => { e.target.style.display = 'none' }} />}
      <div className="athlete-name" style={{ fontWeight: strong ? 700 : 400 }}>
        <span className={hit ? styles.nameHighlight : ''}>{team.canonical_name}</span>
        {ordinal != null && <span className="athlete-profile-small"> ({ordinal})</span>}
      </div>
    </div>
  )
}

// Top Scorer/Assist Leader — player name + this edition's value, club name
// stacked beneath. Same highlight-on-filter-match convention as the cell
// above, `value` generic so the same component serves both Goals and
// Assists.
function ScorerCell({ scorer, value, teamFilter, playerFilter }) {
  if (!scorer) return <span className="athlete-profile-small">—</span>
  const clubHit = teamFilter && scorer.club_name === teamFilter
  const playerHit = playerFilter && scorer.canonical_name === playerFilter
  return (
    <div>
      <div className="athlete-name" style={{ fontWeight: 400 }}>
        <span className={playerHit ? styles.nameHighlight : ''}>{scorer.canonical_name}</span>
        {' '}{value}
      </div>
      {scorer.club_name && (
        <div className="athlete-profile-small">
          <span className={clubHit ? styles.nameHighlight : ''}>{scorer.club_name}</span>
        </div>
      )}
    </div>
  )
}

// Winner-oriented score + "(HIA)" penalty suffix — same convention
// football_home_knockout_template.jsx's own GameRow/penaltyLabel already
// established for the World Cup Schedule table (no spaces, no "pens").
// AET games carry their final tally in `extratime` (cumulative, not the
// 90-minute `fulltime`); PEN games stay at the pre-shootout scoreline in
// both `score.home/away` and `extratime`, with the shootout itself in
// `score.penalty` — same source data, same read order that table uses.
function formatScore(row) {
  const sp = row.score
  if (!sp || sp.home == null || sp.away == null) return null
  const winnerIsHome = row.winner_entity_id === row.home_entity_id
  const winnerScore = winnerIsHome ? sp.home : sp.away
  const loserScore = winnerIsHome ? sp.away : sp.home
  const p = sp.penalty
  const pens = (p && (p.home != null || p.away != null))
    ? `(${winnerIsHome ? p.home : p.away}I${winnerIsHome ? p.away : p.home})`
    : null
  return { winnerScore, loserScore, pens }
}

function rowHasTeam(r, team) {
  return [
    r.champion?.canonical_name, r.runner_up?.canonical_name,
    r.top_scorer?.club_name, r.assist_leader?.club_name,
  ].includes(team)
}

function rowHasPlayer(r, player) {
  return r.top_scorer?.canonical_name === player || r.assist_leader?.canonical_name === player
}

export default function FootballChampionHistoryFinalTemplate({ seasonId, competitionSlug, minYear }) {
  const { activeYear } = useAppStore()
  const [allRows, setAllRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [teamFilter, setTeamFilter] = useState('')
  const [playerFilter, setPlayerFilter] = useState('')

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
    api.getFootballChampionHistoryFinal(seasonId)
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

  // Faceted — Teams' own list reflects the active Player filter (and vice
  // versa), never itself, same convention as champion_history_fb's own
  // dropdowns.
  const teamNames = new Set()
  for (const r of allRows) {
    if (!playerFilter || rowHasPlayer(r, playerFilter)) {
      for (const name of [r.champion?.canonical_name, r.runner_up?.canonical_name, r.top_scorer?.club_name, r.assist_leader?.club_name]) {
        if (name) teamNames.add(name)
      }
    }
  }
  const teams = [...teamNames].sort((a, b) => a.localeCompare(b))

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
                <th className="table-label-left" style={{ width: '8%' }}>Season</th>
                <th className="table-label-left" style={{ width: '20%' }}>Champion</th>
                <th className="table-label-left" style={{ width: '13%', textAlign: 'center' }}>Score</th>
                <th className="table-label-left" style={{ width: '20%' }}>Runner-Up</th>
                <th className="table-label-left" style={{ width: '19.5%' }}>Top Scorer</th>
                <th className="table-label-left" style={{ width: '19.5%' }}>Assist Leader</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const sc = formatScore(r)
                return (
                  <tr key={r.season_id} className="table-row">
                    <td>
                      <div className="athlete-name">{r.year}</div>
                      <div className="athlete-profile-small">Edition {r.edition}</div>
                    </td>
                    <td><TeamCell team={r.champion} ordinal={r.champion?.title_no} teamFilter={teamFilter} strong /></td>
                    <td style={{ textAlign: 'center' }}>
                      {sc ? (
                        <>
                          <div className="athlete-name" style={{ fontWeight: 700 }}>{sc.winnerScore} - {sc.loserScore}</div>
                          {sc.pens && <div className="athlete-profile-small">{sc.pens}</div>}
                        </>
                      ) : <span className="athlete-profile-small">—</span>}
                    </td>
                    <td><TeamCell team={r.runner_up} ordinal={r.runner_up?.runner_up_no} teamFilter={teamFilter} /></td>
                    <td><ScorerCell scorer={r.top_scorer} value={r.top_scorer?.goals} teamFilter={teamFilter} playerFilter={playerFilter} /></td>
                    <td><ScorerCell scorer={r.assist_leader} value={r.assist_leader?.assists} teamFilter={teamFilter} playerFilter={playerFilter} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
