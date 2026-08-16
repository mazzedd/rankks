// templates/home/football_home_knockout_template.jsx
// "Home of <competition>" content for a KNOCKOUT-final competition (World
// Cup, and any future quadrennial/biennial one with the same shape) — the
// full match schedule for the ONE browsed edition, rendered below
// FootballHomeBlock's banner in home_template.jsx. Distinct from
// All-Time > Champion History (that's the cross-edition winners table) —
// this is a single-season schedule/results list (2026-08-13 spec).
//
// Backed by /results/home-football-knockout/:seasonId — no "through <year>"
// cutoff (unlike every other football-knockout route in this file): Home
// is about THIS season only, not career totals.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import SearchableSelect from '../../shared/SearchableSelect'
import MatchVideo from '../../shared/MatchVideo'
import { fmtDate } from '../../../utils/calcAge'
import { classifyByDate } from '../../../utils/eventStatus'
import { StatusBadge } from '../../EventBlock/EventBlock'
import f1Styles from '../f1/f1.module.css'

// "H I A" — same " I " separator convention as every other stat pairing in
// this app (Team Stats' W I D I L, GF I GA, etc.) — null (not "0 I 0")
// before the match has a real score, so an unplayed fixture shows "vs"
// instead of a fabricated 0-0. Penalty score is its own second line, not
// appended inline (2026-08-13: "use line 2 for penalties, centered
// align"), formatted "(4I3)" — no spaces, no "pens" (2026-08-13: "turn 4 I
// 3 pens to (4I3)").
function scoreParts(score) {
  if (score?.home == null || score?.away == null) return null
  const main = `${score.home} I ${score.away}`
  const penalty = (score.penalty && (score.penalty.home != null || score.penalty.away != null))
    ? `(${score.penalty.home}I${score.penalty.away})`
    : null
  return { main, penalty }
}

