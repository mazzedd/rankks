import { useEffect, useState } from 'react'
import styles from './EventBlock.module.css'
import { api } from '../../services/api'
import useAppStore from '../../store/useAppStore'
import Flag from '../shared/Flag'
import { calcAge } from '../../utils/calcAge'
import { getDefaultSilhouette } from '../../utils/portraits'
import { getBasketballPageText } from '../../utils/basketballSubtitles'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatus(season) {
  if (!season) return 'future'
  const now = new Date()
  const start = season.start_date ? new Date(season.start_date) : null
  const end   = season.end_date   ? new Date(season.end_date)   : null
  if (season.status === 'past'    || (end   && now > end))   return 'past'
  // 'current' is the DB value for an in-progress season — treat as 'ongoing'
  if (season.status === 'ongoing' || season.status === 'current'
      || (start && now >= start && (!end || now <= end))) return 'ongoing'
  return 'future'
}

function getPortraitPath(winner, activeGender, sport) {
  if (!winner) return null
  // Prefer explicit image_url on the entity (set via admin — can be .png or .mp4)
  if (winner.image_url) return winner.image_url
  const slug = winner.entity_slug
  if (!slug) return null
  const folder = activeGender === 'F' ? 'female' : 'male'
  return `/media/athletes/${sport || 'tennis'}/${folder}/portrait/${slug}.png`
}

// getDefaultSilhouette moved to utils/portraits.js — now shared with
// F1EventBlock.jsx (which had no default silhouette at all previously,
// relying on hiding a broken <img> instead).

function isVideoPath(path) {
  if (!path) return false
  return path.toLowerCase().endsWith('.mp4') || path.toLowerCase().endsWith('.webm')
}

// Same normalization used in standings_template.jsx/players_template.jsx/
// clubs_template.jsx — guards against a logo_url entered without the
// /media/ prefix (e.g. via the Competition Logos admin page) silently
// 404ing as a broken image instead of resolving correctly.
function resolveLogoUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

function getSurfaceLabel(surface) {
  const map = { grass: 'Grass', clay: 'Clay', hard: 'Hard' }
  return map[surface?.toLowerCase()] || surface || ''
}

// ── Page notice text — edit here to update sitewide ──────────────────────────
const PAGE_NOTICE_TEXT = 'Event-time snapshot — stats reflect data as of the event date'

// All-NBA/All-Defense tabs list a 5-player team, not a single award winner —
// no individual "winner" to feature in the banner (see award-winner route
// comment in seasons.js: these tabs carry no 'winner' stats flag), so they
// fall back to showing the season's champion club instead. NBA Cup Teams is
// the same shape (one fixed 5-player All-Tournament Team, no per-row winner
// flag — see ingest-nba-cup-awards.js) and gets the identical fallback.
const TEAM_ROSTER_AWARD_TABS = new Set([
  'all-nba-1st', 'all-nba-2nd', 'all-nba-3rd', 'all-defense-1st', 'all-defense-2nd',
  'nba-cup-teams',
])

