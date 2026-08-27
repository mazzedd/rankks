import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import DeceasedMark from '../../shared/DeceasedMark'
import SearchableSelect from '../../shared/SearchableSelect'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import { basketballSubtitleParams } from '../../../utils/basketballSubtitleMap'
import styles from './players_template.module.css'

// Same year-after-death rule as every other All-Time page's deceased cross.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

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
  { key: 'all_star',     label: 'All-Star' },
  { key: 'all_star_mvp', label: 'All-Star MVP' },
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
export default function PlayerAwardsTemplate({ seasonId, tabKey, activeEvent, isPast, endDate }) {
  const { activeYear } = useAppStore()

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [basketballSubtitle, setBasketballSubtitle] = useState(null)
  useEffect(() => {
    const p = basketballSubtitleParams(activeEvent, tabKey, activeYear, isPast)
    if (!p) { setBasketballSubtitle(null); return }
    api.getSubtitle('basketball', null, p.itemA, p.itemB, p.year, p.isPast)
      .then(d => setBasketballSubtitle(d?.subtitle || null))
      .catch(() => setBasketballSubtitle(null))
  }, [activeEvent, tabKey, activeYear, isPast])

  const [allPlayers, setAllPlayers] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [position, setPosition]     = useState('')
  const [club, setClub]             = useState('')
  const [country, setCountry]       = useState('')
  const [sortStat, setSortStat]     = useState('')
  const [activity, setActivity]     = useState('') // '' | 'active' | 'retired'
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

  useEffect(() => { setSearch(''); setPosition(''); setClub(''); setCountry(''); setSortStat(''); setActivity(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, position, club, country, sortStat, activity])

  let players = allPlayers.filter(p =>
    (!search || getName(p).includes(search.toLowerCase())) &&
    (!position || p.position === position) &&
    (!club || p.club_name === club) &&
    (!country || p.country_name === country) &&
    (!activity || (activity === 'active' ? p.is_active : !p.is_active))
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

  const hasActiveFilter = search || position || club || country || sortStat || activity
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  return (
    <div className={styles.wrap}>

      {basketballSubtitle && (
        <div className="page-subtitle">{basketballSubtitle}</div>
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
        <SearchableSelect
          value={club}
          onChange={setClub}
          options={clubs.map(c => ({ value: c, label: c }))}
          allLabel="All Teams"
        />
        <SearchableSelect
          value={country}
          onChange={setCountry}
          options={countries.map(c => ({ value: c, label: c }))}
          allLabel="All Countries"
        />
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <div className={styles.activityTags}>
          <button
            type="button"
            className={`${styles.activityTag} ${activity === 'active' ? styles.activityTagActive : ''}`}
            onClick={() => setActivity(a => a === 'active' ? '' : 'active')}
          >
            Active
          </button>
          <button
            type="button"
            className={`${styles.activityTag} ${activity === 'retired' ? styles.activityTagActive : ''}`}
            onClick={() => setActivity(a => a === 'retired' ? '' : 'retired')}
          >
            Retired
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setPosition(''); setClub(''); setCountry(''); setSortStat(''); setActivity('') }}>
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
                <th className={`${styles.age} table-label`}>Age</th>
                <th className={`table-label ${sorted('mvp')} ${sorted('finals_mvp')}`}>
                  <div className={styles.twoLineLabel}><span>MVP</span><span>Finals MVP</span></div>
                </th>
                <th className={`table-label ${sorted('all_star')} ${sorted('all_star_mvp')}`}>
                  <div className={styles.twoLineLabel}><span>All-Star</span><span>MVP</span></div>
                </th>
                <th className={`table-label ${sorted('dpoy')}`}>DPOY</th>
                <th className={`table-label ${sorted('smoy')}`}>6MOY</th>
                <th className={`table-label ${sorted('mip')}`}>MIP</th>
                <th className={`table-label ${sorted('roy')}`}>ROY</th>
                <th className={`table-label ${sorted('nba_cup_mvp')}`}>
                  <div className={styles.twoLineLabel}><span>NBA Cup</span><span>MVP</span></div>
                </th>
                <th className={`table-label ${sorted('all_nba_1')}`}>
                  <div className={styles.twoLineLabel}><span>All NBA</span><span>1st/2nd/3rd</span></div>
                </th>
                <th className="table-label">
                  <div className={styles.twoLineLabel}><span>All Def.</span><span>1st/2nd</span></div>
                </th>
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
                          <span className="athlete-name">
                            {p.canonical_name}
                            {p.position && <span className="athletePosition"> - {p.position}</span>}
                          </span>
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

                    <td className={styles.age} style={{ textAlign: 'center' }}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">
                          {calcAge(p.birth_date, endDate, p.death_date) ?? '–'}
                          {showDeceasedMark(p.death_date, activeYear) && <DeceasedMark />}
                        </span>
                        {p.birth_date && <span className="athlete-profile-small">{fmtBirth(p.birth_date)}</span>}
                      </div>
                    </td>

                    <td className={`${styles.stat} ${sorted('mvp')} ${sorted('finals_mvp')}`}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">{p.mvp}</span>
                        <span className="athlete-profile-small">{p.finals_mvp}</span>
                      </div>
                    </td>
                    <td className={`${styles.stat} ${sorted('all_star')} ${sorted('all_star_mvp')}`}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">{p.all_star}</span>
                        <span className="athlete-profile-small">{p.all_star_mvp}</span>
                      </div>
                    </td>
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
