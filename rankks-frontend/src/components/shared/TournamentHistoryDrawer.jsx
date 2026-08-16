import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'
import useVideoPlayerStore from '../../store/useVideoPlayerStore'
import Flag from './Flag'
import DeceasedMark from './DeceasedMark'
import styles from './TournamentHistoryDrawer.module.css'

function scoreText(score) {
  if (!score) return null
  if (score.walkover) return 'W/O'
  return (score.sets || []).map(s => s.tb != null && s.l === 6 ? `${s.w}-${s.l}(${s.tb})` : `${s.w}-${s.l}`).join(', ')
}

// "All-Time Results" link — same slide-in-from-the-right drawer pattern as
// TennisResultsDrawer's "Full Results" (Mohamed 2026-08-10: "like Full
// results"), just scoped to every edition of ONE tournament instead of one
// edition's bracket — every Final result since the 1st edition, most
// recent on top, capped through the currently selected year (same "as of
// viewed year" rule as the Tournament Stats table itself).
// hideTrigger — the Tournament Stats page makes the tournament's own name
// the clickable trigger instead (opening this same `tournament-history:`
// key directly via useVideoPlayerStore), in which case this component is
// still mounted per-row just to render the drawer/portal itself, with its
// own built-in text-link trigger suppressed to avoid a duplicate.
export default function TournamentHistoryDrawer({ competitionId, tour, year, competitionName, hideTrigger = false }) {
  const key = `tournament-history:${competitionId}:${tour}:${year}`
  const open = useVideoPlayerStore(s => s.openKey === key)
  const openDrawer = useVideoPlayerStore(s => s.openVideo)
  const closeDrawer = useVideoPlayerStore(s => s.closeVideo)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !competitionId) return
    setLoading(true)
    api.getTournamentHistory(competitionId, tour, year)
      .then(d => setRows(d?.rows || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [open, competitionId, tour, year])

  if (!competitionId) return null

  const tourLabel = tour === 'wta' ? 'WTA' : 'ATP'

  return (
    <>
      {!hideTrigger && <button className={styles.link} onClick={() => openDrawer(key)}>All-Time Results</button>}

      {open && createPortal(
        <>
          <div className={styles.backdrop} onClick={closeDrawer} />
          <div className={styles.drawer}>
            <button className={styles.closeBtn} onClick={closeDrawer} aria-label="Close">✕</button>
            <div className={styles.header}>
              <div className={styles.headerTitleRow}>
                <div className={styles.headerTitle}>{tourLabel} I {competitionName}</div>
              </div>
              <div className={styles.headerSubtitleRow}>
                <div className={styles.headerSubtitle}>All-Time Results</div>
              </div>
            </div>

            <div className={styles.tableWrap}>
              {loading ? (
                <div className={styles.state}>Loading...</div>
              ) : !rows.length ? (
                <div className={styles.state}>No results available.</div>
              ) : (
                rows.map(r => (
                  <div key={r.year} className={styles.editionRow}>
                    <div className={styles.yearCol}>
                      <div className={styles.year}>{r.year}</div>
                      {r.edition != null && <div className={styles.edition}>Edition {r.edition}</div>}
                    </div>
                    {r.is_cancelled ? (
                      <div className={styles.resultCol}>
                        <span className={styles.cancelledLabel}>Not held{r.cancellation_reason ? ` — ${r.cancellation_reason}` : ''}</span>
                      </div>
                    ) : (
                      <div className={styles.resultCol}>
                        <div className={styles.matchupLine}>
                          <span className={styles.playerInline}>
                            <Flag iso2={r.champion?.iso2} name={r.champion?.name} className={styles.flag} />
                            <span className={styles.winnerName}>
                              {r.champion?.name || '—'}
                              {r.champion?.ordinal != null && ` (${r.champion.ordinal})`}
                            </span>
                            {r.champion?.death_date && <DeceasedMark />}
                          </span>
                          <span className={styles.vs}>d.</span>
                          <span className={styles.playerInline}>
                            <Flag iso2={r.runner_up?.iso2} name={r.runner_up?.name} className={styles.flag} />
                            <span className={styles.loserName}>{r.runner_up?.name || '—'}</span>
                            {r.runner_up?.death_date && <DeceasedMark />}
                          </span>
                        </div>
                        <div className={styles.score}>{scoreText(r.score) || '—'}</div>
                      </div>
                    )}
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
