// templates/tennis/TennisTournamentStatsTemplate.jsx
// Totals > Tournament Stats — one row per ATP/WTA tournament, cumulative
// "through <year>" across every category belonging to the tour. Same
// shape as F1's Races Stats (F1RacesAllTimeTemplate.jsx): 1st Edition/
// Editions instead of 1st GP/Nb of races, and a single Wins/Runner-up
// Finishes record-holder pair (the singles draw's Final winner/loser)
// instead of F1's three Wins/Poles/Sprint-Wins columns — tennis has no
// pole/sprint equivalent. Unlike F1's record cells (name + count only),
// Wins/Runner-up here also show the player's own flag, per spec.
//
// Backed by /competitions/totals/:tour/:year — see that route's comment
// for the "as of viewed year" counting rule (only actually-held editions,
// status past/ongoing, year <= selected year).
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import DeceasedMark from '../../shared/DeceasedMark'
import TournamentHistoryDrawer from '../../shared/TournamentHistoryDrawer'
import SearchableSelect from '../../shared/SearchableSelect'
import { CONTINENTS, continentForIso2 } from '../../../utils/countryContinent'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import styles from '../f1/f1.module.css'

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

const SORT_OPTIONS = [
  { key: 'editions',  label: 'Editions' },
  { key: 'runner_up', label: 'Runner-up' },
  { key: 'wins',      label: 'Wins' },
]

function statValue(t, key) {
  if (key === 'editions')  return t.edition_count
  if (key === 'wins')      return t.wins?.count || 0
  if (key === 'runner_up') return t.runner_up?.count || 0
  return 0
}

function getName(t) { return (t.name || '').toLowerCase() }

// Default-view category priority (Mohamed 2026-08-10) — deliberately NOT
// the DB's own event_categories.display_order (which puts ATP/WTA Finals
// last, after the 500/250 tiers): this page's default groups by tier
// importance instead, tour-agnostic since both sides share the same
// ranks (Masters 1000 and WTA 1000 are both rank 1, etc). Anything not
// listed (e.g. "Various") sorts after every named tier.
const CATEGORY_RANK = {
  'Grand Slam': 0,
  'Masters 1000': 1, 'WTA 1000': 1,
  'ATP Finals': 2, 'WTA Finals': 2,
  'Masters 500': 3, 'WTA 500': 3,
  'Masters 250': 4, 'WTA 250': 4,
  'Challenger': 5, 'WTA 125': 5,
}
function categoryRank(t) { return CATEGORY_RANK[t.category] ?? 99 }

const PAGE_SIZE = 25

// Same reasoning as F1RacesAllTimeTemplate's identical helper — the cross
// only makes sense once "through <year>" is past the death itself.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

function RecordCell({ record, highlightPlayer, year }) {
  if (!record) return <span className="cell-meta">—</span>
  const isHighlighted = highlightPlayer && record.name === highlightPlayer
  return (
    <span className={styles.recordInline}>
      <Flag iso2={record.iso2} name={record.country} className="flag" />
      <span className={isHighlighted ? styles.nameHighlight : ''}>
        {record.name}
        {showDeceasedMark(record.death_date, year) && <DeceasedMark />}
      </span>
      <span className="cell-meta">{record.count}</span>
    </span>
  )
}

// Every distinct player appearing as the record-holder in either column
// (Wins/Runner-up), across the full unfiltered dataset — same convention
// as F1RacesAllTimeTemplate's drivers dropdown.
function tournamentMatchesPlayer(t, playerName) {
  return t.wins?.name === playerName || t.runner_up?.name === playerName
}

