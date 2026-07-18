import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import styles from './standings_template.module.css'

// Normalise any logo_url coming from the backend to an absolute /media/ path
function resolveLogoUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url  // external CDN
  if (url.startsWith('/media/')) return url                                 // already correct
  if (url.startsWith('/')) return `/media${url}`                           // starts with / but missing /media
  return `/media/${url}`                                                    // bare relative path e.g. "logos/clubs/..."
}

export default function StandingsTemplate({ seasonId, tabKey, tabName, columnConfig, competitionName = '', yearConvention = 'end' }) {
  const { activeYear } = useAppStore()
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!seasonId || !tabKey) return
    setLoading(true)
    api.getStandings(seasonId, tabKey)
      .then(d => {
        console.log('STANDINGS DATA RECEIVED:', d)
        setData(d)
      })
      .catch(err => console.error('STANDINGS FETCH ERROR:', err))
      .finally(() => setLoading(false))
  }, [seasonId, tabKey])

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

  console.log('STEP 1: about to build cols')
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
  console.log('STEP 2: cols built', cols)

  // Column header adapts to what the table actually contains — national
  // team rows (World Cup groups) show "Team", everything else keeps the
  // existing "Club" label.
  const entityColumnLabel = data.standings.some(r => !resolveLogoUrl(r.logo_url) && r.country_iso2) ? 'Team' : 'Club'

  return (
    <div className={styles.wrap}>

      {/* Page title — global class */}
      <div className="page-title">
        League standings{tabName && <span className="title-suffix"> - {tabName}</span>}
      </div>
      <PageNotice />

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
          {(() => {
            console.log('STEP 3: about to map rows, count =', data.standings.length)
            return data.standings.map((row, i) => {
              console.log('STEP 4: rendering row', i, row)
              let logoSrc, clubName
              try {
                logoSrc = resolveLogoUrl(row.logo_url)
                console.log('STEP 5: logoSrc resolved', logoSrc)
              } catch (err) {
                console.error('CRASH IN resolveLogoUrl for row', i, row, err)
                throw err
              }
              try {
                clubName = row.display_name || row.canonical_name || row.short_name || '—'
                console.log('STEP 6: clubName resolved', clubName)
              } catch (err) {
                console.error('CRASH building clubName for row', i, row, err)
                throw err
              }

              let statCells
              try {
                statCells = cols.map(c => {
                  const v = c.key === 'goal_diff'
                    ? ((row.stats?.goals_for || 0) - (row.stats?.goals_against || 0))
                    : (row.stats?.[c.key] ?? '—')
                  return { key: c.key, v, bold: c.bold }
                })
                console.log('STEP 7: statCells computed for row', i, statCells)
              } catch (err) {
                console.error('CRASH computing statCells for row', i, row, err)
                throw err
              }

              // No club logo means try the flag — same simple, proven
              // pattern as game_template.jsx's TeamLogo, no dependency
              // on entity_type matching exactly what ingestion wrote.
              const showFlag = !logoSrc && !!row.country_iso2

              return (
                <tr key={row.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>

                  {/* Rank — global class */}
                  <td className={styles.pos}>
                    <span className={`event-rank ${styles.pn}`}>
                      {row.position}
                    </span>
                  </td>

                  {/* Club/Team logo (or flag) + name */}
                  <td>
                    <div className={styles.club}>
                      {logoSrc
                        ? <img
                            src={logoSrc}
                            alt={clubName}
                            className={styles.clogo}
                            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block' }}
                          />
                        : showFlag
                          ? <Flag iso2={row.country_iso2} name={clubName} className={styles.clogo} />
                          : null
                      }
                      <div className={`${styles.cph} logo-placeholder`} style={{ display: (logoSrc || showFlag) ? 'none' : 'block' }} />
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
            })
          })()}
        </tbody>
      </table>
    </div>
  )
}
