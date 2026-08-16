// templates/teams/football_teams_all_time_knockout_template.jsx
// Team Stats for a KNOCKOUT-final competition (World Cup, and any future
// quadrennial/biennial one with the same Final Tour/Group Stages shape —
// selected in registry.js by competition_type). Sibling to
// football_teams_all_time_template.jsx (standings-based, for domestic
// leagues) — that one returns zero rows for the World Cup (no plain
// 'standings' tab exists), so this reads Participations/Titles/Finals/
// Runner-up/3rd/4th and Games Played/W/D/L/GF/GA straight from `games`.
//
// Backed by /results/teams-all-time-football-knockout/:seasonId — same
// "through <year>" cutoff every other All-Time page uses. 4th place is the
// LOSER of the 3rd-place match (2026-08-12: "Add column 3rd/4th").
//
// GROUP STAGES / KNOCKOUT pill — 1934 and 1938 were pure knockouts (no
// group stage ever existed, not a data gap), so a team whose only World
// Cup history is those two years shows "—" for Group Stages stats. Titles/
// Finals/Participations/Runner-up/3rd/4th are unaffected by this toggle —
// those are tournament outcomes, not derived from either game scope.
//
// DEFAULT SORT — Titles, then Runner-up (2nd), then 3rd, then 4th, then
// Participations (2026-08-12) — already the order the backend returns
// rows in. Picking a single "Sort by" stat re-sorts by that stat, but ties
// still fall back to this SAME cascade (defaultCompare), not alphabetical
// — "assign default sort when using sorting options".
//
// WEIGHT — Team name and Titles are the only STRONG (bold, .athlete-name)
// cells; every other stat is NORMAL weight (.stats-light) — explicit
// design call (2026-08-12), not the "everything bold" look other All-Time
// tables use.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import SearchableSelect from '../../shared/SearchableSelect'
import f1Styles from '../f1/f1.module.css'

const SORT_OPTIONS = [
  { key: 'finals', label: 'Finals' },
  { key: 'titles', label: 'Titles' },
  { key: 'participations', label: 'Participations' },
  { key: 'runner_up', label: 'Runner-up' },
  { key: 'third', label: '3rd' },
  { key: 'fourth', label: '4th' },
  { key: 'best_perf', label: 'Best Perf.' },
  { key: 'games_played', label: 'Played' },
  { key: 'won', label: 'Won' },
  { key: 'drawn', label: 'Drawn' },
  { key: 'lost', label: 'Lost' },
  { key: 'gf', label: 'GF' },
  { key: 'ga', label: 'GA' },
]

// Best Perf. is a round label, not a number — rank rounds by how deep they
// go (Champion is deepest, GS is shallowest) so "Sort by: Best Perf." puts
// the best runs first, same as every other stat column (highest sortValue
// first). 'W' (won the final) ranks above 'F' (reached it, never won) even
// though both are the Final round — order matches results.js's TIER_LABEL
// plus the W/F split applied on top of tier 1 (2026-08-13). '3rd' removed:
// reaching the 3rd-place match is relabeled 'SF' now (Morocco finished 4th
// in 2026 — labeling that "3rd" was wrong).
const BEST_PERF_ORDER = { W: 1, F: 2, SF: 3, QF: 4, R16: 5, R32: 6, R64: 7, GS: 8 }

// Default view (scopePill === '', neither pill active) shows ONE
// aggregated number — Group Stages + Knockout summed together — not the
// two scopes stacked as separate lines (2026-08-12: "dont display GS and
// KO [separately]: want u to aggregate stats"). Picking a pill narrows
// down to that scope's own real numbers instead of the aggregate.
function aggregateScope(row) {
  const gs = row.group_stages
  const ko = row.knockout
  if (!gs && !ko) return null
  return {
    games_played: (gs?.games_played || 0) + (ko?.games_played || 0),
    won: (gs?.won || 0) + (ko?.won || 0),
    drawn: (gs?.drawn || 0) + (ko?.drawn || 0),
    lost: (gs?.lost || 0) + (ko?.lost || 0),
    gf: (gs?.gf || 0) + (ko?.gf || 0),
    ga: (gs?.ga || 0) + (ko?.ga || 0),
  }
}

function scopeValue(row, scope, field) {
  const s = scope ? row[scope] : aggregateScope(row)
  return s ? s[field] : -1
}

