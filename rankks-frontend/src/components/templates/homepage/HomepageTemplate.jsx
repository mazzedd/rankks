// templates/homepage/HomepageTemplate.jsx
//
// New app landing page (Mohamed 2026-08-20 mockup) — 3 columns: the
// existing Sidebar (rendered by App.jsx itself, not this file), Bloc A
// (a browsable list of real ongoing/next/past events across sports,
// grouped into expandable league boxes), and Bloc B (detail panel for
// whichever event is selected in Bloc A, defaulting to the first one).
// Explicitly a UX prototype ("Nothing is fixed yet. Goal is to test
// UX") — real data wherever it's cheaply available, clearly-fake
// placeholders only where there's genuinely no data yet (odds), rather
// than half-wiring something that looks real but silently lies.
//
// STATUS (2026-08-20: "all games with status = ONGOING, NEXT or PAST must
// be displayed... remove the fake dots... display real status. we should
// see MOTOGP, F1, Tennis and UFC") — every league box below is real data,
// classified with the same classifyByDate()/getStatus() machinery F1/
// MotoGP/UFC's own Home pages already use, not a hand-tuned per-row demo
// flag. Tennis is the one exception worth naming: TML's live-feed
// ingestion only ever records a match once it's DECIDED (no forward
// schedule of not-yet-played rounds exists in this DB), so tennis rows
// are always 'past' — there's no fabricated 'ongoing'/'next' tennis match
// standing in for data we don't have.
//
// Football has no real events pipeline yet — Ligue 1 stays a disabled
// placeholder box (logo only) demonstrating the "user may browse other
// sports" affordance without pretending it has content.
//
// YEAR: hardcoded to 2026 for this prototype (Mohamed 2026-08-20: "defautl
// year sel = 2026"), independent of the global YearSelector/activeYear —
// this page isn't wired into that year-browsing flow yet.
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../../services/api'
import useAppStore from '../../../store/useAppStore'
import useUserStore from '../../../store/useUserStore'
import { getStatus } from '../../EventBlock/EventBlock'
import { classifyByDate } from '../../../utils/eventStatus'
import { sessionLabel as motoGpSessionLabel } from '../../MotoGP/MotoGPContentArea'
import { pathForCompetition } from '../../../routing/urlSchema'
import { isModifiedClick } from '../../../routing/isModifiedClick'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import ChevronIconBase from '../../shared/ChevronIcon'
import { ScrollableTabs } from '../../navigation/LineB'
import { calcAge, fmtDate } from '../../../utils/calcAge'
import styles from './HomepageTemplate.module.css'

const HOMEPAGE_YEAR = 2026
// Same order/names as the top nav (Football/Tennis/Basketball/Racing/
// Combat Sport) — was ['all','tennis','racing','ufc','football'], missing
// Basketball entirely and labeling combat sport by org name (UFC) instead
// of sport name, inconsistent with every other tab here (Mohamed
// 2026-08-26: "nope. missing Combat Sport").
const SPORT_TABS = ['all', 'football', 'tennis', 'basketball', 'racing', 'combat-sport']
// Title case, not ALL CAPS (Mohamed 2026-08-26: "Make it Football instead
// of FOOTBALL") — every other tab row in this file (tennis categories,
// football leagues, racing classes) intentionally stays uppercase, matching
// their own established look; only this top-level sport row changes.
const SPORT_TAB_LABELS = { all: 'All', football: 'Football', tennis: 'Tennis', basketball: 'Basketball', racing: 'Racing', 'combat-sport': 'Combat Sport' }

// Mohamed 2026-08-25: "I want to duplicate the homepage and create home of
// ATP. Big difference: instead of showing ALL TENNIS UFC, etc., place ALL
// GRAND SLAM MASTER 1000 500 250 etc... my next updates (design, font,
// colors, etc.) should be assigned to all page: Home, Home of ATP, home of
// F1" — this file is now the ONE shared implementation behind all of
// those, driven by `scope` ('all' = the main multi-sport homepage; 'atp'/
// 'wta' = a tour-scoped variant whose top tab row is that tour's
// categories instead of sports). Any future visual pass (this CSS module,
// the shared sub-components below) automatically reaches every scope —
// duplicating this file into a second one would NOT have that property,
// which was the whole point of building it this way instead.
// Same category slugs/short names Sidebar.jsx's own tennis section and
// competitions.js's TOUR_CATEGORY_SLUGS use — kept in the same order.
const TENNIS_TOUR_CATEGORIES = {
  atp: ['grand-slam', 'atp-masters-1000', 'atp-masters-500', 'atp-masters-250', 'atp-finals', 'atp-various'],
  wta: ['grand-slam', 'wta-1000', 'wta-500', 'wta-250', 'wta-finals'],
}
// Shortened for the Home tab row specifically (Mohamed 2026-08-19: "Home:
// make it ALL, SLAM, 1000, 500, 250, VAR") — doesn't touch the Schedule
// page's own Category filter, which reads category_short_name straight off
// the DB (event_categories.short_name), not this map.
const CATEGORY_LABELS = {
  'grand-slam': 'Slam',
  'atp-masters-1000': '1000',
  'atp-masters-500': '500',
  'atp-masters-250': '250',
  'atp-finals': 'ATP Finals',
  'atp-various': 'Var',
  'wta-1000': 'WTA 1000',
  'wta-500': 'WTA 500',
  'wta-250': 'WTA 250',
  'wta-finals': 'WTA Finals',
  motogp: 'Moto GP',
  moto2: 'Moto 2',
  moto3: 'Moto 3',
  'ufc-events': 'UFC Events',
  'ufc-fight-nights': 'UFC Fight Nights',
  'nba-regular-season': 'Regular Season',
  'nba-playoffs': 'Playoffs',
  'nba-cup': 'NBA Cup',
}
// UFC tab row (Mohamed 2026-08-25: "now create Home page of UFC: use Moto
// Gp tpl: ALL I UFC EVENTS I UFC FIGHT NIGHTS") — same category-slug-
// filtering mechanism as every scope above, just split by event kind
// (numbered/ppv vs fight-night) instead of a real DB category or a
// dedicated series API param.
const UFC_SCOPE_TABS = ['ufc-events', 'ufc-fight-nights']
// NBA tab row (Mohamed 2026-08-26: "now create the homepage of NBA / based
// upon F1/Moto Gp etc.") — same per-category-box mechanism as UFC/MotoGP
// above, split by the Schedule page's own bloc_key groupings (see
// buildNbaCategoryLeagues) rather than a real DB category: Regular Season
// on its own, every knockout stage (Play-in/Playoffs/Conference Finals/
// NBA Finals) folded into one "Playoffs" tab, and NBA Cup on its own.
const NBA_SCOPE_TABS = ['nba-regular-season', 'nba-playoffs', 'nba-cup']
// 'tennis'/'racing' (not 'atp'/'wta'/'f1'/'motogp' individually — Mohamed
// 2026-08-26: "No more Home of ATP neither Home of WTA... Home of Tennis
// should display all events; ATP and WTA in tabs", same day extended to
// Racing: "RACING: F1 I Moto GP I Moto 2 I Moto 3") — ONE sport-wide hub
// per sport, with the underlying series now a tab split WITHIN it instead
// of separate hub destinations) — see buildTennisAllLeagues/
// buildRacingAllLeagues/tabsForScope/matchesSportTab below for the merges.
function isTourScope(scope) { return scope === 'tennis' || scope === 'racing' || scope === 'ufc' || scope === 'nba' }
// tabsForScope's `leagues` param is only used by 'football' (its tab list
// is dynamic — one per real league with data — unlike tennis's/racing's
// fixed tab lists); every other scope ignores it and can be called with none.
function tabsForScope(scope, leagues = []) {
  // F1 has no sub-tier of its own (one flat 'f1' tab); MotoGP's three
  // classes each get their own (Mohamed 2026-08-23's original tab list,
  // carried over unchanged into the merged hub).
  if (scope === 'racing') return ['all', 'f1', 'motogp', 'moto2', 'moto3']
  if (scope === 'ufc') return ['all', ...UFC_SCOPE_TABS]
  if (scope === 'nba') return ['all', ...NBA_SCOPE_TABS]
  // ATP/WTA as the split now, not a category tier (Mohamed 2026-08-26).
  if (scope === 'tennis') return ['all', 'atp', 'wta']
  // One tab per league that actually built a box (Mohamed 2026-08-26:
  // "Home of Football (gathering Ligue 1, Premier League, UCL, etc.)") —
  // data-driven off whatever buildFootballAllLeagues actually returned,
  // not a hardcoded league list, so a newly-ingested league picks up its
  // own tab with zero code changes here.
  if (scope === 'football') return ['all', ...leagues.map(l => l.key)]
  return SPORT_TABS
}
function tabLabelForScope(scope, t, leagues = []) {
  if (scope === 'football') return t === 'all' ? 'ALL' : (leagues.find(l => l.key === t)?.label || t).toUpperCase()
  if (!isTourScope(scope)) return SPORT_TAB_LABELS[t] || t
  return (t === 'all' ? 'All' : (CATEGORY_LABELS[t] || t)).toUpperCase()
}

// Shared by visibleLeagues' filtering and selectSportFilter's "expand this
// tab's first box" lookup, so the two can never disagree on what a tab
// actually shows. Tour-scoped pages match on the league's own categorySlug
// (every league built there is tennis anyway) instead of matchType.
function matchesSportTab(league, tab, scope) {
  if (tab === 'all') return true
  if (scope === 'tennis') return league.tour === tab
  if (scope === 'football') return league.key === tab
  // F1's own box has categorySlug 'all' (no real sub-tier — see
  // buildRaceCategoryLeagues), so it has to match on `family` instead;
  // MotoGP's three classes each set categorySlug to their own class slug
  // already, which matches the tab id directly.
  if (scope === 'racing') return tab === 'f1' ? league.family === 'f1' : league.categorySlug === tab
  if (isTourScope(scope)) return league.categorySlug === tab
  if (tab === 'tennis') return league.matchType === 'tennis'
  if (tab === 'racing') return league.matchType === 'race'
  // 'combat-sport', not 'ufc' — tab id renamed to match the sport (not the
  // org) the same way every other tab here already is; the league's own
  // matchType stays 'ufc' (buildUfcLeague's own internal value, untouched).
  if (tab === 'combat-sport') return league.matchType === 'ufc'
  if (tab === 'basketball') return league.matchType === 'nba'
  if (tab === 'football') return league.matchType === 'football'
  return false
}

function portraitPath(slug, gender) {
  if (!slug) return null
  const folder = gender === 'F' ? 'female' : 'male'
  return `/media/athletes/tennis/${folder}/profile/${slug}.png`
}

// Same normalization TennisHomeBlock/EventBlock.jsx use for entity logos
// (a bare path entered via admin, not prefixed with /media/).
function resolveLogoUrl(url) {
  if (!url) return null
  if (url.startsWith('http://') || url.startsWith('https://')) return url
  if (url.startsWith('/media/')) return url
  if (url.startsWith('/')) return `/media${url}`
  return `/media/${url}`
}

// Real set-by-set score for one side of a decided match (games.score.sets
// is [{w,l,tb}, ...] keyed by WINNER/LOSER, not home/away — remapped here).
// Undecided games (and every non-tennis matchType, whose score is always
// null) have no sets to show — returns [] harmlessly either way.
function setScoresFor(game, side) {
  if (game.winner_id == null || !game.score?.sets?.length) return []
  const homeWon = game.winner_id === game.home_id
  const isWinnerSide = (side === 'home') === homeWon
  return game.score.sets.map(s => (isWinnerSide ? s.w : s.l))
}

// Real ATP/WTA ranking AT THE TIME of this specific match — TML's per-match
// stats carry w_rank/l_rank, keyed by winner/loser same as score.sets,
// remapped to home/away here. UFC/F1/MotoGP games never have this field,
// so this harmlessly returns null for them.
function rankFor(game, side) {
  if (game.winner_id == null) return null
  const homeWon = game.winner_id === game.home_id
  const isWinnerSide = (side === 'home') === homeWon
  const rank = isWinnerSide ? game.stats?.w_rank : game.stats?.l_rank
  return rank ?? null
}

// Real status as a small colored dot, not a text badge (Mohamed
// 2026-08-20: "Replace the dots (grey, green and orange) - remove status
// PAST... Dot is placed after date") — same 3 colors StatusBadge's own
// past/ongoing/next pills use (EventBlock.module.css), just a compact dot
// instead of a text pill. Still driven by the same real g._status this
// file already computes via classifyByDate/getStatus — not a reversion to
// the earlier fake per-row dot.
function statusDotClass(status) {
  if (status === 'ongoing') return styles.statusDotOngoing
  if (status === 'next') return styles.statusDotNext
  // 'upcoming' (classifyByDate's own name for "future, but not the very
  // next one") used to be filtered out entirely before reaching this
  // function — now that F1/UFC/MotoGP show future events too (Mohamed
  // 2026-08-21: "want to see only ONGOING, NEXT and FUTURE"), it needs its
  // own color instead of silently falling through to the PAST grey.
  if (status === 'upcoming') return styles.statusDotFuture
  return styles.statusDotPast
}

// "In X days" countdown shown under the date, NEXT/FUTURE status only —
// never past/ongoing (Mohamed 2026-08-21: "Bloc A: under date, in 10
// days... (for next status)" → "assign the 'in 4 days' to all sessions,
// GP of Italy" extended this to future GPs too, not just the very next
// one). Both dates compared at local midnight so a same-day match reads
// as "Today", not "In 0 days".
function daysUntilLabel(dateStr) {
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((target - today) / 86400000)
  if (days <= 0) return null
  if (days === 1) return 'Tomorrow'
  return `In ${days} days`
}

