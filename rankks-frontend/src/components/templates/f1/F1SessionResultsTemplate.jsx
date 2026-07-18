// templates/f1/F1SessionResultsTemplate.jsx
// Race Results (regular + sprint) per locked spec: Pos | Driver | No |
// Team | Time/Retired | Laps | Pts.
// Practice per locked spec: Pos | Driver | No | Team | Time/Gap | Laps
//
// FLAG + COUNTRY — uses driver_country_iso2/driver_country_name, added
// to the /f1/session/:sessionId/results backend route alongside this
// fix. AVATAR now uses the real driver_image field via resolveImg,
// replacing the previous hardcoded-guessed-path helper (same class of
// bug already fixed elsewhere).
//
// AGE — now uses the shared calcAge(birthDate, refDate) util, with
// refDate = data.session.event_date (the GP's real date, now joined
// into the backend route). Previously used today's date, which meant a
// driver's age silently changed on every page view instead of being
// pinned to the race — same unified rule now applied across football,
// tennis, and F1.
//
// Per explicit design note: driver name is regular weight, NOT bold.
// Every header label is bold. Team left, Time right, Points right.
//
// VIDEO — reuses the shared MatchVideo component (Build Log v2.1), shown
// only on the Race tab.
//
// CSS — now imports the shared templates/f1/f1.module.css (was its own
// module CSS, byte-identical to the other 5 F1 templates). Avatar+name
// +flag/country cell and the age value+birthdate stack now use the
// global .entity-cell/.entity-stack/.entity-meta-row/.stat-stack/
// .stat-stack-value/.cell-meta classes from index.css.
import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import MatchVideo from '../../shared/MatchVideo'
import { calcAge, fmtBirth } from '../../../utils/calcAge'
import styles from './f1.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

const th = (align) => ({ textAlign: align, fontWeight: 'bold' })

export default function F1SessionResultsTemplate({ sessionId, sessionType, videoUrl, source, embeddable, thumbnailUrl }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    if (!sessionId) return
    setLoading(true)
    api.getF1SessionResults(sessionId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sessionId])

  if (loading) return <Skeleton />
  if (!data?.results?.length) return <Empty />

  // "Race Results" is the unified label per spec, but Sprint sessions use
  // the same points/columns as a race — both count as "race-type" here.
  const isRaceType = sessionType === 'Race' || sessionType === 'Sprint'
  // The video, however, is tied to the race weekend as a whole
  // (grand_prix_id) and only ever shown on the main Race tab, per
  // product decision — not duplicated onto Sprint or Practice tabs.
  const showVideo = sessionType === 'Race' && !!videoUrl

  const results = data.results.filter(r =>
    !search || r.driver_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.team_name?.toLowerCase().includes(search.toLowerCase())
  )

  const title = sessionType === 'Race' ? 'Race Results' : sessionType
  const eventDate = data.session?.event_date

  return (
    <div className={styles.wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="page-title">{title}</div>
        {showVideo && (
          <MatchVideo videoUrl={videoUrl} source={source} embeddable={embeddable} thumbnailUrl={thumbnailUrl} />
        )}
      </div>

      {data.is_placeholder && (
        <div style={{ padding: '6px 16px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic' }}>
          Entry list based on current season standings — results not published yet.
        </div>
      )}

      <div className="filter-bar">
        <input className="search-input" placeholder="Search driver or team" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className={styles.tableScroll}>
        <table className={`${styles.table} table-thead-border`}>
        <thead>
          <tr>
            <th className={styles.pos}></th>
            <th className="table-label" style={th('left')}>Driver</th>
            <th className="table-label" style={th('center')}>Age</th>
            <th className="table-label" style={th('center')}>No</th>
            <th className="table-label" style={th('left')}>Team</th>
            <th className="table-label" style={th('center')}>{isRaceType ? 'Time / Retired' : 'Time / Gap'}</th>
            <th className="table-label" style={th('center')}>Laps</th>
            {isRaceType && <th className="table-label" style={th('right')}>Pts.</th>}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const isDNF = r.time_result === 'DNF'
            const img = resolveImg(r.driver_image)
            const age = calcAge(r.birth_date, eventDate, r.death_date)
            return (
              <tr key={r.driver_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className={styles.pos}>
                  <span className={`event-rank ${isDNF ? styles.dnf : ''}`}>{r.position}</span>
                </td>
                <td>
                  <div className="entity-cell">
                    <AthleteAvatar src={img} name={r.driver_name} sport="f1" gender="M" className="avatar" />
                    <div className="entity-stack">
                      <span style={{ fontWeight: 'normal' }}>{r.driver_name}</span>
                      <div className="entity-meta-row">
                        <Flag iso2={r.driver_country_iso2} name={r.driver_country_name} className="flag" />
                        <span className="cell-meta">{r.driver_country_name || '—'}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {age != null ? (
                    <div className="stat-stack">
                      <span className="stat-stack-value">{age}</span>
                      <span className="cell-meta">{fmtBirth(r.birth_date)}</span>
                    </div>
                  ) : '—'}
                </td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{r.car_number ?? '—'}</td>
                <td className="stats-light" style={{ textAlign: 'left' }}>{r.team_name || '—'}</td>
                <td className={`stats-light ${isDNF ? styles.dnfTime : ''}`} style={{ textAlign: 'center' }}>{r.time_result || '—'}</td>
                <td className="stats-light" style={{ textAlign: 'center' }}>{r.laps ?? '—'}</td>
                {isRaceType && <td className="stats-strong" style={{ textAlign: 'right' }}>{r.points ?? '—'}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
    </div>
  )
}

function Skeleton() {
  return <div style={{ padding: 16 }}>{[...Array(5)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
}
function Empty() {
  return <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text3)' }}>No results available for this session.</div>
}
