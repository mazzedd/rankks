// templates/f1/F1DriversTemplate.jsx
// Columns: Pos | Driver | Age | Seasons | Team | Wins | Podiums | Poles |
// Sprint | Fast. Lap | Points
//
// Matrix matched exactly to the tennis Player-list table:
//   - Driver cell: avatar image, then a stacked name (bold, with the car
//     number as a muted " - N" suffix — same convention as
//     players_template.jsx's NBA position suffix after the player name)
//     with a flag + country line underneath — not side-by-side. The
//     car number used to be its own "No" column between Age and Team;
//     moved inline since it's an identity detail of the driver (like a
//     jersey number), not a standings stat.
//   - Age: centered, age number (normal weight — see BOLD RULE below)
//     with birthdate underneath.
//   - Seasons: centered, same stat-stack shape as Age — count of distinct
//     F1 seasons raced through this year on top (not a first-last
//     year-span calculation, which would wrongly count a driver's
//     career-gap years, e.g. a sabbatical/comeback, as "active"), the
//     real first-last season range ("2010-2020") still shown beneath.
//   - Wins / Podiums / Poles / Sprint: centered.
//   - Team: left, plain name (normal weight) + "Engine: X" beneath — no
//     team logo (the avatar/flag column already carries the driver's own
//     visual ID; a second logo per row was redundant clutter).
//   - Podiums: 2-line stack — total (wins+p2+p3) on top, "W/2nd/3rd"
//     breakdown beneath (same "0 rule" as the rest of the table: always
//     rendered, even at 0).
//   - Points: right (matches tennis's rightmost column).
//   - Every header label is explicitly bold.
//
// BOLD RULE — only Driver name, Podiums (the total), and Points are
// actually bold/strong; every other value (Age, Seasons, Team name,
// Wins, Poles, Sprint, Fast. Lap) is normal weight, even though some
// reuse shared classes (.stat-stack-value, .club-name) that default to
// bold elsewhere — those cells explicitly opt out via
// .stat-stack-value-light or an inline fontWeight override rather than
// changing the shared classes themselves (which other sports' tables
// still rely on being bold).
//
// COLUMN WIDTHS — table-layout: fixed (.fixedTable) with an explicit
// width % on every <th>, summing to 100%. Auto-layout (the default) only
// works predictably when every column is left unwidthed; forcing even
// one column narrower (tried it — Driver/Age via nth-child width:1%)
// makes the browser dump ALL the recovered space into some other
// column instead of spreading it, moving the gap rather than fixing it.
// Fixed layout + explicit percentages is the only deterministic option.
//
// AGE — now uses the shared calcAge(birthDate, refDate) util (unified
// rule across football/tennis/F1: age is computed as of the event date,
// not today's date). Since this table is season-level, refDate is
// data.season_end_date — the last race of the season, returned by the
// backend as MAX(event_date) across this season's GPs (F1 has no single
// season.end_date column, so this is computed rather than stored).
//
// CSS — now imports the shared templates/f1/f1.module.css (was its own
// module CSS, byte-identical to the other 5 F1 templates). The
// avatar+name+flag/country cell and the age value+birthdate stack now
// use the global .entity-cell/.entity-stack/.entity-meta-row/.cell-meta
// and .stat-stack/.stat-stack-value/.cell-meta classes from index.css,
// replacing inline style={{...}} that repeated identical color/size
// values across every F1 template.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import styles from './f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })
const td = (align) => ({ textAlign: align })

