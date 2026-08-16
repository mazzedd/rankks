// templates/motogp/MotoGPConstructorsAllTimeTemplate.jsx
// All-Time > Constructors — career cumulative stats "through <year>",
// lean (no logo/country, no entity link — text-only source). Backed by
// /motogp/constructors-all-time/:seasonId. The season-level standings
// equivalent (MotoGPConstructorsTemplate.jsx + /standings/:seasonId/
// constructors) was removed per explicit instruction — this All-Time
// view is the only place Constructor stats still live.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import styles from '../f1/f1.module.css'

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

// Sprint format didn't exist before 2023 — the 'Sprint' entry is filtered
// out below when the selected year is 2022 or earlier, same cutoff as
// MotoGPRacesAllTimeTemplate.jsx's showSprintCol.
const SORT_OPTIONS = [
  { key: 'championships', label: 'Championships' },
  { key: 'podiums',       label: 'Podiums' },
  { key: 'points',        label: 'Points' },
  { key: 'poles',         label: 'Poles' },
  { key: 'seasons',       label: 'Seasons' },
  { key: 'sprint_wins',   label: 'Sprint' },
]

function getName(c) { return (c.constructor_name || '').toLowerCase() }

const PAGE_SIZE = 25

export default function MotoGPConstructorsAllTimeTemplate({ seasonId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [sortStat, setSortStat] = useState('')
  const [page, setPage]         = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getMotoGPConstructorsAllTime(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  // Admin-configured subtitle line — see MotoGPRidersAllTimeTemplate.jsx's
  // identical block for the full rationale.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!data?.year) return
    api.getSubtitle('car-racing', 'motogp', 'Totals', 'Team Stats', data.year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [data?.year])

  useEffect(() => { setSearch(''); setSortStat(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, sortStat])

  if (loading) return <Skeleton />
  if (!data?.constructors?.length) return <Empty />

  const showSprintCol = data.year > 2022
  const sortOptions = showSprintCol ? SORT_OPTIONS : SORT_OPTIONS.filter(o => o.key !== 'sprint_wins')

  let rows = data.constructors.filter(c => {
    if (search && !c.constructor_name?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  if (sortStat === 'podiums') {
    rows = [...rows].sort((a, b) => {
      const podiums = x => (x.stats?.wins || 0) + (x.stats?.p2 || 0) + (x.stats?.p3 || 0)
      const d = podiums(b) - podiums(a)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const d = (Number(b.stats?.[sortStat]) || 0) - (Number(a.stats?.[sortStat]) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    rows = [...rows].sort((a, b) => {
      const byChamps = (b.stats?.championships || 0) - (a.stats?.championships || 0)
      if (byChamps !== 0) return byChamps
      const byPoints = (Number(b.stats?.points) || 0) - (Number(a.stats?.points) || 0)
      if (byPoints !== 0) return byPoints
      return getName(a).localeCompare(getName(b))
    })
  }

  const hasActiveFilter = search || sortStat
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  const totalPages = Math.ceil(rows.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = rows.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="search Constructor" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {sortOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} constructors</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.pos}></th>
              <th className="table-label" style={th('left')}>Constructor</th>
              <th className={`table-label ${sorted('championships')}`} style={th('center')}>Seas. I Champ.</th>
              <th className={`table-label ${sorted('podiums')}`} style={th('center')}>
                <div className="stat-stack">
                  <span>Podiums</span>
                  <span className="cell-meta">1st I 2nd I 3rd</span>
                </div>
              </th>
              {showSprintCol && <th className={`table-label ${sorted('sprint_wins')}`} style={th('center')}>Sprint</th>}
              <th className={`table-label ${sorted('poles')}`} style={th('center')}>Poles</th>
              <th className={`table-label ${sorted('points')}`} style={th('right')}>Pts</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((c, i) => {
              const globalRank = pageStart + i + 1
              return (
                <tr key={c.constructor_name} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos}><span className="event-rank">{globalRank}</span></td>
                  <td><span className="club-name">{c.constructor_name}</span></td>
                  <td className={sorted('championships')} style={td('center')}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{c.stats.seasons} I <strong>{c.stats.championships}</strong></span>
                      {c.first_season_year && <span className="cell-meta">{c.first_season_year}-{c.last_season_year || data.year}</span>}
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('podiums')}`} style={td('center')}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{c.stats.wins + c.stats.p2 + c.stats.p3}</span>
                      <span className="cell-meta">{c.stats.wins} I {c.stats.p2} I {c.stats.p3}</span>
                    </div>
                  </td>
                  {showSprintCol && <td className={`stats-light ${sorted('sprint_wins')}`} style={td('center')}>{c.stats.sprint_wins}</td>}
                  <td className={`stats-light ${sorted('poles')}`} style={td('center')}>{c.stats.poles}</td>
                  <td className={`stats-light ${sorted('points')}`} style={td('right')}><strong>{c.stats.points ?? 0}</strong></td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No constructor data available.</div>
}