// ── Status badge ──────────────────────────────────────────────────────────────
// Exported — reused by F1EventBlock.jsx's GP status badge (ONGOING/UPCOMING
// driven by the race weekend's own date range), same shared badge language
// as every other sport rather than a one-off F1 variant.
export function StatusBadge({ status, isLive = false }) {
  if (status === 'past') return null
  if (status === 'ongoing') {
    return (
      <span className={`${styles.statusBadge} ${styles.status_ongoing}`}>
        {isLive ? '● LIVE' : 'ONGOING'}
      </span>
    )
  }
  return (
    <span className={`${styles.statusBadge} ${styles.status_future}`}>
      UPCOMING
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EventBlock({ season, competition, naming, eventNaming, logoUrl, activeYear, activeGender, activeTab, activeTabGroup, activeEvent, leadingPlayers = [], seasonStats = null, hasVideosTab = false }) {

  // Detect multiple sub_editions for same year/gender (e.g. Australian Open 1977)
  const allEditions = (season?.seasons || []).filter(se =>
    activeGender ? se.gender === activeGender : true
  )
  const subEditionNums = [...new Set(allEditions.map(se => se.sub_edition || 1))].sort()
  const hasMultiEditions = subEditionNums.length > 1

  const { activeSubEdition, setSubEdition, setTab } = useAppStore()

  // History hooks — must be before any early return (Rules of Hooks)
  const dbYear = competition?.year_convention === 'start' ? activeYear - 1 : activeYear
  const [history, setHistory] = useState(null)

  // Pre-derive winnerId for history hook (needs to be before early return)
  const _activeSeasonId = activeGender
    ? season?.seasons?.find(se => se.gender === activeGender && (se.sub_edition || 1) === activeSubEdition)?.id
    : season?.seasons?.[0]?.id
  const _winnerId = season?.winners?.find(w => w != null && w.season_id === _activeSeasonId)?.winner?.entity_id ?? null
  // NBA Cup is a genuinely separate in-season competition — its own
  // single-game Final, not the season's overall Finals — so its
  // participations/titles history must come from the Cup's own 'final'
  // tab, not the default nba-finals one every other basketball event uses.
  const _isNbaCup = competition?.sport_slug === 'basketball' && !!activeEvent?.startsWith('nba-cup')
  // Awards > "NBA Cup Teams" is conceptually part of the NBA Cup too, even
  // though it's structurally nested under the Awards event (activeEvent is
  // 'awards-4828' there, not 'nba-cup-4828') — it needs the same
  // NBA-Cup-Winner treatment, not the generic season Champion fallback
  // every other team-roster award tab (All-NBA/All-Defense) uses.
  const _isNbaCupTeamsTab = competition?.sport_slug === 'basketball' && activeTab === 'nba-cup-teams'
  useEffect(() => {
    if (!_winnerId || !competition?.id || !dbYear) { setHistory(null); return }
    api.getEntityHistory(_winnerId, competition.id, dbYear, (_isNbaCup || _isNbaCupTeamsTab) ? 'final' : undefined)
      .then(d => setHistory(d))
      .catch(() => setHistory(null))
  }, [_winnerId, competition?.id, dbYear, _isNbaCup, _isNbaCupTeamsTab])

  // "NBA Cup Teams" fetches the Cup event's OWN season/winner data
  // separately — the season prop passed into EventBlock is scoped to
  // whichever event is currently active (Awards here), so season.winners
  // only ever has the generic Finals-redirected champion, never the real
  // Cup winner. Same api.getSeason call ContentArea.jsx itself uses, just
  // fixed to the 'nba-cup-4828' event regardless of what's active.
  const [cupTeamWinner, setCupTeamWinner] = useState(null)
  useEffect(() => {
    if (!_isNbaCupTeamsTab || !competition?.slug || !activeYear) { setCupTeamWinner(null); return }
    let cancelled = false
    api.getSeason(competition.slug, activeYear, 'nba-cup-4828')
      .then(d => {
        if (cancelled) return
        const cupSeasonId = d?.seasons?.[0]?.id
        const result = d?.winners?.find(w => w != null && w.season_id === cupSeasonId) ?? null
        setCupTeamWinner(result)
      })
      .catch(() => { if (!cancelled) setCupTeamWinner(null) })
    return () => { cancelled = true }
  }, [_isNbaCupTeamsTab, competition?.slug, activeYear])

  // Basketball Awards (page 5, variant B): featured entity is the award
  // winner *player*, not the season's Finals champion team — a wholly
  // different lookup from the history hook above, backed by
  // /seasons/award-winner (stats->>'winner' flag set by ingest-nba-awards.js).
  const _isBasketballAwardsTab = competition?.sport_slug === 'basketball' && !!activeEvent?.startsWith('awards')
  const [awardWinner, setAwardWinner] = useState(null)
  useEffect(() => {
    if (!_isBasketballAwardsTab || !_activeSeasonId || !activeTab) { setAwardWinner(null); return }
    let cancelled = false
    api.getAwardWinner(_activeSeasonId, activeTab)
      .then(d => { if (!cancelled) setAwardWinner(d ?? null) })
      .catch(() => { if (!cancelled) setAwardWinner(null) })
    return () => { cancelled = true }
  }, [_isBasketballAwardsTab, _activeSeasonId, activeTab])

  const s = activeGender
    ? season?.seasons?.find(se => se.gender === activeGender && (se.sub_edition || 1) === activeSubEdition)
      ?? season?.seasons?.find(se => se.gender === activeGender)
    : season?.seasons?.[0]

  if (!s) return null

  // "NBA Cup Teams" substitutes the real Cup winner (fetched separately
  // above) for the generic Awards-scoped seasonResult, which would
  // otherwise redirect to the season's overall Finals champion.
  const seasonResult = _isNbaCupTeamsTab
    ? cupTeamWinner
    : (season?.winners?.find(w => w != null && w.season_id === s?.id) ?? null)
  const winner  = seasonResult?.winner ?? null
  const loser   = seasonResult?.loser ?? null
  const sets    = seasonResult?.sets ?? []
  const walkover = seasonResult?.walkover ?? false
  const status = getStatus(s)
  const isPast = status === 'past'

  // Colours: football/basketball use winner club colors, tennis uses competition colors
  const isFootball = competition?.sport_slug === 'football'
  const isBasketball = competition?.sport_slug === 'basketball'
  const isBasketballAwards = isBasketball && _isBasketballAwardsTab
  // NBA Cup's own Final/Rounds/Groups tabs, AND the Awards "NBA Cup Teams"
  // page — a separate in-season competition, not the season's overall NBA
  // Champion (see _isNbaCup/_isNbaCupTeamsTab and the winners-computation
  // fix in seasons.js).
  const isNbaCup = _isNbaCup || _isNbaCupTeamsTab
  // All-NBA/All-Defense pick a 5-player team, not one award winner — no
  // single club to key off, so these fall back to the season's champion
  // club (the same `winner` Regular Season/Finals/etc. use) rather than
  // going blank.
  const isTeamRosterAwardsTab = isBasketballAwards && TEAM_ROSTER_AWARD_TABS.has(activeTab)
  // Variant A (Champion, per page 5/12-13): winner IS the club, colors come
  // straight off it. Variant B (Award winner): the featured entity is a
  // player, but the banner still keys colors off their club.
  const basketballClub = isTeamRosterAwardsTab ? winner : isBasketballAwards ? awardWinner?.club : winner
  const primary   = (isFootball && winner?.club_primary_color)
    ? winner.club_primary_color
    : (isBasketball && basketballClub?.club_primary_color)
      ? basketballClub.club_primary_color
      : competition?.primary_color   || '#1a1a2e'
  const secondary = (isFootball && winner?.club_secondary_color)
    ? winner.club_secondary_color
    : (isBasketball && basketballClub?.club_secondary_color)
      ? basketballClub.club_secondary_color
      : competition?.secondary_color || '#2a2a4e'

  const wrapperStyle   = {}
  const bottomStyle    = { background: primary }
  const pageNoticeStyle = { background: secondary }

  // Portrait / right-slot
  const sport = competition?.sport_slug || 'tennis'
  const isScorersTab = activeTab === 'scorers' || activeTab === 'passers'

  let portraitSrc
  let showClubLogo = false
  let clubLogoSrc = null

  if (isBasketball) {
    if (isTeamRosterAwardsTab) {
      // No single award winner — show the season champion's club logo,
      // same as Regular Season/Finals/Playoffs/Play-in/All-Star.
      if (winner) {
        showClubLogo = true
        const rawLogo = winner.image_url || ''
        clubLogoSrc = rawLogo
          ? rawLogo.startsWith('/media/') ? rawLogo : `/media/${rawLogo}`
          : null
      }
      portraitSrc = null
    } else if (isBasketballAwards) {
      // Variant B: player portrait, same convention as tennis/other sports.
      portraitSrc = isPast && awardWinner?.player
        ? getPortraitPath(awardWinner.player, activeGender, sport)
        : getDefaultSilhouette(sport, activeGender)
    } else if (winner) {
      // Variant A: club logo, same convention as football.
      showClubLogo = true
      const rawLogo = winner.image_url || ''
      clubLogoSrc = rawLogo
        ? rawLogo.startsWith('/media/') ? rawLogo : `/media/${rawLogo}`
        : null
      portraitSrc = null
    }
  } else if (isFootball && winner) {
    if (isScorersTab) {
      portraitSrc = null
    } else {
      showClubLogo = true
      const rawLogo = winner.image_url || ''
      clubLogoSrc = rawLogo
        ? rawLogo.startsWith('/media/') ? rawLogo : `/media/${rawLogo}`
        : null
      portraitSrc = null
    }
  } else {
    // Tennis and future/ongoing: always show portrait or default silhouette
    portraitSrc = isPast && winner
      ? getPortraitPath(winner, activeGender, sport)
      : getDefaultSilhouette(sport, activeGender)
  }

  // Which entity the generic portrait/video branch below is depicting —
  // normally the same as `winner`, except basketball's Awards variant B,
  // where `winner` (from season.winners) is always the Finals champion
  // *team*, decoupled from whichever award tab is active — the portrait
  // there must instead track the award-winning player.
  const portraitEntity = isBasketballAwards ? awardWinner?.player : winner

  // Competition info
  const name         = naming?.official_name || competition?.name || ''
  const surface      = getSurfaceLabel(competition?.surface)
  const categoryName = eventNaming?.official_name || competition?.category_name || ''

  // Basketball areaTitle: variant A is always "Champion" regardless of which
  // sub-tab is active (Standings/Results/Players/Teams all share one
  // season-level champion banner) — All-NBA/All-Defense (team-roster) tabs
  // fall back to this same "Champion" label since they show the champion
  // club banner too, not an individual winner. Genuine single-winner award
  // tabs (MVP/DPOY/etc) show the full descriptive name instead of the short
  // tab label, e.g. "Most Valuable Player (MVP)" — reusing the page-title
  // lookup already built for the content templates' own headers.
  const basketballAreaTitle = isBasketball
    ? (isBasketballAwards && !isTeamRosterAwardsTab
        ? (() => {
            const pt = getBasketballPageText(activeEvent, activeTab, activeYear, isPast)
            return pt ? `${pt.kind} (${pt.title})` : ''
          })()
        : isNbaCup ? 'NBA Cup Winner' : 'Champion')
    : null

  if (!competition) return null
  return (
    <div className={styles.wrapper} style={wrapperStyle}>

      {/* ── Zone 2: Banner ── */}
      <div className={styles.banner}>

        {/* ── Main content row ── */}
        <div className={styles.inner}>

          {/* Left: logo + event info */}
          <div className={styles.left}>
            <div className={styles.logoWrap}>
              {(logoUrl || competition.logo_url)
                ? <img src={resolveLogoUrl(logoUrl || competition.logo_url)} alt={name} className={styles.logo} />
                : <span className={styles.logoText}>{name.slice(0, 2).toUpperCase()}</span>
              }
            </div>

            <div className={styles.info}>
              <div className={styles.categoryRow}>
                <span className={styles.category}>
                  {categoryName}{surface ? ` · ${surface}` : ''}
                </span>
                <StatusBadge status={status} isLive={false} />
                {hasMultiEditions && (
                  <div className={styles.editionToggle}>
                    {subEditionNums.map(n => (
                      <button
                        key={n}
                        className={[styles.editionBtn, activeSubEdition === n ? styles.editionBtnActive : ''].join(' ')}
                        onClick={() => setSubEdition(n)}
                      >
                        {n === 1 ? 'Jan' : 'Dec'} {activeYear}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className={styles.eventName}>
                {name} {activeYear}
              </div>
              <div className={styles.areaTitle}>
                {basketballAreaTitle ?? getAreaTitle(activeTab, isScorersTab ? leadingPlayers.length > 0 : !!winner, isPast)}
              </div>
              {isBasketball && !isBasketballAwards && winner && isPast && sets.length === 0 && (
                <div className={styles.winnerName}>{winner.display_name || winner.canonical_name}</div>
              )}
              {isTeamRosterAwardsTab && winner && isPast && sets.length === 0 && (
                <div className={styles.winnerName}>{winner.display_name || winner.canonical_name}</div>
              )}
              {isBasketballAwards && !isTeamRosterAwardsTab && awardWinner?.player && isPast && (
                <div className={styles.winnerName}>
                  {awardWinner.player.canonical_name}
                  {awardWinner.club && (
                    <span className={styles.scorerNames}> — {awardWinner.club.canonical_name}</span>
                  )}
                </div>
              )}
              {isFootball && winner && (sets.length === 0 || walkover) && (
                <div className={isScorersTab && leadingPlayers.length > 1 ? styles.scorerNames : styles.winnerName}>
                  {isScorersTab
                    ? leadingPlayers.length > 0
                      ? (() => {
                          const statKey = activeTab === 'passers' ? 'assists' : 'goals'
                          const val = leadingPlayers[0]?.[statKey] ?? ''
                          const names = leadingPlayers
                            .map(p => p.display_name || p.canonical_name)
                            .join(', ')
                          return `${names}${val !== '' ? ` (${val})` : ''}`
                        })()
                      : null
                    : winner.canonical_name}
                </div>
              )}
            </div>

            {/* Col 1 row 2: spacer */}
            <div />

            {/* Col 2 row 2: score block */}
            {/* Champion score/opponent row is a team-context element (Regular
                Season/Finals/Playoffs/Play-in/All-Star/All-Time, and the
                All-NBA/All-Defense roster tabs which fall back to the same
                champion club) — individual award "Player" pages (MVP,
                Finals MVP, DPOY, 6MOY, MIP, ROY) feature a player portrait
                instead and have no business showing the Finals series. */}
            {isPast && winner && sets.length > 0 && !walkover && !(isBasketballAwards && !isTeamRosterAwardsTab)
              ? <div className={styles.scoreBlock}>
                  {[
                    { entity: winner, dim: false },
                    { entity: loser,  dim: true  },
                  ].filter(r => r.entity).map((row, i) => (
                    <div key={i} className={styles.scoreRow}>
                      {!isBasketball && (
                        <Flag iso2={row.entity.country_iso2} name={row.entity.country_iso2} className={styles.scoreFlag} />
                      )}
                      {/* Issue 2: no wrap, truncate long names */}
                      <span className={`${styles.scorePlayer} ${row.dim ? styles.scoreLoser : ''}`}>
                        {row.entity.display_name || row.entity.canonical_name}
                      </span>
                      {/* Issue 3: fixed-width set cells, tiebreak inline */}
                      <span className={styles.scoreSetGroup}>
                        {sets.map((set, j) => {
                          const myScore  = row.dim ? set.l : set.w
                          const oppScore = row.dim ? set.w : set.l
                          const wonSet   = myScore > oppScore
                          return (
                            <span key={j} className={styles.scoreSetCell}>
                              <span className={`${styles.scoreSet} ${wonSet ? '' : styles.scoreSetDim}`}>
                                {myScore}
                              </span>
                              {/* Tiebreak: always reserve space, only show when applicable */}
                              <span className={styles.scoreTbSlot}>
                                {set.tb != null && wonSet
                                  ? <sup className={styles.scoreTb}>{set.tb}</sup>
                                  : null
                                }
                              </span>
                            </span>
                          )
                        })}
                      </span>
                      {isBasketball && (
                        <span className={`${styles.scoreTotal} ${row.dim ? styles.scoreLoser : ''}`}>
                          <span className={styles.scoreDivider} />
                          <span className={styles.scoreTotalNum}>
                            {sets.reduce((n, st) => n + (row.dim ? st.l : st.w), 0)}
                          </span>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              : isPast && winner && !isFootball && !isBasketball && (sets.length === 0 || walkover)
                ? <div className={styles.winnerName} style={{ gridColumn: 2, gridRow: 2 }}>{winner.canonical_name}</div>
                : <div />
            }
          </div>

          {/* Right: club logo / scorer portrait / default */}
          {isScorersTab && isFootball && leadingPlayers.length === 2 ? (
            <div className={styles.portraitDuo}>
              {leadingPlayers.map((p, i) => (
                <img
                  key={i}
                  src={`/media/athletes/football/male/portrait/${p.slug}.png`}
                  alt={p.canonical_name}
                  className={styles.portraitHalf}
                  onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette(sport, activeGender) }}
                />
              ))}
            </div>
          ) : (
            <div className={styles.portraitWrap}>
              {isScorersTab && isFootball ? (
                leadingPlayers.length === 1 ? (
                  <img
                    src={`/media/athletes/football/male/portrait/${leadingPlayers[0].slug}.png`}
                    alt={leadingPlayers[0].canonical_name}
                    className={styles.scorerAvatar}
                    onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette(sport, activeGender) }}
                  />
                ) : (
                  <img
                    src={getDefaultSilhouette(sport, activeGender)}
                    alt=""
                    className={`${styles.scorerAvatar} ${styles.portraitDefault}`}
                  />
                )
              ) : showClubLogo ? (
                clubLogoSrc
                  ? <img
                      src={clubLogoSrc}
                      alt={winner?.canonical_name || ''}
                      className={styles.clubLogo}
                      onError={e => {
                        if (isBasketball && e.target.src !== new URL('/media/default/basketball/club.png', window.location.href).href) {
                          e.target.src = '/media/default/basketball/club.png'
                        } else {
                          e.target.style.display = 'none'
                        }
                      }}
                    />
                  : isBasketball
                    ? <img src="/media/default/basketball/club.png" alt="" className={styles.clubLogo} />
                    : <Flag iso2={winner?.country_iso2} name={winner?.canonical_name} className={styles.clubLogo} />
              ) : (
                // Tennis + future/ongoing: video (one-shot) or portrait image or default silhouette
                isPast && portraitEntity && isVideoPath(portraitSrc)
                  ? <video
                      key={portraitSrc}
                      className={styles.portrait}
                      autoPlay
                      muted
                      playsInline
                      onEnded={e => { e.target.pause() }}
                    >
                      <source src={portraitSrc} type="video/mp4" />
                    </video>
                  : portraitSrc
                    ? <img
                        src={portraitSrc}
                        alt={portraitEntity?.canonical_name || ''}
                        className={`${styles.portrait} ${!isPast || !portraitEntity ? styles.portraitDefault : ''}`}
                        onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette(sport, activeGender) }}
                      />
                    : null
              )}
            </div>
          )}
        </div>

        {/* ── Zone 3: Stats bar ── */}
        <div className={styles.bottom} style={bottomStyle}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Schedule</span>
            <span className={styles.statVal}>
              {`${activeYear - 1}–${activeYear}`}
            </span>
          </div>

          {/* Edition is the NBA's own franchise-age counter (79th NBA
              season, etc.) — meaningless on NBA Cup pages, which have their
              own much shorter 3-edition history unrelated to it. */}
          {!isNbaCup && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Edition</span>
                <span className={styles.statVal}>
                  {competition?.founded_year
                    ? (() => {
                        const cancelled = (competition.cancelled_years || []).filter(y => y <= activeYear).length
                        return activeYear - competition.founded_year + 1 - cancelled
                      })()
                    : s?.edition_number || '—'}
                </span>
              </div>
            </>
          )}

          {isFootball && seasonStats ? (
            <>
              {activeTab === 'final_tour' && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Teams</span>
                    <span className={styles.statVal}>{seasonStats.teams}</span>
                  </div>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Players</span>
                    <span className={styles.statVal}>{seasonStats.players}</span>
                  </div>
                </>
              )}
              {(activeTab === 'players' || activeTab === 'clubs') && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Teams</span>
                    <span className={styles.statVal}>{seasonStats.teams}</span>
                  </div>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Players</span>
                    <span className={styles.statVal}>{seasonStats.players}</span>
                  </div>
                </>
              )}
              {activeTab === 'scorers' && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Goals</span>
                    <span className={styles.statVal}>{seasonStats.goals}</span>
                  </div>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Scorers</span>
                    <span className={styles.statVal}>{seasonStats.scorers}</span>
                  </div>
                  {seasonStats.goals_per_match && (
                    <>
                      <div className={styles.statSep} />
                      <div className={styles.statBlock}>
                        <span className={styles.statLabel}>Goals / Match</span>
                        <span className={styles.statVal}>{seasonStats.goals_per_match}</span>
                      </div>
                    </>
                  )}
                </>
              )}
              {activeTab === 'passers' && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Assists</span>
                    <span className={styles.statVal}>{seasonStats.assists}</span>
                  </div>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Passers</span>
                    <span className={styles.statVal}>{seasonStats.passers}</span>
                  </div>
                  {seasonStats.assists_per_match && (
                    <>
                      <div className={styles.statSep} />
                      <div className={styles.statBlock}>
                        <span className={styles.statLabel}>Assists / Match</span>
                        <span className={styles.statVal}>{seasonStats.assists_per_match}</span>
                      </div>
                    </>
                  )}
                </>
              )}
              {(activeTab === 'standings' || activeTabGroup === 'final_tour' || activeTabGroup === 'group_stages') && isPast && history != null && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Participations / Titles</span>
                    <span className={styles.statVal}>{history.participations} / {history.titles}</span>
                  </div>
                  {history.titles > 1 && history.prev_title_year && (
                    <>
                      <div className={styles.statSep} />
                      <div className={styles.statBlock}>
                        <span className={styles.statLabel}>Last Title</span>
                        <span className={styles.statVal}>
                          {history.prev_title_year}
                          <span className={styles.statSub}> | {activeYear - history.prev_title_year} years ago</span>
                        </span>
                      </div>
                    </>
                  )}
                  {history.titles === 1 && (
                    <>
                      <div className={styles.statSep} />
                      <div className={styles.statBlock}>
                        <span className={styles.statLabel}>Last Title</span>
                        <span className={styles.statVal}>
                          {activeYear}
                          <span className={styles.statSub}> | 1ST TITLE</span>
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          ) : isBasketballAwards && !isTeamRosterAwardsTab ? (
            awardWinner?.career && (
              <>
                {awardWinner.career.finals > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>NBA Finals / Titles</span>
                      <span className={styles.statVal}>{awardWinner.career.finals} / {awardWinner.career.titles}</span>
                    </div>
                  </>
                )}
                {awardWinner.career.mvp > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>MVP</span>
                      <span className={styles.statVal}>{awardWinner.career.mvp}</span>
                    </div>
                  </>
                )}
                {awardWinner.career['finals-mvp'] > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>Finals MVP</span>
                      <span className={styles.statVal}>{awardWinner.career['finals-mvp']}</span>
                    </div>
                  </>
                )}
                {awardWinner.career.dpoy > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>DPOY</span>
                      <span className={styles.statVal}>{awardWinner.career.dpoy}</span>
                    </div>
                  </>
                )}
                {awardWinner.career.smoy > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>6MOY</span>
                      <span className={styles.statVal}>{awardWinner.career.smoy}</span>
                    </div>
                  </>
                )}
                {awardWinner.career.mip > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>MIP</span>
                      <span className={styles.statVal}>{awardWinner.career.mip}</span>
                    </div>
                  </>
                )}
                {awardWinner.career.roy > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>ROY</span>
                      <span className={styles.statVal}>{awardWinner.career.roy}</span>
                    </div>
                  </>
                )}
                {awardWinner.career['all-nba-1st'] > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>All-NBA 1st</span>
                      <span className={styles.statVal}>{awardWinner.career['all-nba-1st']}</span>
                    </div>
                  </>
                )}
                {awardWinner.career['all-defense-1st'] > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>All-Def. 1st</span>
                      <span className={styles.statVal}>{awardWinner.career['all-defense-1st']}</span>
                    </div>
                  </>
                )}
                {awardWinner.career['all-defense-2nd'] > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>All-Def. 2nd</span>
                      <span className={styles.statVal}>{awardWinner.career['all-defense-2nd']}</span>
                    </div>
                  </>
                )}
                {awardWinner.career['nba-cup-mvp'] > 0 && (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>NBA Cup MVP</span>
                      <span className={styles.statVal}>{awardWinner.career['nba-cup-mvp']}</span>
                    </div>
                  </>
                )}
                {(() => {
                  const age = calcAge(awardWinner.player?.birth_date, s?.end_date, awardWinner.player?.death_date)
                  return age != null && (
                    <>
                      <div className={styles.statSep} />
                      <div className={styles.statBlock}>
                        <span className={styles.statLabel}>Age</span>
                        <span className={styles.statVal}>{age}</span>
                      </div>
                    </>
                  )
                })()}
              </>
            )
          ) : !isFootball && (
            <>
              {/* Teams/Players — always the season's Regular Season totals
                  (backend resolves to that event's own season_id regardless
                  of which basketball event is active), shown consistently
                  across Regular Season/Finals/Playoffs/Play-in/NBA Cup/
                  All-Star/All-Time — not gated to specific tabs. */}
              {isBasketball && seasonStats && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Teams</span>
                    <span className={styles.statVal}>{seasonStats.teams}</span>
                  </div>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Players</span>
                    <span className={styles.statVal}>{seasonStats.players}</span>
                  </div>
                </>
              )}

              {isPast && history != null && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>{isNbaCup ? 'NBA Cup Finals / Titles' : isBasketball ? 'NBA Finals / Titles' : 'Participations / Titles'}</span>
                    <span className={styles.statVal}>{history.participations} / {history.titles}</span>
                  </div>
                </>
              )}

              {isPast && winner && (() => {
                const age  = calcAge(winner.birth_date, s?.end_date, winner.death_date)
                const rank = winner.rank_at_event
                if (age || rank) return (
                  <>
                    <div className={styles.statSep} />
                    <div className={styles.statBlock}>
                      <span className={styles.statLabel}>Age / Rank</span>
                      <span className={styles.statVal}>
                        {age ?? '—'} / {rank ?? '—'}
                      </span>
                    </div>
                  </>
                )
                return null
              })()}

              {isPast && history?.titles > 1 && history?.prev_title_year && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Last Title</span>
                    <span className={styles.statVal}>
                      {history.prev_title_year}
                      <span className={styles.statSub}> | {activeYear - history.prev_title_year} years ago</span>
                    </span>
                  </div>
                </>
              )}

              {isPast && history?.titles === 1 && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Last Title</span>
                    <span className={styles.statVal}>
                      {activeYear}
                      <span className={styles.statSub}> | 1ST TITLE</span>
                    </span>
                  </div>
                </>
              )}
            </>
          )}

          <div className={styles.rankks}>RANKKS</div>
        </div>
      </div>

      {/* ── Zone 4: Page notice ── */}
      <div className={styles.pageNotice} style={pageNoticeStyle}>
        <span className={styles.pageNoticeText}>{PAGE_NOTICE_TEXT}</span>
      </div>

    </div>
  )
}

