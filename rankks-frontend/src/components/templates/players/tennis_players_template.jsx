import { useEffect, useState, useCallback } from 'react'
import PageNotice from '../../PageNotice/PageNotice'
import Flag from '../../shared/Flag'
import SearchableSelect from '../../shared/SearchableSelect'
import PlayerAllTimeResultsDrawer from '../../shared/PlayerAllTimeResultsDrawer'
import useVideoPlayerStore from '../../../store/useVideoPlayerStore'
import { fmtBirth } from '../../../utils/calcAge'
import styles from './tennis_players_template.module.css'

const API_BASE   = 'http://localhost:3000/api'
const MEDIA_BASE = 'http://localhost:5173'
// TODO: both of the above are dev-only absolute URLs — every other
// template uses relative paths or the shared `api` service. Flagged
// during the CSS centralization pass; left as-is pending confirmation
// this isn't already handled by a build-time env swap, since fixing it
// blind risks breaking whatever prod config currently compensates.
const regionNames  = new Intl.DisplayNames(['en'], { type: 'region' })
const countryName  = (iso2) => { try { return regionNames.of(iso2) } catch { return iso2 } }
const LIMIT      = 50

// Round names as stored in games.round → the short form shown here. Falls
// through to the raw round string for anything not listed (e.g. 'Round
// Robin' at round-robin events like the ATP/Next Gen Finals).
const ROUND_ABBR = {
  'Round of 128': 'R128',
  'Round of 64':  'R64',
  'Round of 32':  'R32',
  'Round of 16':  'R16',
  'Quarter-Final': 'QF',
  'Semi-Final':    'SF',
  'Final':         'F',
}
const roundLabel = (round) => round === 'W' ? 'W' : (ROUND_ABBR[round] || round)

// "Sort by:" options — values match the backend's SORT_CLAUSES whitelist
// (results.js /tennis-players).
const SORT_OPTIONS = [
  { key: 'finals',        label: 'Finals'           },
  { key: 'gained',        label: 'Gained Points'    },
  { key: 'participation', label: 'Participations' },
  { key: 'round',         label: 'Round'           },
  { key: 'titles',        label: 'Titles'           },
]

// Grey "active sort column" highlight — same .sortRowsHighlight convention
// used by players_all_time_template.jsx etc (see index.css). Titles and
// Finals share one physical column (Titles/Finals), so both keys light it up.
const highlightClass = (sortBy, ...keys) => keys.includes(sortBy) ? 'sortRowsHighlight' : ''