// Each session counts down to ITS OWN date — Practice's own earlier date,
// Race's own later date — not one shared GP-wide value (Mohamed
// 2026-08-21: "what's wrong with u?. should display Practice in 9 days /
// Practice 2 in 10 days .... Race in 12 days" — reverses the earlier "one
// shared countdown per GP" change, which read the request that led to it
// wrong).
function relativeStatusLabel(g) {
  if (g._status !== 'next' && g._status !== 'upcoming') return null
  return daysUntilLabel(g.match_date)
}

// Chevron itself now lives in shared/ChevronIcon.jsx (Mohamed 2026-08-25:
// "use the arrow (homepage for expandable tables)" — HomeTennisTemplate.jsx's
// Date-sort arrow reuses the exact same icon now, extracted here so both
// share one definition instead of a second hand-rolled copy). This wrapper
// keeps the .chevron/.chevronOpen class-based color styling every league
// header here already depended on.
function ChevronIcon({ open }) {
  return <ChevronIconBase open={open} className={`${styles.chevron}${open ? ' ' + styles.chevronOpen : ''}`} />
}

function SlideArrowIcon({ dir }) {
  const points = dir === 'left' ? '15 18 9 12 15 6' : '9 6 15 12 9 18'
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points={points} />
    </svg>
  )
}

// "COMING HOT" shortcut strip (Mohamed 2026-08-21: "now static but I plan
// to make it dynamic later") — 5 fixed banners linking straight to each
// competition's Home page, same navigation `changeCompetitionWithSport`
// uses everywhere else (Sidebar, MainNav, goToFullCompetition below).
// Images live in rankks-api/media/shortcut/ (already used for the ATP/WTA
// tour-logo fallback elsewhere in this file) — filenames confirmed against
// the real folder contents (worldcup.jpg / cincinnatti.jpg, not the
// pl.jpg / cincinnati.jpg spelling first mentioned).
const COMING_HOT_ITEMS = [
  { key: 'worldcup', img: '/media/shortcut/worldcup.jpg', label: 'World Cup', sport: 'football', competitionSlug: 'fifa-world-cup-men', categorySlug: null },
  { key: 'ufc', img: '/media/shortcut/ufc.jpg', label: 'UFC', sport: 'mma', competitionSlug: 'ufc', categorySlug: null },
  { key: 'f1', img: '/media/shortcut/f1.jpg', label: 'F1', sport: 'car-racing', competitionSlug: 'formula-1-world-championship', categorySlug: null },
  { key: 'motogp', img: '/media/shortcut/motogp.jpg', label: 'MotoGP', sport: 'car-racing', competitionSlug: 'motogp', categorySlug: null },
  { key: 'cincinnati', img: '/media/shortcut/cincinnatti.jpg', label: 'Cincinnati', sport: 'tennis', competitionSlug: 'cincinnati-open', categorySlug: 'atp-masters-1000' },
]

function ComingHotCarousel({ onNavigate, store }) {
  const trackRef = useRef(null)
  const scroll = (dir) => {
    const track = trackRef.current
    if (!track) return
    track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: 'smooth' })
  }
  return (
    <div className={styles.comingHotCard}>
      <div className={styles.comingHotHeader}>Coming Hot</div>
      <div className={styles.comingHotBody}>
        <button type="button" className={styles.comingHotArrow} onClick={() => scroll(-1)} aria-label="Previous">
          <SlideArrowIcon dir="left" />
        </button>
        <div className={styles.comingHotTrack} ref={trackRef}>
          {COMING_HOT_ITEMS.map(item => (
            <Link
              key={item.key}
              to={pathForCompetition(store, item.sport, item.competitionSlug, item.categorySlug)}
              className={styles.comingHotItem}
              onClick={e => !isModifiedClick(e) && onNavigate(item)}
            >
              <img src={item.img} alt={item.label} />
            </Link>
          ))}
        </div>
        <button type="button" className={styles.comingHotArrow} onClick={() => scroll(1)} aria-label="Next">
          <SlideArrowIcon dir="right" />
        </button>
      </div>
    </div>
  )
}

// Fake, demo-only odds ("A: place an Odds toggle (for demo only)") —
// deterministic per game id so a re-render doesn't jitter the numbers.
// Only shown for 2-competitor matchTypes (tennis/ufc) — a multi-driver
// race has no head-to-head "1 vs 2" price that would make sense here.
function demoOdds(gameId, side) {
  const seed = (gameId * 2654435761) % 100
  const base = 1.5 + (seed % 30) / 10
  return (side === 0 ? base : 5 - base + 1.2).toFixed(2)
}

// better: which direction wins for "highlight best score between 2
// players" — a lower rank number is better (#1 beats #50), everything
// else here is a count where higher is better. Age has no "better" side.
// Every row's label renders at the same size now (Mohamed 2026-08-20:
// "make all labels same size as Age, Season, etc." — reverses the earlier
// small-vs-normal split, .perfLabel itself carries that size uniformly).
const PERF_ROWS = [
  { key: 'age', label: 'Age', better: null },
  { key: 'seasons', label: 'Seasons', better: 'higher' },
  { key: 'best_rank', label: 'Best Rankings', better: 'lower' },
  { key: 'wins_gs', label: 'Grand Slam', better: 'higher' },
  { key: 'wins_finals', label: null, better: 'higher' }, // label filled per-tour (ATP/WTA Final)
  { key: 'wins_m1000', label: 'Master 1000', better: 'higher' },
  { key: 'wins_m500', label: 'Master 500', better: 'higher' },
  { key: 'wins_m250', label: 'Master 250', better: 'higher' },
]

// UFC's Performances rows (Mohamed 2026-08-21: "For UFC: Age Seasons
// Champion Fights % wins Knockouts Submissions 1st R. Finishes") — driven
// by /results/mma/fighter-career/:entityId, the same real per-fighter
// career totals route MmaEventTemplate's own EventBlock stat bloc already
// uses (wins/losses/draws/wins_by_ko/wins_by_submission/
// first_round_finishes/titles/seasons/birth_date), not a guessed schema.
const UFC_PERF_ROWS = [
  { key: 'age', label: 'Age', better: null },
  { key: 'seasons', label: 'Seasons', better: 'higher' },
  { key: 'titles', label: 'Champion', better: 'higher' },
  { key: 'fights', label: 'Fights', better: 'higher' },
  // suffix renders after the number (Mohamed 2026-08-21: "add % to values
  // like 75%") without turning the value into a string — the "better"
  // highlight comparison below needs it to stay a real number.
  { key: 'win_pct', label: '% wins', better: 'higher', suffix: '%' },
  { key: 'wins_by_ko', label: 'Knockouts', better: 'higher' },
  { key: 'wins_by_submission', label: 'Submissions', better: 'higher' },
  { key: 'first_round_finishes', label: '1st R. Finishes', better: 'higher' },
]

// Short round codes for the tennis event-group title (Mohamed 2026-08-21:
// "Also Tennis, mention Round. Ex. Cincinnati R32 etc.") — same round
// names TennisResultsDrawer.jsx's own ROUND_ORDER map already uses.
const ROUND_ABBREV = {
  'Round of 128': 'R128', 'Round of 64': 'R64', 'Round of 32': 'R32', 'Round of 16': 'R16',
  'Quarter-Final': 'QF', 'Semi-Final': 'SF', 'Final': 'F', 'Round Robin': 'RR', 'Bronze Match': 'BR',
}
function roundAbbrev(round) {
  return ROUND_ABBREV[round] || round || ''
}

// "Grand Prix of X", normal case, for both F1 and MotoGP (Mohamed
// 2026-08-21: "F1 and MotoGp, display GRANDPRIX OF and sessions... with
// no CAPS") — F1's gp.name is just the bare country ("Australia"), no
// prefix; MotoGP's is already prefixed but stored ALL CAPS in the DB
// ("GRAND PRIX OF THAILAND") — both normalized to the same "Grand Prix of
// Thailand" shape here rather than trusting either field's raw casing.
function titleCase(str) {
  return str.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}
function raceEventTitle(gpName) {
  const stripped = (gpName || '').replace(/^grand prix of\s+/i, '').trim()
  return `Grand Prix of ${titleCase(stripped)}`
}

// ── Per-sport league builders ──────────────────────────────────────────
// Each returns a normalized { key, label, matchType, logoUrl, games } or
// null (nothing to show). games are normalized to a shared shape (home_*/
// away_*/winner_id/score/stats/_status/_eventName) so the row/detail
// renderers below don't need to branch on sport, only on matchType.

// Shared tail of buildTennisLeague/buildTennisCategoryLeagues below — both
// need "6 most recent decided matches of THIS ongoing tournament, soonest
// of those six on top" for whatever box (key/label) they're building.
// Extracted so the tour-wide box (buildTennisLeague) and each per-category
// box (buildTennisCategoryLeagues) can't drift out of sync on this logic.
async function buildTennisLeagueFromOngoingRow(ongoingRow, tour, tabKey, key, label, logoUrl) {
  const gamesRes = await api.getGames(ongoingRow.season_id, tabKey).catch(() => null)
  const allGames = Object.values(gamesRes?.games_by_round || {}).flat()
  const games = allGames
    .filter(g => g.winner_id != null)
    // Pick the 6 MOST RECENT matches (descending)…
    .sort((a, b) => new Date(b.match_date) - new Date(a.match_date))
    .slice(0, 6)
    // …then display them soonest-first (Mohamed 2026-08-21: "display Bloc
    // A events; the sooner on top (21.08 22.08 23.08 etc)").
    .sort((a, b) => new Date(a.match_date) - new Date(b.match_date))
    .map(g => ({ ...g, _status: 'past', _eventName: `${ongoingRow.competition_name} ${roundAbbrev(g.round)}`.trim() }))
  if (!games.length) return null
  return {
    key,
    label,
    tour,
    gender: tour === 'wta' ? 'F' : 'M',
    matchType: 'tennis',
    competitionSlug: ongoingRow.competition_slug,
    categorySlug: ongoingRow.category_slug,
    logoUrl,
    games,
  }
}

// Tennis — real recent results from whichever tournament is currently
// ongoing (see file header: no forward schedule exists, so every tennis
// row is genuinely 'past', not a fabricated 'ongoing'/'next'). One box for
// the WHOLE tour (scope='all' — ATP box, WTA box).
async function buildTennisLeague(tour) {
  const homeData = await api.getTennisHome(tour, HOMEPAGE_YEAR).catch(() => null)
  const rows = homeData?.rows || []
  const ongoingRow = rows.find(r => getStatus({ start_date: r.start_date, end_date: r.end_date, status: r.status }) === 'ongoing')
  if (!ongoingRow) return null
  const tabKey = tour === 'wta' ? 'draw-singles-f' : 'draw-singles-m'
  const logoRes = await api.getEntityLogo(tour, HOMEPAGE_YEAR).catch(() => null)
  const logoUrl = resolveLogoUrl(logoRes?.logo_url) || `/media/shortcut/${tour}.png`
  return buildTennisLeagueFromOngoingRow(ongoingRow, tour, tabKey, tour, tour.toUpperCase(), logoUrl)
}

// One box PER CATEGORY within a tour (Grand Slam / Masters 1000 / 500 /
// 250 / etc.) instead of one box for the whole tour — powers the tour-
// scoped "Home of ATP"/"Home of WTA" page (Mohamed 2026-08-25). A single
// getTennisHome fetch (not one per category) since it already returns
// every category's rows for the year in one call; each category then
// picks its own ongoing row out of that same shared response. Also
// surfaces min_year/max_year, unused by the caller now that this page is
// frozen to HOMEPAGE_YEAR same as the multi-sport homepage (Mohamed
// 2026-08-19: "permanant page... disable year selector, highlight 2026")
// — kept on the return value rather than stripped, in case a future page
// wants the real range back.
async function buildTennisCategoryLeagues(tour, year) {
  const homeData = await api.getTennisHome(tour, year).catch(() => null)
  const rows = homeData?.rows || []
  const tabKey = tour === 'wta' ? 'draw-singles-f' : 'draw-singles-m'
  const logoRes = await api.getEntityLogo(tour, year).catch(() => null)
  const logoUrl = resolveLogoUrl(logoRes?.logo_url) || `/media/shortcut/${tour}.png`
  const categorySlugs = TENNIS_TOUR_CATEGORIES[tour] || []
  const built = await Promise.all(categorySlugs.map(categorySlug => {
    const ongoingRow = rows.find(r => r.category_slug === categorySlug
      && getStatus({ start_date: r.start_date, end_date: r.end_date, status: r.status }) === 'ongoing')
    if (!ongoingRow) return null
    // category_short_name (real DB value, e.g. "Masters 1000") takes
    // priority here — CATEGORY_LABELS now holds the Home tab row's
    // abbreviated pill text ("1000"), which reads fine as a compact tab
    // but too terse as this box's own section heading.
    const label = ongoingRow.category_short_name || CATEGORY_LABELS[categorySlug] || categorySlug
    // key prefixed with the tour, not just the bare category slug — ATP
    // and WTA both have a 'grand-slam' category, and buildTennisAllLeagues
    // below now combines both tours' boxes into one list, where a bare
    // 'grand-slam' key would collide between them (React list identity +
    // this page's own expandedKeys/selected state both key off league.key).
    return buildTennisLeagueFromOngoingRow(ongoingRow, tour, tabKey, `${tour}-${categorySlug}`, label, logoUrl)
  }))
  return { leagues: built.filter(Boolean), minYear: homeData?.min_year, maxYear: homeData?.max_year }
}

