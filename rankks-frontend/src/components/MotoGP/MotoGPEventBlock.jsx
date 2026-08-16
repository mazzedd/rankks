// components/MotoGP/MotoGPEventBlock.jsx
//
// MotoGP counterpart to F1EventBlock.jsx — same EventBlock.module.css,
// same StatusBadge/AthleteAvatar/Flag building blocks, same "career stat
// bloc + Schedule/Edition/Riders/Teams bottom bar" shape. Three blocks:
//   - MotoGPChampionshipBlock (rider-focused)  — Final Standings > Riders
//   - MotoGPTeamsBlock (team/constructor-focused) — Final Standings > Teams/Constructors
//   - MotoGPGPBlock (race-focused) — any GP page
//
// ONE STRUCTURAL DIFFERENCE FROM F1 — a single competition covers three
// classes (MotoGP/Moto2/Moto3), so every block here shows the active
// category as a real, non-redundant label in categoryRow (F1 drops that
// row entirely since there's only ever one class).
//
// FIELD SET — motogp_rider_standings only stores {wins, podiums,
// sprint_wins, sprint_podiums}, no "poles" column (unlike F1's driver
// standings) and no p2/p3 split (podiums is already merged). Every stat
// bloc below uses exactly this 4-metric set, never F1's Wins/Podiums/
// Poles/Sprints shape.
//
// TEAMS/CONSTRUCTORS — motogp_team_standings/motogp_constructor_standings
// are text-only (team_name/constructor_name strings, no entity_id, no
// logo, no wins/podiums breakdown — see onboarding-motogp.md). No career
// stat bloc or portrait is possible here, unlike F1TeamsChampionshipBlock
// (which resolves a real team entity_id) — MotoGPTeamsBlock is
// deliberately a leaner variant, same idea as F1AllTimeBlock being a
// leaner variant when the underlying data doesn't support the richer one.
//
// PORTRAITS — now resolved from the real entity image (champion.logo_url /
// raceWinner.rider_image, both already selected by their respective backend
// routes) via resolveImg(), same as every other rider avatar in this file.
// Previously hardcoded to src={null} pending portrait uploads (see
// onboarding-motogp.md); a batch of 9 entities across F1/MotoGP/tennis had
// image_url values missing their leading `/media/` prefix (a data-entry
// bug, not a code bug — resolveImg() double-prefixed them into a broken
// `/media/media/...` URL), fixed directly in the entities table. Falls
// through to AthleteAvatar's shared default silhouette when an entity has
// no image yet — the shared /media/default/portrait-*.png assets used
// across every sport (see utils/portraits.js).
import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import styles from '../EventBlock/EventBlock.module.css'
import { StatusBadge } from '../EventBlock/EventBlock'
import Flag from '../shared/Flag'
import AthleteAvatar from '../shared/AthleteAvatar'
import { PillHomeIcon, PillBarsIcon, PillPlayIcon } from '../shared/PillIcons'
import { calcAge, fmtWeekendRange, fmtDate } from '../../utils/calcAge'
import { shortGpLabel } from '../../utils/gpLabel'

const MOTOGP_LOGO_FALLBACK = '/media/logos/competitions/motor-racing/international/motogp.png'

const CATEGORY_LABELS = { motogp: 'MOTO GP', moto2: 'MOTO 2', moto3: 'MOTO 3' }

// Pre-2002/2010/2012 each class raced under its engine-displacement name,
// not today's brand — Grand Prix motorcycle racing's real rebranding
// history, not admin-editable per-competition data (unlike tennis's
// event_category_eras table), so a small fixed lookup here is the right
// fit rather than a DB table. Shown as "MOTO GP (500 cm3)" for a viewed
// year still in the old era, same "current (former)" parenthetical shape
// EventBlock.jsx's own categoryEra rendering uses for tennis tiers.
const CATEGORY_ERAS = {
  motogp: { since: 2002, formerName: '500 cm3' },
  moto2:  { since: 2010, formerName: '250 cm3' },
  moto3:  { since: 2012, formerName: '125 cm3' },
}
function categoryEraName(category, year) {
  const era = CATEGORY_ERAS[category]
  if (!era || year == null) return null
  return year < era.since ? era.formerName : null
}

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const DEFAULT_TEAM_LOGO = '/media/default/club.png' // shared default across every sport, not a per-sport asset

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

