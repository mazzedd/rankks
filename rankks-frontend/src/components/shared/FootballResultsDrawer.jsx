import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'
import useVideoPlayerStore from '../../store/useVideoPlayerStore'
import Flag from './Flag'
import { fmtDateRange } from '../../utils/calcAge'
import styles from './FootballResultsDrawer.module.css'

const ROUND_ORDER = {
  'final': 1, '3rd-place': 2, 'semi-finals': 3, 'quarter-finals': 4,
  'round-of-16': 5, 'round-of-32': 6, 'round-of-64': 7,
}
const ROUND_LABEL = {
  'final': 'Final', '3rd-place': '3rd Place', 'semi-finals': 'Semifinals', 'quarter-finals': 'Quarter Finals',
  'round-of-16': 'Round of 16', 'round-of-32': 'Round of 32', 'round-of-64': 'Round of 64',
}
function sortRounds(rounds) {
  return [...rounds].sort((a, b) => (ROUND_ORDER[a] ?? 99) - (ROUND_ORDER[b] ?? 99))
}

function scoreText(score) {
  if (!score || score.home == null || score.away == null) return null
  let s = `${score.home}-${score.away}`
  if (score.penalty && (score.penalty.home != null || score.penalty.away != null)) {
    s += ` (${score.penalty.home}-${score.penalty.away} pens)`
  } else if (score.status === 'AET') {
    s += ' AET'
  }
  return s
}

// "Full Results" slide-in drawer for a football knockout tournament — same
// mechanism/shell as TennisResultsDrawer (composes its CSS, see
// FootballResultsDrawer.module.css), fetches the whole Final Tour group
// (Final/3rd-place/Semis/QF/R16 — games-by-group, not a single tabKey)
// since a knockout bracket's "full results" spans several result_tabs at
// once, unlike tennis's one-draw-per-tabKey shape.
export default function FootballResultsDrawer({ seasonId, tabGroup = 'final_tour', competitionName, year, status, startDate, endDate }) {
  const key = `football-results:${seasonId}:${tabGroup}`
  const open = useVideoPlayerStore(s => s.openKey === key)
  const openDrawer = useVideoPlayerStore(s => s.openVideo)
  const closeDrawer = useVideoPlayerStore(s => s.closeVideo)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const isFuture = status === 'next' || status === 'upcoming' || status === 'future'

  useEffect(() => {
    if (!open || !seasonId || !tabGroup || isFuture) return
    setLoading(true)
    api.getGamesByGroup(seasonId, tabGroup)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [open, seasonId, tabGroup, isFuture])

  if (!seasonId) return null

  const rounds = data?.games_by_round ? sortRounds(Object.keys(data.games_by_round)) : []

  return (
    <>
      <button className={styles.link} onClick={() => openDrawer(key)}>Full Results</button>

      {open && createPortal(
        <>
          <div className={styles.backdrop} onClick={closeDrawer} />
          <div className={styles.drawer}>
            <button className={styles.closeBtn} onClick={closeDrawer} aria-label="Close">✕</button>
            <div className={styles.header}>
              <div className={styles.headerTitleRow}>
                <div className={styles.headerTitle}>{competitionName}{year ? ` ${year}` : ''}</div>
              </div>
              <div className={styles.headerSubtitleRow}>
                <div className={styles.headerSubtitle}>Final Tour</div>
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
                    <div className={styles.roundLabel}>{ROUND_LABEL[round] || round}</div>
                    {(data.games_by_round[round] || []).map(g => {
                      const homeWon = g.home_id === g.winner_id
                      const winnerName = homeWon ? g.home_name : g.away_name
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
