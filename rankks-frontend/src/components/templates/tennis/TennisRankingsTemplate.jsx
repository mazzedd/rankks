// templates/tennis/TennisRankingsTemplate.jsx
// ATP/WTA Rankings — one row per player ranked as of the selected year.
// Tournaments/Titles I Finals/Games Played are THIS YEAR ONLY (not career
// totals — Mohamed 2026-08-16: "tournaments won/played in 2025"); Seasons/
// Age stay career-through-this-year, same convention every other Totals
// page uses. Rank/Points are an approximation, not a live feed — see
// /competitions/rankings/:tour/:year's own comment: this DB only stores a
// per-match rank/points snapshot, so "rank as of <year>" means each
// player's LATEST such snapshot within that year (their most recent match,
// not their best result) — for the real current year that naturally
// resolves to "latest we have". Default order is the rank itself (no
// separate "Sort by: Rank" option needed — that's what the page IS).
// Known gap: real rank numbers can skip (e.g. 262 -> 278) wherever a
// player only played tournaments outside our tracked categories, or sat
// out entirely, that year — the numbers are real, the list just isn't a
// complete consecutive Top-N (no full external rankings feed exists here).
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import DeceasedMark from '../../shared/DeceasedMark'
import SearchableSelect from '../../shared/SearchableSelect'
import PlayerAllTimeResultsDrawer from '../../shared/PlayerAllTimeResultsDrawer'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import styles from '../f1/f1.module.css'

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

function sortLabel(tourLabel) {
  return [
    { key: 'age',           label: 'Age' },
    { key: 'finals',        label: 'Finals' },
    { key: 'games_played',  label: 'Games Played' },
    { key: 'losses',        label: 'Losses' },
    { key: 'points',        label: `${tourLabel} Points` },
    { key: 'seasons',       label: 'Seasons' },
    { key: 'titles',        label: 'Titles' },
    { key: 'tournaments',   label: 'Tournaments' },
    { key: 'wins',          label: 'Wins' },
  ].sort((a, b) => a.label.localeCompare(b.label))
}

function statValue(p, key, ageRefDate) {
  switch (key) {
    case 'age':           return calcAge(p.birth_date, ageRefDate, p.death_date) ?? -1
    case 'finals':        return p.finals_year
    case 'games_played':  return p.games_played
    case 'losses':        return p.games_lost
    case 'points':        return p.points ?? -1
    case 'seasons':       return p.season_count
    case 'titles':        return p.wins_year
    case 'tournaments':   return p.tournaments
    case 'wins':          return p.games_won
    default: return 0
  }
}

const PAGE_SIZE = 25

function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

