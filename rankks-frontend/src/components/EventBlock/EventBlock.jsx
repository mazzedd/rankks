import { useEffect, useState } from 'react'
import styles from './EventBlock.module.css'
import { api } from '../../services/api'

export default function EventBlock({ season, competition, naming, activeYear, activeGender }) {
  const s = activeGender
    ? season?.seasons?.find(se => se.gender === activeGender)
    : season?.seasons?.[0]
  const winner = season?.winners?.find(w => w.season_id === s?.id)?.winner

  // Build athlete image path for tennis players
  const athleteImg = (() => {
    if (winner?.image_url) return winner.image_url
    const slug = winner?.entity_slug
    if (!slug || !activeGender) return null
    const folder = activeGender === 'F' ? 'female' : 'male'
    return `/media/athletes/tennis/${folder}/${slug}.png`
  })()
  const bg     = s?.bg_image_url || competition?.bg_image_url || '/media/placeholder-bg.jpg'
  const name   = naming?.official_name || competition?.name || ''

  const [history, setHistory] = useState(null)

  // DB year: year_convention='start' means UI year 2021 = DB year 2020
  const dbYear = competition?.year_convention === 'start' ? activeYear - 1 : activeYear

  useEffect(() => {
    if (!winner?.entity_id || !competition?.id || !dbYear) { setHistory(null); return }
    api.getEntityHistory(winner.entity_id, competition.id, dbYear)
      .then(d => setHistory(d))
      .catch(() => setHistory(null))
  }, [winner?.entity_id, competition?.id, dbYear])

  // Guard AFTER hooks
  if (!competition) return null

  return (
    <div className={styles.wrapper}>
      <div className={styles.block} style={{ backgroundImage: `url(${bg})` }} />
      <div className={styles.strip}>
        <div className={styles.left}>
          {competition.logo_url
            ? <img src={competition.logo_url} alt={competition.name} className={styles.logo} />
            : <div className={styles.logoPh} />
          }
          <span className="event-title">
            {name.toUpperCase()}{activeYear ? ` — ${activeYear}` : ''}
          </span>
        </div>

        <div className={styles.right}>
          {winner && (
            <>
              <div className="winner-stats-kpis">
                <div className="winner-stats-block">
                  <span className="winner-stats">Participations</span>
                  <span className="winner-stats-value">
                    {history != null ? history.participations : '—'}
                  </span>
                </div>
                <span className="winner-stats-sep">|</span>
                <div className="winner-stats-block">
                  <span className="winner-stats">Titles</span>
                  <span className="winner-stats-value">
                    {history != null ? history.titles : '—'}
                  </span>
                </div>
              </div>
              <div className="event-winner">
                <span className="event-winner-name">{winner.canonical_name}</span>
                {athleteImg &&
                  <img src={athleteImg} alt={winner.canonical_name} className="event-winner-logo" />
                }
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
