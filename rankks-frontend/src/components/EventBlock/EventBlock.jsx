import { Fragment, useEffect, useState } from 'react'
import styles from './EventBlock.module.css'
import { api } from '../../services/api'
import useAppStore from '../../store/useAppStore'
import Flag from '../shared/Flag'
import { calcAge, fmtDateRange } from '../../utils/calcAge'
import { getDefaultSilhouette } from '../../utils/portraits'
import { STATUS_LABEL } from '../../utils/eventStatus'
import { PillHomeIcon, PillBarsIcon, PillPlayIcon } from '../shared/PillIcons'

// ── Helpers ───────────────────────────────────────────────────────────────────

// Exported — ContentArea.jsx's breadcrumb status badge needs the same
// accurate computation, not the raw stored season.status (see the
// liveOngoing carve-out below for why raw status alone isn't trustworthy).
export function getStatus(season) {
  if (!season) return 'future'
  const now = new Date()
  const start = season.start_date ? new Date(season.start_date) : null
  const end   = season.end_date   ? new Date(season.end_date)   : null
  // A real, provable "now is inside [start, end]" wins over a stored
  // 'past' status — ingestion writes status='past' at INSERT time (see
  // ingest-tennis-tml.js upsertSeason) and never revisits it on re-runs,
  // so a season whose games are still being scraped daily can carry a
  // stale 'past' flag for its entire real-world duration (confirmed bug:
  // Canadian Open 2026, Aug 2-13, showed "Past" while still mid-tournament
  // on Aug 7 because status was frozen at 'past' from the very first
  // ingestion run). Without this carve-out, a stale/wrong stored status
  // could otherwise always override the live calendar check below.
  const liveOngoing = !!(start && end && now >= start && now <= end)
  if (!liveOngoing && (season.status === 'past' || (end && now > end))) return 'past'
  // 'current' is the DB value for an in-progress season — treat as 'ongoing'
  if (liveOngoing || season.status === 'ongoing' || season.status === 'current'
      || (start && now >= start && (!end || now <= end))) return 'ongoing'
  // No dates recorded at all (common for cancelled seasons — a WWI/WWII
  // suspension or a last-minute COVID cancellation before a schedule was
  // ever set) — fall back to the season's own year rather than defaulting
  // every dateless row to 'future', which wrongly badged long-past
  // cancelled tournaments (e.g. Wimbledon 1940) as upcoming.
  if (!start && !end && season.year != null && season.year < now.getFullYear() - 1) return 'past'
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
  if (status === 'past') {
    return <span className={`${styles.statusBadge} ${styles.status_past}`}>{STATUS_LABEL.past.toUpperCase()}</span>
  }
  if (status === 'ongoing') {
    return (
      <span className={`${styles.statusBadge} ${styles.status_ongoing}`}>
        {isLive ? `● ${STATUS_LABEL.ongoing.toUpperCase()}` : STATUS_LABEL.ongoing.toUpperCase()}
      </span>
    )
  }
  if (status === 'next') {
    return <span className={`${styles.statusBadge} ${styles.status_next}`}>{STATUS_LABEL.next.toUpperCase()}</span>
  }
  // 'future'/'upcoming' (and any other/unset value) — season-level
  // callers (F1/MotoGP Championship blocks) only ever pass 'ongoing' or
  // 'past'/anything-else here, since a season has no "next season"
  // concept; anything-else falls through to Future, same as before.
  return (
    <span className={`${styles.statusBadge} ${styles.status_upcoming}`}>
      {STATUS_LABEL.upcoming.toUpperCase()}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EventBlock({ season, competition, naming, eventNaming, categoryEra, logoUrl, activeYear, activeGender, activeTab, activeTabGroup, activeEvent, leadingPlayers = [], seasonStats = null, hasVideosTab = false, pageTitle = null, tabName = null }) {

  // Detect multiple sub_editions for same year/gender (e.g. Australian Open 1977)
  const allEditions = (season?.seasons || []).filter(se =>
    activeGender ? se.gender === activeGender : true
  )
  const subEditionNums = [...new Set(allEditions.map(se => se.sub_edition || 1))].sort()
  const hasMultiEditions = subEditionNums.length > 1

  const { activeSubEdition, setSubEdition, setTab } = useAppStore()

  // History hooks — must be before any early return (Rules of Hooks)
  const dbYear = competition?.year_convention === 'start' ? activeYear - 1 : activeYear
  // Inverse of dbYear above — history.prev_title_year (and any other raw
  // year read back from the API) is a DB-stored year, not a display year.
  // For 'start'-convention competitions (Ligue 1: DB year 2024 = the
  // 2024/25 season, displayed as "2025") subtracting it straight from
  // activeYear overcounts "years ago" by 1 — this converts it back to the
  // same display-year space activeYear already lives in before any math.
  const toDisplayYear = rawYear => competition?.year_convention === 'start' ? rawYear + 1 : rawYear
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
  // All-Star's own 'mvp' tab (see ingest-nba-all-star-results.js) is the
  // same single-winner shape as Awards' MVP-style tabs — gets the same
  // Variant B (award winner) banner treatment, not the generic Champion
  // fallback every other All-Star tab (Results/roster) uses.
  const _isAllStarEvent = competition?.sport_slug === 'basketball' && !!activeEvent?.startsWith('all-star')
  const _isAllStarMvpTab = _isAllStarEvent && activeTab === 'mvp'
  // Basketball Awards (page 5, variant B): featured entity is the award
  // winner *player*, not the season's Finals champion team — a wholly
  // different lookup from the history hooks below, backed by
  // /seasons/award-winner (stats->>'winner' flag set by ingest-nba-awards.js).
  const _isBasketballAwardsTab = (competition?.sport_slug === 'basketball' && !!activeEvent?.startsWith('awards')) || _isAllStarMvpTab
  // Always the season's overall NBA Championship history (nba-finals),
  // even on NBA Cup pages — the new stat bloc shows NBA CHAMP. and NBA
  // CUP as two independent rows side by side (see nbaCupHistory below),
  // rather than swapping this one row's meaning depending on which
  // basketball event tab is active like the old bottom-bar label did.
  useEffect(() => {
    if (!_winnerId || !competition?.id || !dbYear) { setHistory(null); return }
    api.getEntityHistory(_winnerId, competition.id, dbYear)
      .then(d => setHistory(d))
      .catch(() => setHistory(null))
  }, [_winnerId, competition?.id, dbYear])

  // NBA Cup's own title history for the featured club — fetched
  // unconditionally alongside the overall Finals history above (not just
  // on NBA Cup pages), since the Team stat bloc always shows both NBA
  // CHAMP. and NBA CUP rows together regardless of which basketball event
  // tab is active. Not needed on Awards pages — the player-level 'nba-cup'
  // career count from /award-winner covers that variant instead.
  const _isBasketball = competition?.sport_slug === 'basketball'
  const [nbaCupHistory, setNbaCupHistory] = useState(null)
  useEffect(() => {
    // Award tabs need it too when they're really a team-roster page
    // (All-NBA/All-Defense/NBA Cup Team) — those show the Team stat bloc,
    // not the player one.
    const needsIt = !_isBasketballAwardsTab || TEAM_ROSTER_AWARD_TABS.has(activeTab)
    if (!_isBasketball || !needsIt || !_winnerId || !competition?.id || !dbYear) { setNbaCupHistory(null); return }
    api.getEntityHistory(_winnerId, competition.id, dbYear, 'final')
      .then(d => setNbaCupHistory(d))
      .catch(() => setNbaCupHistory(null))
  }, [_isBasketball, _isBasketballAwardsTab, activeTab, _winnerId, competition?.id, dbYear])

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

  // All-Star's own participation/title history for the winning side
  // (Eastern/Western Conference All-Stars, Team LeBron, etc.) — the
  // Results tab's own tab_key ('results') is stable across every year
  // regardless of format, so the same generic /entity-history route
  // (participations/titles/prev_title_year) that powers the Finals/NBA Cup
  // stat rows works here unmodified, just pointed at 'results' instead of
  // 'nba-finals'/'final'. Not fetched on the MVP tab — that one shows the
  // player-level award trophy case (athleteStatRows) instead.
  const [allStarHistory, setAllStarHistory] = useState(null)
  useEffect(() => {
    if (!_isAllStarEvent || _isAllStarMvpTab || !_winnerId || !competition?.id || !dbYear) { setAllStarHistory(null); return }
    api.getEntityHistory(_winnerId, competition.id, dbYear, 'results')
      .then(d => setAllStarHistory(d))
      .catch(() => setAllStarHistory(null))
  }, [_isAllStarEvent, _isAllStarMvpTab, _winnerId, competition?.id, dbYear])

  const [awardWinner, setAwardWinner] = useState(null)
  useEffect(() => {
    if (!_isBasketballAwardsTab || !_activeSeasonId || !activeTab) { setAwardWinner(null); return }
    let cancelled = false
    api.getAwardWinner(_activeSeasonId, activeTab)
      .then(d => { if (!cancelled) setAwardWinner(d ?? null) })
      .catch(() => { if (!cancelled) setAwardWinner(null) })
    return () => { cancelled = true }
  }, [_isBasketballAwardsTab, _activeSeasonId, activeTab])

  // Football stat bloc's "Top Scorer / Assist" row: how many times (through
  // the selected year) the featured club has produced the league's outright
  // top scorer / top assist provider — fetched unconditionally alongside the
  // other pre-return history hooks above, same reasoning (winner id is
  // pre-derived before the `if (!s) return null` early return, so this hook
  // can't move lower).
  const _isFootball = competition?.sport_slug === 'football'
  const _isTennis = competition?.sport_slug === 'tennis'

  // Tennis stat bloc's Grand Slam breakdown (SEASONS + TITLE/FINALS per
  // slam + combined total) — player+year scoped only, always returns the
  // same 4-Slam breakdown regardless of which competition is browsed.
  // Rendering decides whether the browsed competition is actually one of
  // the 4 (a real Grand Slam page) by checking competition.id against the
  // returned by_competition list, not by hardcoding ids here.
  const [grandSlamHistory, setGrandSlamHistory] = useState(null)
  useEffect(() => {
    if (!_isTennis || !_winnerId || !dbYear) { setGrandSlamHistory(null); return }
    let cancelled = false
    api.getGrandSlamHistory(_winnerId, dbYear, competition?.id)
      .then(d => { if (!cancelled) setGrandSlamHistory(d) })
      .catch(() => { if (!cancelled) setGrandSlamHistory(null) })
    return () => { cancelled = true }
  }, [_isTennis, _winnerId, dbYear, competition?.id])

  // Tennis stat bloc's Masters tier rollup (Masters 1000/500/250, each
  // summed across every competition in that tier) — shown on non-Grand-Slam
  // pages instead of the per-Slam breakdown above. Fetched unconditionally
  // alongside grandSlamHistory (same player+year scope, cheap), since the
  // Masters page's own stat bloc also shows the combined Grand Slam total
  // as its last row.
  const [tennisTierHistory, setTennisTierHistory] = useState(null)
  useEffect(() => {
    if (!_isTennis || !_winnerId || !dbYear) { setTennisTierHistory(null); return }
    let cancelled = false
    api.getTennisTierHistory(_winnerId, dbYear, competition?.id)
      .then(d => { if (!cancelled) setTennisTierHistory(d) })
      .catch(() => { if (!cancelled) setTennisTierHistory(null) })
    return () => { cancelled = true }
  }, [_isTennis, _winnerId, dbYear, competition?.id])

  // Tennis bottom-bar "Players" stat (draw size for the active gender) —
  // fetched directly against this component's own correctly gender-scoped
  // _activeSeasonId, not the seasonStats prop (ContentArea's own seasonId
  // there picks the first season row matching the year regardless of
  // gender, which would silently show the wrong gender's draw size half
  // the time on tennis pages).
  const [tennisSeasonStats, setTennisSeasonStats] = useState(null)
  useEffect(() => {
    if (!_isTennis || !_activeSeasonId) { setTennisSeasonStats(null); return }
    let cancelled = false
    api.getSeasonStats(_activeSeasonId)
      .then(d => { if (!cancelled) setTennisSeasonStats(d) })
      .catch(() => { if (!cancelled) setTennisSeasonStats(null) })
    return () => { cancelled = true }
  }, [_isTennis, _activeSeasonId])

  const [clubLeaders, setClubLeaders] = useState(null)
  useEffect(() => {
    if (!_isFootball || !_winnerId || !competition?.id || !dbYear) { setClubLeaders(null); return }
    let cancelled = false
    api.getClubLeaders(_winnerId, competition.id, dbYear)
      .then(d => { if (!cancelled) setClubLeaders(d) })
      .catch(() => { if (!cancelled) setClubLeaders(null) })
    return () => { cancelled = true }
  }, [_isFootball, _winnerId, competition?.id, dbYear])

  // Runner-up (2nd/3rd place) club standings — champion banner shows the
  // top 3 with points, not just the winner. Football's `season.winners`
  // has no `loser` field for flat league standings (only knockout ties/
  // matches populate that), so this is a separate fetch against the
  // season's own 'standings' tab_key rather than something derivable from
  // the winner computation above. Knockout-only competitions (World Cup,
  // UCL) have no 'standings' tab at all — the 404 there just resolves to
  // an empty array via the catch, same 0-rows-hide-the-section pattern
  // used elsewhere in this file.
  const [top3Standings, setTop3Standings] = useState([])
  useEffect(() => {
    if (!_isFootball || !_activeSeasonId) { setTop3Standings([]); return }
    let cancelled = false
    api.getStandings(_activeSeasonId, 'standings')
      .then(d => { if (!cancelled) setTop3Standings((d?.standings || []).slice(0, 3)) })
      .catch(() => { if (!cancelled) setTop3Standings([]) })
    return () => { cancelled = true }
  }, [_isFootball, _activeSeasonId])

  // Football Scorers/Passers stat bloc: the featured player's own career
  // trophy case (Champion/Top Scorer/Assist Leader titles) — same
  // pre-return placement reasoning as clubLeaders above. activeTab/
  // leadingPlayers are both props, already available this early.
  const [playerLeaders, setPlayerLeaders] = useState(null)
  useEffect(() => {
    const isScorersOrPassers = activeTab === 'scorers' || activeTab === 'passers'
    const featuredPlayerId = leadingPlayers.length === 1 ? leadingPlayers[0]?.id : null
    if (!_isFootball || !isScorersOrPassers || !featuredPlayerId || !competition?.id || !dbYear) { setPlayerLeaders(null); return }
    let cancelled = false
    api.getPlayerLeaders(featuredPlayerId, competition.id, dbYear)
      .then(d => { if (!cancelled) setPlayerLeaders(d) })
      .catch(() => { if (!cancelled) setPlayerLeaders(null) })
    return () => { cancelled = true }
  }, [_isFootball, activeTab, leadingPlayers, competition?.id, dbYear])

  // All-Time (event.name 'All-Time', slug prefix 'all-time' — same
  // sport-agnostic convention LineA.jsx already pins this event on)
  // is a cumulative "through <year>" view with no single per-season
  // winner, so the winner/history/stat-bloc computation below (built
  // entirely around one season's champion) doesn't apply. Same minimal
  // 2-line banner as F1's own All-Time pages (F1AllTimeBlock in
  // F1EventBlock.jsx): a plain black title bar plus the standard red
  // page-notice bar, nothing else.
  const isAllTimeEvent = !!activeEvent?.startsWith('all-time') || activeTabGroup === 'all_time'

  // Iconic Moments (tab_key 'videos', same convention F1/MotoGP's own
  // content areas use) is a season-specific video gallery, not tied to any
  // one match/winner — same reasoning as isAllTimeEvent above, just scoped
  // to the selected year instead of "across every season". Same minimal
  // 2-line banner (F1IconicMomentsBlock/MotoGPIconicMomentsBlock mirror
  // this exact shape), replacing the season-champion banner that used to
  // show here (wrong context for a video gallery).
  const isIconicEvent = activeTab === 'videos'
  if (isIconicEvent) {
    const iconicName = naming?.official_name || competition?.name || ''
    // Host country/countries (World Cup etc.) — same season lookup + " I "
    // join as venueDisplay below (that computation happens later in this
    // function, past this branch's early return, so it's duplicated here
    // rather than hoisted, to avoid disturbing every other branch's order).
    const iconicSeason = activeGender
      ? season?.seasons?.find(se => se.gender === activeGender)
      : season?.seasons?.[0]
    const isQuadOrBiennialIconic = competition?.competition_type === 'quadrennial' || competition?.competition_type === 'biennial'
    const iconicHost = isQuadOrBiennialIconic && iconicSeason?.host_countries?.length
      ? iconicSeason.host_countries.join(' I ')
      : null
    return (
      <div className={styles.wrapper}>
        <div className={styles.banner}>
          <div className={styles.bottom}>
            <span className={styles.eventCompetition}>{iconicName}<PillPlayIcon /></span>
            <span className={styles.eventName}>
              Watch Center of the {iconicName} {activeYear}{iconicHost ? ` I ${iconicHost}` : ''}
            </span>
            <div className={styles.bottomLogoWrap}>
              {(logoUrl || competition?.logo_url)
                ? <img src={resolveLogoUrl(logoUrl || competition.logo_url)} alt={iconicName} className={styles.bottomLogo} />
                : <span className={styles.allTimeLogoText}>{iconicName.slice(0, 2).toUpperCase()}</span>
              }
            </div>
            {/* Breadcrumb (Competition I Year I Videos) — same convention
                as every other tab, was missing from this branch (2026-08-14). */}
            {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
          </div>
        </div>
      </div>
    )
  }

  if (isAllTimeEvent) {
    // Sport category name (NBA, Ligue 1, ATP, etc.) — same lookup as the
    // main `name` variable below, computed locally here since this branch
    // returns before that declaration.
    const allTimeName = naming?.official_name || competition?.name || ''
    return (
      <div className={styles.wrapper}>
        <div className={styles.banner}>
          <div className={styles.bottom}>
            <span className={styles.eventCompetition}>{allTimeName}<PillBarsIcon /></span>
            <span className={styles.eventName}>
              Aggregated statistics across the selected {allTimeName} seasons
            </span>
            <div className={styles.bottomLogoWrap}>
              {(logoUrl || competition?.logo_url)
                ? <img src={resolveLogoUrl(logoUrl || competition.logo_url)} alt={allTimeName} className={styles.bottomLogo} />
                : <span className={styles.allTimeLogoText}>{allTimeName.slice(0, 2).toUpperCase()}</span>
              }
            </div>
            {/* Breadcrumb (Competition I Year I Team Stats etc.) encapsulated
                in the same card, own row below via .breadcrumbLine's
                flex-basis:100% + top border — same convention every other
                EventBlock variant uses (2026-08-13), this branch was
                missing it entirely. */}
            {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
          </div>
        </div>
      </div>
    )
  }

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
  const penalty  = seasonResult?.penalty ?? null
  const status = getStatus(s)
  const isPast = status === 'past'

  // Colours: football/basketball use winner club colors, tennis uses competition colors
  const isFootball = competition?.sport_slug === 'football'
  const isBasketball = competition?.sport_slug === 'basketball'
  const isTennis = _isTennis
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
      // s.bg_image_url is an optional per-season champion photo (e.g. a
      // squad celebration shot for that specific edition) — takes priority
      // over the entity's own generic, year-independent image_url/logo
      // when set. Falls back to the generic logo for every season that
      // doesn't have one (the vast majority).
      const rawLogo = s?.bg_image_url || winner.image_url || ''
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

  // Competition info — name is always the short display name (pill +
  // title); official_name renders as a page-subtitle in the template
  // itself, not in this banner (2026-08-10: moved out of EventBlock —
  // see tennis_draw_template.jsx/tennis_players_template.jsx's own
  // pageSubtitle prop).
  const name         = competition?.name || ''
  const surface      = getSurfaceLabel(competition?.surface)
  // Category (Masters 1000/ATP 250/Grand Slam/...) shown alongside surface
  // — "MASTERS 1000 I HARD" (2026-08-09: "add tournament category and
  // surface"). category_short comes straight off the competition's current
  // event_categories row (getCompetition already joins it).
  //
  // categoryEra adds the tier's ORIGINAL name at the viewed year in parens
  // when it differs from today's — "MASTERS 1000 (ATP Super 9) I HARD" for
  // a 1990s Indian Wells season (2026-08-09: "what about ATP master
  // naming?"). Only ever set when it actually differs (the API only
  // returns a row for eras with a real rename), so no redundant "(Masters
  // 1000)" for a category that's never been renamed.
  const categoryLabel = competition?.category_short || ''
  const categoryEraName = categoryEra?.original_name || ''
  // Quadrennial/biennial knockout competitions (World Cup today) show the
  // edition's host country/countries here instead of the generic category
  // badge — "MASTERS 1000"-style category labels don't mean anything for
  // these, but "which country hosted this edition" does. Co-hosted
  // editions join with the same " I " separator category/surface already
  // use (2026-08-12, confirmed with Mohamed: "USA I Canada I Mexico").
  // s.host_countries comes straight off the /seasons route's SELECT.
  const isQuadOrBiennialComp = competition?.competition_type === 'quadrennial' || competition?.competition_type === 'biennial'
  const venueDisplay = isQuadOrBiennialComp && s?.host_countries?.length ? s.host_countries.join(' I ') : null
  const categoryDisplay = venueDisplay || (categoryEraName
    ? `${categoryLabel} (${categoryEraName})`
    : categoryLabel)

  // Basketball areaTitle: variant A is always "Champion" regardless of which
  // sub-tab is active (Standings/Results/Players/Teams all share one
  // season-level champion banner) — All-NBA/All-Defense (team-roster) tabs
  // fall back to this same "Champion" label since they show the champion
  // club banner too, not an individual winner. Genuine single-winner award
  // tabs (MVP/DPOY/etc) show just the short code (e.g. "MVP", "6MOY") as
  // the pill tag next to the event name, not the full descriptive name —
  // reusing the page-title lookup already built for the content templates'
  // own headers, but only its `title`, not `kind`. All-Star's own MVP tab
  // is special-cased to "All-Star MVP" — its own `pt.title` is bare "MVP",
  // same as the season-wide Awards MVP tab, which would otherwise make
  // both tags read identically despite being different awards.
  const basketballAreaTitle = isBasketball
    ? (isBasketballAwards && !isTeamRosterAwardsTab
        ? (_isAllStarMvpTab ? 'All-Star MVP' : (tabName || ''))
        : isNbaCup ? 'NBA Cup Winner' : _isAllStarEvent ? 'All-Star Game' : 'Champion')
    : null

  const areaTitleText = basketballAreaTitle ?? getAreaTitle(activeTab, isScorersTab ? leadingPlayers.length > 0 : !!winner, isPast)

  // Age now sits inline next to the player's name (see winnerName JSX
  // below), not as its own stat-bloc row — computed here so both that and
  // the (now age-less) athleteStatRows list can use it.
  const awardWinnerAge = isBasketballAwards && !isTeamRosterAwardsTab && awardWinner?.player
    ? calcAge(awardWinner.player.birth_date, s?.end_date, awardWinner.player.death_date)
    : null

  // ── Stat bloc rows (basketball only) ──────────────────────────────────
  // Variant A (Athlete — genuine single-winner award tabs): a fixed,
  // always-in-this-order list of every trophy this player has won through
  // the selected year, not just the one relevant to whichever tab is
  // active. Rows with a zero career count are hidden entirely (0 data
  // rule). The row for whichever award tab is currently being browsed
  // gets a "+1" highlight.
  const athleteStatRows = (isBasketballAwards && !isTeamRosterAwardsTab && awardWinner?.career) ? (() => {
    const c = awardWinner.career
    const rows = []
    const push = (tabKey, label, value, sub, highlighted) => {
      if (!value) return
      rows.push({ key: tabKey, label, value, sub: sub || null, highlighted: highlighted ?? (tabKey === activeTab) })
    }
    // All-NBA 1st/2nd/3rd, All-Defense 1st/2nd, NBA Finals|Champ. and
    // All-Star|MVP each collapse into one pipe-separated row instead of
    // separate ones — same font size on both numbers, no sub-label — to
    // save vertical space. Fixed label, every slot always shown (including
    // a real 0 — e.g. "5|3|0" tells the whole story: never made 3rd team).
    // Shown as soon as any one slot is > 0. Highlights if the
    // currently-browsed tab is any of the combined ones (or an explicit
    // override, for tab_keys — like All-Star's own 'mvp' — that don't
    // literally match any of tabKeys).
    const pushComboFixed = (tabKeys, label, values, highlighted) => {
      if (!values.some(v => v > 0)) return
      rows.push({ key: tabKeys[0], label, value: values.join('|'), highlighted: highlighted ?? tabKeys.includes(activeTab) })
    }
    // DPOY/6MOY/MIP/ROY are four unrelated single-winner awards grouped
    // only to save space, not tiers of one system like All-NBA/All-Defense
    // — a 0 in one is just noise, not information, so it's dropped
    // entirely (both label and value) rather than shown — e.g. a DPOY-only
    // winner shows just "DPOY: 2", not "DPOY|6MOY|MIP|ROY: 2|0|0|0". The
    // whole row is skipped only if every component is zero.
    const pushComboStrict = (tabKeys, labels, values, highlighted) => {
      const kept = values.map((v, i) => ({ label: labels[i], value: v })).filter(p => p.value > 0)
      if (!kept.length) return
      rows.push({
        key: tabKeys[0],
        label: kept.map(p => p.label).join('|'),
        value: kept.map(p => p.value).join('|'),
        highlighted: highlighted ?? tabKeys.includes(activeTab),
      })
    }
    // All-Star reuses tab_key='mvp' for its own MVP tab — activeTab==='mvp'
    // is ambiguous between "viewing Awards' MVP" and "viewing All-Star's
    // MVP", so this row needs an explicit highlight instead of the
    // generic tabKey===activeTab check every other row uses.
    push('mvp',             'MVP',           c.mvp, null, activeTab === 'mvp' && !_isAllStarMvpTab)
    pushComboFixed(['nba-finals', 'nba-champ'], 'NBA Finals|Champ.', [c.finals, c.titles])
    push('nba-cup',         'NBA Cup',       c['nba-cup'])
    push('finals-mvp',      'Finals MVP',    c['finals-mvp'])
    pushComboStrict(['dpoy', 'smoy', 'mip', 'roy'], ['DPOY', '6MOY', 'MIP', 'ROY'], [c.dpoy, c.smoy, c.mip, c.roy])
    push('nba-cup-mvp',     'NBA Cup MVP',   c['nba-cup-mvp'])
    pushComboFixed(['all-nba-1st', 'all-nba-2nd', 'all-nba-3rd'], 'All-NBA 1st|2nd|3rd',
      [c['all-nba-1st'], c['all-nba-2nd'], c['all-nba-3rd']])
    pushComboFixed(['all-defense-1st', 'all-defense-2nd'], 'All-Def. 1st|2nd',
      [c['all-defense-1st'], c['all-defense-2nd']])
    push('nba-cup-teams',   'NBA Cup Team',  c['nba-cup-teams'])
    pushComboFixed(['all-star', 'all-star-mvp'], 'All-Star|MVP', [c['all-star'], c['all-star-mvp']], _isAllStarEvent)
    return rows
  })() : null

  // Variant B (Team — Champion/team-roster pages): Seasons (franchise
  // longevity), NBA Champ. (titles, with finals-played count), Last Title —
  // no 0-data hiding on these three (a team's title count of 0 is itself
  // meaningful, unlike a player with no trophies). NBA Cup is the one
  // exception — see its own 0-rule comment below. Suppressed on All-Star's
  // Results/roster tabs — `winner` there is a pseudo-team (Eastern
  // Conference All-Stars, Team LeBron, etc.), not a real club, so Finals/
  // Championship/NBA Cup history is meaningless.
  const teamStatRows = (isBasketball && (!isBasketballAwards || isTeamRosterAwardsTab) && !_isAllStarEvent && winner) ? (() => {
    const rows = []
    if (history?.seasons != null) rows.push({ key: 'seasons', label: 'Seasons', value: history.seasons })
    if (history?.participations != null) rows.push({ key: 'nba-finals', label: 'NBA Finals', value: history.participations })
    rows.push({
      key: 'nba-champ', label: 'NBA Champ.', value: history?.titles ?? 0,
      // This banner's `winner` IS this season's champion — every non-Cup
      // team page counts as a "+1" toward the title tally shown here.
      highlighted: !isNbaCup,
    })
    if (history?.titles > 0) {
      rows.push({
        key: 'last-title', label: 'Last Title', value: history.prev_title_year != null ? toDisplayYear(history.prev_title_year) : activeYear,
        sub: history.prev_title_year != null ? `${activeYear - toDisplayYear(history.prev_title_year)} Y. ago` : '1st title',
      })
    }
    // 0 rule: NBA Cup only started 2023-24, so most teams/years have never
    // even reached an NBA Cup Final — remove the row entirely rather than
    // clutter every pre-2024 Champion banner with "NBA Cup: 0". Gated on
    // participations (Finals appearances), not titles, so a team that's
    // reached the Final and lost still shows its real (0-title) record.
    if (nbaCupHistory?.participations > 0) {
      rows.push({
        key: 'nba-cup', label: 'NBA Cup', value: nbaCupHistory?.titles ?? 0,
        highlighted: isNbaCup,
      })
    }
    return rows
  })() : null

  // Variant C (All-Star Results/roster pages): the winning side's own
  // All-Star history — Edition, Titles (how many it's won), Last Title.
  // Not Finals/NBA Cup history (meaningless for a pseudo-team like "Eastern
  // Conference All-Stars" or "Team LeBron") — its own fetch above, scoped
  // to the Results tab's own game record.
  //
  // Edition means two different things depending on format. For the
  // 2018-2023 captain-draft era, per-side participations undercounts: a
  // captain's team is a brand-new entity each time their opponent changes
  // (e.g. "Team Giannis" only exists for 2019/2020/2023 — 2021/2022 paired
  // LeBron with Durant instead), so Mohamed wants Edition to read as the
  // draft-format's own sequence number (2018=1st ... 2023=6th) rather than
  // that fragmented per-entity count. Conference years (1951-2017, 2024)
  // keep the real participations count from the API — "Eastern/Western
  // Conference All-Stars" is one continuous entity there, so it's accurate.
  const CAPTAIN_DRAFT_START_YEAR = 2018
  const CAPTAIN_DRAFT_END_YEAR = 2023
  const isCaptainDraftEra = activeYear >= CAPTAIN_DRAFT_START_YEAR && activeYear <= CAPTAIN_DRAFT_END_YEAR
  const allStarTeamStatRows = (_isAllStarEvent && !_isAllStarMvpTab && winner) ? (() => {
    const rows = []
    if (isCaptainDraftEra) {
      rows.push({ key: 'edition', label: 'Edition', value: activeYear - CAPTAIN_DRAFT_START_YEAR + 1 })
    } else if (allStarHistory?.participations != null) {
      rows.push({ key: 'edition', label: 'Edition', value: allStarHistory.participations })
    }
    rows.push({
      key: 'titles', label: 'Titles', value: allStarHistory?.titles ?? 0,
      // This banner's `winner` IS this game's winning side — always counts
      // as a "+1" toward the title tally shown here.
      highlighted: true,
    })
    if (allStarHistory?.titles > 0) {
      rows.push({
        key: 'last-title', label: 'Last Title', value: allStarHistory.prev_title_year != null ? toDisplayYear(allStarHistory.prev_title_year) : activeYear,
        sub: allStarHistory.prev_title_year != null ? `${activeYear - toDisplayYear(allStarHistory.prev_title_year)} Y. ago` : '1st title',
      })
    }
    return rows
  })() : null

  // Quadrennial/biennial competitions (World Cup, and any future
  // competition of the same shape — Euro, Olympics, ...) get a different
  // record card than seasonal leagues: Editions/Participations/Finals
  // instead of Seasons/Last Title/Cup/League Cup/Champions Trophy, since
  // those are seasonal-league concepts that don't apply to a tournament
  // held every 2-4 years. Driven by competitions.competition_type, not a
  // hardcoded competition list, so it applies to any future competition of
  // the same shape for free.
  const isQuadOrBiennial = competition?.competition_type === 'quadrennial' || competition?.competition_type === 'biennial'

  // Football stat bloc (Standings/Results/Players tabs only — Scorers/
  // Passers/Clubs already show their own league-wide leader stats in the
  // bottom bar and don't need the club trophy case repeated). Seasons/
  // Champion reuse the same `history` (participations/titles) the bottom
  // bar's "Participations / Titles" row already fetches for football —
  // no separate query. Cup/League Cup/Champions Trophy have no ingested
  // data yet — placeholder dash until those competitions are backfilled.
  const footballTeamStatRows = (isFootball && winner && !isScorersTab && activeTab !== 'clubs') ? (() => {
    const rows = []

    if (isQuadOrBiennial) {
      // Editions/Participations/Champion/Finals always show (this card
      // only ever renders for a season's winner, so none of these can
      // genuinely be zero here) — '-' only means the data itself is
      // missing, not that it's a tracked zero. Top Scorer/Assist Leader
      // CAN be a real zero (winning the tournament doesn't guarantee
      // having its outright top scorer/assist leader too) — same 0 rule
      // as the player stat bloc below: drop the row rather than show "0".
      rows.push({ key: 'editions', label: 'Editions', value: competition?.edition_years?.length ?? '-' })
      rows.push({ key: 'participations', label: 'Participations', value: history?.participations ?? '-' })
      rows.push({ key: 'finals', label: 'Finals', value: history?.finals ?? '-' })
      rows.push({ key: 'champion', label: 'Champion', value: history?.titles ?? '-', highlighted: true })
      // Same "Last Title" sub-line as the seasonal-league branch below —
      // 1st Title vs. X years since the previous one — reusing the exact
      // same prev_title_year/toDisplayYear logic (usesFinalTour already
      // computes it identically to the standings path in seasons.js).
      if (history?.titles > 0) {
        rows.push({
          key: 'last-title', label: 'Last Title', value: history.prev_title_year != null ? toDisplayYear(history.prev_title_year) : activeYear,
          sub: history.prev_title_year != null ? `${activeYear - toDisplayYear(history.prev_title_year)} Y. ago` : '1st title',
        })
      }
      if (clubLeaders?.top_scorer_titles > 0) rows.push({ key: 'top_scorer', label: 'Top Scorer', value: clubLeaders.top_scorer_titles })
      if (clubLeaders?.top_assist_titles > 0) rows.push({ key: 'assist_leader', label: 'Assist Leader', value: clubLeaders.top_assist_titles })
      return rows
    }

    rows.push({ key: 'seasons', label: 'Seasons', value: history?.participations ?? 0 })
    rows.push({ key: 'champion', label: 'Champion', value: history?.titles ?? 0, highlighted: true })
    if (history?.titles > 0) {
      rows.push({
        key: 'last-title', label: 'Last Title', value: history.prev_title_year != null ? toDisplayYear(history.prev_title_year) : activeYear,
        sub: history.prev_title_year != null ? `${activeYear - toDisplayYear(history.prev_title_year)} Y. ago` : '1st title',
      })
    }
    rows.push({ key: 'cup', label: 'Cup', value: '—' })
    rows.push({ key: 'league_cup', label: 'League Cup', value: '—' })
    rows.push({ key: 'champions_trophy', label: 'Champions Trophy', value: '—' })
    rows.push({
      key: 'scorer_assist',
      label: 'Top Scorer|Assist',
      value: `${clubLeaders?.top_scorer_titles ?? 0}|${clubLeaders?.top_assist_titles ?? 0}`,
    })
    return rows
  })() : null

  // Football Scorers/Passers stat bloc — the featured player's own trophy
  // case. Cup/League Cup/Champions Trophy have no ingested data yet, same
  // unconditional placeholder dash as the club version above. Champion/Top
  // Scorer/Assist Leader are real computed counts — the 0 rule applies to
  // these: a zero here is noise (this player has simply never won that),
  // not information, so the row is dropped entirely rather than shown as
  // "0". Only shown for a single, unambiguous featured player (not the
  // 2-way-tie portraitDuo case, where there's no one player to feature).
  const footballPlayerStatRows = (isFootball && isScorersTab && leadingPlayers.length === 1) ? (() => {
    const rows = []

    if (isQuadOrBiennial) {
      // Same shape as footballTeamStatRows' quad/biennial branch, but
      // career tournament totals (Games Played/Goals/Assists) instead of
      // Editions/Finals/Champion — those are team-level concepts. Only
      // Top Scorer/Assist Leader keep the 0 rule (a real zero, not missing
      // data); Participations/Games Played/Goals/Assists always show.
      rows.push({ key: 'participations', label: 'Participations', value: playerLeaders?.participations ?? '-' })
      if (playerLeaders?.final_titles > 0) {
        // Unlike Top Scorer/Assist Leader below, being the featured
        // scorer/passer of THIS edition doesn't mean this player's team won
        // it too (Mbappé led scoring in 2022 but France lost the final to
        // Argentina) — the +1 badge only belongs on the count if the
        // browsed edition itself is one of the titles, checked by matching
        // the player's team name against this edition's actual champion.
        const wonThisEdition = leadingPlayers[0]?.club_name && winner?.canonical_name === leadingPlayers[0].club_name
        rows.push({ key: 'champion', label: 'Champion', value: playerLeaders.final_titles, highlighted: wonThisEdition })
      }
      rows.push({ key: 'games_played', label: 'Games Played', value: playerLeaders?.games_played ?? '-' })
      rows.push({ key: 'goals', label: 'Goals', value: playerLeaders?.goals ?? '-' })
      rows.push({ key: 'assists', label: 'Assists', value: playerLeaders?.assists ?? '-' })
      if (playerLeaders?.top_scorer_titles > 0) rows.push({ key: 'top_scorer', label: 'Top Scorer', value: playerLeaders.top_scorer_titles, highlighted: true })
      if (playerLeaders?.top_assist_titles > 0) rows.push({ key: 'assist_leader', label: 'Assist Leader', value: playerLeaders.top_assist_titles, highlighted: true })
      return rows
    }

    if (playerLeaders?.champion_titles > 0) rows.push({ key: 'champion', label: 'Champion', value: playerLeaders.champion_titles })
    rows.push({ key: 'cup', label: 'Cup', value: '—' })
    rows.push({ key: 'league_cup', label: 'League Cup', value: '—' })
    rows.push({ key: 'champions_trophy', label: 'Champions Trophy', value: '—' })
    if (playerLeaders?.top_scorer_titles > 0) rows.push({ key: 'top_scorer', label: 'Top Scorer', value: playerLeaders.top_scorer_titles })
    if (playerLeaders?.top_assist_titles > 0) rows.push({ key: 'assist_leader', label: 'Assist Leader', value: playerLeaders.top_assist_titles })
    return rows
  })() : null

  // Tennis stat bloc — Seasons (draw entries at the browsed tournament),
  // Title/Finals for the browsed tournament (always highlighted — this
  // banner's winner IS this appearance), then one of two tails depending on
  // what's being browsed:
  //   - Grand Slam page: the other 3 Slams' record + a combined Grand Slam
  //     total (also highlighted — checked against grandSlamHistory's own
  //     returned ids, not a hardcoded list).
  //   - Masters 1000/500/250 page (competition.category_id, not a slug
  //     check — holds even if slugs change): the 3 Masters tiers, each
  //     summed across every competition in that tier (tennisTierHistory),
  //     with whichever tier the browsed tournament itself belongs to also
  //     highlighted, then the combined Grand Slam total (not highlighted —
  //     this appearance doesn't contribute to it).
  // "I" separator, not "/" — matches the site's own breadcrumb convention
  // (ContentArea.jsx's pageTitle joins "Wimbledon I 2023 I Men's Singles"
  // the same way), styled via statBlocSep (normal weight, not the bold
  // Bebas Neue the surrounding digits/label use).
  // 0 rule: any tier/Slam row with 0 finals reached is dropped entirely.
  const SLAM_LABEL = { 'australian-open': 'Australian', 'roland-garros': 'Roland Garros', 'wimbledon': 'Wimbledon', 'us-open-tennis': 'US Open' }
  const ATP_TIER_CATEGORIES = { 12: 'Masters 1000', 14: 'Masters 500', 16: 'Masters 250' }
  const isGrandSlamPage = !!grandSlamHistory?.by_competition?.some(r => r.competition_id === competition?.id)
  const isMastersTierPage = !!ATP_TIER_CATEGORIES[competition?.category_id]
  const statSep = <span className={styles.statBlocSep}>I</span>
  const fmt = (t, f) => <>{t}{statSep}{f}</>
  const titleIFinalsLabel = <>Title{statSep}Finals</>
  const tennisStatRows = (isTennis && winner && history != null) ? (() => {
    const rows = []
    rows.push({ key: 'seasons', label: 'Seasons', value: history.participations ?? 0 })

    const browsedFinals = history.finals ?? 0
    const browsedTitles = history.titles ?? 0
    if (browsedFinals > 0) {
      rows.push({
        key: 'title-finals', label: titleIFinalsLabel, value: fmt(browsedTitles, browsedFinals),
        highlighted: true,
        sub: browsedTitles === 1
          ? '1st title'
          : (browsedTitles > 1 && history.prev_title_year != null ? `${activeYear - toDisplayYear(history.prev_title_year)} Y. ago` : null),
      })
    }

    // Badge count: a flat "+1" undersells a same-year multi-title case (win
    // the Australian Open, then Wimbledon, same year — the Grand Slam row
    // should badge "+2" by the time you're on the Wimbledon page, not "+1").
    // grandSlamHistory.same_year_count/tennisTierHistory.same_year_count
    // already compute this server-side by real Final match_date, scoped to
    // the browsed competition — default to 1 (this appearance alone) only
    // if that count hasn't loaded yet.
    if (isGrandSlamPage) {
      grandSlamHistory.by_competition
        .filter(r => r.competition_id !== competition.id)
        .forEach(r => {
          if (r.finals > 0) rows.push({ key: `slam-${r.competition_id}`, label: SLAM_LABEL[r.slug] || r.name, value: fmt(r.titles, r.finals) })
        })
      if (grandSlamHistory.total?.finals > 0) {
        rows.push({
          key: 'grand-slam', label: 'Grand Slam', value: fmt(grandSlamHistory.total.titles, grandSlamHistory.total.finals),
          highlighted: true, badgeCount: grandSlamHistory.same_year_count ?? 1,
        })
      }
    } else if (isMastersTierPage && tennisTierHistory) {
      tennisTierHistory.tiers.forEach(t => {
        if (t.finals > 0) {
          const isBrowsedTier = t.category_id === competition.category_id
          rows.push({
            key: `tier-${t.category_id}`, label: ATP_TIER_CATEGORIES[t.category_id], value: fmt(t.titles, t.finals),
            highlighted: isBrowsedTier,
            badgeCount: isBrowsedTier ? (tennisTierHistory.same_year_count ?? 1) : undefined,
          })
        }
      })
      if (grandSlamHistory?.total?.finals > 0) {
        rows.push({ key: 'grand-slam', label: 'Grand Slam', value: fmt(grandSlamHistory.total.titles, grandSlamHistory.total.finals) })
      }
    }
    return rows
  })() : null

  if (!competition) return null
  return (
    <div className={styles.wrapper}>

      {/* ── Zone 2: Banner ── */}
      <div className={styles.banner}>

        {/* ── Main content row ── */}
        <div className={styles.inner}>

          {/* Left: logo + event info */}
          <div className={styles.left}>
            <div className={styles.info}>
              {name && <div className={styles.eventCompetition}>{name}</div>}
              <div className={styles.categoryRow}>
                {/* Category + surface (tennis) — "MASTERS 1000 I HARD".
                    Either half is optional (e.g. non-tennis sports have no
                    surface) so they're joined only when present. */}
                {(categoryDisplay || surface) && (
                  <span className={styles.category}>
                    {[categoryDisplay, surface].filter(Boolean).join(' I ')}
                  </span>
                )}
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
                <span className={styles.eventNameText}>{name} {activeYear}</span>
                {/* areaTitle used to be its own line under the event name
                    ("Most Valuable Player (MVP)") — now a purple pill
                    inline next to it instead, with the status badge
                    (ONGOING/UPCOMING — never rendered at all for a past
                    season, see StatusBadge above) right after it. */}
                {areaTitleText && <span className={styles.areaTag}>{areaTitleText}</span>}
                <StatusBadge status={status} isLive={false} />
              </div>
              {isBasketball && !isBasketballAwards && winner && isPast && (
                <>
                  {/* Winner/loser lines reuse the same .scoreName/.scoreValue
                      + .eventWinner/.eventLoser classes as tennis/football's
                      own scoreBlock below — same bold/dim treatment, and
                      critically the same fixed-width name column, so the
                      win-count numbers land in the same column on both rows
                      regardless of how much longer one team's name is than
                      the other's (a plain inline margin after the name,
                      tried first, didn't align since "Los Angeles Lakers"
                      and "Miami Heat" are very different widths). */}
                  <div className={styles.entityScoreBlock}>
                    <div className={styles.scoreRow}>
                      <span className={`${styles.scoreName} ${styles.eventWinner}`}>{winner.display_name || winner.canonical_name}</span>
                      {sets.length > 0 && !walkover && (
                        <span className={`${styles.scoreValue} ${styles.eventWinner}`}>{sets.reduce((n, st) => n + st.w, 0)}</span>
                      )}
                    </div>
                    {loser && sets.length > 0 && !walkover && (
                      <div className={styles.scoreRow}>
                        <span className={`${styles.scoreName} ${styles.eventLoser}`}>{loser.display_name || loser.canonical_name}</span>
                        <span className={`${styles.scoreValue} ${styles.eventLoser}`}>{sets.reduce((n, st) => n + st.l, 0)}</span>
                      </div>
                    )}
                  </div>
                  {/* Per-game win sequence (e.g. Finals' "1 1 0 1 1") — not
                      shown for All-Star: its one "set" is a real point
                      score, not a per-game win/loss count, so this line
                      would misleadingly read as "Games: 178". */}
                  {sets.length > 0 && !walkover && !_isAllStarEvent && (
                    <div className={styles.eventSubDetails}>Games: {sets.map(s => s.w).join(' ')}</div>
                  )}
                </>
              )}
              {isTeamRosterAwardsTab && winner && isPast && sets.length === 0 && (
                <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>{winner.display_name || winner.canonical_name}</div>
              )}
              {isBasketballAwards && !isTeamRosterAwardsTab && awardWinner?.player && isPast && (
                <>
                  {/* Country flag before the name — player only, same as
                      tennis's scoreBlock flag (styles.scoreFlag below).
                      Team-only winner lines (isTeamRosterAwardsTab, the
                      basketball score rows) don't get one — a flag next to
                      a club name doesn't mean anything. */}
                  <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>
                    <Flag iso2={awardWinner.player.country_iso2} name={awardWinner.player.country_name} className={styles.winnerFlag} />
                    {awardWinner.player.canonical_name}
                  </div>
                  {/* Age + team on one line beneath the name (was age inline
                      next to the name, team on its own line below that). */}
                  {(awardWinnerAge != null || awardWinner.club) && (
                    <div className={styles.eventDetails}>
                      {awardWinnerAge != null && `${awardWinnerAge} years`}
                      {awardWinnerAge != null && awardWinner.club && ' | '}
                      {awardWinner.club?.canonical_name}
                    </div>
                  )}
                </>
              )}
              {isFootball && winner && (isScorersTab || sets.length === 0 || walkover) && (
                isScorersTab ? (
                  // Single clear leader: 2-line NBA Awards-MVP-style block
                  // (independent of the season's own Final sets/walkover —
                  // those describe the Final match, not the scorer/passer
                  // leader shown here; a Final-tour competition like the
                  // World Cup always has real Final sets, which previously
                  // blocked this whole branch from ever rendering on
                  // Scorers/Passers pages for those competitions).
                  // (flag + name + stat on one .eventNameRow, age/club as a
                  // separate sibling row underneath — real siblings so
                  // .info's own gap applies between them). A tie (2+
                  // leaders) instead compresses each player onto a single
                  // line — flag, name, stat, age, club all inline — one row
                  // per tied player, since stacking every tied player's full
                  // 2-line block would run the banner's limited height out
                  // fast.
                  leadingPlayers.length === 1
                    ? leadingPlayers.map(player => {
                        const statKey = activeTab === 'passers' ? 'assists' : 'goals'
                        const val = player?.[statKey] ?? ''
                        const age = calcAge(player.birth_date, s?.end_date, player.death_date)
                        return (
                          <Fragment key={player.id}>
                            <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>
                              <Flag iso2={player.country_iso2} name={player.country_name} className={styles.winnerFlag} />
                              {player.display_name || player.canonical_name}
                              {val !== '' && ` (${val})`}
                            </div>
                            {(age != null || player.club_name) && (
                              <div className={styles.eventDetails}>
                                {age != null && `${age} years`}
                                {age != null && player.club_name && ' | '}
                                {player.club_name}
                              </div>
                            )}
                          </Fragment>
                        )
                      })
                    : leadingPlayers.length > 1
                      ? (
                        // Same .entityScoreBlock gap:2px as the football
                        // champion/runner-up club rows below, instead of
                        // .info's own (larger) 7px gap between direct
                        // children — tied players read as one tight group,
                        // same as the club standings rows do.
                        <div className={styles.entityScoreBlock}>
                          {leadingPlayers.map(player => {
                            const statKey = activeTab === 'passers' ? 'assists' : 'goals'
                            const val = player?.[statKey] ?? ''
                            const age = calcAge(player.birth_date, s?.end_date, player.death_date)
                            return (
                              <div key={player.id} className={styles.eventNameRow}>
                                <Flag iso2={player.country_iso2} name={player.country_name} className={styles.winnerFlag} />
                                <span className={styles.eventWinner}>
                                  {player.display_name || player.canonical_name}
                                  {val !== '' && ` (${val})`}
                                </span>
                                {(age != null || player.club_name) && (
                                  <span className={styles.eventDetails}>
                                    {age != null && `${age} years`}
                                    {age != null && player.club_name && ' | '}
                                    {player.club_name}
                                  </span>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                      : null
                ) : top3Standings.length > 0 ? (
                  // Club standings context, real top-3 data available — all
                  // 3 rows (champion + runner-ups) share one column-aligned
                  // block, reusing the exact same .scoreName/.scoreValue
                  // fixed-width layout as basketball's own winner/loser rows
                  // above, so points land in the same column regardless of
                  // "Paris Saint Germain" vs "Lens" vs "Lille"'s very
                  // different name lengths, with identical row-to-row
                  // spacing throughout (previously the champion used a
                  // different .eventNameRow block entirely, with no points
                  // shown and uneven spacing against the runner-up rows).
                  <div className={styles.entityScoreBlock}>
                    {top3Standings.map(row => (
                      <div key={row.entity_id} className={styles.scoreRow}>
                        <span className={`${styles.scoreName} ${row.position === 1 ? styles.eventWinner : styles.eventLoser}`}>
                          {row.display_name || row.canonical_name}
                        </span>
                        <span className={`${styles.scoreValue} ${row.position === 1 ? styles.eventWinner : styles.eventLoser}`}>
                          {row.stats?.points ?? '—'} pts
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  // No standings data (still loading, or a knockout-only
                  // competition like the World Cup/UCL with no 'standings'
                  // tab at all) — plain champion name, no points column.
                  <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>{winner.canonical_name}</div>
                )
              )}
            </div>

            {/* Col 1 row 2: spacer */}
            <div />

            {/* Col 2 row 2: score block — tennis/football only. Basketball's
                score ("| 4 - 1", inline next to the winner name above) and
                per-game sequence (eventSubDetails) now live in .info, so this
                cell stays empty for basketball. */}
            {isPast && winner && sets.length > 0 && !walkover && !(isBasketballAwards && !isTeamRosterAwardsTab) && !isBasketball && !isScorersTab
              ? <div className={styles.scoreBlock}>
                  {[
                    { entity: winner, dim: false },
                    { entity: loser,  dim: true  },
                  ].filter(r => r.entity).map((row, i) => (
                    <div key={i} className={styles.scoreRow}>
                      <Flag iso2={row.entity.country_iso2} name={row.entity.country_iso2} className={styles.scoreFlag} />
                      <span className={`${styles.scoreName} ${isFootball ? styles.scoreNameCompact : ''} ${row.dim ? styles.eventLoser : styles.eventWinner}`}>
                        {row.entity.display_name || row.entity.canonical_name}
                        {isTennis && (() => {
                          const rank = row.entity.rank_at_event
                          const age  = calcAge(row.entity.birth_date, s?.end_date, row.entity.death_date)
                          if (!rank && age == null) return null
                          return (
                            <span className={styles.rankSuffix}>
                              {rank && `(${rank})`}
                              {rank && age != null && ' I '}
                              {age != null && `${age} years`}
                            </span>
                          )
                        })()}
                      </span>
                      <span className={styles.scoreSetGroup}>
                        {sets.map((set, j) => {
                          const myScore  = row.dim ? set.l : set.w
                          const oppScore = row.dim ? set.w : set.l
                          const wonSet   = myScore > oppScore
                          return (
                            <span key={j} className={`${styles.scoreSetCell} ${isFootball ? styles.scoreSetCellFootball : ''}`}>
                              <span className={`${styles.scoreValue} ${wonSet ? styles.eventWinner : styles.eventLoser}`}>
                                {myScore}
                              </span>
                              {isFootball ? (
                                // Penalty shootout score — final drawn after
                                // normal + extra time, decided on penalties
                                // (World Cup finals 1994/2006/... etc) — sits
                                // right next to the goal score, not out past
                                // tennis' reserved tiebreak slot (unused here).
                                penalty && (
                                  <span className={`${styles.penaltySuffix} ${row.dim ? styles.eventLoser : styles.eventWinner}`}>
                                    ({row.dim ? penalty.l : penalty.w})
                                  </span>
                                )
                              ) : (
                                // Tiebreak: always reserve space, only show when applicable
                                <span className={styles.scoreTbSlot}>
                                  {set.tb != null && wonSet
                                    ? <sup className={styles.scoreTb}>{set.tb}</sup>
                                    : null
                                  }
                                </span>
                              )}
                            </span>
                          )
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              : isPast && winner && !isFootball && !isBasketball && (sets.length === 0 || walkover)
                ? <div className={`${styles.eventNameRow} ${styles.eventWinner}`} style={{ gridColumn: 2, gridRow: 2 }}>
                    {winner.canonical_name}
                    {isTennis && (() => {
                      const rank = winner.rank_at_event
                      const age  = calcAge(winner.birth_date, s?.end_date, winner.death_date)
                      if (!rank && age == null) return null
                      return (
                        <span className={styles.rankSuffix}>
                          {rank && `(${rank})`}
                          {rank && age != null && ' I '}
                          {age != null && `${age} years`}
                        </span>
                      )
                    })()}
                  </div>
                : <div />
            }
          </div>

          {/* Stat bloc: fixed-order award/trophy list — sits between the
              name/team info and the athlete/team logo. Variant A
              (athleteStatRows) on genuine single-winner basketball award
              tabs, Variant B (teamStatRows) on basketball Champion/team-
              roster pages, Variant C (allStarTeamStatRows) on All-Star
              Results/roster pages, tennisStatRows on tennis pages —
              mutually exclusive, never more than one set at once. */}
          {(athleteStatRows || teamStatRows || allStarTeamStatRows || footballTeamStatRows || footballPlayerStatRows || tennisStatRows) && (
            <div className={styles.statBloc}>
              <div className={styles.statBlocRows}>
                {(athleteStatRows || teamStatRows || allStarTeamStatRows || footballTeamStatRows || footballPlayerStatRows || tennisStatRows).map(row => (
                  <div key={row.key} className={`${styles.statBlocRow} ${row.highlighted ? styles.statBlocHighlight : ''}`}>
                    <span className={styles.statBlocLabel}>
                      {row.label}
                      {row.highlighted && <span className={styles.statBlocBadge}>+{row.badgeCount ?? 1}</span>}
                    </span>
                    <span className={styles.statBlocValue}>
                      {row.sub && <span className={styles.statBlocSub}>{row.sub} </span>}
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.statBlocTitle}>
                {tennisStatRows
                  ? (isGrandSlamPage ? `Grand Slam record through ${activeYear}` : `Tournament record through ${activeYear}`)
                  : <>Awards &amp; trophies won by {activeYear}</>}
              </div>
            </div>
          )}

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
            <div className={`${styles.portraitWrap} ${(isBasketball || isTennis || footballTeamStatRows || footballPlayerStatRows) ? styles.portraitWrapNarrow : ''}`}>
              {isScorersTab && isFootball ? (
                leadingPlayers.length === 1 ? (
                  <img
                    src={`/media/athletes/football/male/portrait/${leadingPlayers[0].slug}.png`}
                    alt={leadingPlayers[0].canonical_name}
                    className={`${styles.portrait} ${styles.portraitSquare}`}
                    onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette(sport, activeGender) }}
                  />
                ) : (
                  <img
                    src={getDefaultSilhouette(sport, activeGender)}
                    alt=""
                    className={`${styles.portrait} ${styles.portraitSquare} ${styles.portraitDefault}`}
                  />
                )
              ) : showClubLogo ? (
                clubLogoSrc
                  ? (
                    // National teams (World Cup, Olympics, ...) get a small
                    // country-flag badge (white ring) over the bottom-right
                    // corner of their photo — a club crest already carries
                    // its country implicitly (or not at all, for
                    // multinational clubs), so this is intentionally
                    // national_team-only, not every football winner.
                    winner?.entity_type === 'national_team'
                      ? (
                        <span className={styles.nationalTeamPhotoWrap}>
                          <img
                            src={clubLogoSrc}
                            alt={winner?.canonical_name || ''}
                            className={`${styles.portrait} ${styles.portraitSquare}`}
                            onError={e => { e.target.style.display = 'none' }}
                          />
                          <Flag
                            iso2={winner?.country_iso2}
                            name={winner?.country_name || winner?.canonical_name}
                            className={styles.nationalTeamFlagBadge}
                          />
                        </span>
                      )
                      : <img
                          src={clubLogoSrc}
                          alt={winner?.canonical_name || ''}
                          className={`${styles.clubLogo} ${isBasketball ? styles.clubLogoBasketball : ''}`}
                          onError={e => {
                            if (isBasketball && e.target.src !== new URL('/media/default/club.png', window.location.href).href) {
                              e.target.src = '/media/default/club.png'
                            } else {
                              e.target.style.display = 'none'
                            }
                          }}
                        />
                  )
                  : isBasketball
                    ? <img src="/media/default/club.png" alt="" className={`${styles.clubLogo} ${styles.clubLogoBasketball}`} />
                    : <Flag iso2={winner?.country_iso2} name={winner?.canonical_name} className={styles.clubLogo} />
              ) : (
                // Tennis + future/ongoing: video (one-shot) or portrait image or
                // default silhouette. Tennis uses the same square, no-crop-circle
                // treatment as F1/NBA's own portraitWrapNarrow+portraitSquare
                // pairing (isTennis below), not the older circular .portrait crop
                // still used by future/ongoing default silhouettes elsewhere.
                isPast && portraitEntity && isVideoPath(portraitSrc)
                  ? <video
                      key={portraitSrc}
                      className={`${styles.portrait} ${isTennis ? styles.portraitSquare : ''}`}
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
                        className={`${styles.portrait} ${(isTennis || (isBasketballAwards && !isTeamRosterAwardsTab)) ? styles.portraitSquare : ''} ${!isPast || !portraitEntity ? styles.portraitDefault : ''}`}
                        onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette(sport, activeGender) }}
                      />
                    : null
              )}
            </div>
          )}
        </div>

        {/* ── Zone 3: Stats bar ── */}
        <div className={styles.bottom}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Schedule</span>
            <span className={styles.statVal}>
              {fmtDateRange(s?.start_date, s?.end_date)}
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
                  {isQuadOrBiennial && competition?.edition_years?.length
                    // Quadrennial/biennial competitions don't run every
                    // calendar year, so "years since founded" (the annual-
                    // league formula below) way overcounts — e.g. World Cup
                    // 2026 read as 97th edition instead of the real 23rd.
                    // edition_years already lists just the real tournament
                    // years, so this year's 1-based position in that list
                    // IS the edition number.
                    ? (() => {
                        const idx = competition.edition_years.indexOf(activeYear)
                        return idx >= 0 ? idx + 1 : '—'
                      })()
                    : competition?.founded_year
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
              {/* Final Tour/Group Stages are tab_groups, not tab_keys —
                  activeTab settles on whichever specific sub-tab is
                  selected (e.g. 'final', 'group-1'), so matching against
                  activeTab itself never fires; activeTabGroup (already
                  resolved by ContentArea.jsx from the active tab's own
                  row) is the one that actually reflects "which section". */}
              {(activeTab === 'standings' || activeTab === 'countries' || activeTabGroup === 'final_tour' || activeTabGroup === 'group_stages') && (
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
              {!footballTeamStatRows && (activeTab === 'standings' || activeTabGroup === 'final_tour' || activeTabGroup === 'group_stages') && isPast && history != null && (
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
                          {toDisplayYear(history.prev_title_year)}
                          <span className={styles.statSub}> | {activeYear - toDisplayYear(history.prev_title_year)} years ago</span>
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
          ) : isTennis ? (
            // Tennis: Participations/Titles, Age/Rank and Last Title moved
            // into the stat bloc (tennisStatRows) — this bar now only adds
            // Players (draw size for the active gender tab) after Schedule/
            // Edition above.
            tennisSeasonStats && (
              <>
                <div className={styles.statSep} />
                <div className={styles.statBlock}>
                  <span className={styles.statLabel}>Players</span>
                  <span className={styles.statVal}>{tennisSeasonStats.players}</span>
                </div>
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
            </>
          )}

          <div className={styles.rankks}>RANKKS</div>
          {(logoUrl || competition.logo_url) && (
            <div className={styles.bottomLogoWrap}>
              <img src={resolveLogoUrl(logoUrl || competition.logo_url)} alt="" className={styles.bottomLogo} onError={e => { e.target.style.display = 'none' }} />
            </div>
          )}

          {/* Full breadcrumb (Competition I Year I Line A I Line B) — one
              line, once per page, instead of each template below repeating
              its own copy of it (previously duplicated once per template:
              e.g. Group Stages' combined standings+games view showed it
              twice, once above each). Inside .bottom itself (not a sibling
              box below it) so it shares the same card/background as
              Schedule/Edition/Teams/Players — .breadcrumbLine forces it
              onto its own row via flex-basis:100% (.bottom has
              flex-wrap:wrap for exactly this). Reuses the global .page-title
              class the templates used to render it with, so it looks
              identical, just relocated. */}
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
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
    'draw-singles-m': ["Men's single",        "Champion",          "Champion"        ],
    'draw-singles-f': ["Women's single",       "Champion",         "Champion"       ],
    'draw-doubles-m': ["Men's double",         "Men's double champions",          "Men's double champions"        ],
    'draw-doubles-f': ["Women's double",       "Women's double champions",        "Women's double champions"      ],
    'draw-doubles-x': ["Mixed double",         "Mixed double champions",          "Mixed double champions"        ],
    'players-m':      ["Men's players list",   "Men's players list",              "Men's players list"            ],
    'players-f':      ["Women's players list", "Women's players list",            "Women's players list"          ],
    'standings':      ["League standings",     "Champion",                        "Current league leader"         ],
    'results':        ["Results",              "Champion",                         "Current league leader"         ],
    'final_tour':     ["Results",              "Champion",                       "Current league leader"         ],
    'scorers':        ["Top scorers",          "Top scorer",                      "Current top scorer"            ],
    'passers':        ["Assists",              "Assist leader",                   "Current assist leader"         ],
    'players':        ["Players",              "Champion",                      "Current league leader"         ],
    // World Cup's actual tab_keys — the banner always shows the overall
    // tournament champion regardless of which sub-tab is active, so every
    // one of these uses the same "Champion" wording.
    'final':          ["Final",                "Champion",                        "Live"                          ],
    '3rd-place':      ["3rd Place",            "Champion",                        "Live"                          ],
    'semi-finals':    ["Semifinals",           "Champion",                        "Live"                          ],
    'quarter-finals': ["Quarter Finals",       "Champion",                        "Live"                          ],
    'round-of-16':    ["Round of 16",          "Champion",                        "Live"                          ],
    'round-of-32':    ["Round of 32",          "Champion",                        "Live"                          ],
    'countries':      ["Countries",            "Champion",                        "Current leader"                ],
  }
  // Group tabs are dynamic (group-a through group-l, or beyond) — a
  // fixed map can't cover every letter, so match by prefix instead.
  if (tab?.startsWith('group-')) {
    if (!withChampion) return 'Group Stage'
    return isPast ? 'Champion' : 'Live'
  }
  const entry = map[tab]
  if (!entry) return ''
  if (!withChampion) return entry[0]
  return isPast ? entry[1] : entry[2]
}

// ─── TENNIS HOME BLOCK — same minimal 2-line banner as F1HomeBlock
// (F1EventBlock.jsx): pink "ATP"/"WTA" pill, "Home of ATP"/"Home of WTA"
// title, tour logo on the right. No competition entity represents "ATP"/
// "WTA" as a whole (each category is a DB category row, not a
// competition), so there's no admin-managed logo_url to read here the
// way F1HomeBlock reads one off the F1 competition row — falls back to a
// static shortcut icon (same /media/shortcut/ folder the top-nav
// shortcuts already use) with the same graceful text-fallback (allTimeLogoText)
// F1HomeBlock uses if that file is ever missing, e.g. WTA has no
// shortcut icon yet.
export function TennisHomeBlock({ tour }) {
  const activeYear = useAppStore(s => s.activeYear)
  const [logoFailed, setLogoFailed] = useState(false)
  const [logoUrl, setLogoUrl] = useState(null)
  // Gates rendering the <img> at all until the entity-logo fetch has
  // settled — without this, the very first render (logoUrl still null)
  // shows the /media/shortcut/{tour}.png fallback, which 404s for any tour
  // that has no shortcut icon file (WTA does not); that 404 fires onError
  // and permanently sets logoFailed=true BEFORE the real fetch resolves,
  // so the correct logo — once it arrives — never even gets attempted
  // (found 2026-08-10: WTA's real logo was configured and reachable, but
  // the Totals/Watch/Home banners all still showed the text-pill fallback).
  const [logoLoaded, setLogoLoaded] = useState(false)
  const label = tour === 'wta' ? 'WTA' : 'ATP'

  // ATP/WTA are real entities now (entity_type='tour', added 2026-08-09),
  // resolved the same era-aware way every other club/team logo is, instead
  // of a hardcoded shortcut icon that could never reflect a rebrand. Falls
  // back to the shortcut icon (then to the text pill) if no entity_logos/
  // entities.image_url is set yet — true today since nobody's uploaded
  // ATP/WTA logos via the Clubs admin page yet.
  useEffect(() => {
    let cancelled = false
    setLogoFailed(false)
    setLogoLoaded(false)
    api.getEntityLogo(tour === 'wta' ? 'wta' : 'atp', activeYear)
      .then(d => { if (!cancelled) { setLogoUrl(d?.logo_url || null); setLogoLoaded(true) } })
      .catch(() => { if (!cancelled) { setLogoUrl(null); setLogoLoaded(true) } })
    return () => { cancelled = true }
  }, [tour, activeYear])

  const logoSrc = resolveLogoUrl(logoUrl) || `/media/shortcut/${tour === 'wta' ? 'wta' : 'atp'}.png`

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>{label}<PillHomeIcon /></span>
          <span className={styles.eventName}>
            Home of {label}
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoLoaded ? null : !logoFailed
              ? <img src={logoSrc} alt={label} className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>{label}</span>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── FOOTBALL HOME BLOCK — same compact banner as F1HomeBlock/TennisHomeBlock,
// pink pill + "Home of {competition.name}" title, driven directly by the
// competition row's own logo_url/short_code (a real DB entity, unlike
// ATP/WTA which needed a separate tour-entity-logo fetch) — so this works
// for World Cup today and any future quadrennial/biennial competition with
// no extra wiring, same convention-over-configuration as isQuadOrBiennial
// elsewhere in this file.
export function FootballHomeBlock({ competition, pageTitle }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const label = competition?.name || 'Home'
  const shortLabel = competition?.short_code || label
  const logoSrc = resolveLogoUrl(competition?.logo_url)

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>{label}<PillHomeIcon /></span>
          <span className={styles.eventName}>
            Home of {label}
          </span>
          {logoSrc && (
            <div className={styles.bottomLogoWrap}>
              {!logoFailed
                ? <img src={logoSrc} alt={label} className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
                : <span className={styles.allTimeLogoText}>{shortLabel}</span>
              }
            </div>
          )}
          {/* Breadcrumb encapsulated in the same card, own row via
              .breadcrumbLine's flex-basis:100% + top border — same
              convention every other EventBlock variant uses, this one was
              missing it too (2026-08-13: "add breadcrumb to bloc"). */}
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── WATCH BLOCK — same compact banner as TennisHomeBlock/TennisTotalsBlock,
// "Watch Center" framing (mirrors F1IconicMomentsBlock's own wording).
export function TennisWatchBlock({ tour }) {
  const activeYear = useAppStore(s => s.activeYear)
  const [logoFailed, setLogoFailed] = useState(false)
  const [logoUrl, setLogoUrl] = useState(null)
  // See TennisHomeBlock's identical block for the race this guards against.
  const [logoLoaded, setLogoLoaded] = useState(false)
  const label = tour === 'wta' ? 'WTA' : 'ATP'

  useEffect(() => {
    let cancelled = false
    setLogoFailed(false)
    setLogoLoaded(false)
    api.getEntityLogo(tour === 'wta' ? 'wta' : 'atp', activeYear)
      .then(d => { if (!cancelled) { setLogoUrl(d?.logo_url || null); setLogoLoaded(true) } })
      .catch(() => { if (!cancelled) { setLogoUrl(null); setLogoLoaded(true) } })
    return () => { cancelled = true }
  }, [tour, activeYear])

  const logoSrc = resolveLogoUrl(logoUrl) || `/media/shortcut/${tour === 'wta' ? 'wta' : 'atp'}.png`

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>{label}<PillPlayIcon /></span>
          <span className={styles.eventName}>
            Watch Center of the {activeYear} {label} season
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoLoaded ? null : !logoFailed
              ? <img src={logoSrc} alt={label} className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>{label}</span>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── RANKINGS BLOCK — same compact banner as TennisHomeBlock/
// TennisTotalsBlock, "athlete"-framed wording (Mohamed 2026-08-16:
// "Eventblock = athlete") since this page lists ranked players rather
// than tournament editions or aggregated stats.
export function TennisRankingsBlock({ tour }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const [logoUrl, setLogoUrl] = useState(null)
  // See TennisHomeBlock's identical block for the race this guards against.
  const [logoLoaded, setLogoLoaded] = useState(false)
  const label = tour === 'wta' ? 'WTA' : 'ATP'

  useEffect(() => {
    let cancelled = false
    setLogoFailed(false)
    setLogoLoaded(false)
    api.getEntityLogo(tour === 'wta' ? 'wta' : 'atp', new Date().getFullYear())
      .then(d => { if (!cancelled) { setLogoUrl(d?.logo_url || null); setLogoLoaded(true) } })
      .catch(() => { if (!cancelled) { setLogoUrl(null); setLogoLoaded(true) } })
    return () => { cancelled = true }
  }, [tour])

  const logoSrc = resolveLogoUrl(logoUrl) || `/media/shortcut/${tour === 'wta' ? 'wta' : 'atp'}.png`

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>{label}</span>
          <span className={styles.eventName}>
            {label} Rankings
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoLoaded ? null : !logoFailed
              ? <img src={logoSrc} alt={label} className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>{label}</span>
            }
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── TOTALS BLOCK — same compact banner as TennisHomeBlock/F1AllTimeBlock,
// "Aggregated statistics" framing instead of Home's own.
export function TennisTotalsBlock({ tour }) {
  const activeYear = useAppStore(s => s.activeYear)
  const [logoFailed, setLogoFailed] = useState(false)
  const [logoUrl, setLogoUrl] = useState(null)
  // See TennisHomeBlock's identical block for the race this guards against.
  const [logoLoaded, setLogoLoaded] = useState(false)
  const label = tour === 'wta' ? 'WTA' : 'ATP'

  useEffect(() => {
    let cancelled = false
    setLogoFailed(false)
    setLogoLoaded(false)
    api.getEntityLogo(tour === 'wta' ? 'wta' : 'atp', activeYear)
      .then(d => { if (!cancelled) { setLogoUrl(d?.logo_url || null); setLogoLoaded(true) } })
      .catch(() => { if (!cancelled) { setLogoUrl(null); setLogoLoaded(true) } })
    return () => { cancelled = true }
  }, [tour, activeYear])

  const logoSrc = resolveLogoUrl(logoUrl) || `/media/shortcut/${tour === 'wta' ? 'wta' : 'atp'}.png`

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>{label}<PillBarsIcon /></span>
          <span className={styles.eventName}>
            Aggregated statistics across the selected {label} seasons
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoLoaded ? null : !logoFailed
              ? <img src={logoSrc} alt={label} className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>{label}</span>
            }
          </div>
        </div>
      </div>
    </div>
  )
}