// Sport-wide "Home of Tennis" (Mohamed 2026-08-26: "No more Home of ATP
// neither Home of WTA... Home of Tennis should display all events; ATP and
// WTA in tabs") — both tours' category boxes combined into one list;
// tabsForScope/matchesSportTab then split them back out via each league's
// own `tour` field for the ALL/ATP/WTA tab row. Each category box already
// only appears when it has a real ongoing tournament (see
// buildTennisCategoryLeagues's own ongoingRow check) — same "tabs display
// only ongoing events" rule carries over unchanged, just now spanning both
// tours instead of one.
async function buildTennisAllLeagues(year) {
  const [atp, wta] = await Promise.all([
    buildTennisCategoryLeagues('atp', year),
    buildTennisCategoryLeagues('wta', year),
  ])
  return [...atp.leagues, ...wta.leagues]
}

// UFC — reuses the exact same round-grouping + headliner-first sort +
// classifyByDate the real Home of UFC page (MmaEventTemplate.jsx's
// HomeUfcTable) already uses, just fed from here instead of that page's
// own props.
async function buildUfcLeague() {
  const seasonData = await api.getSeason('ufc', HOMEPAGE_YEAR).catch(() => null)
  const seasonId = seasonData?.seasons?.[0]?.id
  if (!seasonId) return null
  const gamesRes = await api.getGames(seasonId, 'results').catch(() => null)
  const grouped = gamesRes?.games_by_round || {}
  // g.round IS the card/event name for UFC (e.g. "UFC 330: Makhachev vs.
  // Machado Garry" — see results.js), not a bracket round. Group title
  // shows just the short event code, the part before the first colon
  // (Mohamed 2026-08-21: "remove full title, just UFC 330"), and every
  // fight on that card is listed under it — previously only the
  // headliner ("UFC 330 and all fights tied to the event").
  const cards = Object.entries(grouped)
    .map(([round, fights]) => {
      const sorted = [...fights].sort((a, b) => (b.stats?.is_headliner ? 1 : 0) - (a.stats?.is_headliner ? 1 : 0))
      return { key: round, shortName: round.split(':')[0].trim(), date: sorted[0]?.match_date, fights: sorted }
    })
    .filter(c => c.date)
  // Ongoing/next/future only, soonest first — no past events (Mohamed
  // 2026-08-21: "now on Homepage, want to see only ONGOING, NEXT and
  // FUTURE"), a reversal of the earlier "past/ongoing/next, most recent
  // first" behaviour.
  const classified = classifyByDate(cards, c => c.date)
    .filter(c => c.status !== 'past')
    .sort((a, b) => new Date(a.item.date) - new Date(b.item.date))
    .slice(0, 3)
  const games = classified.flatMap(({ item, status }) =>
    item.fights.map(f => ({ ...f, _status: status, _eventName: item.shortName }))
  )
  if (!games.length) return null
  return {
    key: 'ufc',
    label: 'UFC',
    matchType: 'ufc',
    gender: null,
    competitionSlug: 'ufc',
    categorySlug: null,
    logoUrl: resolveLogoUrl(seasonData.competition?.logo_url),
    games,
  }
}

// One box per event KIND — UFC Events (numbered PPV cards) / UFC Fight
// Nights — powers the UFC-scoped Home page (Mohamed 2026-08-25: "now
// create Home page of UFC: use Moto Gp tpl: ALL I UFC EVENTS I UFC FIGHT
// NIGHTS"), same per-category-box mechanism buildRaceCategoryLeagues/
// buildTennisCategoryLeagues already use for MotoGP/ATP-WTA. One shared
// getGames fetch (not one per kind) since both kinds live in the same
// season's response, split client-side exactly like MmaEventTemplate.jsx's
// own HomeUfcTable/`cards` useMemo already does (event_kind === 'numbered'
// -> 'ppv', else 'fn').
async function buildUfcCategoryLeagues(year) {
  const seasonData = await api.getSeason('ufc', year).catch(() => null)
  const seasonId = seasonData?.seasons?.[0]?.id
  if (!seasonId) return []
  const gamesRes = await api.getGames(seasonId, 'results').catch(() => null)
  const grouped = gamesRes?.games_by_round || {}
  const allCards = Object.entries(grouped)
    .map(([round, fights]) => {
      const sorted = [...fights].sort((a, b) => (b.stats?.is_headliner ? 1 : 0) - (a.stats?.is_headliner ? 1 : 0))
      const first = sorted[0]
      return {
        key: round, shortName: round.split(':')[0].trim(), date: first?.match_date,
        kind: first?.stats?.event_kind === 'numbered' ? 'ppv' : 'fn',
        fights: sorted,
      }
    })
    .filter(c => c.date)
  const logoUrl = resolveLogoUrl(seasonData.competition?.logo_url)
  const KINDS = [
    { kind: 'ppv', key: 'ufc-events', label: 'UFC Events' },
    { kind: 'fn', key: 'ufc-fight-nights', label: 'UFC Fight Nights' },
  ]
  const built = KINDS.map(({ kind, key, label }) => {
    // Ongoing/next/future only, soonest first — same "no past events on
    // the Homepage" rule buildUfcLeague/every other league here follows.
    const classified = classifyByDate(allCards.filter(c => c.kind === kind), c => c.date)
      .filter(c => c.status !== 'past')
      .sort((a, b) => new Date(a.item.date) - new Date(b.item.date))
      .slice(0, 3)
    const games = classified.flatMap(({ item, status }) =>
      item.fights.map(f => ({ ...f, _status: status, _eventName: item.shortName }))
    )
    if (!games.length) return null
    return { key, label, matchType: 'ufc', gender: null, competitionSlug: 'ufc', categorySlug: key, logoUrl, games }
  })
  return built.filter(Boolean)
}

// NBA — reuses the exact same /results/home-nba/:year route the real
// Schedule page (nba_home_template.jsx) already fetches (Mohamed
// 2026-08-26: "now create the homepage of NBA / based upon F1/Moto Gp
// etc."), bucketed client-side by that route's own bloc_key into 3 tabs
// instead of 6 — every knockout stage folded into one "Playoffs" box,
// same as how MotoGP/UFC fold their own sub-kinds into a handful of tabs
// rather than one per real DB event. _eventSlug carries each row's real
// event slug through so "Full competition" can land on the exact stage
// (Play-in vs Finals) a Playoffs-tab game actually belongs to, not a
// generic "Playoffs" guess.
const NBA_BLOC_TABS = [
  { key: 'nba-regular-season', label: 'Regular Season', blocs: ['regular-season'] },
  { key: 'nba-playoffs', label: 'Playoffs', blocs: ['play-in', 'playoffs', 'conference-finals', 'nba-finals'] },
  { key: 'nba-cup', label: 'NBA Cup', blocs: ['nba-cup'] },
]
const NBA_BLOC_EVENT_SLUG = {
  'regular-season': 'regular-season-4828', 'play-in': 'play-in-4828', 'playoffs': 'playoffs-4828',
  'conference-finals': 'finals-4828', 'nba-finals': 'finals-4828', 'nba-cup': 'nba-cup-4828',
}
async function buildNbaCategoryLeagues(year) {
  const [homeData, compData] = await Promise.all([
    api.getNbaHome(year).catch(() => null),
    api.getCompetition('nba').catch(() => null),
  ])
  const rows = homeData?.rows || []
  const logoUrl = resolveLogoUrl(compData?.logo_url)
  const built = NBA_BLOC_TABS.map(({ key, label, blocs }) => {
    const tabRows = rows.filter(r => blocs.includes(r.bloc_key))
    // Ongoing/next/future only, soonest first — same "no past events on
    // the Homepage" rule buildUfcLeague/buildRaceLeague already follow.
    const classified = classifyByDate(tabRows, r => r.match_date, { preDays: 0 })
      .filter(c => c.status !== 'past')
      .sort((a, b) => new Date(a.item.match_date) - new Date(b.item.match_date))
      .slice(0, 3)
    const games = classified.map(({ item: r, status }) => ({
      id: r.id,
      match_date: r.match_date,
      home_id: r.home.id, home_name: r.home.name, home_country_iso2: null, home_country_name: null,
      away_id: r.away.id, away_name: r.away.name, away_country_iso2: null, away_country_name: null,
      winner_id: r.home_won === true ? r.home.id : r.home_won === false ? r.away.id : null,
      score: null,
      stats: {},
      _status: status,
      _eventName: r.bloc_label,
      _eventSlug: NBA_BLOC_EVENT_SLUG[r.bloc_key] || 'regular-season-4828',
      _homeLogo: resolveLogoUrl(r.home.logo),
      _awayLogo: resolveLogoUrl(r.away.logo),
    }))
    if (!games.length) return null
    return { key, label, matchType: 'nba', gender: null, competitionSlug: 'nba', categorySlug: key, logoUrl, games }
  })
  return built.filter(Boolean)
}

// Football leagues (Ligue 1, Serie A, Premier League, Bundesliga, La Liga,
// and any future league seeded the same way — Mohamed 2026-08-25: "Create
// home page of Ligue 1, Serie A, etc based upon existing model") — single
// box, no sub-categories (same shape as F1's own lone-competition scope).
// Reuses the exact same flat "Results" games route the Schedule tab itself
// fetches (/results/games/:seasonId/final_tour — see
// football_home_league_template.jsx) instead of a new backend endpoint;
// `scope` IS the competitionSlug (see isFootballLeagueScope above).
async function buildFootballLeagueLeague(scope, year) {
  let seasonData = await api.getSeason(scope, year).catch(() => null)
  let season = seasonData?.seasons?.[0]
  // HOMEPAGE_YEAR is one constant shared by every sport's Home box, correct
  // for all of them EXCEPT a start-year-convention league (Ligue 1 etc.)
  // once its season rolls over — Ligue 1's 2026/27 season is DB year 2026
  // but DISPLAYS as "2027" (see toDisplayYear elsewhere in this app), so
  // `year` (HOMEPAGE_YEAR, 2026) resolves to the wrong, already-finished
  // 2025/26 season here — entirely 'past' games, so the ongoing/next
  // filter below always came back empty ("No ongoing events", Mohamed
  // 2026-08-26: "Home of L1: rule is as follows: show NEXT and ONGOING").
  // Retry at year+1 rather than touching the shared constant (that would
  // break every other sport, where DB year === display year already).
  if (seasonData?.competition?.year_convention === 'start' && season?.status !== 'current') {
    const nextSeasonData = await api.getSeason(scope, year + 1).catch(() => null)
    if (nextSeasonData?.seasons?.[0]?.status === 'current') {
      seasonData = nextSeasonData
      season = nextSeasonData.seasons[0]
    }
  }
  // Only competitions with the flat 'final_tour' Results tab (the same
  // gate ContentArea.jsx's own hasLeagueFinalTour uses) get a Home page —
  // anything else (no season yet, or a differently-shaped competition like
  // UCL) simply shows nothing here, same "sparse until real data exists"
  // tradeoff every other league box in this file already has.
  if (!season?.result_tabs?.some(t => t.tab_key === 'final_tour')) return null
  const gamesRes = await api.getGames(season.id, 'final_tour').catch(() => null)
  const allGames = Object.values(gamesRes?.games_by_round || {}).flat()
  // Ongoing/next/future only, soonest first — same "no past events on the
  // Homepage" rule every other league box here follows.
  const classified = classifyByDate(allGames, g => g.match_date, { preDays: 0 })
    .filter(c => c.status !== 'past')
    .sort((a, b) => new Date(a.item.match_date) - new Date(b.item.match_date))
    .slice(0, 3)
  const games = classified.map(({ item: g, status }) => ({
    id: g.id,
    match_date: g.match_date,
    home_id: g.home_id, home_name: g.home_display_name || g.home_name, home_country_iso2: null, home_country_name: null,
    away_id: g.away_id, away_name: g.away_display_name || g.away_name, away_country_iso2: null, away_country_name: null,
    winner_id: g.winner_id,
    score: null,
    stats: {},
    _status: status,
    // Round text ("Regular Season - 15") as the group title, same "shown
    // once, not repeated per row" convention every other league box uses.
    _eventName: g.round || null,
    _homeLogo: resolveLogoUrl(g.home_logo),
    _awayLogo: resolveLogoUrl(g.away_logo),
  }))
  if (!games.length) return null
  // Display year — the one shown in the URL/year strip, not the raw DB
  // year (Ligue 1 2026 IS the "2026/27" season, displayed as 2027 — see
  // toDisplayYear elsewhere in this app). "Full competition" needs this,
  // not HOMEPAGE_YEAR (2026), or it lands on the wrong, already-finished
  // season (Mohamed 2026-08-26: "Full competition but leads to 2026:
  // should lead to active season 2027").
  const displayYear = seasonData.competition?.year_convention === 'start' ? season.year + 1 : season.year
  return {
    key: scope, label: seasonData.competition?.name || scope, matchType: 'football', gender: null,
    competitionSlug: scope, categorySlug: 'all',
    logoUrl: resolveLogoUrl(seasonData.competition?.logo_url),
    year: displayYear,
    competitionId: seasonData.competition?.id ?? null,
    games,
  }
}

// Sport-wide "Home of Football" (Mohamed 2026-08-26: "No more Home of
// Ligue 1... Home of Football (gathering Ligue 1, Premier League, UCL,
// etc.)" — same merge pattern as Home of Tennis, but the competition list
// is dynamic here (every football competition, not a fixed ATP/WTA pair),
// so it comes from /sports/football itself rather than a hardcoded slug
// list — any newly-ingested league appears with zero code changes here,
// same convention-over-configuration reasoning buildFootballLeagueLeague's
// own comment already documents. Leagues with no real schedule data yet
// (everything except Ligue 1 today) return null from
// buildFootballLeagueLeague and are filtered out here, same as always.
async function buildFootballAllLeagues(year) {
  const sportData = await api.getSport('football').catch(() => null)
  const slugs = (sportData?.categories || []).flatMap(cat => (cat.competitions || []).map(c => c.slug))
  const built = await Promise.all(slugs.map(slug => buildFootballLeagueLeague(slug, year).catch(() => null)))
  return built.filter(Boolean)
}

