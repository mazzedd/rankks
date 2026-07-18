import { useEffect, useState } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import styles from './players_template.module.css'

const PAGE_SIZE = 25

const MODES = {
  scorers: {
    title:   'Top Scorers',
    description: (comp, season) => `The table shows the ${comp} top scorers for the ${season} season.`,
    sortKey: 'goals',
    cols: [
      { key: 'goals',        label: 'Goals',   bold: true },
      { key: 'assists',      label: 'Assists' },
      { key: 'games_played', label: 'Apps' },
      { key: 'minutes',      label: 'Mins' },
    ],
  },
  passers: {
    title:   'Assist Leaders',
    description: (comp, season) => `The table shows the ${comp} assist leaders for the ${season} season.`,
    sortKey: 'assists',
    cols: [
      { key: 'assists',      label: 'Assists', bold: true },
      { key: 'goals',        label: 'Goals' },
      { key: 'games_played', label: 'Apps' },
      { key: 'minutes',      label: 'Mins' },
    ],
  },
  players: {
    title:   'Player list',
    description: (comp, season) => `The table shows the ${comp} players for the ${season} season.`,
    sortKey: null,
    cols: [
      { key: 'games_played', label: 'Apps',    bold: true },
      { key: 'goals',        label: 'Goals' },
      { key: 'assists',      label: 'Assists' },
      { key: 'yellow_cards', label: '🟨' },
      { key: 'red_cards',    label: '🟥' },
    ],
  },
}

// API-Sports returns 'Attacker' and 'Forward' for the same role
const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker']
const POS_LABEL = {
  Goalkeeper: 'Goalkeeper',
  Defender:   'Defender',
  Midfielder: 'Midfielder',
  Attacker:   'Attacker',
  Forward:    'Attacker', // API-Sports alias — displayed as Attacker
}
// Normalise position for filtering so 'Forward' matches 'Attacker' filter
function normalisePosition(pos) {
  if (!pos) return null
  return POS_LABEL[pos] || pos
}

function getName(p) { return (p.display_name || p.canonical_name || '').toLowerCase() }

// Resolve club logo — use API field if present. No more name-based slug
// guessing as a fallback: that broke for national teams (World Cup),
// where club_name is the country itself ("Tunisia") and no such club
// logo file exists. Same iso2 convention used everywhere else in the
// app now applies here too — when there's no explicit club_logo, the
// Club column falls back to the player's country flag via <Flag>
// (rendered in the JSX below, using country_iso2), rather than this
// function guessing a path that may not exist.
function getClubLogo(p) {
  if (p.club_logo) {
    if (p.club_logo.startsWith('http://') || p.club_logo.startsWith('https://')) return null // skip external
    if (p.club_logo.startsWith('/media/')) return p.club_logo
    if (p.club_logo.startsWith('/')) return `/media${p.club_logo}`
    return `/media/${p.club_logo}`
  }
  return null
}

function getValue(player, key) {
  if (key === 'minutes') return player.stats?.minutes || player.minutes_played || '—'
  return player[key] ?? '—'
}

// Format year as "2022-2023" for end-year convention, or just "2023"
function formatSeasonYear(year, convention) {
  if (convention === 'end') return `${year - 1}–${year}`
  return `${year}`
}

