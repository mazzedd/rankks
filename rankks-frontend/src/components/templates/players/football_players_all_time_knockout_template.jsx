// templates/players/football_players_all_time_knockout_template.jsx
// Player Stats for a KNOCKOUT-final competition (World Cup, and any future
// quadrennial/biennial competition with the same shape — selected in
// registry.js by competition_type). Sibling to
// football_players_all_time_template.jsx (standings-based, for domestic
// leagues) — that one reads Champion/W-D-L off `standings`, which doesn't
// reliably exist for this competition type (see teams-all-time-football-
// knockout's own comment for why), and shows domestic-only concepts
// (Cup/League Cup/club career) that don't apply to a national team.
//
// Backed by /results/players-all-time-football-knockout/:seasonId — same
// "through <year>" cutoff every other All-Time page uses.
//
// NO Group Stages/Knockout pill (2026-08-13) — confirmed via the live DB
// that player_season_stats has no per-round breakdown (result_tab_id is
// NULL for every row), only one season-wide total per player, so there's
// no way to split a player's OWN apps into Group Stages vs Knockout the
// way Team Stats splits a team's games. Played/Goals/Assists are season
// totals. Won/Drawn/Lost aren't a real personal record (they're the
// player's TEAM's own game-by-game record, same "closest proxy" the
// domestic Player Stats page uses too) — dropped from Sort by entirely
// (2026-08-13: "remove W, D, L from sort by") since they were sort-only
// with no dedicated column and risked misrepresenting a benched player's
// involvement as if it were personal form.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import DeceasedMark from '../../shared/DeceasedMark'
import SearchableSelect from '../../shared/SearchableSelect'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import { getPositionCode, getPositionGroup } from '../../../utils/positionCode'
import f1Styles from '../f1/f1.module.css'
import playersStyles from './players.module.css'

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker']

// Resolves entities.image_url into a usable <img src> — same
// normalisation pattern players_template.jsx's own resolveImageUrl uses
// (bare/relative local path, or a genuinely external CDN URL).
function resolveImageUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  if (url.startsWith('media/')) return `/${url}`
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

const SORT_OPTIONS = [
  { key: 'finals', label: 'Finals' },
  { key: 'titles', label: 'Titles' },
  { key: 'participations', label: 'Participations' },
  { key: 'played', label: 'Played' },
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
]

// Same year-after-death rule as every other All-Time page's deceased
// cross — the "through <year>" cutoff, not the browser's current date.
function showDeceasedMark(deathDate, cutoffYear) {
  if (!deathDate) return false
  return Number(cutoffYear) > new Date(deathDate).getFullYear()
}

function sortValue(row, sortKey) {
  switch (sortKey) {
    case 'finals': return row.finals
    case 'titles': return row.titles
    case 'participations': return row.participations
    case 'played': return row.played
    case 'goals': return row.goals
    case 'assists': return row.assists
    default: return 0
  }
}

// Same cascade the backend pre-sorts rows by (Participations, Titles,
// Finals, Played, name) — 2026-08-13: "change default sorting".
function defaultCompare(a, b) {
  return b.participations - a.participations
    || b.titles - a.titles
    || b.finals - a.finals
    || b.played - a.played
    || a.canonical_name.localeCompare(b.canonical_name)
}