function sortValue(row, sortKey, scope) {
  switch (sortKey) {
    case 'finals': return row.finals
    case 'titles': return row.titles
    case 'participations': return row.participations
    case 'runner_up': return row.runner_up
    case 'third': return row.third
    case 'fourth': return row.fourth
    case 'best_perf': return row.best_perf ? -(BEST_PERF_ORDER[row.best_perf.round] ?? 99) : -100
    case 'games_played': return scopeValue(row, scope, 'games_played') ?? -1
    case 'won': return scopeValue(row, scope, 'won') ?? -1
    case 'drawn': return scopeValue(row, scope, 'drawn') ?? -1
    case 'lost': return scopeValue(row, scope, 'lost') ?? -1
    case 'gf': return scopeValue(row, scope, 'gf') ?? -1
    case 'ga': return scopeValue(row, scope, 'ga') ?? -1
    default: return 0
  }
}

// Same cascade the backend pre-sorts rows by (Titles, Runner-up, 3rd,
// 4th, Participations, name) — used as the tie-break whenever "Sort by"
// picks a single stat, so ties don't fall back to plain alphabetical.
function defaultCompare(a, b) {
  return b.titles - a.titles
    || b.runner_up - a.runner_up
    || b.third - a.third
    || b.fourth - a.fourth
    || b.participations - a.participations
    || a.canonical_name.localeCompare(b.canonical_name)
}

