// templates/teams/football_champion_history_knockout_template.jsx
// Football's Champion History for a KNOCKOUT-final competition (World Cup,
// and any future quadrennial/biennial competition with the same Final Tour
// shape — selected in registry.js by competition_type, not a World-Cup-
// specific switch). Sibling to football_champion_history_template.jsx
// (standings-based, for domestic leagues) — that one doesn't apply here,
// since a knockout tournament has no league table to read Champion/
// Runner-Up off of.
//
// Backed by /results/champion-history-football-knockout/:seasonId — same
// "through <year>" cutoff every other All-Time page uses (that route
// resolves competition_id + the browsed season's own year, keeps only
// year <= that cutoff), so a scheduled-but-not-yet-played edition (2030/
// 2034 today) never appears while browsing any real past/current edition.
//
// WINNER/RUNNER-UP/THIRD — derived from the Final Tour's own games
// (round='final' winner/loser, round='3rd-place' winner), not standings.
// An edition whose Final Tour wasn't shaped this way (1930 had no
// 3rd-place match; 1950 was decided by a round-robin group, not a single
// Final) comes back with those fields null — shown as "—", same "don't
// fabricate a result" rule as HomeTennisTemplate.
//
// FULL RESULTS — slide-in drawer (FootballResultsDrawer) showing the whole
// Final Tour bracket for that edition, same mechanism as HomeTennisTemplate/
// HomeF1Template use for their own Home tables.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import FootballResultsDrawer from '../../shared/FootballResultsDrawer'
import SearchableSelect from '../../shared/SearchableSelect'
import { getStatus } from '../../EventBlock/EventBlock'
import { fmtDateRange } from '../../../utils/calcAge'
import f1Styles from '../f1/f1.module.css'

function fmtEditionSchedule(row) {
  if (row.start_date && row.end_date) return fmtDateRange(row.start_date, row.end_date)
  if (row.start_date) {
    const d = new Date(row.start_date)
    if (isNaN(d)) return '—'
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  }
  return '—'
}

// suffix (already-formatted, e.g. " (4)" for Winner's Nth-title or " - 10
// goals" for Top Scorer) is appended INSIDE the same text node as the
// name — not a separate flex sibling — so it sits on the exact same
// baseline as the country/player name (2026-08-12: "align (3) with
// winning country name" — a sibling span with a different font-size
// visually drifted even under align-items:center).
// highlighted (optional, e.g. Top Scorer) — an explicit override for when
// the row's matched country isn't the same string as this cell's own name
// (a scorer is a PLAYER; the country that should highlight them is
// team.country_name, not team.canonical_name — 2026-08-12: "on search
// country, highlight also top scorer name"). Winner/Runner-up/Third keep
// their existing self-name comparison via `highlight`.
function TeamCell({ team, highlight, suffix, highlighted }) {
  if (!team) return '—'
  const isHighlighted = highlighted || (!!highlight && team.canonical_name === highlight)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
      <Flag iso2={team.iso2} name={team.canonical_name} className="flag" />
      <span className={isHighlighted ? f1Styles.sortRowsHighlight : undefined}>
        {team.canonical_name}
        {suffix && <span className="athlete-profile-small">{suffix}</span>}
      </span>
    </span>
  )
}