// ── Utils ─────────────────────────────────────────────────────────────────────
// fmt() and calcAge() were previously defined locally here — fmt() was
// dead code (defined, never called anywhere in this file); calcAge()
// was a full duplicate of utils/calcAge.js's identical implementation,
// just never imported. Both removed; calcAge is now the shared import
// above, same function football/tennis/F1 all already use elsewhere.

function getAreaTitle(tab, withChampion = false, isPast = true) {
  const map = {
    'draw-singles-m': ["Men's single",        "Men's single champion",          "Men's single champion"        ],
    'draw-singles-f': ["Women's single",       "Women's single champion",         "Women's single champion"       ],
    'draw-doubles-m': ["Men's double",         "Men's double champions",          "Men's double champions"        ],
    'draw-doubles-f': ["Women's double",       "Women's double champions",        "Women's double champions"      ],
    'draw-doubles-x': ["Mixed double",         "Mixed double champions",          "Mixed double champions"        ],
    'players-m':      ["Men's players list",   "Men's players list",              "Men's players list"            ],
    'players-f':      ["Women's players list", "Women's players list",            "Women's players list"          ],
    'standings':      ["League standings",     "Winner",                          "Current league leader"         ],
    'results':        ["Results",              "Winner",                           "Current league leader"         ],
    'final_tour':     ["Results",              "Winner        ",                 "Current league leader"         ],
    'scorers':        ["Top scorers",          "Top scorer",                      "Current top scorer"            ],
    'passers':        ["Assists",              "Assist leader",                   "Current assist leader"         ],
    'players':        ["Players",              "Winner",                        "Current league leader"         ],
    // World Cup's actual tab_keys — the banner always shows the overall
    // tournament winner regardless of which sub-tab is active, so every
    // one of these uses the same "Winner" wording.
    'final':          ["Final",                "Winner",                          "Live"                          ],
    '3rd-place':      ["3rd Place",            "Winner",                          "Live"                          ],
    'semi-finals':    ["Semifinals",           "Winner",                          "Live"                          ],
    'quarter-finals': ["Quarter Finals",       "Winner",                          "Live"                          ],
    'round-of-16':    ["Round of 16",          "Winner",                          "Live"                          ],
    'round-of-32':    ["Round of 32",          "Winner",                          "Live"                          ],
    'countries':      ["Countries",            "Winner",                          "Current leader"                ],
  }
  // Group tabs are dynamic (group-a through group-l, or beyond) — a
  // fixed map can't cover every letter, so match by prefix instead.
  if (tab?.startsWith('group-')) {
    if (!withChampion) return 'Group Stage'
    return isPast ? 'Winner' : 'Live'
  }
  const entry = map[tab]
  if (!entry) return ''
  if (!withChampion) return entry[0]
  return isPast ? entry[1] : entry[2]
}