function PlayerRow({ player, index, page, sortBy }) {
  const [imgError, setImgError] = useState(false)
  const rowRank = (page - 1) * LIMIT + index + 1
  // Same key format PlayerAllTimeResultsDrawer builds internally
  // (`player-history:${entityId}`) — clicking the name opens the exact
  // same drawer instance the row mounts (hidden trigger) below.
  const openVideo = useVideoPlayerStore(s => s.openVideo)

  const genderPath = player.gender === 'F' ? 'female' : 'male'
  const imgSrc = `${MEDIA_BASE}/media/athletes/tennis/${genderPath}/profile/${player.slug}.png`

  return (
    <tr className="table-row">

      {/* ── Rank — global event-rank + rank-badge, matching football/F1's
          primary-rank treatment (was the muted .ranking class, which
          elsewhere on this page correctly stays reserved for the
          secondary "(ATP rank)" annotation next to a name, not the
          table's own row position) ── */}
      <td className={styles.tdRank}>
        <span className="event-rank rank-badge">{player.event_rank ?? rowRank}</span>
      </td>

      {/* ── Player: avatar + name + flag ── */}
      <td className={styles.tdPlayer}>
        <div className={styles.playerCell}>
          {!imgError
            ? <img className="avatar" src={imgSrc} alt={player.canonical_name} onError={() => setImgError(true)} />
            : <div className="avatar-placeholder">{player.canonical_name?.[0]?.toUpperCase() ?? '?'}</div>
          }
          <div className={styles.playerMeta}>
            <button type="button" className={`athlete-name ${styles.nameLink}`} onClick={() => openVideo(`player-history:${player.entity_id}`)}>
              {player.canonical_name}
            </button>
            <PlayerAllTimeResultsDrawer entityId={player.entity_id} name={player.canonical_name} hideTrigger />
            <span className={styles.countryRow}>
              <Flag iso2={player.country_iso2} name={player.country_iso2 ? countryName(player.country_iso2) : ''} className="flag" />
              <span className="athlete-profile-small">{player.country_iso2 ? countryName(player.country_iso2) : ''}</span>
            </span>
          </div>
        </div>
      </td>

      {/* ── Age at event + DOB — global .stat-stack, plain weight
          (.stat-stack-value-light) matching Seasons' treatment, not bold. ── */}
      <td className={styles.tdStat}>
        <div className="stat-stack">
          <span className="stat-stack-value-light">{player.age_at_event != null ? player.age_at_event : '–'}</span>
          {player.birth_date && (
            <span className={styles.dob}>{fmtBirth(player.birth_date)}</span>
          )}
        </div>
      </td>

      {/* ── Participations — years played at THIS competition, across
          every edition ── */}
      <td className={`${styles.tdStat} ${highlightClass(sortBy, 'participation')}`}>
        <span>{player.participation_count || '–'}</span>
      </td>

      {/* ── Round reached this edition ── */}
      <td className={`${styles.tdStat} ${highlightClass(sortBy, 'round')}`}>
        <span>{player.round_reached ? roundLabel(player.round_reached) : '–'}</span>
      </td>

      {/* ── Finals I Titles at THIS competition, career-wide, including the
          edition being viewed once its final has been played — e.g.
          "5 I 3". Only the titles number is bold; plain <strong> rather
          than .stats-strong, which carries 10px/12px padding that would
          visibly space "10" away from the preceding "10 I". The "Finals I"
          part stays plain weight. ── */}
      <td className={`${styles.tdStat} ${highlightClass(sortBy, 'titles', 'finals')}`}>
        {player.comp_finals
          ? <span>{player.comp_finals} I <strong>{player.comp_titles}</strong></span>
          : <span>–</span>}
      </td>

      {/* ── Best-ever performance at THIS competition (prior editions) —
          e.g. "QF (2)", or just "QF" when it only happened once ── */}
      <td className={styles.tdStat}>
        <span>
          {player.best_round
            ? `${roundLabel(player.best_round)}${player.best_count > 1 ? ` (${player.best_count})` : ''}`
            : '–'}
        </span>
      </td>

      {/* ── ATP/WTA Points — stacked: points at this event (bold, main
          line), then Gained Pts. underneath (smaller, .dob) — the swing
          since this player's closest prior tournament entry (any
          competition), not the official ATP defending-points formula, see
          results.js's prior_points CTE for why. Merged into one column
          2026-08-10 (was two separate columns). ── */}
      <td className={`${styles.tdStat} ${highlightClass(sortBy, 'gained')}`}>
        <div className="stat-stack">
          <strong>
            {player.event_points != null ? player.event_points.toLocaleString() : '–'}
          </strong>
          {player.gained_pts != null && (
            <span className={styles.dob}>
              {player.gained_pts > 0 ? '+' : ''}{player.gained_pts.toLocaleString()}
            </span>
          )}
        </div>
      </td>

    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function TennisPlayersTemplate({ seasonId, gender = 'M', pageSubtitle }) {
  const [players,        setPlayers]        = useState([])
  const [total,          setTotal]          = useState(0)
  const [page,           setPage]           = useState(1)
  const [loading,        setLoading]        = useState(true)
  const [playerFilter,   setPlayerFilter]   = useState('')
  const [countryFilter,  setCountryFilter]  = useState('')
  const [sortBy,         setSortBy]         = useState('')
  const [playerOptions,  setPlayerOptions]  = useState([])
  const [countryOptions, setCountryOptions] = useState([])

  const totalPages = Math.ceil(total / LIMIT)

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetch_ = useCallback(async (overrides = {}) => {
    const pl  = overrides.player  !== undefined ? overrides.player  : playerFilter
    const co  = overrides.country !== undefined ? overrides.country : countryFilter
    const so  = overrides.sort    !== undefined ? overrides.sort    : sortBy
    const p   = overrides.page    !== undefined ? overrides.page    : page
    const sid = overrides.seasonId !== undefined ? overrides.seasonId : seasonId

    if (!sid) return
    setLoading(true)

    try {
      const params = new URLSearchParams({
        seasonId: sid,
        gender,
        page:     p,
        limit:    LIMIT,
        ...(pl && { player:  pl }),
        ...(co && { country: co }),
        ...(so && { sort:    so }),
      })
      const res  = await window.fetch(`${API_BASE}/results/tennis-players?${params}`)
      const data = await res.json()
      setPlayers(data.players || [])
      setTotal(data.total || 0)
      // Filter option lists are unpaginated/unfiltered for this season —
      // always the full universe, same convention as the draw page's
      // "All Players"/"All Countries" selects.
      setPlayerOptions(data.player_options || [])
      setCountryOptions(data.country_options || [])
    } catch (e) {
      console.error('[TennisPlayersTemplate]', e)
      setPlayers([])
    } finally {
      setLoading(false)
    }
  }, [seasonId, gender, playerFilter, countryFilter, sortBy, page])

  // Reset + refetch on season or gender change
  useEffect(() => {
    setPage(1)
    setPlayerFilter('')
    setCountryFilter('')
    setSortBy('')
    fetch_({ page: 1, player: '', country: '', sort: '', seasonId })
  }, [seasonId, gender])

  // ── Handlers ───────────────────────────────────────────────────────────
  const handlePlayerFilter = (val) => {
    setPlayerFilter(val)
    setPage(1)
    fetch_({ player: val, page: 1 })
  }

  const handleCountryFilter = (val) => {
    setCountryFilter(val)
    setPage(1)
    fetch_({ country: val, page: 1 })
  }

  const handleSort = (val) => {
    setSortBy(val)
    setPage(1)
    fetch_({ sort: val, page: 1 })
  }

  const resetFilters = () => {
    setPlayerFilter('')
    setCountryFilter('')
    setSortBy('')
    setPage(1)
    fetch_({ player: '', country: '', sort: '', page: 1 })
  }

  const handlePage = (p) => {
    setPage(p)
    fetch_({ page: p })
  }

  const hasFilters = !!playerFilter || !!countryFilter || !!sortBy

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={styles.wrap}>

      {/* ── Page title ── */}
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      <PageNotice />

      {/* ── Filter bar ── */}
      <div className="filter-bar">

        <SearchableSelect
          value={playerFilter}
          onChange={handlePlayerFilter}
          options={playerOptions.map(name => ({ value: name, label: name }))}
          allLabel="All Players"
        />

        <select
          className="filter-label"
          style={{ minWidth: 180, appearance: 'auto' }}
          value={countryFilter}
          onChange={e => handleCountryFilter(e.target.value)}
        >
          <option value=''>All Countries</option>
          {countryOptions.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
        </select>

        <select
          className="filter-label"
          style={{ minWidth: 150, appearance: 'auto' }}
          value={sortBy}
          onChange={e => handleSort(e.target.value)}
        >
          <option value=''>Sort by:</option>
          {SORT_OPTIONS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
        </select>

        {/* Clear */}
        {hasFilters && (
          <button className="filter-reset" onClick={resetFilters}>
            Clear
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
                <th className={`table-label ${styles.thStat}`}>Age</th>
                <th className={`table-label ${styles.thStat} ${highlightClass(sortBy, 'participation')}`}>Participations</th>
                <th className={`table-label ${styles.thStat} ${highlightClass(sortBy, 'round')}`}>Round</th>
                <th className={`table-label ${styles.thStat} ${highlightClass(sortBy, 'titles', 'finals')}`}>Finals I Titles</th>
                <th className={`table-label ${styles.thStat}`}>Best Perf.</th>
                <th className={`table-label ${styles.thPoints} ${highlightClass(sortBy, 'gained')}`}>{gender === 'F' ? 'WTA Points' : 'ATP Points'}</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => (
                <PlayerRow
                  key={p.entity_id}
                  player={{ ...p, gender }}
                  index={i}
                  page={page}
                  sortBy={sortBy}
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
