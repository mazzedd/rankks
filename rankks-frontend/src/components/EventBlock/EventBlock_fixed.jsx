import { useEffect, useState } from 'react'
import styles from './EventBlock.module.css'
import { api } from '../../services/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatus(season) {
  if (!season) return 'future'
  const now = new Date()
  const start = season.start_date ? new Date(season.start_date) : null
  const end   = season.end_date   ? new Date(season.end_date)   : null
  if (season.status === 'past'    || (end   && now > end))   return 'past'
  if (season.status === 'ongoing' || (start && now >= start && (!end || now <= end))) return 'ongoing'
  return 'future'
}

function getPortraitPath(winner, activeGender, sport) {
  if (!winner) return null
  const slug   = winner.entity_slug
  if (!slug) return null
  const folder = activeGender === 'F' ? 'female' : 'male'
  // Try portrait first, fall back to regular athlete image
  return `/media/athletes/${sport || 'tennis'}/${folder}/portrait/${slug}.png`
}

function getDefaultSilhouette(activeGender) {
  const folder = activeGender === 'F' ? 'female' : 'male'
  return `/media/default/tennis/${folder}.png`
}

function getSurfaceLabel(surface) {
  const map = { grass: 'Grass', clay: 'Clay', hard: 'Hard' }
  return map[surface?.toLowerCase()] || surface || ''
}

