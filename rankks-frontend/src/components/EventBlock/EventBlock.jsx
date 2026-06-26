import { useEffect, useState } from 'react'
import styles from './EventBlock.module.css'
import { api } from '../../services/api'
import useAppStore from '../../store/useAppStore'

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

function getDefaultSilhouette(activeGender, sport) {
  const folder = activeGender === 'F' ? 'female' : 'male'
  if (sport === 'football') {
    return `/media/default/football/portrait-${folder}.png`
  }
  // Tennis default portrait
  return `/media/default/tennis/portrait-${folder}.png`
}

function isVideoPath(path) {
  if (!path) return false
  return path.toLowerCase().endsWith('.mp4') || path.toLowerCase().endsWith('.webm')
}

function getSurfaceLabel(surface) {
  const map = { grass: 'Grass', clay: 'Clay', hard: 'Hard' }
  return map[surface?.toLowerCase()] || surface || ''
}

// ── Page notice text — edit here to update sitewide ──────────────────────────
const PAGE_NOTICE_TEXT = 'Event-time snapshot — stats reflect data as of the event date'

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status, isLive = false }) {
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
export default function EventBlock({ season, competition, naming, eventNaming, activeYear, activeGender, activeTab, leadingPlayers = [], seasonStats = null, hasVideosTab = false }) {

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
  useEffect(() => {
    if (!_winnerId || !competition?.id || !dbYear) { setHistory(null); return }
    api.getEntityHistory(_winnerId, competition.id, dbYear)
      .then(d => setHistory(d))
      .catch(() => setHistory(null))
  }, [_winnerId, competition?.id, dbYear])

  const s = activeGender
    ? season?.seasons?.find(se => se.gender === activeGender && (se.sub_edition || 1) === activeSubEdition)
      ?? season?.seasons?.find(se => se.gender === activeGender)
    : season?.seasons?.[0]

  if (!s) return null

  const seasonResult = season?.winners?.find(w => w != null && w.season_id === s?.id) ?? null
  const winner  = seasonResult?.winner ?? null
  const loser   = seasonResult?.loser ?? null
  const sets    = seasonResult?.sets ?? []
  const walkover = seasonResult?.walkover ?? false
  const status = getStatus(s)
  const isPast = status === 'past'

  // Colours: football uses winner club colors, tennis uses competition colors
  const isFootball = competition?.sport_slug === 'football'
  const primary   = (isFootball && winner?.club_primary_color)
    ? winner.club_primary_color
    : competition?.primary_color   || '#1a1a2e'
  const secondary = (isFootball && winner?.club_secondary_color)
    ? winner.club_secondary_color
    : competition?.secondary_color || '#2a2a4e'

  const wrapperStyle   = { borderTop: `3px solid ${secondary}` }
  const bottomStyle    = { background: primary }
  const pageNoticeStyle = { background: secondary }

  // Portrait / right-slot
  const sport = competition?.sport_slug || 'tennis'
  const isScorersTab = activeTab === 'scorers' || activeTab === 'passers'

  let portraitSrc
  let showClubLogo = false
  let clubLogoSrc = null

  if (isFootball && winner) {
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
      : getDefaultSilhouette(activeGender, sport)
  }

  // Competition info
  const name         = naming?.official_name || competition?.name || ''
  const surface      = getSurfaceLabel(competition?.surface)
  const categoryName = eventNaming?.official_name || competition?.category_name || ''

  if (!competition) return null
  console.log('year_convention:', competition?.year_convention, 'activeYear:', activeYear)
  return (
    <div className={styles.wrapper} style={wrapperStyle}>

      {/* ── Zone 2: Banner ── */}
      <div className={styles.banner}>

        {/* ── Main content row ── */}
        <div className={styles.inner}>

          {/* Left: logo + event info */}
          <div className={styles.left}>
            <div className={styles.logoWrap}>
              {competition.logo_url
                ? <img src={competition.logo_url} alt={name} className={styles.logo} />
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
                {getAreaTitle(activeTab, !!winner, isPast)}
              </div>
              {isFootball && winner && (sets.length === 0 || walkover) && (
                <div className={isScorersTab && leadingPlayers.length > 1 ? styles.scorerNames : styles.winnerName}>
                  {isScorersTab
                    ? leadingPlayers.length > 0
                      ? leadingPlayers.map((p, i) => {
                          const statKey = activeTab === 'passers' ? 'assists' : 'goals'
                          const val = p[statKey] ?? ''
                          return (
                            <div key={i}>
                              {p.display_name || p.canonical_name}{val !== '' ? ` (${val})` : ''}
                            </div>
                          )
                        })
                      : null
                    : winner.canonical_name}
                </div>
              )}
            </div>

            {/* Col 1 row 2: spacer */}
            <div />

            {/* Col 2 row 2: score block */}
            {isPast && winner && sets.length > 0 && !walkover
              ? <div className={styles.scoreBlock}>
                  {[
                    { entity: winner, dim: false },
                    { entity: loser,  dim: true  },
                  ].filter(r => r.entity).map((row, i) => (
                    <div key={i} className={styles.scoreRow}>
                      {row.entity.country_iso2 && (
                        <img
                          src={`/media/flags/${row.entity.country_iso2.toLowerCase()}.svg`}
                          className={styles.scoreFlag}
                          alt={row.entity.country_iso2}
                          onError={e => { e.target.style.display = 'none' }}
                        />
                      )}
                      {/* Issue 2: no wrap, truncate long names */}
                      <span className={`${styles.scorePlayer} ${row.dim ? styles.scoreLoser : ''}`}>
                        {row.entity.canonical_name}
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
                    </div>
                  ))}
                </div>
              : isPast && winner && !isFootball && (sets.length === 0 || walkover)
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
                  onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette(activeGender, sport) }}
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
                    className={styles.portrait}
                    onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette(activeGender, sport) }}
                  />
                ) : (
                  <img
                    src={getDefaultSilhouette(activeGender, sport)}
                    alt=""
                    className={`${styles.portrait} ${styles.portraitDefault}`}
                  />
                )
              ) : showClubLogo ? (
                clubLogoSrc
                  ? <img
                      src={clubLogoSrc}
                      alt={winner?.canonical_name || ''}
                      className={styles.clubLogo}
                      onError={e => { e.target.style.display = 'none' }}
                    />
                  : null
              ) : (
                // Tennis + future/ongoing: video (one-shot) or portrait image or default silhouette
                isPast && winner && isVideoPath(portraitSrc)
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
                  : <img
                      src={portraitSrc}
                      alt={winner?.canonical_name || ''}
                      className={`${styles.portrait} ${!isPast || !winner ? styles.portraitDefault : ''}`}
                      onError={e => { e.target.onerror = null; e.target.src = getDefaultSilhouette(activeGender, sport) }}
                    />
              )}
            </div>
          )}
        </div>

        {/* ── Zone 3: Stats bar ── */}
        <div className={styles.bottom} style={bottomStyle}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Schedule</span>
            <span className={styles.statVal}>
              {competition?.year_convention === 'start'
                ? `${activeYear - 1}–${activeYear}`
                : s?.start_date && s?.end_date
                  ? `${fmt(s.start_date)} – ${fmt(s.end_date)}`
                  : activeYear}
            </span>
          </div>

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
              {activeTab === 'players' && (
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
              {activeTab === 'standings' && isPast && history != null && (
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
                </>
              )}
            </>
          ) : !isFootball && (
            <>
              {isPast && history != null && (
                <>
                  <div className={styles.statSep} />
                  <div className={styles.statBlock}>
                    <span className={styles.statLabel}>Participations / Titles</span>
                    <span className={styles.statVal}>{history.participations} / {history.titles}</span>
                  </div>
                </>
              )}

              {isPast && winner && (() => {
                const age  = calcAge(winner.birth_date, s?.end_date)
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
function fmt(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d)) return ''
  const dd   = String(d.getUTCDate()).padStart(2, '0')
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}.${mm}.${yyyy}`
}

function calcAge(birthDate, eventEndDate) {
  if (!birthDate || !eventEndDate) return null
  const birth = new Date(birthDate)
  const event = new Date(eventEndDate)
  if (isNaN(birth) || isNaN(event)) return null
  return Math.floor((event - birth) / (365.25 * 24 * 60 * 60 * 1000))
}

function getAreaTitle(tab, withChampion = false, isPast = true) {
  const map = {
    'draw-singles-m': ["Men's single",        "Men's single champion",          "Men's single champion"        ],
    'draw-singles-f': ["Women's single",       "Women's single champion",         "Women's single champion"       ],
    'draw-doubles-m': ["Men's double",         "Men's double champions",          "Men's double champions"        ],
    'draw-doubles-f': ["Women's double",       "Women's double champions",        "Women's double champions"      ],
    'draw-doubles-x': ["Mixed double",         "Mixed double champions",          "Mixed double champions"        ],
    'players-m':      ["Men's players list",   "Men's players list",              "Men's players list"            ],
    'players-f':      ["Women's players list", "Women's players list",            "Women's players list"          ],
    'standings':      ["League standings",     "League champion",                 "Current league leader"         ],
    'results':        ["Results",              "League champion",                 "Current league leader"         ],
    'final_tour':     ["Results",              "League champion",                 "Current league leader"         ],
    'scorers':        ["Top scorers",          "Top scorer",                      "Current top scorer"            ],
    'passers':        ["Assists",              "Assist leader",                   "Current assist leader"         ],
    'players':        ["Players",              "League champion",                 "Current league leader"         ],
  }
  const entry = map[tab]
  if (!entry) return ''
  if (!withChampion) return entry[0]
  return isPast ? entry[1] : entry[2]
}