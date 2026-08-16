import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../services/api'
import useVideoPlayerStore from '../../store/useVideoPlayerStore'
import Flag from './Flag'
import AthleteAvatar from './AthleteAvatar'
import { StatusBadge } from '../EventBlock/EventBlock'
import styles from './FullStandingsDrawer.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

function fmtDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

// "Full Standings" quick-glance link — opens the complete position-ordered
// results for one session (not just the winner a summary row shows) in
// the same slide-in drawer MatchVideo uses (see SlideDrawer.module.css),
// fetched via the same /f1/session/:id/results route
// F1SessionResultsTemplate itself uses. Session-agnostic (Race/Sprint/
// Qualifying/Practice all have position-ordered results worth a full
// list), unlike the Watch button which only ever shows on Race rows.
//
// fetchResults — defaults to F1's own route; MotoGP's Home page passes
// api.getMotoGPSessionResults instead (adapted to this component's
// driver_*/team_name_raw field names at the call site, since MotoGP's API
// returns rider_*/team_name — see HomeMotoGPTemplate.jsx), same
// "swap the fetcher, keep the component" pattern IconicMomentsTemplate's
// fetchMoments prop already uses.
// hideTrigger — the Home page makes the GP name's own row text the
// clickable trigger instead (opening this same `standings:` key directly
// via useVideoPlayerStore), in which case this component is still
// mounted per-row just to render the drawer/portal itself, with its own
// built-in text-link trigger suppressed to avoid a duplicate.
export default function FullStandingsDrawer({ sessionId, sessionType, tourLabel, gpName, year, status, sessionDate, fetchResults = api.getF1SessionResults, hideTrigger = false }) {
  const key = `standings:${sessionId}`
  const open = useVideoPlayerStore(s => s.openKey === key)
  const openDrawer = useVideoPlayerStore(s => s.openVideo)
  const closeDrawer = useVideoPlayerStore(s => s.closeVideo)
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)

  // Next/Future sessions — no results exist yet, so don't fetch the
  // standings-based placeholder entry list (misleading dressed up as real
  // results) — same rule the session result pages themselves follow (see
  // F1SessionResultsTemplate.jsx). Just state it hasn't happened yet.
  const isFuture = status === 'next' || status === 'upcoming'

  useEffect(() => {
    if (!open || !sessionId || isFuture) return
    setLoading(true)
    fetchResults(sessionId)
      .then(d => setResults(d?.results || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false))
  }, [open, sessionId, fetchResults, isFuture])

  if (!sessionId) return null

  const isRaceType = sessionType === 'Race' || sessionType === 'Sprint'
  const isQualifying = sessionType === 'Qualifying' || sessionType === 'Sprint Qualifying'

  // Qualifying has no single time_result — a driver eliminated in Q1 only
  // ever sets a Q1 time, one who reaches Q2 (but not Q3) only sets Q1+Q2,
  // and so on. Show whichever round the driver actually reached: Q3 if
  // they got that far, else Q2, else Q1 — same rule F1QualifyingTemplate's
  // dedicated 3-column table encodes, collapsed to the one column this
  // compact drawer has room for.
  const timeFor = (r) => (isQualifying ? (r.q3_time || r.q2_time || r.q1_time) : r.time_result)

  return (
    <>
      {!hideTrigger && <button className={styles.link} onClick={() => openDrawer(key)}>Full Standings</button>}

      {open && createPortal(
        <>
          <div className={styles.backdrop} onClick={closeDrawer} />
          <div className={styles.drawer}>
            <button className={styles.closeBtn} onClick={closeDrawer} aria-label="Close">✕</button>
            <div className={styles.header}>
              <div className={styles.headerTitleRow}>
                <div className={styles.headerTitle}>
                  {tourLabel ? `${tourLabel} I ` : ''}{gpName}{year ? ` ${year}` : ''}
                </div>
              </div>
              <div className={styles.headerSubtitleRow}>
                <div className={styles.headerSubtitle}>{sessionType}</div>
                {status && <StatusBadge status={status} />}
              </div>
            </div>

            <div className={styles.tableWrap}>
              {isFuture ? (
                <div className={styles.state}>
                  {sessionType} {fmtDate(sessionDate) ? `scheduled ${fmtDate(sessionDate)} — ` : ''}yet to be held.
                </div>
              ) : loading ? (
                <div className={styles.state}>Loading...</div>
              ) : !results?.length ? (
                <div className={styles.state}>No results available.</div>
              ) : (
                <table className={styles.table}>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.driver_id} className={styles.row}>
                        <td className={styles.pos}>{r.position}</td>
                        <td className={styles.driverCell}>
                          <AthleteAvatar src={resolveImg(r.driver_image)} name={r.driver_name} sport="f1" gender="M" className={styles.avatar} fallback="letter" />
                          <div className={styles.driverStack}>
                            <span className={styles.driverName}>{r.driver_name}</span>
                            <div className={styles.driverMeta}>
                              <Flag iso2={r.driver_country_iso2} name={r.driver_country_name} className={styles.flag} />
                              <span className={styles.teamName}>{r.team_name_raw || '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td className={styles.value}>
                          {timeFor(r) || '—'}
                          {isRaceType && r.points != null && <span className={styles.points}>{r.points} pts</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
