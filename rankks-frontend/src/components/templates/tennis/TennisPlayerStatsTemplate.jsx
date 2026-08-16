// templates/tennis/TennisPlayerStatsTemplate.jsx
// Totals > Player Stats — one row per player, cumulative "through <year>"
// across every category belonging to the tour. Same shape/conventions as
// F1DriversAllTimeTemplate.jsx (avatar+flag+age+seasons row) crossed with
// tennis_players_template.jsx's own avatar-path convention.
//
// Played = distinct tournament EDITIONS (competition+year) appeared in at
// least once, not matches. Wins = tournament TITLES (won the Final), not
// match wins. Shown all-categories (Played/Wins), as a title-conversion
// rate (Finals/Wins — every Final reached, won or lost), and Grand-Slam-
// only (G.Slam/Wins). Active/Retired pills key off is_active (played the
// real current-year season on this tour, independent of which "through
// <year>" is being browsed).
//
// Backed by /competitions/player-totals/:tour/:year — see that route's
// comment for the "as of viewed year" counting rule.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import DeceasedMark from '../../shared/DeceasedMark'
import PlayerAllTimeResultsDrawer from '../../shared/PlayerAllTimeResultsDrawer'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import styles from '../f1/f1.module.css'

const MEDIA_BASE = 'http://localhost:5173'

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

// Grouped Sort by — each group's 3 options key off a different denominator
// (Games = played_all, Finals = finals_all, Grand Slam/Master 1000 = their
// own played_* count), but "Wins" within a group is always the same
// underlying title count — sorting by Games>Wins and Finals>Wins therefore
// produce the same order, only the Ratio option's denominator differs.
const SORT_GROUPS = [
  { label: 'Games', options: [
    { key: 'games_played', label: 'Games Played' },
    { key: 'games_wins',   label: 'Wins' },
    { key: 'games_ratio',  label: 'Ratio (%)' },
  ] },
  { label: 'Finals', options: [
    { key: 'finals_played', label: 'Finals Played' },
    { key: 'finals_wins',   label: 'Wins' },
    { key: 'finals_ratio',  label: 'Ratio (%)' },
  ] },
  { label: 'Grand Slam', options: [
    { key: 'gs_played', label: 'Games Played' },
    { key: 'gs_wins',   label: 'Wins' },
    { key: 'gs_ratio',  label: 'Ratio (%)' },
  ] },
  { label: 'Master 1000', options: [
    { key: 'm1000_played', label: 'Games Played' },
    { key: 'm1000_wins',   label: 'Wins' },
    { key: 'm1000_ratio',  label: 'Ratio (%)' },
  ] },
]

// Which stat-pair COLUMN a given sort key belongs to, for header/cell
// highlighting — every key in a group lights up that group's one column
// (e.g. any of the 3 "Finals" options highlights the Finals/Wins column).
const SORT_KEY_COLUMN = {
  games_played: 'played', games_wins: 'played', games_ratio: 'played',
  finals_played: 'finals', finals_wins: 'finals', finals_ratio: 'finals',
  gs_played: 'gs', gs_wins: 'gs', gs_ratio: 'gs',
  m1000_played: 'm1000', m1000_wins: 'm1000', m1000_ratio: 'm1000',
}

function ratio(wins, played) { return played ? Math.round((wins / played) * 100) : null }

function statValue(p, key) {
  switch (key) {
    case 'games_played':  return p.played_all
    case 'games_wins':    return p.wins_all
    case 'games_ratio':   return ratio(p.wins_all, p.played_all) ?? -1
    case 'finals_played': return p.finals_all
    case 'finals_wins':   return p.wins_all
    case 'finals_ratio':  return ratio(p.wins_all, p.finals_all) ?? -1
    case 'gs_played':     return p.played_gs
    case 'gs_wins':       return p.wins_gs
    case 'gs_ratio':      return ratio(p.wins_gs, p.played_gs) ?? -1
    case 'm1000_played':  return p.played_m1000
    case 'm1000_wins':    return p.wins_m1000
    case 'm1000_ratio':   return ratio(p.wins_m1000, p.played_m1000) ?? -1
    default: return 0
  }
}

function getName(p) { return (p.canonical_name || '').toLowerCase() }

const PAGE_SIZE = 25

// Same reasoning as every other All-Time template's identical helper.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

// Wins number is bold (strong) within the stacked fraction — Played/name
// context is plain weight, matching the "only wins + player name are
// strong" spec.
function PlayedWinsCell({ played, wins }) {
  const pct = ratio(wins, played)
  return (
    <div className="stat-stack">
      <span className="stat-stack-value-light">{played} I <strong>{wins}</strong></span>
      <span className="cell-meta">{pct != null ? `${pct}%` : '—'}</span>
    </div>
  )
}

