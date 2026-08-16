import { useEffect, useState } from 'react'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import styles from './clubs_template.module.css'

const PAGE_SIZE = 25

function getClubLogo(c) {
  if (c.logo_url) {
    if (c.logo_url.startsWith('http://') || c.logo_url.startsWith('https://')) return null // skip external
    if (c.logo_url.startsWith('/media/')) return c.logo_url
    if (c.logo_url.startsWith('/')) return `/media${c.logo_url}`
    return `/media/${c.logo_url}`
  }
  if (!c.slug) return null
  return `/media/logos/clubs/football/${c.slug}.svg`
}

export default function ClubsTemplate({ seasonId }) {
  const [allClubs, setAllClubs] = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [country, setCountry]   = useState('')
  const [page, setPage]         = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllClubs([])
    api.getClubs(seasonId)
      .then(d => setAllClubs(d?.clubs || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setCountry(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, country])

  const countries = [...new Set(allClubs.map(c => c.country_name).filter(Boolean))].sort()

  let clubs = allClubs
  if (search)  clubs = clubs.filter(c => (c.canonical_name || '').toLowerCase().includes(search.toLowerCase()))
  if (country) clubs = clubs.filter(c => c.country_name === country)

  // Already ordered participations DESC, titles DESC, name ASC by the API
  // — re-sort defensively here too in case a future API change drops it.
  clubs = [...clubs].sort((a, b) => {
    const byParticipations = (b.participations || 0) - (a.participations || 0)
    if (byParticipations !== 0) return byParticipations
    const byTitles = (b.titles || 0) - (a.titles || 0)
    if (byTitles !== 0) return byTitles
    return (a.canonical_name || '').localeCompare(b.canonical_name || '')
  })

  const totalPages = Math.ceil(clubs.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = clubs.slice(pageStart, pageStart + PAGE_SIZE)

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  const hasActiveFilter = search || country

  return (
    <div className={styles.wrap}>

      <PageNotice />

      {/* filter-bar — global */}
      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 180 }}
          placeholder="Search club..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-label" value={country} onChange={e => setCountry(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setCountry('') }}>
            Clear
          </button>
        )}
        {/* filter-total — global */}
        <span className="filter-total">{clubs.length} clubs</span>
      </div>

      {clubs.length === 0 ? (
        <div className={`${styles.empty} empty-state`}>No clubs found.</div>
      ) : (
        <>
          <table className={`${styles.table} table-thead-border`}>
            <thead>
              <tr>
                <th className={styles.rank}></th>
                <th className={`${styles.clubH} table-label-left`}>Club</th>
                <th className="table-label">Country</th>
                <th className="table-label">Participations</th>
                <th className="table-label">Titles</th>
                <th className="table-label">Played</th>
                <th className="table-label">Won</th>
                <th className="table-label">Drawn</th>
                <th className="table-label">Lost</th>
              </tr>
            </thead>
            <tbody>
              {pageSlice.map((c, i) => {
                const globalRank = pageStart + i + 1
                const clubLogo   = getClubLogo(c)
                return (
                  <tr key={c.entity_id} className="table-row">

                    {/* event-rank + rank-badge — global */}
                    <td className={styles.rank}>
                      <span className="event-rank rank-badge">{globalRank}</span>
                    </td>

                    {/* Club: logo + name */}
                    <td>
                      <div className="athlete-profile">
                        {clubLogo && (
                          <img src={clubLogo} alt={c.canonical_name} className={styles.clubLogo}
                            onError={e => e.target.style.display = 'none'} />
                        )}
                        <span className="athlete-name">{c.canonical_name}</span>
                      </div>
                    </td>

                    {/* Country: flag + name */}
                    <td>
                      <div className={styles.countryRow}>
                        <Flag iso2={c.country_iso2} name={c.country_name} className="flag" />
                        <span className="athlete-profile-small">{c.country_name || c.country_iso2 || '—'}</span>
                      </div>
                    </td>

                    <td className={`${styles.stat} stats-strong`}>{c.participations}</td>
                    <td className={`${styles.stat} stats-strong`}>{c.titles}</td>
                    <td className={`${styles.stat} stats-light`}>{c.played}</td>
                    <td className={`${styles.stat} stats-light`}>{c.won}</td>
                    <td className={`${styles.stat} stats-light`}>{c.drawn}</td>
                    <td className={`${styles.stat} stats-light`}>{c.lost}</td>
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
