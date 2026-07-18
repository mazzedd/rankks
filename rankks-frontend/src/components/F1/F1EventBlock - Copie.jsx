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
// ONGOING badge, reusing the same status_ongoing class the GP block
// already uses for its "SPRINT WEEKEND" badge.
import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import styles from '../EventBlock/EventBlock.module.css'
import Flag from '../shared/Flag'
import { calcAge, fmtDate } from '../../utils/calcAge'
import { getDefaultSilhouette } from '../../utils/portraits'

const PAGE_NOTICE_TEXT = 'Event-time snapshot — stats reflect data as of the event date'
const F1_PRIMARY_FALLBACK   = '#15151E' // used only if competition.primary_color is null
const F1_SECONDARY_FALLBACK = '#E10600' // used only if competition.secondary_color is null
// Fallback ONLY — used if competition.logo_url comes back null from the
// getCompetition() fetch in F1ContentArea.jsx. Same fallback pattern as
// F1_PRIMARY_FALLBACK/F1_SECONDARY_FALLBACK above: real admin-set value
// always wins when present.
const F1_LOGO_FALLBACK = '/media/logos/competitions/motor-racing/international/formula-1.png'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

// fmtDate is now the shared one imported from utils/calcAge.js
// (dd.mm.yyyy — "09.04.2022"). Was previously its own local function
// here using en-GB short-month format ("9 Apr 2022"), which is what
// produced the "RACE DAY" stat-bar value seen in the app — that was
// never centralized despite calcAge already being shared correctly
// above it.

// Competition logo with graceful text fallback if the file is ever
// missing/moved — same onError pattern used everywhere else in the app.
function F1Logo({ styles, src }) {
  const [failed, setFailed] = useState(false)
  const resolved = src || F1_LOGO_FALLBACK
  return (
    <div className={styles.logoWrap}>
      {!failed
        ? <img src={resolved} alt="Formula 1" className={styles.logo} onError={() => setFailed(true)} />
        : <span className={styles.logoText}>F1</span>
      }
    </div>
  )
}

// Shared label/badge logic for the two Championship-style blocks below.
// 'current' → "Current Leader" + ONGOING badge (matches the football/
// tennis convention documented in the Ingestion Process doc: "Current
// season: ONGOING badge... 'Current league leader' label").
// 'past'    → "Champion" (season is decided).
// 'future'/unknown → "Winner" fallback (shouldn't normally render, since
// there'd be no standings rows yet, but kept as a safe default).
function areaTitleFor(seasonStatus) {
  if (seasonStatus === 'current') return 'Current Leader'
  if (seasonStatus === 'past') return 'Champion'
  return 'Winner'
}

