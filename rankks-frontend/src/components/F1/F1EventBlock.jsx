 // components/F1/F1EventBlock.jsx
// Two variants per RANKKS F1 Master Spec §2:
//   Eventblock 1 (driver-focused) — Drivers/Races/Fastest Lap/sessions
//   Eventblock 2 (team-focused)   — Teams standings only
// Both render through the SAME EventBlock.module.css football/tennis
// use — no bespoke F1 stylesheet.
//
// COLORS + LOGO — same matrix as football/tennis's EventBlock.jsx: the
// competition row's primary_color/secondary_color/logo_url (set in
// admin, including era-specific logo overrides via competition_logos)
// drive the stat bar / page notice backgrounds and the F1 wordmark,
// fetched once in F1ContentArea.jsx via
// getCompetition('formula-1-world-championship') and passed down as
// primaryColor/secondaryColor/logoUrl props. The constants below are
// ONLY the fallback used if those DB fields are null — never applied
// when a real admin-set value exists. This keeps F1 on the same
// "zero code change per new sport" pattern as every other sport:
// setting a competition's logo/colors in admin is enough, no
// per-sport hardcoding.
//
// SEASON STATUS — F1ChampionshipBlock and F1TeamsChampionshipBlock now
// read season_status ('past' | 'current' | 'future') off the standings
// API response. This is computed server-side (f1.js), never stored:
// f1_seasons deliberately has no status column, unlike the generic
// seasons table — a season is 'current' if it has at least one raced GP
// and at least one still upcoming, mirroring the same past/current/
// future concept football/tennis store manually, but derived live from
// f1_grands_prix.event_date instead. When 'current', the label swaps
// from "Winner"/leaderboard-topper framing to "Current Leader" with an
// ONGOING badge, reusing the shared StatusBadge component the GP block
// below also uses for its own (date-driven) status.
import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import styles from '../EventBlock/EventBlock.module.css'
import { StatusBadge } from '../EventBlock/EventBlock'
import Flag from '../shared/Flag'
import { PillHomeIcon, PillBarsIcon, PillPlayIcon } from '../shared/PillIcons'
import AthleteAvatar from '../shared/AthleteAvatar'
import { calcAge, fmtWeekendRange, fmtDate } from '../../utils/calcAge'

// Fallback ONLY — used if competition.logo_url comes back null from the
// getCompetition() fetch in F1ContentArea.jsx. Real admin-set value
// always wins when present.
const F1_LOGO_FALLBACK = '/media/logos/competitions/motor-racing/international/formula-1.png'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const DEFAULT_TEAM_LOGO = '/media/default/club.png' // shared default across every sport, not a per-sport asset

// Driver portrait for the Championship stat-bloc photo — deliberately NOT
// entities.image_url (resolveImg(champion.logo_url) above): that column
// was scraped pointing at /media/athletes/motor-racing/male/profile/,
// paddock-style photos with inconsistent crops/backgrounds, not the same
// clean headshot convention every other sport's portrait/ folder holds.
// Built from the driver's own slug instead, pointed at .../portrait/ —
// currently empty for F1 (no files uploaded yet), so every driver falls
// through AthleteAvatar's onError to the default silhouette until real
// portrait assets are added there, same as a brand-new athlete in any
// other sport would.
function getDriverPortraitPath(slug) {
  if (!slug) return null
  return `/media/athletes/motor-racing/male/portrait/${slug}.png`
}

// fmtDate is now the shared one imported from utils/calcAge.js
// (dd.mm.yyyy — "09.04.2022"). Was previously its own local function
// here using en-GB short-month format ("9 Apr 2022"), which is what
// produced the "RACE DAY" stat-bar value seen in the app — that was
// never centralized despite calcAge already being shared correctly
// above it.

// Competition logo with graceful text fallback if the file is ever
// missing/moved — same onError pattern used everywhere else in the app.
// GP weekend status — 'ongoing' if today falls within the race weekend
// (raceDate-2 .. raceDate, same window fmtWeekendRange uses for the
// Schedule stat), 'future' if it hasn't started, 'past' once it's over.
// Replaces the old "SPRINT WEEKEND" badge, which conflated session format
// with whether the round was actually happening right now.
// Season-long date range for the Championship block's "Schedule" stat —
// same compact same-year format fmtWeekendRange uses for a race weekend
// (day.month - day.month.year), just without that function's day-range
// collapsing (a season's first/last GP are never in the same month).
function fmtSeasonRange(startStr, endStr) {
  if (!startStr || !endStr) return null
  const start = new Date(startStr)
  const end = new Date(endStr)
  if (isNaN(start) || isNaN(end)) return null
  if (start.getFullYear() !== end.getFullYear()) {
    return `${fmtDate(start)} - ${fmtDate(end)}`
  }
  const pad = n => String(n).padStart(2, '0')
  return `${pad(start.getDate())}.${pad(start.getMonth() + 1)} - ${pad(end.getDate())}.${pad(end.getMonth() + 1)}.${end.getFullYear()}`
}

