// templates/partners/PartnersTemplate.jsx
// Real routed /partners page ("Official Partnerships") — a flat, cross-sport
// listing of every partnership row across every brand (not scoped to one
// partner), modeled on the tennis schedule page's own table+filter shape
// (HomeTennisTemplate.jsx: fetch-once, filter/count entirely client-side,
// same faceted-count pattern as players_template.jsx's positionCounts/
// clubCounts). No EventBlock here (Mohamed: "no logo in the bar, no follow
// option") — the pink pill + title are this page's own minimal header
// instead, reusing the generic table shell (f1.module.css) and shared
// page-subtitle/filter-bar classes every other page already uses.
//
// Year scoping: tied to the shared YearSelector's activeYear, same "active
// during this year" point-in-time semantics every other page on the site
// uses (Mohamed, important: "respect logic ... active during only") — a
// deal shows for year Y iff start_year <= Y <= (end_year or today). The
// separate Totals view (partnersTotals, /partners/totals) drops the year
// filter entirely for a full all-time ledger, same Home/Totals split as
// Tennis's own activeTennisTotals.
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import useAppStore from '../../../store/useAppStore'
import { pathForPartners } from '../../../routing/urlSchema'
import { api } from '../../../services/api'
import SearchableSelect from '../../shared/SearchableSelect'
import MultiCheckSelect from '../../shared/MultiCheckSelect'
import Flag from '../../shared/Flag'
import tableStyles from '../f1/f1.module.css'
import styles from './PartnersTemplate.module.css'

const CURRENT_YEAR = new Date().getFullYear()

const TYPE_OPTIONS = [
  { value: 'athletes_men',   label: 'Athletes (Men)' },
  { value: 'athletes_women', label: 'Athletes (Women)' },
  { value: 'clubs',          label: 'Clubs' },
  { value: 'competitions',   label: 'Competitions' },
  { value: 'events',         label: 'Events' },
]

// entity subjects that are teams, not individual athletes — folded into one
// "Clubs" bucket (national teams read as a team the same way a club does).
const CLUB_ENTITY_TYPES = ['club', 'f1_team', 'motogp_team', 'tour', 'national_team']

function typeKeyFor(r) {
  if (r.subject_type === 'competition') return 'competitions'
  if (r.subject_type === 'race') return 'events'
  if (CLUB_ENTITY_TYPES.includes(r.subject_entity_type)) return 'clubs'
  return r.subject_gender === 'F' ? 'athletes_women' : 'athletes_men'
}

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  return url.startsWith('/media/') ? url : `/media/${url}`
}

function countBy(list, keyFn) {
  const m = new Map()
  for (const item of list) {
    const k = keyFn(item)
    if (k) m.set(k, (m.get(k) || 0) + 1)
  }
  return m
}

function durationLabel(startYear, endYear) {
  const end = endYear || CURRENT_YEAR
  const years = end - startYear
  if (years <= 0) return 'New'
  return `${years} year${years === 1 ? '' : 's'}`
}

