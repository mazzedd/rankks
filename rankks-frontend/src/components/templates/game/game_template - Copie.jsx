import { useEffect, useState, useMemo } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import MatchVideo from '../../shared/MatchVideo'
import Flag from '../../shared/Flag'
import styles from './game_template.module.css'

function resolveLogoUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

// National teams have no club logo (home_logo/away_logo is always null
// for them) — falls back to the country flag via iso2, same fallback
// pattern used in standings_template.jsx and players_template.jsx.
// getGames/getGamesByGroup already return home_country_iso2/
// away_country_iso2, so no backend change was needed for this.
//
// Flag fallback now uses the global "flag" class (index.css) instead of
// styles.teamLogo — previously the flag was stretched into the 26×26
// logo box, same squashed-flag bug fixed across standings/players/clubs.
// styles.teamLogo stays reserved for actual club badge images.
function TeamLogo({ logo, name, iso2 }) {
  const src = resolveLogoUrl(logo)
  if (src) {
    return (
      <img src={src} alt={name} className={styles.teamLogo}
        onError={e => { e.target.style.visibility = 'hidden' }} />
    )
  }
  if (iso2) {
    return <Flag iso2={iso2} name={name} className="flag" />
  }
  return <span className={styles.logoPlaceholder} />
}

function formatMatchDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// A scorer entry is a shootout kick, not a real-time goal, when it's a
// Penalty/Missed Penalty logged at minute 120+ — API-Sports reuses the
// stoppage-time "extra" field to store the shootout kick order (1, 2,
// 3...) rather than a real added-time minute, which is what produced
// the confusing "120+1'", "120+3'" display before this fix. Reliable
// specifically because World Cup knockout matches always play a full
// 120 minutes before any shootout — a genuine in-game 120th-minute
// penalty during extra-time stoppage is a theoretical edge case this
// heuristic wouldn't distinguish, but no such case has been observed
// in the data ingested so far.
// A scorer entry is a shootout kick, not a real-time goal, only when
// BOTH: the match actually went to a shootout (hasPenalties, from the
// game's own score.penalty — the same source powering the "Penalties:
// X-Y" line) AND it's a Penalty/Missed Penalty logged at minute 120+.
// minute alone isn't enough — a genuine in-game penalty scored during
// extra-time stoppage (e.g. a 120th-minute winner that settles the tie
// outright, no shootout needed) has the identical shape and must still
// render as a normal goal with its real time, not a shootout dot.
function isShootoutKick(s, hasPenalties) {
  return hasPenalties && s.minute >= 120 && (s.detail === 'Penalty' || s.detail === 'Missed Penalty')
}