export default function FootballChampionHistoryKnockoutTemplate({ seasonId, competitionName, competitionSlug, year }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [teamFilter, setTeamFilter] = useState('')

  useEffect(() => {
    if (!seasonId) return
    let cancelled = false
    setLoading(true)
    api.getFootballChampionHistoryKnockout(seasonId)
      .then(d => { if (!cancelled) setRows(d?.rows || []) })
      .catch(() => { if (!cancelled) setRows([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [seasonId])

  useEffect(() => { setTeamFilter('') }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Page Subtitles page,
  // sport 'football', page_key 'football-totals-champions') — same
  // "{subtitle_text} {year}" pattern tennis/F1's own Totals pages use. No
  // separate page-title heading here (2026-08-13) — EventBlock's own
  // all-time banner already renders the full breadcrumb (Competition I
  // Year I Champion History) inside its own block, so a second "CHAMPION
  // HISTORY" heading here would just repeat it (same fix already applied
  // to Team Stats).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !year) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Champions', year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [competitionSlug, year])

  if (loading) return <div className={f1Styles.wrap}><Skeleton /></div>
  if (!rows?.length) return <div className={f1Styles.wrap}><Empty /></div>

  // Latest edition first.
  const sorted = [...rows].sort((a, b) => b.year - a.year)

  const teamOptions = [...new Set(sorted.flatMap(r => [
    r.winner?.canonical_name, r.runner_up?.canonical_name, r.third?.canonical_name,
  ].filter(Boolean)))].sort()

  const filtered = sorted.filter(r => {
    if (teamFilter && ![r.winner?.canonical_name, r.runner_up?.canonical_name, r.third?.canonical_name].includes(teamFilter)) return false
    return true
  })

  const hasActiveFilter = teamFilter
  const clearFilters = () => { setTeamFilter('') }

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
        {hasActiveFilter && (
          <button className="filter-reset" onClick={clearFilters}>Clear</button>
        )}
        <span className="filter-total">{filtered.length} editions</span>
      </div>

      <div className={f1Styles.tableScroll}>
        <table className={`${f1Styles.table} ${f1Styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              <th className="table-label" style={{ textAlign: 'left', width: '12%', whiteSpace: 'nowrap' }}>Date</th>
              <th className="table-label" style={{ textAlign: 'left', width: '20%' }}>Event</th>
              <th className="table-label" style={{ textAlign: 'left', width: '14%' }}>Winner</th>
              <th className="table-label" style={{ textAlign: 'left', width: '14%' }}>Runner-up</th>
              <th className="table-label" style={{ textAlign: 'left', width: '14%' }}>Third</th>
              <th className="table-label" style={{ textAlign: 'left', width: '18%' }}>Top Scorer</th>
              <th className="table-label" style={{ textAlign: 'right', width: '8%' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.season_id} className={`table-row ${f1Styles.homeRow}`} style={{ animationDelay: `${i * 0.03}s` }}>
                <td className="stats-light" style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                  <div className="athlete-name">{r.year}</div>
                  <div className="athlete-profile-small">{fmtEditionSchedule(r)}</div>
                </td>
                <td className="stats-light" style={{ textAlign: 'left' }}>
                  {/* .athlete-name is white-space:nowrap by default (fine for
                      a single host country) — co-hosted editions (up to 6
                      countries for 2030) need to wrap instead of overflowing
                      past this cell into Winner's flag/name (2026-08-12). */}
                  <div className="athlete-name" style={{ whiteSpace: 'normal' }}>{r.host_countries?.length ? r.host_countries.join(' I ') : competitionName}</div>
                  <div className="athlete-profile-small">Edition {r.edition}</div>
                </td>
                <td className="stats-light" style={{ textAlign: 'left' }}><TeamCell team={r.winner} highlight={teamFilter} suffix={r.winner?.title_no != null ? ` (${r.winner.title_no})` : ''} /></td>
                <td className="stats-light" style={{ textAlign: 'left' }}><TeamCell team={r.runner_up} highlight={teamFilter} /></td>
                <td className="stats-light" style={{ textAlign: 'left' }}><TeamCell team={r.third} highlight={teamFilter} /></td>
                <td className="stats-light" style={{ textAlign: 'left' }}><TeamCell team={r.top_scorer} suffix={r.top_scorer?.goals != null ? ` - ${r.top_scorer.goals} goals` : ''} highlighted={!!teamFilter && r.top_scorer?.country_name === teamFilter} /></td>
                <td style={{ textAlign: 'right' }}>
                  <FootballResultsDrawer
                    seasonId={r.season_id}
                    tabGroup="final_tour"
                    competitionName={competitionName}
                    year={r.year}
                    status={getStatus(r)}
                    startDate={r.start_date}
                    endDate={r.end_date}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(6)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No edition data available.</div>
}
