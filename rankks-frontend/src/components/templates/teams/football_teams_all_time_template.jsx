// templates/teams/football_teams_all_time_template.jsx
// Football All-Time > Team Stats — cumulative "through <year>" totals for
// every club that has ever appeared in this competition's standings.
// Backed by /results/teams-all-time/:seasonId (see that route's comment
// for the standings-table-based, non-UCL-Clubs-route approach).
//
// Cup/League Cup/Champions Trophy have no ingested data yet — shown as a
// permanent "—/—" placeholder (both the count and its Fin./Tit. subline),
// same convention as EventBlock.jsx's club stat bloc. Sortable anyway
// (currently a no-op tie since every club is 0) so the column already
// behaves correctly once that data exists — no future code change needed,
// just real numbers flowing through the same route.
import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import styles from './football_teams_all_time_template.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return null
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

function getName(t) { return (t.canonical_name || '').toLowerCase() }

const SORT_GROUPS = [
  {
    label: 'Trophies',
    options: [
      { key: 'titles',             label: 'Champion' },
      { key: 'cup',                label: 'Cup' },
      { key: 'league_cup',         label: 'League Cup' },
      { key: 'champions_trophy',   label: 'Champions Trophy' },
      { key: 'seasons',            label: 'Seasons' },
    ],
  },
  {
    label: 'Record',
    options: [
      { key: 'played',       label: 'Played' },
      { key: 'won',          label: 'Won' },
      { key: 'drawn',        label: 'Drawn' },
      { key: 'lost',         label: 'Lost' },
      { key: 'goals_for',    label: 'GF' },
      { key: 'goals_against', label: 'GA' },
    ],
  },
  {
    label: 'Awards',
    options: [
      { key: 'top_scorer_titles', label: 'Top Scorer' },
      { key: 'top_assist_titles', label: 'Assist Leader' },
    ],
  },
]

export default function FootballTeamsAllTimeTemplate({ seasonId, competitionSlug }) {
  const { activeYear } = useAppStore()
  const [data, setData]       = useState(null)

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !activeYear) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Teams', activeYear)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [competitionSlug, activeYear])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [sortStat, setSortStat] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getFootballTeamsAllTime(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setSortStat('') }, [seasonId])

  if (loading) return <Skeleton />
  if (!data?.teams?.length) return <Empty />

  let rows = data.teams.filter(t =>
    !search || t.canonical_name?.toLowerCase().includes(search.toLowerCase())
  )

  // Cup/League Cup/Champions Trophy have no real data yet — every club is
  // 0, so selecting them just falls back to name order for now.
  if (sortStat === 'cup' || sortStat === 'league_cup' || sortStat === 'champions_trophy') {
    rows = [...rows].sort((a, b) => getName(a).localeCompare(getName(b)))
  } else if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const d = (Number(b[sortStat]) || 0) - (Number(a[sortStat]) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    // Default order: Champions, then Seasons, then Cup, then League Cup
    // (Mohamed's explicit rule) — Cup/League Cup are always 0 today, so
    // this currently resolves at the Seasons tiebreak, ready for real
    // Cup data without any further code change.
    rows = [...rows].sort((a, b) => {
      const byTitles = (b.titles || 0) - (a.titles || 0)
      if (byTitles !== 0) return byTitles
      const bySeasons = (b.seasons || 0) - (a.seasons || 0)
      if (bySeasons !== 0) return bySeasons
      const byCup = (b.cup || 0) - (a.cup || 0)
      if (byCup !== 0) return byCup
      const byLeagueCup = (b.league_cup || 0) - (a.league_cup || 0)
      if (byLeagueCup !== 0) return byLeagueCup
      return getName(a).localeCompare(getName(b))
    })
  }

  const hasActiveFilter = search || sortStat
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search team" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_GROUPS.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} teams</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.pos}></th>
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Team</th>
              <th className={`table-label ${sorted('seasons')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>Seasons</th>
              <th className={`table-label ${sorted('titles')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>Champion</th>
              <th className={`table-label ${sorted('cup')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>
                <div className="stat-stack"><span>Cup</span><span className="cell-meta">Fin./Tit.</span></div>
              </th>
              <th className={`table-label ${sorted('league_cup')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>
                <div className="stat-stack"><span>League Cup</span><span className="cell-meta">Fin./Tit.</span></div>
              </th>
              <th className={`table-label ${sorted('champions_trophy')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>
                <div className="stat-stack"><span>Champions Trophy</span><span className="cell-meta">Fin./Tit.</span></div>
              </th>
              <th className={`table-label ${sorted('played')} ${sorted('won')} ${sorted('drawn')} ${sorted('lost')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>
                <div className="stat-stack"><span>Played</span><span className="cell-meta">W/D/L</span></div>
              </th>
              <th className={`table-label ${sorted('goals_for')} ${sorted('goals_against')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>GF/GA</th>
              <th className={`table-label ${sorted('top_scorer_titles')} ${sorted('top_assist_titles')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>Top Scor./Ass. Lead.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const logo = resolveImg(t.logo_url)
              return (
                <tr key={t.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos}><span className="event-rank">{i + 1}</span></td>
                  <td style={{ textAlign: 'left' }}>
                    <div className={styles.team}>
                      <div className={styles.logoSlot}>
                        {logo && <img src={logo} alt={t.canonical_name} className={styles.logo} onError={e => { e.target.style.display = 'none' }} />}
                      </div>
                      <span className="club-name">{t.canonical_name}</span>
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('seasons')}`} style={{ textAlign: 'center' }}>{t.seasons}</td>
                  <td className={`stats-strong ${sorted('titles')}`} style={{ textAlign: 'center' }}>{t.titles}</td>
                  <td className={sorted('cup')} style={{ textAlign: 'center' }}>
                    <div className="stat-stack"><span className="stat-stack-value">—</span><span className="cell-meta">—</span></div>
                  </td>
                  <td className={sorted('league_cup')} style={{ textAlign: 'center' }}>
                    <div className="stat-stack"><span className="stat-stack-value">—</span><span className="cell-meta">—</span></div>
                  </td>
                  <td className={sorted('champions_trophy')} style={{ textAlign: 'center' }}>
                    <div className="stat-stack"><span className="stat-stack-value">—</span><span className="cell-meta">—</span></div>
                  </td>
                  <td className={`${sorted('played')} ${sorted('won')} ${sorted('drawn')} ${sorted('lost')}`} style={{ textAlign: 'center' }}>
                    <div className="stat-stack">
                      <span className="stat-stack-value">{t.played}</span>
                      <span className="cell-meta">{t.won}/{t.drawn}/{t.lost}</span>
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('goals_for')} ${sorted('goals_against')}`} style={{ textAlign: 'center' }}>{t.goals_for}/{t.goals_against}</td>
                  <td className={`stats-light ${sorted('top_scorer_titles')} ${sorted('top_assist_titles')}`} style={{ textAlign: 'center' }}>{t.top_scorer_titles}|{t.top_assist_titles}</td>
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
  return <div style={{ padding: 16 }}>{[...Array(8)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No team data available.</div>
}