// ─── EVENTBLOCK 1 — Championship (driver-focused, Eventblock 1 in spec) ───
export function F1ChampionshipBlock({ seasonId, year, primaryColor, secondaryColor, logoUrl }) {
  const [champion, setChampion] = useState(null)
  const [seasonStatus, setSeasonStatus] = useState(null)
  const [seasonEndDate, setSeasonEndDate] = useState(null)
  const primary   = primaryColor   || F1_PRIMARY_FALLBACK
  const secondary = secondaryColor || F1_SECONDARY_FALLBACK

  useEffect(() => {
    if (!seasonId) { setChampion(null); setSeasonStatus(null); setSeasonEndDate(null); return }
    api.getF1Standings(seasonId, 'drivers')
      .then(d => {
        setChampion(d?.standings?.[0] || null)
        setSeasonStatus(d?.season_status || null)
        setSeasonEndDate(d?.season_end_date || null)
      })
      .catch(() => { setChampion(null); setSeasonStatus(null); setSeasonEndDate(null) })
  }, [seasonId])

  const isOngoing = seasonStatus === 'current'
  // Age as of the season's last race (season_end_date) — same reference-date
  // convention as F1DriversTemplate, which uses the identical two fields
  // from this same standings response.
  const age = champion ? calcAge(champion.birth_date, seasonEndDate) : null

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <F1Logo styles={styles} src={resolveImg(logoUrl)} />

            <div className={styles.info}>
              <div className={styles.categoryRow}>
                <span className={styles.category}>FORMULA 1</span>
                {isOngoing && (
                  <span className={`${styles.statusBadge} ${styles.status_ongoing}`}>ONGOING</span>
                )}
              </div>
              <div className={styles.eventName}>World Championship {year}</div>
              <div className={styles.areaTitle}>{areaTitleFor(seasonStatus)}</div>
              {champion && (
                <div className={styles.winnerName}>
                  {champion.canonical_name}
                  {champion.stats?.team_name && (
                    <span className={styles.scorerNames}> — {champion.stats.team_name}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={styles.portraitWrap}>
            {champion?.logo_url
              ? <img src={resolveImg(champion.logo_url)} alt={champion.canonical_name} className={styles.clubLogo} onError={e => e.target.style.display = 'none'} />
              : <Flag iso2={champion?.country_iso2} name={champion?.canonical_name} className={styles.clubLogo} />
            }
          </div>
        </div>

        <div className={styles.bottom} style={{ background: primary }}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Season</span>
            <span className={styles.statVal}>{year}</span>
          </div>
          {champion && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>{isOngoing ? 'Points' : 'Champion Points'}</span>
                <span className={styles.statVal}>{champion.stats?.points ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Wins</span>
                <span className={styles.statVal}>{champion.stats?.wins ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>2nd</span>
                <span className={styles.statVal}>{champion.stats?.p2 ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>3rd</span>
                <span className={styles.statVal}>{champion.stats?.p3 ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Pole</span>
                <span className={styles.statVal}>{champion.stats?.poles ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Age</span>
                <span className={styles.statVal}>{age ?? '—'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.pageNotice} style={{ background: secondary }}>
        <span className={styles.pageNoticeText}>{PAGE_NOTICE_TEXT}</span>
      </div>
    </div>
  )
}

// ─── GP BLOCK (also driver-focused / Eventblock 1 styling) ───
// WINNER — always the main Race session's P1 result (driver + team),
// regardless of which Line B session tab (Race Results, Qualifying,
// Practice, Sprint...) is currently active. Sprint weekends still show
// the Race winner, never the Sprint winner — per product decision, the
// winner shown here is tied to the race itself, not to whichever
// sub-tab the user happens to be viewing.
//
// WINS / 2ND / 3RD / POLE — the race winner's season-to-date podium and
// pole counts, counting every Race/Qualifying session up to and
// including THIS round (gp.round_order), matching the "Event-time
// snapshot — stats reflect data as of the event date" notice already
// present in the block. This replaced an earlier version showing
// single-race driver names for 2nd/3rd/Pole — per product decision, the
// stat bar reads like the Championship/Teams standings blocks (counts,
// not names), including Pole on the same cumulative basis.
export function F1GPBlock({ gp, sessions, year, primaryColor, secondaryColor, logoUrl }) {
  const primary   = primaryColor   || F1_PRIMARY_FALLBACK
  const secondary = secondaryColor || F1_SECONDARY_FALLBACK
  const [raceResults, setRaceResults]         = useState(null)
  const [winnerSeasonStats, setWinnerSeasonStats] = useState(null)

  const raceSession  = sessions?.find(s => s.session_type === 'Race')
  const isSprintWeekend = sessions?.some(s => s.session_type === 'Sprint')
  const rawSessionDate = raceSession?.session_date || sessions?.[0]?.session_date
  const schedule = rawSessionDate ? fmtDate(rawSessionDate) : null

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
  const winnerAge = raceWinner ? calcAge(raceWinner.birth_date, raceSession?.session_date) : null

  useEffect(() => {
    if (!raceWinner?.driver_id || !gp?.season_id || !gp?.round_order) {
      setWinnerSeasonStats(null)
      return
    }
    api.getF1DriverRaceStats(raceWinner.driver_id, gp.season_id, gp.round_order)
      .then(setWinnerSeasonStats)
      .catch(() => setWinnerSeasonStats(null))
  }, [raceWinner?.driver_id, gp?.season_id, gp?.round_order])

  if (!gp) return null

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <F1Logo styles={styles} src={resolveImg(logoUrl)} />

            <div className={styles.info}>
              <div className={styles.categoryRow}>
                <span className={styles.category}>FORMULA 1 · {year}</span>
                {isSprintWeekend && (
                  <span className={`${styles.statusBadge} ${styles.status_ongoing}`}>SPRINT WEEKEND</span>
                )}
              </div>
              <div className={styles.eventName}>{gp.name}</div>
              {/* circuit_name is always null — confirmed absent from source, see F1 master spec open items */}
              {raceWinner && (
                <>
                  <div className={styles.areaTitle}>Winner</div>
                  <div className={styles.winnerName}>
                    {raceWinner.driver_name}
                    {raceWinner.team_name && (
                      <span className={styles.scorerNames}> — {raceWinner.team_name}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className={styles.portraitWrap}>
            {raceWinner?.driver_image
              ? <img
                  src={resolveImg(raceWinner.driver_image)}
                  alt={raceWinner.driver_name}
                  className={styles.clubLogo}
                  onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette('f1', 'M') }}
                />
              // Previously <Flag iso2={null} .../> here, which always
              // renders nothing (Flag returns null for a falsy iso2) —
              // that was the actual cause of the blank box for drivers
              // with no driver_image on file at all (e.g. older seasons
              // like Jenson Button 2009), as opposed to the onError path
              // above which only covers a broken/404 image URL.
              //
              // GENDER — hardcoded 'M' for now: F1 has no gender data
              // model yet (no women's car racing ingested). Once that
              // ingestion happens (likely its own competition/season
              // gender field, same pattern as football/tennis), replace
              // this literal with the real signal — getDefaultSilhouette
              // itself needs no change, it already branches on
              // activeGender for any sport in GENDERED_SPORTS.
              : <img src={getDefaultSilhouette('f1', 'M')} alt={raceWinner?.driver_name || gp.name} className={styles.clubLogo} />
            }
          </div>
        </div>

        <div className={styles.bottom} style={{ background: primary }}>
          {schedule && (
            <div className={styles.statBlock}>
              <span className={styles.statLabel}>Race Day</span>
              <span className={styles.statVal}>{schedule}</span>
            </div>
          )}
          {raceSession?.laps_total && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Laps</span>
                <span className={styles.statVal}>{raceSession.laps_total}</span>
              </div>
            </>
          )}
          {winnerSeasonStats && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Wins</span>
                <span className={styles.statVal}>{winnerSeasonStats.wins}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>2nd</span>
                <span className={styles.statVal}>{winnerSeasonStats.p2}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>3rd</span>
                <span className={styles.statVal}>{winnerSeasonStats.p3}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Pole</span>
                <span className={styles.statVal}>{winnerSeasonStats.poles}</span>
              </div>
            </>
          )}
          {raceWinner && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Age</span>
                <span className={styles.statVal}>{winnerAge ?? '—'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.pageNotice} style={{ background: secondary }}>
        <span className={styles.pageNoticeText}>{PAGE_NOTICE_TEXT}</span>
      </div>
    </div>
  )
}

// ─── EVENTBLOCK 2 — Teams standings (team-focused, per spec: this variant
// is used ONLY on the Teams standings sub-tab) ───
export function F1TeamsChampionshipBlock({ seasonId, year, primaryColor, secondaryColor, logoUrl }) {
  const [champion, setChampion] = useState(null)
  const [seasonStatus, setSeasonStatus] = useState(null)
  const primary   = primaryColor   || F1_PRIMARY_FALLBACK
  const secondary = secondaryColor || F1_SECONDARY_FALLBACK

  useEffect(() => {
    if (!seasonId) { setChampion(null); setSeasonStatus(null); return }
    api.getF1Standings(seasonId, 'teams')
      .then(d => {
        setChampion(d?.standings?.[0] || null)
        setSeasonStatus(d?.season_status || null)
      })
      .catch(() => { setChampion(null); setSeasonStatus(null) })
  }, [seasonId])

  const isOngoing = seasonStatus === 'current'

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <F1Logo styles={styles} src={resolveImg(logoUrl)} />

            <div className={styles.info}>
              <div className={styles.categoryRow}>
                <span className={styles.category}>FORMULA 1 — CONSTRUCTORS</span>
                {isOngoing && (
                  <span className={`${styles.statusBadge} ${styles.status_ongoing}`}>ONGOING</span>
                )}
              </div>
              <div className={styles.eventName}>World Championship {year}</div>
              <div className={styles.areaTitle}>{areaTitleFor(seasonStatus)}</div>
              {champion && (
                <div className={styles.winnerName}>
                  {champion.canonical_name}
                </div>
              )}
            </div>
          </div>

          <div className={styles.portraitWrap}>
            {champion?.logo_url
              ? <img src={resolveImg(champion.logo_url)} alt={champion.canonical_name} className={styles.clubLogo} onError={e => e.target.style.display = 'none'} />
              : <Flag iso2={champion?.country_iso2} name={champion?.country_name} className={styles.clubLogo} />
            }
          </div>
        </div>

        <div className={styles.bottom} style={{ background: primary }}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Season</span>
            <span className={styles.statVal}>{year}</span>
          </div>
          {champion && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>{isOngoing ? 'Points' : 'Champion Points'}</span>
                <span className={styles.statVal}>{champion.stats?.points ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Wins</span>
                <span className={styles.statVal}>{champion.stats?.wins ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>2nd</span>
                <span className={styles.statVal}>{champion.stats?.p2 ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>3rd</span>
                <span className={styles.statVal}>{champion.stats?.p3 ?? '—'}</span>
              </div>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Pole</span>
                <span className={styles.statVal}>{champion.stats?.poles ?? '—'}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.pageNotice} style={{ background: secondary }}>
        <span className={styles.pageNoticeText}>{PAGE_NOTICE_TEXT}</span>
      </div>
    </div>
  )
}