function getGpStatus(raceDateStr) {
  if (!raceDateStr) return null
  const end = new Date(raceDateStr)
  if (isNaN(end)) return null
  const start = new Date(end)
  start.setDate(start.getDate() - 2)
  start.setHours(0, 0, 0, 0)
  const endOfDay = new Date(end)
  endOfDay.setHours(23, 59, 59, 999)
  const now = new Date()
  if (now < start) return 'future'
  if (now > endOfDay) return 'past'
  return 'ongoing'
}

// Shared label/badge logic for the two Championship-style blocks below.
// 'current' → "Current Leader" + ONGOING badge (matches the football/
// tennis convention documented in the Ingestion Process doc: "Current
// season: ONGOING badge... 'Current league leader' label").
// 'past'/'future'/unknown → "Champion" (season-level area tag — same
// "Winner" → "Champion" rewording applied to every other non-basketball
// area-title context in EventBlock.jsx's getAreaTitle()).
function areaTitleFor(seasonStatus) {
  return seasonStatus === 'current' ? 'Current Leader' : 'Champion'
}

// StatusBadge (EventBlock.jsx) expects 'past' | 'ongoing' | anything-else
// (rendered as UPCOMING) — season_status's own 'current' value needs
// translating to 'ongoing' first.
function statusBadgeStatus(seasonStatus) {
  return seasonStatus === 'current' ? 'ongoing' : seasonStatus
}