export default function PartnersTemplate() {
  const store = useAppStore()
  const {
    activeSport, activeCategory, activeCompetition, activeYear, setYearRange,
    partnersTotals, setPartnersTotals,
  } = store
  // HomepageTemplate silently force-sets activeSport to 'tennis' just to
  // keep the Sidebar populated on the bare homepage — not a real navigation
  // (see its own comment: "Tennis tab is taught to ignore this silent
  // default (only lights up once activeCategory/activeCompetition are
  // really set)"). Same guard here, or the homepage would wrongly lock this
  // page to Tennis.
  const isRealSportContext = !!(activeCategory || activeCompetition)

  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [sports, setSports]   = useState([])
  const [brandSearch, setBrandSearch]       = useState('')
  const [sportFilter, setSportFilter]       = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [typeFilter, setTypeFilter]         = useState(new Set())
  const [sortBy, setSortBy] = useState('') // '' = A-Z (default), 'start_year' = From
  // Independent toggles (either, both, or neither can be on), same model as
  // F1DriversAllTimeTemplate.jsx's Active/Retired pills — both on means no
  // filtering, not "show nothing".
  const [showActive, setShowActive]   = useState(false)
  const [showDefunct, setShowDefunct] = useState(false)
  const [sportDefaulted, setSportDefaulted] = useState(false)
  const [sportLocked, setSportLocked]       = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getPartnerships()
      .then(d => { if (!cancelled) setRows(d || []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Real sports list (id/name/slug), not derived from partnership rows —
  // a sport with zero partnerships yet (e.g. Combat Sport/UFC right now)
  // must still lock the page to it and hide the Sport picker, not silently
  // fall back to "All Sports" just because nothing's been entered for it.
  useEffect(() => {
    api.getSports().then(d => setSports(d || [])).catch(() => setSports([]))
  }, [])

  // Apply the activeSport default exactly once, as soon as the sports list
  // is in — independent of whether any partnership rows exist for it yet.
  useEffect(() => {
    if (sportDefaulted || sports.length === 0) return
    if (activeSport && isRealSportContext) {
      const match = sports.find(s => s.slug === activeSport)
      if (match) {
        setSportFilter(match.name)
        setSportLocked(true)
      }
    }
    setSportDefaulted(true)
  }, [activeSport, isRealSportContext, sports, sportDefaulted])

  // Publish this page's own year span to the shared YearSelector — same
  // call every other content area makes (see HomeTennisTemplate.jsx).
  useEffect(() => {
    if (!rows.length) return
    const years = rows.flatMap(r => [r.start_year, r.end_year || CURRENT_YEAR])
    setYearRange({ minYear: Math.min(...years), maxYear: Math.max(...years), editionYears: undefined })
  }, [rows, setYearRange])

  // Faceted filter options: each dropdown's option list (and count)
  // reflects every OTHER active filter but never its own current selection
  // — same pattern as players_template.jsx's positionCounts/clubCounts.
  const matchesBrandSearch = r => !brandSearch || (r.partner_name || '').toLowerCase().includes(brandSearch.toLowerCase())
  const matchesSport    = r => !sportFilter    || r.sport_name === sportFilter
  const matchesCategory = r => !categoryFilter || r.category_name === categoryFilter
  const matchesType     = r => typeFilter.size === 0 || typeFilter.has(typeKeyFor(r))
  // Active-during-activeYear only (Mohamed, important: "respect logic") —
  // dropped entirely on the Totals view, which shows every deal ever.
  const matchesYear = r => partnersTotals || (r.start_year <= activeYear && (r.end_year == null || r.end_year >= activeYear))
  const onlyActive  = showActive && !showDefunct
  const onlyDefunct = showDefunct && !showActive
  const matchesStatus = r => {
    if (onlyActive) return r.end_year == null
    if (onlyDefunct) return r.end_year != null
    return true
  }

  const rowsForSportOptions    = rows.filter(r => matchesBrandSearch(r) && matchesCategory(r) && matchesType(r) && matchesYear(r) && matchesStatus(r))
  const rowsForCategoryOptions = rows.filter(r => matchesBrandSearch(r) && matchesSport(r) && matchesType(r) && matchesYear(r) && matchesStatus(r))
  const rowsForTypeOptions     = rows.filter(r => matchesBrandSearch(r) && matchesSport(r) && matchesCategory(r) && matchesYear(r) && matchesStatus(r))

  const sportCounts    = countBy(rowsForSportOptions, r => r.sport_name)
  const categoryCounts = countBy(rowsForCategoryOptions, r => r.category_name)
  const typeCounts     = countBy(rowsForTypeOptions, typeKeyFor)

  const sportOptions    = [...sportCounts.keys()].sort().map(name => ({ value: name, label: `${name} (${sportCounts.get(name)})` }))
  const categoryOptions = [...categoryCounts.keys()].sort().map(name => ({ value: name, label: `${name} (${categoryCounts.get(name)})` }))
  // Fixed order (not alphabetical) — matches the order the 5 types were specced in.
  const typeOptions     = TYPE_OPTIONS.map(o => ({ ...o, label: `${o.label} (${typeCounts.get(o.value) || 0})` }))

  const filtered = rows.filter(r => matchesBrandSearch(r) && matchesSport(r) && matchesCategory(r) && matchesType(r) && matchesYear(r) && matchesStatus(r))
  const sorted = [...filtered].sort((a, b) => sortBy === 'start_year'
    ? a.start_year - b.start_year
    : (a.partner_name || '').localeCompare(b.partner_name || ''))

  const hasActiveFilter = brandSearch || (!sportLocked && sportFilter) || categoryFilter || typeFilter.size > 0 || showActive || showDefunct
  const clearFilters = () => {
    setBrandSearch('')
    if (!sportLocked) setSportFilter('')
    setCategoryFilter(''); setTypeFilter(new Set())
    setShowActive(false); setShowDefunct(false); setSortBy('')
  }

  return (
    <div className={tableStyles.wrap}>
      <div className={styles.header}>
        <span className={styles.pill}>Brands</span>
        <h1 className={styles.title}>{sportLocked ? `${sportFilter} ` : ''}Official Partnerships</h1>
      </div>
      <div className="page-subtitle">List of official sponsors and partnerships</div>

      <div className={tableStyles.statusToggle} style={{ marginBottom: 12 }}>
        <Link
          to={pathForPartners(store, false)}
          className={`${tableStyles.statusBtn} ${!partnersTotals ? tableStyles.statusBtnActive : ''}`}
          onClick={() => setPartnersTotals(false)}
        >
          By Year
        </Link>
        <Link
          to={pathForPartners(store, true)}
          className={`${tableStyles.statusBtn} ${partnersTotals ? tableStyles.statusBtnActive : ''}`}
          onClick={() => setPartnersTotals(true)}
        >
          Totals
        </Link>
      </div>

      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 160 }}
          placeholder="Search brand..."
          value={brandSearch}
          onChange={e => setBrandSearch(e.target.value)}
        />
        {!sportLocked && (
          <SearchableSelect
            value={sportFilter}
            onChange={setSportFilter}
            options={sportOptions}
            allLabel="All Sports"
          />
        )}
        <SearchableSelect
          value={categoryFilter}
          onChange={setCategoryFilter}
          options={categoryOptions}
          allLabel="All Categories"
        />
        <MultiCheckSelect
          values={typeFilter}
          onChange={setTypeFilter}
          options={typeOptions}
          allLabel="All Types"
        />
        <div className={tableStyles.statusToggle}>
          <button
            type="button"
            className={`${tableStyles.statusBtn} ${showActive ? tableStyles.statusBtnActive : ''}`}
            onClick={() => setShowActive(v => !v)}
          >
            Active
          </button>
          <button
            type="button"
            className={`${tableStyles.statusBtn} ${showDefunct ? tableStyles.statusBtnActive : ''}`}
            onClick={() => setShowDefunct(v => !v)}
          >
            Defunct
          </button>
        </div>
        {partnersTotals && (
          <select className="filter-label" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="">Sort: A-Z</option>
            <option value="start_year">Sort: From</option>
          </select>
        )}
        {hasActiveFilter && (
          <button type="button" className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{sorted.length} partnerships</span>
      </div>

      {loading && <p className="empty-state">Loading…</p>}
      {!loading && sorted.length === 0 && (
        <p className="empty-state">No partnerships match these filters.</p>
      )}

      {!loading && sorted.length > 0 && (
        <div className={tableStyles.tableScroll}>
          <table className={`${tableStyles.table} ${styles.table} table-thead-border`}>
            <thead>
              <tr>
                <th className="table-label-left">Brand</th>
                <th className="table-label-left">Sponsored Property</th>
                <th className="table-label-left">Category</th>
                <th className="table-label-left">Name</th>
                <th className="table-label">Start</th>
                <th className="table-label">End</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={r.id} className="table-row" style={{ animationDelay: `${i * 0.02}s` }}>
                  <td>
                    <div className="entity-cell">
                      {r.partner_logo_url
                        ? <img src={resolveImg(r.partner_logo_url)} alt="" className={styles.brandLogo} onError={e => { e.target.style.visibility = 'hidden' }} />
                        : <span className={styles.brandLogoPlaceholder}>{(r.partner_name || '?')[0]}</span>}
                      <div className="entity-stack">
                        <span className="club-name">{r.partner_name}</span>
                        <div className="entity-meta-row">
                          <Flag iso2={r.partner_country_iso2} name={r.partner_country_name} className="flag" />
                          <span className="cell-meta">{r.partner_country_name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className={styles.subjectStack}>
                      <span className="club-name">{r.subject_name || '—'}</span>
                      <span className="cell-meta">{r.sport_name || '—'}</span>
                    </div>
                  </td>
                  <td>
                    <div className={styles.subjectStack}>
                      <span>{r.tier_name}</span>
                      {r.subcategory?.length > 0 && <span className="cell-meta">{r.subcategory.join(', ')}</span>}
                    </div>
                  </td>
                  <td>{r.name || '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    <div className={styles.yearStack}>
                      <span>{r.start_year}</span>
                      <span className="cell-meta">{durationLabel(r.start_year, r.end_year)}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>{r.end_year || 'Today'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
