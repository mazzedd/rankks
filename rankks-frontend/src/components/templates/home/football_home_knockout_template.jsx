// templates/home/football_home_knockout_template.jsx
// World Cup's "Schedule" tab content (Mohamed 2026-08-25: "this page becomes
// the Schedule page to be displayed as 1st item on Line A") — the full
// match schedule for the ONE browsed edition, rendered below
// FootballHomeBlock's banner in home_template.jsx. Distinct from All-Time >
// Champion History (that's the cross-edition winners table) — this is a
// single-season schedule/results list. Brought in line with NBA's own
// Schedule table (nba_home_template.jsx, 2026-08-26 build): dot status
// column + full-width proportional columns + bold winner score + faceted
// dropdowns + aggregate status pills, in place of the older text Status
// column and per-row match-video cell.
//
// Backed by /results/home-football-knockout/:seasonId — no "through <year>"
// cutoff (unlike every other football-knockout route in this file): this
// tab is about THIS season only, not career totals.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import SearchableSelect from '../../shared/SearchableSelect'
import ChevronIcon from '../../shared/ChevronIcon'
import { fmtDate } from '../../../utils/calcAge'
import { classifyByDate, STATUS_LABEL } from '../../../utils/eventStatus'
import f1Styles from '../f1/f1.module.css'

// Same rounded status dot every other sport's own Schedule table uses in
// place of a text Status column (nba_home_template.jsx's own
// STATUS_DOT_COLOR/StatusDot).
const STATUS_DOT_COLOR = { past: '#9e9e9e', ongoing: '#4caf52', next: '#ff8c00', upcoming: '#ffb400' }
function StatusDot({ status }) {
  return <span className={f1Styles.eventStatusDot} style={{ background: STATUS_DOT_COLOR[status] }} title={STATUS_LABEL[status]} />
}

// Aggregate, independently-toggleable status pills (same F1/MotoGP/Tennis/
// NBA STATUS_ORDER/statusFilter Set convention). Only shown when at least
// one game isn't 'past' (hasNonPastStatus below) — a fully concluded
// edition (every row 'past') hides the whole toggle rather than showing 4
// pills that would always return zero games; the underlying classification
// keeps running regardless, so a future edition (2026 mid-tournament) gets
// live pills with no code change.
const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

// "H I A" penalty suffix only — main score is rendered as two separate
// bold-aware spans (see GameRow) so the winning side's number can be made
// CSS bold independently of the other. Penalty score is its own second
// line, centered, formatted "(4I3)" — no spaces, no "pens".
function penaltyLabel(score) {
  const p = score?.penalty
  if (!p || (p.home == null && p.away == null)) return null
  return `(${p.home}I${p.away})`
}

// Column widths sum to 100% of the table (Mohamed: "use 100% table width to
// spread columns") — same shape as NBA's own Schedule table (dot/date/
// type-equivalent/teams/location) now that Status and Video are gone.
const COL_WIDTH = { dot: '4%', date: '10%', round: '13%', teams: '50%', location: '23%' }

