// templates/account/MyAccountPage.jsx
// Real routed /account page (Mohamed 2026-08-19: "time to create a real
// page 'MY ACCOUNT', not a popup. Keep sidebar and feel free to create the
// page according to rankks standards, page title, fonts, color, etc") —
// replaces the old MyAccountModal popup. Reuses the exact same shared
// classes every other page on the site already uses (page-title/
// page-subtitle/filter-bar from index.css, the generic table shell from
// f1.module.css that TennisRankingsTemplate.jsx etc. already reuse for any
// non-F1 table page) instead of inventing new page chrome.
import { useState, useEffect, Suspense, lazy } from 'react'
import useUserStore from '../../../store/useUserStore'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
// Lazy — see ContentArea.jsx for why a static import of this component
// broke React's CJS interop under Rolldown's chunking.
const MediaRow = lazy(() => import('../media/WatchCenterTemplate').then(m => ({ default: m.MediaRow })))
import { useFollowerCount } from '../../EventBlock/EventBlock'
import { formatFollowers } from '../../../utils/formatFollowers'
import ReportsSection from '../reports/ReportsSection'
import tableStyles from '../f1/f1.module.css'
import wcStyles from '../media/WatchCenterTemplate.module.css'
import styles from './MyAccountPage.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

function fmtVoteDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}

function fmtScore(score) {
  if (!score?.sets?.length) return '—'
  return score.sets.map(s => `${s.w}-${s.l}`).join(' I ')
}

// Crowd "good vote" % banding (Mohamed 2026-08-19: "green from 51% to
// 100%, grey for 50% and red from 0% to 49%").
function crowdPctClass(pct) {
  if (pct == null) return null
  if (pct === 50) return 'crowdGrey'
  return pct > 50 ? 'crowdGreen' : 'crowdRed'
}

// 'tour' (ATP/WTA) was missing here — favourites.js/useUserStore both
// already fetch and store it correctly (see EMPTY_FAVOURITES), it just
// never had a section to render into (Mohamed 2026-08-19: "ATP / WTA
// added to favourite, not displayed in my favourites").
const SECTION_ORDER  = ['competition', 'tour', 'club', 'athlete', 'sport']
const SECTION_LABELS = {
  competition: 'Competitions',
  tour:        'ATP / WTA',
  club:        'Clubs & Teams',
  athlete:     'Athletes',
  sport:       'Sports',
}

// Video favourites get their own sidebar section instead of sitting inside
// the generic Favourites list (Mohamed 2026-08-19: "in myaccount, create a
// sidebar menu Videos") — all three video-shaped favourite types, not just
// 'media' (f1_race_video/motogp_race_video are the F1/MotoGP race-weekend
// Watch videos, same "saved video" concept, just their own entity_type per
// favourites.js's own cap-sharing comment).
const VIDEO_SECTION_ORDER = ['media', 'f1_race_video', 'motogp_race_video']
const VIDEO_SECTION_LABELS = {
  media:             'Match Videos & Iconic Moments',
  f1_race_video:     'F1',
  motogp_race_video: 'MotoGP',
}

// Per-subcategory subtitle (Mohamed 2026-08-21: "Place My Account in
// header (no breadcrumb)... Subcat Favourites: subtitle = My Favourites"
// etc.) — the page no longer shows its own "My Account" title since that's
// already reachable from the header avatar; each subcategory's identity
// now lives in the subtitle line instead, same page-subtitle class every
// other page on the site uses.
const SECTION_SUBTITLES = {
  favourites: 'My Favourites',
  videos:     'My Favourite Videos',
  votes:      'My Votes',
  reports:    'My Reports',
}

// Competition/tour favourites are "followed", not just "favourited" — show
// the real follower count + an explicit Unfollow action (Mohamed
// 2026-08-21: "Display Logo - Competition Name - Num of followers - button
// unfollow"), reusing the same useFollowerCount hook the competition/tour
// banners themselves use rather than a fresh count fetch.
function FollowFavRow({ fav, onUnfollow }) {
  const [count] = useFollowerCount(fav.entity_type, fav.entity_id)
  return (
    <div className={styles.favRow}>
      {fav.image_url && <img src={resolveImg(fav.image_url)} alt="" className={styles.favImg} />}
      <span className={styles.favName}>{fav.name || `#${fav.entity_id}`}</span>
      <span className={styles.favFollowerCount}>{count == null ? '' : `${formatFollowers(count)} followers`}</span>
      <button
        type="button"
        className={styles.unfollowBtn}
        onClick={() => onUnfollow(fav.entity_type, fav.entity_id)}
      >
        Unfollow
      </button>
    </div>
  )
}

