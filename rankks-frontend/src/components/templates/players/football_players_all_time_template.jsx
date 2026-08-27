// templates/players/football_players_all_time_template.jsx
// Football All-Time > Player Stats — cumulative "through <year>" career
// totals for every player who has ever appeared in this competition.
// Backed by /results/players-all-time-football/:seasonId — see that
// route's comment for exactly how Apps/Mins/W-D-L/Champion/first-last
// season are derived from standings (no per-game player log exists in
// this schema).
import { useEffect, useMemo, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import DeceasedMark from '../../shared/DeceasedMark'
import SearchableSelect from '../../shared/SearchableSelect'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import { getPositionCode, getPositionGroup } from '../../../utils/positionCode'
import styles from './football_players_all_time_template.module.css'

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker']

// A-Z by label, with "Games played" (Won/Drawn/Lost) as one optgroup
// rather than 3 top-level entries — same nested-group shape basketball's
// own BASKETBALL_SORT_GROUPS uses elsewhere on this page family.
const SORT_FLAT = [
  { key: 'apps',    label: 'Apps' },
  { key: 'assists', label: 'Assists' },
]
const SORT_GAMES_PLAYED_GROUP = [
  { key: 'won',   label: 'Wins' },
  { key: 'drawn', label: 'Drawn' },
  { key: 'lost',  label: 'Lost' },
]
const SORT_FLAT_2 = [
  { key: 'goals',        label: 'Goals' },
  { key: 'minutes',      label: 'Mins' },
  { key: 'red_cards',    label: 'Red card' },
  { key: 'seasons',      label: 'Seasons' },
  { key: 'yellow_cards', label: 'Yellow card' },
]

function getName(p) { return (p.canonical_name || '').toLowerCase() }

// Same rule as F1/NBA's All-Time pages: the cross only shows once the
// "through <year>" context is past the death itself.
function showDeceasedMark(deathDate, year) {
  if (!deathDate) return false
  return year > new Date(deathDate).getFullYear()
}

// Ligue 1 stores season START year (year_convention='start') — DB year
// 2025 is the 2025/26 season, displayed everywhere else as "2026" (same
// dbYear/toDisplayYear pair as EventBlock.jsx/football_champion_history_
// template.jsx).
function toDisplayYear(rawYear, yearConvention) {
  return yearConvention === 'start' ? rawYear + 1 : rawYear
}

// "13 seasons, 2013-2026" (Mohamed 2026-08-25) — a single-season career
// shows just the one year, not "2026-2026".
function seasonRangeLabel(first, last, yearConvention) {
  if (first == null || last == null) return null
  const a = toDisplayYear(first, yearConvention)
  const b = toDisplayYear(last, yearConvention)
  return a === b ? String(a) : `${a}-${b}`
}

export default function FootballPlayersAllTimeTemplate({ seasonId, endDate, competitionSlug, yearConvention, hasFinalRoundTab, minYear }) {
  const { activeYear } = useAppStore()
  const openPlayerModal = useAppStore(s => s.openPlayerModal)
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [position, setPosition] = useState('')
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

  useEffect(() => { setSearch(''); setPosition(''); setCountry(''); setSortStat(''); setActivity('') }, [seasonId])

  // Admin-configured subtitle line (rankks-admin's Page Subtitles page,
  // sport 'football', page_key 'football-totals-players') — falls back to
  // "Player Stats - <first season>-<year>" (Mohamed 2026-08-26: the old
  // "through <year>" wording implied a start point of zero, when this page
  // actually only covers from the competition's first ingested season) when
  // nothing's configured, so the page never shows a blank subtitle before
  // an admin row exists for this competition.
  const SUBTITLE_FALLBACK = minYear && minYear < activeYear
    ? `Player Stats - from ${minYear} to ${activeYear}`
    : `Player Stats - through ${activeYear}`
  const [fetchedSubtitle, setFetchedSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !activeYear) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Players', activeYear)
      .then(d => setFetchedSubtitle(d?.subtitle || SUBTITLE_FALLBACK))
      .catch(() => setFetchedSubtitle(SUBTITLE_FALLBACK))
  }, [competitionSlug, activeYear, minYear]) // eslint-disable-line react-hooks/exhaustive-deps
  const pageSubtitle = fetchedSubtitle

  const allPlayers = data?.players || []

  // Faceted filters — each dropdown's own option list/count reflects every
  // OTHER active filter but never its own current selection.
  const matchesSearch   = p => !search   || (p.canonical_name || '').toLowerCase().includes(search.toLowerCase())
  const matchesPosition = p => !position || getPositionGroup(p.position) === position
  const matchesCountry  = p => !country  || p.country_iso2 === country
  const matchesActivity = p => !activity || (activity === 'active' ? p.is_active : !p.is_active)

  const countries = useMemo(() => {
    const m = new Map()
    for (const p of allPlayers) {
      if (p.country_iso2 && matchesSearch(p) && matchesPosition(p) && matchesActivity(p)) {
        const key = p.country_iso2
        const cur = m.get(key)
        m.set(key, { iso2: key, name: p.country_name || key, count: (cur?.count || 0) + 1 })
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [allPlayers, search, position, activity])

  if (loading) return (
    <div style={{ padding: 16 }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="skeleton" style={{ height: 40, marginBottom: 4, borderRadius: 4 }} />
      ))}
    </div>
  )
  if (!allPlayers.length) return <div className={`${styles.empty} empty-state`}>No player data available.</div>

  let rows = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesCountry(p) && matchesActivity(p)
  )

  if (sortStat) {
    rows = [...rows].sort((a, b) => {
      const d = (Number(b[sortStat]) || 0) - (Number(a[sortStat]) || 0)
      return d !== 0 ? d : getName(a).localeCompare(getName(b))
    })
  } else {
    // Default order: Champions, then Seasons (Mohamed's explicit rule).
    rows = [...rows].sort((a, b) => {
      const byTitles = (b.titles || 0) - (a.titles || 0)
      if (byTitles !== 0) return byTitles
      const bySeasons = (b.seasons || 0) - (a.seasons || 0)
      if (bySeasons !== 0) return bySeasons
      return getName(a).localeCompare(getName(b))
    })
  }

  const hasActiveFilter = search || position || country || sortStat || activity
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
        <SearchableSelect
          value={country}
          onChange={setCountry}
          options={countries.map(c => ({ value: c.iso2, label: `${c.name} (${c.count})` }))}
          allLabel="All Countries"
        />
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {SORT_FLAT.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          <optgroup label="Games played">
            {SORT_GAMES_PLAYED_GROUP.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </optgroup>
          {SORT_FLAT_2.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
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
          <button className="filter-reset" onClick={() => { setSearch(''); setPosition(''); setCountry(''); setSortStat(''); setActivity('') }}>
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
              <th className={`${styles.playerH} table-label-left`}>Player</th>
              <th className={`${styles.age} table-label`}>Age</th>
              <th className={`${styles.seasonsCol} table-label ${sorted('seasons')}`}>Seasons</th>
              <th className={`${styles.championCol} table-label ${sorted('titles')}`}>{hasFinalRoundTab ? 'Champion I Final' : 'Champion'}</th>
              <th className={`${styles.appsCol} table-label ${sorted('apps')}`}>Apps</th>
              <th className={`${styles.minsCol} table-label ${sorted('minutes')}`}>Mins</th>
              <th className={`${styles.wdl} table-label ${sorted('won')} ${sorted('drawn')} ${sorted('lost')}`}>W I D I L</th>
              <th className={`${styles.gaCol} table-label ${sorted('goals')} ${sorted('assists')}`}>Goals I Assists</th>
              <th className={`${styles.cardsCol} table-label ${sorted('yellow_cards')} ${sorted('red_cards')}`}>Cards Y I R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => (
              <tr key={p.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.rank}><span className="event-rank">{i + 1}</span></td>

                <td className={styles.playerH}>
                  <div className={styles.player}>
                    <div className={styles.playerMeta}>
                      <span className="athlete-name">
                        <button
                          type="button"
                          className={styles.playerLink}
                          onClick={() => openPlayerModal({ name: p.canonical_name, slug: p.slug })}
                        >
                          {p.canonical_name}
                        </button>
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
                    <span className="stat-stack-value-light">
                      {calcAge(p.birth_date, endDate, p.death_date) ?? '–'}
                      {showDeceasedMark(p.death_date, activeYear) && <DeceasedMark />}
                    </span>
                    {p.birth_date && <span className="athlete-profile-small">{fmtBirth(p.birth_date)}</span>}
                  </div>
                </td>

                <td className={`stats-light ${sorted('seasons')}`} style={{ textAlign: 'center' }}>
                  <div className="stat-stack">
                    <span className="stat-stack-value-light">{p.seasons}</span>
                    {seasonRangeLabel(p.first_season_year, p.last_season_year, yearConvention) && (
                      <span className="athlete-profile-small">{seasonRangeLabel(p.first_season_year, p.last_season_year, yearConvention)}</span>
                    )}
                  </div>
                </td>

                <td className={sorted('titles')} style={{ textAlign: 'center' }}>
                  {hasFinalRoundTab
                    ? <><span style={{ fontWeight: 700 }}>{p.titles}</span> I <span style={{ fontWeight: 400 }}>{p.finals}</span></>
                    : <span style={{ fontWeight: 700 }}>{p.titles}</span>}
                </td>
                <td className={`stats-light ${sorted('apps')}`} style={{ textAlign: 'center' }}>{p.apps}</td>
                <td className={`stats-light ${sorted('minutes')}`} style={{ textAlign: 'center' }}>{p.minutes}</td>
                <td className={`stats-light ${sorted('won')} ${sorted('drawn')} ${sorted('lost')}`} style={{ textAlign: 'center' }}>{p.won} I {p.drawn} I {p.lost}</td>
                <td className={`stats-light ${sorted('goals')} ${sorted('assists')}`} style={{ textAlign: 'center' }}>{p.goals} I {p.assists}</td>
                <td className={`stats-light ${sorted('yellow_cards')} ${sorted('red_cards')}`} style={{ textAlign: 'center' }}>{p.yellow_cards} I {p.red_cards}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
