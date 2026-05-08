import { useEffect, useState, useCallback, useRef } from 'react'
import PageNotice from '../PageNotice/PageNotice'
import styles from './TennisPlayersTemplate.module.css'

const API_BASE   = 'http://localhost:3000/api'
const MEDIA_BASE = 'http://localhost:5173'
const FLAG_CDN     = (iso2) => `https://flagcdn.com/w20/${iso2?.toLowerCase()}.png`
const regionNames  = new Intl.DisplayNames(['en'], { type: 'region' })
const countryName  = (iso2) => { try { return regionNames.of(iso2) } catch { return iso2 } }
const LIMIT      = 50

const FILTER_BUTTONS_M = [
  { key: 'gs',     label: 'Grand Slam'  },
  { key: 'm1000',  label: 'Master 1000' },
  { key: 'atp500', label: 'ATP 500'     },
  { key: 'atp250', label: 'ATP 250'     },
]
const FILTER_BUTTONS_F = [
  { key: 'gs',     label: 'Grand Slam'  },
  { key: 'm1000',  label: 'WTA 1000'    },
  { key: 'atp500', label: 'WTA 500'     },
  { key: 'atp250', label: 'WTA 250'     },
]

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// wins (finals) — shows "4 (7)" or just "–" if no finals
function StatCell({ wins, finals }) {
  if (!finals) return <span className="stat-finals">–</span>
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span className="stat-wins">{wins}</span>
      <span className="stat-finals"> ({finals})</span>
    </span>
  )
}