// F1 calls its winner-column fields driver_*; MotoGP's home-sessions route
// (motogp.js) calls the exact same columns rider_* — the two APIs were
// never unified. Looked up by `key` ('f1'/'motogp') below.
const RACE_DRIVER_FIELD_PREFIX = { f1: 'driver', motogp: 'rider' }

// Normalizes each sport's own raw session_type into the exact same bucket
// names the gp-top-winners API groups by — EVERY session type has
// historical top-3 data, not just Race/Qualifying/Sprint (Mohamed
// 2026-08-21: "u dont show top 3 performances for Italy Practice 1, etc.
// Why? We have historical data"), each scoped to ONLY the currently
// selected session (Mohamed 2026-08-21: "show per race only for session
// race, qual for session qual" — not all sessions stacked together).
// F1's session_type is already the exact bucket name the backend uses
// ("Practice 1", "Sprint Qualifying", ...) — passed through as-is.
// MotoGP's raw codes need the same RAC/SPR/Q/QP/WUP/FP/PR mapping the
// backend's own SQL CASE uses, ported here so both sides agree.
function raceSessionBucket(key, sessionType, sessionNumber) {
  if (key === 'motogp') {
    if (sessionType === 'RAC') return 'Race'
    if (sessionType === 'SPR') return 'Sprint'
    if (sessionType === 'Q' || sessionType === 'QP') return 'Qualifying'
    if (sessionType === 'WUP') return 'Warm Up'
    if (sessionType === 'FP' || sessionType === 'PR') return sessionNumber != null ? `Practice ${sessionNumber}` : 'Practice'
    return sessionType
  }
  return sessionType
}

// F1/MotoGP — every session of a GP weekend (Practice/Qualifying/Sprint/
// Race), not just the single Race row (Mohamed 2026-08-21: "instead of
// '-', display Netherlands and related sessions: Race, Qualifying, etc.
// For past: sessions + driver... Same for MotoGP"). Status is computed
// per GP (using its Race session's date as the representative date, same
// as every other GP-level "next race" indicator sitewide) rather than per
// session — classifying every individual session date against the WHOLE
// season's session list would only ever mark a single global session as
// "next" and demote every sibling session of that same weekend to
// "upcoming" (see classifyByDate's doc comment: "next" picks ONE nearest
// item across everything passed in).
// `family` ('f1'/'motogp') identifies which API shape/session-label table
// applies — separate from `key` (Mohamed 2026-08-23: Home of MotoGP's
// per-category boxes need a unique `key` each — 'motogp-moto2', not a bare
// 'moto2' that could collide — but still need to be treated as the
// 'motogp' family for driver-field-prefix/session-label purposes; defaults
// to `key` itself so the pre-existing 'f1'/'motogp' calls below need no
// change). `category` carries MotoGP's own class ('motogp'/'moto2'/
// 'moto3') through to the Records tab's gp-top-winners fetch, which needs
// it as a query param (not derivable from `family` alone, which is the
// same 'motogp' string for all three classes).
async function buildRaceLeague(key, label, competitionSlug, seasonFn, sessionsFn, family = key, category = null) {
  const seasonData = await seasonFn(HOMEPAGE_YEAR).catch(() => null)
  const seasonId = seasonData?.season_id
  if (!seasonId) return null
  const sessionsRes = await sessionsFn(seasonId).catch(() => null)
  const allSessions = sessionsRes?.sessions || []
  if (!allSessions.length) return null

  const prefix = RACE_DRIVER_FIELD_PREFIX[family]
  const gpMap = new Map()
  allSessions.forEach(s => {
    if (!gpMap.has(s.gp_id)) gpMap.set(s.gp_id, { gp_id: s.gp_id, gp_name: s.gp_name, gp_slug: s.slug, gp_country_iso2: s.gp_country_iso2, gp_country_name: s.gp_country_name, sessions: [] })
    gpMap.get(s.gp_id).sessions.push(s)
  })
  const gps = [...gpMap.values()].map(gp => {
    // display_order (used by the API's own ORDER BY) ranks sessions by
    // DISPLAY IMPORTANCE, Race first — confirmed via direct query
    // (Aragon: Race=1, Warm Up=2, Sprint=3, Qualifying 2=4, Practice 2=8,
    // Practice=9), the opposite of chronological. Re-sorted here by the
    // real session_date timestamp instead, soonest first (Mohamed
    // 2026-08-21: "place the sooner on top! Practice, Practice 2...
    // Race").
    gp.sessions = [...gp.sessions].sort((a, b) => new Date(a.session_date) - new Date(b.session_date))
    // F1 spells this session_type out ('Race'); MotoGP uses the
    // abbreviated 'RAC' — found 2026-08-20 (MotoGP silently returned 0
    // races with only the 'Race' check).
    const raceSession = gp.sessions.find(s => s.session_type === 'Race' || s.session_type === 'RAC')
    gp.repDate = raceSession?.session_date || gp.sessions[0]?.session_date
    return gp
  })
  // Ongoing/next/future only, soonest first — no past GPs (Mohamed
  // 2026-08-21: "now on Homepage, want to see only ONGOING, NEXT and
  // FUTURE"), a reversal of the earlier "past/ongoing/next, most recent
  // first" behaviour.
  const classified = classifyByDate(gps, gp => gp.repDate)
    .filter(c => c.status !== 'past')
    .sort((a, b) => new Date(a.item.repDate) - new Date(b.item.repDate))
    .slice(0, 3)
  if (!classified.length) return null

  const games = classified.flatMap(({ item: gp, status }) =>
    gp.sessions.map(s => {
      const driverName = s[`${prefix}_name`] || null
      const driverSlug = s[`${prefix}_slug`] || `sess-${s.session_id}`
      return {
        id: s.session_id,
        match_date: s.session_date,
        // MotoGP's session_type is a short code (RAC/QP/FP1...) needing
        // the lookup table; F1's is already the human label ("Race").
        _sessionLabel: family === 'motogp' ? motoGpSessionLabel(s.session_type, s.session_number) : s.session_type,
        // Which of the 3 gp-top-winners buckets (Race/Qualifying/Sprint)
        // this exact session belongs to, null for Practice/Warm Up/Sprint
        // Qualifying (Mohamed 2026-08-21: "show per race only for session
        // race, qual for session qual").
        _sessionType: raceSessionBucket(family, s.session_type, s.session_number),
        home_id: driverSlug,
        home_name: driverName,
        home_country_iso2: s[`${prefix}_country_iso2`],
        home_country_name: s[`${prefix}_country_name`],
        away_id: null, away_name: null, away_country_iso2: null, away_country_name: null,
        winner_id: driverName ? driverSlug : null,
        score: null,
        stats: {},
        _status: status,
        // "Grand Prix of X", normal case, for both F1 and MotoGP (Mohamed
        // 2026-08-21: "display GRANDPRIX OF and sessions... with no
        // CAPS") — see raceEventTitle's own comment for why the raw
        // gp_name field isn't used verbatim.
        _eventName: raceEventTitle(gp.gp_name),
        // For the Performances tab's "top 3 winners at this GP" lookup
        // (Mohamed 2026-08-21: "Stats for each session: record of wins,
        // qualifying, sprint").
        _gpSlug: gp.gp_slug,
        // GP host country flag, shown avatar-sized in place of a driver
        // photo the race header doesn't have (Mohamed 2026-08-24: "Country
        // flag (same player image profile size / square roundness)").
        _gpCountryIso2: gp.gp_country_iso2,
        _gpCountryName: gp.gp_country_name,
      }
    })
  )
  if (!games.length) return null
  const compData = await api.getCompetition(competitionSlug).catch(() => null)
  return {
    key, label, matchType: 'race', gender: null,
    competitionSlug, categorySlug: null,
    family, category,
    logoUrl: resolveLogoUrl(compData?.logo_url),
    games,
  }
}

// Home of F1 / Home of MotoGP (Mohamed 2026-08-23) — the race-league
// counterpart to buildTennisCategoryLeagues above: one box per real
// category instead of one box for the whole competition. F1 has no
// sub-category (single box, `categorySlug` stays 'all' so the lone tab
// row entry — 'all' itself — always matches it); MotoGP builds one box
// per class, each hitting buildRaceLeague with that class's own
// seasonFn/sessionsFn (mirrors the 'all'-scope multi-sport homepage's own
// MotoGP box, which only ever built the 'motogp' class).
async function buildRaceCategoryLeagues(scope, year) {
  if (scope === 'f1') {
    const league = await buildRaceLeague('f1', 'F1', 'formula-1-world-championship', api.getF1Season, api.getF1HomeSessions)
    if (league) league.categorySlug = 'all'
    return league ? [league] : []
  }
  if (scope === 'motogp') {
    const cats = [
      { slug: 'motogp', label: 'Moto GP' },
      { slug: 'moto2', label: 'Moto 2' },
      { slug: 'moto3', label: 'Moto 3' },
    ]
    const built = await Promise.all(cats.map(async c => {
      const league = await buildRaceLeague(`motogp-${c.slug}`, c.label, 'motogp',
        (y) => api.getMotoGPSeason(y, c.slug), api.getMotoGPHomeSessions,
        'motogp', c.slug)
      if (league) league.categorySlug = c.slug
      return league
    }))
    return built.filter(Boolean)
  }
  return []
}

// Sport-wide "Home of Racing" (Mohamed 2026-08-26: "No more Home of...
// Home of Racing" — same merge as Tennis/Football, F1 and MotoGP's
// previously separate hub destinations combined into one, ALL/F1/MotoGP/
// Moto2/Moto3 as the tab split within it).
async function buildRacingAllLeagues(year) {
  const [f1, motogp] = await Promise.all([
    buildRaceCategoryLeagues('f1', year),
    buildRaceCategoryLeagues('motogp', year),
  ])
  return [...f1, ...motogp]
}

