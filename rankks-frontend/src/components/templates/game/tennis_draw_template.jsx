import { useEffect, useState, useMemo } from 'react'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import MatchVideo from '../../shared/MatchVideo'
import Flag from '../../shared/Flag'
import SearchableSelect from '../../shared/SearchableSelect'
import styles from './tennis_draw_template.module.css'

function SetScore({ score, isWinner }) {
  if (!score) return <span className={styles.scoreEmpty}>-</span>
  if (score.walkover) return <span className={styles.walkover}>W/O</span>
  return (
    <div className={styles.sets}>
      {(score.sets || []).map((set, i) => {
        const myScore = isWinner ? set.w : set.l
        const wonSet  = set.w > set.l ? isWinner : !isWinner
        return (
          <span key={i} className={wonSet ? 'stats-strong' : 'stats-light'}>
            {myScore}
            {set.tb !== null && !isWinner && set.l === 6 && <sup className={styles.tb}>{set.tb}</sup>}
          </span>
        )
      })}
    </div>
  )
}

function PlayerAvatar({ slug, name, gender }) {
  const [failed, setFailed] = useState(false)
  const genderFolder = gender === 'F' ? 'female' : 'male'
  const src = slug ? `/media/athletes/tennis/${genderFolder}/profile/${slug}.png` : null
  if (!src || failed) {
    return <span className="avatar-placeholder">{name?.[0]?.toUpperCase() ?? '?'}</span>
  }
  return <img src={src} alt={name} className="avatar" onError={() => setFailed(true)} />
}

function MatchRow({ game, gender }) {
  const score      = game.score
  const isWalkover = game.is_walkover
  const isRetired  = game.is_retirement
  const homeWon    = game.home_id === game.winner_id

  const winnerName = game.winner_name
  const loserName  = homeWon ? game.away_name : game.home_name
  // flagUrl/game.home_flag/away_flag removed — no such column exists on
  // games (confirmed via information_schema), so this was always
  // resolving to the iso2 fallback anyway. Now goes straight through
  // the shared Flag component + global .flag, same as football/F1.
  const winnerIso  = homeWon ? game.home_country_iso2 : game.away_country_iso2
  const loserIso   = homeWon ? game.away_country_iso2 : game.home_country_iso2
  const winnerSlug = homeWon ? game.home_slug : game.away_slug
  const loserSlug  = homeWon ? game.away_slug : game.home_slug

  const stats = typeof game.stats === 'string' ? JSON.parse(game.stats) : (game.stats || {})
  const wRank = stats.w_rank
  const lRank = stats.l_rank

  return (
    <div className={styles.matchRow}>
      <div className={styles.playerRow}>
        <div className={styles.playerLeft}>
          <PlayerAvatar slug={winnerSlug} name={winnerName} gender={gender} />
          <Flag iso2={winnerIso} name={winnerName} className="flag" />
          <span className="athlete-name">{winnerName}</span>
          {wRank && <span className={"ranking"}>({wRank})</span>}
          <span className={styles.winnerMark} />
        </div>
        <SetScore score={score} isWinner={true} />
      </div>

      <div className={styles.playerRow}>
        <div className={styles.playerLeft}>
          <PlayerAvatar slug={loserSlug} name={loserName} gender={gender} />
          <Flag iso2={loserIso} name={loserName} className="flag" />
          <span className="athlete-name" style={{ fontWeight: 400 }}>{loserName}</span>
          {lRank && <span className={"ranking"}>({lRank})</span>}
        </div>
        <SetScore score={score} isWinner={false} />
      </div>

      {(isRetired || isWalkover) && (
        <span className={styles.badge}>{isRetired ? 'RET' : 'W/O'}</span>
      )}

      <MatchVideo
        videoUrl={game.video_url}
        source={game.video_source}
        embeddable={game.video_embeddable}
        thumbnailUrl={game.video_thumbnail_url}
        videoId={game.video_id}
        videoType="media"
      />
    </div>
  )
}

const ROUND_ORDER = {
  'Final': 1, 'Semi-Final': 2, 'Quarter-Final': 3,
  'Round of 16': 4, 'Round of 32': 5, 'Round of 64': 6,
  'Round of 128': 7, 'Round Robin': 8, 'Bronze Match': 9,
}

function sortRounds(rounds) {
  return [...rounds].sort((a, b) => (ROUND_ORDER[a] ?? 99) - (ROUND_ORDER[b] ?? 99))
}