function PlayerRow({ player, index, page }) {
  const [imgError, setImgError] = useState(false)
  const rowRank = (page - 1) * LIMIT + index + 1

  const genderPath = player.gender === 'F' ? 'female' : 'male'
  const imgSrc = `${MEDIA_BASE}/media/athletes/tennis/${genderPath}/${player.slug}.png`

  return (
    <tr className="table-row">

      {/* ── Rank ── */}
      <td className={styles.tdRank}>
        <span className="ranking">{player.event_rank ?? rowRank}</span>
      </td>

      {/* ── Player: avatar + name + flag ── */}
      <td className={styles.tdPlayer}>
        <div className={styles.playerCell}>
          {!imgError
            ? <img className="avatar" src={imgSrc} alt={player.canonical_name} onError={() => setImgError(true)} />
            : <div className="avatar-placeholder" />
          }
          <div className={styles.playerMeta}>
            <span className="athlete-name">
              {(() => {
                const parts = (player.canonical_name || '').trim().split(' ')
                const last  = parts.pop()
                const first = parts.join(' ')
                return <>{first} <strong>{last}</strong></>
              })()}
            </span>
            <span className={styles.countryRow}>
              {player.country_iso2 && (
                <img
                  className={styles.flag}
                  src={FLAG_CDN(player.country_iso2)}
                  alt={player.country_iso2}
                  onError={e => { e.target.style.display = 'none' }}
                />
              )}
              <span className="athlete-profile-small">{player.country_iso2 ? countryName(player.country_iso2) : ''}</span>
            </span>
          </div>
        </div>
      </td>

      {/* ── Age at event + DOB ── */}
      <td className={styles.tdAge}>
        <span className="stats-light">{player.age_at_event != null ? player.age_at_event : '–'}</span>
        {player.birth_date && (
          <span className={styles.dob}>{formatDate(player.birth_date)}</span>
        )}
      </td>

      {/* ── GS ── */}
      <td className={styles.tdStat}>
        <StatCell wins={player.gs_wins} finals={player.gs_finals} />
      </td>

      {/* ── M1000 ── */}
      <td className={styles.tdStat}>
        <StatCell wins={player.m1000_wins} finals={player.m1000_finals} />
      </td>

      {/* ── ATP 500 ── */}
      <td className={styles.tdStat}>
        <StatCell wins={player.atp500_wins} finals={player.atp500_finals} />
      </td>

      {/* ── ATP 250 ── */}
      <td className={styles.tdStat}>
        <StatCell wins={player.atp250_wins} finals={player.atp250_finals} />
      </td>

      {/* ── TOTAL wins + finals ── */}
      <td className={styles.tdStat}>
        <StatCell wins={player.total_wins} finals={player.total_finals} />
      </td>

      {/* ── Ranking at event ── */}
      <td className={styles.tdStat}>
        <span className="stats-strong">
          {player.event_rank != null ? `#${player.event_rank}` : '–'}
        </span>
      </td>

    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function TennisPlayersTemplate({ seasonId, gender = 'M', competitionName = '', year = '' }) {
  const [players,       setPlayers]       = useState([])
  const [total,         setTotal]         = useState(0)
  const [page,          setPage]          = useState(1)
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [activeFilters, setActiveFilters] = useState([])
  const debounceRef = useRef(null)

  const totalPages = Math.ceil(total / LIMIT)

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetch_ = useCallback(async (overrides = {}) => {
    const s = overrides.search  !== undefined ? overrides.search  : search
    const f = overrides.filters !== undefined ? overrides.filters : activeFilters
    const p = overrides.page    !== undefined ? overrides.page    : page
    const sid = overrides.seasonId !== undefined ? overrides.seasonId : seasonId

    if (!sid) return
    setLoading(true)

    try {
      const params = new URLSearchParams({
        seasonId: sid,
        gender,
        page:     p,
        limit:    LIMIT,
        ...(s        && { search:  s }),
        ...(f.length && { filters: f.join(',') }),
      })
      const res  = await window.fetch(`${API_BASE}/results/tennis-players?${params}`)
      const data = await res.json()
      setPlayers(data.players || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error('[TennisPlayersTemplate]', e)
      setPlayers([])
    } finally {
      setLoading(false)
    }
  }, [seasonId, gender, search, activeFilters, page])

  // Reset + refetch on season or gender change
  useEffect(() => {
    setPage(1)
    setSearch('')
    setActiveFilters([])
    fetch_({ page: 1, search: '', filters: [], seasonId })
  }, [seasonId, gender])

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSearch = (val) => {
    setSearch(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      fetch_({ search: val, page: 1 })
    }, 300)
  }

  const toggleFilter = (key) => {
    const next = activeFilters.includes(key)
      ? activeFilters.filter(k => k !== key)
      : [...activeFilters, key]
    setActiveFilters(next)
    setPage(1)
    fetch_({ filters: next, page: 1 })
  }

  const resetFilters = () => {
    setSearch('')
    setActiveFilters([])
    setPage(1)
    fetch_({ search: '', filters: [], page: 1 })
  }

  const handlePage = (p) => {
    setPage(p)
    fetch_({ page: p })
  }

  const hasFilters = !!search || activeFilters.length > 0

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={styles.wrap}>

      {/* ── Page title ── */}
      <h1 className="page-title">{gender === 'F' ? "Women's Player List" : "Men's Player List"}</h1>
      {competitionName && (
        <div className="page-description">
          {`The table shows the ${competitionName} ${gender === 'F' ? "Women's" : "Men's"} player list ${year}.`}
        </div>
      )}
      <PageNotice />

      {/* ── Filter bar ── */}
      <div className="filter-bar">

        {/* Search */}
        <input
          className="search-input"
          type="text"
          placeholder="Search Player"
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />

        {/* Separator */}
        <div className={styles.sep} />

        {/* Category toggles */}
        {(gender === 'F' ? FILTER_BUTTONS_F : FILTER_BUTTONS_M).map(btn => (
          <button
            key={btn.key}
            className={`filter-btn ${activeFilters.includes(btn.key) ? 'active' : ''}`}
            onClick={() => toggleFilter(btn.key)}
          >
            {btn.label}
          </button>
        ))}

        {/* Reset */}
        {hasFilters && (
          <button className="filter-reset" onClick={resetFilters}>
            Reset
          </button>
        )}

        {/* Total count */}
        <span className={`filter-total ${styles.totalRight}`}>
          {total.toLocaleString()} players
        </span>

      </div>

      {/* ── Table ── */}
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.skeletons}>
            {[...Array(10)].map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 54, marginBottom: 4 }} />
            ))}
          </div>
        ) : players.length === 0 ? (
          <div className="empty-state">No players found</div>
        ) : (
          <table className={styles.table}>
            <thead className="table-thead-border">
              <tr>
                <th className={`table-label ${styles.thRank}`}>Rank</th>
                <th className={`table-label-left ${styles.thPlayer}`}>Player</th>
                <th className={`table-label-left ${styles.thAge}`}>Age</th>
                <th className={`table-label ${styles.thStat}`}>GS</th>
                <th className={`table-label ${styles.thStat}`}>{gender === 'F' ? 'WTA 1000' : 'M1000'}</th>
                <th className={`table-label ${styles.thStat}`}>{gender === 'F' ? 'WTA 500' : 'ATP 500'}</th>
                <th className={`table-label ${styles.thStat}`}>{gender === 'F' ? 'WTA 250' : 'ATP 250'}</th>
                <th className={`table-label ${styles.thTotal}`}>TOTAL</th>
                <th className={`table-label ${styles.thPoints}`}>Points</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => (
                <PlayerRow
                  key={p.entity_id}
                  player={{ ...p, gender }}
                  index={i}
                  page={page}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pagination-btn"
            disabled={page === 1}
            onClick={() => handlePage(page - 1)}
          >‹</button>
          <span className="pagination-info">{page} / {totalPages}</span>
          <button
            className="pagination-btn"
            disabled={page === totalPages}
            onClick={() => handlePage(page + 1)}
          >›</button>
        </div>
      )}

    </div>
  )
}