export default function FootballHomeKnockoutTemplate({ seasonId, competitionName, competitionSlug, year }) {
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [teamFilter, setTeamFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')
  const [hostFilter, setHostFilter] = useState('')
  const [scopePill, setScopePill] = useState('')

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !year) return
    api.getSubtitle('football', competitionSlug, 'Calendar', null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [competitionSlug, year])

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

  useEffect(() => { setTeamFilter(''); setGroupFilter(''); setLocationFilter(''); setHostFilter(''); setScopePill('') }, [seasonId])

  if (loading) return <div className={f1Styles.wrap}><Skeleton /></div>
  if (!rows?.length) return <div className={f1Styles.wrap}><Empty /></div>

  // Status is the same Past/Ongoing/Next/Future classification every other
  // list in this app uses (editions, GPs, sessions — see utils/eventStatus,
  // 2026-08-13: "Status: is about ONGOING, PAST, FUTURE AND NEXT"), not a
  // raw match result code (FT/AET/PEN) — those are a different concern
  // (final score, not scheduling status). Classified against the FULL
  // unfiltered list so "Next" always points at the true next fixture,
  // regardless of which filters are currently narrowing the table.
  const statusByGameId = new Map(
    classifyByDate(rows, r => r.match_date).map(({ item, status }) => [item.id, status])
  )

  const teamOptions = [...new Set(rows.flatMap(r => [r.home.name, r.away.name]))].sort()
  // Derived from the actual data, not hardcoded A-H — group COUNT varies
  // by format era (8 groups pre-2026, 12 groups for the 48-team 2026+
  // expansion), confirmed live 2026-08-13 (2026 has Groups A-L).
  const groupOptions = [...new Set(rows.filter(r => r.tab_group === 'group_stages').map(r => r.round_label))].sort()

  const locationCounts = rows.reduce((acc, r) => {
    if (r.venue_city) acc[r.venue_city] = (acc[r.venue_city] || 0) + 1
    return acc
  }, {})
  const locationOptions = Object.keys(locationCounts).sort()

  // Hosts filter (2026-08-13) — only shown for a multi-country edition
  // (2026: USA/Canada/Mexico). A single-host edition (Qatar 2022, etc.)
  // has exactly one distinct host_country_name across every game, so the
  // filter would be pointless there — "feat only for events where hosting
  // is more than one country".
  const hostCounts = rows.reduce((acc, r) => {
    if (r.host_country_name) acc[r.host_country_name] = (acc[r.host_country_name] || 0) + 1
    return acc
  }, {})
  const hostOptions = Object.keys(hostCounts).sort()
  const showHostsFilter = hostOptions.length > 1

  const filtered = rows.filter(r => {
    if (teamFilter && r.home.name !== teamFilter && r.away.name !== teamFilter) return false
    if (groupFilter && r.round_label !== groupFilter) return false
    if (locationFilter && r.venue_city !== locationFilter) return false
    if (hostFilter && r.host_country_name !== hostFilter) return false
    if (scopePill && r.tab_group !== scopePill) return false
    return true
  })

  const hasActiveFilter = teamFilter || groupFilter || locationFilter || hostFilter || scopePill
  const clearFilters = () => { setTeamFilter(''); setGroupFilter(''); setLocationFilter(''); setHostFilter(''); setScopePill('') }

  return (
    <div className={f1Styles.wrap}>
      {/* Breadcrumb (FootballHomeBlock, above this template) already shows
          Competition I Year I Home — admin-configured subtitle instead of
          a repeated title, same convention as Standings/Game/Scorers/
          Passers/Players/Teams (2026-08-14). */}
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
            {hostOptions.map(h => <option key={h} value={h}>{h} ({hostCounts[h]})</option>)}
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
              <th className="table-label" style={{ textAlign: 'left', width: '12%' }}>Group/Round</th>
              <th className="table-label" style={{ textAlign: 'left', width: '32%' }}>
                {/* Same 3-column grid as the body's Team vs Team cell —
                    Team / vs / Team, not one spanning "Team vs Team" label
                    (2026-08-13). Middle column is a FIXED px width (not
                    "auto") — auto sizes independently per <div>, and every
                    row's div is its own independent grid, so an "auto"
                    score column drifted a different width row to row
                    (wider on penalty rows) and threw both team columns out
                    of alignment with each other (2026-08-13: "what's this
                    gap? fix align properly"). A fixed width is the only
                    way to keep the same column boundary on every row. */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', gap: 8 }}>
                  <span style={{ justifySelf: 'start' }}>Team</span>
                  <span style={{ textAlign: 'center' }}>vs</span>
                  <span style={{ justifySelf: 'start' }}>Team</span>
                </div>
              </th>
              <th className="table-label" style={{ textAlign: 'left', width: '20%' }}>Location</th>
              <th className="table-label" style={{ textAlign: 'center', width: '11%' }}>Status</th>
              <th className="table-label" style={{ textAlign: 'center', width: '11%' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const status = statusByGameId.get(r.id)
              const sp = scoreParts(r.score)
              // Winner bold, loser normal, draw both normal (2026-08-13:
              // "winner CSS strong, looser NORMAL. Draw NORMAL") — driven by
              // the games table's own home_won column (true/false/null),
              // not re-derived from the score (safer for AET/PEN games
              // where the raw score can still read level pre-shootout).
              const homeStrong = r.home_won === true
              const awayStrong = r.home_won === false
              return (
                <tr key={r.id} className={`table-row ${f1Styles.homeRow}`} style={{ animationDelay: `${i * 0.03}s`, verticalAlign: 'top' }}>
                  <td className="stats-light" style={{ textAlign: 'left' }}>{fmtDate(r.match_date)}</td>
                  <td className="stats-light" style={{ textAlign: 'left' }}>{r.round_label}</td>
                  <td style={{ textAlign: 'left' }}>
                    {/* Fixed 3-column grid (Team 1 / Score / Team 2), same
                        width every row since the table itself is
                        table-layout:fixed — that's what keeps the score
                        centered and both team blocks aligned to the same
                        horizontal position row to row, regardless of name
                        length (2026-08-13: "align content horizontally...
                        Score must always be aligned center"). Flag always
                        precedes the name on BOTH sides — no mirroring.
                        Name is nowrap and the flag is flex-shrink:0
                        (2026-08-13: "countries are neither aligned left
                        neither aligned top") — a long name like "Cape Verde
                        Islands" wrapping to 2 lines broke both: the flag
                        stopped sitting at the same top edge as the row (it
                        centers against the wrapped block's full height) and
                        the wrapped second line lost its left edge. Table
                        scrolls horizontally (.tableScroll) so a long name
                        just extends the row instead of wrapping. */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr', alignItems: 'start', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'start', minWidth: 0 }}>
                        <span style={{ flexShrink: 0 }}><Flag iso2={r.home.iso2} name={r.home.name} className="flag" /></span>
                        {/* .stats-light carries a 10px/12px padding meant
                            for table-cell/stat-block usage — using it here
                            as a plain "normal weight" text utility inflated
                            the loser's name to 41px tall (10+10 padding on
                            top of a ~21px line) while the winner's
                            .athlete-name (no padding) stayed 21px, throwing
                            every column after it out of alignment whenever
                            the loser happened to be on the LEFT/home side
                            (2026-08-13, finally root-caused after "wait").
                            Fix: always .athlete-name (right font/size/
                            nowrap), weight toggled inline instead. */}
                        <span className="athlete-name" style={{ whiteSpace: 'nowrap', fontWeight: homeStrong ? 600 : 400 }}>{r.home.name}</span>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div className="stats-light" style={{ padding: 0 }}>{sp ? sp.main : 'vs'}</div>
                        {sp?.penalty && <div className="athlete-profile-small">{sp.penalty}</div>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifySelf: 'start', minWidth: 0 }}>
                        <span style={{ flexShrink: 0 }}><Flag iso2={r.away.iso2} name={r.away.name} className="flag" /></span>
                        <span className="athlete-name" style={{ whiteSpace: 'nowrap', fontWeight: awayStrong ? 600 : 400 }}>{r.away.name}</span>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    {/* .stats-light also forces text-align:center (same
                        class that caused the height bug above) — explicit
                        textAlign:left here so the city lines up with the
                        stadium sub-line under it, both flush left
                        (2026-08-13: "align Location with stadium name
                        left"). */}
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