// ─── EVENTBLOCK 1 — Championship (driver-focused, Eventblock 1 in spec) ───
// Bottom stat bar (Schedule/Edition/Drivers/Teams) is season-level context
// — same across every driver shown, unlike the old Points/Wins/2nd/3rd/
// Pole/Age row which was specific to the champion/leader themselves. Those
// per-driver numbers moved into the career stat bloc (careerStatRows)
// instead, mirroring basketball's EventBlock.jsx teamStatRows pattern:
// career totals "through {year}", with a "+1" badge on any row this
// season itself contributed to (mirrors basketball's highlighted +1
// convention exactly — see EventBlock.jsx's teamStatRows/statBlocBadge).
export function F1ChampionshipBlock({ seasonId, year, primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [champion, setChampion] = useState(null)
  const [seasonStatus, setSeasonStatus] = useState(null)
  const [seasonStartDate, setSeasonStartDate] = useState(null)
  const [seasonEndDate, setSeasonEndDate] = useState(null)
  const [edition, setEdition] = useState(null)
  const [driversCount, setDriversCount] = useState(null)
  const [teamsCount, setTeamsCount] = useState(null)
  const [racesCount, setRacesCount] = useState(null)
  const [career, setCareer] = useState(null)

  useEffect(() => {
    if (!seasonId) {
      setChampion(null); setSeasonStatus(null); setSeasonStartDate(null); setSeasonEndDate(null)
      setEdition(null); setDriversCount(null); setTeamsCount(null); setRacesCount(null)
      return
    }
    api.getF1Standings(seasonId, 'drivers')
      .then(d => {
        setChampion(d?.standings?.[0] || null)
        setSeasonStatus(d?.season_status || null)
        setSeasonStartDate(d?.season_start_date || null)
        setSeasonEndDate(d?.season_end_date || null)
        setEdition(d?.edition ?? null)
        setDriversCount(d?.drivers_count ?? null)
        setTeamsCount(d?.teams_count ?? null)
        setRacesCount(d?.races_count ?? null)
      })
      .catch(() => {
        setChampion(null); setSeasonStatus(null); setSeasonStartDate(null); setSeasonEndDate(null)
        setEdition(null); setDriversCount(null); setTeamsCount(null); setRacesCount(null)
      })
  }, [seasonId])

  useEffect(() => {
    if (!champion?.entity_id || !year) { setCareer(null); return }
    api.getF1DriverCareer(champion.entity_id, year)
      .then(setCareer)
      .catch(() => setCareer(null))
  }, [champion?.entity_id, year])

  const isOngoing = seasonStatus === 'current'
  const schedule = fmtSeasonRange(seasonStartDate, seasonEndDate)
  // Age as of the season's last race (season_end_date) — same reference-date
  // convention as F1DriversTemplate, which uses the identical two fields
  // from this same standings response. Shown inline next to the name (see
  // JSX below), not in the bottom bar — mirrors basketball's Awards variant
  // in EventBlock.jsx (winnerName + " | {age} years", team name on its own
  // line beneath).
  const age = champion ? calcAge(champion.birth_date, seasonEndDate, champion.death_date) : null

  // Career stat bloc rows — Seasons/Champion/Wins/Podiums/Poles/Sprints,
  // career totals through this year. "0 rule": every row always renders
  // even at 0 (a driver's career win/podium/pole count of 0 is itself
  // meaningful, same convention as basketball's teamStatRows) — nothing
  // here is hidden the way NBA Cup's 0-participation row is.
  // "Yearly badge" — a driver can only ever win 0 or 1 championship in a
  // given season, so Champion's badge is a flat "+1" (same convention
  // basketball's badge already uses, where every badged stat is inherently
  // 1-per-season). Wins/Podiums/Poles/Sprints are NOT 1-per-season though —
  // Verstappen alone scored 9 wins in 2024 — so a flat "+1" there would be
  // wrong. Each badge instead shows THIS season's own real tally
  // (champion.stats, already on hand from the standings row), i.e. the
  // actual year-over-year delta: career-through-this-year minus
  // career-through-last-year equals exactly that season's own number
  // (verified: 2024 total 63 wins − 2023 total 54 = 9, Verstappen's real
  // 2024 win count). Champion is only badged once the season is actually
  // decided (isOngoing leaders haven't secured the title yet, even though
  // they currently sit in position 1).
  const careerStatRows = (champion && career) ? (() => {
    const seasonWins   = champion.stats?.wins ?? 0
    const seasonPodiums = (champion.stats?.wins ?? 0) + (champion.stats?.p2 ?? 0) + (champion.stats?.p3 ?? 0)
    const seasonPoles  = champion.stats?.poles ?? 0
    const seasonSprints = champion.stats?.sprint_wins ?? 0
    return [
      { key: 'seasons', label: 'Seasons', value: career.seasons },
      {
        key: 'champion', label: 'Champion', value: career.championships,
        highlighted: !isOngoing, badge: '+1',
        sub: career.championships > 0
          ? (career.prev_title_year ? `${year - career.prev_title_year} Y. ago` : '1st title')
          : null,
      },
      { key: 'wins', label: 'Wins', value: career.wins, highlighted: seasonWins > 0, badge: `+${seasonWins}` },
      { key: 'podiums', label: 'Podiums', value: career.podiums, highlighted: seasonPodiums > 0, badge: `+${seasonPodiums}` },
      { key: 'poles', label: 'Poles', value: career.poles, highlighted: seasonPoles > 0, badge: `+${seasonPoles}` },
      { key: 'sprints', label: 'Sprints', value: career.sprint_wins, highlighted: seasonSprints > 0, badge: `+${seasonSprints}` },
      // Zero-suppression — a stat that's genuinely 0 for this driver's
      // whole career (e.g. Sprints for anyone whose career predates 2021,
      // or a driver who's never won) is noise, not information, here.
    ].filter(row => Number(row.value) > 0)
  })() : null

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <div className={styles.info}>
              {/* Sport name ("FORMULA 1") dropped — redundant, same
                  competition-name removal as football/basketball's
                  EventBlock.jsx categoryRow (context already establishes
                  the sport). Status now lives in .eventName next to the
                  area tag, same slot every other sport uses it in. */}
              <div className={styles.eventCompetition}>Formula 1</div>
              <div className={styles.categoryRow} />
              <div className={styles.eventName}>
                <span className={styles.eventNameText}>World Championship {year}</span>
                <span className={styles.areaTag}>{areaTitleFor(seasonStatus)}</span>
                <StatusBadge status={statusBadgeStatus(seasonStatus)} />
              </div>
              {champion && (
                <>
                  <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>
                    <Flag iso2={champion.country_iso2} name={champion.country_name} className={styles.winnerFlag} />
                    {champion.canonical_name}
                  </div>
                  {(age != null || champion.stats?.team_name) && (
                    <div className={styles.eventDetails}>
                      {age != null && `${age} years`}
                      {age != null && champion.stats?.team_name && ' | '}
                      {champion.stats?.team_name}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Career stat bloc — sits between the name/team info and the
              driver photo, same slot/convention as basketball's
              teamStatRows in EventBlock.jsx (see that file's Stat bloc
              comment). Replaces the old per-driver Points/Wins/2nd/3rd/
              Pole/Age row that used to live in the bottom bar below —
              that bar is now season-level context only (Schedule/
              Edition/Drivers/Teams), not tied to any one driver. */}
          {careerStatRows && (
            <div className={styles.statBloc}>
              <div className={styles.statBlocRows}>
                {careerStatRows.map(row => (
                  <div key={row.key} className={`${styles.statBlocRow} ${row.highlighted ? styles.statBlocHighlight : ''}`}>
                    <span className={styles.statBlocLabel}>
                      {row.label}
                      {row.highlighted && <span className={styles.statBlocBadge}>{row.badge || '+1'}</span>}
                    </span>
                    <span className={styles.statBlocValue}>
                      {row.sub && <span className={styles.statBlocSub}>{row.sub} </span>}
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.statBlocTitle}>Career stats through {year}</div>
            </div>
          )}

          {/* Narrowed + rectangular full-bleed crop — same treatment (and
              same reason: aligning against the fixed-width statBloc next
              to it) as basketball's Awards portrait in EventBlock.jsx
              (.portraitWrapNarrow + .portrait/.portraitSquare), not the
              circular club-badge crop (.clubLogo) used for the Teams
              standings block below, which has no adjacent stat bloc to
              align against. */}
          <div className={`${styles.portraitWrap} ${styles.portraitWrapNarrow}`}>
            <AthleteAvatar src={getDriverPortraitPath(champion?.slug)} name={champion?.canonical_name} sport="f1" gender="M" className={`${styles.portrait} ${styles.portraitSquare}`} />
          </div>
        </div>

        <div className={styles.bottom}>
          {schedule && (
            <div className={styles.statBlock}>
              <span className={styles.statLabel}>Schedule</span>
              <span className={styles.statVal}>{schedule}</span>
            </div>
          )}
          {edition != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Edition</span>
                <span className={styles.statVal}>{edition}</span>
              </div>
            </>
          )}
          {driversCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Drivers</span>
                <span className={styles.statVal}>{driversCount}</span>
              </div>
            </>
          )}
          {teamsCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Teams</span>
                <span className={styles.statVal}>{teamsCount}</span>
              </div>
            </>
          )}
          {racesCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Races</span>
                <span className={styles.statVal}>{racesCount}</span>
              </div>
            </>
          )}
          <div className={styles.bottomLogoWrap}>
            <img src={resolveImg(logoUrl)} alt="" className={styles.bottomLogo} onError={e => { e.target.style.display = 'none' }} />
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── ALL-TIME BLOCK — minimal 2-line banner for All-Time pages (Driver
// Stats/Team Stats/Race Stats) ───
// All-Time is a cumulative "through <year>" view, not tied to any one
// season or race, so none of the Championship/GP blocks' per-season
// stat content (career stat bloc, Schedule/Edition/Drivers/Teams bar,
// portrait) applies here. Same visual language (colors, same
// PAGE_NOTICE_TEXT bar) as every other F1 banner, just collapsed to two
// flat bars per Mohamed's spec: a plain black title bar and the standard
// red page-notice bar underneath.
export function F1AllTimeBlock({ primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const resolvedLogo = resolveImg(logoUrl) || F1_LOGO_FALLBACK
  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>Formula 1<PillBarsIcon /></span>
          <span className={styles.eventName}>
            Aggregated statistics across the selected Formula 1 seasons
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoFailed
              ? <img src={resolvedLogo} alt="Formula 1" className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>F1</span>
            }
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── HOME BLOCK — same compact banner as F1AllTimeBlock, Home's own
// framing instead of the All-Time one's career-wide text.
export function F1HomeBlock({ primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const resolvedLogo = resolveImg(logoUrl) || F1_LOGO_FALLBACK
  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>Formula 1<PillHomeIcon /></span>
          <span className={styles.eventName}>
            Home of Formula 1
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoFailed
              ? <img src={resolvedLogo} alt="Formula 1" className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>F1</span>
            }
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── ICONIC MOMENTS BLOCK — same compact banner as F1AllTimeBlock,
// season-specific text instead of the All-Time one's career-wide framing.
export function F1IconicMomentsBlock({ year, primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const resolvedLogo = resolveImg(logoUrl) || F1_LOGO_FALLBACK
  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>Formula 1<PillPlayIcon /></span>
          <span className={styles.eventName}>
            Watch Center of the {year} Formula 1 season
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoFailed
              ? <img src={resolvedLogo} alt="Formula 1" className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>F1</span>
            }
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── GP BLOCK (also driver-focused / Eventblock 1 styling) ───
// Same treatment as F1ChampionshipBlock above: narrow rectangular
// portrait crop (not the circular .clubLogo badge crop), name + age
// inline, team name + "Engine: X" beneath on their own lines, and a
// full statBloc panel matching the Championship block's exact row set —
// Seasons, Champion, Wins, Podiums, Poles, Sprints (Podiums merges
// 2nd+3rd, same convention as the Drivers/Teams standings tables) —
// instead of the old flat bottom-bar row.
//
// SEASONS / CHAMPION — career totals through this race's year (same
// api.getF1DriverCareer fetch the Championship block uses), NOT
// round-scoped and NOT badged: a championship is decided at the season's
// end, not attributable to any single round, so badging it here the way
// Wins/Podiums/Poles/Sprints badge their own round's contribution would
// misleadingly imply this specific race won the driver a title.
//
// WINS / PODIUMS / POLES / SPRINTS BADGES — year-over-year delta
// convention from the Championship block, scoped to "this round" instead
// of "this season": fetches driver-race-stats twice (through this round,
// and through the PREVIOUS round) and badges each stat with the real
// difference — e.g. a driver who won both the Sprint and the Race on the
// same weekend gets +1 on Wins AND +1 on Sprints; a round-1 GP naturally
// diffs against all-zero "previous round" stats (uptoRound=0 matches no
// rows), same effect as a driver's first-ever season in the Championship
// block.
//
// BOTTOM BAR — kept ALL of the Championship block's season-context
// tiles (Schedule/Edition/Drivers/Teams) rather than replacing them —
// only Schedule's VALUE changes meaning (this race weekend's dates, not
// the whole season's), Edition/Drivers/Teams are identical season-wide
// facts repeated across every GP of that season, same as how the
// Championship block itself shows them. Laps is the one truly new
// addition, placed between Edition and Drivers per product's requested
// order: Schedule / Edition / Laps / Drivers / Teams.
//
// WINNER — always the main Race session's P1 result (driver + team),
// regardless of which Line B session tab (Race Results, Qualifying,
// Practice, Sprint...) is currently active. Sprint weekends still show
// the Race winner, never the Sprint winner — per product decision, the
// winner shown here is tied to the race itself, not to whichever
// sub-tab the user happens to be viewing.
export function F1GPBlock({ gp, sessions, year, status, primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [raceResults, setRaceResults]             = useState(null)
  const [winnerRoundStats, setWinnerRoundStats]   = useState(null)
  const [winnerPrevStats, setWinnerPrevStats]     = useState(null)
  const [seasonMeta, setSeasonMeta]               = useState(null)
  const [winnerCareer, setWinnerCareer]           = useState(null)

  const raceSession  = sessions?.find(s => s.session_type === 'Race')
  const rawSessionDate = raceSession?.session_date || sessions?.[0]?.session_date
  const schedule = rawSessionDate ? fmtWeekendRange(rawSessionDate) : null
  // Past/Ongoing/Next/Upcoming — resolved by the parent (F1ContentArea),
  // which ranks every GP in the season against each other via
  // classifyByDate; "is this the very next round" isn't knowable from
  // this one GP's date in isolation. Falls back to the old single-date
  // window check (past/ongoing/upcoming, no "next") if the caller
  // doesn't pass a resolved status.
  const gpStatus = status || getGpStatus(rawSessionDate)

  useEffect(() => {
    if (!raceSession?.id) { setRaceResults(null); return }
    api.getF1SessionResults(raceSession.id)
      .then(d => setRaceResults(d?.results || null))
      .catch(() => setRaceResults(null))
  }, [raceSession?.id])

  const raceWinner = raceResults?.find(r => String(r.position) === '1') || null
  // Age as of this GP's race date — mirrors F1SessionResultsTemplate's
  // use of the same session.event_date reference for the identical
  // raceResults response this block already fetches.
  const winnerAge = raceWinner ? calcAge(raceWinner.birth_date, raceSession?.session_date, raceWinner.death_date) : null

  useEffect(() => {
    if (!raceWinner?.driver_id || !gp?.season_id || !gp?.round_order) {
      setWinnerRoundStats(null); setWinnerPrevStats(null)
      return
    }
    api.getF1DriverRaceStats(raceWinner.driver_id, gp.season_id, gp.round_order)
      .then(setWinnerRoundStats)
      .catch(() => setWinnerRoundStats(null))
    api.getF1DriverRaceStats(raceWinner.driver_id, gp.season_id, gp.round_order - 1)
      .then(setWinnerPrevStats)
      .catch(() => setWinnerPrevStats(null))
  }, [raceWinner?.driver_id, gp?.season_id, gp?.round_order])

  // Career Seasons/Champion — same fetch the Championship block uses,
  // scoped to this race's own year (not round-level, since a
  // championship is decided per-season, not per-round).
  useEffect(() => {
    if (!raceWinner?.driver_id || !year) { setWinnerCareer(null); return }
    api.getF1DriverCareer(raceWinner.driver_id, year)
      .then(setWinnerCareer)
      .catch(() => setWinnerCareer(null))
  }, [raceWinner?.driver_id, year])

  // Season-context tiles (Edition/Drivers/Teams) — same fetch/fields the
  // Championship block uses, just for the bottom bar's season-level facts.
  useEffect(() => {
    if (!gp?.season_id) { setSeasonMeta(null); return }
    api.getF1Standings(gp.season_id, 'drivers')
      .then(d => setSeasonMeta({ edition: d?.edition ?? null, driversCount: d?.drivers_count ?? null, teamsCount: d?.teams_count ?? null }))
      .catch(() => setSeasonMeta(null))
  }, [gp?.season_id])

  if (!gp) return null

  // "0 rule" — every row always renders even at 0, same convention as
  // the Championship block's careerStatRows. Seasons/Champion come from
  // the career fetch (year-scoped, no per-round badge — a championship
  // is decided at season's end, not attributable to any one round, so
  // badging it here the way Wins/Podiums/Poles/Sprints badge their own
  // round's contribution would misleadingly imply THIS race won the
  // title). Wins/Podiums/Poles/Sprints keep their round-delta badges.
  const raceStatRows = (winnerRoundStats && winnerPrevStats && winnerCareer) ? (() => {
    const podiums     = winnerRoundStats.wins + winnerRoundStats.p2 + winnerRoundStats.p3
    const prevPodiums = winnerPrevStats.wins + winnerPrevStats.p2 + winnerPrevStats.p3
    const dWins    = winnerRoundStats.wins - winnerPrevStats.wins
    const dPodiums = podiums - prevPodiums
    const dPoles   = winnerRoundStats.poles - winnerPrevStats.poles
    const dSprints = winnerRoundStats.sprint_wins - winnerPrevStats.sprint_wins
    return [
      { key: 'seasons', label: 'Seasons', value: winnerCareer.seasons },
      {
        key: 'champion', label: 'Champion', value: winnerCareer.championships,
        sub: winnerCareer.championships > 0
          ? (winnerCareer.prev_title_year ? `${year - winnerCareer.prev_title_year} Y. ago` : '1st title')
          : null,
      },
      { key: 'wins', label: 'Wins', value: winnerRoundStats.wins, highlighted: dWins > 0, badge: `+${dWins}` },
      { key: 'podiums', label: 'Podiums', value: podiums, highlighted: dPodiums > 0, badge: `+${dPodiums}` },
      { key: 'poles', label: 'Poles', value: winnerRoundStats.poles, highlighted: dPoles > 0, badge: `+${dPoles}` },
      { key: 'sprints', label: 'Sprints', value: winnerRoundStats.sprint_wins, highlighted: dSprints > 0, badge: `+${dSprints}` },
      // Zero-suppression — see F1ChampionshipBlock's own careerStatRows.
    ].filter(row => Number(row.value) > 0)
  })() : null

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <div className={styles.info}>
              {/* Sport name ("FORMULA 1") dropped — redundant, same as
                  the Championship block above; year moved into
                  .eventNameText instead (matches football/basketball's
                  "{name} {activeYear}" convention). */}
              <div className={styles.eventCompetition}>Formula 1</div>
              <div className={styles.categoryRow} />
              <div className={styles.eventName}>
                <span className={styles.eventNameText}>{gp.name} {year}</span>
                {/* circuit_name is always null — confirmed absent from source, see F1 master spec open items */}
                {raceWinner && <span className={styles.areaTag}>Winner</span>}
                <StatusBadge status={gpStatus} />
              </div>
              {raceWinner && (
                <>
                  <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>
                    <Flag iso2={raceWinner.driver_country_iso2} name={raceWinner.driver_country_name} className={styles.winnerFlag} />
                    {raceWinner.driver_name}
                  </div>
                  {(winnerAge != null || raceWinner.team_name_raw) && (
                    <div className={styles.eventDetails}>
                      {winnerAge != null && `${winnerAge} years`}
                      {winnerAge != null && raceWinner.team_name_raw && ' | '}
                      {raceWinner.team_name_raw}
                      {raceWinner.engine_name && ` (${raceWinner.engine_name})`}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Season-to-date stat bloc — same slot/convention as the
              Championship block's careerStatRows, badges included. */}
          {raceStatRows && (
            <div className={styles.statBloc}>
              <div className={styles.statBlocRows}>
                {raceStatRows.map(row => (
                  <div key={row.key} className={`${styles.statBlocRow} ${row.highlighted ? styles.statBlocHighlight : ''}`}>
                    <span className={styles.statBlocLabel}>
                      {row.label}
                      {row.highlighted && <span className={styles.statBlocBadge}>{row.badge}</span>}
                    </span>
                    <span className={styles.statBlocValue}>
                      {row.sub && <span className={styles.statBlocSub}>{row.sub} </span>}
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.statBlocTitle}>Season stats since previous race</div>
            </div>
          )}

          {/* GENDER — hardcoded 'M' for now: F1 has no gender data model
              yet (no women's car racing ingested). Once that ingestion
              happens (likely its own competition/season gender field,
              same pattern as football/tennis), replace the literal below
              with the real signal — AthleteAvatar/getDefaultSilhouette
              need no change, they already branch on gender for any sport
              in GENDERED_SPORTS. */}
          <div className={`${styles.portraitWrap} ${styles.portraitWrapNarrow}`}>
            <AthleteAvatar src={getDriverPortraitPath(raceWinner?.driver_slug)} name={raceWinner?.driver_name} sport="f1" gender="M" className={`${styles.portrait} ${styles.portraitSquare}`} />
          </div>
        </div>

        <div className={styles.bottom}>
          {schedule && (
            <div className={styles.statBlock}>
              <span className={styles.statLabel}>Schedule</span>
              <span className={styles.statVal}>{schedule}</span>
            </div>
          )}
          {seasonMeta?.edition != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Edition</span>
                <span className={styles.statVal}>{seasonMeta.edition}</span>
              </div>
            </>
          )}
          {raceSession?.laps_total != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Laps</span>
                <span className={styles.statVal}>{raceSession.laps_total}</span>
              </div>
            </>
          )}
          {seasonMeta?.driversCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Drivers</span>
                <span className={styles.statVal}>{seasonMeta.driversCount}</span>
              </div>
            </>
          )}
          {seasonMeta?.teamsCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Teams</span>
                <span className={styles.statVal}>{seasonMeta.teamsCount}</span>
              </div>
            </>
          )}
          <div className={styles.bottomLogoWrap}>
            <img src={resolveImg(logoUrl)} alt="" className={styles.bottomLogo} onError={e => { e.target.style.display = 'none' }} />
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── EVENTBLOCK 2 — Teams standings (team-focused, per spec: this variant
// is used ONLY on the Teams standings sub-tab) ───
// Same redesign as F1ChampionshipBlock above (career stat bloc + Schedule/
// Edition/Drivers/Teams bottom bar, see that block's comments for the full
// rationale) — team-scoped instead of driver-scoped:
//   - No age/team-name-beneath lines — the entity itself IS the team, no
//     separate "team" to show underneath its own name.
//   - Logo, not portrait: entities.image_url is a legitimately admin-set
//     path here (e.g. Red Bull's /media/logos/clubs/motor-racing/
//     redbull-racing.png), unlike the driver block's entities.image_url
//     (which pointed at a scraped profile/ folder and was rejected) — kept
//     as the image source, just re-cropped with .logoSquare (contain, not
//     cover) since a wordmark logo shouldn't be cropped like a headshot.
export function F1TeamsChampionshipBlock({ seasonId, year, primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [champion, setChampion] = useState(null)
  const [seasonStatus, setSeasonStatus] = useState(null)
  const [seasonStartDate, setSeasonStartDate] = useState(null)
  const [seasonEndDate, setSeasonEndDate] = useState(null)
  const [edition, setEdition] = useState(null)
  const [driversCount, setDriversCount] = useState(null)
  const [teamsCount, setTeamsCount] = useState(null)
  const [racesCount, setRacesCount] = useState(null)
  const [career, setCareer] = useState(null)

  useEffect(() => {
    if (!seasonId) {
      setChampion(null); setSeasonStatus(null); setSeasonStartDate(null); setSeasonEndDate(null)
      setEdition(null); setDriversCount(null); setTeamsCount(null); setRacesCount(null)
      return
    }
    api.getF1Standings(seasonId, 'teams')
      .then(d => {
        setChampion(d?.standings?.[0] || null)
        setSeasonStatus(d?.season_status || null)
        setSeasonStartDate(d?.season_start_date || null)
        setSeasonEndDate(d?.season_end_date || null)
        setEdition(d?.edition ?? null)
        setDriversCount(d?.drivers_count ?? null)
        setTeamsCount(d?.teams_count ?? null)
        setRacesCount(d?.races_count ?? null)
      })
      .catch(() => {
        setChampion(null); setSeasonStatus(null); setSeasonStartDate(null); setSeasonEndDate(null)
        setEdition(null); setDriversCount(null); setTeamsCount(null); setRacesCount(null)
      })
  }, [seasonId])

  useEffect(() => {
    if (!champion?.entity_id || !year) { setCareer(null); return }
    api.getF1TeamCareer(champion.entity_id, year)
      .then(setCareer)
      .catch(() => setCareer(null))
  }, [champion?.entity_id, year])

  const isOngoing = seasonStatus === 'current'
  const schedule = fmtSeasonRange(seasonStartDate, seasonEndDate)

  const careerStatRows = (champion && career) ? (() => {
    const seasonWins   = champion.stats?.wins ?? 0
    const seasonPodiums = (champion.stats?.wins ?? 0) + (champion.stats?.p2 ?? 0) + (champion.stats?.p3 ?? 0)
    const seasonPoles  = champion.stats?.poles ?? 0
    const seasonSprints = champion.stats?.sprint_wins ?? 0
    return [
      { key: 'seasons', label: 'Seasons', value: career.seasons },
      {
        key: 'champion', label: 'Champion', value: career.championships,
        highlighted: !isOngoing, badge: '+1',
        sub: career.championships > 0
          ? (career.prev_title_year ? `${year - career.prev_title_year} Y. ago` : '1st title')
          : null,
      },
      { key: 'wins', label: 'Wins', value: career.wins, highlighted: seasonWins > 0, badge: `+${seasonWins}` },
      { key: 'podiums', label: 'Podiums', value: career.podiums, highlighted: seasonPodiums > 0, badge: `+${seasonPodiums}` },
      { key: 'poles', label: 'Poles', value: career.poles, highlighted: seasonPoles > 0, badge: `+${seasonPoles}` },
      { key: 'sprints', label: 'Sprints', value: career.sprint_wins, highlighted: seasonSprints > 0, badge: `+${seasonSprints}` },
      // Zero-suppression — see F1ChampionshipBlock's own careerStatRows.
    ].filter(row => Number(row.value) > 0)
  })() : null

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <div className={styles.info}>
              {/* "FORMULA 1 —" prefix dropped as redundant (same as the
                  driver Championship block); "CONSTRUCTORS" label removed
                  too per explicit design note — same empty spacing-only
                  categoryRow the Drivers/GP blocks already use. */}
              <div className={styles.eventCompetition}>Formula 1</div>
              <div className={styles.categoryRow} />
              <div className={styles.eventName}>
                <span className={styles.eventNameText}>World Championship {year}</span>
                <span className={styles.areaTag}>{areaTitleFor(seasonStatus)}</span>
                <StatusBadge status={statusBadgeStatus(seasonStatus)} />
              </div>
              {champion && (
                <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>
                  <Flag iso2={champion.country_iso2} name={champion.country_name} className={styles.winnerFlag} />
                  {champion.canonical_name}
                </div>
              )}
            </div>
          </div>

          {careerStatRows && (
            <div className={styles.statBloc}>
              <div className={styles.statBlocRows}>
                {careerStatRows.map(row => (
                  <div key={row.key} className={`${styles.statBlocRow} ${row.highlighted ? styles.statBlocHighlight : ''}`}>
                    <span className={styles.statBlocLabel}>
                      {row.label}
                      {row.highlighted && <span className={styles.statBlocBadge}>{row.badge || '+1'}</span>}
                    </span>
                    <span className={styles.statBlocValue}>
                      {row.sub && <span className={styles.statBlocSub}>{row.sub} </span>}
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles.statBlocTitle}>Career stats through {year}</div>
            </div>
          )}

          <div className={`${styles.portraitWrap} ${styles.portraitWrapNarrow}`}>
            <img
              src={resolveImg(champion?.logo_url) || DEFAULT_TEAM_LOGO}
              alt={champion?.canonical_name || ''}
              className={styles.logoSquare}
              onError={e => {
                if (e.target.src !== new URL(DEFAULT_TEAM_LOGO, window.location.href).href) {
                  e.target.src = DEFAULT_TEAM_LOGO
                }
              }}
            />
          </div>
        </div>

        <div className={styles.bottom}>
          {schedule && (
            <div className={styles.statBlock}>
              <span className={styles.statLabel}>Schedule</span>
              <span className={styles.statVal}>{schedule}</span>
            </div>
          )}
          {edition != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Edition</span>
                <span className={styles.statVal}>{edition}</span>
              </div>
            </>
          )}
          {driversCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Drivers</span>
                <span className={styles.statVal}>{driversCount}</span>
              </div>
            </>
          )}
          {teamsCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Teams</span>
                <span className={styles.statVal}>{teamsCount}</span>
              </div>
            </>
          )}
          {racesCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Races</span>
                <span className={styles.statVal}>{racesCount}</span>
              </div>
            </>
          )}
          <div className={styles.bottomLogoWrap}>
            <img src={resolveImg(logoUrl)} alt="" className={styles.bottomLogo} onError={e => { e.target.style.display = 'none' }} />
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}