function ScorersSide({ scorers, side, mode }) {
  if (!scorers?.length) return null
  return (
    <div className={side === 'home' ? 'match-card-scorers-home' : 'match-card-scorers-away'}>
      {scorers.map((s, i) => (
        <span key={i} className="match-card-scorer-line">
          {mode === 'shootout' && (
            <span
              className={s.detail === 'Missed Penalty' ? styles.shootoutDotMiss : styles.shootoutDotScore}
            />
          )}
          {s.player}
          {mode === 'regular' && s.minute != null && (
            <span className="match-card-scorer-minute">
              {s.minute}{s.extra ? `+${s.extra}` : ''}'
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

function MatchRow({ game }) {
  const homeScore = game.score?.home ?? '–'
  const awayScore = game.score?.away ?? '–'

  // Penalty shootout — only present when the match (after 90/120 mins)
  // was decided on penalties. Regulation/extra-time score still shows
  // as-is above (e.g. "1 - 1"); this renders as a secondary line
  // directly beneath it, matching the home/away orientation of the main
  // score (no swap needed — penalty score is stored in the same
  // home/away shape as the main score in score_json).
  const penalty = game.score?.penalty
  const hasPenalties = penalty?.home != null && penalty?.away != null

  const allScorers = Array.isArray(game.scorers) ? game.scorers : []
  const homeScorersAll = allScorers.filter(s => s.team === game.home_name)
  const awayScorersAll = allScorers.filter(s => s.team === game.away_name)

  const homeRegular = homeScorersAll.filter(s => !isShootoutKick(s, hasPenalties))
  const awayRegular = awayScorersAll.filter(s => !isShootoutKick(s, hasPenalties))
  const homeShootout = homeScorersAll.filter(s => isShootoutKick(s, hasPenalties)).sort((a, b) => (a.extra || 0) - (b.extra || 0))
  const awayShootout = awayScorersAll.filter(s => isShootoutKick(s, hasPenalties)).sort((a, b) => (a.extra || 0) - (b.extra || 0))

  const hasRegularScorers = homeRegular.length > 0 || awayRegular.length > 0
  const hasShootoutScorers = homeShootout.length > 0 || awayShootout.length > 0

  const dateLabel = formatMatchDate(game.match_date)
  const venueLabel = [game.venue, game.venue_city].filter(Boolean).join(', ')
  const hasHeader = dateLabel || venueLabel

  return (
    <div className="match-card">
      {hasHeader && (
        <div className="match-card-header">
          <div className="match-card-header-row">
            {venueLabel && <span>{venueLabel}</span>}
            {venueLabel && dateLabel && <span className="match-card-header-sep">|</span>}
            {dateLabel && <span>{dateLabel}</span>}
          </div>
          <div className="match-card-header-underline" />
        </div>
      )}

      {/* game-result — global, unchanged 3-col grid */}
      <div className="game-result">
        <div className={styles.teamHome}>
          {/* club-name-game — global */}
          <span className="club-name-game">{game.home_name}</span>
          <TeamLogo logo={game.home_logo} name={game.home_name} iso2={game.home_country_iso2} />
        </div>
        {/* game-score — global */}
        <div className="game-score">
          <span className="game-score-num">{homeScore}</span>
          <span className="game-score-dash">-</span>
          <span className="game-score-num">{awayScore}</span>
        </div>
        <div className={styles.teamAway}>
          <TeamLogo logo={game.away_logo} name={game.away_name} iso2={game.away_country_iso2} />
          <span className="club-name-game">{game.away_name}</span>
        </div>

        <MatchVideo
          videoUrl={game.video_url}
          source={game.video_source}
          embeddable={game.video_embeddable}
          thumbnailUrl={game.video_thumbnail_url}
        />
      </div>

      {hasRegularScorers && (
        <div className="match-card-scorers">
          <ScorersSide scorers={homeRegular} side="home" mode="regular" />
          <span />
          <ScorersSide scorers={awayRegular} side="away" mode="regular" />
        </div>
      )}

      {hasShootoutScorers && (
        <>
          <div className={styles.shootoutDivider} />
          <div className="match-card-scorers">
            <ScorersSide scorers={homeShootout} side="home" mode="shootout" />
            <span />
            <ScorersSide scorers={awayShootout} side="away" mode="shootout" />
          </div>
        </>
      )}

      {hasPenalties && (
        <div className={styles.penaltyRow}>
          Penalties: {penalty.home} - {penalty.away}
        </div>
      )}
    </div>
  )
}

// --- Two-legged tie grouping -------------------------------------------
//
// Generic by design (Open Issue #20): groups games within a round into
// "ties" by the unordered pair of entity IDs, regardless of competition
// or era. A round made entirely of single-leg games (league phase,
// pre-2024 group matchdays, a one-off Final) produces one tie per game
// with exactly one leg — TieCard below special-cases that shape to
// render identically to a bare MatchRow, so nothing changes visually
// for those rounds.
//
// Falls back to ungrouped (one tie per game, in API order) if either
// entity ID is missing on any game in the round, rather than guessing
// at pairings from team names — name-based grouping risks merging two
// different fixtures that happen to share a display name variant.
function groupIntoTies(games) {
  const hasIds = games.every(g => g.home_id != null && g.away_id != null)
  if (!hasIds) return games.map(g => [g])

  const byKey = new Map()
  for (const g of games) {
    const key = g.home_id < g.away_id ? `${g.home_id}-${g.away_id}` : `${g.away_id}-${g.home_id}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(g)
  }

  const ties = [...byKey.values()].map(legs =>
    [...legs].sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
  )

  // Order ties by their earliest leg's date — NOT by API array order,
  // which is not guaranteed to reflect chronology across ties.
  ties.sort((a, b) => new Date(a[0].match_date) - new Date(b[0].match_date))

  return ties
}

// Aggregate score is summed per entity ID across legs, then displayed
// from leg 1's home/away orientation — so "PSG 7 - 6 Bayern" stays in
// the same left-right order as leg 1 regardless of which side was home
// in leg 2.
function TieCard({ legs }) {
  if (legs.length === 1) return <MatchRow game={legs[0]} />

  const anchor = legs[0] // leg 1, defines display orientation
  const leftId = anchor.home_id
  const rightId = anchor.away_id

  let leftGoals = 0, rightGoals = 0
  let allFinished = true
  for (const leg of legs) {
    const h = leg.score?.home
    const a = leg.score?.away
    if (h == null || a == null) { allFinished = false; continue }
    if (leg.home_id === leftId) { leftGoals += h; rightGoals += a }
    else { leftGoals += a; rightGoals += h }
  }

  const aggLabel = allFinished ? `${leftGoals} - ${rightGoals}` : null

  // Aggregate-level ties (e.g. 1-1 on goals across two legs, under UEFA's
  // away-goals-free rules) are decided by extra time and, if still level,
  // penalties IN THE FINAL LEG — the goal aggregate alone can't surface
  // a winner in that case. Fall back to the deciding leg's own
  // winner_id/penalty score when the goal aggregate is tied.
  const aggregateTied = allFinished && leftGoals === rightGoals
  const decidingLeg = legs[legs.length - 1]
  const decidingPenalty = decidingLeg?.score?.penalty
  const hasDecidingPenalty = aggregateTied && decidingPenalty?.home != null && decidingPenalty?.away != null

  let leftWins, rightWins
  if (hasDecidingPenalty) {
    // Orient the deciding leg's penalty score to the same left/right
    // anchor as the goal aggregate, since the deciding leg may have had
    // home/away swapped relative to leg 1.
    const decidingLeftPen = decidingLeg.home_id === leftId ? decidingPenalty.home : decidingPenalty.away
    const decidingRightPen = decidingLeg.home_id === leftId ? decidingPenalty.away : decidingPenalty.home
    leftWins = decidingLeftPen > decidingRightPen
    rightWins = decidingRightPen > decidingLeftPen
  } else {
    leftWins = allFinished && leftGoals > rightGoals
    rightWins = allFinished && rightGoals > leftGoals
  }

  const leftName = anchor.home_name
  const rightName = anchor.away_name

  return (
    <div className={styles.tieCard}>
      <div className={styles.tieHeader}>
        <div className={styles.tieAggLabel}>
          {aggLabel ? 'Aggregate' : `${legs.length}-leg tie`}
        </div>
        {aggLabel && (
          <div className={styles.tieAggLine}>
            <span className={`${styles.tieTeam}${leftWins ? ' ' + styles.tieTeamWinner : ''}`}>{leftName}</span>
            <span className={styles.tieAggScore}>{leftGoals} - {rightGoals}</span>
            <span className={`${styles.tieTeam}${rightWins ? ' ' + styles.tieTeamWinner : ''}`}>{rightName}</span>
          </div>
        )}
        {hasDecidingPenalty && (
          <div className={styles.tiePenaltyNote}>
            Decided on penalties: {
              decidingLeg.home_id === leftId
                ? `${decidingPenalty.home} - ${decidingPenalty.away}`
                : `${decidingPenalty.away} - ${decidingPenalty.home}`
            }
          </div>
        )}
      </div>
      {legs.map((leg, i) => (
        <div key={leg.id ?? i} className={styles.tieLeg}>
          <span className={styles.tieLegLabel}>Leg {leg.leg_number ?? i + 1}</span>
          <MatchRow game={leg} />
        </div>
      ))}
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

export default function GameTemplate({ seasonId, tabKey, tabGroup, tabName, competitionName = '', yearConvention = 'end' }) {
  const { activeYear } = useAppStore()
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [openRounds, setOpenRounds] = useState(new Set())
  const [clubFilter, setClubFilter] = useState('')

  useEffect(() => {
    if (!seasonId || (!tabKey && !tabGroup)) return
    setLoading(true)
    setError(null)
    setData(null)
    setClubFilter('')
    // tabGroup takes precedence: a synthetic merged view (e.g. League
    // Phase's "Results" tab, spanning r1..r8) that has no single
    // result_tab_id of its own. Falls back to the normal single-tab
    // lookup for every other tab on the platform, unchanged.
    const request = tabGroup
      ? api.getGamesByGroup(seasonId, tabGroup)
      : api.getGames(seasonId, tabKey)
    request
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
  }, [seasonId, tabKey, tabGroup])

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
      {[...Array(8)].map((_, i) => <div key={i} className={`skeleton ${styles.skeletonRow}`} />)}
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

  // Admin-configured title takes priority. Otherwise: knockout rounds
  // (tab_group='final_tour' — Final/Semifinals/Quarter Finals/Round of
  // 16/Round of 32) show their own round name alone, no prefix. Every
  // other case (group-stage match lists, Ligue 1's flat Results tab)
  // defaults to "Results", with the tab name suffixed same as before.
  const hasOverride = !!data.tab?.page_title
  const isKnockoutRound = data.tab?.tab_group === 'final_tour'
  const defaultTitle = isKnockoutRound ? (data.tab?.tab_name || tabName || 'Results') : 'Results'
  const pageTitle = data.tab?.page_title || defaultTitle
  const showSuffix = !hasOverride && !isKnockoutRound && tabName

  return (
    <div className={styles.wrapper}>

      {/* page-title — global */}
      <div className="page-title">
        {pageTitle}{showSuffix && <span className="title-suffix"> - {tabName}</span>}
      </div>
      <PageNotice />

      {/* 90% centred inner section */}
      <div className={styles.rounds}>

        {/* filter-bar — global */}
        <div className={styles.filterBar}>
          {selectedClubLogo && (
            <img
              src={resolveLogoUrl(selectedClubLogo)}
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
          const ties = groupIntoTies(games)

          return (
            <div key={round} className={styles.roundBlock}>
              {/* event-day — global */}
              <button
                className={`event-day${isOpen ? ' event-day-open' : ''}`}
                onClick={() => !clubFilter && toggle(round)}
                style={clubFilter ? { cursor: 'default' } : {}}
              >
                <span className="event-day-label">{round}</span>
                {/* event-day-chevron — global */}
                {!clubFilter && (
                  <span className="event-day-chevron">{isOpen ? '▲' : '▼'}</span>
                )}
              </button>
              {isOpen && (
                <div className={styles.list}>
                  {ties.map((legs, i) => <TieCard key={legs[0]?.id ?? i} legs={legs} />)}
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
