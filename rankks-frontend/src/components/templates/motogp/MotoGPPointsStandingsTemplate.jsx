// templates/motogp/MotoGPPointsStandingsTemplate.jsx
// Columns: Pos | Rider (flag + country) | one column per round this
// season (3-letter code, chronological) | Total
// Backed by /motogp/standings/:seasonId/points-by-race — every round on
// the shared calendar is a column, including any this category skipped
// or hasn't raced yet (shows 0, never omitted). Default order is the
// API's own championship-position order (standings leaders first) — the
// "Sort by" dropdown lets a specific round's column be sorted instead,
// same sortRowsHighlight convention every other standings table uses.
// Same shape as F1PointsStandingsTemplate.jsx.
//
// Race/Sprint split — each round's cell shows Race points on its own
// line, plus a small second line for Sprint points, only on rounds that
// actually have a sprint (round.has_sprint) — MotoGP has run a sprint at
// nearly every round since 2023, so most cells here ARE 2-line, unlike F1.
//
// Slide arrows — the table can run to 20+ race columns, wider than the
// viewport. Rather than make the user hunt for the native scrollbar at
// the very bottom of a long rider list, two arrow buttons sit in the
// filter bar (same level as everything else, always visible) and scroll
// the table horizontally.
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import { shortGpLabel } from '../../../utils/gpLabel'
import styles from '../f1/f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

// 3-letter column-header code, derived from the cleaned place name
// (shortGpLabel), not the raw stored name — MotoGP's raw names are
// "GRAND PRIX OF X" (prefix-first), so truncating them directly always
// landed on "GRA" for every round.
function raceCode(name) {
  return shortGpLabel(name).slice(0, 3).toUpperCase()
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

// Rank column is 48px (styles.pos) — Rider column sticks right after it.
const STICKY_BG = 'var(--content-bg)'
const stickyPos = { position: 'sticky', left: 0, zIndex: 2, background: STICKY_BG, width: 48 }
const stickyDriver = { position: 'sticky', left: 48, zIndex: 2, background: STICKY_BG, width: 220 }

const PODIUM_PILLS = [{ pos: '1', label: '1st' }, { pos: '2', label: '2nd' }, { pos: '3', label: '3rd' }]

export default function MotoGPPointsStandingsTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [sortGpId, setSortGpId] = useState('')
  // Podium pills — highlight every cell where that rider finished in that
  // exact position in the REGULAR RACE that round (never Sprint).
  // Multi-select: more than one pill can be active at once.
  const [activePodium, setActivePodium] = useState(() => new Set())
  const togglePodium = (pos) => setActivePodium(prev => {
    const next = new Set(prev)
    next.has(pos) ? next.delete(pos) : next.add(pos)
    return next
  })
  const scrollRef = useRef(null)
  const scrollTable = (dir) => scrollRef.current?.scrollBy({ left: dir * 240, behavior: 'smooth' })

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getMotoGPStandings(seasonId, 'points-by-race')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'motogp', 'Standings', 'Points Standings', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  if (loading) return <Skeleton />
  if (!data?.standings?.length) return <Empty />

  const rounds = data.rounds || []

  let rows = data.standings.filter(r => !search || r.canonical_name?.toLowerCase().includes(search.toLowerCase()))

  if (sortGpId) {
    rows = [...rows].sort((a, b) => (b.points_by_gp?.[sortGpId]?.race || 0) - (a.points_by_gp?.[sortGpId]?.race || 0))
  }

  const hasActiveFilter = search || sortGpId || activePodium.size > 0

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search rider" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={sortGpId} onChange={e => setSortGpId(e.target.value)}>
          <option value="">Sort by: All Races</option>
          {rounds.map(r => <option key={r.gp_id} value={r.gp_id}>{shortGpLabel(r.name)}</option>)}
        </select>
        <div className={styles.statusToggle}>
          {PODIUM_PILLS.map(p => (
            <button
              key={p.pos}
              type="button"
              className={`${styles.statusBtn} ${activePodium.has(p.pos) ? styles.statusBtnActive : ''}`}
              onClick={() => togglePodium(p.pos)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setSortGpId(''); setActivePodium(new Set()) }}>
            Clear
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button type="button" className="filter-reset" onClick={() => scrollTable(-1)} aria-label="Scroll races left">‹</button>
          <button type="button" className="filter-reset" onClick={() => scrollTable(1)} aria-label="Scroll races right">›</button>
          <span className="filter-total" style={{ marginLeft: 0 }}>{rows.length} riders</span>
        </div>
      </div>

      <div className={styles.tableScroll} ref={scrollRef}>
        {/* border-collapse: separate (not the shared .table class's
            collapse) — collapsed borders bleed adjacent-column content
            through sticky cells in this exact scroll-under-sticky setup.
            table-layout: fixed — with the default auto layout, the
            browser resizes the Rank column based on content across ALL
            rows/columns, so its TRUE rendered width can drift away from
            the 48px stickyDriver's `left` offset assumes, opening a gap
            the scrolling columns show through. Fixed layout forces every
            column to honor its own explicit width exactly, so the two
            numbers always agree. Both scoped to just this table, not the
            shared class every other table on the site also uses. */}
        <table className={`${styles.table} table-thead-border`} style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th className={styles.pos} style={stickyPos}></th>
              <th className="table-label" style={{ ...th('left'), ...stickyDriver }}>Rider</th>
              {rounds.map(r => (
                <th
                  key={r.gp_id}
                  className={`table-label ${String(sortGpId) === String(r.gp_id) ? 'sortRowsHighlight' : ''}`}
                  style={{ ...th('center'), width: 56 }}
                >
                  {raceCode(r.name)}
                </th>
              ))}
              <th className="table-label" style={{ ...th('right'), width: 70 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const img = resolveImg(row.logo_url)
              return (
                <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos} style={stickyPos}><span className="event-rank">{row.position}</span></td>
                  <td style={stickyDriver}>
                    <div className="entity-cell">
                      <AthleteAvatar src={img} name={row.canonical_name} sport="motogp" gender="M" className="avatar" fallback="letter" />
                      <div className="entity-stack">
                        <span className="club-name" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{row.canonical_name}</span>
                        <div className="entity-meta-row">
                          <Flag iso2={row.country_iso2} name={row.country_name} className="flag" />
                          <span className="cell-meta">{row.country_name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  {rounds.map(r => {
                    const pts = row.points_by_gp?.[r.gp_id] || { race: 0, sprint: 0, race_position: null }
                    const isHighlighted = String(sortGpId) === String(r.gp_id) || activePodium.has(String(pts.race_position))
                    return (
                      <td
                        key={r.gp_id}
                        className={`stats-light ${isHighlighted ? 'sortRowsHighlight' : ''}`}
                        style={td('center')}
                      >
                        {r.has_sprint ? (
                          <div className="stat-stack">
                            <span className="stat-stack-value-light">{pts.race}</span>
                            <span className="cell-meta">{pts.sprint}</span>
                          </div>
                        ) : pts.race}
                      </td>
                    )
                  })}
                  <td className="stats-strong" style={td('right')}>{row.total_points}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(6)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No points data available.</div>
}