function areaTitleFor(seasonStatus) {
  return seasonStatus === 'current' ? 'Current Leader' : 'Champion'
}
function statusBadgeStatus(seasonStatus) {
  return seasonStatus === 'current' ? 'ongoing' : seasonStatus
}

// ─── RIDER CHAMPIONSHIP BLOCK — Final Standings > Riders ───
export function MotoGPChampionshipBlock({ seasonId, year, category, primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [champion, setChampion] = useState(null)
  const [seasonStatus, setSeasonStatus] = useState(null)
  const [seasonStartDate, setSeasonStartDate] = useState(null)
  const [seasonEndDate, setSeasonEndDate] = useState(null)
  const [edition, setEdition] = useState(null)
  const [ridersCount, setRidersCount] = useState(null)
  const [teamsCount, setTeamsCount] = useState(null)
  const [racesCount, setRacesCount] = useState(null)
  const [career, setCareer] = useState(null)

  useEffect(() => {
    if (!seasonId) {
      setChampion(null); setSeasonStatus(null); setSeasonStartDate(null); setSeasonEndDate(null)
      setEdition(null); setRidersCount(null); setTeamsCount(null); setRacesCount(null)
      return
    }
    api.getMotoGPStandings(seasonId, 'riders')
      .then(d => {
        setChampion(d?.standings?.[0] || null)
        setSeasonStatus(d?.season_status || null)
        setSeasonStartDate(d?.season_start_date || null)
        setSeasonEndDate(d?.season_end_date || null)
        setEdition(d?.edition ?? null)
        setRidersCount(d?.riders_count ?? null)
        setTeamsCount(d?.teams_count ?? null)
        setRacesCount(d?.races_count ?? null)
      })
      .catch(() => {
        setChampion(null); setSeasonStatus(null); setSeasonStartDate(null); setSeasonEndDate(null)
        setEdition(null); setRidersCount(null); setTeamsCount(null); setRacesCount(null)
      })
  }, [seasonId])

  useEffect(() => {
    if (!champion?.entity_id || !year) { setCareer(null); return }
    api.getMotoGPRiderCareer(champion.entity_id, category, year)
      .then(setCareer)
      .catch(() => setCareer(null))
  }, [champion?.entity_id, year, category])

  const isOngoing = seasonStatus === 'current'
  const schedule = fmtSeasonRange(seasonStartDate, seasonEndDate)
  const age = champion ? calcAge(champion.birth_date, seasonEndDate, champion.death_date) : null

  const careerStatRows = (champion && career) ? (() => {
    const seasonWins           = champion.stats?.wins ?? 0
    // A win IS a podium (P1 is top-3) — podiums must include wins, not
    // just a separate stored total, same convention F1/MotoGPTeamsBlock
    // already use for this exact derivation.
    const seasonPodiums        = seasonWins + (champion.stats?.p2 ?? 0) + (champion.stats?.p3 ?? 0)
    const seasonSprintWins     = champion.stats?.sprint_wins ?? 0
    const seasonSprintPodiums  = champion.stats?.sprint_podiums ?? 0
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
      { key: 'sprint_wins', label: 'Sprint Wins', value: career.sprint_wins, highlighted: seasonSprintWins > 0, badge: `+${seasonSprintWins}` },
      { key: 'sprint_podiums', label: 'Sprint Podiums', value: career.sprint_podiums, highlighted: seasonSprintPodiums > 0, badge: `+${seasonSprintPodiums}` },
      // Zero-suppression — a stat that's genuinely 0 for this rider's whole
      // career (e.g. Sprint Wins for anyone whose career predates 2023, or
      // a rider who's never won) is noise, not information, in this bloc.
    ].filter(row => Number(row.value) > 0)
  })() : null

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <div className={styles.info}>
              <div className={styles.eventCompetition}>MotoGP</div>
              <div className={styles.categoryRow}>
                {(() => {
                  const eraName = categoryEraName(category, year)
                  return (
                    <span className={styles.category}>
                      {CATEGORY_LABELS[category] || category.toUpperCase()}
                      {eraName && ` (${eraName})`}
                    </span>
                  )
                })()}
              </div>
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
                      {champion.stats?.constructor_name && ` (${champion.stats.constructor_name})`}
                    </div>
                  )}
                </>
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
            <AthleteAvatar src={resolveImg(champion?.logo_url)} name={champion?.canonical_name} sport="motorcycle" gender="M" className={`${styles.portrait} ${styles.portraitSquare}`} />
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
          {ridersCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Riders</span>
                <span className={styles.statVal}>{ridersCount}</span>
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

// ─── TEAMS / CONSTRUCTORS BLOCK — Final Standings > Teams or Constructors ───
// Deliberately leaner than the Rider block above — see file header. `type`
// is 'teams' | 'constructors', reused for both sub-tabs rather than two
// near-identical components.
export function MotoGPTeamsBlock({ seasonId, year, category, type, primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [leader, setLeader] = useState(null)
  const [seasonStatus, setSeasonStatus] = useState(null)
  const [seasonStartDate, setSeasonStartDate] = useState(null)
  const [seasonEndDate, setSeasonEndDate] = useState(null)
  const [edition, setEdition] = useState(null)
  const [ridersCount, setRidersCount] = useState(null)
  const [teamsCount, setTeamsCount] = useState(null)
  const [racesCount, setRacesCount] = useState(null)
  const [career, setCareer] = useState(null)
  const nameKey = type === 'teams' ? 'team_name' : 'constructor_name'

  useEffect(() => {
    if (!seasonId) {
      setLeader(null); setSeasonStatus(null); setSeasonStartDate(null); setSeasonEndDate(null)
      setEdition(null); setRidersCount(null); setTeamsCount(null); setRacesCount(null)
      return
    }
    api.getMotoGPStandings(seasonId, type)
      .then(d => {
        setLeader(d?.standings?.[0] || null)
        setSeasonStatus(d?.season_status || null)
        setSeasonStartDate(d?.season_start_date || null)
        setSeasonEndDate(d?.season_end_date || null)
        setEdition(d?.edition ?? null)
        setRidersCount(d?.riders_count ?? null)
        setTeamsCount(d?.teams_count ?? null)
        setRacesCount(d?.races_count ?? null)
      })
      .catch(() => {
        setLeader(null); setSeasonStatus(null); setSeasonStartDate(null); setSeasonEndDate(null)
        setEdition(null); setRidersCount(null); setTeamsCount(null); setRacesCount(null)
      })
  }, [seasonId, type])

  // Career totals, TEAMS tab only — same method as F1TeamsChampionshipBlock
  // (/team-career), ported via /motogp/team-career. Constructors has no
  // equivalent route (see that route's own comment for why) and stays a
  // plain season-only view.
  useEffect(() => {
    if (type !== 'teams' || !leader?.team_name || !year || !category) { setCareer(null); return }
    api.getMotoGPTeamCareer(leader.team_name, category, year)
      .then(setCareer)
      .catch(() => setCareer(null))
  }, [type, leader?.team_name, year, category])

  const isOngoing = seasonStatus === 'current'
  const schedule = fmtSeasonRange(seasonStartDate, seasonEndDate)
  const logo = resolveImg(leader?.logo_url)

  // TEAMS (career + this-season badge, same method as
  // F1TeamsChampionshipBlock/MotoGPChampionshipBlock) — value is the
  // CAREER total, badge is this season's own contribution to it. A rider's
  // individual result (e.g. a pole) already rolls up into these team
  // totals at the source (motogp_session_results.team_name is per-result,
  // not per-rider), so no separate "combine tied riders" step is needed.
  const careerStatRows = (type === 'teams' && leader && career) ? (() => {
    const seasonWins          = leader.stats?.wins ?? 0
    const seasonPodiums       = (leader.stats?.wins ?? 0) + (leader.stats?.p2 ?? 0) + (leader.stats?.p3 ?? 0)
    const seasonPoles         = leader.stats?.poles ?? 0
    const seasonSprintWins    = leader.stats?.sprint_wins ?? 0
    const seasonSprintPodiums = (leader.stats?.sprint_wins ?? 0) + (leader.stats?.sprint_p2 ?? 0) + (leader.stats?.sprint_p3 ?? 0)
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
      { key: 'sprint_wins', label: 'Sprint Wins', value: career.sprint_wins, highlighted: seasonSprintWins > 0, badge: `+${seasonSprintWins}` },
      { key: 'sprint_podiums', label: 'Sprint Podiums', value: career.sprint_podiums, highlighted: seasonSprintPodiums > 0, badge: `+${seasonSprintPodiums}` },
      // Zero-suppression — see MotoGPChampionshipBlock's own careerStatRows.
    ].filter(row => Number(row.value) > 0)
  })() : null

  // CONSTRUCTORS — unchanged plain season totals, no career/badge (no
  // career route for this tab — see /motogp/team-career's own comment).
  const seasonStatRows = (type !== 'teams' && leader) ? [
    { key: 'wins', label: 'Wins', value: leader.stats?.wins ?? 0 },
    { key: 'podiums', label: 'Podiums', value: (leader.stats?.wins ?? 0) + (leader.stats?.p2 ?? 0) + (leader.stats?.p3 ?? 0) },
    { key: 'poles', label: 'Poles', value: leader.stats?.poles ?? 0 },
    { key: 'sprint_wins', label: 'Sprint Wins', value: leader.stats?.sprint_wins ?? 0 },
    { key: 'sprint_podiums', label: 'Sprint Podiums', value: (leader.stats?.sprint_wins ?? 0) + (leader.stats?.sprint_p2 ?? 0) + (leader.stats?.sprint_p3 ?? 0) },
  ].filter(row => Number(row.value) > 0) : null

  const statRows = careerStatRows || seasonStatRows
  const statBlocTitle = careerStatRows ? `Career stats through ${year}` : `Season stats through ${year}`

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <div className={styles.info}>
              <div className={styles.eventCompetition}>MotoGP</div>
              <div className={styles.categoryRow}>
                {(() => {
                  const eraName = categoryEraName(category, year)
                  return (
                    <span className={styles.category}>
                      {CATEGORY_LABELS[category] || category.toUpperCase()}
                      {eraName && ` (${eraName})`}
                    </span>
                  )
                })()}
              </div>
              <div className={styles.eventName}>
                <span className={styles.eventNameText}>World Championship {year}</span>
                <span className={styles.areaTag}>{areaTitleFor(seasonStatus)}</span>
                <StatusBadge status={statusBadgeStatus(seasonStatus)} />
              </div>
              {leader && (
                <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>
                  <Flag iso2={leader.country_iso2} name={leader.country_name} className={styles.winnerFlag} />
                  {leader[nameKey]}
                </div>
              )}
              {leader?.points != null && (
                <div className={styles.eventDetails}>{leader.points} points</div>
              )}
            </div>
          </div>

          {statRows && (
            <div className={styles.statBloc}>
              <div className={styles.statBlocRows}>
                {statRows.map(row => (
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
              <div className={styles.statBlocTitle}>{statBlocTitle}</div>
            </div>
          )}

          <div className={`${styles.portraitWrap} ${styles.portraitWrapNarrow}`}>
            <img
              src={logo || DEFAULT_TEAM_LOGO}
              alt={leader?.[nameKey] || ''}
              className={`${styles.portrait} ${styles.logoSquare}`}
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
          {ridersCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Riders</span>
                <span className={styles.statVal}>{ridersCount}</span>
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

// ─── ALL-TIME BLOCK — straight copy of F1AllTimeBlock ───
export function MotoGPAllTimeBlock({ primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const resolvedLogo = resolveImg(logoUrl) || MOTOGP_LOGO_FALLBACK
  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>MotoGP<PillBarsIcon /></span>
          <span className={styles.eventName}>
            Aggregated statistics across the selected MotoGP seasons
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoFailed
              ? <img src={resolvedLogo} alt="MotoGP" className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>MotoGP</span>
            }
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── ICONIC MOMENTS BLOCK — same compact banner as MotoGPAllTimeBlock,
// season-specific text instead of the All-Time one's career-wide framing.
// Text follows F1IconicMomentsBlock's exact "Watch Center" wording (no
// trailing period) — the tab itself is still labeled "Iconic Moments" in
// Line A/the breadcrumb, same as F1, only this banner's own text changed.
export function MotoGPIconicMomentsBlock({ year, primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const resolvedLogo = resolveImg(logoUrl) || MOTOGP_LOGO_FALLBACK
  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>MotoGP<PillPlayIcon /></span>
          <span className={styles.eventName}>
            Watch Center of the {year} MotoGP season
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoFailed
              ? <img src={resolvedLogo} alt="MotoGP" className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>MotoGP</span>
            }
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── HOME BLOCK — same compact banner as MotoGPAllTimeBlock, Home's own
// framing instead of the All-Time one's career-wide text. Straight copy
// of F1HomeBlock.
export function MotoGPHomeBlock({ primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const resolvedLogo = resolveImg(logoUrl) || MOTOGP_LOGO_FALLBACK
  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.bottom}>
          <span className={styles.eventCompetition}>MotoGP<PillHomeIcon /></span>
          <span className={styles.eventName}>
            Home of MotoGP
          </span>
          <div className={styles.bottomLogoWrap}>
            {!logoFailed
              ? <img src={resolvedLogo} alt="MotoGP" className={styles.bottomLogo} onError={() => setLogoFailed(true)} />
              : <span className={styles.allTimeLogoText}>MotoGP</span>
            }
          </div>
          {pageTitle && <div className={`page-title ${styles.breadcrumbLine}`}>{pageTitle}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── GP BLOCK — any Grand Prix page ───
// WINNER — always the main Race ('RAC') session's P1 result, regardless of
// which Line B session tab is active, same convention F1GPBlock uses.
export function MotoGPGPBlock({ gp, sessions, year, category, status, primaryColor, secondaryColor, logoUrl, pageTitle = null }) {
  const [raceResults, setRaceResults]           = useState(null)
  const [winnerRoundStats, setWinnerRoundStats] = useState(null)
  const [winnerPrevStats, setWinnerPrevStats]   = useState(null)
  const [seasonMeta, setSeasonMeta]             = useState(null)
  const [winnerCareer, setWinnerCareer]         = useState(null)

  const raceSession = sessions?.find(s => s.session_type === 'RAC')
  const rawSessionDate = raceSession?.session_date || sessions?.[0]?.session_date
  const schedule = rawSessionDate ? fmtWeekendRange(rawSessionDate) : null
  // Past/Ongoing/Next/Upcoming — resolved by the parent (MotoGPContentArea),
  // which ranks every GP in the season against each other — see
  // F1GPBlock's identical comment for why this needs the full list rather
  // than this one GP's date in isolation.
  const gpStatus = status || getGpStatus(rawSessionDate)

  useEffect(() => {
    if (!raceSession?.id) { setRaceResults(null); return }
    api.getMotoGPSessionResults(raceSession.id)
      .then(d => setRaceResults(d?.results || null))
      .catch(() => setRaceResults(null))
  }, [raceSession?.id])

  const raceWinner = raceResults?.find(r => String(r.position) === '1') || null
  const winnerAge = raceWinner ? calcAge(raceWinner.birth_date, raceSession?.session_date, raceWinner.death_date) : null

  useEffect(() => {
    if (!raceWinner?.rider_id || !year || !category || !gp?.round_order) {
      setWinnerRoundStats(null); setWinnerPrevStats(null)
      return
    }
    api.getMotoGPRiderRoundStats(raceWinner.rider_id, year, category, gp.round_order)
      .then(setWinnerRoundStats)
      .catch(() => setWinnerRoundStats(null))
    api.getMotoGPRiderRoundStats(raceWinner.rider_id, year, category, gp.round_order - 1)
      .then(setWinnerPrevStats)
      .catch(() => setWinnerPrevStats(null))
  }, [raceWinner?.rider_id, year, category, gp?.round_order])

  useEffect(() => {
    if (!raceWinner?.rider_id || !year || !category) { setWinnerCareer(null); return }
    api.getMotoGPRiderCareer(raceWinner.rider_id, category, year)
      .then(setWinnerCareer)
      .catch(() => setWinnerCareer(null))
  }, [raceWinner?.rider_id, year, category])

  useEffect(() => {
    if (!gp?.season_id) { setSeasonMeta(null); return }
    api.getMotoGPStandings(gp.season_id, 'riders')
      .then(d => setSeasonMeta({ edition: d?.edition ?? null, ridersCount: d?.riders_count ?? null, teamsCount: d?.teams_count ?? null }))
      .catch(() => setSeasonMeta(null))
  }, [gp?.season_id])

  if (!gp) return null

  const raceStatRows = (winnerRoundStats && winnerPrevStats && winnerCareer) ? (() => {
    const dWins           = winnerRoundStats.wins - winnerPrevStats.wins
    const dPodiums        = winnerRoundStats.podiums - winnerPrevStats.podiums
    const dSprintWins     = winnerRoundStats.sprint_wins - winnerPrevStats.sprint_wins
    const dSprintPodiums  = winnerRoundStats.sprint_podiums - winnerPrevStats.sprint_podiums
    return [
      { key: 'seasons', label: 'Seasons', value: winnerCareer.seasons },
      {
        key: 'champion', label: 'Champion', value: winnerCareer.championships,
        sub: winnerCareer.championships > 0
          ? (winnerCareer.prev_title_year ? `${year - winnerCareer.prev_title_year} Y. ago` : '1st title')
          : null,
      },
      { key: 'wins', label: 'Wins', value: winnerRoundStats.wins, highlighted: dWins > 0, badge: `+${dWins}` },
      { key: 'podiums', label: 'Podiums', value: winnerRoundStats.podiums, highlighted: dPodiums > 0, badge: `+${dPodiums}` },
      { key: 'sprint_wins', label: 'Sprint Wins', value: winnerRoundStats.sprint_wins, highlighted: dSprintWins > 0, badge: `+${dSprintWins}` },
      { key: 'sprint_podiums', label: 'Sprint Podiums', value: winnerRoundStats.sprint_podiums, highlighted: dSprintPodiums > 0, badge: `+${dSprintPodiums}` },
      // Zero-suppression — see MotoGPChampionshipBlock's own careerStatRows.
    ].filter(row => Number(row.value) > 0)
  })() : null

  return (
    <div className={styles.wrapper}>
      <div className={styles.banner}>
        <div className={styles.inner}>
          <div className={styles.left}>
            <div className={styles.info}>
              <div className={styles.eventCompetition}>MotoGP</div>
              <div className={styles.categoryRow}>
                {(() => {
                  const eraName = categoryEraName(category, year)
                  return (
                    <span className={styles.category}>
                      {CATEGORY_LABELS[category] || category.toUpperCase()}
                      {eraName && ` (${eraName})`}
                    </span>
                  )
                })()}
              </div>
              <div className={styles.eventName}>
                <span className={styles.eventNameText}>{shortGpLabel(gp.name)} {year}</span>
                {raceWinner && <span className={styles.areaTag}>Winner</span>}
                <StatusBadge status={gpStatus} />
              </div>
              {raceWinner && (
                <>
                  <div className={`${styles.eventNameRow} ${styles.eventWinner}`}>
                    <Flag iso2={raceWinner.rider_country_iso2} name={raceWinner.rider_country_name} className={styles.winnerFlag} />
                    {raceWinner.rider_name}
                  </div>
                  {(winnerAge != null || raceWinner.team_name) && (
                    <div className={styles.eventDetails}>
                      {winnerAge != null && `${winnerAge} years`}
                      {winnerAge != null && raceWinner.team_name && ' | '}
                      {raceWinner.team_name}
                      {raceWinner.constructor_name && ` (${raceWinner.constructor_name})`}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

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

          <div className={`${styles.portraitWrap} ${styles.portraitWrapNarrow}`}>
            <AthleteAvatar src={resolveImg(raceWinner?.rider_image)} name={raceWinner?.rider_name} sport="motorcycle" gender="M" className={`${styles.portrait} ${styles.portraitSquare}`} />
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
          {seasonMeta?.ridersCount != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Riders</span>
                <span className={styles.statVal}>{seasonMeta.ridersCount}</span>
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
