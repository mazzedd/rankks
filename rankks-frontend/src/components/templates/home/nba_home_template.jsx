// templates/home/nba_home_template.jsx
// "Home of NBA" content — the full game schedule (Regular Season/Play-in/
// Playoffs/Finals combined) for the browsed year, rendered below
// FootballHomeBlock's banner in home_template.jsx (Mohamed 2026-08-16:
// "create the Home of NBA, same template as FIFA World Cup" — reuses
// FootballHomeBlock as-is for the banner, this file mirrors
// football_home_knockout_template.jsx's content shape with NBA's own
// differences: team LOGOS instead of country flags (no national teams
// here), an event-type pill row (Regular Season I Play-in I Playoffs I
// Finals) instead of football's Group Stages/Knockout toggle since NBA
// has four stages not two, and no Group/Location/Host filters (nothing
// in the data maps to those football-only concepts).
//
// Backed by /results/home-nba/:year — same "latest game on top" sort as
// football's Home (backend ORDER BY match_date DESC).
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import SearchableSelect from '../../shared/SearchableSelect'
import MatchVideo from '../../shared/MatchVideo'
import { fmtDate } from '../../../utils/calcAge'
import { classifyByDate } from '../../../utils/eventStatus'
import { StatusBadge } from '../../EventBlock/EventBlock'
import f1Styles from '../f1/f1.module.css'

const EVENT_PILLS = ['Regular Season', 'Play-in', 'Playoffs', 'Finals']

function resolveLogo(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

export default function NbaHomeTemplate({ competitionName, year }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [teamFilter, setTeamFilter] = useState('')
  const [eventPill, setEventPill] = useState('')

  // Admin-configured subtitle line — same "Calendar" item_a convention
  // football_home_knockout_template.jsx uses for this same content slot.
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year) return
    api.getSubtitle('basketball', 'nba', 'Calendar', null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year])

  useEffect(() => {
    if (!year) return
    let cancelled = false
    setLoading(true)
    api.getNbaHome(year)
      .then(d => { if (!cancelled) setRows(d?.rows || []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [year])

  useEffect(() => { setTeamFilter(''); setEventPill('') }, [year])

  if (loading) return <div className={f1Styles.wrap}><Skeleton /></div>
  if (!rows?.length) return <div className={f1Styles.wrap}><Empty /></div>

  // Same Past/Ongoing/Next/Future classification every other schedule in
  // this app uses, computed against the FULL unfiltered list so "Next"
  // always points at the true next game regardless of active filters.
  const statusByGameId = new Map(
    classifyByDate(rows, r => r.match_date).map(({ item, status }) => [item.id, status])
  )

  const teamOptions = [...new Set(rows.flatMap(r => [r.home.name, r.away.name]))].sort()

  const filtered = rows.filter(r => {
    if (teamFilter && r.home.name !== teamFilter && r.away.name !== teamFilter) return false
    if (eventPill && r.event_label !== eventPill) return false
    return true
  })

  const hasActiveFilter = teamFilter || eventPill
  const clearFilters = () => { setTeamFilter(''); setEventPill('') }

  return (
    <div className={f1Styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      <div className="filter-bar">
        <SearchableSelect
          value={teamFilter}
          onChange={setTeamFilter}
          options={teamOptions.map(name => ({ value: name, label: name }))}
          allLabel="All Teams"
        />
        <div className={f1Styles.statusToggle}>
          {EVENT_PILLS.map(label => (
            <button
              key={label}
              type="button"
              className={`${f1Styles.statusBtn} ${eventPill === label ? f1Styles.statusBtnActive : ''}`}
              onClick={() => setEventPill(p => p === label ? '' : label)}
            >
              {label}
            </button>
          ))}
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{filtered.length} games</span>
      </div>

      <div className={f1Styles.tableScroll}>
        <table className={`${f1Styles.table} ${f1Styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              <th className="table-label" style={{ textAlign: 'left', width: '11%' }}>Date</th>
              <th className="table-label" style={{ textAlign: 'left', width: '14%' }}>Event</th>
              <th className="table-label" style={{ textAlign: 'left', width: '32%' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 8 }}>
                  <span style={{ justifySelf: 'start' }}>Team</span>
                  <span style={{ textAlign: 'center' }}>vs</span>
                  <span style={{ justifySelf: 'start' }}>Team</span>
                </div>
              </th>
              <th className="table-label" style={{ textAlign: 'left', width: '18%' }}>Location</th>
              <th className="table-label" style={{ textAlign: 'center', width: '11%' }}>Status</th>
              <th className="table-label" style={{ textAlign: 'center', width: '11%' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const status = statusByGameId.get(r.id)
              const homeStrong = r.home_won === true
              const awayStrong = r.home_won === false
              const hasScore = r.score?.home != null && r.score?.away != null
              return (
                <tr key={r.id} className={`table-row ${f1Styles.homeRow}`} style={{ animationDelay: `${i * 0.03}s`, verticalAlign: 'top' }}>
                  <td className="stats-light" style={{ textAlign: 'left' }}>{fmtDate(r.match_date)}</td>
                  <td className="stats-light" style={{ textAlign: 'left' }}>{r.event_label}</td>
                  <td style={{ textAlign: 'left' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', alignItems: 'start', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, justifySelf: 'start', minWidth: 0 }}>
                        {resolveLogo(r.home.logo) && (
                          <img src={resolveLogo(r.home.logo)} alt={r.home.name} style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} onError={e => { e.target.style.display = 'none' }} />
                        )}
                        <span className="athlete-name" style={{ whiteSpace: 'nowrap', fontWeight: homeStrong ? 600 : 400 }}>{r.home.name}</span>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div className="stats-light" style={{ padding: 0 }}>{hasScore ? `${r.score.home} I ${r.score.away}` : 'vs'}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, justifySelf: 'start', minWidth: 0 }}>
                        {resolveLogo(r.away.logo) && (
                          <img src={resolveLogo(r.away.logo)} alt={r.away.name} style={{ width: 20, height: 20, objectFit: 'contain', flexShrink: 0 }} onError={e => { e.target.style.display = 'none' }} />
                        )}
                        <span className="athlete-name" style={{ whiteSpace: 'nowrap', fontWeight: awayStrong ? 600 : 400 }}>{r.away.name}</span>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div className="stats-light" style={{ padding: 0, textAlign: 'left' }}>{r.venue_city || '—'}</div>
                    {r.venue && <div className="athlete-profile-small" style={{ textAlign: 'left' }}>{r.venue}</div>}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <StatusBadge status={status} />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <MatchVideo
                      videoUrl={r.video?.url}
                      source={r.video?.source}
                      embeddable={r.video?.embeddable}
                      thumbnailUrl={r.video?.thumbnail_url}
                      videoId={r.video?.id}
                      videoType="media"
                      title={`${r.home.name} - ${r.away.name}`}
                      subtitle={competitionName}
                    />
                  </td>
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
    <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No games available.</div>
}
