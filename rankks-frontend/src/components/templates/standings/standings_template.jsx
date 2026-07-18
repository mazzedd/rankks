import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import { getBasketballPageText } from '../../../utils/basketballSubtitles'
import styles from './standings_template.module.css'

// Normalise any logo_url coming from the backend to an absolute /media/ path
function resolveLogoUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url  // external CDN
  if (url.startsWith('/media/')) return url                                 // already correct
  if (url.startsWith('/')) return `/media${url}`                           // starts with / but missing /media
  return `/media/${url}`                                                    // bare relative path e.g. "logos/clubs/..."
}

export default function StandingsTemplate({ seasonId, tabKey, tabName, sport, activeEvent, isPast, columnConfig, competitionName = '', yearConvention = 'end' }) {
  const { activeYear } = useAppStore()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]         = useState('')
  const [conference, setConference] = useState('')
  const [division, setDivision]     = useState('')

  useEffect(() => {
    if (!seasonId || !tabKey) return
    setLoading(true)
    api.getStandings(seasonId, tabKey)
      .then(d => setData(d))
      .catch(err => console.error('STANDINGS FETCH ERROR:', err))
      .finally(() => setLoading(false))
  }, [seasonId, tabKey])

  useEffect(() => { setSearch(''); setConference(''); setDivision('') }, [seasonId, tabKey])
  // Division options depend on the selected conference (BASK-NAV-01 page 7's
  // default settings: Atlantic/Central/Southeast under East, Northwest/
  // Pacific/Southwest under West) — clearing division on conference change
  // avoids an impossible combo (e.g. Eastern + Pacific) silently zeroing the list.
  useEffect(() => { setDivision('') }, [conference])

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(6)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 42, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  if (!data?.standings?.length) return (
    <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>
      No standings data available.
    </div>
  )

  const cols = columnConfig || [
    { key: 'played',        label: 'Played' },
    { key: 'won',           label: 'Won' },
    { key: 'drawn',         label: 'Drawn' },
    { key: 'lost',          label: 'Lost' },
    { key: 'goals_for',     label: 'GF' },
    { key: 'goals_against', label: 'GA' },
    { key: 'goal_diff',     label: 'GD' },
    { key: 'points',        label: 'Points', bold: true },
  ]

  // Basketball-only: search + Conference/Division filters (BASK-NAV-01 page
  // 7's default settings). Other sports never populate row.conference/
  // division, so this silently does nothing for them.
  const isBasketball = sport === 'basketball'
  const basketballPageText = isBasketball ? getBasketballPageText(activeEvent, tabKey, activeYear, isPast) : null

  // Admin-configured title (tab_titles table) takes priority; then
  // basketball's own tab_key-driven title (e.g. NBA Cup's "Eastern Conf.
  // Groups", distinct from the generic "Standings" every other basketball
  // standings tab uses — same fallback GameTemplate already applies);
  // "Standings" is the last resort for every non-basketball sport.
  // Suffix (" - Group A") only auto-appends to the hardcoded default —
  // an explicit override is treated as complete on its own (it can
  // already embed {group_name} itself via the admin panel).
  const hasOverride = !!data.tab?.page_title
  const pageTitle = data.tab?.page_title || basketballPageText?.title || 'Standings'

  // Column header adapts to what the table actually contains — national
  // team rows (World Cup groups) show "Team", everything else keeps the
  // existing "Club" label.
  const entityColumnLabel = data.standings.some(r => !resolveLogoUrl(r.logo_url) && r.country_iso2) ? 'Team' : 'Club'
  const DIVISIONS_BY_CONFERENCE = { Eastern: ['Atlantic', 'Central', 'Southeast'], Western: ['Northwest', 'Pacific', 'Southwest'] }
  const divisionOptions = conference ? DIVISIONS_BY_CONFERENCE[conference] : Object.values(DIVISIONS_BY_CONFERENCE).flat()

  const rows = !isBasketball ? data.standings : data.standings.filter(r => {
    const name = (r.display_name || r.canonical_name || '').toLowerCase()
    if (search && !name.includes(search.toLowerCase())) return false
    if (conference && r.conference !== conference) return false
    if (division && r.division !== division) return false
    return true
  })

  // Sub-group split (NBA Cup's Eastern/Western Conf. Groups tabs — 3 group
  // standings tables stacked on one page). Only kicks in when the backend
  // actually returned group_name on the rows; every other standings page
  // (single flat table) has group_name null throughout and renders exactly
  // as before via the groupNames.length === 0 branch below.
  const groupNames = [...new Set(rows.map(r => r.group_name).filter(Boolean))].sort()

  const renderTable = (tableRows) => (
    <table className={`${styles.table} table-thead-border`}>
      <thead>
        <tr>
          <th className={styles.pos}></th>
          {/* table-label-left for the Club/Team column */}
          <th className="table-label-left">{entityColumnLabel}</th>
          {cols.map(c => (
            <th key={c.key} className="table-label">{c.label}</th>
          ))}
        </tr>
      </thead>

      <tbody>
        {tableRows.map((row, i) => {
          const logoSrc = resolveLogoUrl(row.logo_url)
          const clubName = row.display_name || row.canonical_name || row.short_name || '—'

          const statCells = cols.map(c => {
            const v = c.key === 'goal_diff'
              ? ((row.stats?.goals_for || 0) - (row.stats?.goals_against || 0))
              : (row.stats?.[c.key] ?? '—')
            return { key: c.key, v, bold: c.bold }
          })

          // No club logo means try the flag — same simple, proven
          // pattern as game_template.jsx's TeamLogo, no dependency
          // on entity_type matching exactly what ingestion wrote.
          const showFlag = !logoSrc && !!row.country_iso2

          return (
            <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>

              {/* Rank — global event-rank + rank-badge classes */}
              <td className={styles.pos}>
                <span className="event-rank rank-badge">
                  {row.position}
                </span>
              </td>

              {/* Club/Team logo (or flag, or sport default) + name */}
              <td>
                <div className={styles.club}>
                  {logoSrc
                    ? <img
                        src={logoSrc}
                        alt={clubName}
                        className={styles.clogo}
                        onError={e => {
                          // No image at the saved path — basketball falls
                          // back to a real default club badge rather than
                          // the generic CSS placeholder box other sports use.
                          if (isBasketball && e.target.src !== new URL('/media/default/basketball/club.png', window.location.href).href) {
                            e.target.src = '/media/default/basketball/club.png'
                          } else {
                            e.target.style.display = 'none'
                            e.target.nextSibling.style.display = 'block'
                          }
                        }}
                      />
                    : showFlag
                      ? <Flag iso2={row.country_iso2} name={clubName} className="flag" />
                      : isBasketball
                        ? <img src="/media/default/basketball/club.png" alt={clubName} className={styles.clogo} />
                        : null
                  }
                  <div className={styles.cph} style={{ display: (logoSrc || showFlag || isBasketball) ? 'none' : 'block' }} />
                  {/* club-name — global class */}
                  <span className="club-name">{clubName}</span>
                </div>
              </td>

              {/* Stats columns */}
              {statCells.map(({ key, v, bold }) => (
                <td key={key} className={bold ? 'stats-strong' : 'stats-light'}>
                  {typeof v === 'number' && v > 0 && key === 'goal_diff' ? `+${v}` : v}
                </td>
              ))}

            </tr>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <div className={styles.wrap}>

      {/* Page title — global class */}
      <div className="page-title">
        {pageTitle}{!hasOverride && tabName && <span className="title-suffix"> - {tabName}</span>}
      </div>
      {basketballPageText && (
        <div className={styles.subtitle}>{basketballPageText.subtitle}</div>
      )}
      <PageNotice />

      {isBasketball && (
        <div className="filter-bar">
          <input
            className="filter-label"
            style={{ width: 160 }}
            placeholder="Search team..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {groupNames.length === 0 && (
            <>
              <select className="filter-label" value={conference} onChange={e => setConference(e.target.value)}>
                <option value="">All Conferences</option>
                <option value="Eastern">Eastern</option>
                <option value="Western">Western</option>
              </select>
              <select className="filter-label" value={division} onChange={e => setDivision(e.target.value)}>
                <option value="">All Divisions</option>
                {divisionOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </>
          )}
          {(search || conference || division) && (
            <button className="filter-reset" onClick={() => { setSearch(''); setConference(''); setDivision('') }}>
              Clear
            </button>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>
          No clubs found.
        </div>
      ) : groupNames.length > 0 ? (
        groupNames.map(gn => (
          <div key={gn}>
            <div className={styles.groupHeading}>{gn}</div>
            {renderTable(rows.filter(r => r.group_name === gn))}
          </div>
        ))
      ) : renderTable(rows)}
    </div>
  )
}
