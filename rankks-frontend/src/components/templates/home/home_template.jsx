// templates/home/home_template.jsx
// Home tab (Line A, pinned first entry) — shared across football/basketball
// (ContentArea.jsx renders this directly for activeTab === 'home',
// bypassing the typology/registry lookup since there's no real
// result_tabs row backing it). Also doubles as the "Schedule" tab for
// basketball, World Cup/quad-biennial football, AND round-robin football
// leagues (Ligue 1, Premier League, Bundesliga, La Liga, Serie A —
// Mohamed 2026-08-26 for NBA: "Schedule becomes a regular Line A item. Keep
// home button for NBA"; 2026-08-25 for World Cup, same correction:
// "Schedule must be a regular item. Keep the purple placeholder for Home
// of World Cup"; same day, extended to the leagues: "now create a Schedule
// page for Ligue 1, Premier League, Bundesliga, La Liga, Serie A... same
// rule") via mode="schedule" — a REGULAR, non-pinned Line A entry (see
// ContentArea.jsx's activeTab==='schedule' branch and its own 'schedule'
// synthetic tab in the tabs/events arrays), reusing this same
// component/banner plumbing rather than a parallel file per sport.
//
// Basketball's real Home (mode="home") renders the shared HomepageTemplate
// dashboard (Mohamed 2026-08-26: "now create the homepage of NBA / based
// upon F1/Moto Gp etc.") — same scope="ufc"/"f1"/"motogp" mechanism those
// sports' own Home tabs already use. Same day 2026-08-25, extended to every
// round-robin football league too ("Create home page of Ligue 1, Serie A,
// etc based upon existing model") — scope IS the competitionSlug itself
// (HomepageTemplate.jsx's own isFootballLeagueScope), gated by the same
// hasLeagueFinalTour flag the Schedule tab above already uses, so any
// future league seeded the same way gets a Home page with zero further
// wiring here. Both render their OWN full page shell (ad rail, league
// list, detail panel), so they short-circuit before any of the
// FootballHomeBlock/subtitle plumbing below, same as MmaEventTemplate's own
// `{section === 'home' && <HomepageTemplate scope="ufc" />}` — no wrapping
// banner.
//
// World Cup/quad-biennial football is the one Home left with no dashboard
// built — its real Home (mode="home") stays the plain banner ("Home of X",
// the "purple placeholder") plus the generic "coming soon" body. Its full
// match schedule lives on the separate Schedule tab (mode="schedule")
// instead — see football_home_knockout_template.jsx (World Cup) /
// football_home_league_template.jsx (the leagues) for that content, and
// templates/teams/football_champion_history_knockout_template.jsx for the
// unrelated All-Time > Champion History cross-edition table (2026-08-12,
// Mohamed: "Home of World Cup is something tot diff").
import { Suspense, lazy, useEffect, useState } from 'react'
import { api } from '../../../services/api'
import { FootballHomeBlock, SportHomeBanner } from '../../EventBlock/EventBlock'
import ebStyles from '../../EventBlock/EventBlock.module.css'
import FootballHomeKnockoutTemplate from './football_home_knockout_template'
import FootballHomeLeagueTemplate from './football_home_league_template'
import NbaHomeTemplate from './nba_home_template'
// Lazy — same CJS-interop-under-Rolldown reasoning ContentArea.jsx's own
// HomepageTemplate import already documents.
const HomepageTemplate = lazy(() => import('../homepage/HomepageTemplate'))