export default function TennisRankingsTemplate({ tour, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [countryFilter, setCountryFilter] = useState('')
  const [playerFilter, setPlayerFilter]   = useState('')
  const [sortStat, setSortStat]           = useState('')
  const [page, setPage]                   = useState(1)

  const tourLabel = tour === 'wta' ? 'WTA' : 'ATP'
  // Same key format PlayerAllTimeResultsDrawer builds internally
  // (`player-history:${entityId}`) — clicking the name opens the exact
  // same drawer instance as the row's own "Full Results" link.
  const openVideo = useVideoPlayerStore(s => s.openVideo)

  useEffect(() => {
    if (!year) return
    setLoading(true)
    api.getTennisRankings(tour, year)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [tour, year])

  // Admin-configured subtitle line — item_a carries the tour name itself
  // ('ATP Rankings'/'WTA Rankings') since, like Home, this page is tour-
  // wide rather than tied to one competition_id — see
  // TennisTournamentStatsTemplate.jsx's identical block for the fetch
  // pattern rationale.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('tennis', null, `${tourLabel} Rankings`, null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [tourLabel, year])

  useEffect(() => { setCountryFilter(''); setPlayerFilter(''); setSortStat(''); setPage(1) }, [tour, year])
  useEffect(() => { setPage(1) }, [countryFilter, playerFilter, sortStat])

  if (loading || !year) return <Skeleton />
  if (!data?.players?.length) return <Empty />

  const players = [...new Set(data.players.map(p => p.canonical_name))].sort((a, b) => a.localeCompare(b))

  const countryCounts = new Map()
  data.players.forEach(p => {
    if (!p.country_iso2) return
    const entry = countryCounts.get(p.country_iso2) || { name: p.country_name || p.country_iso2, count: 0 }
    entry.count++
    countryCounts.set(p.country_iso2, entry)
  })
  const countries = [...countryCounts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))

  let rows = data.players.filter(p => {
    if (countryFilter && p.country_iso2 !== countryFilter) return false
    if (playerFilter && p.canonical_name !== playerFilter) return false
    return true
  })

  // Age as of the selected year — today if it's the real current year
  // (still in progress), else Dec 31 of that year, same "through <year>"
  // convention F1DriversAllTimeTemplate/TennisPlayerStatsTemplate use.
  const isCurrentYear = data.year === new Date().getFullYear()
  const ageRefDate = isCurrentYear ? new Date() : new Date(`${data.year}-12-31`)

  if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const d = statValue(b, sortStat, ageRefDate) - statValue(a, sortStat, ageRefDate)
      return d !== 0 ? d : (a.rank ?? 9999) - (b.rank ?? 9999)
    })
  }
  // No sortStat — rows already arrive rank-ascending from the API.

  const hasActiveFilter = countryFilter || playerFilter || sortStat
  // Finals and Titles are two separate sort keys sharing one physical
  // column (Finals I Titles) — either lights the same column up.
  const sorted = (...keys) => keys.includes(sortStat) ? 'sortRowsHighlight' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  const sortOptions = sortLabel(tourLabel)

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <SearchableSelect
          value={playerFilter}
          onChange={setPlayerFilter}
          options={players.map(name => ({ value: name, label: name }))}
          allLabel="All Players"
        />
        <SearchableSelect
          value={countryFilter}
          onChange={setCountryFilter}
          options={countries.map(([iso2, c]) => ({ value: iso2, label: `${c.name} (${c.count})` }))}
          allLabel="All Countries"
        />
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setCountryFilter(''); setPlayerFilter(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} players</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.pos}></th>
              <th className="table-label" style={th('left')}>Player</th>
              <th className={`table-label ${sorted('age')}`} style={th('center')}>Age</th>
              <th className={`table-label ${sorted('seasons')}`} style={th('center')}>Seasons</th>
              <th className={`table-label ${sorted('tournaments')}`} style={th('center')}>Tournaments</th>
              <th className={`table-label ${sorted('finals', 'titles')}`} style={th('center')}>Finals I Titles</th>
              <th className={`table-label ${sorted('games_played', 'wins', 'losses')}`} style={th('center')}>Games Played</th>
              <th className={`table-label ${sorted('points')}`} style={th('right')}>{tourLabel} Points</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((p, i) => {
              const age = calcAge(p.birth_date, ageRefDate, p.death_date)
              const birth = fmtBirth(p.birth_date)
              return (
                <tr key={p.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos}><span className="event-rank">{p.rank}</span></td>
                  <td>
                    <div className="entity-cell">
                      {/* Convention path first (same as tennis_players_template.jsx —
                          entities.image_url is unreliable/often null for tennis
                          players, per CLAUDE.md's Portrait paths rule), falling
                          back to image_url only if that specific file 404s. */}
                      <AthleteAvatar
                        src={`/media/athletes/tennis/${p.gender === 'F' ? 'female' : 'male'}/profile/${p.slug}.png`}
                        name={p.canonical_name}
                        sport="tennis"
                        gender={p.gender}
                        className="avatar"
                        fallback="letter"
                      />
                      <div className="entity-stack">
                        <strong>
                          <button type="button" className={styles.nameLink} onClick={() => openVideo(`player-history:${p.entity_id}`)}>
                            {p.canonical_name}
                          </button>
                        </strong>
                        <PlayerAllTimeResultsDrawer entityId={p.entity_id} name={p.canonical_name} hideTrigger />
                        <div className="entity-meta-row">
                          <Flag iso2={p.country_iso2} name={p.country_name} className="flag" />
                          <span className="cell-meta">{p.country_name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={sorted('age')} style={td('center')}>
                    {age != null ? (
                      <div className="stat-stack">
                        <span className="stat-stack-value-light">
                          {age}
                          {showDeceasedMark(p.death_date, ageRefDate.getFullYear()) && <DeceasedMark />}
                        </span>
                        <span className="cell-meta">{birth}</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className={sorted('seasons')} style={td('center')}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{p.season_count}</span>
                      {p.debut_year && <span className="cell-meta">{p.debut_year}-{data.year}</span>}
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('tournaments')}`} style={td('center')}>{p.tournaments}</td>
                  <td className={`stats-light ${sorted('finals', 'titles')}`} style={td('center')}>{p.finals_year} I <strong>{p.wins_year}</strong></td>
                  <td className={sorted('games_played', 'wins', 'losses')} style={td('center')}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{p.games_played}</span>
                      <span className="cell-meta">{p.games_lost}L-{p.games_won}W</span>
                    </div>
                  </td>
                  <td className={sorted('points')} style={td('right')}><strong>{p.points ?? '—'}</strong></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
            ‹ Prev
          </button>
          <span className="pagination-info">Page {safePage} / {totalPages}</span>
          <button className="pagination-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
            Next ›
          </button>
        </div>
      )}
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(8)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No ranking data available.</div>
}
