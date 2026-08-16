// templates/players/football_players_all_time_template.jsx
// Football All-Time > Player Stats — cumulative "through <year>" career
// totals for every player who has ever appeared in this competition.
// Backed by /results/players-all-time-football/:seasonId — see that
// route's comment for exactly how Apps/W-D-L/Champion are derived from
// standings (no per-game player log exists in this schema).
//
// Cup/League Cup/Champions Trophy have no ingested data yet — shown as a
// permanent "—/—" placeholder, same convention as the Team Stats page and
// EventBlock's player stat bloc.
import { useEffect, useMemo, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import DeceasedMark from '../../shared/DeceasedMark'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import { getPositionCode, getPositionGroup } from '../../../utils/positionCode'
import styles from './football_players_all_time_template.module.css'

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker']

const SORT_GROUPS = [
  {
    label: 'Trophies',
    options: [
      { key: 'titles',           label: 'Champion' },
      { key: 'cup',              label: 'Cup' },
      { key: 'league_cup',       label: 'League Cup' },
      { key: 'champions_trophy', label: 'Champions Trophy' },
      { key: 'seasons',          label: 'Seasons' },
    ],
  },
  {
    label: 'Record',
    options: [
      { key: 'apps',  label: 'Apps' },
      { key: 'won',   label: 'Won' },
      { key: 'drawn', label: 'Drawn' },
      { key: 'lost',  label: 'Lost' },
    ],
  },
  {
    label: 'Awards',
    options: [
      { key: 'goals',        label: 'Goal' },
      { key: 'assists',      label: 'Assist' },
      { key: 'yellow_cards', label: 'Yellow Card' },
      { key: 'red_cards',    label: 'Red Card' },
    ],
  },
]

function getName(p) { return (p.canonical_name || '').toLowerCase() }

// Same rule as F1/NBA's All-Time pages: the cross only shows once the
// "through <year>" context is past the death itself.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

export default function FootballPlayersAllTimeTemplate({ seasonId, endDate, competitionSlug }) {
  const { activeYear } = useAppStore()
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [position, setPosition] = useState('')
  const [team, setTeam]         = useState('')
  const [country, setCountry]   = useState('')
  const [sortStat, setSortStat] = useState('')
  const [activity, setActivity] = useState('') // '' | 'active' | 'retired'

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getFootballPlayersAllTime(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setPosition(''); setTeam(''); setCountry(''); setSortStat(''); setActivity('') }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Page Subtitles page,
  // sport 'football', page_key 'football-totals-players') — falls back to
  // the original static "through <year>" line when nothing's configured,
  // so every competition keeps working exactly as before until someone
  // opts in via admin (2026-08-13: this page previously had no way to set
  // a per-competition subtitle at all, e.g. for FIFA World Cup).
  const [fetchedSubtitle, setFetchedSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !activeYear) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Players', activeYear)
      .then(d => setFetchedSubtitle(d?.subtitle || null))
      .catch(() => setFetchedSubtitle(null))
  }, [competitionSlug, activeYear])
  const pageSubtitle = fetchedSubtitle

  const allPlayers = data?.players || []

  const teams = useMemo(() => (
    [...new Set(allPlayers.map(p => p.club_name).filter(Boolean))].sort()
  ), [allPlayers])

  const countries = useMemo(() => {
    const byIso2 = new Map()
    for (const p of allPlayers) {
      if (p.country_iso2 && !byIso2.has(p.country_iso2)) {
        byIso2.set(p.country_iso2, p.country_name || p.country_iso2)
      }
    }
    return [...byIso2.entries()].map(([iso2, name]) => ({ iso2, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [allPlayers])

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )
  if (!allPlayers.length) return <div className={`${styles.empty} empty-state`}>No player data available.</div>

  let rows = allPlayers.filter(p =>
    (!search || (p.canonical_name || '').toLowerCase().includes(search.toLowerCase())) &&
    (!position || getPositionGroup(p.position) === position) &&
    (!team || p.club_name === team) &&
    (!country || p.country_iso2 === country) &&
    (!activity || (activity === 'active' ? p.is_active : !p.is_active))
  )

  // Cup/League Cup/Champions Trophy have no real data yet — every player is
  // 0, so selecting them just falls back to name order for now.
  if (sortStat === 'cup' || sortStat === 'league_cup' || sortStat === 'champions_trophy') {
    rows = [...rows].sort((a, b) => getName(a).localeCompare(getName(b)))
  } else if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const d = (Number(b[sortStat]) || 0) - (Number(a[sortStat]) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    // Default order: Champions, then Seasons, then Cup, then League Cup
    // (Mohamed's explicit rule) — Cup/League Cup are always 0 today, so
    // this currently resolves at the Seasons tiebreak.
    rows = [...rows].sort((a, b) => {
      const byTitles = (b.titles || 0) - (a.titles || 0)
      if (byTitles !== 0) return byTitles
      const bySeasons = (b.seasons || 0) - (a.seasons || 0)
      if (bySeasons !== 0) return bySeasons
      return getName(a).localeCompare(getName(b))
    })
  }

  const hasActiveFilter = search || position || team || country || sortStat || activity
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search player" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="filter-label" value={position} onChange={e => setPosition(e.target.value)}>
          <option value="">All Positions</option>
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="filter-label" value={team} onChange={e => setTeam(e.target.value)}>
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="filter-label" value={country} onChange={e => setCountry(e.target.value)}>
          <option value="">All countries</option>
          {countries.map(c => <option key={c.iso2} value={c.iso2}>{c.name}</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_GROUPS.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </optgroup>
          ))}
        </select>
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
          <button className="filter-reset" onClick={() => { setSearch(''); setPosition(''); setTeam(''); setCountry(''); setSortStat(''); setActivity('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} players</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.rank}></th>
              <th className="table-label-left" style={{ fontWeight: 'bold' }}>Player</th>
              <th className={`${styles.age} table-label`} style={{ fontWeight: 'bold' }}>Age</th>
              <th className={`table-label ${sorted('titles')} ${sorted('seasons')}`} style={{ fontWeight: 'bold' }}>
                <div className={styles.twoLineLabel}><span>Seasons</span><span>Champion</span></div>
              </th>
              <th className={`table-label ${sorted('cup')}`} style={{ fontWeight: 'bold' }}>
                <div className="stat-stack"><span>Cup</span><span className="cell-meta">Fin./Tit.</span></div>
              </th>
              <th className={`table-label ${sorted('league_cup')}`} style={{ fontWeight: 'bold' }}>
                <div className="stat-stack"><span>League Cup</span><span className="cell-meta">Fin./Tit.</span></div>
              </th>
              <th className={`table-label ${sorted('champions_trophy')}`} style={{ fontWeight: 'bold' }}>
                <div className="stat-stack"><span>Champions Trophy</span><span className="cell-meta">Fin./Tit.</span></div>
              </th>
              <th className={`table-label ${sorted('apps')} ${sorted('won')} ${sorted('drawn')} ${sorted('lost')}`} style={{ fontWeight: 'bold' }}>
                <div className={styles.twoLineLabel}><span>Apps</span><span>W/D/L</span></div>
              </th>
              <th className={`table-label ${sorted('goals')} ${sorted('assists')}`} style={{ fontWeight: 'bold' }}>Goals/Assists</th>
              <th className={`table-label ${sorted('yellow_cards')} ${sorted('red_cards')}`} style={{ fontWeight: 'bold' }}>Yellow/Red Cards</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.rank}><span className="event-rank">{i + 1}</span></td>

                <td>
                  <div className={styles.player}>
                    <div className={styles.playerMeta}>
                      <span className="athlete-name">
                        {p.canonical_name}
                        {getPositionCode(p.position) && <span className="athletePosition"> - {getPositionCode(p.position)}</span>}
                      </span>
                      <div className={styles.countryRow}>
                        <Flag iso2={p.country_iso2} name={p.country_name} className="flag" />
                        <span className="athlete-profile-small">{p.country_name || p.country_iso2 || '—'}</span>
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

                <td className={`stats-strong ${sorted('titles')} ${sorted('seasons')}`} style={{ textAlign: 'center' }}>
                  <div className="stat-stack">
                    <span className="stat-stack-value">{p.seasons}</span>
                    <span className="cell-meta">{p.titles}</span>
                  </div>
                </td>

                <td className={sorted('cup')} style={{ textAlign: 'center' }}>
                  <div className="stat-stack"><span className="stat-stack-value">—</span><span className="cell-meta">—</span></div>
                </td>
                <td className={sorted('league_cup')} style={{ textAlign: 'center' }}>
                  <div className="stat-stack"><span className="stat-stack-value">—</span><span className="cell-meta">—</span></div>
                </td>
                <td className={sorted('champions_trophy')} style={{ textAlign: 'center' }}>
                  <div className="stat-stack"><span className="stat-stack-value">—</span><span className="cell-meta">—</span></div>
                </td>

                <td className={`${sorted('apps')} ${sorted('won')} ${sorted('drawn')} ${sorted('lost')}`} style={{ textAlign: 'center' }}>
                  <div className="stat-stack">
                    <span className="stat-stack-value">{p.apps}</span>
                    <span className="cell-meta">{p.won}/{p.drawn}/{p.lost}</span>
                  </div>
                </td>

                <td className={`stats-light ${sorted('goals')} ${sorted('assists')}`} style={{ textAlign: 'center' }}>{p.goals}/{p.assists}</td>
                <td className={`stats-light ${sorted('yellow_cards')} ${sorted('red_cards')}`} style={{ textAlign: 'center' }}>{p.yellow_cards}/{p.red_cards}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
