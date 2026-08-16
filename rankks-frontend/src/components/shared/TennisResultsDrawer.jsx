import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'
import useVideoPlayerStore from '../../store/useVideoPlayerStore'
import Flag from './Flag'
import { fmtDateRange } from '../../utils/calcAge'
import styles from './TennisResultsDrawer.module.css'

const ROUND_ORDER = {
  'Final': 1, 'Semi-Final': 2, 'Quarter-Final': 3,
  'Round of 16': 4, 'Round of 32': 5, 'Round of 64': 6,
  'Round of 128': 7, 'Round Robin': 8, 'Bronze Match': 9,
}
function sortRounds(rounds) {
  return [...rounds].sort((a, b) => (ROUND_ORDER[a] ?? 99) - (ROUND_ORDER[b] ?? 99))
}

function scoreText(score) {
  if (!score) return null
  if (score.walkover) return 'W/O'
  return (score.sets || []).map(s => s.tb != null && s.l === 6 ? `${s.w}-${s.l}(${s.tb})` : `${s.w}-${s.l}`).join(', ')
}

// "Full Results" link — same slide-in-from-the-right drawer pattern as
// FullStandingsDrawer (F1/MotoGP Home), just showing a tennis draw's
// rounds instead of a flat position-ordered standings list, since a
// knockout bracket has no single "position" per entrant the way a race
// does. Built as its own compact drawer rather than embedding the full
// templates/game/tennis_draw_template.jsx page (which carries its own
// page-title/PageNotice/ad chrome meant for a full content area, not a
// 480px slide-out panel).
// hideTrigger — the Home page makes the event's own name the clickable
// trigger instead (opening this same `tennis-results:` key directly via
// useVideoPlayerStore), in which case this component is still mounted
// per-row just to render the drawer/portal itself, with its own built-in
// text-link trigger suppressed to avoid a duplicate.
export default function TennisResultsDrawer({ seasonId, tabKey, tour, competitionName, year, status, startDate, endDate, hideTrigger = false }) {
  const key = `tennis-results:${seasonId}:${tabKey}`
  const open = useVideoPlayerStore(s => s.openKey === key)
  const openDrawer = useVideoPlayerStore(s => s.openVideo)
  const closeDrawer = useVideoPlayerStore(s => s.closeVideo)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  // Next/Future tournaments — no draw exists yet, so don't fetch — same
  // rule FullStandingsDrawer (F1/MotoGP Home) follows for an unraced
  // session. Just state it hasn't happened yet.
  const isFuture = status === 'next' || status === 'upcoming'

  useEffect(() => {
    if (!open || !seasonId || !tabKey || isFuture) return
    setLoading(true)
    api.getGames(seasonId, tabKey)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [open, seasonId, tabKey, isFuture])

  if (!seasonId || !tabKey) return null

  const rounds = data?.games_by_round ? sortRounds(Object.keys(data.games_by_round)) : []
  const title = tabKey === 'draw-singles-f' ? "Women's Singles" : "Men's Singles"
  const tourLabel = tour === 'wta' ? 'WTA' : 'ATP'

  return (
    <>
      {!hideTrigger && <button className={styles.link} onClick={() => openDrawer(key)}>Full Results</button>}

      {open && createPortal(
        <>
          <div className={styles.backdrop} onClick={closeDrawer} />
          <div className={styles.drawer}>
            <button className={styles.closeBtn} onClick={closeDrawer} aria-label="Close">✕</button>
            <div className={styles.header}>
              <div className={styles.headerTitleRow}>
                <div className={styles.headerTitle}>
                  {tourLabel}{competitionName ? ` I ${competitionName}${year ? ` ${year}` : ''}` : ''}
                </div>
              </div>
              <div className={styles.headerSubtitleRow}>
                <div className={styles.headerSubtitle}>{title}</div>
              </div>
            </div>

            <div className={styles.tableWrap}>
              {isFuture ? (
                <div className={styles.state}>
                  Tournament {startDate ? `scheduled ${fmtDateRange(startDate, endDate)} — ` : ''}yet to be held.
                </div>
              ) : loading ? (
                <div className={styles.state}>Loading...</div>
              ) : !rounds.length ? (
                <div className={styles.state}>No results available.</div>
              ) : (
                rounds.map(round => (
                  <div key={round} className={styles.roundBlock}>
                    <div className={styles.roundLabel}>{round}</div>
                    {(data.games_by_round[round] || []).map(g => {
                      const homeWon = g.home_id === g.winner_id
                      const winnerName = g.winner_name
                      const loserName  = homeWon ? g.away_name : g.home_name
                      const winnerIso  = homeWon ? g.home_country_iso2 : g.away_country_iso2
                      const loserIso   = homeWon ? g.away_country_iso2 : g.home_country_iso2
                      return (
                        <div key={g.id} className={styles.matchRow}>
                          <div className={styles.playerLine}>
                            <Flag iso2={winnerIso} name={winnerName} className={styles.flag} />
                            <span className={styles.winnerName}>{winnerName || '—'}</span>
                          </div>
                          <div className={styles.playerLine}>
                            <Flag iso2={loserIso} name={loserName} className={styles.flag} />
                            <span className={styles.loserName}>{loserName || '—'}</span>
                          </div>
                          <div className={styles.score}>{scoreText(g.score) || '—'}</div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
