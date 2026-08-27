// templates/teams/football_teams_all_time_template.jsx
// Football All-Time > Team Stats — cumulative "through <year>" totals for
// every club that has ever appeared in this competition's standings.
// Backed by /results/teams-all-time/:seasonId (see that route's comment
// for the standings-table-based, non-UCL-Clubs-route approach, and for
// how the Cards column's yellow/red totals are summed per club).
import { useEffect, useMemo, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import SearchableSelect from '../../shared/SearchableSelect'
import styles from './football_teams_all_time_template.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return null
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

function getName(t) { return (t.canonical_name || '').toLowerCase() }

// Ligue 1 stores season START year (year_convention='start') — DB year
// 2025 is the 2025/26 season, displayed everywhere else as "2026" (same
// dbYear/toDisplayYear pair as EventBlock.jsx/the Player Stats page).
function toDisplayYear(rawYear, yearConvention) {
  return yearConvention === 'start' ? rawYear + 1 : rawYear
}
function seasonRangeLabel(first, last, yearConvention) {
  if (first == null || last == null) return null
  const a = toDisplayYear(first, yearConvention)
  const b = toDisplayYear(last, yearConvention)
  return a === b ? String(a) : `${a}-${b}`
}

const SORT_GROUPS = [
  {
    label: 'Trophies',
    options: [
      { key: 'titles',  label: 'Champion' },
    ],
  },
  {
    label: 'Record',
    options: [
      { key: 'seasons',       label: 'Seasons' },
      { key: 'played',        label: 'Played' },
      { key: 'won',           label: 'Won' },
      { key: 'drawn',         label: 'Drawn' },
      { key: 'lost',          label: 'Lost' },
      { key: 'goals_for',     label: 'GF' },
      { key: 'goals_against', label: 'GA' },
    ],
  },
  {
    label: 'Awards',
    options: [
      { key: 'top_scorer_titles', label: 'Top Scorer' },
      { key: 'top_assist_titles', label: 'Assist Leader' },
      { key: 'yellow_cards',      label: 'Yellow card' },
      { key: 'red_cards',         label: 'Red card' },
    ],
  },
]

export default function FootballTeamsAllTimeTemplate({ seasonId, competitionSlug, yearConvention, hasFinalRoundTab, minYear }) {
  const { activeYear } = useAppStore()
  const [data, setData]       = useState(null)

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — falls
  // back to "Team Stats - <first season>-<year>" (Mohamed 2026-08-26: the
  // old "through <year>" wording implied coverage from zero, when this
  // page only covers from the competition's first ingested season) when
  // nothing's configured.
  const SUBTITLE_FALLBACK = minYear && minYear < activeYear
    ? `Team Stats - from ${minYear} to ${activeYear}`
    : `Team Stats - through ${activeYear}`
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!competitionSlug || !activeYear) return
    api.getSubtitle('football', competitionSlug, 'Totals', 'Teams', activeYear)
      .then(d => setPageSubtitle(d?.subtitle || SUBTITLE_FALLBACK))
      .catch(() => setPageSubtitle(SUBTITLE_FALLBACK))
  }, [competitionSlug, activeYear, minYear]) // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [country, setCountry] = useState('')
  const [sortStat, setSortStat] = useState('')

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    api.getFootballTeamsAllTime(seasonId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => { setSearch(''); setCountry(''); setSortStat('') }, [seasonId])

  const allTeams = data?.teams || []
  const matchesSearch  = t => !search  || (t.canonical_name || '').toLowerCase().includes(search.toLowerCase())
  const matchesCountry = t => !country || t.country_iso2 === country

  // Faceted — same "own filter excluded from its own count" convention as
  // the Player Stats page's own Country dropdown. Hook must run every
  // render (before the loading/empty early returns below) — Rules of
  // Hooks.
  const countries = useMemo(() => {
    const m = new Map()
    for (const t of allTeams) {
      if (t.country_iso2 && matchesSearch(t)) {
        const key = t.country_iso2
        const cur = m.get(key)
        m.set(key, { iso2: key, name: t.country_name || key, count: (cur?.count || 0) + 1 })
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [allTeams, search])

  if (loading) return <Skeleton />
  if (!data?.teams?.length) return <Empty />

  let rows = allTeams.filter(t => matchesSearch(t) && matchesCountry(t))

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

  const hasActiveFilter = search || country || sortStat
  const sorted = key => sortStat === key ? 'sortRowsHighlight' : ''

  return (
    <div className={styles.wrap}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search team" value={search} onChange={e => setSearch(e.target.value)} />
        <SearchableSelect
          value={country}
          onChange={setCountry}
          options={countries.map(c => ({ value: c.iso2, label: `${c.name} (${c.count})` }))}
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
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setCountry(''); setSortStat('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} teams</span>
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={styles.pos}></th>
              <th className={`${styles.teamH} table-label`} style={{ textAlign: 'left' }}>Team</th>
              <th className={`${styles.seasonsH} table-label ${sorted('seasons')}`} style={{ textAlign: 'center' }}>Seasons</th>
              <th className={`${styles.championH} table-label ${sorted('titles')}`} style={{ textAlign: 'center' }}>
                {hasFinalRoundTab ? 'Champion I Final' : 'Champion'}
              </th>
              <th className={`${styles.playedH} table-label ${sorted('played')} ${sorted('won')} ${sorted('drawn')} ${sorted('lost')}`} style={{ textAlign: 'center' }}>
                <div className="stat-stack"><span>Played</span><span className="cell-meta" style={{ fontWeight: 400 }}>W I D I L</span></div>
              </th>
              <th className={`${styles.gfgaH} table-label ${sorted('goals_for')} ${sorted('goals_against')}`} style={{ textAlign: 'center' }}>GF I GA</th>
              <th className={`${styles.scorerH} table-label ${sorted('top_scorer_titles')}`} style={{ textAlign: 'center' }}>Top Scorer</th>
              <th className={`${styles.assistH} table-label ${sorted('top_assist_titles')}`} style={{ textAlign: 'center' }}>Assist Leader</th>
              <th className={`${styles.cardsH} table-label ${sorted('yellow_cards')} ${sorted('red_cards')}`} style={{ textAlign: 'center' }}>Cards Y I R</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => {
              const logo = resolveImg(t.logo_url)
              const range = seasonRangeLabel(t.first_season_year, t.last_season_year, yearConvention)
              return (
                <tr key={t.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={styles.pos} style={{ verticalAlign: 'top' }}><span className="event-rank">{i + 1}</span></td>
                  <td style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    <div className={styles.team}>
                      <div className={styles.logoSlot}>
                        {logo && <img src={logo} alt={t.canonical_name} className={styles.logo} onError={e => { e.target.style.display = 'none' }} />}
                      </div>
                      <span className="club-name stats-strong" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.canonical_name}</span>
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('seasons')}`} style={{ textAlign: 'center', verticalAlign: 'top' }}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{t.seasons}</span>
                      {range && <span className="athlete-profile-small">{range}</span>}
                    </div>
                  </td>
                  <td className={sorted('titles')} style={{ textAlign: 'center', verticalAlign: 'top' }}>
                    {hasFinalRoundTab
                      ? <><span style={{ fontWeight: 700 }}>{t.titles}</span> I <span style={{ fontWeight: 400 }}>{t.finals}</span></>
                      : <span style={{ fontWeight: 700 }}>{t.titles}</span>}
                  </td>
                  <td className={`stats-light ${sorted('played')} ${sorted('won')} ${sorted('drawn')} ${sorted('lost')}`} style={{ textAlign: 'center', verticalAlign: 'top' }}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{t.played}</span>
                      <span className="cell-meta">{t.won} I {t.drawn} I {t.lost}</span>
                    </div>
                  </td>
                  <td className={`stats-light ${sorted('goals_for')} ${sorted('goals_against')}`} style={{ textAlign: 'center', verticalAlign: 'top' }}>{t.goals_for} I {t.goals_against}</td>
                  <td className={`stats-light ${sorted('top_scorer_titles')}`} style={{ textAlign: 'center', verticalAlign: 'top' }}>{t.top_scorer_titles}</td>
                  <td className={`stats-light ${sorted('top_assist_titles')}`} style={{ textAlign: 'center', verticalAlign: 'top' }}>{t.top_assist_titles}</td>
                  <td className={`stats-light ${sorted('yellow_cards')} ${sorted('red_cards')}`} style={{ textAlign: 'center', verticalAlign: 'top' }}>{t.yellow_cards} I {t.red_cards}</td>
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
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No team data available.</div>
}