function GameRow({ r, status }) {
  // Winner bold, loser normal, draw both normal — driven by the games
  // table's own home_won column (true/false/null), not re-derived from the
  // score (safer for AET/PEN games where the raw score can still read level
  // pre-shootout). Score digits themselves are now bold too (Mohamed
  // 2026-08-25: "make winner score CSS bold"), same fontWeight toggle as
  // the team name right next to it.
  const homeStrong = r.home_won === true
  const awayStrong = r.home_won === false
  const sp = r.score
  const hasScore = sp?.home != null && sp?.away != null
  const pens = penaltyLabel(sp)
  return (
    <tr className={`table-row ${f1Styles.homeRow}`} style={{ verticalAlign: 'top' }}>
      <td style={{ textAlign: 'center', width: COL_WIDTH.dot, paddingTop: 6 }}>
        <StatusDot status={status} />
      </td>
      <td className="stats-light" style={{ textAlign: 'left', width: COL_WIDTH.date }}>{fmtDate(r.match_date)}</td>
      <td className="stats-light" style={{ textAlign: 'left', width: COL_WIDTH.round }}>{r.round_label}</td>
      <td style={{ textAlign: 'left', width: COL_WIDTH.teams }}>
        {/* Fixed 3-column grid (Team 1 / Score / Team 2), same width every
            row since the table itself is table-layout:fixed — that's what
            keeps the score centered and both team blocks aligned to the
            same horizontal position row to row, regardless of name length.
            Flag always precedes the name on BOTH sides — no mirroring. Name
            is nowrap and the flag is flex-shrink:0 — a long name like "Cape
            Verde Islands" wrapping to 2 lines broke both alignment and the
            wrapped line's left edge. Table scrolls horizontally
            (.tableScroll) so a long name just extends the row instead. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', alignItems: 'start', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'start', minWidth: 0 }}>
            <span style={{ flexShrink: 0 }}><Flag iso2={r.home.iso2} name={r.home.name} className="flag" /></span>
            <span className="athlete-name" style={{ whiteSpace: 'nowrap', fontWeight: homeStrong ? 600 : 400 }}>{r.home.name}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="stats-light" style={{ padding: 0 }}>
              {hasScore ? (
                <>
                  <span style={{ fontWeight: homeStrong ? 700 : 400 }}>{sp.home}</span>
                  {' I '}
                  <span style={{ fontWeight: awayStrong ? 700 : 400 }}>{sp.away}</span>
                </>
              ) : 'vs'}
            </div>
            {pens && <div className="athlete-profile-small">{pens}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'start', minWidth: 0 }}>
            <span style={{ flexShrink: 0 }}><Flag iso2={r.away.iso2} name={r.away.name} className="flag" /></span>
            <span className="athlete-name" style={{ whiteSpace: 'nowrap', fontWeight: awayStrong ? 600 : 400 }}>{r.away.name}</span>
          </div>
        </div>
      </td>
      <td style={{ textAlign: 'left', width: COL_WIDTH.location }}>
        <div className="stats-light" style={{ padding: 0, textAlign: 'left' }}>{r.venue_city || '—'}</div>
        {r.venue && <div className="athlete-profile-small" style={{ textAlign: 'left' }}>{r.venue}</div>}
      </td>
    </tr>
  )
}

// Date column sort toggle — same ChevronIcon-in-header pattern NBA/F1's own
// Date column uses; 'desc' (latest first) matches the backend's own
// ORDER BY match_date DESC (results.js).
function GamesTable({ games, statusByGameId, sortDir, onToggleSort }) {
  return (
    <div className={f1Styles.tableScroll}>
      <table className={`${f1Styles.table} ${f1Styles.fixedTable} table-thead-border`}>
        <thead>
          <tr>
            <th className="table-label" style={{ width: COL_WIDTH.dot }}></th>
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.date, whiteSpace: 'nowrap' }}>
              <button
                type="button"
                className={f1Styles.sortableHeader}
                onClick={onToggleSort}
                title={sortDir === 'asc' ? 'Earliest first — click for latest first' : 'Latest first — click for earliest first'}
              >
                Date <ChevronIcon open={sortDir === 'asc'} size={10} className={f1Styles.sortArrow} />
              </button>
            </th>
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.round }}>Group/Round</th>
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.teams }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 8 }}>
                <span style={{ justifySelf: 'start' }}>Team</span>
                <span style={{ textAlign: 'center' }}>vs</span>
                <span style={{ justifySelf: 'start' }}>Team</span>
              </div>
            </th>
            <th className="table-label" style={{ textAlign: 'left', width: COL_WIDTH.location }}>Location</th>
          </tr>
        </thead>
        <tbody>
          {games.map(r => <GameRow key={r.id} r={r} status={statusByGameId.get(r.id)} />)}
        </tbody>
      </table>
    </div>
  )
}

export default function FootballHomeKnockoutTemplate({ seasonId, competitionName, competitionSlug, year }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [teamFilter, setTeamFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [hostFilter, setHostFilter] = useState('')
  const [scopePill, setScopePill] = useState('')
  const [statusFilter, setStatusFilter] = useState(() => new Set())
  const [sortDir, setSortDir] = useState('desc')

  // Admin-configured subtitle line (rankks-admin's Subtitles page), same
  // 'Schedule' catalog key every other sport's Schedule tab uses, with a
  // computed fallback so the page never shows a blank subtitle before an
  // admin row exists for this edition (Mohamed 2026-08-25: "Add subtitle:
  // Full Schedule and Results - 2026").
  const SCHEDULE_SUBTITLE_FALLBACK = `Full Schedule and Results - ${year}`
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !year) return
    api.getSubtitle('football', competitionSlug, 'Schedule', null, year)
      .then(d => setPageSubtitle(d?.subtitle || SCHEDULE_SUBTITLE_FALLBACK))
      .catch(() => setPageSubtitle(SCHEDULE_SUBTITLE_FALLBACK))
  }, [competitionSlug, year]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    setLoading(true)
    api.getFootballHomeKnockout(seasonId)
      .then(d => { if (!cancelled) setRows(d?.rows || []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId])

  useEffect(() => { setTeamFilter(''); setGroupFilter(''); setLocationFilter(''); setHostFilter(''); setScopePill(''); setStatusFilter(new Set()) }, [seasonId])

  if (loading) return <div className={f1Styles.wrap}><Skeleton /></div>
  if (!rows?.length) return <div className={f1Styles.wrap}><Empty /></div>

  // Status is the same Past/Ongoing/Next/Future classification every other
  // list in this app uses (editions, GPs, sessions — see utils/eventStatus),
  // not a raw match result code (FT/AET/PEN) — those are a different
  // concern (final score, not scheduling status). Classified against the
  // FULL unfiltered list so "Next" always points at the true next fixture,
  // regardless of which filters are currently narrowing the table.
  // preDays: 0 — a football match is a single dated event, not a multi-day
  // weekend (see eventStatus.js's own comment; default 2 is tuned for
  // F1/MotoGP race weekends).
  const statusByGameId = new Map(
    classifyByDate(rows, r => r.match_date, { preDays: 0 }).map(({ item, status }) => [item.id, status])
  )

  // Faceted filters — each dropdown's own option list reflects every OTHER
  // active filter, never itself (same convention players_template.jsx's
  // positionCounts/clubCounts/countryCounts and nba_home_template.jsx's
  // typeOptions/teamAOptions use), so picking one filter narrows what the
  // others can offer instead of just silently returning zero rows.
  const matchesTeam = r => !teamFilter || r.home.name === teamFilter || r.away.name === teamFilter
  const matchesGroup = r => !groupFilter || r.round_label === groupFilter
  const matchesLocation = r => !locationFilter || r.venue_city === locationFilter
  const matchesHost = r => !hostFilter || r.host_country_name === hostFilter
  const matchesScope = r => !scopePill || r.tab_group === scopePill
  const matchesStatus = r => !statusFilter.size || statusFilter.has(statusByGameId.get(r.id))

  const teamOptions = [...new Set(
    rows.filter(r => matchesGroup(r) && matchesLocation(r) && matchesHost(r) && matchesScope(r) && matchesStatus(r))
      .flatMap(r => [r.home.name, r.away.name])
  )].sort()

  // Derived from the actual data, not hardcoded A-H — group COUNT varies by
  // format era (8 groups pre-2026, 12 groups for the 48-team 2026+
  // expansion).
  const groupOptions = [...new Set(
    rows.filter(r => r.tab_group === 'group_stages' && matchesTeam(r) && matchesLocation(r) && matchesHost(r) && matchesStatus(r))
      .map(r => r.round_label)
  )].sort()

  const locationCounts = rows
    .filter(r => matchesTeam(r) && matchesGroup(r) && matchesHost(r) && matchesScope(r) && matchesStatus(r))
    .reduce((acc, r) => { if (r.venue_city) acc[r.venue_city] = (acc[r.venue_city] || 0) + 1; return acc }, {})
  const locationOptions = Object.keys(locationCounts).sort()

  const hostCounts = rows
    .filter(r => matchesTeam(r) && matchesGroup(r) && matchesLocation(r) && matchesScope(r) && matchesStatus(r))
    .reduce((acc, r) => { if (r.host_country_name) acc[r.host_country_name] = (acc[r.host_country_name] || 0) + 1; return acc }, {})
  const hostOptions = Object.keys(hostCounts).sort()

  // Hosts filter — only shown for a multi-country edition (2026: USA/
  // Canada/Mexico). Computed from the FULL unfiltered row set (not the
  // faceted hostCounts above) so the whole filter doesn't disappear the
  // moment a selection narrows it down to a single remaining host — a
  // single-host edition (Qatar 2022, etc.) never shows it at all.
  const allHostOptions = [...new Set(rows.map(r => r.host_country_name).filter(Boolean))]
  const showHostsFilter = allHostOptions.length > 1

  const filtered = rows
    .filter(r => matchesTeam(r) && matchesGroup(r) && matchesLocation(r) && matchesHost(r) && matchesScope(r) && matchesStatus(r))
    .sort((a, b) => {
      const cmp = new Date(b.match_date) - new Date(a.match_date)
      return sortDir === 'desc' ? cmp : -cmp
    })

  const hasActiveFilter = !!(teamFilter || groupFilter || locationFilter || hostFilter || scopePill || statusFilter.size)
  const clearFilters = () => { setTeamFilter(''); setGroupFilter(''); setLocationFilter(''); setHostFilter(''); setScopePill(''); setStatusFilter(new Set()) }

  // Status pills only make sense when there's something other than Past to
  // filter for — a fully concluded edition (every row 'past', e.g. Qatar
  // 2022 today) hides the whole toggle rather than showing 4 pills where 3
  // of them would always return zero games. The classification itself
  // keeps running underneath regardless, so a mid-tournament edition (2026)
  // gets live pills automatically, no code change needed.
  const hasNonPastStatus = rows.some(r => {
    const s = statusByGameId.get(r.id)
    return s === 'ongoing' || s === 'next' || s === 'upcoming'
  })

  return (
    <div className={f1Styles.wrap}>
      {/* Breadcrumb (FootballHomeBlock, above this template) already shows
          Competition I Year I Schedule — admin-configured subtitle instead
          of a repeated title, same convention as Standings/Game/Scorers/
          Passers/Players/Teams. */}
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      <div className="filter-bar">
        <SearchableSelect
          value={teamFilter}
          onChange={setTeamFilter}
          options={teamOptions.map(name => ({ value: name, label: name }))}
          allLabel="All Teams"
        />
        <select className="filter-label" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
          <option value="">All Groups</option>
          {groupOptions.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="filter-label" value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
          <option value="">All Locations</option>
          {locationOptions.map(loc => <option key={loc} value={loc}>{loc} ({locationCounts[loc]})</option>)}
        </select>
        {showHostsFilter && (
          <select className="filter-label" value={hostFilter} onChange={e => setHostFilter(e.target.value)}>
            <option value="">All Hosts</option>
            {hostOptions.map(h => <option key={h} value={h}>{h} ({hostCounts[h] || 0})</option>)}
          </select>
        )}
        <div className={f1Styles.statusToggle}>
          <button
            type="button"
            className={`${f1Styles.statusBtn} ${scopePill === 'group_stages' ? f1Styles.statusBtnActive : ''}`}
            onClick={() => setScopePill(p => p === 'group_stages' ? '' : 'group_stages')}
          >
            Group Stages
          </button>
          <button
            type="button"
            className={`${f1Styles.statusBtn} ${scopePill === 'final_tour' ? f1Styles.statusBtnActive : ''}`}
            onClick={() => setScopePill(p => p === 'final_tour' ? '' : 'final_tour')}
          >
            Knockout
          </button>
        </div>
        {hasNonPastStatus && (
          <div className={f1Styles.statusToggle}>
            <button
              type="button"
              className={`${f1Styles.statusBtn} ${statusFilter.size === 0 ? f1Styles.statusBtnActive : ''}`}
              onClick={() => setStatusFilter(new Set())}
            >
              All
            </button>
            {STATUS_ORDER.map(s => (
              <button
                key={s}
                type="button"
                className={`${f1Styles.statusBtn} ${f1Styles[`statusBtn_${s}`]} ${statusFilter.has(s) ? f1Styles.statusBtnActive : ''}`}
                onClick={() => setStatusFilter(prev => {
                  const next = new Set(prev)
                  next.has(s) ? next.delete(s) : next.add(s)
                  return next
                })}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        {hasActiveFilter && (
          <button className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{filtered.length} games</span>
      </div>

      <GamesTable games={filtered} statusByGameId={statusByGameId} sortDir={sortDir} onToggleSort={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} />
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