export default function TennisDrawTemplate({ seasonId, tabKey, pageSubtitle }) {
  const [data, setData]                 = useState(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [openRounds, setOpenRounds]     = useState(new Set())
  const [playerFilter, setPlayerFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')

  const gender = tabKey === 'draw-singles-f' ? 'F' : 'M'

  useEffect(() => {
    if (!seasonId || !tabKey) return
    setLoading(true)
    setError(null)
    setData(null)
    setPlayerFilter('')
    setCountryFilter('')
    api.getGames(seasonId, tabKey)
      .then(d => {
        setData(d)
        if (d?.games_by_round) {
          const rounds = sortRounds(Object.keys(d.games_by_round))
          const defaultOpen = rounds.includes('Final') ? 'Final' : rounds[0]
          setOpenRounds(new Set(defaultOpen ? [defaultOpen] : []))
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [seasonId, tabKey])

  const players = useMemo(() => {
    if (!data?.games_by_round) return []
    const set = new Set()
    Object.values(data.games_by_round).forEach(games =>
      games.forEach(g => {
        if (g.home_name) set.add(g.home_name)
        if (g.away_name) set.add(g.away_name)
      })
    )
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [data])

  // Country counts for the "All Countries" filter — counts DISTINCT
  // players per country (not match rows, which would double-count a
  // player across every round they appear in).
  const countries = useMemo(() => {
    if (!data?.games_by_round) return []
    const playerCountry = new Map()
    Object.values(data.games_by_round).forEach(games =>
      games.forEach(g => {
        if (g.home_name && g.home_country_name) playerCountry.set(g.home_name, g.home_country_name)
        if (g.away_name && g.away_country_name) playerCountry.set(g.away_name, g.away_country_name)
      })
    )
    const counts = new Map()
    playerCountry.forEach(country => counts.set(country, (counts.get(country) || 0) + 1))
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [data])

  const toggle = (round) => {
    setOpenRounds(prev => {
      const next = new Set(prev)
      next.has(round) ? next.delete(round) : next.add(round)
      return next
    })
  }

  const activeFilter = playerFilter || countryFilter

  const matchesFilter = (g) => {
    let matches = true
    if (playerFilter) matches = g.home_name === playerFilter || g.away_name === playerFilter
    if (matches && countryFilter) matches = g.home_country_name === countryFilter || g.away_country_name === countryFilter
    return matches
  }

  if (loading) return (
    <div className={styles.wrapper}>
      {[...Array(6)].map((_, i) => (
        <div key={i} className={styles.skeletonBlock}>
          <div className={styles.skeletonHeader} />
          <div className={styles.skeletonMatch} />
          <div className={styles.skeletonMatch} />
        </div>
      ))}
    </div>
  )

  if (error) return <div className={styles.wrapper}><p className={styles.empty}>Could not load draw.</p></div>

  if (!data?.games_by_round || Object.keys(data.games_by_round).length === 0) return (
    <div className={styles.wrapper}><p className={styles.empty}>No draw data available.</p></div>
  )

  const sortedRounds  = sortRounds(Object.keys(data.games_by_round))
  const visibleRounds = activeFilter
    ? sortedRounds.filter(round =>
        (data.games_by_round[round] || []).some(matchesFilter)
      )
    : sortedRounds

  const effectiveOpen = (round) => activeFilter ? true : openRounds.has(round)

  return (
    <div className={styles.wrapper}>
      {pageSubtitle && <div className="page-subtitle">{pageSubtitle}</div>}
      <PageNotice />

      <div className="filter-bar">
        <SearchableSelect
          value={playerFilter}
          onChange={setPlayerFilter}
          options={players.map(p => ({ value: p, label: p }))}
          allLabel="All Players"
        />
        <select
          className="filter-label"
          style={{ minWidth: 180, appearance: 'auto' }}
          value={countryFilter}
          onChange={e => setCountryFilter(e.target.value)}
        >
          <option value=''>All Countries</option>
          {countries.map(([name, count]) => <option key={name} value={name}>{name} ({count})</option>)}
        </select>
        {activeFilter && (
          <button className="filter-reset" onClick={() => { setPlayerFilter(''); setCountryFilter('') }}>Clear</button>
        )}
        <span className="filter-total">{data.total} matches</span>
      </div>

      <div className={styles.rounds}>
        {visibleRounds.map(round => {
          const allGames = data.games_by_round[round] || []
          const games    = activeFilter ? allGames.filter(matchesFilter) : allGames
          const isOpen   = effectiveOpen(round)

          return (
            <div key={round} className={styles.roundBlock}>
              <button
                className={`event-day${isOpen ? ' event-day-open' : ''}`}
                onClick={() => !activeFilter && toggle(round)}
                style={activeFilter ? { cursor: 'default' } : {}}
              >
                <span>{round}</span>
                <span className={styles.matchCount}>{allGames.length} match{allGames.length !== 1 ? 'es' : ''}</span>
                {!activeFilter && <span className="event-day-chevron">{isOpen ? '▲' : '▼'}</span>}
              </button>

              {isOpen && (
                <div className={styles.matchList}>
                  {games.map((game, i) => <MatchRow key={game.id ?? i} game={game} gender={gender} />)}
                </div>
              )}
            </div>
          )
        })}

        {activeFilter && visibleRounds.length === 0 && (
          <p className={styles.empty}>No matches found.</p>
        )}
      </div>
    </div>
  )
}