export default function MyAccountPage() {
  const accountSection    = useAppStore(s => s.accountSection)
  const user              = useUserStore(s => s.user)
  const token              = useUserStore(s => s.token)
  const favourites          = useUserStore(s => s.favourites)
  const toggleFavourite    = useUserStore(s => s.toggleFavourite)
  const updatePreferences  = useUserStore(s => s.updatePreferences)
  const logout             = useUserStore(s => s.logout)

  const [prefPending, setPrefPending] = useState(false)

  const [votes, setVotes] = useState(null)
  const [votesLoading, setVotesLoading] = useState(false)
  const [voteSportFilter, setVoteSportFilter] = useState('')
  const [voteLeagueFilter, setVoteLeagueFilter] = useState('')
  const [voteCallFilter, setVoteCallFilter] = useState('') // '' | 'good' | 'bad'

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setVotesLoading(true)
    api.getMyVotes(token)
      .then(d => { if (!cancelled) setVotes(d) })
      .catch(() => { if (!cancelled) setVotes([]) })
      .finally(() => { if (!cancelled) setVotesLoading(false) })
    return () => { cancelled = true }
  }, [token])

  const handleOddsToggle = async (e) => {
    const checked = e.target.checked
    setPrefPending(true)
    try {
      await updatePreferences(checked)
    } finally {
      setPrefPending(false)
    }
  }

  const hasAny = SECTION_ORDER.some(t => (favourites[t] || []).length > 0)
  const hasAnyVideos = VIDEO_SECTION_ORDER.some(t => (favourites[t] || []).length > 0)

  const voteSports = votes
    ? [...new Map(votes.map(v => [v.sport_slug, v.sport_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
    : []
  const voteLeagues = votes
    ? [...new Map(
        votes
          .filter(v => !voteSportFilter || v.sport_slug === voteSportFilter)
          .map(v => [v.competition_slug, v.competition_name])
      ).entries()].sort((a, b) => a[1].localeCompare(b[1]))
    : []
  const hasActiveVoteFilter = voteSportFilter || voteLeagueFilter || voteCallFilter
  const clearVoteFilters = () => { setVoteSportFilter(''); setVoteLeagueFilter(''); setVoteCallFilter('') }
  const filteredVotes = (votes || []).filter(v =>
    (!voteSportFilter || v.sport_slug === voteSportFilter) &&
    (!voteLeagueFilter || v.competition_slug === voteLeagueFilter) &&
    (!voteCallFilter || (voteCallFilter === 'good' ? v.is_correct === true : v.is_correct === false))
  )

  return (
    <div className={tableStyles.wrap}>
      <div className="page-title">My Account</div>
      <div className="page-subtitle">
        {accountSection === 'settings' ? `${user?.email} — ${user?.subscription_tier} plan` : SECTION_SUBTITLES[accountSection]}
      </div>

      {accountSection === 'settings' && (
        <div className={styles.section}>
          <label className={styles.prefRow}>
            <span>Show odds data</span>
            <input
              type="checkbox"
              checked={!!user?.show_odds_data}
              onChange={handleOddsToggle}
              disabled={prefPending}
            />
          </label>
          <button type="button" className={styles.logoutBtn} onClick={logout}>Log out</button>
        </div>
      )}

      {accountSection === 'favourites' && (
        <div className={styles.section}>
          {!hasAny && (
            <p className="empty-state">No favourites yet — tap the star on any competition, club, or athlete to follow it.</p>
          )}
          {hasAny && (
            <div className={styles.favouritesGrid}>
              {SECTION_ORDER.map(type => {
                const items = favourites[type] || []
                if (!items.length) return null
                return (
                  <div key={type} className={styles.favGroup}>
                    <div className={styles.favGroupLabel}>{SECTION_LABELS[type]}</div>
                    {items.map(f => (
                      (type === 'competition' || type === 'tour') ? (
                        <FollowFavRow key={f.id} fav={f} onUnfollow={toggleFavourite} />
                      ) : (
                        <div key={f.id} className={styles.favRow}>
                          {f.image_url && <img src={resolveImg(f.image_url)} alt="" className={styles.favImg} />}
                          <span className={styles.favName}>{f.name || `#${f.entity_id}`}</span>
                          <button
                            type="button"
                            className={styles.favRemove}
                            onClick={() => toggleFavourite(f.entity_type, f.entity_id)}
                            aria-label={`Remove ${f.name || ''}`}
                          >
                            ×
                          </button>
                        </div>
                      )
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {accountSection === 'videos' && (
        <div className={styles.section}>
          {!hasAnyVideos && (
            <p className="empty-state">No saved videos yet — tap the star on any match video or iconic moment to save it here.</p>
          )}
          {hasAnyVideos && VIDEO_SECTION_ORDER.map(type => {
            const items = favourites[type] || []
            if (!items.length) return null
            return (
              <div key={type} className={styles.videoGroup}>
                <div className={styles.favGroupLabel}>{VIDEO_SECTION_LABELS[type]}</div>
                {type === 'media' ? (
                  // Same row pattern as the Watch Center (Mohamed
                  // 2026-08-20: "use the same pattern to display my
                  // videos") — MediaRow reused unmodified, fed the same
                  // shape /match-videos-totals and /iconic-moments-totals
                  // already return; favourites.js's own GET now carries
                  // those extra media_* fields for exactly this. A
                  // favourited row counts as "match" (round/opponents) if
                  // it's tied to a real game, else "moment".
                  <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
                    <div className={wcStyles.rows}>
                      {items.map(f => (
                        <MediaRow
                          key={f.id}
                          variant={f.media_round ? 'match' : 'moment'}
                          item={{
                            id: f.entity_id,
                            video_url: f.video_url,
                            source: f.media_source,
                            embeddable: f.media_embeddable,
                            title: f.name,
                            tags: f.media_tags,
                            thumbnail_url: f.image_url,
                            duration_seconds: f.media_duration_seconds,
                            view_count: f.media_view_count,
                            round: f.media_round,
                            home_name: f.media_home_name,
                            away_name: f.media_away_name,
                            competition_name: f.media_competition_name,
                          }}
                        />
                      ))}
                    </div>
                  </Suspense>
                ) : (
                  items.map(f => (
                    <div key={f.id} className={styles.favRow}>
                      {f.image_url && <img src={resolveImg(f.image_url)} alt="" className={styles.favImg} />}
                      <span className={styles.favName}>{f.name || `#${f.entity_id}`}</span>
                      <button
                        type="button"
                        className={styles.favRemove}
                        onClick={() => toggleFavourite(f.entity_type, f.entity_id)}
                        aria-label={`Remove ${f.name || ''}`}
                      >
                        ×
                      </button>
                    </div>
                  ))
                )}
              </div>
            )
          })}
        </div>
      )}

      {accountSection === 'votes' && (
      <div className={styles.section}>
        {votes && votes.length > 0 && (
          <>
            <div className="filter-bar">
              <select
                className="filter-label"
                value={voteLeagueFilter}
                onChange={e => setVoteLeagueFilter(e.target.value)}
              >
                <option value="">All Leagues</option>
                {voteLeagues.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
              </select>
              <select
                className="filter-label"
                value={voteSportFilter}
                onChange={e => { setVoteSportFilter(e.target.value); setVoteLeagueFilter('') }}
              >
                <option value="">All Sports</option>
                {voteSports.map(([slug, name]) => <option key={slug} value={slug}>{name}</option>)}
              </select>
              {hasActiveVoteFilter && (
                <button type="button" className="filter-reset" onClick={clearVoteFilters}>Clear</button>
              )}
              <span className="filter-total">{filteredVotes.length} votes</span>
            </div>
            <div className={styles.callPills}>
              <button
                type="button"
                className={`${styles.callPill} ${styles.callPillGood}${voteCallFilter === 'good' ? ' ' + styles.callPillActive : ''}`}
                onClick={() => setVoteCallFilter(f => f === 'good' ? '' : 'good')}
              >
                Good Calls
              </button>
              <button
                type="button"
                className={`${styles.callPill} ${styles.callPillBad}${voteCallFilter === 'bad' ? ' ' + styles.callPillActive : ''}`}
                onClick={() => setVoteCallFilter(f => f === 'bad' ? '' : 'bad')}
              >
                Bad Calls
              </button>
            </div>
          </>
        )}

        {votesLoading && <p className="empty-state">Loading…</p>}
        {!votesLoading && votes && votes.length === 0 && (
          <p className="empty-state">No votes yet — pick a winner on any homepage matchup.</p>
        )}
        {!votesLoading && votes && votes.length > 0 && filteredVotes.length === 0 && (
          <p className="empty-state">No votes match these filters.</p>
        )}

        {!votesLoading && filteredVotes.length > 0 && (
          <div className={tableStyles.tableScroll}>
            <table className={`${tableStyles.table} table-thead-border`}>
              <thead>
                <tr>
                  <th className="table-label-left">Vote</th>
                  <th className="table-label">Date</th>
                  <th className="table-label">Status</th>
                  <th className="table-label">Sport</th>
                  <th className="table-label-left">League</th>
                  <th className="table-label">Result</th>
                  <th className="table-label">Votes</th>
                  <th className="table-label">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {filteredVotes.map((v, i) => {
                  const crowdCls = crowdPctClass(v.crowd_good_pct)
                  return (
                    <tr key={v.id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                      <td>
                        <div className={styles.voteCell}>
                          <strong>{v.picked_name}</strong>
                          <span className="cell-meta">{v.home_name} vs {v.away_name}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>{fmtVoteDate(v.voted_at)}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`${styles.status} ${styles['status_' + v.status]}`}>{v.status.toUpperCase()}</span>
                      </td>
                      <td style={{ textAlign: 'center' }}>{v.sport_name}</td>
                      <td>
                        <div className={styles.voteCell}>
                          {v.competition_name}
                          {v.round && <span className="cell-meta">{v.round}</span>}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className={styles.voteCell}>
                          <strong>{v.winner_name || '—'}</strong>
                          <span className="cell-meta">{fmtScore(v.score)}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <div className={styles.voteCell}>
                          <span>{v.total_votes}</span>
                          <span className={crowdCls ? styles[crowdCls] : 'cell-meta'}>
                            {v.crowd_good_pct == null ? '—' : `${v.crowd_good_pct}% good`}
                          </span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {v.is_correct == null
                          ? <span className="cell-meta">—</span>
                          : <span className={v.is_correct ? styles.accuracyGood : styles.accuracyBad}>{v.is_correct ? 'Good Call' : 'Bad Call'}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {accountSection === 'reports' && <ReportsSection />}
    </div>
  )
}