// AGE — unified rule (RANKKS-wide, see src/utils/calcAge.js): age is
// computed as of the season's real end_date, not a raw year subtraction.
// Requires the parent (ContentArea.jsx) to pass the season's end_date
// down as `endDate` — already wired in ContentArea.jsx's players branch.
export default function ScorersTemplate({ seasonId, mode = 'scorers', competitionName = '', yearConvention = 'end', endDate }) {
  const { activeYear } = useAppStore()
  const seasonLabel = formatSeasonYear(activeYear, yearConvention)
  const [allPlayers, setAllPlayers] = useState([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')
  const [position, setPosition]     = useState('')
  const [club, setClub]             = useState('')
  const [country, setCountry]       = useState('')
  const [page, setPage]             = useState(1)

  useEffect(() => {
    if (!seasonId) return
    setLoading(true)
    setAllPlayers([])
    api.getPlayers(seasonId)
      .then(d => setAllPlayers(d?.players || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [seasonId])

  useEffect(() => {
    setSearch(''); setPosition(''); setClub(''); setCountry(''); setPage(1)
  }, [mode])

  useEffect(() => { setPage(1) }, [search, position, club, country])

  const cfg = MODES[mode] || MODES.scorers

  // National-team competitions (World Cup) have club_name === country_name
  // for every player — Club and Country filters would be identical, so
  // show one merged "Countries" filter instead of two redundant ones.
  // Detected via club_entity_type ('national_team' vs 'club'), a real DB
  // field rather than a name-comparison guess — same tab is always
  // homogeneous, so checking the first row is reliable.
  const isNationalTeamScope = allPlayers[0]?.club_entity_type === 'national_team'

  // Faceted filter options: each dropdown's option list reflects every
  // OTHER active filter (search, position, and the opposite club/country
  // selection) but never its own current selection — selecting PSG
  // should narrow Country to PSG's actual nationalities, but the Club
  // dropdown itself must still show every club, not just PSG, or the
  // dropdown would collapse to one option the instant it's chosen.
  const matchesSearch   = p => !search   || (p.display_name || p.canonical_name || '').toLowerCase().includes(search.toLowerCase())
  const matchesPosition = p => !position || normalisePosition(p.position) === position
  const matchesClub     = p => !club     || p.club_name === club
  const matchesCountry  = p => !country  || p.country_name === country

  const playersForClubOptions = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesCountry(p)
  )
  const playersForCountryOptions = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesClub(p)
  )

  const clubs     = [...new Set(playersForClubOptions.map(p => p.club_name).filter(Boolean))].sort()
  const countries = [...new Set(playersForCountryOptions.map(p => p.country_name).filter(Boolean))].sort()

  // If the currently-selected club/country falls out of scope because of
  // a different filter narrowing the data (e.g. searching a name that no
  // longer matches anyone at the selected club), the selection itself is
  // left as-is rather than silently reset — the result list will simply
  // show zero players with a clear "no players found" state, which is
  // more honest than guessing a replacement value.

  let players = allPlayers.filter(p =>
    matchesSearch(p) && matchesPosition(p) && matchesClub(p) && matchesCountry(p)
  )

  if (mode === 'scorers') {
    players = [...players].filter(p => (p.goals || 0) > 0)
      .sort((a, b) => { const d = (b.goals||0)-(a.goals||0); return d !== 0 ? d : getName(a).localeCompare(getName(b)) })
  } else if (mode === 'passers') {
    players = [...players].filter(p => (p.assists || 0) > 0)
      .sort((a, b) => { const d = (b.assists||0)-(a.assists||0); return d !== 0 ? d : getName(a).localeCompare(getName(b)) })
  } else {
    players = [...players].sort((a, b) => getName(a).localeCompare(getName(b)))
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

  const hasActiveFilter = search || position || club || country

  return (
    <div className={styles.wrap}>

      {/* page-title — global */}
      <div className="page-title">{cfg.title}</div>
      <PageNotice />

      {/* filter-bar — global */}
      <div className="filter-bar">
        <input
          className="filter-label"
          style={{ width: 160 }}
          placeholder="Search player..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-label" value={position} onChange={e => setPosition(e.target.value)}>
          <option value="">All Positions</option>
          {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="filter-label" value={club} onChange={e => setClub(e.target.value)}>
          <option value="">{isNationalTeamScope ? 'All Countries' : 'All Clubs'}</option>
          {clubs.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {!isNationalTeamScope && (
          <select className="filter-label" value={country} onChange={e => setCountry(e.target.value)}>
            <option value="">All Countries</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setSearch(''); setPosition(''); setClub(''); setCountry('') }}>
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
                {/* table-label / table-label-left — global */}
                <th className={`${styles.playerH} table-label-left`}>Player</th>
                <th className="table-label">Age</th>
                <th className="table-label" style={{ paddingLeft: '24px' }}>Position</th>
                <th className={`${styles.clubH} table-label-left`}>{isNationalTeamScope ? 'Country' : 'Club'}</th>
                {cfg.cols.map(c => <th key={c.key} className={`${styles.stat} table-label`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageSlice.map((p, i) => {
                const globalRank = pageStart + i + 1
                const clubLogo   = getClubLogo(p)
                const posLabel   = POS_LABEL[p.position] || p.position || '—'
                return (
                  <tr key={p.id} className="table-row">

                    {/* event-rank — global */}
                    <td className={styles.rank}>
                      <span className={`event-rank ${styles.rn}`}>{globalRank}</span>
                    </td>

                    {/* Player: avatar + name + flag + country */}
                    <td>
                      <div className={styles.player}>
                        <img
                          src={`/media/athletes/football/male/profile/${p.slug}.png`}
                          alt={p.display_name || p.canonical_name}
                          className="avatar"
                          onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
                        />
                        <div className="avatar-placeholder" style={{ display: 'none' }} />
                        <div className={styles.playerMeta}>
                          <span className="athlete-name">{p.display_name || p.canonical_name}</span>
                          <div className={styles.countryRow}>
                            <Flag iso2={p.country_iso2} name={p.country_name} className={styles.countryFlag} />
                            <span className="athlete-profile-small">{p.country_name || p.country_iso2 || '—'}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Age — calcAge(birth_date, endDate), the season's real
                        end_date, instead of the previous year-only subtraction */}
                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
                        <span style={{ padding: 0 }} className="stats-strong">{calcAge(p.birth_date, endDate) ?? '–'}</span>
                        {p.birth_date && <span className="athlete-profile-small">{fmtBirth(p.birth_date)}</span>}
                      </div>
                    </td>

                    {/* Position — stats-light */}
                    <td className={`${styles.pos} stats-light`} style={{ paddingLeft: '24px' }}>
                      {posLabel}
                    </td>

                    {/* Club — athlete-profile. Falls back to the country
                        flag when no explicit club_logo exists (national
                        teams — World Cup — where club_name IS the country) */}
                    <td>
                      <div className="athlete-profile">
                        {clubLogo
                          ? <img src={clubLogo} alt={p.club_name} className={styles.clubLogo}
                              onError={e => e.target.style.display = 'none'} />
                          : <Flag iso2={p.country_iso2} name={p.club_name} className={styles.clubLogo} />
                        }
                        <span>{p.club_name || '—'}</span>
                      </div>
                    </td>

                    {/* Stats — stats-strong / stats-light */}
                    {cfg.cols.map(c => (
                      <td key={c.key} className={`${styles.stat} ${c.bold ? 'stats-strong' : 'stats-light'}`}>
                        {getValue(p, c.key)}
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