export default function TennisTournamentStatsTemplate({ tour, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [countryFilter, setCountryFilter]   = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [surfaceFilter, setSurfaceFilter]   = useState('')
  const [areaFilter, setAreaFilter]         = useState('')
  const [playerFilter, setPlayerFilter]   = useState('')
  const [sortStat, setSortStat]           = useState('')
  const [page, setPage]                   = useState(1)
  // Same key format TournamentHistoryDrawer builds internally
  // (`tournament-history:${competitionId}:${tour}:${year}`) — clicking
  // the tournament name opens the exact same drawer instance the row
  // mounts (hidden trigger) below.
  const openVideo = useVideoPlayerStore(s => s.openVideo)

  useEffect(() => {
    if (!tour || !year) return
    setLoading(true)
    api.getTennisTotals(tour, year)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [tour, year])

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — fully
  // formatted, year suffix already applied server-side. Fetched here (not
  // by the parent) so it lives and dies with this page's own data fetch,
  // same self-contained pattern this component already uses for its own
  // table data above.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('tennis', null, 'Totals', 'Tournament Stats', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => { setSearch(''); setCountryFilter(''); setCategoryFilter(''); setSurfaceFilter(''); setAreaFilter(''); setPlayerFilter(''); setSortStat(''); setPage(1) }, [tour, year])
  useEffect(() => { setPage(1) }, [search, countryFilter, categoryFilter, surfaceFilter, areaFilter, playerFilter, sortStat])

  if (loading) return <Skeleton />
  if (!data?.tournaments?.length) return <Empty />

  // "All Countries" refers to the Wins/Runner-up record-holders' own
  // countries — same convention as Home ATP/WTA's "All Countries" (winner/
  // runner-up), not the tournament's host country (still shown as the flag
  // next to the tournament name, just no longer what this filter matches).
  const countries = [...new Map(
    data.tournaments.flatMap(t => [
      t.wins?.iso2 ? [t.wins.iso2, t.wins.country || t.wins.iso2] : null,
      t.runner_up?.iso2 ? [t.runner_up.iso2, t.runner_up.country || t.runner_up.iso2] : null,
    ].filter(Boolean))
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  // Category/Surface/Area counts each reflect the OTHER two active facet
  // filters, never their own current selection — same OTHER-facets-only
  // convention (and same scope: player/country/search stay out of it) the
  // Schedule page's surfaceOptions/categoryOptions/areaOptions use (Mohamed
  // 2026-08-19: "Totals -> tournaments stat. All Surfaces, All Categories,
  // All Areas: use the same concatenate count as for Schedule page").
  const matchesCategoryFacet = t => !categoryFilter || t.category === categoryFilter
  const matchesSurfaceFacet  = t => !surfaceFilter || t.surface === surfaceFilter
  const matchesAreaFacet     = t => !areaFilter || continentForIso2(t.country_iso2) === areaFilter

  const tournamentsForCategoryOptions = data.tournaments.filter(t => matchesSurfaceFacet(t) && matchesAreaFacet(t))
  const tournamentsForSurfaceOptions  = data.tournaments.filter(t => matchesCategoryFacet(t) && matchesAreaFacet(t))
  const tournamentsForAreaOptions     = data.tournaments.filter(t => matchesCategoryFacet(t) && matchesSurfaceFacet(t))

  const categoryCounts = new Map()
  tournamentsForCategoryOptions.forEach(t => { if (t.category) categoryCounts.set(t.category, (categoryCounts.get(t.category) || 0) + 1) })
  const categories = [...new Map(
    data.tournaments.filter(t => t.category).map(t => [t.category, t.category_display_order])
  ).entries()].sort((a, b) => a[1] - b[1]).map(([name]) => [name, categoryCounts.get(name) || 0])

  const surfaceCounts = new Map()
  tournamentsForSurfaceOptions.forEach(t => { if (t.surface) surfaceCounts.set(t.surface, (surfaceCounts.get(t.surface) || 0) + 1) })
  const surfaces = [...new Set(data.tournaments.map(t => t.surface).filter(Boolean))].sort()
    .map(name => [name, surfaceCounts.get(name) || 0])

  const areaCounts = new Map()
  tournamentsForAreaOptions.forEach(t => {
    const continent = continentForIso2(t.country_iso2)
    if (continent) areaCounts.set(continent, (areaCounts.get(continent) || 0) + 1)
  })
  // Fixed list (see CONTINENTS' own comment) — every continent shown
  // regardless of count, including (0), not just the ones present.
  const areas = CONTINENTS.map(name => [name, areaCounts.get(name) || 0])

  const players = [...new Set(data.tournaments.flatMap(t => [
    t.wins?.name,
    t.runner_up?.name,
  ].filter(Boolean)))]
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ value: name, label: name }))

  let rows = data.tournaments.filter(t => {
    if (search && !t.name?.toLowerCase().includes(search.toLowerCase())) return false
    if (countryFilter && t.wins?.iso2 !== countryFilter && t.runner_up?.iso2 !== countryFilter) return false
    if (categoryFilter && t.category !== categoryFilter) return false
    if (surfaceFilter && t.surface !== surfaceFilter) return false
    if (areaFilter && continentForIso2(t.country_iso2) !== areaFilter) return false
    if (playerFilter && !tournamentMatchesPlayer(t, playerFilter)) return false
    return true
  })

  if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const d = statValue(b, sortStat) - statValue(a, sortStat)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    // Default: category tier (Grand Slam -> Masters 1000 -> Finals ->
    // 500 -> 250 -> Challenger), then Most Wins descending within each
    // tier (not alphabetical — Mohamed 2026-08-10 correction).
    rows = [...rows].sort((a, b) => {
      const byCategory = categoryRank(a) - categoryRank(b)
      if (byCategory !== 0) return byCategory
      return (b.wins?.count || 0) - (a.wins?.count || 0)
    })
  }

  const hasActiveFilter = search || countryFilter || categoryFilter || surfaceFilter || areaFilter || playerFilter || sortStat
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search Tournament" value={search} onChange={e => setSearch(e.target.value)} />
        <SearchableSelect
          value={playerFilter}
          onChange={setPlayerFilter}
          options={players}
          allLabel="All Players"
        />
        <SearchableSelect
          value={countryFilter}
          onChange={setCountryFilter}
          options={countries.map(([iso2, name]) => ({ value: iso2, label: name }))}
          allLabel="All Countries"
        />
        <select className="filter-label" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
        </select>
        <select className="filter-label" value={surfaceFilter} onChange={e => setSurfaceFilter(e.target.value)}>
          <option value="">All Surfaces</option>
          {surfaces.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
        </select>
        <select className="filter-label" value={areaFilter} onChange={e => setAreaFilter(e.target.value)}>
          <option value="">All Areas</option>
          {areas.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setCountryFilter(''); setCategoryFilter(''); setSurfaceFilter(''); setAreaFilter(''); setPlayerFilter(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} tournaments</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.pos}></th>
              <th className="table-label" style={th('left')}>Tournament</th>
              <th className="table-label" style={th('left')}>Category</th>
              <th className="table-label" style={th('center')}>Surface</th>
              <th className={`table-label ${sorted('first_year')}`} style={th('center')}>1st Edition</th>
              <th className={`table-label ${sorted('editions')}`} style={th('center')}>Editions</th>
              <th className={`table-label ${sorted('wins')}`} style={th('left')}>Most Wins</th>
              <th className={`table-label ${sorted('runner_up')}`} style={th('left')}>Most Runner-up Finishes</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((t, i) => {
              const globalRank = pageStart + i + 1
              return (
                <tr key={t.competition_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos}><span className="event-rank">{globalRank}</span></td>
                  <td>
                    <div className={styles.gpCell}>
                      <Flag iso2={t.country_iso2} name={t.country_name} className={styles.gpFlag} />
                      <strong>
                        <button
                          type="button"
                          className={styles.nameLink}
                          onClick={() => openVideo(`tournament-history:${t.competition_id}:${tour}:${year}`)}
                        >
                          {t.name}
                        </button>
                      </strong>
                      <TournamentHistoryDrawer competitionId={t.competition_id} tour={tour} year={year} competitionName={t.name} hideTrigger />
                    </div>
                  </td>
                  <td className="stats-light" style={td('left')}>{t.category}</td>
                  <td className="stats-light" style={td('center')}>{t.surface || '—'}</td>
                  <td className="stats-light" style={td('center')}>{t.first_year}</td>
                  <td className={`stats-light ${sorted('editions')}`} style={td('center')}>{t.edition_count}</td>
                  <td className={sorted('wins')} style={td('left')}><RecordCell record={t.wins} highlightPlayer={playerFilter} year={data.year} /></td>
                  <td className={sorted('runner_up')} style={td('left')}><RecordCell record={t.runner_up} highlightPlayer={playerFilter} year={data.year} /></td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No tournament data available.</div>
}