export default function F1DriversTemplate({ seasonId, year }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [engineFilter, setEngineFilter] = useState('')
  const [sortStat, setSortStat] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getF1Standings(seasonId, 'drivers')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('car-racing', 'formula-1-world-championship', 'Standings', 'Drivers', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  if (loading) return <Skeleton />
  if (!data?.standings?.length) return <Empty />

  const teams = [...new Set(data.standings.map(r => r.stats?.team_name_raw).filter(Boolean))].sort()
  const engines = [...new Set(data.standings.map(r => r.stats?.engine_name).filter(Boolean))].sort()

  let rows = data.standings.filter(r => {
    if (search && !r.canonical_name?.toLowerCase().includes(search.toLowerCase())) return false
    if (teamFilter && r.stats?.team_name_raw !== teamFilter) return false
    if (engineFilter && r.stats?.engine_name !== engineFilter) return false
    return true
  })

  // "Sort by" dropdown — default ('') keeps the API's own finishing-position
  // order. Every option is a numeric stat, always descending (best first).
  // Engine is a filter (above), not a sort option — sorting by an entire
  // engine's driver roster in ranking order doesn't need a "descending" rule.
  if (sortStat === 'podiums') {
    const podiums = r => (r.stats?.wins ?? 0) + (r.stats?.p2 ?? 0) + (r.stats?.p3 ?? 0)
    rows = [...rows].sort((a, b) => podiums(b) - podiums(a))
  } else if (sortStat) {
    rows = [...rows].sort((a, b) => (Number(b.stats?.[sortStat]) || 0) - (Number(a.stats?.[sortStat]) || 0))
  }

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search driver" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <option value="">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={engineFilter} onChange={e => setEngineFilter(e.target.value)}>
          <option value="">All Engines</option>
          {engines.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          <option value="wins">Wins</option>
          <option value="podiums">Podiums</option>
          <option value="poles">Poles</option>
          <option value="sprint_wins">Sprint</option>
          <option value="fastest_laps">Fast. Lap</option>
        </select>
        {(search || teamFilter || engineFilter || sortStat) && (
          <button className="filter-reset" onClick={() => { setSearch(''); setTeamFilter(''); setEngineFilter(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} drivers</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} ${styles.fixedTable} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos} style={{ width: '5%' }}></th>
            <th className="table-label" style={{ ...th('left'), width: '19%' }}>Driver</th>
            <th className="table-label" style={{ ...th('center'), width: '8%' }}>Age</th>
            <th className="table-label" style={{ ...th('center'), width: '9%' }}>Seasons</th>
            <th className="table-label" style={{ ...th('left'), width: '14%' }}>Team</th>
            <th className={`table-label ${sortStat === 'wins' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '6%' }}>Wins</th>
            <th className={`table-label ${sortStat === 'podiums' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '10%' }}>
              <div className="stat-stack">
                <span>Podiums</span>
                <span className="cell-meta">1st/2nd/3rd</span>
              </div>
            </th>
            <th className={`table-label ${sortStat === 'poles' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '6%' }}>Poles</th>
            <th className={`table-label ${sortStat === 'sprint_wins' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '7%' }}>Sprint</th>
            <th className={`table-label ${sortStat === 'fastest_laps' ? 'sortRowsHighlight' : ''}`} style={{ ...th('center'), width: '9%' }}>Fast. Lap</th>
            <th className="table-label" style={{ ...th('right'), width: '7%' }}>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const img = resolveImg(row.logo_url)
            const age = calcAge(row.birth_date, data.season_end_date, row.death_date)
            const birth = fmtBirth(row.birth_date)
            return (
              <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}><span className="event-rank">{row.position}</span></td>
                <td>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={row.canonical_name} sport="f1" gender="M" className="avatar" fallback="letter" />
                    <div className="entity-stack">
                      <span className="club-name" style={{ whiteSpace: 'nowrap' }}>
                        {row.canonical_name}
                        {row.stats?.number != null && <span className="athletePosition"> - {row.stats.number}</span>}
                      </span>
                      <div className="entity-meta-row">
                        <Flag iso2={row.country_iso2} name={row.country_name} className="flag" />
                        <span className="cell-meta">{row.country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={td('center')}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{age}</span>
                      <span className="cell-meta">{birth}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={td('center')}>
                  {row.stats?.seasons_count != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{row.stats.seasons_count}</span>
                      <span className="cell-meta">
                        {row.stats.active_from === row.stats.active_to ? `${row.stats.active_from}` : `${row.stats.active_from}-${row.stats.active_to}`}
                      </span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={td('left')}>
                  {row.stats?.team_name_raw ? (
                    <div className="entity-stack">
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{row.stats.team_name_raw}</span>
                      {row.stats.engine_name && (
                        <span className="cell-meta">{row.stats.engine_name}</span>
                      )}
                    </div>
                  ) : '—'}
                </td>
                <td className={`stats-light ${sortStat === 'wins' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.wins ?? 0}</td>
                <td className={`stats-light ${sortStat === 'podiums' ? 'sortRowsHighlight' : ''}`} style={td('center')}>
                  <div className="stat-stack">
                    <span className="stat-stack-value">{(row.stats?.wins ?? 0) + (row.stats?.p2 ?? 0) + (row.stats?.p3 ?? 0)}</span>
                    <span className="cell-meta">{row.stats?.wins ?? 0}/{row.stats?.p2 ?? 0}/{row.stats?.p3 ?? 0}</span>
                  </div>
                </td>
                <td className={`stats-light ${sortStat === 'poles' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.poles ?? 0}</td>
                <td className={`stats-light ${sortStat === 'sprint_wins' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.sprint_wins ?? 0}</td>
                <td className={`stats-light ${sortStat === 'fastest_laps' ? 'sortRowsHighlight' : ''}`} style={td('center')}>{row.stats?.fastest_laps ?? 0}</td>
                <td className="stats-strong" style={td('right')}>{row.stats?.points ?? 0}</td>
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
  return <div style={{ padding: 16 }}>{[...Array(5)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No driver data available.</div>
}
