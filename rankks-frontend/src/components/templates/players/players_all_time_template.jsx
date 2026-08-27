import { useEffect, useMemo, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import DeceasedMark from '../../shared/DeceasedMark'
import SearchableSelect from '../../shared/SearchableSelect'
import { basketballSubtitleParams } from '../../../utils/basketballSubtitleMap'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import styles from './players_template.module.css'

const PAGE_SIZE = 25

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']

// Box-score columns after NBA Finals/Titles, MVP and GP (W/L) — same
// stat-stack shape as the Regular Season Players page. Pts/Ast, Reb/Blk
// and Stl/To use subKeyRaw (plain number stacked beneath). FGA/M, 3PA/M
// and FTA/M use comboKey — main line combines two raw numbers
// ("attempts/made"), % still stacks beneath via subKey.
const COLS = [
  { key: 'minutes',   label: 'Mins' },
  { key: 'points',    label: 'Pts', labelSub: 'Ast', bold: true, subKeyRaw: 'assists' },
  { key: 'fgm',       label: 'FGA/M', labelSub: 'FG%', comboKey: 'fga', subKey: 'fg_pct' },
  { key: 'tpm',       label: '3PA/M', labelSub: '3P%', comboKey: 'tpa', subKey: 'tp_pct' },
  { key: 'ftm',       label: 'FTA/M', labelSub: 'FT%', comboKey: 'fta', subKey: 'ft_pct' },
  { key: 'rebounds',  label: 'Reb', labelSub: 'Blk', subKeyRaw: 'blocks' },
  { key: 'steals',    label: 'Stl/To', subKeyRaw: 'turnovers' },
]

// "Sort by" — every field shown on the page is sortable, always descending.
// Grouped into <optgroup>s (fixed order given by product, not alphabetical
// like the flat list this replaced — FGA before FGM before FG% reads as a
// deliberate progression, not a list to re-sort).
const SORT_GROUPS = [
  {
    label: 'Games',
    options: [
      { key: 'games_played', label: 'Games Played' },
      { key: 'minutes',       label: 'Minutes' },
    ],
  },
  {
    label: 'Shots',
    options: [
      { key: 'fga',    label: 'FGA' },
      { key: 'fgm',    label: 'FGM' },
      { key: 'fg_pct', label: 'FG%' },
      { key: 'tpa',    label: '3PA' },
      { key: 'tpm',    label: '3PM' },
      { key: 'tp_pct', label: '3P%' },
      { key: 'fta',    label: 'FTA' },
      { key: 'ftm',    label: 'FTM' },
      { key: 'ft_pct', label: 'FT%' },
    ],
  },
  {
    label: 'Others',
    options: [
      { key: 'assists',   label: 'Assists' },
      { key: 'blocks',    label: 'Blocks' },
      { key: 'steals',    label: 'Steals' },
      { key: 'turnovers', label: 'Turnovers' },
    ],
  },
  {
    label: 'Titles',
    options: [
      { key: 'nba_titles',     label: 'NBA Champ' },
      { key: 'nba_finals',     label: 'NBA Finals' },
      { key: 'nba_cup_titles', label: 'NBA Cup' },
      { key: 'nba_cup_finals', label: 'NBA Cup Finals' },
    ],
  },
]

const MODE_INDEPENDENT_KEYS = new Set(['fg_pct', 'tp_pct', 'ft_pct'])
// Fields that never change with the Per Game / Total toggle — career meta
// stats (Finals, titles, Cup Finals, Cup titles, GP/W/L), not season-averaged box-score stats.
const TOGGLE_INDEPENDENT_KEYS = new Set(['nba_finals', 'nba_titles', 'nba_cup_finals', 'nba_cup_titles', 'games_played', 'wins', 'losses'])

function getValue(player, key, statMode) {
  if (TOGGLE_INDEPENDENT_KEYS.has(key)) return player[key]
  if (statMode === 'total' && !MODE_INDEPENDENT_KEYS.has(key)) {
    const totalVal = player.stats?.totals?.[key]
    if (totalVal != null) return totalVal
  }
  return player.stats?.[key] ?? '—'
}

function formatPct(value) {
  const n = Number(value)
  if (value == null || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function resolveImageUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  if (url.startsWith('media/')) return `/${url}`
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

function getName(p) { return (p.display_name || p.canonical_name || '').toLowerCase() }

// The cross only makes sense once the "through <year>" context is past the
// death itself — viewing "through 1993" for a player who died in 1994
// shouldn't mark him deceased yet. Shows starting the year AFTER death
// (death year + 1), same rule as F1's All-Time templates.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

// All-time career stats "through <year>" (BASK-NAV-01's Players All-Time
// page) — cumulative NBA Finals/Titles/MVPs/GP(W-L) plus box-score career
// per-game or total figures, scoped to Regular Season or Playoffs.
export default function PlayersAllTimeTemplate({ seasonId, tabKey, activeEvent, isPast, endDate }) {
  const { activeYear } = useAppStore()

  // Admin-configured subtitle line (rankks-admin's Subtitles page).
  const [basketballSubtitle, setBasketballSubtitle] = useState(null)
  useEffect(() => {
    const p = basketballSubtitleParams(activeEvent, tabKey, activeYear, isPast)
    if (!p) { setBasketballSubtitle(null); return }
    api.getSubtitle('basketball', null, p.itemA, p.itemB, p.year, p.isPast)
      .then(d => setBasketballSubtitle(d?.subtitle || null))
      .catch(() => setBasketballSubtitle(null))
  }, [activeEvent, tabKey, activeYear, isPast])

  const [allPlayers, setAllPlayers] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [position, setPosition]     = useState('')
  const [country, setCountry]       = useState('')
  const [seasonType, setSeasonType] = useState('regular')
  const [sortStat, setSortStat]     = useState('')
  const [statMode, setStatMode]     = useState('per_game')
  const [activity, setActivity]     = useState('') // '' | 'active' | 'retired'
  const [page, setPage]             = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllPlayers([])
    api.getPlayersAllTime(seasonId, seasonType)
      .then(d => setAllPlayers(d?.players || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId, seasonType])

  useEffect(() => { setSearch(''); setPosition(''); setCountry(''); setSortStat(''); setStatMode('per_game'); setActivity(''); setPage(1) }, [seasonId, seasonType])
  useEffect(() => { setPage(1) }, [search, position, country, sortStat, activity])

  const countries = useMemo(() => {
    const byIso2 = new Map()
    for (const p of allPlayers) {
      if (p.country_iso2 && !byIso2.has(p.country_iso2)) {
        byIso2.set(p.country_iso2, p.country_name || p.country_iso2)
      }
    }
    return [...byIso2.entries()]
      .map(([iso2, name]) => ({ iso2, name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allPlayers])

  let players = allPlayers.filter(p =>
    (!search || (p.canonical_name || '').toLowerCase().includes(search.toLowerCase())) &&
    (!position || p.position === position) &&
    (!country || p.country_iso2 === country) &&
    (!activity || (activity === 'active' ? p.is_active : !p.is_active))
  )

  if (sortStat) {
    players = [...players].sort((a, b) => {
      const d = (Number(getValue(b, sortStat, statMode)) || 0) - (Number(getValue(a, sortStat, statMode)) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    // Default sort: most NBA Titles (Champ), then most NBA Finals played,
    // then most career Regular Season points (always total points,
    // regardless of the Per Game/Total toggle — this is a stable ranking
    // order, not a display mode) — same cascading-tiebreak pattern used
    // elsewhere (Team Honours' MVP/Finals MVP/DPOY default).
    players = [...players].sort((a, b) => {
      const byTitles = (b.nba_titles || 0) - (a.nba_titles || 0)
      if (byTitles !== 0) return byTitles
      const byFinals = (b.nba_finals || 0) - (a.nba_finals || 0)
      if (byFinals !== 0) return byFinals
      const byPoints = (Number(getValue(b, 'points', 'total')) || 0) - (Number(getValue(a, 'points', 'total')) || 0)
      if (byPoints !== 0) return byPoints
      return getName(a).localeCompare(getName(b))
    })
  }

  const totalPages = Math.ceil(players.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(1, totalPages))
  const pageStart  = (safePage - 1) * PAGE_SIZE
  const pageSlice  = players.slice(pageStart, pageStart + PAGE_SIZE)

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )

  const hasActiveFilter = search || position || country || sortStat || activity
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  return (
    <div className={styles.wrap}>

      {basketballSubtitle && (
        <div className="page-subtitle">{basketballSubtitle}</div>
      )}
      <PageNotice />

      {/* filter-bar — global */}
      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 160 }}
          placeholder="Search athlete..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-label" value={seasonType} onChange={e => setSeasonType(e.target.value)}>
          <option value="regular">Regular Season</option>
          <option value="playoffs">Playoffs</option>
        </select>
        <select className="filter-label" value={position} onChange={e => setPosition(e.target.value)}>
          <option value="">All Positions</option>
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <SearchableSelect
          value={country}
          onChange={setCountry}
          options={countries.map(c => ({ value: c.iso2, label: c.name }))}
          allLabel="All Countries"
        />
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_GROUPS.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
        <div className={styles.statModeToggle}>
          <button
            type="button"
            className={`${styles.statModeBtn} ${statMode === 'per_game' ? styles.statModeBtnActive : ''}`}
            onClick={() => setStatMode('per_game')}
          >
            Per Game
          </button>
          <button
            type="button"
            className={`${styles.statModeBtn} ${statMode === 'total' ? styles.statModeBtnActive : ''}`}
            onClick={() => setStatMode('total')}
          >
            Total
          </button>
        </div>
        <div className={styles.activityTags}>
          <button
            type="button"
            className={`${styles.activityTag} ${activity === 'active' ? styles.activityTagActive : ''}`}
            onClick={() => setActivity(a => a === 'active' ? '' : 'active')}
          >
            Active
          </button>
          <button
            type="button"
            className={`${styles.activityTag} ${activity === 'retired' ? styles.activityTagActive : ''}`}
            onClick={() => setActivity(a => a === 'retired' ? '' : 'retired')}
          >
            Retired
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setPosition(''); setCountry(''); setSortStat(''); setActivity('') }}>
            Clear
          </button>
        )}
        {/* filter-total — global */}
        <span className="filter-total">{players.length} players</span>
      </div>

      {players.length === 0 ? (
        <div className={`${styles.empty} empty-state`}>No players found.</div>
      ) : (
        <>
          <table className={`${styles.table} table-thead-border`}>
            <thead>
              <tr>
                <th className={styles.rank}></th>
                <th className={`${styles.playerH} table-label-left`}>Player</th>
                <th className={`${styles.age} table-label`}>Age</th>
                <th className={`table-label ${sorted('nba_finals')} ${sorted('nba_titles')} ${sorted('nba_cup_finals')} ${sorted('nba_cup_titles')}`}>
                  <div className={styles.twoLineLabel}>
                    <span>NBA Champ.</span>
                    <span>NBA Cup</span>
                  </div>
                </th>
                <th className={`table-label ${sorted('games_played')} ${sorted('wins')} ${sorted('losses')}`}>
                  <div className={styles.twoLineLabel}>
                    <span>GP</span>
                    <span>Win/Loss</span>
                  </div>
                </th>
                {COLS.map(c => (
                  <th
                    key={c.key}
                    className={`${styles.stat} table-label ${sortStat && (c.key === sortStat || c.subKeyRaw === sortStat || c.comboKey === sortStat || c.subKey === sortStat) ? 'sortRowsHighlight' : ''}`}
                  >
                    {c.labelSub ? (
                      <div className={styles.twoLineLabel}>
                        <span>{c.label}</span>
                        <span>{c.labelSub}</span>
                      </div>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageSlice.map((p, i) => {
                const globalRank = pageStart + i + 1
                return (
                  <tr key={p.entity_id} className="table-row">

                    <td className={styles.rank}>
                      <span className="event-rank rank-badge">{globalRank}</span>
                    </td>

                    <td>
                      <div className={styles.player}>
                        <img
                          src={`/media/athletes/basketball/male/profile/${p.slug}.png`}
                          alt={p.canonical_name}
                          className="avatar"
                          onError={e => {
                            const fallback = resolveImageUrl(p.image_url)
                            if (fallback && e.target.src !== fallback) {
                              e.target.src = fallback
                            } else {
                              e.target.style.display = 'none'
                              e.target.nextSibling.style.display = 'flex'
                            }
                          }}
                        />
                        <div className="avatar-placeholder" style={{ display: 'none' }}>
                          {(p.canonical_name)?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className={styles.playerMeta}>
                          <span className="athlete-name">
                            {p.canonical_name}
                            {p.position && <span className="athletePosition"> - {p.position}</span>}
                          </span>
                          <div className={styles.countryRow}>
                            <Flag iso2={p.country_iso2} name={p.country_name} className="flag" />
                            <span className="athlete-profile-small">{p.country_name || p.country_iso2 || '—'}</span>
                            {p.club_code && (
                              <span className={`athlete-profile-small ${styles.clubCode}`}>{p.club_code}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className={styles.age} style={{ textAlign: 'center' }}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">
                          {calcAge(p.birth_date, endDate, p.death_date) ?? '–'}
                          {showDeceasedMark(p.death_date, activeYear) && <DeceasedMark />}
                        </span>
                        {p.birth_date && <span className="athlete-profile-small">{fmtBirth(p.birth_date)}</span>}
                      </div>
                    </td>

                    <td className={`${styles.stat} stats-strong ${sorted('nba_finals')} ${sorted('nba_titles')} ${sorted('nba_cup_finals')} ${sorted('nba_cup_titles')}`}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">{p.nba_finals}/{p.nba_titles}</span>
                        <span className="athlete-profile-small">{p.nba_cup_finals}/{p.nba_cup_titles}</span>
                      </div>
                    </td>

                    <td className={`${styles.stat} ${sorted('games_played')} ${sorted('wins')} ${sorted('losses')}`}>
                      <div className="stat-stack">
                        <span className="stat-stack-value">{p.games_played}</span>
                        <span className="athlete-profile-small">{p.wins}/{p.losses}</span>
                      </div>
                    </td>

                    {COLS.map(c => (
                      <td
                        key={c.key}
                        className={`${styles.stat} ${c.bold ? 'stats-strong' : 'stats-light'} ${sortStat && (c.key === sortStat || c.subKeyRaw === sortStat || c.comboKey === sortStat || c.subKey === sortStat) ? 'sortRowsHighlight' : ''}`}
                      >
                        {c.comboKey ? (
                          <div className="stat-stack">
                            <span className={c.bold ? 'stat-stack-value' : 'stat-stack-value-light'}>
                              {getValue(p, c.comboKey, statMode)}/{getValue(p, c.key, statMode)}
                            </span>
                            <span className="athlete-profile-small">{formatPct(getValue(p, c.subKey, statMode))}</span>
                          </div>
                        ) : c.subKey ? (
                          <div className="stat-stack">
                            <span className={c.bold ? 'stat-stack-value' : 'stat-stack-value-light'}>{getValue(p, c.key, statMode)}</span>
                            <span className="athlete-profile-small">{formatPct(getValue(p, c.subKey, statMode))}</span>
                          </div>
                        ) : c.subKeyRaw ? (
                          <div className="stat-stack">
                            <span className={c.bold ? 'stat-stack-value' : 'stat-stack-value-light'}>{getValue(p, c.key, statMode)}</span>
                            <span className="athlete-profile-small">{getValue(p, c.subKeyRaw, statMode)}</span>
                          </div>
                        ) : getValue(p, c.key, statMode)}
                      </td>
                    ))}
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