export default function HomeTemplate({ pageTitle, competition, naming = null, seasonId, year, competitionSlug, mode = 'home', hasLeagueFinalTour = false, hasLeaguePhase = false, hasGroupStages = false }) {
  const isQuadOrBiennial = competition?.competition_type === 'quadrennial' || competition?.competition_type === 'biennial'
  const isBasketball = competition?.sport_slug === 'basketball'
  // Basketball, World Cup/quad-biennial football, any round-robin league
  // with a literal 'final_tour' Results tab (ContentArea.jsx's own
  // hasLeagueFinalTour — data-driven, not a hardcoded competition list),
  // UCL's own 'league_phase' tab_group shape (hasLeaguePhase, same
  // data-driven convention — 2026-08-26), and UCL's OLDER 'group_stages'
  // shape (hasGroupStages — 2026-08-27, "create schedule page for all UCL
  // seasons") all pass mode="schedule" for their own separate Schedule
  // tab — every other sport's Home tab is unaffected and keeps mode="home"
  // implicitly.
  const isSchedule = mode === 'schedule' && (isBasketball || isQuadOrBiennial || hasLeagueFinalTour || hasLeaguePhase || hasGroupStages)
  const isNbaHome = mode === 'home' && isBasketball
  // Round-robin leagues' real Home dashboard (2026-08-25) — same
  // hasLeagueFinalTour gate as isSchedule above, just for mode="home"
  // instead. World Cup is deliberately excluded (isQuadOrBiennial, not
  // hasLeagueFinalTour) — it keeps the plain banner/placeholder Home.
  const isLeagueHome = mode === 'home' && hasLeagueFinalTour

  // Admin-configured subtitle line (rankks-admin's Subtitles page) — Home
  // is shared across every sport (Mohamed: "same for every single sport
  // -> all sports/shared"), so it resolves at the pure global tier, no
  // sportSlug/competitionSlug needed. Skipped on the Schedule tab (its own
  // component already fetches/renders a 'Schedule' catalog subtitle) and
  // on NBA's/the leagues' Home dashboard (HomepageTemplate is a standalone
  // page, no subtitle slot).
  const [pageSubtitle, setPageSubtitle] = useState(null)
  useEffect(() => {
    if (!year || isSchedule || isNbaHome || isLeagueHome) return
    api.getSubtitle(null, null, 'Home', null, year)
      .then(d => setPageSubtitle(d?.subtitle || null))
      .catch(() => setPageSubtitle(null))
  }, [year, isSchedule, isNbaHome, isLeagueHome])

  if (isNbaHome) {
    // Sport-wide "Home of Basketball" (Mohamed 2026-08-26) — NBA is the
    // only real competition today, so this is the whole hub for now, same
    // as Combat Sport/UFC below; no per-competition banner or Line A above
    // it (see SportHomeBanner's own comment).
    return (
      <>
        <SportHomeBanner icon={<img src="/media/icons/sports/icon-basketball.png" alt="" className={ebStyles.eventCompetitionIconStandalone} />} label="Basketball" />
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <HomepageTemplate scope="nba" />
        </Suspense>
      </>
    )
  }
  if (isLeagueHome) {
    // Sport-wide "Home of Football" now, not a per-league one (Mohamed
    // 2026-08-26: "No more Home of Ligue 1... Home of Football (gathering
    // Ligue 1, Premier League, UCL, etc.)") — scope="football" merges every
    // real football league into one hub, same pattern as Basketball above.
    // Reached from ANY football competition's own Home button (LineA's
    // pinned short_code icon), landing on the same shared page regardless
    // of which competition it was clicked from — ContentArea.jsx's own
    // LineA is hidden on this tab too (see its own comment).
    return (
      <>
        <SportHomeBanner icon={<img src="/media/icons/sports/icon-football.png" alt="" className={ebStyles.eventCompetitionIconStandalone} />} label="Football" />
        <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
          <HomepageTemplate scope="football" />
        </Suspense>
      </>
    )
  }

  // Banner only on Home for World Cup/basketball (unchanged) — the
  // round-robin leagues' own Home tab now renders the full dashboard above
  // instead of ever reaching this banner at all; it's scoped to their
  // Schedule tab specifically (mode==='schedule').
  const showBanner = isQuadOrBiennial || isBasketball || ((hasLeagueFinalTour || hasLeaguePhase || hasGroupStages) && isSchedule)

  return (
    <>
      {/* Guards the RENDER too, not just the fetch above — competition is
          still null on the very first render (async), so isSchedule can
          briefly read false when the effect above first runs, letting a
          stale 'Home'-tier fetch resolve after the fact. Without this, a
          global Home catalog row (if one's ever added) would flash in
          above Schedule's own subtitle. */}
      {pageSubtitle && !isSchedule && <div className="page-subtitle">{pageSubtitle}</div>}
      {showBanner && <FootballHomeBlock competition={competition} naming={naming} pageTitle={pageTitle} schedule={isSchedule} year={year} />}
      {isSchedule ? (
        isBasketball ? <NbaHomeTemplate year={year} />
        : isQuadOrBiennial ? <FootballHomeKnockoutTemplate seasonId={seasonId} competitionName={competition?.name} competitionSlug={competitionSlug} year={year} />
        // UCL's League Phase (R1-R8) + knockout stages (Playoffs -> Round
        // of 16 -> Quarter Finals -> Semifinals -> Final) reuse the exact
        // same flat, filterable schedule table as the round-robin leagues,
        // merged into one list (Mohamed 2026-08-26: "In schedule page, add
        // games: Playoffs I Round of 16 I Quart Finals I Semifinals Final
        // (also in sort)") — fetched by tab_group array instead of a single
        // tab_key, since each stage is its own result_tabs row rather than
        // one flat "Results" tab. No Leaders card there — "Champion"
        // doesn't mean anything for a League Phase table (the real trophy
        // comes from the Final, not finishing top of this phase), so the
        // component already omits it whenever tabGroup is passed (see its
        // own fetch guard). UCL's OLDER Group Stages era (pre-2024, Group
        // A..H + the same knockout final_tour) reuses this exact same merge
        // path — just a different first group key — so every season back
        // to first_data_year gets a Schedule tab, not just 2025/26+
        // (Mohamed 2026-08-27: "create schedule page for all UCL seasons").
        : hasLeaguePhase ? <FootballHomeLeagueTemplate seasonId={seasonId} competitionSlug={competitionSlug} year={year} tabGroup={['league_phase', 'final_tour']} />
        : hasGroupStages ? <FootballHomeLeagueTemplate seasonId={seasonId} competitionSlug={competitionSlug} year={year} tabGroup={['group_stages', 'final_tour']} />
        : <FootballHomeLeagueTemplate seasonId={seasonId} competitionSlug={competitionSlug} year={year} />
      ) : (
        <div style={{ padding: '40px 16px' }}>
          <div style={{ marginTop: 8, color: 'var(--text3)' }}>
            This page is coming soon.
          </div>
        </div>
      )}
    </>
  )
}