export default function FootballTeamsAllTimeKnockoutTemplate({ seasonId, competitionSlug, year }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  // '' = neither pill active — the default, showing Group Stages AND
  // Knockout stats together (2026-08-12: "by default display stats: Group
  // Stages + Knockout"). Clicking a pill narrows to just that one scope;
  // clicking the already-active pill again returns to the combined
  // default (same toggle-off convention as every other status pill in
  // this codebase).
  const [scopePill, setScopePill] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [confedFilter, setConfedFilter] = useState('')
  const [sortBy, setSortBy] = useState('')

  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    setLoading(true)
    api.getFootballTeamsAllTimeKnockout(seasonId)
      .then(d => { if (!cancelled) setRows(d?.rows || []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId])

  useEffect(() => { setTeamFilter(''); setConfedFilter(''); setSortBy('') }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !year) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Teams', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [competitionSlug, year])

  if (loading) return <div className={f1Styles.wrap}><Skeleton /></div>
  if (!rows?.length) return <div className={f1Styles.wrap}><Empty /></div>

  const teamOptions = [...new Set(rows.map(r => r.canonical_name))].sort()
  // "All Confederations" dropdown shows how many teams are in each — AFC
  // (10), UEFA (23) etc. (2026-08-12) — counted off the full unfiltered
  // rows so the numbers stay stable regardless of the current filter.
  const confedCounts = rows.reduce((acc, r) => {
    if (r.confederation) acc[r.confederation] = (acc[r.confederation] || 0) + 1
    return acc
  }, {})
  const confedOptions = Object.keys(confedCounts).sort()

  const filtered = rows.filter(r => {
    if (teamFilter && r.canonical_name !== teamFilter) return false
    if (confedFilter && r.confederation !== confedFilter) return false
    return true
  })

  // No sortBy: rows already arrive from the backend in the default
  // cascade, filtering preserves that order — no client re-sort needed.
  const sorted = sortBy
    ? [...filtered].sort((a, b) => sortValue(b, sortBy, scopePill) - sortValue(a, sortBy, scopePill) || defaultCompare(a, b))
    : filtered

  const hasActiveFilter = teamFilter || confedFilter || sortBy
  const clearFilters = () => { setTeamFilter(''); setConfedFilter(''); setSortBy('') }

  // Column highlight (2026-08-12: "dont forget about the grey highlight
  // feat on sorting options") — same global .sortRowsHighlight class
  // players_template.jsx uses to flag the currently-sorted column, header
  // and every cell in that column. Won/Drawn/Lost share one combined
  // column, so any of the three sort keys highlights it.
  const hi = (...keys) => keys.includes(sortBy) ? 'sortRowsHighlight' : ''

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
        <select className="filter-label" value={confedFilter} onChange={e => setConfedFilter(e.target.value)}>
          <option value="">All Confederations</option>
          {confedOptions.map(c => <option key={c} value={c}>{c} ({confedCounts[c]})</option>)}
        </select>
        <select className="filter-label" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
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
            className={`${f1Styles.statusBtn} ${scopePill === 'knockout' ? f1Styles.statusBtnActive : ''}`}
            onClick={() => setScopePill(p => p === 'knockout' ? '' : 'knockout')}
          >
            Knockout
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{sorted.length} teams</span>
      </div>

      <div className={f1Styles.tableScroll}>
        <table className={`${f1Styles.table} ${f1Styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              <th className="table-label" style={{ textAlign: 'center', width: '5%' }}>Rank</th>
              <th className="table-label" style={{ textAlign: 'left', width: '15%' }}>Team</th>
              <th className={`table-label ${hi('participations')}`} style={{ textAlign: 'center', width: '8%' }}>Part.</th>
              <th className={`table-label ${hi('finals')}`} style={{ textAlign: 'center', width: '7%' }}>Finals</th>
              <th className={`table-label ${hi('titles')}`} style={{ textAlign: 'center', width: '7%' }}>Titles</th>
              <th className={`table-label ${hi('runner_up')}`} style={{ textAlign: 'center', width: '8%' }}>Runner-up</th>
              <th className={`table-label ${hi('third', 'fourth')}`} style={{ textAlign: 'center', width: '8%' }}>3rd I 4th</th>
              <th className={`table-label ${hi('games_played')}`} style={{ textAlign: 'center', width: '8%' }}>Played</th>
              <th className={`table-label ${hi('best_perf')}`} style={{ textAlign: 'center', width: '9%' }}>Best Perf.</th>
              <th className={`table-label ${hi('won', 'drawn', 'lost')}`} style={{ textAlign: 'center', width: '12%' }}>W I D I L</th>
              <th className={`table-label ${hi('gf', 'ga')}`} style={{ textAlign: 'center', width: '13%' }}>GF I GA</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const scope = scopePill ? r[scopePill] : aggregateScope(r)
              const winPct = scope && scope.games_played ? Math.round((scope.won / scope.games_played) * 100) : null
              const titlesPct = r.finals ? Math.round((r.titles / r.finals) * 100) : null
              const runnerUpPct = r.finals ? Math.round((r.runner_up / r.finals) * 100) : null
              return (
                <tr key={r.entity_id} className={`table-row ${f1Styles.homeRow}`} style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className="stats-light" style={{ textAlign: 'center' }}>{i + 1}</td>
                  <td style={{ textAlign: 'left' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <Flag iso2={r.iso2} name={r.canonical_name} className="flag" />
                      <span className="athlete-name">{r.canonical_name}</span>
                    </div>
                    {r.former_names && <div className="athlete-profile-small" style={{ marginLeft: 20 }}>Former: {r.former_names}</div>}
                  </td>
                  <td className={`stats-light ${hi('participations')}`} style={{ textAlign: 'center' }}>
                    <div className="stats-light" style={{ padding: 0 }}>{r.participations}</div>
                    {r.first_year != null && (
                      <div className="athlete-profile-small">
                        {r.first_year === r.last_year ? r.first_year : `${r.first_year}-${r.last_year}`}
                      </div>
                    )}
                  </td>
                  <td className={`stats-light ${hi('finals')}`} style={{ textAlign: 'center' }}>{r.finals}</td>
                  <td className={hi('titles')} style={{ textAlign: 'center' }}>
                    <span className="athlete-name">{r.titles}</span>
                    {titlesPct != null && <div className="athlete-profile-small">{titlesPct}%</div>}
                  </td>
                  <td className={`stats-light ${hi('runner_up')}`} style={{ textAlign: 'center' }}>
                    {r.runner_up}
                    {runnerUpPct != null && <div className="athlete-profile-small">{runnerUpPct}%</div>}
                  </td>
                  <td className={`stats-light ${hi('third', 'fourth')}`} style={{ textAlign: 'center' }}>{r.third} I {r.fourth}</td>
                  <td className={`stats-light ${hi('games_played')}`} style={{ textAlign: 'center' }}>{scope ? scope.games_played : '—'}</td>
                  <td className={`stats-light ${hi('best_perf')}`} style={{ textAlign: 'center' }}>{r.best_perf ? `${r.best_perf.round} (${r.best_perf.times})` : '—'}</td>
                  <td className={hi('won', 'drawn', 'lost')} style={{ textAlign: 'center' }}>
                    {scope ? (
                      <>
                        <div className="stats-light" style={{ padding: 0 }}>{scope.won} I {scope.drawn} I {scope.lost}</div>
                        <div className="athlete-profile-small">{winPct}% won</div>
                      </>
                    ) : '—'}
                  </td>
                  <td className={`stats-light ${hi('gf', 'ga')}`} style={{ textAlign: 'center' }}>{scope ? `${scope.gf} I ${scope.ga}` : '—'}</td>
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
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No team data available.</div>
}
