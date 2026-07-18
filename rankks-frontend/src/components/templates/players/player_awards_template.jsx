import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import { getBasketballPageText } from '../../../utils/basketballSubtitles'
import styles from './players_template.module.css'

const PAGE_SIZE = 25
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

// "Sort by" — always descending, options listed A-Z (same convention as
// Team Honours). MVP + Finals MVP + DPOY (in that order) is the default
// sort when nothing is selected — see the fallback branch below.
const SORT_OPTIONS = [
  { key: 'mvp',        label: 'MVP' },
  { key: 'finals_mvp', label: 'Finals MVP' },
  { key: 'dpoy',       label: 'DPOY' },
  { key: 'smoy',       label: '6MOY' },
  { key: 'mip',        label: 'MIP' },
  { key: 'roy',        label: 'ROY' },
  { key: 'nba_cup_mvp', label: 'NBA Cup MVP' },
  { key: 'all_nba_1',  label: 'All-NBA 1st' },
  { key: 'all_def_1',  label: 'All-Defense 1st' },
].sort((a, b) => a.label.localeCompare(b.label))

function resolveImageUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  if (url.startsWith('media/')) return `/${url}`
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

function getName(p) { return (p.canonical_name || '').toLowerCase() }

// All-time cumulative individual awards per player — MVP/Finals MVP/DPOY/
// 6MOY/MIP/ROY/All-NBA 1st-2nd-3rd/All-Defense 1st-2nd, "through <year>".
// Same "current year's active roster" scope as the Player Stats tab
// (players_all_time_template.jsx) — every active player shows up, most
// with 0s, not just award winners (Mohamed's "Display all players" call).
// All-Star/MVP has no data source yet (see Team Honours) — "—" placeholder.
export default function PlayerAwardsTemplate({ seasonId, tabKey, activeEvent, isPast }) {
  const { activeYear } = useAppStore()
  const basketballPageText = getBasketballPageText(activeEvent, tabKey, activeYear, isPast)
  const [allPlayers, setAllPlayers] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [position, setPosition]     = useState('')
  const [club, setClub]             = useState('')
  const [country, setCountry]       = useState('')
  const [sortStat, setSortStat]     = useState('')
  const [page, setPage]             = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllPlayers([])
    api.getPlayerAwards(seasonId)
      .then(d => setAllPlayers(d?.players || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setPosition(''); setClub(''); setCountry(''); setSortStat(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, position, club, country, sortStat])

  let players = allPlayers.filter(p =>
    (!search || getName(p).includes(search.toLowerCase())) &&
    (!position || p.position === position) &&
    (!club || p.club_name === club) &&
    (!country || p.country_name === country)
  )

  const clubs     = [...new Set(allPlayers.map(p => p.club_name).filter(Boolean))].sort()
  const countries = [...new Set(allPlayers.map(p => p.country_name).filter(Boolean))].sort()

  if (sortStat) {
    players = [...players].sort((a, b) => {
      const d = (Number(b[sortStat]) || 0) - (Number(a[sortStat]) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    players = [...players].sort((a, b) => {
      const byMvp = (b.mvp || 0) - (a.mvp || 0)
      if (byMvp !== 0) return byMvp
      const byFinalsMvp = (b.finals_mvp || 0) - (a.finals_mvp || 0)
      if (byFinalsMvp !== 0) return byFinalsMvp
      const byDpoy = (b.dpoy || 0) - (a.dpoy || 0)
      if (byDpoy !== 0) return byDpoy
      return getName(a).localeCompare(getName(b))
    })
  }

  const totalPages = Math.ceil(players.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = players.slice(pageStart, pageStart + PAGE_SIZE)

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  const hasActiveFilter = search || position || club || country || sortStat
  const sorted = key => sortStat === key ? 'sorted-col' : ''

  return (
    <div className={styles.wrap}>

      {/* page-title — global */}
      <div className="page-title">Players</div>
      {basketballPageText && (
        <div className={styles.subtitle}>{basketballPageText.subtitle}</div>
      )}
      <PageNotice />

      {/* filter-bar — global */}
      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 160 }}
          placeholder="Search player..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-label" value={position} onChange={e => setPosition(e.target.value)}>
          <option value="">All Positions</option>
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="filter-label" value={club} onChange={e => setClub(e.target.value)}>
          <option value="">All Teams</option>
          {clubs.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-label" value={country} onChange={e => setCountry(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setPosition(''); setClub(''); setCountry(''); setSortStat('') }}>
            Clear
          </button>
        )}
        {/* filter-total — global */}
        <span className="filter-total">{players.length} players</span>
      </div>

      {players.length === 0 ? (
        <div className={`${styles.empty} empty-state`}>No players found.</div>
      ) : (
        <>
          <table className={`${styles.table} table-thead-border`}>
            <thead>
              <tr>
                <th className={styles.rank}></th>
                <th className={`${styles.playerH} table-label-left`}>Player</th>
                <th className={`${styles.pos} table-label`}>Pos</th>
                <th className={`table-label ${sorted('mvp')}`}>MVP</th>
                <th className={`table-label ${sorted('finals_mvp')}`}>Fin. MVP</th>
                <th className="table-label">All-Star / MVP</th>
                <th className={`table-label ${sorted('dpoy')}`}>DPOY</th>
                <th className={`table-label ${sorted('smoy')}`}>6MOY</th>
                <th className={`table-label ${sorted('mip')}`}>MIP</th>
                <th className={`table-label ${sorted('roy')}`}>ROY</th>
                <th className={`table-label ${sorted('nba_cup_mvp')}`}>NBA Cup MVP</th>
                <th className={`table-label ${sorted('all_nba_1')}`}>NBA 1st/2nd/3rd</th>
                <th className="table-label">Def. 1st/2nd</th>
              </tr>
            </thead>
            <tbody>
              {pageSlice.map((p, i) => {
                const globalRank = pageStart + i + 1
                return (
                  <tr key={p.entity_id} className="table-row">
                    <td className={styles.rank}>
                      <span className="event-rank rank-badge">{globalRank}</span>
                    </td>

                    <td>
                      <div className={styles.player}>
                        <img
                          src={`/media/athletes/basketball/male/profile/${p.slug}.png`}
                          alt={p.canonical_name}
                          className="avatar"
                          onError={e => {
                            const fallback = resolveImageUrl(p.image_url)
                            if (fallback && e.target.src !== fallback) {
                              e.target.src = fallback
                            } else {
                              e.target.style.display = 'none'
                              e.target.nextSibling.style.display = 'flex'
                            }
                          }}
                        />
                        <div className="avatar-placeholder" style={{ display: 'none' }}>
                          {(p.canonical_name)?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className={styles.playerMeta}>
                          <span className="athlete-name">{p.canonical_name}</span>
                          <div className={styles.countryRow}>
                            <Flag iso2={p.country_iso2} name={p.country_name} className="flag" />
                            <span className="athlete-profile-small">{p.country_name || p.country_iso2 || '—'}</span>
                            {p.club_code && (
                              <span className={`athlete-profile-small ${styles.clubCode}`}>{p.club_code}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="stats-light" style={{ textAlign: 'center' }}>
                      {p.position || '—'}
                    </td>

                    <td className={`${styles.stat} stats-strong ${sorted('mvp')}`}>{p.mvp}</td>
                    <td className={`${styles.stat} stats-light ${sorted('finals_mvp')}`}>{p.finals_mvp}</td>
                    <td className={`${styles.stat} stats-light`}>—</td>
                    <td className={`${styles.stat} stats-light ${sorted('dpoy')}`}>{p.dpoy}</td>
                    <td className={`${styles.stat} stats-light ${sorted('smoy')}`}>{p.smoy}</td>
                    <td className={`${styles.stat} stats-light ${sorted('mip')}`}>{p.mip}</td>
                    <td className={`${styles.stat} stats-light ${sorted('roy')}`}>{p.roy}</td>
                    <td className={`${styles.stat} stats-light ${sorted('nba_cup_mvp')}`}>{p.nba_cup_mvp}</td>
                    <td className={`${styles.stat} stats-light ${sorted('all_nba_1')}`}>{p.all_nba_1}/{p.all_nba_2}/{p.all_nba_3}</td>
                    <td className={`${styles.stat} stats-light`}>{p.all_def_1}/{p.all_def_2}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Pagination */}
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
        </>
      )}
    </div>
  )
}
