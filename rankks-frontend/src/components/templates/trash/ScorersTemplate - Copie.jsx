import { useEffect, useState } from 'react'
import useAppStore from '../../store/useAppStore'
import PageNotice from '../PageNotice/PageNotice'
import { api } from '../../services/api'
import styles from './ScorersTemplate.module.css'

const PAGE_SIZE = 25

// Age calculated at Jan 1 of the selected year (conservative — full year)
function calcAge(birthDate, year) {
  if (!birthDate || !year) return null
  const birth = new Date(birthDate)
  const age = year - birth.getFullYear()
  return age > 0 ? age : null
}

function formatDOB(birthDate) {
  if (!birthDate) return ''
  const d = new Date(birthDate)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

const MODES = {
  scorers: {
    title:   'League top scorers',
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
    title:   'League assist leaders',
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
    title:   'League players list',
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

const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker']
const POS_LABEL = { Goalkeeper: 'Goalkeeper', Defender: 'Defender', Midfielder: 'Midfielder', Attacker: 'Attacker', Forward: 'Forward' }

function getName(p) { return (p.display_name || p.canonical_name || '').toLowerCase() }

function getClubLogo(p) {
  if (p.club_logo && !p.club_logo.startsWith('http')) return p.club_logo
  const slug = p.club_slug || p.club_name?.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '')
  if (!slug) return null
  return `/media/clubs/football/france/${slug}.png`
}

function getFlagPath(iso2) {
  if (!iso2) return null
  // Use flagcdn for codes that may not exist in local /media/flags
  const useCdn = ['gb-eng','gb-sct','gb-wls','gb-nir','gp','mq','gf']
  if (useCdn.includes(iso2.toLowerCase())) {
    return `https://flagcdn.com/w20/${iso2.toLowerCase()}.png`
  }
  return `/media/flags/${iso2.toLowerCase()}.svg`
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

export default function ScorersTemplate({ seasonId, mode = 'scorers', competitionName = '', yearConvention = 'end' }) {
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

  const cfg       = MODES[mode] || MODES.scorers
  const clubs     = [...new Set(allPlayers.map(p => p.club_name).filter(Boolean))].sort()
  const countries = [...new Set(allPlayers.map(p => p.country_name).filter(Boolean))].sort()

  let players = allPlayers
  if (search)   players = players.filter(p => (p.display_name || p.canonical_name || '').toLowerCase().includes(search.toLowerCase()))
  if (position) players = players.filter(p => p.position === position)
  if (club)     players = players.filter(p => p.club_name === club)
  if (country)  players = players.filter(p => p.country_name === country)

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
          <option value="">All Clubs</option>
          {clubs.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="filter-label" value={country} onChange={e => setCountry(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
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
                <th className="table-label" style={{paddingLeft:'24px'}}>Position</th>
                <th className={`${styles.clubH} table-label-left`}>Club</th>
                {cfg.cols.map(c => <th key={c.key} className={`${styles.stat} table-label`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageSlice.map((p, i) => {
                const globalRank = pageStart + i + 1
                const clubLogo   = getClubLogo(p)
                const flagSrc    = getFlagPath(p.country_iso2)
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
                          alt={p.display_name}
                          className="avatar"
                          onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='flex' }}
                        />
                        <div className="avatar-placeholder" style={{display:'none'}} />
                        <div className={styles.playerMeta}>
                          <span className="athlete-name">{p.display_name || p.canonical_name}</span>
                          <div className={styles.countryRow}>
                            {flagSrc && (
                              <img src={flagSrc} alt={p.country_name} className={styles.countryFlag}
                                onError={e => e.target.style.display = 'none'} />
                            )}
                            <span className="athlete-profile-small">{p.country_name || p.country_iso2 || '—'}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Age */}
                    <td style={{textAlign:'center', verticalAlign:'middle'}}>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:0}}>
                        <span style={{padding:0}} className="stats-strong">{calcAge(p.birth_date, activeYear) ?? '–'}</span>
                        {p.birth_date && <span className="athlete-profile-small">{formatDOB(p.birth_date)}</span>}
                      </div>
                    </td>

                    {/* Position — stats-light */}
                    <td className={`${styles.pos} stats-light`} style={{paddingLeft:'24px'}}>
                      {POS_LABEL[p.position] || p.position || '—'}
                    </td>

                    {/* Club — athlete-profile */}
                    <td>
                      <div className="athlete-profile">
                        {clubLogo && (
                          <img src={clubLogo} alt={p.club_name} className={styles.clubLogo}
                            onError={e => e.target.style.display = 'none'} />
                        )}
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
