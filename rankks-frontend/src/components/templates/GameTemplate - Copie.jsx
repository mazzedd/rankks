import { useEffect, useState, useMemo } from 'react'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import styles from './GameTemplate.module.css'

const MEDIA_BASE = 'http://localhost:5173'

function TeamLogo({ logo, name }) {
  if (!logo) return <span className={styles.logoPlaceholder} />
  const src = logo.startsWith('http') ? logo : `${MEDIA_BASE}${logo}`
  return (
    <img src={src} alt={name} className={styles.teamLogo}
      onError={e => { e.target.style.visibility = 'hidden' }} />
  )
}

function MatchRow({ game }) {
  const homeScore = game.score?.home ?? '–'
  const awayScore = game.score?.away ?? '–'
  return (
    /* game-result — global */
    <div className="game-result">
      <div className={styles.teamHome}>
        {/* club-name-game — global */}
        <span className="club-name-game">{game.home_name}</span>
        <TeamLogo logo={game.home_logo} name={game.home_name} />
      </div>
      {/* game-score — global */}
      <div className="game-score">
        <span className="game-score-num">{homeScore}</span>
        <span className="game-score-dash">-</span>
        <span className="game-score-num">{awayScore}</span>
      </div>
      <div className={styles.teamAway}>
        <TeamLogo logo={game.away_logo} name={game.away_name} />
        <span className="club-name-game">{game.away_name}</span>
      </div>
    </div>
  )
}

function sortRounds(rounds) {
  return [...rounds].sort((a, b) => {
    const numA = parseInt(a.match(/\d+$/)?.[0] ?? '0', 10)
    const numB = parseInt(b.match(/\d+$/)?.[0] ?? '0', 10)
    if (numA !== numB) return numA - numB
    return a.localeCompare(b)
  })
}

export default function GameTemplate({ seasonId, tabKey, competitionName = '', yearConvention = 'end' }) {
  const { activeYear } = useAppStore()
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [openRounds, setOpenRounds] = useState(new Set())
  const [clubFilter, setClubFilter] = useState('')

  useEffect(() => {
    if (!seasonId || !tabKey) return
    setLoading(true)
    setError(null)
    setData(null)
    setClubFilter('')
    api.getGames(seasonId, tabKey)
      .then(d => {
        setData(d)
        if (d?.games_by_round) {
          const raw = (d.rounds || Object.keys(d.games_by_round)).map(r =>
            typeof r === 'object' ? r.round : r
          )
          setOpenRounds(new Set([sortRounds(raw)[0]]))
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [seasonId, tabKey])

  const clubs = useMemo(() => {
    if (!data?.games_by_round) return []
    const set = new Set()
    Object.values(data.games_by_round).forEach(games =>
      games.forEach(g => { set.add(g.home_name); set.add(g.away_name) })
    )
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [data])

  const selectedClubLogo = useMemo(() => {
    if (!clubFilter || !data?.games_by_round) return null
    for (const games of Object.values(data.games_by_round)) {
      for (const g of games) {
        if (g.home_name === clubFilter) return g.home_logo
        if (g.away_name === clubFilter) return g.away_logo
      }
    }
    return null
  }, [clubFilter, data])

  const toggle = (round) => {
    setOpenRounds(prev => {
      const next = new Set(prev)
      next.has(round) ? next.delete(round) : next.add(round)
      return next
    })
  }

  if (loading) return (
    <div className={styles.wrapper}>
      {[...Array(8)].map((_, i) => <div key={i} className={styles.skeleton} />)}
    </div>
  )

  if (error) return (
    <div className={styles.wrapper}>
      <p className={styles.message}>Could not load results.</p>
    </div>
  )

  if (!data?.games_by_round) return null

  const rawRounds = (data.rounds || Object.keys(data.games_by_round)).map(r =>
    typeof r === 'object' ? r.round : r
  )
  const sortedRounds = sortRounds(rawRounds)

  const visibleRounds = clubFilter
    ? sortedRounds.filter(round =>
        (data.games_by_round[round] || []).some(
          g => g.home_name === clubFilter || g.away_name === clubFilter
        )
      )
    : sortedRounds

  const effectiveOpen = (round) => clubFilter ? true : openRounds.has(round)

  return (
    <div className={styles.wrapper}>

      {/* page-title — global */}
      <div className="page-title">League matches</div>
      {competitionName && (
        <div className="page-description">
          {`The table shows the ${competitionName} match results for the ${yearConvention === 'end' ? `${activeYear - 1}–${activeYear}` : `${activeYear}`} season.`}
        </div>
      )}

      {/* 90% centred inner section */}
      <div className={styles.rounds}>

        {/* filter-bar — global */}
        <div className={styles.filterBar}>
          {selectedClubLogo && (
            /* filter-logo — global */
            <img
              src={selectedClubLogo.startsWith('http') ? selectedClubLogo : `${MEDIA_BASE}${selectedClubLogo}`}
              alt={clubFilter}
              className="filter-logo"
            />
          )}
          {/* filter-label — global */}
          <select
            className="filter-label"
            style={{ minWidth: 180, appearance: 'auto' }}
            value={clubFilter}
            onChange={e => setClubFilter(e.target.value)}
          >
            <option value=''>All clubs</option>
            {clubs.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {clubFilter && (
            /* filter-clear — global */
            <button className="filter-reset" onClick={() => setClubFilter('')}>Clear</button>
          )}
        </div>

        {/* Rounds */}
        {visibleRounds.map(round => {
          const allGames = data.games_by_round[round] || []
          const games = clubFilter
            ? allGames.filter(g => g.home_name === clubFilter || g.away_name === clubFilter)
            : allGames
          const isOpen = effectiveOpen(round)

          return (
            <div key={round} className={styles.roundBlock}>
              {/* event-day — global */}
              <button
                className={`event-day${isOpen ? ' event-day-open' : ''}`}
                onClick={() => !clubFilter && toggle(round)}
                style={clubFilter ? { cursor: 'default' } : {}}
              >
                <span>{round}</span>
                {/* event-day-chevron — global */}
                {!clubFilter && (
                  <span className="event-day-chevron">{isOpen ? '▲' : '▼'}</span>
                )}
              </button>
              {isOpen && (
                <div className={styles.list}>
                  {games.map((game, i) => <MatchRow key={game.id ?? i} game={game} />)}
                </div>
              )}
            </div>
          )
        })}

        {clubFilter && visibleRounds.length === 0 && (
          <p className={styles.message}>No results for {clubFilter}.</p>
        )}
      </div>
    </div>
  )
}