export default function FootballPlayersAllTimeKnockoutTemplate({ seasonId, endDate, competitionSlug, year }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [position, setPosition] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [confedFilter, setConfedFilter] = useState('')
  const [sortBy, setSortBy] = useState('')

  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    setLoading(true)
    api.getFootballPlayersAllTimeKnockout(seasonId)
      .then(d => { if (!cancelled) setRows(d?.rows || []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId])

  useEffect(() => { setSearch(''); setPosition(''); setTeamFilter(''); setConfedFilter(''); setSortBy('') }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !year) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Players', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [competitionSlug, year])

  if (loading) return <div className={f1Styles.wrap}><Skeleton /></div>
  if (!rows?.length) return <div className={f1Styles.wrap}><Empty /></div>

  const teamCounts = rows.reduce((acc, r) => {
    if (r.team_name) acc[r.team_name] = (acc[r.team_name] || 0) + 1
    return acc
  }, {})
  const teamOptions = Object.keys(teamCounts).sort()

  const confedCounts = rows.reduce((acc, r) => {
    if (r.confederation) acc[r.confederation] = (acc[r.confederation] || 0) + 1
    return acc
  }, {})
  const confedOptions = Object.keys(confedCounts).sort()

  const q = search.trim().toLowerCase()
  const filtered = rows.filter(r => {
    if (q && !r.canonical_name?.toLowerCase().includes(q)) return false
    if (position && getPositionGroup(r.position) !== position) return false
    if (teamFilter && r.team_name !== teamFilter) return false
    if (confedFilter && r.confederation !== confedFilter) return false
    return true
  })

  // No sortBy: rows already arrive from the backend in the default
  // cascade, filtering preserves that order — no client re-sort needed.
  const sorted = sortBy
    ? [...filtered].sort((a, b) => sortValue(b, sortBy) - sortValue(a, sortBy) || defaultCompare(a, b))
    : filtered

  const hasActiveFilter = search || position || teamFilter || confedFilter || sortBy
  const clearFilters = () => { setSearch(''); setPosition(''); setTeamFilter(''); setConfedFilter(''); setSortBy('') }

  // Column highlight (same global .sortRowsHighlight convention as Team
  // Stats) — Won/Drawn/Lost have no dedicated column, so those three Sort-by
  // options simply light up nothing, same as picking them does today.
  const hi = (...keys) => keys.includes(sortBy) ? 'sortRowsHighlight' : ''

  return (
    <div className={f1Styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search Player" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={position} onChange={e => setPosition(e.target.value)}>
          <option value="">All Positions</option>
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <SearchableSelect
          value={teamFilter}
          onChange={setTeamFilter}
          options={teamOptions.map(name => ({ value: name, label: `${name} (${teamCounts[name]})` }))}
          allLabel="All Teams"
        />
        <select className="filter-label" value={confedFilter} onChange={e => setConfedFilter(e.target.value)}>
          <option value="">All Confederations</option>
          {confedOptions.map(c => <option key={c} value={c}>{c} ({confedCounts[c]})</option>)}
        </select>
        <select className="filter-label" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{sorted.length} players</span>
      </div>

      <div className={f1Styles.tableScroll}>
        <table className={`${f1Styles.table} ${f1Styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              <th className="table-label" style={{ textAlign: 'center', width: '5%' }}>Rank</th>
              <th className="table-label" style={{ textAlign: 'left', width: '20%' }}>Player</th>
              <th className="table-label" style={{ textAlign: 'center', width: '10%', whiteSpace: 'nowrap' }}>Age</th>
              <th className={`table-label ${hi('participations')}`} style={{ textAlign: 'center', width: '9%' }}>Part.</th>
              <th className={`table-label ${hi('finals')}`} style={{ textAlign: 'center', width: '9%' }}>Finals</th>
              <th className={`table-label ${hi('titles')}`} style={{ textAlign: 'center', width: '9%' }}>Titles</th>
              <th className={`table-label ${hi('played')}`} style={{ textAlign: 'center', width: '9%' }}>Played</th>
              <th className={`table-label ${hi('goals')}`} style={{ textAlign: 'center', width: '9%' }}>Goals</th>
              <th className={`table-label ${hi('assists')}`} style={{ textAlign: 'center', width: '9%' }}>Assists</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.entity_id} className={`table-row ${f1Styles.homeRow}`} style={{ animationDelay: `${i * 0.03}s` }}>
                <td className="stats-light" style={{ textAlign: 'center' }}>{i + 1}</td>
                <td style={{ textAlign: 'left' }}>
                  <div className={playersStyles.playerRow}>
                    <img
                      src={`/media/athletes/football/male/profile/${r.slug}.png`}
                      alt={r.canonical_name}
                      className="avatar"
                      onError={e => {
                        const fallback = resolveImageUrl(r.image_url)
                        if (fallback && e.target.src !== fallback) {
                          e.target.src = fallback
                        } else {
                          e.target.style.display = 'none'
                          e.target.nextSibling.style.display = 'flex'
                        }
                      }}
                    />
                    <div className="avatar-placeholder" style={{ display: 'none' }}>
                      {r.canonical_name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className={playersStyles.playerMeta}>
                      <span className="athlete-name">
                        {r.canonical_name}
                        {getPositionCode(r.position) && <span className="athletePosition"> - {getPositionCode(r.position)}</span>}
                      </span>
                      <div className={playersStyles.countryRow}>
                        <Flag iso2={r.country_iso2} name={r.country_name} className="flag" />
                        <span className="athlete-profile-small">{r.country_name || r.country_iso2 || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <div className="stat-stack">
                    <span className="stat-stack-value-light">
                      {calcAge(r.birth_date, endDate, r.death_date) ?? '–'}
                      {showDeceasedMark(r.death_date, year) && <DeceasedMark />}
                    </span>
                    {r.birth_date && <span className="athlete-profile-small">{fmtBirth(r.birth_date)}</span>}
                  </div>
                </td>
                <td className={`stats-light ${hi('participations')}`} style={{ textAlign: 'center' }}>
                  <div className="stats-strong" style={{ padding: 0 }}>{r.participations}</div>
                  {r.first_year != null && (
                    <div className="athlete-profile-small">
                      {r.first_year === r.last_year ? r.first_year : `${r.first_year}-${r.last_year}`}
                    </div>
                  )}
                </td>
                <td className={`stats-light ${hi('finals')}`} style={{ textAlign: 'center' }}>{r.finals}</td>
                <td className={`athlete-name ${hi('titles')}`} style={{ textAlign: 'center' }}>{r.titles}</td>
                <td className={`stats-light ${hi('played')}`} style={{ textAlign: 'center' }}>{r.played}</td>
                <td className={`stats-light ${hi('goals')}`} style={{ textAlign: 'center' }}>{r.goals}</td>
                <td className={`stats-light ${hi('assists')}`} style={{ textAlign: 'center' }}>{r.assists}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(8)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No player data available.</div>
}