// ── Diagonal streaks SVG ──────────────────────────────────────────────────────
function Streaks({ color1, color2 }) {
  return (
    <svg className={styles.streaks} viewBox="0 0 1920 600" preserveAspectRatio="xMidYMid slice">
      <defs><clipPath id="eb-clip"><rect width="1920" height="600"/></clipPath></defs>
      <g clipPath="url(#eb-clip)">
        <polygon points="900,-100 820,-100 590,700 670,700" fill={color1} />
        <polygon points="1050,-100 1010,-100 780,700 820,700" fill={color2} />
        <polygon points="1180,-100 1155,-100 925,700 950,700" fill={color2} />
        <polygon points="1300,-100 1265,-100 1035,700 1070,700" fill={color1} />
        <polygon points="1450,-100 1430,-100 1200,700 1220,700" fill={color2} />
      </g>
    </svg>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  if (status === 'past') return null
  return (
    <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>
      {status === 'ongoing' ? '● LIVE' : 'UPCOMING'}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EventBlock({ season, competition, naming, activeYear, activeGender, activeTab }) {
  const s = activeGender
    ? season?.seasons?.find(se => se.gender === activeGender)
    : season?.seasons?.[0]

  const winner  = season?.winners?.find(w => w.season_id === s?.id)?.winner
  const status  = getStatus(s)
  const isPast  = status === 'past'

  // Colours from DB — fall back to dark defaults
  const primary   = competition?.primary_color   || '#1a1a2e'
  const secondary = competition?.secondary_color || '#2a2a4e'
  const third     = competition?.third_color     || primary

  // Streak colours — semi-transparent overlays
  const streak1 = `${secondary}33`
  const streak2 = `rgba(255,255,255,0.04)`

  // Banner background gradient
  const bgStyle = {
    background: `linear-gradient(135deg, ${primary} 0%, ${secondary} 60%, ${third} 100%)`,
  }

  // Bottom bar colour
  const bottomStyle = {
    background: primary,
    borderTop:  `2px solid ${secondary}`,
  }

  // Top accent line
  const topLineStyle = { background: secondary }

  // Portrait
  const sport       = competition?.sport_slug || 'tennis'
  const portraitSrc = isPast && winner
    ? getPortraitPath(winner, activeGender, sport)
    : getDefaultSilhouette(activeGender)

  // Competition info
  const name    = naming?.official_name || competition?.name || ''
  const surface = getSurfaceLabel(competition?.surface)

  // Category label
  const categoryName = competition?.category_name || ''

  // History (participations + titles)
  const dbYear = competition?.year_convention === 'start' ? activeYear - 1 : activeYear
  const [history, setHistory] = useState(null)

  useEffect(() => {
    if (!winner?.entity_id || !competition?.id || !dbYear) { setHistory(null); return }
    api.getEntityHistory(winner.entity_id, competition.id, dbYear)
      .then(d => setHistory(d))
      .catch(() => setHistory(null))
  }, [winner?.entity_id, competition?.id, dbYear])

  if (!competition) return null

  return (
    <div className={styles.wrapper}>

      {/* ── Banner ── */}
      <div className={styles.banner} style={bgStyle}>

        {/* Top accent line */}
        <div className={styles.topLine} style={topLineStyle} />

        {/* Diagonal streaks */}
        <Streaks color1={streak1} color2={streak2} />

        {/* Dark overlay for text readability */}
        <div className={styles.overlay} />

        {/* ── Main content row ── */}
        <div className={styles.inner}>

          {/* Left: logo + event info */}
          <div className={styles.left}>
            <div className={styles.logoWrap}>
              {competition.logo_url
                ? <img src={competition.logo_url} alt={name} className={styles.logo} />
                : <span className={styles.logoText}>{name.slice(0,2).toUpperCase()}</span>
              }
            </div>

            <div className={styles.info}>
              <div className={styles.categoryRow}>
                <span className={styles.category}>
                  {categoryName}{surface ? ` · ${surface}` : ''}
                </span>
                <StatusBadge status={status} />
              </div>

              <div className={styles.eventName}>
                {name} {activeYear}
              </div>

              <div className={styles.areaTitle}>
                {isPast && winner ? `${getAreaTitle(activeTab)} champion` : getAreaTitle(activeTab)}
              </div>

              {/* Final score — past events only */}
              {isPast && winner && season?.finalScore && (
                <div className={styles.scoreBlock}>
                  {season.finalScore.map((row, i) => (
                    <div key={i} className={styles.scoreRow}>
                      <span className={`${styles.scorePlayer} ${i === 0 ? styles.scoreWinner : styles.scoreLoser}`}>
                        {row.player}
                      </span>
                      {row.sets?.map((set, j) => (
                        <span key={j} className={`${styles.scoreSet} ${i !== 0 ? styles.scoreSetDim : ''}`}>
                          {set}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Winner name — past, no score available */}
              {isPast && winner && !season?.finalScore && (
                <div className={styles.winnerName}>{winner.canonical_name}</div>
              )}
            </div>
          </div>

          {/* Right: portrait */}
          <div className={styles.portraitWrap}>
            <img
              src={portraitSrc}
              alt={winner?.canonical_name || ''}
              className={`${styles.portrait} ${!isPast || !winner ? styles.portraitDefault : ''}`}
              onError={e => {
                // Fall back to silhouette if portrait not found
                e.target.src = getDefaultSilhouette(activeGender)
              }}
            />
          </div>
        </div>

        {/* ── Bottom stats bar ── */}
        <div className={styles.bottom} style={bottomStyle}>
          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Schedule</span>
            <span className={styles.statVal}>
              {s?.start_date && s?.end_date
                ? `${fmt(s.start_date)} – ${fmt(s.end_date)}`
                : activeYear}
            </span>
          </div>

          <div className={styles.statSep} />

          <div className={styles.statBlock}>
            <span className={styles.statLabel}>Edition</span>
            <span className={styles.statVal}>{s?.edition_number || '—'}</span>
          </div>

          {isPast && history != null && (
            <>
              <div className={styles.statSep} />
              <div className={styles.statBlock}>
                <span className={styles.statLabel}>Participations / Titles</span>
                <span className={styles.statVal}>{history.participations} / {history.titles}</span>
              </div>
            </>
          )}

          <div className={styles.rankks}>RANKKS</div>
          <div className={styles.snapshot}>Event-time snapshot</div>
        </div>
      </div>
    </div>
  )
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmt(dateStr) {
  if (!dateStr) return ''
  // Use UTC parts to avoid timezone shifting the displayed date
  const d = new Date(dateStr)
  if (isNaN(d)) return ''
  const dd   = String(d.getUTCDate()).padStart(2, '0')
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function getAreaTitle(tab) {
  const map = {
    'draw-singles-m':  "Men's singles",
    'draw-singles-f':  "Women's singles",
    'draw-doubles-m':  "Men's doubles",
    'draw-doubles-f':  "Women's doubles",
    'draw-doubles-x':  "Mixed doubles",
    'players-m':       "Men's players list",
    'players-f':       "Women's players list",
    'standings':       "League standings",
    'results':         "Results",
    'scorers':         "Top scorers",
  }
  return map[tab] || ''
}
