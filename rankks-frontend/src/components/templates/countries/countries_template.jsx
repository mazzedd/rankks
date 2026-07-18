import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import styles from './countries_template.module.css'

const PAGE_SIZE = 25

// Format year as "2025-2026" for end-year convention, or just "2026"
function formatSeasonYear(year, convention) {
  if (convention === 'end') return `${year - 1}–${year}`
  return `${year}`
}

export default function CountriesTemplate({ seasonId, competitionName = '', yearConvention = 'end' }) {
  const { activeYear } = useAppStore()
  const seasonLabel = formatSeasonYear(activeYear, yearConvention)
  const [allCountries, setAllCountries] = useState([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState('')
  const [confederation, setConfederation] = useState('')
  const [page, setPage]                 = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllCountries([])
    api.getCountries(seasonId)
      .then(d => setAllCountries(d?.countries || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setConfederation(''); setPage(1) }, [seasonId])
  useEffect(() => { setPage(1) }, [search, confederation])

  const confederations = [...new Set(allCountries.map(c => c.confederation).filter(Boolean))].sort()

  let countries = allCountries
  if (search)        countries = countries.filter(c => (c.canonical_name || '').toLowerCase().includes(search.toLowerCase()))
  if (confederation) countries = countries.filter(c => c.confederation === confederation)

  // Already ordered participations DESC, titles DESC, name ASC by the API
  // — re-sort defensively here too in case a future API change drops it.
  countries = [...countries].sort((a, b) => {
    const byParticipations = (b.participations || 0) - (a.participations || 0)
    if (byParticipations !== 0) return byParticipations
    const byTitles = (b.titles || 0) - (a.titles || 0)
    if (byTitles !== 0) return byTitles
    return (a.canonical_name || '').localeCompare(b.canonical_name || '')
  })

  const totalPages = Math.ceil(countries.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = countries.slice(pageStart, pageStart + PAGE_SIZE)

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  const hasActiveFilter = search || confederation

  return (
    <div className={styles.wrap}>

      {/* page-title — global */}
      <div className="page-title">Countries</div>
      <PageNotice />

      {/* filter-bar — global */}
      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 180 }}
          placeholder="Search country..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-label" value={confederation} onChange={e => setConfederation(e.target.value)}>
          <option value="">All Confederations</option>
          {confederations.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setConfederation('') }}>
            Clear
          </button>
        )}
        {/* filter-total — global */}
        <span className="filter-total">{countries.length} countries</span>
      </div>

      {countries.length === 0 ? (
        <div className={`${styles.empty} empty-state`}>No countries found.</div>
      ) : (
        <>
          <table className={`${styles.table} table-thead-border`}>
            <thead>
              <tr>
                <th className={styles.rank}></th>
                <th className={`${styles.countryH} table-label-left`}>Country</th>
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
                return (
                  <tr key={c.entity_id} className="table-row">

                    {/* event-rank — global */}
                    <td className={styles.rank}>
                      <span className={`event-rank ${styles.rn}`}>{globalRank}</span>
                    </td>

                    {/* Country: flag + name — single badge, no separate
                        logo/country split like clubs_template, since the
                        entity IS the country */}
                    <td>
                      <div className="athlete-profile">
                        <Flag iso2={c.country_iso2} name={c.canonical_name} className={styles.countryFlag} />
                        <span className="athlete-name">{c.canonical_name}</span>
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