export default function TennisPlayerStatsTemplate({ tour, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [sortStat, setSortStat]           = useState('')
  const [showActive, setShowActive]       = useState(false)
  const [showRetired, setShowRetired]     = useState(false)
  const [page, setPage]                   = useState(1)
  // Same key format PlayerAllTimeResultsDrawer builds internally
  // (`player-history:${entityId}`) — clicking the name opens the exact
  // same drawer instance the row mounts (hidden trigger) below.
  const openVideo = useVideoPlayerStore(s => s.openVideo)

  useEffect(() => {
    if (!tour || !year) return
    setLoading(true)
    api.getTennisPlayerTotals(tour, year)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [tour, year])

  // Admin-configured subtitle line — see TennisTournamentStatsTemplate.jsx's
  // identical block for the full rationale.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('tennis', null, 'Totals', 'Player Stats', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => { setSearch(''); setCountryFilter(''); setSortStat(''); setShowActive(false); setShowRetired(false); setPage(1) }, [tour, year])
  useEffect(() => { setPage(1) }, [search, countryFilter, sortStat, showActive, showRetired])

  if (loading) return <Skeleton />
  if (!data?.players?.length) return <Empty />

  // Country dropdown shows a player-count per country — built from a
  // Map keyed by iso2 so repeat players collapse into one counted entry,
  // same "count of distinct players from this country" the user asked for
  // in place of the removed "All Players" list.
  const countryCounts = new Map()
  data.players.forEach(p => {
    if (!p.country_iso2) return
    const entry = countryCounts.get(p.country_iso2) || { name: p.country_name || p.country_iso2, count: 0 }
    entry.count++
    countryCounts.set(p.country_iso2, entry)
  })
  const countries = [...countryCounts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))

  // Independent toggle tags, not a radio group — both on (or neither)
  // means no status filtering, same convention as F1DriversAllTimeTemplate.
  const onlyActive  = showActive && !showRetired
  const onlyRetired = showRetired && !showActive

  let rows = data.players.filter(p => {
    if (search && !p.canonical_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (countryFilter && p.country_iso2 !== countryFilter) return false
    if (onlyActive && !p.is_active) return false
    if (onlyRetired && p.is_active) return false
    return true
  })

  if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const d = statValue(b, sortStat) - statValue(a, sortStat)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    // Default: most Grand Slam wins.
    rows = [...rows].sort((a, b) => {
      const byGSWins = b.wins_gs - a.wins_gs
      if (byGSWins !== 0) return byGSWins
      return getName(a).localeCompare(getName(b))
    })
  }

  const hasActiveFilter = search || countryFilter || sortStat || showActive || showRetired
  // Column-level highlight (not key-level) — see SORT_KEY_COLUMN above.
  const sorted = column => SORT_KEY_COLUMN[sortStat] === column ? 'sortRowsHighlight' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  const ageRefDate = data.year === new Date().getFullYear() ? new Date() : new Date(`${data.year}-12-31`)

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search Player" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(([iso2, c]) => <option key={iso2} value={iso2}>{c.name} ({c.count})</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_GROUPS.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
        <div className={styles.statusToggle}>
          <button
            type="button"
            className={`${styles.statusBtn} ${showActive ? styles.statusBtnActive : ''}`}
            onClick={() => setShowActive(v => !v)}
          >
            Active
          </button>
          <button
            type="button"
            className={`${styles.statusBtn} ${showRetired ? styles.statusBtnActive : ''}`}
            onClick={() => setShowRetired(v => !v)}
          >
            Retired
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setCountryFilter(''); setSortStat(''); setShowActive(false); setShowRetired(false) }}>
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
              <th className="table-label" style={th('center')}>Age</th>
              <th className="table-label" style={th('center')}>Seasons</th>
              <th className={`table-label ${sorted('gs')}`} style={th('center')}>G.Slam I Wins</th>
              <th className={`table-label ${sorted('m1000')}`} style={th('center')}>M1000 I Wins</th>
              <th className={`table-label ${sorted('finals')}`} style={th('center')}>Finals I Wins</th>
              <th className={`table-label ${sorted('played')}`} style={th('center')}>Played I Wins</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((p, i) => {
              const globalRank = pageStart + i + 1
              const genderPath = p.gender === 'F' ? 'female' : 'male'
              const imgSrc = `${MEDIA_BASE}/media/athletes/tennis/${genderPath}/profile/${p.slug}.png`
              const age = calcAge(p.birth_date, ageRefDate, p.death_date)
              const birth = fmtBirth(p.birth_date)
              return (
                <tr key={p.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos}><span className="event-rank">{globalRank}</span></td>
                  <td>
                    <div className="entity-cell">
                      <img className="avatar" src={imgSrc} alt={p.canonical_name} onError={e => { e.target.style.display = 'none' }} />
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
                  <td style={td('center')}>
                    {age != null ? (
                      <div className="stat-stack">
                        <span className="stat-stack-value-light">
                          {age}
                          {showDeceasedMark(p.death_date, data.year) && <DeceasedMark />}
                        </span>
                        <span className="cell-meta">{birth}</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td style={td('center')}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{p.season_count || '–'}</span>
                      {p.debut_year && <span className="cell-meta">{p.debut_year}-{p.last_season_year || data.year}</span>}
                    </div>
                  </td>
                  <td className={sorted('gs')} style={td('center')}>
                    <PlayedWinsCell played={p.played_gs} wins={p.wins_gs} />
                  </td>
                  <td className={sorted('m1000')} style={td('center')}>
                    <PlayedWinsCell played={p.played_m1000} wins={p.wins_m1000} />
                  </td>
                  <td className={sorted('finals')} style={td('center')}>
                    <PlayedWinsCell played={p.finals_all} wins={p.wins_all} />
                  </td>
                  <td className={sorted('played')} style={td('center')}>
                    <PlayedWinsCell played={p.played_all} wins={p.wins_all} />
                  </td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No player data available.</div>
}
