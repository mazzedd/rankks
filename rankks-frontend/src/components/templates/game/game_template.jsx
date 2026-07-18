import { useEffect, useState, useMemo } from 'react'
import useAppStore from '../../../store/useAppStore'
import PageNotice from '../../PageNotice/PageNotice'
import { api } from '../../../services/api'
import MatchVideo from '../../shared/MatchVideo'
import Flag from '../../shared/Flag'
import { fmtDate } from '../../../utils/calcAge'
import { getBasketballPageText } from '../../../utils/basketballSubtitles'
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

// isShootoutKick, ScorersSide, MatchRow use fmtDate (imported from
// utils/calcAge.js) for match dates — dd.mm.yyyy, the platform-wide
// canonical format. Previously this file had its own formatMatchDate()
// using en-GB locale (07/03/2026, slashes) — inconsistent with F1's
// dot-separated format; now unified.

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

  // Winner (team name + score) renders bold, loser stays regular weight —
  // draws (winner_id null, e.g. football regular season) leave both regular,
  // unchanged from before this was added.
  const homeIsWinner = game.winner_id != null && game.winner_id === game.home_id
  const awayIsWinner = game.winner_id != null && game.winner_id === game.away_id

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

  const dateLabel = game.match_date ? fmtDate(game.match_date) : null
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
          {/* club-name-game — global. Both the name and score classes default
              to a non-regular weight (600/700), so the non-winning side needs
              an explicit lighter weight, not just "leave unset" — otherwise
              it'd inherit the bold-ish default instead of looking genuinely
              regular. Draws (no winner_id, e.g. football) leave both sides
              at this same regular weight — no false emphasis on either team. */}
          <span className="club-name-game" style={{ fontWeight: homeIsWinner ? 700 : 400 }}>{game.home_display_name}</span>
          <TeamLogo logo={game.home_logo} name={game.home_display_name} iso2={game.home_country_iso2} />
        </div>
        <div className="game-score">
          <span className="game-score-num" style={{ fontWeight: homeIsWinner ? 700 : 400 }}>{homeScore}</span>
          <span className="game-score-dash">-</span>
          <span className="game-score-num" style={{ fontWeight: awayIsWinner ? 700 : 400 }}>{awayScore}</span>
        </div>
        <div className={styles.teamAway}>
          <TeamLogo logo={game.away_logo} name={game.away_display_name} iso2={game.away_country_iso2} />
          <span className="club-name-game" style={{ fontWeight: awayIsWinner ? 700 : 400 }}>{game.away_display_name}</span>
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
// seriesMode: a best-of-N series (basketball playoffs) is decided by game-win
// count ("4-2"), not summed score across games — reusing the football
// aggregate-score path here would show a meaningless points total instead of
// a series record. groupIntoTies' grouping/date-ordering logic is unaffected
// and already generalizes to either shape; only the scoring/label output
// branches.
function TieCard({ legs, seriesMode = false }) {
  if (legs.length === 1) return <MatchRow game={legs[0]} />

  const anchor = legs[0] // leg 1, defines display orientation
  const leftId = anchor.home_id
  const rightId = anchor.away_id

  if (seriesMode) {
    let leftWinsCount = 0, rightWinsCount = 0
    for (const leg of legs) {
      if (leg.home_won == null) continue
      const winnerId = leg.home_won ? leg.home_id : leg.away_id
      if (winnerId === leftId) leftWinsCount++
      else if (winnerId === rightId) rightWinsCount++
    }
    const leftName = anchor.home_display_name
    const rightName = anchor.away_display_name
    const leftWins = leftWinsCount > rightWinsCount
    const rightWins = rightWinsCount > leftWinsCount

    return (
      <div className={styles.tieCard}>
        <div className={styles.tieHeader}>
          <div className={styles.tieAggLabel}>Series</div>
          <div className={styles.tieAggLine}>
            <span className={`${styles.tieTeam}${leftWins ? ' ' + styles.tieTeamWinner : ''}`}>{leftName}</span>
            <span className={styles.tieAggScore}>
              <span className={rightWins ? styles.tieAggScoreLoser : ''}>{leftWinsCount}</span>
              {' - '}
              <span className={leftWins ? styles.tieAggScoreLoser : ''}>{rightWinsCount}</span>
            </span>
            <span className={`${styles.tieTeam}${rightWins ? ' ' + styles.tieTeamWinner : ''}`}>{rightName}</span>
          </div>
        </div>
        {legs.map((leg, i) => (
          <div key={leg.id ?? i} className={styles.tieLeg}>
            <span className={styles.tieLegLabel}>Game {leg.leg_number ?? i + 1}</span>
            <MatchRow game={leg} />
          </div>
        ))}
      </div>
    )
  }

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

  const leftName = anchor.home_display_name
  const rightName = anchor.away_display_name

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

// Sorts rounds by their games' actual dates rather than parsing the round-name
// string — a label like "Round of 16" happens to end in a number, but round
// names in general don't (basketball's "East Conf. Semifinals" has none), so
// string-parsing can't generalize across sports. Most-recent-round-first
// (descending), matching the existing UX of showing the latest stage at the
// top — same effective order UCL's old label-parsing produced, but for the
// right reason instead of an alphabetical coincidence (Final/Semi-Final/
// Quarter-Final all defaulted to 0 and happened to alphabetize correctly).
function sortRounds(rounds, gamesByRound = {}) {
  const maxDate = (round) => (gamesByRound[round] || []).reduce((max, g) => {
    if (!g.match_date) return max
    const d = new Date(g.match_date)
    return !max || d > max ? d : max
  }, null)

  return [...rounds].sort((a, b) => {
    const dateA = maxDate(a)
    const dateB = maxDate(b)
    if (dateA && dateB) return dateB - dateA
    if (dateA) return -1
    if (dateB) return 1
    return a.localeCompare(b)
  })
}

export default function GameTemplate({ seasonId, tabKey, tabGroup, tabName, competitionName = '', yearConvention = 'end', sport, activeEvent, isPast }) {
  const seriesMode = sport === 'basketball'
  const { activeYear } = useAppStore()
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [openRounds, setOpenRounds] = useState(new Set())
  const [clubFilter, setClubFilter] = useState('')
  const [search, setSearch]         = useState('')
  const [vsFilter, setVsFilter]     = useState('')

  useEffect(() => {
    if (!seasonId || (!tabKey && !tabGroup)) return
    setLoading(true)
    setError(null)
    setData(null)
    setClubFilter('')
    setSearch('')
    setVsFilter('')
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
          setOpenRounds(new Set([sortRounds(raw, d.games_by_round)[0]]))
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [seasonId, tabKey, tabGroup])

  // Team B's options exclude whichever team is picked as Team A, so a Team A
  // change can leave a stale Team B selection referring to a now-unlistable
  // (or the newly-picked Team A's own) option — reset it.
  useEffect(() => { setVsFilter('') }, [clubFilter])

  // Uses each team's era-correct display_name (from entity_names, resolved
  // server-side for this season's year) rather than canonical_name — a
  // relocated/renamed franchise (e.g. Seattle SuperSonics -> Oklahoma City
  // Thunder) should list and filter under whatever it was actually called
  // that season, not its current name. Every game on one page is already
  // the same season/year, so display_name is stable across the whole set.
  const clubs = useMemo(() => {
    if (!data?.games_by_round) return []
    const set = new Set()
    Object.values(data.games_by_round).forEach(games =>
      games.forEach(g => { set.add(g.home_display_name); set.add(g.away_display_name) })
    )
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [data])

  // Team B list — every team except whichever is picked as Team A, so the
  // two dropdowns can never both point at the same club.
  const vsClubs = useMemo(() => clubs.filter(c => c !== clubFilter), [clubs, clubFilter])

  // Combines all three Results-page filters: free-text search (matches
  // either team), Team A alone (all of that team's games), or Team A + Team
  // B together (head-to-head only — just the games between those two).
  const gameMatches = (g) => {
    if (search) {
      const q = search.toLowerCase()
      if (!g.home_display_name.toLowerCase().includes(q) && !g.away_display_name.toLowerCase().includes(q)) return false
    }
    if (clubFilter && vsFilter) {
      const names = [g.home_display_name, g.away_display_name]
      return names.includes(clubFilter) && names.includes(vsFilter)
    }
    if (clubFilter) {
      return g.home_display_name === clubFilter || g.away_display_name === clubFilter
    }
    return true
  }
  const hasFilter = !!(search || clubFilter || vsFilter)

  const selectedClubLogo = useMemo(() => {
    if (!clubFilter || !data?.games_by_round) return null
    for (const games of Object.values(data.games_by_round)) {
      for (const g of games) {
        if (g.home_display_name === clubFilter) return g.home_logo
        if (g.away_display_name === clubFilter) return g.away_logo
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
  const sortedRounds = sortRounds(rawRounds, data.games_by_round)

  const visibleRounds = hasFilter
    ? sortedRounds.filter(round => (data.games_by_round[round] || []).some(gameMatches))
    : sortedRounds

  const effectiveOpen = (round) => hasFilter ? true : openRounds.has(round)

  // Admin-configured title takes priority. Otherwise: knockout rounds
  // (tab_group='final_tour' — Final/Semifinals/Quarter Finals/Round of
  // 16/Round of 32) show their own round name alone, no prefix. Every
  // other case (group-stage match lists, Ligue 1's flat Results tab)
  // defaults to "Results", with the tab name suffixed same as before.
  const hasOverride = !!data.tab?.page_title
  const isKnockoutRound = data.tab?.tab_group === 'final_tour'
  const basketballPageText = sport === 'basketball' ? getBasketballPageText(activeEvent, tabKey, activeYear, isPast) : null
  const defaultTitle = basketballPageText?.title || (isKnockoutRound ? (data.tab?.tab_name || tabName || 'Results') : 'Results')
  const pageTitle = data.tab?.page_title || defaultTitle
  const showSuffix = !hasOverride && !isKnockoutRound && tabName && !basketballPageText

  return (
    <div className={styles.wrapper}>

      {/* page-title — global */}
      <div className="page-title">
        {pageTitle}{showSuffix && <span className="title-suffix"> - {tabName}</span>}
      </div>
      {basketballPageText && (
        <div className={styles.subtitle}>{basketballPageText.subtitle}</div>
      )}
      <PageNotice />

      {/* 90% centred inner section */}
      <div className={styles.rounds}>

        {/* filter-bar — global. tabKey === 'results' (basketball's flat
            Results tab, per explicit request) gets the 3-field head-to-head
            layout: free-text search, Team A, Team B (excludes whatever's
            picked as Team A) — selecting both narrows to just the games
            between those two teams. Every other tab (Playoffs/Finals/Play-in,
            football's own flat Results) keeps the original single-club
            dropdown unchanged. */}
        <div className={styles.filterBar}>
          {tabKey === 'results' ? (
            <>
              <input
                className="filter-label"
                style={{ minWidth: 160 }}
                placeholder="Search team..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {selectedClubLogo && (
                <img src={resolveLogoUrl(selectedClubLogo)} alt={clubFilter} className="filter-logo" />
              )}
              <select
                className="filter-label"
                style={{ minWidth: 180, appearance: 'auto' }}
                value={clubFilter}
                onChange={e => setClubFilter(e.target.value)}
              >
                <option value=''>All teams</option>
                {clubs.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                className="filter-label"
                style={{ minWidth: 180, appearance: 'auto' }}
                value={vsFilter}
                disabled={!clubFilter}
                onChange={e => setVsFilter(e.target.value)}
              >
                <option value=''>Vs team...</option>
                {vsClubs.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {hasFilter && (
                <button className="filter-reset" onClick={() => { setSearch(''); setClubFilter(''); setVsFilter('') }}>
                  Clear
                </button>
              )}
            </>
          ) : (
            <>
              {selectedClubLogo && (
                <img src={resolveLogoUrl(selectedClubLogo)} alt={clubFilter} className="filter-logo" />
              )}
              <select
                className="filter-label"
                style={{ minWidth: 180, appearance: 'auto' }}
                value={clubFilter}
                onChange={e => setClubFilter(e.target.value)}
              >
                {/* Basketball calls these "teams" (Playoffs/Finals/Play-in/
                    NBA Cup Rounds all land in this branch) — football's own
                    non-'results' tabs sharing this branch (e.g. Ligue 1
                    Results) keep "clubs", their actual terminology. */}
                <option value=''>{sport === 'basketball' ? 'All teams' : 'All clubs'}</option>
                {clubs.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {clubFilter && (
                <button className="filter-reset" onClick={() => setClubFilter('')}>Clear</button>
              )}
            </>
          )}
        </div>

        {/* Rounds */}
        {visibleRounds.map(round => {
          const allGames = data.games_by_round[round] || []
          const games = hasFilter ? allGames.filter(gameMatches) : allGames
          const isOpen = effectiveOpen(round)
          // Regular Season's Results tab buckets games by calendar month, not
          // by a discrete series/matchday — two teams can legitimately meet
          // twice in the same month with no series relationship between the
          // games (unlike Playoffs/Play-in/Finals, where a repeat matchup in
          // one round IS a tracked best-of-N series). Grouping those into a
          // TieCard would mislabel unrelated games as a fake "2-0 series".
          const ties = tabKey === 'results' ? games.map(g => [g]) : groupIntoTies(games)

          return (
            <div key={round} className={styles.roundBlock}>
              {/* event-day — global */}
              <button
                className={`event-day${isOpen ? ' event-day-open' : ''}`}
                onClick={() => !hasFilter && toggle(round)}
                style={hasFilter ? { cursor: 'default' } : {}}
              >
                <span className="event-day-label">{round}</span>
                {/* event-day-chevron — global */}
                {!hasFilter && (
                  <span className="event-day-chevron">{isOpen ? '▲' : '▼'}</span>
                )}
              </button>
              {isOpen && (
                <div className={styles.list}>
                  {ties.map((legs, i) => <TieCard key={legs[0]?.id ?? i} legs={legs} seriesMode={seriesMode} />)}
                </div>
              )}
            </div>
          )
        })}

        {hasFilter && visibleRounds.length === 0 && (
          <p className={styles.message}>
            {clubFilter && vsFilter ? `No results for ${clubFilter} vs ${vsFilter}.` : `No results found.`}
          </p>
        )}
      </div>
    </div>
  )
}
