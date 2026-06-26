import { useEffect, useState, useMemo } from 'react'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import styles from './tennis_draw_template.module.css'

const CHECK_ICON = '/media/icons/winner-check.svg'

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

function PlayerFlag({ iso2, flagUrl }) {
  if (!flagUrl && !iso2) return null
  const src = flagUrl ? flagUrl : `https://flagcdn.com/w20/${iso2?.toLowerCase()}.png`
  return <img src={src} alt={iso2} className={styles.flag} onError={e => e.target.style.display = 'none'} />
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
  const winnerFlag = homeWon ? game.home_flag : game.away_flag
  const winnerIso  = homeWon ? game.home_country_iso2 : game.away_country_iso2
  const loserFlag  = homeWon ? game.away_flag : game.home_flag
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
          <PlayerFlag iso2={winnerIso} flagUrl={winnerFlag} />
          <span className="athlete-name">{winnerName}</span>
          {wRank && <span className={"ranking"}>({wRank})</span>}
          <img src={CHECK_ICON} alt="winner" className="winner-check-icon" onError={e => e.target.style.display='none'} />
        </div>
        <SetScore score={score} isWinner={true} />
      </div>

      <div className={styles.playerRow}>
        <div className={styles.playerLeft}>
          <PlayerAvatar slug={loserSlug} name={loserName} gender={gender} />
          <PlayerFlag iso2={loserIso} flagUrl={loserFlag} />
          <span className="athlete-name">{loserName}</span>
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
      />
    </div>
  )
}

function getYouTubeId(url) {
  if (!url) return null
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)
  return match ? match[1] : null
}

function MatchVideo({ videoUrl, source, embeddable, thumbnailUrl }) {
  const [open, setOpen] = useState(false)
  if (!videoUrl) return null

  const youtubeId = source === 'youtube' ? getYouTubeId(videoUrl) : null
  const canEmbed  = embeddable && youtubeId

  if (!open) {
    return (
      <button className={styles.watchBtn} onClick={() => setOpen(true)}>
        ▶ Watch summary
      </button>
    )
  }

  if (canEmbed) {
    return (
      <div className={styles.videoEmbed}>
        <iframe
          width="100%"
          height="520"
          src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
          title="Match summary"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        <button className={styles.watchBtnClose} onClick={() => setOpen(false)}>Close</button>
      </div>
    )
  }

  // Not embeddable (e.g. ATP/WTA official pages) — link out instead
  return (
    <div className={styles.videoLinkOut}>
      {thumbnailUrl && <img src={thumbnailUrl} alt="" className={styles.videoThumb} />}
      <a href={videoUrl} target="_blank" rel="noreferrer" className={styles.videoLinkOutLink}>
        Watch on {source === 'atp' ? 'ATP' : source === 'wta' ? 'WTA' : 'official site'} ↗
      </a>
      <button className={styles.watchBtnClose} onClick={() => setOpen(false)}>Close</button>
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

export default function TennisDrawTemplate({ seasonId, tabKey, competitionName = '', year = '' }) {
  const [data, setData]                 = useState(null)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState(null)
  const [openRounds, setOpenRounds]     = useState(new Set())
  const [playerFilter, setPlayerFilter] = useState('')
  const [searchText, setSearchText]     = useState('')

  const gender = tabKey === 'draw-singles-f' ? 'F' : 'M'
  const tabTitle = gender === 'F' ? "Women's singles" : "Men's singles"
  const tabDesc  = competitionName
    ? `The table shows the ${competitionName} ${tabTitle} results for ${year}.`
    : ''

  useEffect(() => {
    if (!seasonId || !tabKey) return
    setLoading(true)
    setError(null)
    setData(null)
    setPlayerFilter('')
    setSearchText('')
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

  const toggle = (round) => {
    setOpenRounds(prev => {
      const next = new Set(prev)
      next.has(round) ? next.delete(round) : next.add(round)
      return next
    })
  }

  const activeFilter = playerFilter || searchText

  const matchesFilter = (g) => {
    if (playerFilter) return g.home_name === playerFilter || g.away_name === playerFilter
    if (searchText)   return g.home_name?.toLowerCase().includes(searchText.toLowerCase()) ||
                             g.away_name?.toLowerCase().includes(searchText.toLowerCase())
    return true
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
      <div className="page-title">{tabTitle}</div>
      <PageNotice />

      <div className="filter-bar">
        <input
          type="text"
          className="filter-label"
          placeholder="Search player..."
          value={searchText}
          onChange={e => { setSearchText(e.target.value); setPlayerFilter('') }}
          style={{ minWidth: 160 }}
        />
        <select
          className="filter-label"
          style={{ minWidth: 180, appearance: 'auto' }}
          value={playerFilter}
          onChange={e => { setPlayerFilter(e.target.value); setSearchText('') }}
        >
          <option value=''>All players</option>
          {players.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {activeFilter && (
          <button className="filter-reset" onClick={() => { setPlayerFilter(''); setSearchText('') }}>Clear</button>
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