export default function HomepageTemplate({ scope = 'all' }) {
  const store = useAppStore()
  const { setSport, changeCompetitionWithSport, setTab, setEvent, setMmaSection, setYearRange, changeYear } = store
  // Every sport-wide hub (Home of ATP/WTA, Home of Football, etc.) is a
  // permanent page, frozen to HOMEPAGE_YEAR rather than the real, browsable
  // activeYear a single-competition page uses (Mohamed 2026-08-19: "This
  // will be a permanent page... disable year selector, highlight 2026").
  // buildFootballLeagueLeague/buildFootballAllLeagues each resolve their
  // OWN real current season internally (see that function's own comment)
  // rather than needing this page's year to shift at all — the old
  // per-league-scope path that DID need a shifting pageYear (Home of Ligue
  // 1 standalone) was retired 2026-08-26 in favor of this merged hub.
  const pageYear = HOMEPAGE_YEAR
  const [loading, setLoading] = useState(true)
  const [leagues, setLeagues] = useState([])
  const [sportFilter, setSportFilter] = useState('all')
  const [showOdds, setShowOdds] = useState(true)
  const [expandedKeys, setExpandedKeys] = useState(() => new Set())
  const [selected, setSelected] = useState(null) // { league, game }
  const [detailTab, setDetailTab] = useState('performances')
  const [playerStats, setPlayerStats] = useState({}) // tour -> player-totals rows
  const [ufcCareer, setUfcCareer] = useState({}) // `${entityId}_${throughDate}` -> career totals
  const [raceTopWinners, setRaceTopWinners] = useState({}) // `${key}_${gpSlug}` -> { sessions }
  // `${key}_${sessionId}` -> { results, isPlaceholder } | null — the
  // SELECTED session's own real finishing order (Mohamed 2026-08-23: "on
  // home right bloc: for Racing... display top 3 when results is known"),
  // distinct from raceTopWinners above (that's this GP's HISTORICAL
  // winners across past years, not this specific session's own result).
  const [sessionResults, setSessionResults] = useState({})
  // In case a mounted instance's scope prop ever changes (route change
  // without a remount) — 'all's sport tabs and a tour's category tabs use
  // different values entirely, so a stale filter from the other scope
  // would just match nothing.
  useEffect(() => { setSportFilter('all') }, [scope])
  const [h2h, setH2h] = useState(null)
  const [h2hLoading, setH2hLoading] = useState(false)
  // Football Performances tab — each club's own record (not head-to-head),
  // fetched lazily like h2h above, only once that tab is actually open.
  const [footballPerf, setFootballPerf] = useState(null) // { home, away }
  const [footballPerfLoading, setFootballPerfLoading] = useState(false)
  useEffect(() => {
    if (detailTab !== 'performances' || selected?.league.matchType !== 'football' || !selected.league.competitionId) return
    setFootballPerf(null)
    setFootballPerfLoading(true)
    const { game, league } = selected
    Promise.all([
      api.getEntityHistory(game.home_id, league.competitionId, league.year),
      api.getEntityHistory(game.away_id, league.competitionId, league.year),
    ])
      .then(([home, away]) => setFootballPerf({ home, away }))
      .catch(() => setFootballPerf(null))
      .finally(() => setFootballPerfLoading(false))
  }, [detailTab, selected])

  // Sidebar is rendered by App.jsx itself, driven by activeSport — forcing
  // it to tennis here is what makes "Sidebar: use the tennis one for the
  // moment" happen without touching Sidebar.jsx at all. MainNav.jsx's own
  // Tennis tab is taught to ignore this silent default (only lights up
  // once activeCategory/activeCompetition are really set), so this
  // doesn't fight the "no sport really chosen yet" Homepage state. A tour-
  // scoped page never needs this — activeSport is already 'tennis' by the
  // time you can reach it (it's the ATP/WTA hub's own Home page).
  useEffect(() => { if (scope === 'all') setSport('tennis') }, [scope, setSport])

  // Only the TRUE root "/" homepage (scope='all') still freezes every year
  // but HOMEPAGE_YEAR (Mohamed 2026-08-21/19's original rule) — it has no
  // competition or category of any kind to pull a real range from. Every
  // OTHER scope (nba/f1/motogp/ufc, and since 2026-08-26 also atp/wta's
  // tennis hub) had the freeze REMOVED per Mohamed: "disable the frozen
  // home year rule so that years become clickable" — forcing the user to
  // first click a Line A item just to unfreeze the year strip read as
  // unintuitive. Each of those scopes' own ContentArea
  // (F1ContentArea/MotoGPContentArea/ContentArea.jsx's basketball+MMA+
  // tennis-hub branches) now publishes its own range for Home exactly like
  // every other tab (a real founded_year-based one for nba/f1/motogp/ufc;
  // a generic 1968-current fallback for atp/wta, which have no single
  // competition and no sport-wide year-range endpoint to pull a precise one
  // from) — this effect only needs to force activeYear back to
  // HOMEPAGE_YEAR on scope entry (same reasoning as the comment this
  // replaced: a stale activeYear from wherever the user was before,
  // e.g. Schedule, would land the strip on the wrong year at first paint).
  // 'football' joins 'all' here now — same generic fallback range, no
  // single competition to pull a precise founded_year from (Mohamed
  // 2026-08-26: "Home of Football (gathering Ligue 1, Premier League, UCL,
  // etc.)" — a merged hub, same shape as the multi-sport homepage).
  const NO_COMPETITION_SCOPES = new Set(['all', 'football'])
  // Forces activeYear back to HOMEPAGE_YEAR on scope entry — a stale
  // activeYear from wherever the user was before (e.g. Schedule) would
  // otherwise land the strip on the wrong year at first paint. No more
  // per-league year resolution needed here (that was the old single-league
  // scope path, retired 2026-08-26 — buildFootballLeagueLeague/
  // buildFootballAllLeagues each resolve their own real season internally).
  useEffect(() => {
    changeYear(HOMEPAGE_YEAR)
    if (NO_COMPETITION_SCOPES.has(scope)) {
      setYearRange({ minYear: 1968, maxYear: HOMEPAGE_YEAR, editionYears: [HOMEPAGE_YEAR] })
    }
  }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const buildLeagues = scope === 'racing'
      ? buildRacingAllLeagues(pageYear)
      : scope === 'ufc'
      ? buildUfcCategoryLeagues(pageYear)
      : scope === 'nba'
      ? buildNbaCategoryLeagues(pageYear)
      : scope === 'tennis'
      ? buildTennisAllLeagues(pageYear)
      : scope === 'football'
      ? buildFootballAllLeagues(pageYear)
      : Promise.all([
          buildTennisLeague('atp'),
          buildTennisLeague('wta'),
          buildUfcLeague(),
          buildRaceLeague('f1', 'F1', 'formula-1-world-championship', api.getF1Season, api.getF1HomeSessions),
          buildRaceLeague('motogp', 'MotoGP', 'motogp', (y) => api.getMotoGPSeason(y, 'motogp'), api.getMotoGPHomeSessions),
          // Real Ligue 1 fixtures, not the old logo-only disabled placeholder
          // box (Mohamed 2026-08-26: "homepage must also display Ligue 1
          // games") — buildFootballLeagueLeague already does its own
          // start-year-convention year+1 retry internally, so HOMEPAGE_YEAR
          // resolves to the actual current season same as every other box
          // here.
          buildFootballLeagueLeague('ligue-1-france', HOMEPAGE_YEAR),
          // NBA — was entirely absent from this homepage (Mohamed
          // 2026-08-26: "nope. missing Combat Sport", found alongside it:
          // Basketball had no box here either, nor a sport-filter tab).
          // Returns an array (up to one box per bloc — Regular Season/
          // Playoffs/NBA Cup — whichever currently have real ongoing/next
          // content), not a single league, hence .flat() below instead of
          // every other entry's plain .filter(Boolean).
          buildNbaCategoryLeagues(HOMEPAGE_YEAR),
        ]).then(results => results.flat().filter(Boolean))
    buildLeagues.then(built => {
      if (cancelled) return
      setLeagues(built)
      if (built.length) {
        setExpandedKeys(new Set([built[0].key]))
        setSelected({ league: built[0], game: built[0].games[0] })
      } else {
        setExpandedKeys(new Set())
        setSelected(null)
      }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [scope, pageYear]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real Performances numbers — tennis (player-totals is keyed to ATP/WTA
  // category slugs; F1/MotoGP don't have an equivalent here yet, so their
  // Performances tab just shows "Coming soon").
  useEffect(() => {
    if (!selected || selected.league.matchType !== 'tennis') return
    const tour = selected.league.tour
    if (playerStats[tour]) return
    api.getTennisPlayerTotals(tour, HOMEPAGE_YEAR)
      .then(d => setPlayerStats(prev => ({ ...prev, [tour]: d?.players || [] })))
      .catch(() => setPlayerStats(prev => ({ ...prev, [tour]: [] })))
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real UFC Performances numbers — per-fighter career totals THROUGH this
  // specific fight's own date (Mohamed 2026-08-21: "For UFC: Age Seasons
  // Champion Fights % wins Knockouts Submissions 1st R. Finishes"), same
  // /mma/fighter-career/:entityId route MmaEventTemplate's own EventBlock
  // stat bloc already uses.
  useEffect(() => {
    if (!selected || selected.league.matchType !== 'ufc') return
    const { game } = selected
    const throughDate = game.match_date?.slice(0, 10)
    if (!throughDate) return
    ;[game.home_id, game.away_id].forEach(entityId => {
      if (entityId == null) return
      const cacheKey = `${entityId}_${throughDate}`
      if (ufcCareer[cacheKey] !== undefined) return
      api.getMmaFighterCareer(entityId, throughDate)
        .then(d => setUfcCareer(prev => ({ ...prev, [cacheKey]: d })))
        .catch(() => setUfcCareer(prev => ({ ...prev, [cacheKey]: null })))
    })
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real "top 3 winners at this GP" per session type — F1/MotoGP
  // Performances tab (Mohamed 2026-08-21: "Show the top 3... Stats for
  // each session: record of wins, qualifying, sprint"), via the new
  // gp-top-winners routes.
  useEffect(() => {
    if (!selected || selected.league.matchType !== 'race') return
    const { league, game } = selected
    const gpSlug = game._gpSlug
    if (!gpSlug) return
    const cacheKey = `${league.key}_${gpSlug}`
    if (raceTopWinners[cacheKey] !== undefined) return
    const fetcher = league.family === 'motogp'
      ? api.getMotoGpGpTopWinners(gpSlug, league.category || 'motogp')
      : api.getF1GpTopWinners(gpSlug)
    fetcher
      .then(d => setRaceTopWinners(prev => ({ ...prev, [cacheKey]: d?.sessions || {} })))
      .catch(() => setRaceTopWinners(prev => ({ ...prev, [cacheKey]: null })))
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // The SELECTED session's own real result (Mohamed 2026-08-23: "display
  // top 3 when results is known") — same per-session results route
  // F1SessionResultsTemplate/MotoGPSessionResultsTemplate use, keyed off
  // game.id (== the real session_id, see buildRaceLeague). is_placeholder
  // is that route's own "no real rows yet, fell back to standings" signal
  // (see f1.js/motogp.js) — the box only ever shows once this is false, so
  // a not-yet-run session never displays a fake standings-based top 3.
  useEffect(() => {
    if (!selected || selected.league.matchType !== 'race') return
    const { league, game } = selected
    const cacheKey = `${league.key}_${game.id}`
    if (sessionResults[cacheKey] !== undefined) return
    const fetcher = league.family === 'motogp'
      ? api.getMotoGPSessionResults(game.id)
      : api.getF1SessionResults(game.id)
    fetcher
      .then(d => setSessionResults(prev => ({ ...prev, [cacheKey]: { results: d?.results || [], isPlaceholder: !!d?.is_placeholder } })))
      .catch(() => setSessionResults(prev => ({ ...prev, [cacheKey]: null })))
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real head-to-head record — tennis/UFC only (both real 2-competitor
  // matchups; a race has no "head to head" pairing to compare). Fetched
  // lazily, only once the H2H tab is actually opened.
  useEffect(() => {
    if (detailTab !== 'h2h' || !selected || !selected.game.away_id) return
    setH2h(null)
    setH2hLoading(true)
    api.getHeadToHead(selected.game.home_id, selected.game.away_id)
      .then(setH2h)
      .catch(() => setH2h(null))
      .finally(() => setH2hLoading(false))
  }, [detailTab, selected])

  // A race has no Head-to-Head tab (see detailTabs list below) — if it
  // was open on a tennis/UFC match and the user then picks a race event,
  // land back on Performances instead of a tab that no longer has a
  // button to reach it.
  useEffect(() => {
    if (selected?.league.matchType === 'race' && detailTab === 'h2h') setDetailTab('performances')
  }, [selected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Only one league open at a time (Mohamed 2026-08-21: "Expand/unexpand
  // make bloc overide each other" — several boxes expanded together made
  // the list grow tall enough that opening/closing one shifted every box
  // below it, so a click meant for one header could land on whichever
  // header the shift moved under the cursor). Clicking an already-open
  // league still closes it (empty set), same "click to collapse" as before.
  const toggleExpand = (key) => setExpandedKeys(prev => (prev.has(key) ? new Set() : new Set([key])))

  const visibleLeagues = leagues.filter(l => matchesSportTab(l, sportFilter, scope))

  // Switching sport tab also opens that tab's first box (Mohamed 2026-08-24:
  // "When choosing an item (RACING Ex.), always expand first tab" —
  // previously the filter switched but every box stayed collapsed,
  // matching the screenshot: RACING selected, F1/MotoGP both closed).
  const selectSportFilter = (t) => {
    setSportFilter(t)
    const first = leagues.find(l => matchesSportTab(l, t, scope))
    setExpandedKeys(first ? new Set([first.key]) : new Set())
  }

  // "Full competition" must land on the EXACT page for whatever's
  // selected, not the sport's generic Home (Mohamed 2026-08-21: "clickin
  // on 'full competition' must drive you to the exact page: ex GP Italy
  // Race -> go to F1 / 2026 / Race... no drives u to Home of").
  // Tennis already lands on the exact tournament (its own competitionSlug
  // IS the specific page, e.g. Cincinnati Open, not an ATP hub) —
  // selected WITHOUT setTab, matching LineA's own tournament tab click
  // behavior; calling setTab('home') here instead landed on an unrelated
  // "coming soon" stub (found 2026-08-20).
  // F1/MotoGP: changeCompetitionWithSport alone lands on car-racing's
  // synthetic 'home' tab for a genuinely-different sport switch (see that
  // action's own comment in useAppStore.js) — setTab(`gp-${slug}`)
  // overrides that to the exact Grand Prix page instead.
  // UFC: activeEventKey (which exact card is open) is MmaEventTemplate's
  // own local state, not reachable from outside — but activeMmaSection
  // (UFC Num vs Fight Night) IS global, and that page's own "default card
  // within category" effect picks live > ongoing > next > most-recent,
  // the same priority this Homepage already selects by — so landing in
  // the right section reliably lands on the right card too.
  const goToFullCompetition = () => {
    if (!selected) return
    const { league, game } = selected
    if (league.matchType === 'tennis') {
      changeCompetitionWithSport('tennis', league.competitionSlug, league.categorySlug)
    } else if (league.matchType === 'ufc') {
      changeCompetitionWithSport('mma', league.competitionSlug)
      setMmaSection(game.stats?.event_kind === 'numbered' ? 'ppv' : 'fn')
    } else if (league.matchType === 'nba') {
      changeCompetitionWithSport('basketball', league.competitionSlug)
      setEvent(game._eventSlug)
    } else if (league.matchType === 'football') {
      // Lands on the Schedule tab, not the Home tab it came from — same
      // "Full competition never re-lands on Home" rule every other
      // matchType here follows. changeYear(league.year), not the frozen
      // store activeYear (HOMEPAGE_YEAR/2026 on this scope) — league.year
      // is the real resolved display year (2027) buildFootballLeagueLeague
      // already worked out.
      changeCompetitionWithSport('football', league.competitionSlug)
      setTab('schedule')
      if (league.year) changeYear(league.year)
    } else {
      changeCompetitionWithSport('car-racing', league.competitionSlug)
      if (game._gpSlug) setTab(`gp-${game._gpSlug}`)
    }
  }

  // Mirrors goToFullCompetition's own branches exactly, via pathForCompetition's
  // `extra` param for the mma/race cases' second setter call.
  const fullCompetitionHref = () => {
    if (!selected) return '#'
    const { league, game } = selected
    if (league.matchType === 'tennis') {
      return pathForCompetition(store, 'tennis', league.competitionSlug, league.categorySlug)
    }
    if (league.matchType === 'ufc') {
      return pathForCompetition(store, 'mma', league.competitionSlug, null, {
        activeMmaSection: game.stats?.event_kind === 'numbered' ? 'ppv' : 'fn',
      })
    }
    if (league.matchType === 'nba') {
      return pathForCompetition(store, 'basketball', league.competitionSlug, null, { activeEvent: game._eventSlug })
    }
    if (league.matchType === 'football') {
      return pathForCompetition(store, 'football', league.competitionSlug, null,
        { activeTab: 'schedule', ...(league.year ? { activeYear: league.year } : {}) })
    }
    return pathForCompetition(store, 'car-racing', league.competitionSlug, null,
      game._gpSlug ? { activeTab: `gp-${game._gpSlug}` } : undefined)
  }

  const findPlayer = (tour, entityId) => (playerStats[tour] || []).find(p => p.entity_id === entityId)
  const findUfcCareer = (entityId, matchDate) => ufcCareer[`${entityId}_${matchDate?.slice(0, 10)}`]
  const findRaceTopWinners = (leagueKey, gpSlug) => raceTopWinners[`${leagueKey}_${gpSlug}`]
  const findSessionResults = (leagueKey, sessionId) => sessionResults[`${leagueKey}_${sessionId}`]

  const goToComingHot = (item) => changeCompetitionWithSport(item.sport, item.competitionSlug, item.categorySlug)

  return (
    <div className={styles.pageWrap}>
      {/* Demo ad, static for now (Mohamed 2026-08-21: "place a demo ads
          (ads.jpg)... now static but I plan to make it dynamic later" →
          "banner at right, not left" — positioned via CSS order, not JSX
          order, see .adRail) — same /media/shortcut/ folder as the Coming
          Hot images and the ATP/WTA tour-logo fallback elsewhere in this
          file. */}
      <div className={styles.adRail}>
        <img src="/media/shortcut/ads.jpg" alt="Advertisement" className={styles.adImage} />
      </div>
      <div className={styles.mainCol}>
        {/* Cross-sport promo strip — only makes sense on the multi-sport
            homepage, not a page already scoped to one tour. */}
        {scope === 'all' && <ComingHotCarousel onNavigate={goToComingHot} store={store} />}
        <div className={styles.wrap}>
      <div className={styles.blocA}>
        <div className={styles.blocAHeader}>
          {/* Same scroll-arrow mechanic LineA/LineB already use elsewhere
              (Mohamed 2026-08-26: "add right left arrow to browse sports")
              — this row no longer reliably fits without scrolling now that
              Basketball/Combat Sport both have real tabs too (previously
              individual tab LABELS wrapped mid-word onto a second line
              instead, with no way to reach a tab that got pushed off). */}
          <ScrollableTabs>
            {/* Sport tabs (All/Football/Tennis/Basketball/Racing/Combat
                Sport) on the main homepage; that tour's own categories
                (ALL/GRAND SLAM/MASTERS 1000/500/250/etc) on a tour-scoped
                page (Mohamed 2026-08-25: "instead of showing ALL TENNIS
                UFC, etc., place ALL GRAND SLAM MASTER 1000 500 250 etc" —
                same tab-row mechanic, just fed a different tab list per
                scope). */}
            {tabsForScope(scope, leagues).map(t => (
              <button
                key={t}
                type="button"
                className={`${styles.sportTab}${sportFilter === t ? ' ' + styles.sportTabActive : ''}`}
                onClick={() => selectSportFilter(t)}
              >
                {/* Dot after the label when this tab actually has an
                    ongoing/next/future event to show (Mohamed 2026-08-24:
                    "Add a dot after item (which means events are either
                    ONGOING, NEXT OR FUTURE)") — same shared
                    .ongoing-dot-anchor/.ongoing-dot convention Sidebar.jsx
                    already uses for its own category/competition rows. */}
                <span className="ongoing-dot-anchor">
                  {tabLabelForScope(scope, t, leagues)}
                  {leagues.some(l => matchesSportTab(l, t, scope)) && <span className="ongoing-dot" />}
                </span>
              </button>
            ))}
          </ScrollableTabs>
          <label className={styles.oddsToggle}>
            odds
            <span className={`${styles.toggleTrack}${showOdds ? ' ' + styles.toggleTrackOn : ''}`} onClick={() => setShowOdds(v => !v)}>
              <span className={styles.toggleThumb} />
            </span>
          </label>
        </div>

        <div className={styles.leagueList}>
          {loading && <div className={styles.loadingBox}>{[...Array(3)].map((_, i) => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 8, borderRadius: 4 }} />)}</div>}

          {!loading && !visibleLeagues.length && (
            <div className={styles.emptyLeagues}>No ongoing events for this filter yet.</div>
          )}

          {visibleLeagues.map(league => {
            const isExpanded = expandedKeys.has(league.key)
            return (
              <div key={league.key} className={styles.leagueBox}>
                <button type="button" className={styles.leagueHeader} onClick={() => toggleExpand(league.key)}>
                  <span className={styles.leagueHeaderLeft}>
                    {league.logoUrl && (
                      <img
                        src={league.logoUrl}
                        alt=""
                        className={styles.leagueLogo}
                        onError={e => { e.target.style.display = 'none' }}
                      />
                    )}
                    {league.label}
                  </span>
                  {/* Expanded -> points up ("click to close"), collapsed ->
                      points down ("click to open") — was inverted before
                      (Mohamed 2026-08-20: "when window expanded: arrow
                      shall point top, when unexpande: point bottom"). */}
                  <ChevronIcon open={isExpanded} />
                </button>
                {isExpanded && (
                  <div className={styles.leagueBody}>
                    {(() => {
                      // Event name shown ONCE as a bold group title above
                      // the rows that belong to it, not repeated on every
                      // row (Mohamed 2026-08-20: "Remove Cincinnati under
                      // date, Cincinnati is the title = BOLD" — all 6
                      // Cincinnati rows previously repeated the tournament
                      // name individually). Still correct for UFC/F1/
                      // MotoGP, where consecutive rows can belong to
                      // DIFFERENT events — each gets its own title exactly
                      // when the event actually changes.
                      let lastEventName = null
                      return league.games.map(g => {
                        const isNewGroup = g._eventName !== lastEventName
                        lastEventName = g._eventName
                        const isSelected = selected?.game.id === g.id
                        const isMatchup = league.matchType !== 'race'
                        return (
                          <Fragment key={g.id}>
                            {isNewGroup && g._eventName && (
                              <div className={styles.eventGroupTitle}>{g._eventName}</div>
                            )}
                            <button
                              type="button"
                              className={`${styles.gameRow}${isSelected ? ' ' + styles.gameRowActive : ''}`}
                              onClick={() => setSelected({ league, game: g })}
                            >
                              <div className={styles.gameDate}>
                                {/* Dot before the date now, not after (Mohamed
                                    2026-08-24: "in event listing, place dot at
                                    the very left, before date"). */}
                                <span className={styles.gameDateLine}>
                                  <span className={`${styles.statusDot} ${statusDotClass(g._status)}`} />
                                  <span>{fmtDate(g.match_date)}</span>
                                </span>
                                {relativeStatusLabel(g) && (
                                  <span className={styles.gameDateRelative}>{relativeStatusLabel(g)}</span>
                                )}
                              </div>
                              <div className={styles.gamePlayers}>
                                <span className={`${styles.gamePlayer}${g.winner_id != null && g.winner_id === g.home_id ? ' ' + styles.gamePlayerWinner : ''}`}>
                                  <span className={styles.gamePlayerName}>
                                    {/* Race sessions: label (Race/Qualifying/Practice…) always
                                        shown; driver only once the session has actually been run
                                        — a not-yet-run session of the next GP shows just its
                                        label, not a fake "—" placeholder (Mohamed 2026-08-21:
                                        "instead of '-', display Netherlands and related
                                        sessions: Race, Qualifying, etc."). */}
                                    {!isMatchup && g._sessionLabel && <span className={styles.sessionLabel}>{g._sessionLabel}</span>}
                                    {(isMatchup || g.home_name) && (
                                      <>
                                        {/* Club/team crest, before the name — football and NBA
                                            rows both already carry _homeLogo/_awayLogo (built
                                            alongside the row itself, see buildFootballLeagueLeague/
                                            buildNbaCategoryLeagues above); tennis/race rows leave
                                            it unset so nothing renders there instead (Mohamed
                                            2026-08-26: "add logos before clubs names (square
                                            rounded)"). Same small rounded-square treatment as the
                                            sidebar's own .leagueLogo, not a circle — a crest isn't
                                            a portrait. */}
                                        {g._homeLogo && <img src={g._homeLogo} alt="" className={styles.gamePlayerLogo} />}
                                        {g.home_country_iso2 && <Flag iso2={g.home_country_iso2} name={g.home_country_name} className="flag" />}
                                        {g.home_name || '—'}
                                      </>
                                    )}
                                    {rankFor(g, 'home') != null && <span className={styles.rankBadge}>#{rankFor(g, 'home')}</span>}
                                  </span>
                                  {isMatchup && <span className={styles.setScores}>{setScoresFor(g, 'home').join('  ')}</span>}
                                  {/* Own row, not a single block spanning both players (Mohamed
                                      2026-08-24: "thin offset between score and odds") — a
                                      shared block only as tall as one line of text sat at the
                                      row's top instead of stretching to match the 2-line
                                      .gamePlayers column, so its border and "1"/"2" values
                                      never lined up with the home/away rows they belong to. */}
                                  {showOdds && isMatchup && (
                                    <span className={styles.oddsCol}><span className={styles.oddsNum}>1</span><span>{demoOdds(g.id, 0)}</span></span>
                                  )}
                                </span>
                                {isMatchup && (
                                  <span className={`${styles.gamePlayer}${g.winner_id != null && g.winner_id === g.away_id ? ' ' + styles.gamePlayerWinner : ''}`}>
                                    <span className={styles.gamePlayerName}>
                                      {g._awayLogo && <img src={g._awayLogo} alt="" className={styles.gamePlayerLogo} />}
                                      {g.away_country_iso2 && <Flag iso2={g.away_country_iso2} name={g.away_country_name} className="flag" />}
                                      {g.away_name || '—'}
                                      {rankFor(g, 'away') != null && <span className={styles.rankBadge}>#{rankFor(g, 'away')}</span>}
                                    </span>
                                    <span className={styles.setScores}>{setScoresFor(g, 'away').join('  ')}</span>
                                    {showOdds && (
                                      <span className={styles.oddsCol}><span className={styles.oddsNum}>2</span><span>{demoOdds(g.id, 1)}</span></span>
                                    )}
                                  </span>
                                )}
                              </div>
                            </button>
                          </Fragment>
                        )
                      })
                    })()}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className={styles.blocBCol}>
      <div className={styles.blocB}>
        {!selected ? (
          <div className={styles.emptyLeagues}>Pick a game from the left to see details.</div>
        ) : (
          <>
            <div className={styles.blocBHeader}>
              {/* Event name as plain purple text, no pill background
                  (Mohamed 2026-08-20: "remove ATP pill and make CINCINNATI
                  pink pill" → tried var(--pink) pill, rejected: "bad idea,
                  remove the pink pill, keep title PURPLE" → tried
                  var(--purple) pill, then: "no pill, revert to text only"). */}
              <span className={styles.tourPill}>{selected.game._eventName}</span>
              <Link to={fullCompetitionHref()} className={styles.fullCompBtnTop} onClick={e => !isModifiedClick(e) && goToFullCompetition()}>
                Full competition
              </Link>
            </div>
            <MatchupCard
              league={selected.league}
              game={selected.game}
              home={
                selected.league.matchType === 'tennis' ? findPlayer(selected.league.tour, selected.game.home_id)
                : selected.league.matchType === 'ufc' ? findUfcCareer(selected.game.home_id, selected.game.match_date)
                : null
              }
              away={
                selected.league.matchType === 'tennis' ? findPlayer(selected.league.tour, selected.game.away_id)
                : selected.league.matchType === 'ufc' ? findUfcCareer(selected.game.away_id, selected.game.match_date)
                : null
              }
            />

            {selected.league.matchType === 'race' && (
              <RaceTop3Box league={selected.league} sessionResult={findSessionResults(selected.league.key, selected.game.id)} />
            )}

            <div className={styles.detailTabs}>
              {/* No Head-to-Head for a race — it's a multi-driver field,
                  not a fixed 2-competitor pairing (Mohamed 2026-08-21:
                  "For MotoGP and F1... Remove Head-to-head"). */}
              {/* "Records" not "Performances" for a race — there's no
                  fixed 2-competitor pairing to compare, just this GP's
                  historical top winners (Mohamed 2026-08-24: "replace
                  performances by Records"). */}
              {(selected.league.matchType === 'race'
                ? [['performances', 'Records'], ['odds', 'Odds']]
                : [['performances', 'Performances'], ['h2h', 'Head-to-Head'], ['odds', 'Odds']]
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`${styles.detailTab}${detailTab === key ? ' ' + styles.detailTabActive : ''}`}
                  onClick={() => setDetailTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {detailTab === 'performances' && (
              selected.league.matchType === 'tennis' ? (
                <PerformancesTable
                  league={selected.league}
                  game={selected.game}
                  home={findPlayer(selected.league.tour, selected.game.home_id)}
                  away={findPlayer(selected.league.tour, selected.game.away_id)}
                />
              ) : selected.league.matchType === 'ufc' ? (
                <PerformancesTable
                  league={selected.league}
                  game={selected.game}
                  home={findUfcCareer(selected.game.home_id, selected.game.match_date)}
                  away={findUfcCareer(selected.game.away_id, selected.game.match_date)}
                />
              ) : selected.league.matchType === 'race' ? (
                <RaceTopWinnersTable
                  sessions={findRaceTopWinners(selected.league.key, selected.game._gpSlug)}
                  sessionType={selected.game._sessionType}
                />
              ) : selected.league.matchType === 'football' ? (
                <FootballPerformancesTable perf={footballPerf} loading={footballPerfLoading} />
              ) : (
                <div className={styles.emptyLeagues}>Coming soon.</div>
              )
            )}
            {detailTab === 'h2h' && (
              selected.game.away_id ? (
                <HeadToHeadTable league={selected.league} h2h={h2h} loading={h2hLoading} />
              ) : (
                <div className={styles.emptyLeagues}>Coming soon.</div>
              )
            )}
            {detailTab === 'odds' && (
              selected.game.away_id ? (
                <OddsTable game={selected.game} />
              ) : (
                <div className={styles.emptyLeagues}>Coming soon.</div>
              )
            )}
          </>
        )}
      </div>

      {selected && <VoteBox league={selected.league} game={selected.game} />}
      </div>
        </div>
      </div>
    </div>
  )
}

// Age, same calcAge(birth_date, match_date) call PerformancesTable already
// uses for this exact person — kept in sync rather than re-derived a
// different way here.
function ageFor(person, matchDate) {
  return person ? calcAge(person.birth_date, matchDate) ?? null : null
}

// Drops the given/first name, keeps everything after it — "Alex De Minaur"
// -> "De Minaur" (Mohamed 2026-08-24: "remove firstname, name only" — a
// repeat of the same ask after the first pass only removed the rank badge
// from the name line but left the full name itself).
function surnameOnly(name) {
  if (!name) return name
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0]
}

// One player's avatar + name + age/rank + flag — reuses the SAME classes
// (.avatar, .club-name, .stat-stack-value-light, .event-rank, .entity-meta-
// row, .cell-meta) the Rankings/standings tables already use, instead of
// this card's own bespoke sizing/typography (Mohamed 2026-08-24: "Reduce
// profile image size (same as we use in rankings, games, etc.)" — the
// custom 56px .matchupAvatar read larger than every other avatar
// sitewide; "Use rankings CSS for both" for the age/rank line).
function MatchupSide({ league, game, side, person }) {
  const name = side === 'home' ? game.home_name : game.away_name
  const countryIso2 = side === 'home' ? game.home_country_iso2 : game.away_country_iso2
  const countryName = side === 'home' ? game.home_country_name : game.away_country_name
  const rank = rankFor(game, side)
  const age = league.matchType === 'race' ? null : ageFor(person, game.match_date)
  const portrait = league.matchType === 'tennis'
    ? portraitPath(side === 'home' ? game.home_slug : game.away_slug, league.gender)
    : (league.matchType === 'nba' || league.matchType === 'football')
      ? (side === 'home' ? game._homeLogo : game._awayLogo)
      : null
  return (
    <div className={styles.matchupSide}>
      {/* No avatar for a race session — a driver name alone, no photo
          (Mohamed 2026-08-21: "For MotoGP and F1: Remove profile image").
          key={game.id} forces a fresh AthleteAvatar instance per match
          (Mohamed 2026-08-21: "sakkari and swiatek profile images exist in
          folder but not displayed") — without it, React reuses the SAME
          component instance across selections, so its internal `failed`
          state (set once by an earlier match's player who genuinely has no
          photo on disk) stuck permanently true and hid every later match's
          real photo too, even players who do have one. */}
      {league.matchType !== 'race' && (
        <AthleteAvatar
          key={`${side}-${game.id}`}
          src={portrait}
          name={name || '?'}
          sport={league.matchType}
          gender={league.gender}
          fallback="letter"
          className="avatar"
        />
      )}
      {/* Surname only for a PERSON (Mohamed 2026-08-24: "remove firstname,
          name only") — a club isn't a person, so football/NBA keep the
          full club name instead of truncating to its last word (Mohamed
          2026-08-26: "Club name: display full club name. Only players
          mode displays lastname"). */}
      <div className={styles.matchupName}><span className="club-name">{(league.matchType === 'football' || league.matchType === 'nba' ? name : surnameOnly(name)) || '—'}</span></div>
      {(age != null || rank != null) && (
        <div className={styles.matchupAgeRank}>
          {/* Same class on both numbers (Mohamed 2026-08-24: "age and
              rankings same CSS" — the first pass used two different
              classes, .stat-stack-value-light for age and .event-rank for
              rank, which rendered visibly inconsistent). */}
          {age != null && <span className="event-rank">{age} y</span>}
          {age != null && rank != null && ' I '}
          {rank != null && <span className="event-rank">#{rank}</span>}
        </div>
      )}
      {countryIso2 && (
        <div className="entity-meta-row">
          <Flag iso2={countryIso2} name={countryName} className="flag" />
          <span className="cell-meta">{countryName}</span>
        </div>
      )}
    </div>
  )
}

// F1/MotoGP have no fixed 2-competitor pairing to lay out as two sides —
// a single centered block instead: the GP's host-country flag (styled
// avatar-size/roundness, standing in for the driver photo a not-yet-run
// session doesn't have) + date + countdown + session name (Mohamed
// 2026-08-24: "Country flag (same player image profile size / square
// roundness) + date + in 2 days + name of the session" — reusing
// MatchupSide/matchupCenter for a single-sided race session had crammed
// the date/session/countdown into one cramped block that visually
// overlapped).
function RaceHeader({ game }) {
  return (
    <div className={styles.raceHeaderCard}>
      {game._gpCountryIso2 && (
        <Flag iso2={game._gpCountryIso2} name={game._gpCountryName} className={styles.raceHeaderFlag} />
      )}
      <div className={styles.raceHeaderDate}>{fmtDate(game.match_date)}</div>
      {relativeStatusLabel(game) && (
        <div className={styles.matchupRelative}>{relativeStatusLabel(game)}</div>
      )}
      {game._sessionLabel && <div className={styles.raceHeaderSession}>{game._sessionLabel}</div>}
    </div>
  )
}

// The selected session's own real top 3 finishers (Mohamed 2026-08-23: "on
// home right bloc: for Racing (moto and f1): display top 3 when results is
// known: 1. Profile image + name + flag beneath and column time") — only
// once real results exist (sessionResult.isPlaceholder false — see the
// fetch effect's own comment), so a not-yet-run session shows nothing here
// rather than a fake standings-based entry list. Distinct from the
// Records tab below it, which shows this GP's HISTORICAL winners across
// past years, not this specific session's own result. `family` picks
// F1's driver_*/MotoGP's rider_* field prefix, same lookup buildRaceLeague
// itself already uses.
function RaceTop3Box({ league, sessionResult }) {
  if (!sessionResult || sessionResult.isPlaceholder) return null
  const prefix = RACE_DRIVER_FIELD_PREFIX[league.family]
  const top3 = (sessionResult.results || []).slice(0, 3)
  if (!top3.length) return null
  return (
    <div className={styles.raceTop3Box}>
      {top3.map((r, i) => {
        const id = r[`${prefix}_id`] ?? i
        const name = r[`${prefix}_name`]
        const iso2 = r[`${prefix}_country_iso2`]
        const countryName = r[`${prefix}_country_name`]
        const time = r.time_result || r.best_lap_time || r.gap_to_first || '—'
        return (
          <div key={id} className={styles.raceTop3Row}>
            <span className={styles.raceTop3Rank}>{i + 1}.</span>
            <AthleteAvatar
              key={`top3-${id}`}
              src={resolveLogoUrl(r[`${prefix}_image`])}
              name={name || '?'}
              sport={league.family === 'motogp' ? 'motorcycle' : 'f1'}
              gender="M"
              fallback="letter"
              className={styles.raceHeaderFlag}
            />
            <div className={styles.raceTop3NameCol}>
              <span className={styles.raceTop3Name}>{name || '—'}</span>
              {iso2 && (
                <div className="entity-meta-row">
                  <Flag iso2={iso2} name={countryName} className="flag" />
                  <span className="cell-meta">{countryName}</span>
                </div>
              )}
            </div>
            <span className={styles.raceTop3Time}>{time}</span>
          </div>
        )
      })}
    </div>
  )
}

function MatchupCard({ league, game, home, away }) {
  if (league.matchType === 'race') return <RaceHeader game={game} />
  const hasAway = game.away_name != null
  const hasSets = game.winner_id != null && game.score?.sets?.length > 0
  const homeWon = game.winner_id != null && game.winner_id === game.home_id
  return (
    <div className={styles.matchupCard}>
      <MatchupSide league={league} game={game} side="home" person={home} />
      <div className={styles.matchupCenter}>
        {hasSets ? (
          // score.sets is keyed by MATCH winner/loser (s.w/s.l always the
          // match winner's own game count for that set, even a set they
          // lost — confirmed via real data: Swiatek beat Sakkari 4-6 6-1
          // 6-1, s.w is [4,6,6], Swiatek's own numbers throughout), not
          // home/away — remapped to left/right by homeWon so the numbers
          // land under the correct avatar regardless of which side won
          // the match (Mohamed 2026-08-21: "fix win and looser score").
          // Bold is decided PER SET by which number is actually higher —
          // i.e. who won THAT set — not by who won the overall match
          // (Mohamed 2026-08-21: "Sakkari won 1st set 6-4 so we should see
          // 4 NORMAL and 6 STRONG" — the match winner's own number isn't
          // always the bold one on a set they lost).
          game.score.sets.map((s, i) => {
            const leftVal = homeWon ? s.w : s.l
            const rightVal = homeWon ? s.l : s.w
            const leftWonSet = leftVal > rightVal
            return (
              <div key={i} className={styles.matchupSetLine}>
                {leftWonSet ? <strong>{leftVal}</strong> : leftVal} - {leftWonSet ? rightVal : <strong>{rightVal}</strong>}
              </div>
            )
          })
        ) : (
          // Just date + countdown, no text status badge underneath
          // (Mohamed 2026-08-21: "Remove NEXT underneath in 14 days" — the
          // colored dot on the row it was selected from already conveys
          // the same status).
          <>
            <div>{fmtDate(game.match_date)}</div>
            {relativeStatusLabel(game) && (
              <div className={styles.matchupRelative}>{relativeStatusLabel(game)}</div>
            )}
          </>
        )}
      </div>
      {hasAway && <MatchupSide league={league} game={game} side="away" person={away} />}
    </div>
  )
}

// F1/MotoGP's Performances tab — no fixed 2-competitor pairing to compare
// like tennis/UFC, so instead: top 3 winners at THIS specific Grand Prix,
// scoped to whichever ONE session is currently selected — a Race row
// shows Race's own top 3, a Qualifying row shows Qualifying's, not all
// three buckets stacked together (Mohamed 2026-08-21: "Flag + profile +
// Lando Norris - 3 wins (2020, 2022, 2023)... Show the top 3... Stats for
// each session: record of wins, qualifying, sprint" → "show per race only
// for session race, qual for session qual"). No avatar per row,
// consistent with the same message's "Remove profile image", since no
// real driver photos are wired for F1/MotoGP here.
function RaceTopWinnersTable({ sessions, sessionType }) {
  if (sessions === undefined) return <div className={styles.emptyLeagues}>Loading…</div>
  if (!sessions || !sessionType || !sessions[sessionType]?.length) {
    return <div className={styles.emptyLeagues}>No history yet.</div>
  }
  // No session-type title above the list (Mohamed 2026-08-24: "remove
  // tittle" — the session is already named in the header above this tab
  // now, via the new race header's session-name line) — just the rows
  // directly. Years only, no win-count/parens (Mohamed 2026-08-24: "remove
  // 4 wins, remove (), just 2022, 2024, etc").
  return (
    <div className={styles.raceWinners}>
      <div className={styles.raceWinnersSession}>
        {sessions[sessionType].map((w, i) => (
          <div key={w.driver_slug} className={styles.raceWinnerRow}>
            <span className={styles.raceWinnerRank}>{i + 1}</span>
            {w.country_iso2 && <Flag iso2={w.country_iso2} name={w.country_name} className="flag" />}
            {/* Win count right after the name (Mohamed 2026-08-24: "add
                count after driver. Marc Marquez (8)"). */}
            <span className={styles.raceWinnerName}>{w.driver_name} <span className={styles.raceWinnerWinCount}>({w.win_count})</span></span>
            <span className={styles.raceWinnerCount}>{w.years.join(', ')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Bloc B's own "Odds" tab body (Mohamed 2026-08-19: "Bloc B, display fake
// odds") — same deterministic demoOdds() the main list's Odds toggle
// column already uses, laid out via .perfTable like PerformancesTable
// above rather than a bespoke layout.
function OddsTable({ game }) {
  return (
    <table className={styles.perfTable}>
      <tbody>
        <tr>
          <td className={styles.perfValue}>{demoOdds(game.id, 0)}</td>
          <td className={styles.perfLabel}>Match Winner</td>
          <td className={styles.perfValue}>{demoOdds(game.id, 1)}</td>
        </tr>
      </tbody>
    </table>
  )
}

// Draws count for both sides (a draw isn't "won" by either), so the D row
// repeats the same value left/right — mirrors how the W/L rows are each
// other's mirror image (A's losses ARE B's wins in a pure 2-side meeting
// history, no independent "L" data exists) while still reading as a
// familiar W/D/L record per side.
function footballWdlRows(rec) {
  return [
    { label: 'W', left: rec.wins_a, right: rec.wins_b },
    { label: 'D', left: rec.draws, right: rec.draws },
    { label: 'L', left: rec.wins_b, right: rec.wins_a },
  ]
}
function WdlTable({ rows }) {
  return (
    <table className={styles.perfTable}>
      <tbody>
        {rows.map(row => (
          <tr key={row.label}>
            <td className={styles.perfValue}><span className={row.left > row.right ? styles.perfValueBest : undefined}>{row.left}</span></td>
            <td className={styles.perfLabel}>{row.label}</td>
            <td className={styles.perfValue}><span className={row.right > row.left ? styles.perfValueBest : undefined}>{row.right}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Football Performances tab — each club's OWN career record in this
// competition (not a head-to-head split), through the browsed season
// (Mohamed 2026-08-26: "Add performances: see screencapt" — Seasons/
// Champions/2nd/3rd/% wins, only the Seasons row in strong/bold; "highlight
// STRONG best performances" — same per-value .perfValueBest highlight the
// H2H WdlTable already uses for whichever side leads a given row). Backed
// by /seasons/entity-history's football branch, extended the same day with
// second_place/third_place/win_pct. Seasons is excluded from the best-
// value highlight — it's a longevity count, not a "performance" either
// side can be said to have won, and it already gets its own whole-row
// emphasis (.perfRowStrong).
function FootballPerformancesTable({ perf, loading }) {
  if (loading) return <div className={styles.emptyLeagues}>Loading…</div>
  if (!perf) return <div className={styles.emptyLeagues}>No performance data on record.</div>
  const { home, away } = perf
  const rows = [
    { key: 'seasons', label: 'Seasons', left: home?.participations ?? 0, right: away?.participations ?? 0, strong: true, noBest: true },
    { key: 'champions', label: 'Champions', left: home?.titles ?? 0, right: away?.titles ?? 0 },
    { key: '2nd', label: '2nd', left: home?.second_place ?? 0, right: away?.second_place ?? 0 },
    { key: '3rd', label: '3rd', left: home?.third_place ?? 0, right: away?.third_place ?? 0 },
    { key: 'win_pct', label: '% wins', left: home?.win_pct ?? 0, right: away?.win_pct ?? 0, fmt: v => `${v}%` },
  ]
  return (
    <table className={styles.perfTable}>
      <tbody>
        {rows.map(row => (
          <tr key={row.key} className={row.strong ? styles.perfRowStrong : undefined}>
            <td className={styles.perfValue}>
              <span className={!row.noBest && row.left > row.right ? styles.perfValueBest : undefined}>
                {row.fmt ? row.fmt(row.left) : row.left}
              </span>
            </td>
            <td className={styles.perfLabel}>{row.label}</td>
            <td className={styles.perfValue}>
              <span className={!row.noBest && row.right > row.left ? styles.perfValueBest : undefined}>
                {row.fmt ? row.fmt(row.right) : row.right}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// Football-specific: season-based, not calendar-based (Mohamed 2026-08-26:
// "1 year ago: replace by 5 seasons ago or this season if victory happens
// in current season") — h2h.last_victory_a/b.seasons_ago is computed
// server-side (competitions.js /h2h), already accounting for each
// competition's own year_convention.
function seasonsAgoLabel(seasonsAgo) {
  if (seasonsAgo == null) return null
  if (seasonsAgo <= 0) return 'This season'
  return seasonsAgo === 1 ? '1 season ago' : `${seasonsAgo} seasons ago`
}

function HeadToHeadTable({ league, h2h, loading }) {
  if (loading) return <div className={styles.emptyLeagues}>Loading…</div>
  if (!h2h || !h2h.meetings) return <div className={styles.emptyLeagues}>No prior meetings on record.</div>

  // Football: draws are real data (unlike tennis/UFC, where every meeting
  // has a winner) — All/surface/category breakdown doesn't apply, so this
  // gets its own layout instead of reusing the tennis rows below (Mohamed
  // 2026-08-26, football H2H mockup: last victory per side + all-time and
  // last-10 W/D/L splits).
  if (league.matchType === 'football') {
    return (
      <div>
        <div className={styles.h2hLastVictoryLabel}>Last victory</div>
        {/* "Switch date and ago position: make all small font, only [the
            'X seasons ago'] is STRONG" (Mohamed 2026-08-26) — was date
            (bold) then relative label (small); now relative label (bold,
            on top) then date (small, underneath). */}
        <div className={styles.h2hLastVictoryRow}>
          {[h2h.last_victory_a, h2h.last_victory_b].map((v, i) => (
            <div key={i} className={styles.h2hLastVictorySide}>
              <div className={styles.h2hLastVictoryAgo}>{v ? seasonsAgoLabel(v.seasons_ago) : 'No win yet'}</div>
              {v && <div className={styles.h2hLastVictoryDate}>{fmtDate(v.match_date)}</div>}
            </div>
          ))}
        </div>
        <div className={styles.h2hMeetings}><strong>{h2h.meetings} game{h2h.meetings === 1 ? '' : 's'}</strong></div>
        <WdlTable rows={footballWdlRows(h2h)} />
        {h2h.last10.meetings > 0 && (
          <>
            <div className={styles.h2hMeetings}><strong>Last {h2h.last10.meetings} game{h2h.last10.meetings === 1 ? '' : 's'}</strong></div>
            <WdlTable rows={footballWdlRows(h2h.last10)} />
          </>
        )}
      </div>
    )
  }

  // getHeadToHead is always called as (home_id, away_id) — see the fetch
  // effect above — so wins_a/wins_b already ARE home/away directly.
  const finalsLabel = league.tour === 'wta' ? 'WTA Final' : 'ATP Final'
  // "replace win by: All (bold) shall count all wins - then specific"
  // (surface, then category) — each specific row only shown "if value is
  // not 0". UFC pairings have no surface/category data, so they'll just
  // show the All row.
  const rows = [
    { label: 'All', left: h2h.wins_a, right: h2h.wins_b, isAll: true },
    ...['Clay', 'Grass', 'Hard']
      .filter(surf => h2h.by_surface[surf])
      .map(surf => ({ label: surf, left: h2h.by_surface[surf].a, right: h2h.by_surface[surf].b })),
    ...['Grand Slam', finalsLabel, 'Master 1000', 'Master 500', 'Master 250']
      .filter(cat => h2h.by_category[cat])
      .map(cat => ({ label: cat, left: h2h.by_category[cat].a, right: h2h.by_category[cat].b })),
  ]

  // "game"/"games" for tennis, "fight"/"fights" for UFC (Mohamed
  // 2026-08-21: "Head to head '1 fight' or '2 fights'") — the number
  // Whole "1 game"/"2 fights" line bold (Mohamed 2026-08-21: "make all
  // BOLD '1 game'" — reverses the earlier number-only-bold split).
  const unit = league.matchType === 'ufc' ? 'fight' : 'game'
  return (
    <div>
      <div className={styles.h2hMeetings}><strong>{h2h.meetings} {unit}{h2h.meetings === 1 ? '' : 's'}</strong></div>
      <table className={styles.perfTable}>
        <tbody>
          {rows.map(row => (
            <tr key={row.label} className={row.isAll ? styles.perfRowAll : undefined}>
              <td className={styles.perfValue}><span className={row.left > row.right ? styles.perfValueBest : undefined}>{row.left}</span></td>
              <td className={styles.perfLabel}>{row.label}</td>
              <td className={styles.perfValue}><span className={row.right > row.left ? styles.perfValueBest : undefined}>{row.right}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// UFC's fighter-career route gives raw wins/losses/draws — fights and
// win% are derived here rather than stored, same as F1/MotoGP's
// derived-not-stored fields elsewhere in this file.
function ufcStatValue(person, key, matchDate) {
  if (!person) return '—'
  if (key === 'age') return calcAge(person.birth_date, matchDate) ?? '—'
  const fights = (person.wins ?? 0) + (person.losses ?? 0) + (person.draws ?? 0)
  if (key === 'fights') return fights
  if (key === 'win_pct') return fights ? Math.round((person.wins / fights) * 100) : 0
  return person[key] ?? '—'
}

// "Who's your pick?" — a non-betting engagement feature, its own box
// underneath Bloc B (Mohamed 2026-08-19: "in the box 2, i want to
// implement a new feature 'VOTE' where users are invited to pick a
// winner... Votes are a non betting feat within Rankks" — kept fully
// separate from the demo/fake odds toggle above). One vote per user per
// game, enforced server-side by game_votes' own UNIQUE(user_id, game_id).
function VoteBox({ league, game }) {
  const token = useUserStore(s => s.token)
  const openAuthModal = useUserStore(s => s.openAuthModal)
  const [tally, setTally] = useState(null) // { total, counts, my_pick }
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let cancelled = false
    setTally(null)
    api.getGameVotes(game.id, token)
      .then(d => { if (!cancelled) setTally(d) })
      .catch(() => { if (!cancelled) setTally({ total: 0, counts: {}, my_pick: null } )})
    return () => { cancelled = true }
  }, [game.id, token])

  // No fixed 2-way pairing (a race session, a bye) — nothing to vote on.
  if (!game.away_id) return null

  const handlePick = async (entityId) => {
    if (pending || tally?.my_pick != null) return
    if (!token) { openAuthModal(); return }
    setPending(true)
    try {
      const result = await api.castVote(token, game.id, entityId)
      setTally(result)
    } catch (err) {
      // ALREADY_VOTED — another request from this same user (double-click,
      // a second tab) already recorded a pick. Resync instead of leaving
      // the box looking like the vote silently failed.
      if (err.code === 'ALREADY_VOTED') {
        const fresh = await api.getGameVotes(game.id, token).catch(() => null)
        if (fresh) setTally(fresh)
      }
    } finally {
      setPending(false)
    }
  }

  const total = tally?.total ?? 0
  const homeVotes = tally?.counts?.[game.home_id] || 0
  const awayVotes = tally?.counts?.[game.away_id] || 0
  const homePct = total ? Math.round((homeVotes / total) * 100) : 0
  const awayPct = total ? Math.round((awayVotes / total) * 100) : 0
  const voted = tally?.my_pick != null

  return (
    <div className={styles.voteBox}>
      <div className={styles.voteBoxTitle}>Who's your pick?</div>
      <div className={styles.voteBoxTotal}>Total votes: {tally ? total : '—'}</div>
      <div className={styles.voteBoxRow}>
        <VoteOption
          name={league.matchType === 'football' || league.matchType === 'nba' ? game.home_name : surnameOnly(game.home_name)}
          portrait={league.matchType === 'tennis' ? portraitPath(game.home_slug, league.gender) : (league.matchType === 'nba' || league.matchType === 'football') ? game._homeLogo : null}
          sport={league.matchType}
          gender={league.gender}
          picked={tally?.my_pick === game.home_id}
          pct={homePct}
          voted={voted}
          disabled={pending || voted}
          onClick={() => handlePick(game.home_id)}
        />
        <VoteOption
          name={league.matchType === 'football' || league.matchType === 'nba' ? game.away_name : surnameOnly(game.away_name)}
          portrait={league.matchType === 'tennis' ? portraitPath(game.away_slug, league.gender) : (league.matchType === 'nba' || league.matchType === 'football') ? game._awayLogo : null}
          sport={league.matchType}
          gender={league.gender}
          picked={tally?.my_pick === game.away_id}
          pct={awayPct}
          voted={voted}
          disabled={pending || voted}
          onClick={() => handlePick(game.away_id)}
          reverse
        />
      </div>
    </div>
  )
}

// reverse mirrors the right-hand option (Mohamed 2026-08-19: "left player:
// image + name + % / right player: % + name + image") — row-reverse keeps
// the DOM/tab order as avatar-name-pct on both sides (screen readers hit
// the name in the same relative order either way) while only the VISUAL
// layout flips, so the two avatars land on the outer edges and both
// percentages face inward toward the "vs" gap between them.
function VoteOption({ name, portrait, sport, gender, picked, pct, voted, disabled, onClick, reverse }) {
  return (
    <button
      type="button"
      className={`${styles.voteOption}${reverse ? ' ' + styles.voteOptionReverse : ''}${picked ? ' ' + styles.voteOptionPicked : ''}${voted ? ' ' + styles.voteOptionVoted : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <AthleteAvatar src={portrait} name={name || '?'} sport={sport} gender={gender} fallback="letter" className="avatar" />
      <span className={styles.voteOptionName}>{name || '—'}</span>
      {voted && <span className={styles.voteOptionPct}>{pct}%</span>}
    </button>
  )
}

function PerformancesTable({ league, game, home, away }) {
  const isUfc = league.matchType === 'ufc'
  const rows = isUfc ? UFC_PERF_ROWS : PERF_ROWS
  const finalsLabel = league.tour === 'wta' ? 'WTA Final' : 'ATP Final'
  return (
    <table className={styles.perfTable}>
      <tbody>
        {rows.map(row => {
          const label = row.label || finalsLabel
          let leftVal, rightVal
          if (isUfc) {
            leftVal = ufcStatValue(home, row.key, game.match_date)
            rightVal = ufcStatValue(away, row.key, game.match_date)
          } else if (row.key === 'age') {
            leftVal = home ? calcAge(home.birth_date, game.match_date) ?? '—' : '—'
            rightVal = away ? calcAge(away.birth_date, game.match_date) ?? '—' : '—'
          } else if (row.key === 'seasons') {
            leftVal = home?.season_count ?? '—'
            rightVal = away?.season_count ?? '—'
          } else if (row.key === 'best_rank') {
            leftVal = home?.best_rank ?? '—'
            rightVal = away?.best_rank ?? '—'
          } else {
            leftVal = home ? (home[row.key] ?? '—') : '—'
            rightVal = away ? (away[row.key] ?? '—') : '—'
          }
          const comparable = row.better && typeof leftVal === 'number' && typeof rightVal === 'number' && leftVal !== rightVal
          const leftBest = comparable && (row.better === 'higher' ? leftVal > rightVal : leftVal < rightVal)
          const rightBest = comparable && !leftBest
          const suffix = row.suffix || ''
          return (
            <tr key={row.key}>
              <td className={styles.perfValue}><span className={leftBest ? styles.perfValueBest : undefined}>{leftVal}{typeof leftVal === 'number' ? suffix : ''}</span></td>
              <td className={styles.perfLabel}>{label}</td>
              <td className={styles.perfValue}><span className={rightBest ? styles.perfValueBest : undefined}>{rightVal}{typeof rightVal === 'number' ? suffix : ''}</span></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
