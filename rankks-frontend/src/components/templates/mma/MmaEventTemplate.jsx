import { useEffect, useState, useMemo, useRef, Suspense, lazy } from 'react'
import useAppStore from '../../../store/useAppStore'
import { api } from '../../../services/api'
import PageNotice from '../../PageNotice/PageNotice'
import EmptyState from '../../EmptyState/EmptyState'
import { StatusBadge, useFollowerCount, FollowersLine, SportHomeBanner } from '../../EventBlock/EventBlock'
import FavouriteStar from '../../shared/FavouriteStar'
import MatchVideo from '../../shared/MatchVideo'
// Lazy — see ContentArea.jsx for why a static import of this component
// broke React's CJS interop under Rolldown's chunking.
const WatchCenterTemplate = lazy(() => import('../media/WatchCenterTemplate'))
// Lazy — see WatchCenterTemplate above for why a static import of a
// component like this broke React's CJS interop under Rolldown's chunking.
const HomepageTemplate = lazy(() => import('../homepage/HomepageTemplate'))
import { PillBarsIcon } from '../../shared/PillIcons'
import Flag from '../../shared/Flag'
import AthleteAvatar from '../../shared/AthleteAvatar'
import SearchableSelect from '../../shared/SearchableSelect'
import { calcAge, fmtDate } from '../../../utils/calcAge'
import { classifyByDate, STATUS_LABEL } from '../../../utils/eventStatus'
import lineAStyles from '../../navigation/LineA.module.css'
import lineBStyles from '../../navigation/LineB.module.css'
import { ScrollableTabs } from '../../navigation/LineB'
import ebStyles from '../../EventBlock/EventBlock.module.css'
import styles from './MmaEventTemplate.module.css'
// Same shared table classes TennisRankingsTemplate.jsx's own rankings
// page renders through (Mohamed 2026-08-17: reuse, don't reinvent) — that
// page is the closest existing analogue to this one (a flat "rank 1..N,
// name, country" list), right down to the entity-cell/entity-meta-row
// shape for name+flag with no avatar photo in the row.
import f1Styles from '../f1/f1.module.css'

// Per the UFC onboarding spec's "LINE A-B" sheet — heaviest to lightest,
// matching the sheet's own row order (Men's Rankings A2-A9, Women's
// Rankings A10-A13). No ranking data is ingested yet (deferred per
// Mohamed 2026-08-16: "Rankings, leave blank for the moment" — ufc.com's
// own rankings page, not part of the ufcstats-derived dataset this app
// ingests) — these exist purely as nav placeholders for now.
const MENS_WEIGHT_CLASSES = ['Heavyweight', 'Light Heavyweight', 'Middleweight', 'Welterweight', 'Lightweight', 'Featherweight', 'Bantamweight', 'Flyweight']
const WOMENS_WEIGHT_CLASSES = ['Featherweight', 'Bantamweight', 'Flyweight', 'Strawweight']

// Watch Center's sentinel activeEventKey value (Mohamed 2026-08-25: "Watch
// center item should be place Line B... i dont want to see Video icon on
// Line A") — same F1ContentArea.jsx WATCH_TAB_ID/activeSessionId pattern,
// pinned last among the real event tabs within whichever of UFC Event/
// Fight Night is currently open, instead of a standalone Line A icon.
const WATCH_TAB_ID = '__watch__'

// Totals' own Line B ("Men's Stats" / "Women's Stats" — UFC sheet rows
// 19-20), same pattern tennis's own Totals page uses (see ContentArea.jsx's
// TOTALS_LINE_B / TennisTotalsLineB) — blank for now, same as Rankings.
// Mohamed 2026-08-19: "Order; Men's Stats, Men's Fight List, Women's Stat,
// Women's Fight List" — each gender's Stats/Fight List pair kept adjacent,
// not grouped by type (Stats,Stats,Fights,Fights).
const TOTALS_SUB = [
  { key: 'men', label: "Men's Stats" },
  { key: 'fights-m', label: "Men's Fight List" },
  { key: 'women', label: "Women's Stats" },
  { key: 'fights-f', label: "Women's Fight List" },
]

// Fights don't carry a dedicated gender column — the weight class already
// tells us (ingestufc.js applies the same rule when it sets entities.gender).
function genderFromWeightClass(wc) {
  return wc && wc.startsWith("Women's") ? 'F' : 'M'
}

// Venue strings differ in shape between the two ingestion sources:
// ingestufc.js's CSV-sourced `location` is "City, State, Country" or
// "City, Country" (no venue/arena name at all); ingest-ufc-upcoming.js's
// ufc-fr.com-sourced `venue` is "Arena Name, City, State, Country". Both
// get the same treatment here — comma-split, last segment is always the
// country, and the segment right before it is dropped ONLY if it's a
// recognized US state (Mohamed 2026-08-17: "remove US STATE" — an
// international city/province like "Abu Dhabi" is deliberately left in,
// not stripped) — then rejoined with " I " instead of commas.
const US_STATES = new Set([
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
  'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina',
  'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  'District of Columbia',
])
function formatVenue(venue) {
  if (!venue) return null
  const parts = venue.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length < 2) return venue
  const country = parts[parts.length - 1]
  let rest = parts.slice(0, -1)
  if (rest.length > 1 && US_STATES.has(rest[rest.length - 1])) rest = rest.slice(0, -1)
  return [...rest, country].join(' I ')
}

// Split into two pieces instead of formatVenue's one joined string — Fight
// List (Totals sub-tab) shows city+country on one table-row line and the
// arena/stadium name on the line beneath it, not the region (Mohamed
// 2026-08-19: "want the stadium where the fight took place, not the
// region").
//
// FIXED 2026-08-19: the original version only stripped the middle segment
// when it was a recognized US_STATES entry, so any NON-US region/province
// (ufcstats.com's own CSV `location` format is "City, Region, Country" for
// plenty of non-US cards — "Mexico City, Distrito Federal, Mexico",
// "Manchester, England, United Kingdom", "Curitiba, Parana, Brazil") fell
// through untouched and got treated as if it were an arena name, with the
// real city wrongly bumped into the "arena" line instead. The last THREE
// parts of any venue string are always City, Region, Country regardless of
// country (region always dropped, exactly like a US state); anything
// BEFORE those three is the real arena name, if present at all. Verified
// against live data 2026-08-19: every currently-DECIDED fight's venue is
// 2 or 3 parts with zero arena text — this always returns arena: null for
// them today, correctly (no real arena data exists yet for anything
// already fought — only still-scheduled cards carry it).
//
// `hasArena` (Mohamed 2026-08-23 fix): a scheduled/upcoming card's venue
// comes from `stats.venue` (ufc-fr.com's own scrape, see `cards`' useMemo
// hasArena field) instead of the flat `g.venue` column, and THAT source
// puts a real arena name first whenever one exists — "Shanghai Indoor
// Stadium, Shanghai, China" (3 parts, no region) or "Golden 1 Center,
// Sacramento, California, United States" (4 parts, WITH a region). The
// City/Region/Country-only assumption above breaks on the first shape
// (wrongly reads the arena name itself as "city", drops it entirely) — a
// real signal for "this string's first segment is an arena" is needed
// rather than guessing from part count alone, since a bare 3-part decided-
// fight venue ("Manchester, England, United Kingdom") has NO arena at all
// despite being the same length. Schedule's own Location column (Mohamed:
// "1st line = flag + country / 2nd line = Stadium") only ever needs
// country + arena, so this branch skips city extraction entirely rather
// than getting it wrong for 4-part strings too.
function splitVenue(venue, hasArena = false) {
  if (!venue) return { cityCountry: null, arena: null, country: null }
  const parts = venue.split(',').map(p => p.trim()).filter(Boolean)
  if (!parts.length) return { cityCountry: null, arena: null, country: null }
  const country = parts[parts.length - 1]
  if (hasArena) {
    return { cityCountry: venue, arena: parts.length >= 3 ? parts[0] : null, country }
  }
  if (parts.length <= 2) return { cityCountry: venue, arena: null, country }
  const city = parts[parts.length - 3]
  const arenaParts = parts.slice(0, parts.length - 3)
  return {
    cityCountry: [city, country].filter(Boolean).join(', '),
    arena: arenaParts.length ? arenaParts.join(', ') : null,
    country,
  }
}

// Venue country name (as parsed by splitVenue above, whichever spelling
// the ingestion source used — "USA" and "United States" both appear
// across the two UFC sources, see splitVenue's own header comment) ->
// iso2, for Schedule's own Location flag (Mohamed 2026-08-23: "1st line =
// flag + country"). No venue_country_id/iso2 FK exists anywhere in the
// UFC ingestion pipeline (verified: neither ingestufc.js nor
// ingest-ufc-upcoming.js ever sets one) — this is a static, self-
// contained name lookup rather than a DB join, covering every country a
// real UFC/Fight Night card has actually been held in. Unmapped names
// fail safe (Flag renders nothing), never a wrong flag.
const VENUE_COUNTRY_ISO2 = {
  'united states': 'US', 'usa': 'US', 'u.s.a.': 'US', 'u.s.': 'US',
  'canada': 'CA', 'brazil': 'BR', 'mexico': 'MX', 'argentina': 'AR', 'chile': 'CL',
  'united kingdom': 'GB', 'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB',
  'ireland': 'IE', 'france': 'FR', 'germany': 'DE', 'sweden': 'SE', 'denmark': 'DK',
  'netherlands': 'NL', 'poland': 'PL', 'czech republic': 'CZ', 'croatia': 'HR', 'serbia': 'RS',
  'russia': 'RU', 'ukraine': 'UA', 'finland': 'FI', 'switzerland': 'CH', 'austria': 'AT',
  'china': 'CN', 'japan': 'JP', 'south korea': 'KR', 'philippines': 'PH', 'singapore': 'SG',
  'australia': 'AU', 'new zealand': 'NZ',
  'united arab emirates': 'AE', 'uae': 'AE', 'qatar': 'QA', 'saudi arabia': 'SA', 'bahrain': 'BH',
  'south africa': 'ZA', 'nigeria': 'NG',
}
function venueCountryIso2(countryName) {
  if (!countryName) return null
  return VENUE_COUNTRY_ISO2[countryName.trim().toLowerCase()] || null
}

// "2026-08-29" -> "29.08.26" — Schedule's own Date column (Mohamed
// 2026-08-23), distinct from fmtDate's dd.mm.yyyy (4-digit year) used
// everywhere else on the site.
function fmtDateShort(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d)) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}.${mm}.${yy}`
}

// "in 14 days" / "3 days ago" / "Today" — Schedule's own Date column
// second line (Mohamed 2026-08-23), compared at whole-day granularity so
// a fight later today doesn't read as "in 0 days".
function relativeDayLabel(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  const startOfDay = x => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const diffDays = Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000)
  if (diffDays === 0) return 'Today'
  return diffDays > 0 ? `in ${diffDays} day${diffDays === 1 ? '' : 's'}` : `${-diffDays} day${diffDays === -1 ? '' : 's'} ago`
}

// "UFC 320: Marchetti vs Okafor" -> "UFC 320"
// "UFC Fight Night: Sorensen vs Duarte" -> "Sorensen vs Duarte"
function shortEventLabel(round) {
  const numbered = round.match(/^UFC\s*\d+/i)
  if (numbered) return numbered[0]
  const afterColon = round.split(':')[1]
  return (afterColon || round).trim()
}

// "UFC 330: Makhachev vs. Machado Garry" -> "Makhachev vs. Machado Garry"
// "UFC Fight Night: Gamrot vs. Salkilld" -> "Gamrot vs. Salkilld"
// The inverse of shortEventLabel above — that one keeps the numbering and
// drops the matchup (for the Edition ribbon stat); this one keeps the
// matchup and drops the numbering (for the banner headline, which shows
// venue + matchup instead — Mohamed 2026-08-17). Falls back to the full
// card name for the ~14% of historical events with no "X vs Y" suffix at
// all (see ingestufc.js's markHeadliner comment on this same gap).
function matchupLabel(round) {
  const idx = round.indexOf(':')
  return idx >= 0 ? round.slice(idx + 1).trim() : round
}

// match_date comes back as a UTC-shifted ISO string (node-postgres parses
// DATE columns using the server's local timezone, then serializes to
// UTC — the same round-trip fmtDate's local-getters already correct for
// on display, see calcAge.js). A naive slice(0, 10) reads the raw
// pre-correction string and comes out a day early whenever the local
// timezone is behind UTC — which would silently exclude the very fight
// being displayed from its own winner's career-stats query below.
function toLocalISODate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d)) return null
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// Same resolveImg every other sport's EventBlock uses (F1EventBlock.jsx,
// EventBlock.jsx) — competitions.logo_url is stored as a bare
// /media/-relative path, not a full URL.
function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

// Big-banner portrait — same /media/athletes/{sport}/{gender}/portrait/{slug}.png
// convention F1's own EventBlock uses (see F1EventBlock.jsx's
// getDriverPortraitPath), confirmed for combat-sports specifically in the
// UFC onboarding spec (image path sheet: male/female portrait folders).
// No files exist there yet — AthleteAvatar falls through to the shared
// default silhouette on 404, exactly like every driver currently does on
// F1's own banner (no portrait assets uploaded there either).
function getFighterPortraitPath(slug, gender) {
  if (!slug) return null
  const folder = gender === 'F' ? 'female' : 'male'
  return `/media/athletes/combat-sports/${folder}/portrait/${slug}.png`
}

// Compact-row headshot (fight list, table rows) — .../profile/ instead of
// .../portrait/, same split CLAUDE.md's own convention documents
// (profile = compact headshot for table rows, portrait = big banner
// shot) and the same one AthleteAvatar's own fallback='letter' comment
// enforces (a portrait-typed image is a wrong-context mismatch here).
function getFighterProfilePath(slug, gender) {
  if (!slug) return null
  const folder = gender === 'F' ? 'female' : 'male'
  return `/media/athletes/combat-sports/${folder}/profile/${slug}.png`
}

// backfill-ufc-fight-ranks.js only ever writes home_rank/away_rank onto
// fights it found a real weekly-snapshot match for (2013-02-04 through
// 2025-05-06) — most fights, especially prelims and anything outside that
// window, simply have no key at all, which rankBadge treats as "don't
// show anything" rather than a fake "(#—)" placeholder (same 0-rule
// zero-suppression convention used everywhere else in this template).
// Rank 0 is the champion in this data (ingest-ufc-rankings.js's own
// convention too), shown as "(C)" rather than the more confusing "(#0)".
function rankBadge(rank) {
  if (rank == null) return null
  return rank === 0 ? '(C)' : `(#${rank})`
}

function FightRow({ fight }) {
  const s = fight.stats || {}
  const decided = s.status === 'final' && fight.winner_id
  const isLive = s.status === 'live'
  const homeWon = decided && fight.winner_id === fight.home_id
  const awayWon = decided && fight.winner_id === fight.away_id
  const homeGender = genderFromWeightClass(s.weight_class)

  const awayGender = genderFromWeightClass(s.weight_class)

  return (
    <div className={`${styles.fight}${s.is_headliner ? ' ' + styles.headliner : ''}`}>
      {/* Same left-to-right element order on both sides (Mohamed
          2026-08-17: "For athletes placed left... arrow (winner) profile
          image + name. For athletes placed right... arrow (winner),
          profile image + name" — identical order, not mirrored), same
          arrow-avatar-name/flag+country row shape as the F1 driver
          standings reference screenshot. */}
      <div className={styles.corner}>
        <span className={`${styles.winnerArrow}${homeWon ? '' : ' ' + styles.winnerArrowHidden}`} />
        <AthleteAvatar
          src={getFighterProfilePath(fight.home_slug, homeGender)}
          name={fight.home_name}
          sport="mma"
          gender={homeGender}
          fallback="letter"
          className={styles.rowAvatar}
        />
        <div className={styles.cornerInfo}>
          <div className={`${styles.fighterName}${homeWon ? ' ' + styles.winner : ''}`}>
            {fight.home_name}{rankBadge(s.home_rank) && <span className={styles.rankBadge}> {rankBadge(s.home_rank)}</span>}
          </div>
          <div className={styles.countryRow}>
            <Flag iso2={fight.home_country_iso2} name={fight.home_name} className={styles.flag} />
            <span>{fight.home_country_name}</span>
          </div>
        </div>
      </div>

      <div className={styles.center}>
        <span className={styles.weightClass}>{s.weight_class || '—'}</span>
        {s.is_title_fight && <span className={styles.titlePill}>{s.title_name}</span>}
        {decided ? (
          <span className={styles.result}>
            {s.method} <span className={styles.rt}>· R{s.finish_round} {s.finish_time}</span>
          </span>
        ) : isLive ? (
          <span className={styles.live}><span className={styles.pip} />LIVE</span>
        ) : (
          <span className={styles.upcoming}>Upcoming</span>
        )}
        {/* Renders nothing when this fight has no video (MatchVideo's own
            !videoUrl guard) — same games-table video fields (video_url/
            video_source/video_embeddable/video_thumbnail_url/video_id)
            football's own game_template.jsx reads, just on a fight
            instead of a match (Mohamed 2026-08-25: "match videos are tied
            to a specific game" — confirmed correct, just never actually
            rendered anywhere until now). */}
        <MatchVideo
          videoUrl={fight.video_url}
          source={fight.video_source}
          embeddable={fight.video_embeddable}
          thumbnailUrl={fight.video_thumbnail_url}
          videoId={fight.video_id}
          videoType="media"
          title={`${fight.home_name} vs ${fight.away_name}`}
        />
      </div>

      <div className={`${styles.corner} ${styles.cornerAway}`}>
        {/* Right side fully mirrors the left (Mohamed 2026-08-17: arrow
            after name, profile image after name too) — name/country
            innermost (closest to center), then avatar, then the
            right-to-left arrow at the very outer edge. Opposite element
            order from the home corner, but each side reads outer-edge-in
            toward the fight's center column the same way. */}
        <div className={styles.cornerInfo}>
          <div className={`${styles.fighterName}${awayWon ? ' ' + styles.winner : ''}`}>
            {fight.away_name}{rankBadge(s.away_rank) && <span className={styles.rankBadge}> {rankBadge(s.away_rank)}</span>}
          </div>
          <div className={styles.countryRow}>
            <Flag iso2={fight.away_country_iso2} name={fight.away_name} className={styles.flag} />
            <span>{fight.away_country_name}</span>
          </div>
        </div>
        <AthleteAvatar
          src={getFighterProfilePath(fight.away_slug, awayGender)}
          name={fight.away_name}
          sport="mma"
          gender={awayGender}
          fallback="letter"
          className={styles.rowAvatar}
        />
        <span className={`${styles.winnerArrow} ${styles.winnerArrowReverse}${awayWon ? '' : ' ' + styles.winnerArrowHidden}`} />
      </div>
    </div>
  )
}

// Compact 2-line banner for the blank Home/Watch/Totals/Rankings pages —
// same minimal .bottom-only structure (no .inner/statBloc/portrait) as
// F1EventBlock.jsx's F1HomeBlock/F1AllTimeBlock/F1IconicMomentsBlock,
// through the same shared EventBlock.module.css. `icon` mirrors whichever
// of Line A's pinned buttons (Home/Watch/Totals) the page corresponds to
// (see PillIcons.jsx's own comment) — omitted for Rankings, which isn't
// one of those three pinned icons.
function StubBanner({ icon: Icon, title, breadcrumbExtra, year, logoUrl, status, entityId = null }) {
  const [logoFailed, setLogoFailed] = useState(false)
  const resolvedLogo = resolveImg(logoUrl)
  // Only the Home section passes entityId — following "the UFC" only makes
  // sense from its Home page, same as every other sport's Home-only follow
  // badge (Mohamed 2026-08-19: "populate to all other league").
  const [followerCount, loadFollowerCount] = useFollowerCount('competition', entityId)
  return (
    <div className={ebStyles.wrapper}>
      <div className={ebStyles.banner}>
        <div className={ebStyles.bottom}>
          {Icon && <Icon standalone />}
          <span className={ebStyles.eventName}>
            <span>{title}</span>
            <FollowersLine count={followerCount} />
          </span>
          <div className={ebStyles.bottomRightGroup}>
            {entityId && (
              <FavouriteStar entityType="competition" entityId={entityId} label="UFC" variant="badge" onToggled={loadFollowerCount} />
            )}
            <div className={ebStyles.bottomLogoWrap}>
              {resolvedLogo && !logoFailed
                ? <img src={resolvedLogo} alt="UFC" className={ebStyles.bottomLogo} onError={() => setLogoFailed(true)} />
                : <span className={ebStyles.allTimeLogoText}>UFC</span>
              }
            </div>
          </div>
          <div className={`page-title ${ebStyles.breadcrumbLine}`}>
            <img src="/media/icons/sports/icon-combat-sport.png" alt="" className={ebStyles.breadcrumbIcon} onError={e => { e.target.style.display = 'none' }} />
            <span>
              UFC I <span className="page-title-year">{year}</span>{breadcrumbExtra ? ` I ${breadcrumbExtra}` : ''}
              {status && <span style={{ marginLeft: 8 }}><StatusBadge status={status} /></span>}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Rankings table — same entity-cell/entity-stack/entity-meta-row +
// stat-stack shape F1DriversTemplate.jsx's own standings table uses
// (avatar + name + flag/country stacked under the name, Age/Seasons as
// bold-value-over-muted-sub-label pairs), plus the same player/country
// filter-bar TennisRankingsTemplate.jsx's own rankings page uses
// (Mohamed 2026-08-17: "All Fighters (search), All Countries (count)").
// The champion (standings.position = 0, ingest-ufc-rankings.js's own
// convention) gets a crown glyph instead of a bare "0".
function RankingsTable({ rankings, loading, gender, year }) {
  const [countryFilter, setCountryFilter] = useState('')
  const [fighterFilter, setFighterFilter] = useState('')
  useEffect(() => { setCountryFilter(''); setFighterFilter('') }, [rankings])

  if (loading) return <div style={{ padding: 16 }}>{[...Array(8)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
  if (!rankings?.length) return <EmptyState type="default" message="No rankings available for this division yet." />

  // Age/seasons-range as of the SELECTED year, not real-today — a
  // historical (e.g. 2015) snapshot showing a fighter's current 2026 age
  // would misrepresent how old they were when actually ranked that high.
  const today = year < new Date().getFullYear() ? new Date(`${year}-12-31`) : new Date()

  const fighters = [...new Set(rankings.map(r => r.canonical_name))].sort((a, b) => a.localeCompare(b))
  const countryCounts = new Map()
  rankings.forEach(r => {
    if (!r.country_iso2) return
    const entry = countryCounts.get(r.country_iso2) || { name: r.country_name || r.country_iso2, count: 0 }
    entry.count++
    countryCounts.set(r.country_iso2, entry)
  })
  const countries = [...countryCounts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))

  const rows = rankings.filter(r => {
    if (countryFilter && r.country_iso2 !== countryFilter) return false
    if (fighterFilter && r.canonical_name !== fighterFilter) return false
    return true
  })
  const hasActiveFilter = countryFilter || fighterFilter

  return (
    <>
      <div className="filter-bar">
        <SearchableSelect
          value={fighterFilter}
          onChange={setFighterFilter}
          options={fighters.map(name => ({ value: name, label: name }))}
          allLabel="All Fighters"
        />
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(([iso2, c]) => <option key={iso2} value={iso2}>{c.name} ({c.count})</option>)}
        </select>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setCountryFilter(''); setFighterFilter('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} fighters</span>
      </div>

      <div className={f1Styles.tableScroll}>
        <table className={`${f1Styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={f1Styles.pos}></th>
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Fighter</th>
              <th className="table-label" style={{ textAlign: 'center', fontWeight: 'bold' }}>Age</th>
              <th className="table-label" style={{ textAlign: 'center', fontWeight: 'bold' }}>Seasons</th>
              <th className="table-label" style={{ textAlign: 'center', fontWeight: 'bold' }}>Fights I Champ.</th>
              <th className="table-label" style={{ textAlign: 'center', fontWeight: 'bold' }}>Win I Loss I Draw</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const age = calcAge(r.birth_date, today, r.death_date)
              const birth = fmtDate(r.birth_date)
              const fights = r.stats?.wins != null ? r.stats.wins + r.stats.losses + r.stats.draws : null
              const record = r.stats?.wins != null ? `${r.stats.wins} I ${r.stats.losses} I ${r.stats.draws}` : '—'
              const titles = r.titles ? Number(r.titles) : 0
              return (
                <tr key={r.entity_id} className="table-row" style={{ animationDelay: `${i * 0.03}s` }}>
                  <td className={f1Styles.pos}>
                    <span className="event-rank">{r.stats?.is_champion ? '👑' : r.position}</span>
                  </td>
                  <td>
                    <div className="entity-cell">
                      <AthleteAvatar
                        src={getFighterProfilePath(r.entity_slug, gender)}
                        name={r.canonical_name}
                        sport="mma"
                        gender={gender}
                        fallback="letter"
                        className="avatar"
                      />
                      <div className="entity-stack">
                        <span className="club-name">{r.canonical_name}</span>
                        <div className="entity-meta-row">
                          <Flag iso2={r.country_iso2} name={r.country_name} className="flag" />
                          <span className="cell-meta">{r.country_name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {age != null ? (
                      <div className="stat-stack">
                        <span className="stat-stack-value-light">{age}</span>
                        <span className="cell-meta">{birth}</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="stats-light" style={{ textAlign: 'center' }}>
                    {r.seasons ? (
                      <div className="stat-stack">
                        <span className="stat-stack-value-light">{r.seasons}</span>
                        <span className="cell-meta">{r.debut_year}-{today.getFullYear()}</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className="stats-light" style={{ textAlign: 'center' }}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">
                        {fights ?? '—'} I {titles > 0 ? <strong>{titles}</strong> : titles}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {record}{r.stats?.record_note ? <span className="cell-meta"> ({r.stats.record_note})</span> : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

const TOTALS_PAGE_SIZE = 25
// Mohamed 2026-08-18's own mockup — alphabetical, "Finishes" (KO+Submission
// combined) and "Wins %" newly added, "Submissions" dropped as its own
// sort criterion (folded into "Finishes"; the Submissions column itself
// stays in the table, just isn't independently sortable anymore).
const TOTALS_SORT_OPTIONS = [
  { key: 'fights',      label: 'Fights' },
  { key: 'finishes',    label: 'Finishes' },
  { key: 'r1',          label: 'First R. Finishes' },
  { key: 'ko',          label: 'Knockouts' },
  { key: 'seasons',     label: 'Seasons' },
  { key: 'titles',      label: 'Titles' },
  { key: 'wins',        label: 'Wins' },
  { key: 'winpct',      label: 'Wins %' },
]
function totalsStatValue(f, key) {
  switch (key) {
    case 'wins':     return Number(f.wins)
    case 'fights':   return Number(f.total_fights)
    case 'ko':       return Number(f.wins_by_ko)
    case 'finishes': return Number(f.wins_by_ko) + Number(f.wins_by_submission)
    case 'r1':       return Number(f.first_round_finishes)
    case 'titles':   return Number(f.title_wins)
    case 'seasons':  return Number(f.seasons)
    case 'winpct':   return Number(f.total_fights) > 0 ? Number(f.wins) / Number(f.total_fights) : 0
    default: return 0
  }
}

// TOTALS -> Men's/Women's Stats — all-time career leaderboard, not scoped
// to one division/year (unlike RankingsTable above). Same entity-cell/
// stat-stack shapes, plus a sort dropdown + pagination (2400+ fighters is
// too many to just dump in one unsorted table — same PAGE_SIZE/sortStat
// pattern TennisRankingsTemplate.jsx's own page already uses).
function TotalsTable({ fighters, loading, gender, year }) {
  const [countryFilter, setCountryFilter] = useState('')
  const [fighterFilter, setFighterFilter] = useState('')
  // '' = no explicit sort chosen yet — rows still show in the backend's own
  // wins-desc order (see /mma/totals' ORDER BY), but the column isn't lit
  // up (sortRowsHighlight convention: only once the user actually picks a
  // "Sort by" option, never on by default — same rule as the Rank/Sort
  // highlight everywhere else in the app).
  const [sortStat, setSortStat] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [activityFilter, setActivityFilter] = useState('') // '' | 'active' | 'retired'
  const [page, setPage] = useState(1)
  useEffect(() => { setCountryFilter(''); setFighterFilter(''); setSortStat(''); setCategoryFilter(''); setActivityFilter(''); setPage(1) }, [fighters])
  useEffect(() => { setPage(1) }, [countryFilter, fighterFilter, sortStat, categoryFilter, activityFilter])

  if (loading) return <div style={{ padding: 16 }}>{[...Array(8)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
  if (!fighters?.length) return <EmptyState type="default" message="No stats available yet." />

  // Age as of the SELECTED year, not real-today — same convention
  // RankingsTable already uses (Mohamed 2026-08-17: "athlete age must be
  // calculated based upon selected year"). The rest of this table's stats
  // stay all-time career totals on purpose (see this component's own
  // header comment) — only age/birth-date display shifts with the year.
  const today = year < new Date().getFullYear() ? new Date(`${year}-12-31`) : new Date()

  // Only fighters who'd actually debuted BY the selected year (Mohamed
  // 2026-08-19: "why do u display women's fighter that have started their
  // career in 2017" while viewing 2013 — Gillian Robertson, real UFC debut
  // 2017, was showing up on every year including ones years before she'd
  // ever fought). This table's own header comment says stats stay all-time
  // on purpose — that's still true here (a fighter's career TOTALS aren't
  // cut off at the selected year, unlike RankingsTable), but simply being
  // LISTED at all requires having debuted by then, same as Fight List's own
  // "as of this year" cutoff.
  const eligible = fighters.filter(f => !f.debut_year || Number(f.debut_year) <= Number(year))

  const names = [...new Set(eligible.map(f => f.canonical_name))].sort((a, b) => a.localeCompare(b))
  const countryCounts = new Map()
  eligible.forEach(f => {
    if (!f.country_iso2) return
    const entry = countryCounts.get(f.country_iso2) || { name: f.country_name || f.country_iso2, count: 0 }
    entry.count++
    countryCounts.set(f.country_iso2, entry)
  })
  const countries = [...countryCounts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  const categoryCounts = new Map()
  eligible.forEach(f => {
    if (!f.weight_class) return
    categoryCounts.set(f.weight_class, (categoryCounts.get(f.weight_class) || 0) + 1)
  })
  const categories = [...categoryCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  let rows = eligible.filter(f => {
    if (countryFilter && f.country_iso2 !== countryFilter) return false
    if (fighterFilter && f.canonical_name !== fighterFilter) return false
    if (categoryFilter && f.weight_class !== categoryFilter) return false
    if (activityFilter === 'active' && !f.is_active) return false
    if (activityFilter === 'retired' && f.is_active) return false
    return true
  })
  if (sortStat) rows = [...rows].sort((a, b) => totalsStatValue(b, sortStat) - totalsStatValue(a, sortStat))
  const hasActiveFilter = countryFilter || fighterFilter || sortStat || categoryFilter || activityFilter

  const totalPages = Math.ceil(rows.length / TOTALS_PAGE_SIZE)
  const safePage = Math.min(page, Math.max(1, totalPages))
  const pageSlice = rows.slice((safePage - 1) * TOTALS_PAGE_SIZE, safePage * TOTALS_PAGE_SIZE)
  // Accepts either one key or a few — 'winpct' has no dedicated column of
  // its own (win% is already shown as the Fights column's own sub-label),
  // so that column lights up for either sortStat.
  const sorted = (...keys) => keys.includes(sortStat) ? 'sortRowsHighlight' : ''

  return (
    <>
      <div className="filter-bar">
        <SearchableSelect
          value={fighterFilter}
          onChange={setFighterFilter}
          options={names.map(name => ({ value: name, label: name }))}
          allLabel="All Fighters"
        />
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(([iso2, c]) => <option key={iso2} value={iso2}>{c.name} ({c.count})</option>)}
        </select>
        <select className="filter-label" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(([wc, count]) => <option key={wc} value={wc}>{wc} ({count})</option>)}
        </select>
        <select className="filter-label" value={sortStat} onChange={e => setSortStat(e.target.value)}>
          <option value="">Sort by:</option>
          {TOTALS_SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        {/* Plain statusBtn/statusBtnActive (Mohamed 2026-08-24: "Pills not
            pink. Should use same CSS as [TennisPlayerStatsTemplate's own
            Active/Retired]") — not playersStyles' pink activityTag, and
            no colored statusBtn_${s} variant either (that's reserved for
            real past/ongoing/next/upcoming semantics; Active/Retired is a
            plain binary toggle). */}
        <div className={f1Styles.statusToggle}>
          <button
            type="button"
            className={`${f1Styles.statusBtn} ${activityFilter === 'active' ? f1Styles.statusBtnActive : ''}`}
            onClick={() => setActivityFilter(a => a === 'active' ? '' : 'active')}
          >
            Active
          </button>
          <button
            type="button"
            className={`${f1Styles.statusBtn} ${activityFilter === 'retired' ? f1Styles.statusBtnActive : ''}`}
            onClick={() => setActivityFilter(a => a === 'retired' ? '' : 'retired')}
          >
            Retired
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setCountryFilter(''); setFighterFilter(''); setSortStat(''); setCategoryFilter(''); setActivityFilter('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} fighters</span>
      </div>

      <div className={f1Styles.tableScroll}>
        <table className={`${f1Styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={f1Styles.pos}></th>
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Fighter</th>
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Category</th>
              <th className="table-label" style={{ textAlign: 'center', fontWeight: 'bold' }}>Age</th>
              <th className={`table-label ${sorted('seasons')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>Seasons</th>
              <th className="table-label" style={{ textAlign: 'center', fontWeight: 'bold' }}>Fights I Champ.</th>
              <th className={`table-label ${sorted('fights', 'winpct')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>Fights</th>
              <th className={`table-label ${sorted('wins')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>W I L I D</th>
              <th className={`table-label ${sorted('ko', 'finishes')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>Knockouts</th>
              <th className={`table-label ${sorted('finishes')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>Submissions</th>
              <th className={`table-label ${sorted('r1')}`} style={{ textAlign: 'center', fontWeight: 'bold' }}>1st R. Finishes</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((f, i) => {
              const age = calcAge(f.birth_date, today, f.death_date)
              const birth = fmtDate(f.birth_date)
              const titleWinPct = f.title_fights > 0 ? Math.round((f.title_wins / f.title_fights) * 100) : null
              const overallWinPct = f.total_fights > 0 ? Math.round((f.wins / f.total_fights) * 100) : null
              return (
                <tr key={f.entity_id} className="table-row" style={{ animationDelay: `${i * 0.02}s` }}>
                  <td className={f1Styles.pos}><span className="event-rank">{(safePage - 1) * TOTALS_PAGE_SIZE + i + 1}</span></td>
                  <td>
                    <div className="entity-cell">
                      <AthleteAvatar
                        src={getFighterProfilePath(f.entity_slug, gender)}
                        name={f.canonical_name}
                        sport="mma"
                        gender={gender}
                        fallback="letter"
                        className="avatar"
                      />
                      <div className="entity-stack">
                        <span className="club-name">{f.canonical_name}</span>
                        <div className="entity-meta-row">
                          <Flag iso2={f.country_iso2} name={f.country_name} className="flag" />
                          <span className="cell-meta">{f.country_name || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="entity-stack">
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{f.weight_class || '—'}</span>
                      {f.nickname && <span className="cell-meta">"{f.nickname}"</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {age != null ? (
                      <div className="stat-stack">
                        <span className="stat-stack-value-light">{age}</span>
                        <span className="cell-meta">{birth}</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className={`stats-light ${sorted('seasons')}`} style={{ textAlign: 'center' }}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{f.seasons}</span>
                      <span className="cell-meta">{f.debut_year}-{f.last_year}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {Number(f.title_fights) > 0 ? (
                      <div className="stat-stack">
                        <span className="stat-stack-value-light">{f.title_fights} I <strong>{f.title_wins}</strong></span>
                        <span className="cell-meta">{titleWinPct}% wins</span>
                      </div>
                    ) : '—'}
                  </td>
                  <td className={`stats-light ${sorted('fights', 'winpct')}`} style={{ textAlign: 'center' }}>
                    <div className="stat-stack">
                      <span className="stat-stack-value-light">{f.total_fights}</span>
                      <span className="cell-meta">{overallWinPct}% wins</span>
                    </div>
                  </td>
                  <td className={sorted('wins')} style={{ textAlign: 'center' }}>{f.wins} I {f.losses} I {f.draws}</td>
                  <td className={`stats-light ${sorted('ko', 'finishes')}`} style={{ textAlign: 'center' }}>{f.wins_by_ko}</td>
                  <td className={`stats-light ${sorted('finishes')}`} style={{ textAlign: 'center' }}>{f.wins_by_submission}</td>
                  <td className={`stats-light ${sorted('r1')}`} style={{ textAlign: 'center' }}>{f.first_round_finishes}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
            ‹ Prev
          </button>
          <span className="pagination-info">Page {safePage} / {totalPages}</span>
          <button className="pagination-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
            Next ›
          </button>
        </div>
      )}
    </>
  )
}

// TOTALS -> Fight's List — every decided UFC fight ever recorded, one flat
// row per fight (Mohamed 2026-08-17's own mockup: Rank / Date + weight
// class / Fighter x2 (profile image + name, flag + country) / Location
// (city+country + arena) / Round / Time / Method). Backend already returns
// rows pre-sorted (date desc, heaviest weight class first on same-date
// ties) — no sort dropdown here, unlike TotalsTable, since none was asked
// for and the ordering is fixed by spec rather than user-choosable.
// Method-pill predicates — same convention wins_by_ko/wins_by_submission/
// first_round_finishes already use server-side (/mma/totals, /mma/fighter-
// career), just applied to a single fight's own method/finish_round here
// instead of aggregated across a fighter's career.
function matchesMethodFilter(s, methodFilter) {
  if (!methodFilter) return true
  if (methodFilter === 'ko') return /^KO\/TKO/i.test(s.method || '')
  if (methodFilter === 'sub') return s.method === 'Submission'
  if (methodFilter === 'r1') return s.finish_round === 1 && !/^Decision/i.test(s.method || '')
  return true
}

// Same convention as F1/MotoGP's own Schedule (HomeF1Template.jsx/
// HomeMotoGPTemplate.jsx) — status shown as a colored dot in column 1,
// not a text pill column (Mohamed 2026-08-23: "copy F1/MotoGp... remove
// column Status, add the dot first column").
const STATUS_DOT_COLOR = { past: '#9e9e9e', ongoing: '#4caf52', next: '#ff8c00', upcoming: '#ffb400' }
function StatusDot({ status }) {
  if (!status) return null
  return <span className={f1Styles.eventStatusDot} style={{ background: STATUS_DOT_COLOR[status] }} title={STATUS_LABEL[status]} />
}

// Aggregate, independently-toggleable status pills (Mohamed 2026-08-24:
// "apply aggregate to all pills" — same F1/MotoGP/Tennis convention,
// HomeF1Template.jsx's own STATUS_ORDER/statusFilter Set), plus an
// explicit "All" pill before Past ("show all fights" — the empty-set
// default still means past+next only, same as before; All is the only
// way to see literally everything at once).
const STATUS_ORDER = ['past', 'ongoing', 'next', 'upcoming']

// Schedule of UFC — one row per event (= card grouping already built by
// the `cards` useMemo above: one entry per `round`, headliner-first
// fights, kind 'ppv'/'fn'). Every fight on the card gets its own row
// (Mohamed 2026-08-23: "you must display all fights related to the
// event"), in the same headliner-first order `cards` already sorts them
// in ("always display top fight per bloc"). Date/dot/Location now print
// on EVERY row, not just the card's first (Mohamed 2026-08-24: "seems
// obvious location and dots shall be displayed for every fight" —
// supersedes the previous blank-on-continuation-row version). No per-card
// expansion (Mohamed 2026-08-23: "no more expand/unexpand"). Reuses
// f1.module.css's table/status-pill classes directly (already imported
// into this file as f1Styles) rather than duplicating them.
function HomeUfcTable({ cards, year }) {
  const [typeFilter, setTypeFilter] = useState('') // '' | 'ppv' | 'fn'
  const [statusFilter, setStatusFilter] = useState(() => new Set()) // aggregate — empty = default (past+next)
  const [countryFilter, setCountryFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('') // weight class
  const [genderFilter, setGenderFilter] = useState('') // '' | 'M' | 'F'
  useEffect(() => { setTypeFilter(''); setStatusFilter(new Set()); setCountryFilter(''); setCategoryFilter(''); setGenderFilter('') }, [year])

  if (!cards?.length) return <EmptyState type="default" message="No UFC events recorded for this year." />

  // Latest event first (Mohamed 2026-08-20: "Latest event on top") — the
  // `cards` list itself is built chronologically ascending for the ppv/fn
  // results tabs, so this page deliberately re-sorts rather than reusing
  // that order.
  const sorted = [...cards].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const statusByKey = new Map(classifyByDate(sorted, c => c.date).map(({ item, status }) => [item.key, status]))
  const hasNonPastStatus = [...statusByKey.values()].some(s => s !== 'past')
  const matchesStatus = (status) => statusFilter.size ? statusFilter.has(status) : (status === 'past' || status === 'next')

  // Event-level gates — type and status are properties of the EVENT as a
  // whole, so they decide whether a card appears at all.
  const byTypeStatus = sorted.filter(c => (!typeFilter || c.kind === typeFilter) && matchesStatus(statusByKey.get(c.key)))

  // Country counts (Mohamed 2026-08-24: "All Countries must count All
  // Fighters across all statuses") — deliberately NOT narrowed by the
  // status pills (every fighter who's ever fought this year counts,
  // regardless of past/ongoing/next/upcoming), and now counts every
  // fighter in every fight of the card, not just the headliner's two
  // corners, since every fight is shown. Still respects the Type filter
  // (a different, unrelated facet).
  const byTypeOnly = sorted.filter(c => !typeFilter || c.kind === typeFilter)
  const countryCounts = new Map()
  byTypeOnly.forEach(c => c.fights.forEach(f => {
    const isos = new Set([f.home_country_iso2, f.away_country_iso2].filter(Boolean))
    isos.forEach(iso2 => {
      const name = iso2 === f.home_country_iso2 ? f.home_country_name : f.away_country_name
      const entry = countryCounts.get(iso2) || { name, count: 0 }
      entry.count++
      countryCounts.set(iso2, entry)
    })
  }))
  const countries = [...countryCounts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))

  // Country/category both narrow at the FIGHT level now (hide the fights
  // that don't match, not the whole event) — an event stays visible as
  // long as at least one of its fights still qualifies.
  const matchesCountry = (f) => !countryFilter || f.home_country_iso2 === countryFilter || f.away_country_iso2 === countryFilter

  const categoryCounts = new Map()
  const genderCounts = { M: 0, F: 0 }
  byTypeStatus.forEach(c => c.fights.forEach(f => {
    if (!matchesCountry(f)) return
    const wc = f.stats?.weight_class
    if (!genderFilter || genderFromWeightClass(wc) === genderFilter) {
      if (wc) categoryCounts.set(wc, (categoryCounts.get(wc) || 0) + 1)
    }
    if (!categoryFilter || wc === categoryFilter) {
      genderCounts[genderFromWeightClass(wc)]++
    }
  }))
  const categories = [...categoryCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const rows = byTypeStatus
    .map(c => ({
      ...c,
      fights: c.fights.filter(f =>
        matchesCountry(f) &&
        (!categoryFilter || f.stats?.weight_class === categoryFilter) &&
        (!genderFilter || genderFromWeightClass(f.stats?.weight_class) === genderFilter)
      ),
    }))
    .filter(c => c.fights.length > 0)

  const hasActiveFilter = typeFilter || statusFilter.size > 0 || countryFilter || categoryFilter || genderFilter

  return (
    <>
      <div className="filter-bar">
        <select className="filter-label" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          <option value="ppv">UFC Event</option>
          <option value="fn">Fight Night</option>
        </select>
        <SearchableSelect
          value={countryFilter}
          onChange={setCountryFilter}
          options={countries.map(([iso2, c]) => ({ value: iso2, label: `${c.name} (${c.count})` }))}
          allLabel="All Countries"
        />
        <select className="filter-label" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(([wc, count]) => <option key={wc} value={wc}>{wc} ({count})</option>)}
        </select>
        <select className="filter-label" value={genderFilter} onChange={e => setGenderFilter(e.target.value)}>
          <option value="">All Gender</option>
          <option value="M">Men ({genderCounts.M})</option>
          <option value="F">Women ({genderCounts.F})</option>
        </select>
        {hasNonPastStatus && (
          <div className={f1Styles.statusToggle}>
            <button
              type="button"
              className={`${f1Styles.statusBtn} ${statusFilter.size === STATUS_ORDER.length ? f1Styles.statusBtnActive : ''}`}
              onClick={() => setStatusFilter(prev => prev.size === STATUS_ORDER.length ? new Set() : new Set(STATUS_ORDER))}
            >
              All
            </button>
            {STATUS_ORDER.map(s => (
              <button
                key={s}
                type="button"
                className={`${f1Styles.statusBtn} ${f1Styles[`statusBtn_${s}`]} ${statusFilter.has(s) ? f1Styles.statusBtnActive : ''}`}
                onClick={() => setStatusFilter(prev => {
                  const next = new Set(prev)
                  next.has(s) ? next.delete(s) : next.add(s)
                  return next
                })}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setTypeFilter(''); setStatusFilter(new Set()); setCountryFilter(''); setCategoryFilter(''); setGenderFilter('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} events / {rows.reduce((n, c) => n + c.fights.length, 0)} fights</span>
      </div>

      <div className={f1Styles.tableScroll}>
        <table className={`${f1Styles.table} ${f1Styles.fixedTable} table-thead-border`}>
          <thead>
            <tr>
              {/* Status dot column, before Date (same F1/MotoGP convention). */}
              <th className="table-label" style={{ textAlign: 'center', width: '3%' }}></th>
              <th className="table-label" style={{ textAlign: 'left', width: '10%' }}>Date</th>
              <th className="table-label" style={{ textAlign: 'left', width: '16%' }}>Fighter</th>
              <th className="table-label" style={{ textAlign: 'center', width: '4%' }}>vs</th>
              <th className="table-label" style={{ textAlign: 'left', width: '16%' }}>Fighter</th>
              <th className="table-label" style={{ textAlign: 'left', width: '13%' }}>Category</th>
              <th className="table-label" style={{ textAlign: 'left', width: '17%' }}>Event</th>
              <th className="table-label" style={{ textAlign: 'left', width: '17%' }}>Location</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, ci) => {
              const status = statusByKey.get(c.key)
              const { arena, country } = splitVenue(c.venue, c.hasArena)
              const countryIso2 = venueCountryIso2(country)
              return c.fights.map((f, fi) => {
                const s = f.stats || {}
                const decided = f.winner_id != null
                const homeWon = decided && f.winner_id === f.home_id
                // Winner always shown left when decided (matches
                // FightsListTable's own convention) — the result line
                // (Mohamed 2026-08-24: "add Decision - Split · R5 5:00
                // underneath winner") goes under this side only.
                const left = (!decided || homeWon)
                  ? { name: f.home_name, iso2: f.home_country_iso2, country: f.home_country_name }
                  : { name: f.away_name, iso2: f.away_country_iso2, country: f.away_country_name }
                const right = (!decided || homeWon)
                  ? { name: f.away_name, iso2: f.away_country_iso2, country: f.away_country_name }
                  : { name: f.home_name, iso2: f.home_country_iso2, country: f.home_country_name }
                // "Decision - Split · R5 5:00" (Mohamed 2026-08-24) — round
                // and time join with a plain space, method joins THAT with
                // " · " (only one bullet total, not one per field).
                const resultLabel = decided
                  ? [s.method, [s.finish_round ? `R${s.finish_round}` : null, s.finish_time].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
                  : null
                return (
                  <tr key={f.id} className={`table-row ${f1Styles.homeRow}`} style={{ animationDelay: `${(ci + fi) * 0.02}s` }}>
                    <td style={{ textAlign: 'center', verticalAlign: 'top', paddingTop: 6 }}>
                      <StatusDot status={status} />
                    </td>
                    <td>
                      <div className="stat-stack" style={{ alignItems: 'flex-start' }}>
                        <span className="stat-stack-value-light">{fmtDateShort(c.date)}</span>
                        <span className="cell-meta">{relativeDayLabel(c.date)}</span>
                      </div>
                    </td>
                    <td className="stats-light" style={{ textAlign: 'left' }}>
                      {/* flex-start, not center — the result sub-line
                          below the winner's name needs room to sit under
                          it rather than fighting the flag for vertical
                          center (Mohamed 2026-08-16's top-align rule
                          applies here now that this cell can wrap to 2
                          lines, same as PersonCell elsewhere). */}
                      <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 6 }}>
                        <Flag iso2={left.iso2} name={left.country} className="flag" />
                        <span className="entity-stack">
                          <span className={decided ? styles.fightWinner : undefined} style={{ whiteSpace: 'nowrap' }}>{left.name}</span>
                          {resultLabel && <span className="cell-meta">{resultLabel}</span>}
                        </span>
                      </span>
                    </td>
                    <td className="cell-meta" style={{ textAlign: 'center' }}>vs</td>
                    <td className="stats-light" style={{ textAlign: 'left' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Flag iso2={right.iso2} name={right.country} className="flag" />
                        <span style={{ whiteSpace: 'nowrap' }}>{right.name}</span>
                      </span>
                    </td>
                    {/* Same td class as the Fighter cells (Mohamed
                        2026-08-24: "font size category = font size
                        fighter, event") — cell-meta's 0.8em read smaller
                        than the rest of the row. */}
                    <td className="stats-light" style={{ textAlign: 'left' }}>
                      {s.weight_class}{s.is_title_fight ? ' Title' : ''}
                    </td>
                    <td>
                      <div className="stat-stack" style={{ alignItems: 'flex-start' }}>
                        <span className="stat-stack-value-light">{c.shortLabel}</span>
                        <span className="cell-meta">{c.kind === 'ppv' ? 'UFC Event' : 'Fight Night'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="stat-stack" style={{ alignItems: 'flex-start' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Flag iso2={countryIso2} name={country} className="flag" />
                          <span className="stat-stack-value-light">{country || '—'}</span>
                        </span>
                        {arena && <span className="cell-meta">{arena}</span>}
                      </div>
                    </td>
                  </tr>
                )
              })
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function FightsListTable({ fights, loading, year }) {
  // Single fighter search, either corner (Mohamed 2026-08-19: "remove
  // second All Fighters, useless" — the man-vs-man matchup picker from
  // 2026-08-18 didn't earn its keep, reverted).
  const [fighterFilter, setFighterFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('') // '' | 'ko' | 'sub' | 'r1'
  const [page, setPage] = useState(1)
  useEffect(() => { setFighterFilter(''); setCountryFilter(''); setCategoryFilter(''); setMethodFilter(''); setPage(1) }, [fights])
  useEffect(() => { setPage(1) }, [fighterFilter, countryFilter, categoryFilter, methodFilter, year])

  if (loading) return <div style={{ padding: 16 }}>{[...Array(8)].map((_, i) => (
    <div key={i} className="skeleton" style={{ height: 48, marginBottom: 4, borderRadius: 4 }} />
  ))}</div>
  if (!fights?.length) return <EmptyState type="default" message="No fights recorded yet." />

  // Cumulative through the selected year, not just that one year (Mohamed
  // 2026-08-18: "2020 = all fights from beginning to 2020") — same
  // Dec-31-cutoff convention RankingsTable/TotalsTable already use.
  const cutoff = year < new Date().getFullYear() ? `${year}-12-31` : new Date().toISOString().slice(0, 10)
  const inYear = fights.filter(f => toLocalISODate(f.match_date) <= cutoff)

  // Per-fighter fight counts (Mohamed 2026-08-19: "dont give a shit to see
  // All Players (7899): want to see per Fighter" — the blanket total on
  // the "All Fighters" option itself wasn't useful; each individual
  // fighter's own count is, same "(count)" convention every other
  // dropdown in this table already uses).
  const fighterCounts = new Map()
  inYear.forEach(f => {
    fighterCounts.set(f.home_name, (fighterCounts.get(f.home_name) || 0) + 1)
    fighterCounts.set(f.away_name, (fighterCounts.get(f.away_name) || 0) + 1)
  })
  const names = [...fighterCounts.keys()].sort((a, b) => a.localeCompare(b))

  // Country/category counts, same "(count)" convention TotalsTable uses —
  // a fight with the SAME country in both corners only counts once per
  // country (matches how the fighter search already treats either corner
  // as a hit, not two separate entries).
  const countryCounts = new Map()
  inYear.forEach(f => {
    const isos = new Set([f.home_country_iso2, f.away_country_iso2].filter(Boolean))
    isos.forEach(iso2 => {
      const name = iso2 === f.home_country_iso2 ? f.home_country_name : f.away_country_name
      const entry = countryCounts.get(iso2) || { name, count: 0 }
      entry.count++
      countryCounts.set(iso2, entry)
    })
  })
  const countries = [...countryCounts.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  const categoryCounts = new Map()
  inYear.forEach(f => {
    const wc = f.stats?.weight_class
    if (!wc) return
    categoryCounts.set(wc, (categoryCounts.get(wc) || 0) + 1)
  })
  const categories = [...categoryCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const rows = inYear.filter(f => {
    if (fighterFilter && f.home_name !== fighterFilter && f.away_name !== fighterFilter) return false
    if (countryFilter && f.home_country_iso2 !== countryFilter && f.away_country_iso2 !== countryFilter) return false
    if (categoryFilter && f.stats?.weight_class !== categoryFilter) return false
    if (!matchesMethodFilter(f.stats || {}, methodFilter)) return false
    return true
  })
  const hasActiveFilter = fighterFilter || countryFilter || categoryFilter || methodFilter

  const totalPages = Math.ceil(rows.length / TOTALS_PAGE_SIZE)
  const safePage = Math.min(page, Math.max(1, totalPages))
  const pageSlice = rows.slice((safePage - 1) * TOTALS_PAGE_SIZE, safePage * TOTALS_PAGE_SIZE)

  return (
    <>
      <div className="filter-bar">
        <SearchableSelect
          value={fighterFilter}
          onChange={setFighterFilter}
          options={names.map(name => ({ value: name, label: `${name} (${fighterCounts.get(name)})` }))}
          allLabel="All Fighters"
        />
        <select className="filter-label" value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(([iso2, c]) => <option key={iso2} value={iso2}>{c.name} ({c.count})</option>)}
        </select>
        <select className="filter-label" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(([wc, count]) => <option key={wc} value={wc}>{wc} ({count})</option>)}
        </select>
        <div className={f1Styles.statusToggle}>
          <button
            type="button"
            className={`${f1Styles.statusBtn} ${methodFilter === 'ko' ? f1Styles.statusBtnActive : ''}`}
            onClick={() => setMethodFilter(m => m === 'ko' ? '' : 'ko')}
          >
            Knockout
          </button>
          <button
            type="button"
            className={`${f1Styles.statusBtn} ${methodFilter === 'sub' ? f1Styles.statusBtnActive : ''}`}
            onClick={() => setMethodFilter(m => m === 'sub' ? '' : 'sub')}
          >
            Submission
          </button>
          <button
            type="button"
            className={`${f1Styles.statusBtn} ${methodFilter === 'r1' ? f1Styles.statusBtnActive : ''}`}
            onClick={() => setMethodFilter(m => m === 'r1' ? '' : 'r1')}
          >
            1st Round Finish
          </button>
        </div>
        {hasActiveFilter && (
          <button className="filter-reset" onClick={() => { setFighterFilter(''); setCountryFilter(''); setCategoryFilter(''); setMethodFilter('') }}>
            Clear
          </button>
        )}
        <span className="filter-total">{rows.length} fights</span>
      </div>

      <div className={f1Styles.tableScroll}>
        <table className={`${f1Styles.table} table-thead-border`}>
          <thead>
            <tr>
              <th className={f1Styles.pos}></th>
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Date</th>
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Fighter</th>
              {/* Loser column (winner is always left — see the row-building
                  logic below): "Def." reads with the winner column like
                  the standard MMA result sentence "X def. Y" (Mohamed
                  2026-08-19: "place Def. just before Fighter label"). */}
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Def. Fighter</th>
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Location</th>
              <th className="table-label" style={{ textAlign: 'center', fontWeight: 'bold' }}>Round</th>
              <th className="table-label" style={{ textAlign: 'center', fontWeight: 'bold' }}>Time</th>
              <th className="table-label" style={{ textAlign: 'left', fontWeight: 'bold' }}>Method</th>
            </tr>
          </thead>
          <tbody>
            {pageSlice.map((f, i) => {
              const s = f.stats || {}
              const gender = genderFromWeightClass(s.weight_class)
              const { cityCountry, arena } = splitVenue(s.venue)
              // Winner always shown first (Mohamed 2026-08-19: "always
              // place winner first column") — home/away is just an
              // ingestion-order artifact, not a meaningful "who's left"
              // convention the way it is on the per-card FightRow (which
              // deliberately keeps a fixed home/away corner layout).
              // Falls back to home-first for a draw/no-contest (winner_
              // entity_id null) — there's no winner to prioritize.
              const decided = f.winner_entity_id != null
              const homeWon = decided && f.winner_entity_id === f.home_id
              const left  = (!decided || homeWon)
                ? { name: f.home_name, slug: f.home_slug, iso2: f.home_country_iso2, country: f.home_country_name }
                : { name: f.away_name, slug: f.away_slug, iso2: f.away_country_iso2, country: f.away_country_name }
              const right = (!decided || homeWon)
                ? { name: f.away_name, slug: f.away_slug, iso2: f.away_country_iso2, country: f.away_country_name }
                : { name: f.home_name, slug: f.home_slug, iso2: f.home_country_iso2, country: f.home_country_name }
              return (
                <tr key={f.id} className="table-row" style={{ animationDelay: `${i * 0.02}s` }}>
                  <td className={f1Styles.pos}><span className="event-rank">{(safePage - 1) * TOTALS_PAGE_SIZE + i + 1}</span></td>
                  <td>
                    {/* .stat-stack's own align-items:center (index.css)
                        overrides the <th>'s text-align:left regardless —
                        overridden back to left here specifically (Mohamed
                        2026-08-18: "align date left"). */}
                    <div className="stat-stack" style={{ alignItems: 'flex-start' }}>
                      <span className="stat-stack-value-light">{fmtDate(f.match_date)}</span>
                      <span className="cell-meta">{s.weight_class || '—'}</span>
                    </div>
                  </td>
                  <td>
                    <div className="entity-cell">
                      <AthleteAvatar
                        src={getFighterProfilePath(left.slug, gender)}
                        name={left.name}
                        sport="mma"
                        gender={gender}
                        fallback="letter"
                        className="avatar"
                      />
                      <div className="entity-stack">
                        {/* Winner (always left, by construction above) is
                            bold; loser/draw is explicit normal weight,
                            overriding club-name's own default 600 (Mohamed
                            2026-08-19: "name BOLD css and looser NORMAL
                            css. Draw NORMAL css"). */}
                        <span className={`club-name${decided ? ' ' + styles.fightWinner : ''}`} style={decided ? undefined : { fontWeight: 'normal' }}>{left.name}</span>
                        <div className="entity-meta-row">
                          <Flag iso2={left.iso2} name={left.country} className="flag" />
                          <span className="cell-meta">{left.country || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="entity-cell">
                      <AthleteAvatar
                        src={getFighterProfilePath(right.slug, gender)}
                        name={right.name}
                        sport="mma"
                        gender={gender}
                        fallback="letter"
                        className="avatar"
                      />
                      <div className="entity-stack">
                        <span className="club-name" style={{ fontWeight: 'normal' }}>{right.name}</span>
                        <div className="entity-meta-row">
                          <Flag iso2={right.iso2} name={right.country} className="flag" />
                          <span className="cell-meta">{right.country || '—'}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="entity-stack">
                      <span className="club-name" style={{ fontWeight: 'normal' }}>{cityCountry || '—'}</span>
                      {arena && <span className="cell-meta">{arena}</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>{s.finish_round || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{s.finish_time || '—'}</td>
                  <td>{s.method || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="pagination-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}>
            ‹ Prev
          </button>
          <span className="pagination-info">Page {safePage} / {totalPages}</span>
          <button className="pagination-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}>
            Next ›
          </button>
        </div>
      )}
    </>
  )
}

export default function MmaEventTemplate({ seasonId, tabKey, competitionSlug, competitionName = '', year }) {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  // 'home' | 'schedule' | 'rankings-m' | 'rankings-f' | 'ppv' | 'fn' | 'totals'
  // Watch Center is NOT one of these anymore (Mohamed 2026-08-25: "Watch
  // center item should be place Line B... i dont want to see Video icon
  // on Line A") — it's now a value of activeEventKey (WATCH_TAB_ID) within
  // whichever of ppv/fn is active, same as F1/MotoGP's own
  // activeSessionId === WATCH_TAB_ID pattern, scoped to whichever event
  // was last actually selected (lastRealEventKeyRef below).
  // Backed by the global store, NOT local useState (Mohamed 2026-08-17:
  // changing the year must keep you on whichever section you were on).
  // ContentArea's own season-refetch effect briefly flips `loading` on
  // every year change, which unmounts this whole component while the new
  // year's data loads (renderContent()'s `if (loading) return <skeleton>`)
  // — local state doesn't survive that, a Zustand store does, same fix
  // tennis's activeTennisTotals/Watch/Rankings already use for the exact
  // same problem. See useAppStore.js's own comment on these three fields.
  const section    = useAppStore(s => s.activeMmaSection)
  const setSection = useAppStore(s => s.setMmaSection)
  const storeWeightClass = useAppStore(s => s.activeMmaWeightClass)
  const setMmaWeightClass = useAppStore(s => s.setMmaWeightClass)
  const storeTotalsSub = useAppStore(s => s.activeMmaTotalsSub)
  const setMmaTotalsSub = useAppStore(s => s.setMmaTotalsSub)
  const [activeEventKey, setActiveEventKey] = useState(null) // games_by_round key, ppv/fn only — or WATCH_TAB_ID
  // Remembers the last REAL event key selected (never the watch sentinel
  // itself) so Watch Center — now pinned last in Line B instead of a Line
  // A icon (Mohamed 2026-08-25) — knows which event's videos to show even
  // once activeEventKey itself has moved to WATCH_TAB_ID.
  const lastRealEventKeyRef = useRef(null)
  useEffect(() => {
    if (activeEventKey && activeEventKey !== WATCH_TAB_ID) lastRealEventKeyRef.current = activeEventKey
  }, [activeEventKey])
  // Falls back to a sensible default division/sub-tab until the user picks
  // one explicitly — same role useState's initial value used to play, just
  // not stored itself (storeWeightClass stays null until a real click).
  const activeWeightClass = storeWeightClass || (section === 'rankings-f' ? WOMENS_WEIGHT_CLASSES[0] : MENS_WEIGHT_CLASSES[0])
  const setActiveWeightClass = setMmaWeightClass
  const activeTotalsSub = storeTotalsSub || TOTALS_SUB[0].key
  const setActiveTotalsSub = setMmaTotalsSub
  const [totals, setTotals]             = useState(null)
  const [totalsLoading, setTotalsLoading] = useState(false)
  // Keyed by 'M'/'F' — Men's/Women's Fight List are two independent
  // datasets (Mohamed 2026-08-19: "Do the same Women's Fight List"), each
  // fetched once and cached for the life of this component instance.
  const [fightsListByGender, setFightsListByGender] = useState({})
  const [fightsListLoading, setFightsListLoading] = useState(false)
  const [career, setCareer]       = useState(null)
  const [logoUrl, setLogoUrl]     = useState(null)
  const [competitionId, setCompetitionId] = useState(null)
  const [logoFailed, setLogoFailed] = useState(false)
  // Rankings champion banner's + the per-event fight-card banner's own
  // follow badge (Mohamed 2026-08-24/25: "add fav" — StubBanner's Home/
  // Watch/Totals pages already have one, these two didn't). Same "follow
  // UFC" competitionId both places, so one shared counter is correct.
  const [competitionFollowerCount, loadCompetitionFollowerCount] = useFollowerCount('competition', competitionId)
  const [rankings, setRankings]         = useState(null)
  const [rankingsLoading, setRankingsLoading] = useState(false)

  // Rankings — year-scoped: ingest-ufc-rankings-history.js seeds one
  // snapshot per year (2013-2025, andrewlor.me's own coverage — "latest
  // that year, capped at Dec 31" per Mohamed 2026-08-17), and
  // ingest-ufc-rankings.js's live ufc-fr.com scrape covers whichever year
  // is current right now — both live under the same tab_key per year, so
  // this just re-fetches whenever the page's year selector changes, same
  // as every other MMA section already does.
  const isRankingsSection = section === 'rankings-m' || section === 'rankings-f'
  useEffect(() => {
    if (!isRankingsSection) return
    setRankingsLoading(true)
    api.getMmaRankings(section === 'rankings-m' ? 'men' : 'women', activeWeightClass, year)
      .then(d => setRankings(d?.standings || []))
      .catch(() => setRankings([]))
      .finally(() => setRankingsLoading(false))
  }, [isRankingsSection, section, activeWeightClass, year])

  const isFightsListSub = activeTotalsSub === 'fights-m' || activeTotalsSub === 'fights-f'

  // Totals -> Men's/Women's Stats — all-time, not year-scoped (unlike
  // Rankings above), so this only re-fetches when the Men's/Women's Stats
  // sub-tab itself changes, not on year navigation. Skipped for the
  // Fight List sub-tabs, which read from a different endpoint below.
  useEffect(() => {
    if (section !== 'totals' || isFightsListSub) return
    setTotalsLoading(true)
    api.getMmaTotals(activeTotalsSub === 'women' ? 'F' : 'M')
      .then(d => setTotals(d?.fighters || []))
      .catch(() => setTotals([]))
      .finally(() => setTotalsLoading(false))
  }, [section, activeTotalsSub])

  // Totals -> Men's/Women's Fight List — every decided fight ever recorded
  // for that gender, fetched once per gender and cached (re-fetching on
  // every click into this sub-tab would re-download the same ~7000 rows
  // for no reason).
  useEffect(() => {
    if (section !== 'totals' || !isFightsListSub) return
    const gender = activeTotalsSub === 'fights-f' ? 'F' : 'M'
    if (fightsListByGender[gender]) return
    setFightsListLoading(true)
    api.getMmaFightsList(gender)
      .then(d => setFightsListByGender(prev => ({ ...prev, [gender]: d?.fights || [] })))
      .catch(() => setFightsListByGender(prev => ({ ...prev, [gender]: [] })))
      .finally(() => setFightsListLoading(false))
  }, [section, activeTotalsSub, fightsListByGender])

  // Rankings banner is a "player eventblock" for the division's CHAMPION
  // (standings.position = 0, per ingest-ufc-rankings.js's own convention)
  // rather than a blank StubBanner (Mohamed 2026-08-17: "Eventblock should
  // be player eventblock with stats of the king") — same career fetch the
  // fight-result EventBlock's own winner stat bloc uses, anchored to Dec
  // 31 of the selected year for a historical snapshot (matching that
  // year's own rankings route cutoff) or today for the live/current year
  // — a past year's champion should show their career as it stood then,
  // not inflated with everything since.
  const champion = rankings?.find(r => r.stats?.is_champion) || null
  const [championCareer, setChampionCareer] = useState(null)
  const championThroughDate = year < new Date().getFullYear() ? new Date(`${year}-12-31`) : new Date()
  useEffect(() => {
    if (!champion?.entity_id) { setChampionCareer(null); return }
    api.getMmaFighterCareer(champion.entity_id, championThroughDate.toISOString().slice(0, 10))
      .then(setChampionCareer)
      .catch(() => setChampionCareer(null))
  }, [champion?.entity_id, year])
  const championAge = championCareer ? calcAge(championCareer.birth_date, championThroughDate, championCareer.death_date) : null
  // Same 0-rule zero-suppression as the fight EventBlock's own
  // statBlocRows — just no +1 badges/highlights here, since there's no
  // single fight to attribute "this row moved because of THIS result" to.
  const championStatRows = championCareer ? [
    { key: 'seasons', label: 'Seasons', value: championCareer.seasons },
    { key: 'champion', label: 'Titles', value: championCareer.titles },
    { key: 'record', label: 'Win I Loss I Draw', value: `${championCareer.wins} I ${championCareer.losses} I ${championCareer.draws}`, __alwaysShow: true },
    { key: 'ko', label: 'Wins by knockout', value: championCareer.wins_by_ko },
    { key: 'sub', label: 'Wins by submission', value: championCareer.wins_by_submission },
    { key: 'r1', label: '1st Round Finishes', value: championCareer.first_round_finishes },
  ].filter(row => row.__alwaysShow || Number(row.value) > 0) : null

  // Competition logo (admin-set competitions.logo_url) — same fetch/
  // resolveImg pattern F1ContentArea uses for F1EventBlock's own logo
  // prop, just fetched locally here since MMA has no dedicated
  // ContentArea of its own to fetch it further up and pass down.
  const [firstSeasonYear, setFirstSeasonYear] = useState(null)
  useEffect(() => {
    if (!competitionSlug) { setLogoUrl(null); setFirstSeasonYear(null); setCompetitionId(null); return }
    api.getCompetition(competitionSlug)
      .then(c => { setLogoUrl(c?.logo_url || null); setFirstSeasonYear(c?.first_season_year || null); setCompetitionId(c?.id ?? null) })
      .catch(() => { setLogoUrl(null); setFirstSeasonYear(null); setCompetitionId(null) })
  }, [competitionSlug])

  useEffect(() => {
    if (!seasonId || !tabKey) return
    setLoading(true)
    setError(null)
    setData(null)
    // section is deliberately NOT reset here (Mohamed 2026-08-17: changing
    // the year should keep you on whichever Line A tab you were on —
    // Totals/Men's, Rankings-women, UFC Event, Fight Night, etc.). It stays
    // null only on first mount, which is what lets the "default section on
    // load" effect below pick ppv/fn/home exactly once. activeEventKey IS
    // still reset — the new year's cards have different keys, and the
    // "default card within category" effect already re-derives a sensible
    // one (live/ongoing/next/most-recent) whenever the old key doesn't
    // match anything in the new list.
    setActiveEventKey(null)
    api.getGames(seasonId, tabKey)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [seasonId, tabKey])

  // One "card" per round (= event name, set by ingestufc.js), fights sorted headliner-first
  const cards = useMemo(() => {
    if (!data?.games_by_round) return []
    return Object.entries(data.games_by_round).map(([round, fights]) => {
      const sorted = [...fights].sort((a, b) => (b.stats?.is_headliner ? 1 : 0) - (a.stats?.is_headliner ? 1 : 0))
      const first = sorted[0] || {}
      return {
        key: round,
        name: round,
        shortLabel: shortEventLabel(round),
        date: first.match_date,
        venue: first.venue || first.stats?.venue || null,
        // True when venue came from `stats.venue` (scheduled/upcoming
        // cards, ufc-fr.com source) rather than the flat `g.venue` column
        // (decided cards, ufcstats.com CSV) — see splitVenue's own
        // header comment for why this changes how the string parses.
        hasArena: !first.venue && !!first.stats?.venue,
        kind: first.stats?.event_kind === 'numbered' ? 'ppv' : 'fn',
        fights: sorted,
      }
    }).sort((a, b) => (a.date || '').localeCompare(b.date || '')) // chronological ascending
  }, [data])

  const ppvCards = useMemo(() => cards.filter(c => c.kind === 'ppv'), [cards])
  const fnCards   = useMemo(() => cards.filter(c => c.kind === 'fn'),  [cards])

  // Date-based past/ongoing/next/upcoming classification (utils/
  // eventStatus.js — the same one F1/MotoGP GP pages use) keyed by card,
  // not the old "decided ? past : ongoing" binary — that read every
  // undecided card as "ongoing" including ones weeks out, invisible until
  // ingest-ufc-upcoming.js started actually seeding scheduled fights
  // 2026-08-17 (a real UFC 331, dated ~5 weeks ahead, showed "ONGOING").
  // Classified per KIND (ppv/fn) rather than across the combined list —
  // classifyByDate hands out exactly one 'next' across whatever list it's
  // given, and UFC Num/Fight Night are two independent calendars the UI
  // lets you switch between; a single global "next" would almost always
  // land on whichever kind happens to run more often (Fight Night), which
  // then never lights up "NEXT" on the UFC Num tab at all.
  const cardStatusMap = useMemo(() => {
    const map = new Map()
    classifyByDate(ppvCards, c => c.date).forEach(({ item, status }) => map.set(item.key, status))
    classifyByDate(fnCards, c => c.date).forEach(({ item, status }) => map.set(item.key, status))
    return map
  }, [ppvCards, fnCards])

  // Default section on load: always Schedule (Mohamed 2026-08-23: "home
  // page becoming Schedule / first item of Line A" — supersedes the
  // 2026-08-18 "default page = Home of UFC" version now that Home itself
  // is a blank banner-only landing, same F1/MotoGP Home/Schedule split).
  useEffect(() => {
    if (section || !data) return
    setSection('schedule')
  }, [data, section])

  const isResultsSection = section === 'ppv' || section === 'fn'
  // Chronological ascending, oldest -> newest, left to right (Mohamed
  // 2026-08-23: same Line B convention as F1/MotoGP's own session order
  // fix) — ppvCards/fnCards are already sorted ascending by the `cards`
  // useMemo above, so no re-sort needed here anymore.
  const kindCards = isResultsSection ? (section === 'ppv' ? ppvCards : fnCards) : []
  const isWatchMode = activeEventKey === WATCH_TAB_ID
  const watchCard = isWatchMode ? (kindCards.find(c => c.key === lastRealEventKeyRef.current) || null) : null

  // Default card within the category: ongoing > next-up > most recently
  // decided > (fallback) most-future-dated. With kindCards now ascending,
  // the most RECENT past card is the LAST 'past' match scanning oldest to
  // newest (not the first), and "most future" is the final element — both
  // searched via a reversed copy rather than relying on kindCards' own
  // (now chronological) display order. Skipped entirely while Watch Center
  // is open (isWatchMode) — WATCH_TAB_ID never matches a real card, so
  // without this guard this effect would immediately bounce the user back
  // to a real event on every render.
  useEffect(() => {
    if (!isResultsSection || isWatchMode) return
    if (!kindCards.length) { setActiveEventKey(null); return }
    if (activeEventKey && kindCards.some(c => c.key === activeEventKey)) return
    const live = kindCards.find(c => c.fights.some(f => f.stats?.status === 'live'))
    const ongoing = kindCards.find(c => cardStatusMap.get(c.key) === 'ongoing')
    const next = kindCards.find(c => cardStatusMap.get(c.key) === 'next')
    const mostRecentPast = [...kindCards].reverse().find(c => cardStatusMap.get(c.key) === 'past')
    setActiveEventKey((live || ongoing || next || mostRecentPast || kindCards[kindCards.length - 1]).key)
  }, [isResultsSection, isWatchMode, kindCards, activeEventKey, cardStatusMap])

  const activeCard = isResultsSection ? (kindCards.find(c => c.key === activeEventKey) || null) : null

  const headliner = activeCard ? (activeCard.fights.find(f => f.stats?.is_headliner) || activeCard.fights[0]) : null
  const hs = headliner?.stats || {}
  const decided = activeCard && hs.status === 'final' && headliner.winner_id
  const cardStatus = activeCard ? (cardStatusMap.get(activeCard.key) || 'past') : 'past'
  const winnerId = decided ? headliner.winner_id : null
  const winnerIsHome = decided && headliner.winner_id === headliner.home_id
  const winnerName = decided ? (winnerIsHome ? headliner.home_name : headliner.away_name) : null
  const winnerSlug = decided ? (winnerIsHome ? headliner.home_slug : headliner.away_slug) : null
  const winnerCountryIso2 = decided ? (winnerIsHome ? headliner.home_country_iso2 : headliner.away_country_iso2) : null

  // Career stat bloc — same "career totals through this event's date" fetch
  // F1's ChampionshipBlock/GPBlock use for their own statBloc (see
  // f1.js's /driver-career and F1EventBlock.jsx's careerStatRows).
  useEffect(() => {
    if (!winnerId || !activeCard?.date) { setCareer(null); return }
    api.getMmaFighterCareer(winnerId, toLocalISODate(activeCard.date))
      .then(setCareer)
      .catch(() => setCareer(null))
  }, [winnerId, activeCard?.date])

  const age = career ? calcAge(career.birth_date, activeCard?.date, career.death_date) : null

  // "0 rule" (Mohamed 2026-08-17: "dont display label champion if no
  // title") applied to every row, not just Champion — same zero-
  // suppression convention F1's own careerStatRows already uses. "+1
  // rule": each row is badged/highlighted only when THIS specific
  // headliner fight itself contributed to that count (title win / KO win
  // / submission win / round-1 finish) — known directly from the fight's
  // own stats, no separate delta fetch needed the way F1's per-round
  // badges do (F1 has no single fight-level signal to read a "this round"
  // contribution off of; MMA does). Champion's sub-label ("1st title" /
  // "X Y. ago") mirrors F1's prev_title_year convention exactly, just
  // computed from the exact prev_title_date the backend returns instead
  // of a year-only lookup (UFC runs 30+ events/year, so year granularity
  // alone can't tell "before this fight" from "after it").
  const statBlocRows = career ? (() => {
    const record = `${career.wins} I ${career.losses} I ${career.draws}`
    const prevTitleYears = career.prev_title_date && activeCard?.date
      ? new Date(activeCard.date).getFullYear() - new Date(career.prev_title_date).getFullYear()
      : null
    return [
      { key: 'seasons', label: 'Seasons', value: career.seasons },
      {
        key: 'champion', label: 'Champion', value: career.titles,
        highlighted: !!hs.is_title_fight, badge: '+1',
        // "0 Y. ago" reads as broken, not informative, when the previous
        // title landed the same year as this one (two title fights in one
        // calendar year) — Mohamed 2026-08-17: "disable the feature" for
        // that case, i.e. show no sub-label at all rather than "0 Y. ago".
        sub: career.titles > 0 ? (prevTitleYears ? `${prevTitleYears} Y. ago` : (prevTitleYears == null ? '1st title' : null)) : null,
      },
      { key: 'record', label: 'Win I Loss I Draw', value: record, __alwaysShow: true },
      { key: 'ko', label: 'Wins by knockout', value: career.wins_by_ko, highlighted: /^KO\/TKO/i.test(hs.method || ''), badge: '+1' },
      { key: 'sub', label: 'Wins by submission', value: career.wins_by_submission, highlighted: hs.method === 'Submission', badge: '+1' },
      { key: 'r1', label: '1st Round Finishes', value: career.first_round_finishes, highlighted: hs.finish_round === 1 && !/^Decision/i.test(hs.method || ''), badge: '+1' },
    ].filter(row => row.__alwaysShow || Number(row.value) > 0)
  })() : null

  const maleCount = activeCard ? activeCard.fights.reduce((n, f) => n + (genderFromWeightClass(f.stats?.weight_class) === 'M' ? 2 : 0), 0) : 0
  const femaleCount = activeCard ? activeCard.fights.reduce((n, f) => n + (genderFromWeightClass(f.stats?.weight_class) === 'F' ? 2 : 0), 0) : 0

  // Home banner's season-wide stat row — distinct fighters who actually
  // competed THIS YEAR (not fighter-slot count like maleCount/femaleCount
  // above, which double-counts anyone who fought more than once in the
  // year) across every card already loaded for this season/tab, so no
  // extra fetch is needed. Mohamed 2026-08-17: "SCHEDULE = 2026 I SEASONS
  // = 44 (2026 minus 1994 which is first season) I UFC EVENTS = 13 I
  // FIGHT NIGHTS = 30 ... MEN'S FIGHTER = 22 I WOMEN'S FIGHTER = 4" — his
  // own example numbers didn't reconcile against real data (2026-1994=32,
  // not 44; distinct fighters for 2026 come out to 503 men/79 women, not
  // 22/4), so those two are best-guess interpretations pending
  // confirmation, not verified against a spec — flagged in the reply.
  const yearFighterCounts = useMemo(() => {
    const men = new Set(), women = new Set()
    cards.forEach(c => c.fights.forEach(f => {
      const set = genderFromWeightClass(f.stats?.weight_class) === 'F' ? women : men
      if (f.home_id) set.add(f.home_id)
      if (f.away_id) set.add(f.away_id)
    }))
    return { men: men.size, women: women.size }
  }, [cards])
  const seasonsCount = firstSeasonYear ? year - firstSeasonYear : null
  const yearFightCount = useMemo(() => cards.reduce((n, c) => n + c.fights.length, 0), [cards])

  if (loading) return (
    <div className={styles.wrapper}>
      {[...Array(6)].map((_, i) => <div key={i} className={styles.skeleton} />)}
    </div>
  )

  if (error) return (
    <div className={styles.wrapper}><p className={styles.message}>Could not load results.</p></div>
  )

  if (!data?.games_by_round) return (
    <div className={styles.wrapper}>
      <div className="page-title">Results</div>
      <p className={styles.message}>No {competitionName || 'UFC'} events recorded for this year.</p>
    </div>
  )

  return (
    <div className={styles.wrapper}>

      {/* LINE A — Schedule / Men's Rankings / Women's Rankings / UFC Num /
          Fight Night (scrollable) / Totals (pinned right) — same pinned-
          left/scrollable/pinned-right layout and classes navigation/
          LineA.jsx renders through (see that file's own "Part 1/Part 2/
          Part 3" comment), just driven by this template's own section
          state instead of result_tabs rows. No Watch icon here anymore
          (Mohamed 2026-08-25: "i dont want to see Video icon on Line A") —
          Watch Center now lives pinned last in Line B instead (below),
          scoped to whichever event is selected. Hidden entirely on Home
          (Mohamed 2026-08-26: "Update Home of Tennis... Remove Line A" —
          same sport-wide-hub treatment as Tennis/Basketball; the pinned
          Home button that used to open this bar is gone too, since Home is
          reached via the sidebar/top nav now, not a Line A tab). */}
      {section !== 'home' && (
      <div className={lineAStyles.bar}>
        <div className={lineAStyles.pinnedLeftGroup}>
          <button
            className={`${lineAStyles.tab} ${lineAStyles.homePinned}${section === 'home' ? ' ' + lineAStyles.active : ''}`}
            onClick={() => setSection('home')}
          >
            <span className={lineAStyles.label}>UFC</span>
          </button>
        </div>
        <div className={lineAStyles.scrollWrapper}>
          <div className={lineAStyles.tabs}>
            {/* Schedule — first item of the scrollable group (Mohamed
                2026-08-23: "home page becoming Schedule / first item of
                Line A"); holds the full-season event table that used to
                render directly on Home (see HomeUfcTable's own header
                comment). */}
            <button
              className={`${lineAStyles.tab}${section === 'schedule' ? ' ' + lineAStyles.active : ''}`}
              onClick={() => setSection('schedule')}
            >
              <span className={lineAStyles.label}>
                <span className="ongoing-dot-anchor">
                  Schedule
                  {cards.some(c => cardStatusMap.get(c.key) === 'ongoing') && <span className="ongoing-dot" />}
                </span>
              </span>
            </button>
            <button
              className={`${lineAStyles.tab}${section === 'rankings-m' ? ' ' + lineAStyles.active : ''}`}
              onClick={() => { setSection('rankings-m'); setActiveWeightClass(MENS_WEIGHT_CLASSES[0]) }}
            >
              <span className={lineAStyles.label}>Men's Rankings</span>
            </button>
            <button
              className={`${lineAStyles.tab}${section === 'rankings-f' ? ' ' + lineAStyles.active : ''}`}
              onClick={() => { setSection('rankings-f'); setActiveWeightClass(WOMENS_WEIGHT_CLASSES[0]) }}
            >
              <span className={lineAStyles.label}>Women's Rankings</span>
            </button>
            {['ppv', 'fn'].map(k => {
              const list = k === 'ppv' ? ppvCards : fnCards
              if (!list.length) return null
              // Green ongoing dot (Mohamed 2026-08-23: "green dot line A/B
              // for ongoing events") — lit when any card of this kind is
              // currently in progress, same convention as F1/MotoGP's own
              // per-GP Line A dot.
              const kindOngoing = list.some(c => cardStatusMap.get(c.key) === 'ongoing')
              return (
                <button
                  key={k}
                  className={`${lineAStyles.tab}${section === k ? ' ' + lineAStyles.active : ''}`}
                  onClick={() => { setSection(k); setActiveEventKey(null) }}
                >
                  <span className={lineAStyles.label}>
                    <span className="ongoing-dot-anchor">
                      {k === 'ppv' ? 'UFC Event' : 'Fight Night'}
                      {kindOngoing && <span className="ongoing-dot" />}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <div className={lineAStyles.pinnedGroup}>
          <button
            className={`${lineAStyles.pinnedTab}${section === 'totals' ? ' ' + lineAStyles.active : ''}`}
            onClick={() => setSection('totals')}
            title="Totals"
            aria-label="Totals"
          >
            <svg viewBox="0 0 16 16" className={lineAStyles.barsIcon}>
              <rect x="1" y="9" width="3" height="6" />
              <rect x="6.5" y="5" width="3" height="10" />
              <rect x="12" y="1" width="3" height="14" />
            </svg>
          </button>
        </div>
      </div>
      )}

      {/* LINE B — varies by section: the individual cards (UFC Num/Fight
          Night, Watch Center pinned last — Mohamed 2026-08-25, see
          WATCH_TAB_ID's own comment), weight classes (Rankings), or Men's/
          Women's Stats (Totals). Home has no Line B, same as every other
          sport's Home tab. */}
      {isResultsSection && (
        <div className={lineBStyles.bar}>
          <ScrollableTabs>
            {kindCards.map(c => (
              <button
                key={c.key}
                className={`${lineBStyles.tab}${activeEventKey === c.key ? ' ' + lineBStyles.active : ''}`}
                onClick={() => setActiveEventKey(c.key)}
              >
                <span className={lineBStyles.label}>
                  <span className="ongoing-dot-anchor">
                    {c.shortLabel}
                    {cardStatusMap.get(c.key) === 'ongoing' && <span className="ongoing-dot" />}
                  </span>
                </span>
              </button>
            ))}
            <button
              className={`${lineBStyles.tab}${isWatchMode ? ' ' + lineBStyles.active : ''}`}
              onClick={() => setActiveEventKey(WATCH_TAB_ID)}
            >
              <span className={lineBStyles.label}>▶ Watch Center</span>
            </button>
          </ScrollableTabs>
        </div>
      )}

      {(section === 'rankings-m' || section === 'rankings-f') && (
        <div className={lineBStyles.bar}>
          <ScrollableTabs>
            {(section === 'rankings-m' ? MENS_WEIGHT_CLASSES : WOMENS_WEIGHT_CLASSES).map(wc => (
              <button
                key={wc}
                className={`${lineBStyles.tab}${activeWeightClass === wc ? ' ' + lineBStyles.active : ''}`}
                onClick={() => setActiveWeightClass(wc)}
              >
                <span className={lineBStyles.label}>{wc}</span>
              </button>
            ))}
          </ScrollableTabs>
        </div>
      )}

      {section === 'totals' && (
        <div className={lineBStyles.bar}>
          <ScrollableTabs>
            {TOTALS_SUB.map(t => (
              <button
                key={t.key}
                className={`${lineBStyles.tab}${activeTotalsSub === t.key ? ' ' + lineBStyles.active : ''}`}
                onClick={() => setActiveTotalsSub(t.key)}
              >
                <span className={lineBStyles.label}>{t.label}</span>
              </button>
            ))}
          </ScrollableTabs>
        </div>
      )}

      {/* Real dashboard Home now (Mohamed 2026-08-25: "now create Home
          page of UFC: use Moto Gp tpl: ALL I UFC EVENTS I UFC FIGHT
          NIGHTS") — same shared HomepageTemplate F1/MotoGP/ATP/WTA render
          through, scope="ufc", instead of the blank banner-only landing
          this used to be right after the Home/Schedule split. */}
      {section === 'home' && (
        <>
          {/* Sport-wide "Home of Combat Sport" (Mohamed 2026-08-26) — UFC is
              the only real competition today, so this is the whole hub for
              now, same as Basketball/NBA. */}
          <SportHomeBanner icon={<img src="/media/icons/sports/icon-combat-sport.png" alt="" className={ebStyles.eventCompetitionIconStandalone} />} label="Combat Sport" />
          <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
            <HomepageTemplate scope="ufc" />
          </Suspense>
        </>
      )}

      {section === 'schedule' && (
        <>
          <StubBanner title={`Schedule of UFC ${year}`} breadcrumbExtra="Schedule" year={year} logoUrl={logoUrl} status={year < new Date().getFullYear() ? 'past' : 'ongoing'} entityId={competitionId} />
          <div className="page-subtitle">Full Schedule and Results - {year}</div>
          <HomeUfcTable cards={cards} year={year} />
        </>
      )}

      {section === 'totals' && (() => {
        const totalsLabel = TOTALS_SUB.find(t => t.key === activeTotalsSub)?.label
        // Real coverage — UFC's first ingested season through the browsed
        // year, not the single active year alone (Mohamed 2026-08-26: same
        // fix as every other sport's Totals breadcrumb/subtitle). "Totals"
        // dropped from the breadcrumb (redundant with the range now shown)
        // and the status pill dropped too — a "through <year>" cumulative
        // view has no single season to be past/ongoing (same reasoning
        // F1ContentArea/MotoGPContentArea's own All-Time already applies).
        const hasRange = firstSeasonYear && firstSeasonYear < year
        const totalsYear = hasRange ? `${firstSeasonYear}-${year}` : year
        const totalsSubtitleRange = hasRange ? `from ${firstSeasonYear} to ${year}` : `through ${year}`
        return (
          <>
            <StubBanner
              icon={PillBarsIcon}
              title="Aggregated Stats across the UFC Season"
              breadcrumbExtra={totalsLabel}
              year={totalsYear}
              logoUrl={logoUrl}
              status={null}
              entityId={competitionId}
            />
            <div className="page-subtitle">UFC {totalsLabel} - {totalsSubtitleRange}</div>
            {isFightsListSub
              ? <FightsListTable fights={fightsListByGender[activeTotalsSub === 'fights-f' ? 'F' : 'M']} loading={fightsListLoading} year={year} />
              : <TotalsTable fighters={totals} loading={totalsLoading} gender={activeTotalsSub === 'women' ? 'F' : 'M'} year={year} />
            }
          </>
        )
      })()}

      {isRankingsSection && (
        <>
          {champion ? (
            <div className={ebStyles.wrapper}>
              <div className={ebStyles.banner}>
                <div className={ebStyles.inner}>
                  <div className={ebStyles.left}>
                    <div className={ebStyles.info}>
                      <div className={ebStyles.categoryRow} />
                      <div className={styles.eventNameSmall}>{activeWeightClass} Rankings</div>
                      <div className={ebStyles.eventName}>
                        <span className={ebStyles.eventNameText}>{champion.canonical_name}</span>
                        <span className={ebStyles.areaTag}>Champion</span>
                        <StatusBadge status={year < new Date().getFullYear() ? 'past' : 'ongoing'} />
                      </div>
                      <div className={`${ebStyles.eventNameRow} ${ebStyles.eventWinner} ${styles.winnerRowCenter}`}>
                        <Flag iso2={champion.country_iso2} name={champion.canonical_name} className={`${ebStyles.winnerFlag} ${styles.winnerFlagAlign}`} />
                        {champion.country_name}
                      </div>
                      {(championAge != null) && (
                        <div className={ebStyles.eventDetails}>
                          {championAge} years | {activeWeightClass}
                        </div>
                      )}
                    </div>
                  </div>

                  {championStatRows && (
                    <div className={ebStyles.statBloc}>
                      <div className={ebStyles.statBlocRows}>
                        {championStatRows.map(row => (
                          <div key={row.key} className={ebStyles.statBlocRow}>
                            <span className={ebStyles.statBlocLabel}>{row.label}</span>
                            <span className={ebStyles.statBlocValue}>{row.value}</span>
                          </div>
                        ))}
                      </div>
                      <div className={ebStyles.statBlocTitle}>Career stats</div>
                    </div>
                  )}

                  <div className={`${ebStyles.portraitWrap} ${ebStyles.portraitWrapNarrow}`}>
                    <AthleteAvatar
                      src={getFighterPortraitPath(champion.entity_slug, championCareer?.gender)}
                      name={champion.canonical_name}
                      sport="mma"
                      gender={championCareer?.gender || (section === 'rankings-f' ? 'F' : 'M')}
                      className={`${ebStyles.portrait} ${ebStyles.portraitSquare}`}
                    />
                  </div>
                </div>

                <div className={ebStyles.bottom}>
                  {/* Season-wide stat bar kept on Men's Rankings only
                      (Mohamed 2026-08-18: "this must be kept only for
                      men's rankings") — Women's Rankings still gets the
                      logo + breadcrumb below, just not these stat blocks. */}
                  {section === 'rankings-m' && (
                    <>
                      <div className={ebStyles.statBlock}>
                        <span className={ebStyles.statLabel}>Schedule</span>
                        <span className={ebStyles.statVal}>{year}</span>
                      </div>
                      <div className={ebStyles.statSep} />
                      <div className={ebStyles.statBlock}>
                        <span className={ebStyles.statLabel}>Seasons</span>
                        <span className={ebStyles.statVal}>{seasonsCount ?? '—'}</span>
                      </div>
                      <div className={ebStyles.statSep} />
                      <div className={ebStyles.statBlock}>
                        <span className={ebStyles.statLabel}>Fights</span>
                        <span className={ebStyles.statVal}>{yearFightCount}</span>
                      </div>
                      <div className={ebStyles.statSep} />
                      <div className={ebStyles.statBlock}>
                        <span className={ebStyles.statLabel}>UFC Events</span>
                        <span className={ebStyles.statVal}>{ppvCards.length}</span>
                      </div>
                      <div className={ebStyles.statSep} />
                      <div className={ebStyles.statBlock}>
                        <span className={ebStyles.statLabel}>Fight Nights</span>
                        <span className={ebStyles.statVal}>{fnCards.length}</span>
                      </div>
                      {yearFighterCounts.men > 0 && (
                        <>
                          <div className={ebStyles.statSep} />
                          <div className={ebStyles.statBlock}>
                            <span className={ebStyles.statLabel}>Men's fighters</span>
                            <span className={ebStyles.statVal}>{yearFighterCounts.men}</span>
                          </div>
                        </>
                      )}
                      {yearFighterCounts.women > 0 && (
                        <>
                          <div className={ebStyles.statSep} />
                          <div className={ebStyles.statBlock}>
                            <span className={ebStyles.statLabel}>Women's fighters</span>
                            <span className={ebStyles.statVal}>{yearFighterCounts.women}</span>
                          </div>
                        </>
                      )}
                    </>
                  )}
                  {/* bottomRightGroup (Mohamed 2026-08-24: "Align logo +
                      add fav") — same wrapper StubBanner's own bottom bar
                      uses to push the logo fully right and pair it with a
                      follow star; this banner was missing both. */}
                  <div className={ebStyles.bottomRightGroup}>
                    {competitionId && (
                      <FavouriteStar entityType="competition" entityId={competitionId} label="UFC" variant="badge" onToggled={loadCompetitionFollowerCount} />
                    )}
                    <div className={ebStyles.bottomLogoWrap}>
                      {resolveImg(logoUrl) && !logoFailed
                        ? <img src={resolveImg(logoUrl)} alt="UFC" className={ebStyles.bottomLogo} onError={() => setLogoFailed(true)} />
                        : <span className={ebStyles.allTimeLogoText}>UFC</span>
                      }
                    </div>
                  </div>
                  <div className={`page-title ${ebStyles.breadcrumbLine}`}>
                    <img src="/media/icons/sports/icon-combat-sport.png" alt="" className={ebStyles.breadcrumbIcon} onError={e => { e.target.style.display = 'none' }} />
                    <span>
                      UFC I <span className="page-title-year">{year}</span> I {section === 'rankings-m' ? "Men's" : "Women's"} Rankings I {activeWeightClass}
                      <span style={{ marginLeft: 8 }}><StatusBadge status={year < new Date().getFullYear() ? 'past' : 'ongoing'} /></span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <StubBanner
              title={`${activeWeightClass} Rankings`}
              breadcrumbExtra={`${section === 'rankings-m' ? "Men's" : "Women's"} Rankings I ${activeWeightClass}`}
              year={year}
              logoUrl={logoUrl}
              status={year < new Date().getFullYear() ? 'past' : 'ongoing'}
            />
          )}

          <div className="page-subtitle">UFC {section === 'rankings-m' ? "Men's" : "Women's"} Rankings - {year}</div>

          <RankingsTable rankings={rankings} loading={rankingsLoading} gender={section === 'rankings-m' ? 'M' : 'F'} year={year} />
        </>
      )}

      {isResultsSection && activeCard && (
        <>
          {/* EVENT BLOCK — same wrapper/banner/inner/statBloc/portrait
              structure as F1EventBlock.jsx's Championship/GP blocks, and
              the same EventBlock.module.css every other sport's variant
              renders through — no bespoke MMA banner stylesheet. */}
          <div className={ebStyles.wrapper}>
            <div className={ebStyles.banner}>
              <div className={ebStyles.inner}>
                <div className={ebStyles.left}>
                  <div className={ebStyles.info}>
                    <div className={ebStyles.categoryRow} />
                    {/* UFC Num: Venue I City I Country I Edition ("UFC 331") —
                        Fight Night: Venue I City I Country only, no trailing
                        edition (Fight Night has no number, and appending the
                        matchup here would just repeat the headline right
                        below it — Mohamed 2026-08-17). */}
                    <div className={styles.eventNameSmall}>
                      {[formatVenue(activeCard.venue), activeCard.kind === 'ppv' ? shortEventLabel(activeCard.name) : null]
                        .filter(Boolean).join(' I ')}
                    </div>
                    <div className={ebStyles.eventName}>
                      <span className={ebStyles.eventNameText}>{matchupLabel(activeCard.name)}</span>
                      {decided && <span className={ebStyles.areaTag}>{hs.is_title_fight ? 'Champion' : 'Winner'}</span>}
                      <StatusBadge status={cardStatus} />
                    </div>
                    {decided && (
                      <>
                        {/* .winnerRowCenter overrides the shared
                            .eventNameRow's align-items: flex-start (a
                            deliberate choice there for names that can wrap
                            to 2 lines — see that class's own comment) with
                            center instead: fighter names here are always
                            single-line, where flex-start left the much
                            shorter flag sitting visibly high above the
                            name's vertical center (Mohamed 2026-08-17:
                            "align country flag with fighter name"). */}
                        <div className={`${ebStyles.eventNameRow} ${ebStyles.eventWinner} ${styles.winnerRowCenter}`}>
                          <Flag iso2={winnerCountryIso2} name={winnerName} className={`${ebStyles.winnerFlag} ${styles.winnerFlagAlign}`} />
                          {winnerName}
                          {career?.nickname && <span className={ebStyles.rankSuffix}>"{career.nickname}"</span>}
                        </div>
                        {(age != null || hs.weight_class) && (
                          <div className={ebStyles.eventDetails}>
                            {age != null && `${age} years`}
                            {age != null && hs.weight_class && ' | '}
                            {hs.weight_class}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {statBlocRows && (
                  <div className={ebStyles.statBloc}>
                    <div className={ebStyles.statBlocRows}>
                      {statBlocRows.map(row => (
                        <div key={row.key} className={`${ebStyles.statBlocRow} ${row.highlighted ? ebStyles.statBlocHighlight : ''}`}>
                          <span className={ebStyles.statBlocLabel}>
                            {row.label}
                            {row.highlighted && <span className={ebStyles.statBlocBadge}>{row.badge}</span>}
                          </span>
                          <span className={ebStyles.statBlocValue}>
                            {row.sub && <span className={ebStyles.statBlocSub}>{row.sub} </span>}
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className={ebStyles.statBlocTitle}>Season stats since previous fight</div>
                  </div>
                )}

                <div className={`${ebStyles.portraitWrap} ${ebStyles.portraitWrapNarrow}`}>
                  <AthleteAvatar
                    src={getFighterPortraitPath(winnerSlug, career?.gender)}
                    name={winnerName}
                    sport="mma"
                    gender={career?.gender || 'M'}
                    className={`${ebStyles.portrait} ${ebStyles.portraitSquare}`}
                  />
                </div>
              </div>

              <div className={ebStyles.bottom}>
                <div className={ebStyles.statBlock}>
                  <span className={ebStyles.statLabel}>Schedule</span>
                  <span className={ebStyles.statVal}>{fmtDate(activeCard.date)}</span>
                </div>
                <div className={ebStyles.statSep} />
                <div className={ebStyles.statBlock}>
                  <span className={ebStyles.statLabel}>Edition</span>
                  <span className={ebStyles.statVal}>{shortEventLabel(activeCard.name)}</span>
                </div>
                <div className={ebStyles.statSep} />
                <div className={ebStyles.statBlock}>
                  <span className={ebStyles.statLabel}>Fights</span>
                  <span className={ebStyles.statVal}>{activeCard.fights.length}</span>
                </div>
                {maleCount > 0 && (
                  <>
                    <div className={ebStyles.statSep} />
                    <div className={ebStyles.statBlock}>
                      <span className={ebStyles.statLabel}>Men's fighters</span>
                      <span className={ebStyles.statVal}>{maleCount}</span>
                    </div>
                  </>
                )}
                {femaleCount > 0 && (
                  <>
                    <div className={ebStyles.statSep} />
                    <div className={ebStyles.statBlock}>
                      <span className={ebStyles.statLabel}>Women's fighters</span>
                      <span className={ebStyles.statVal}>{femaleCount}</span>
                    </div>
                  </>
                )}
                {/* bottomRightGroup (Mohamed 2026-08-25: "align logo right
                    + add to fav" — same fix already applied to the
                    Rankings champion banner) — pushes the logo fully
                    right and pairs it with a follow star, matching every
                    StubBanner page's own bottom bar. */}
                <div className={ebStyles.bottomRightGroup}>
                  {competitionId && (
                    <FavouriteStar entityType="competition" entityId={competitionId} label="UFC" variant="badge" onToggled={loadCompetitionFollowerCount} />
                  )}
                  <div className={ebStyles.bottomLogoWrap}>
                    {resolveImg(logoUrl) && !logoFailed
                      ? <img src={resolveImg(logoUrl)} alt="UFC" className={ebStyles.bottomLogo} onError={() => setLogoFailed(true)} />
                      : <span className={ebStyles.allTimeLogoText}>UFC</span>
                    }
                  </div>
                </div>
                <div className={`page-title ${ebStyles.breadcrumbLine}`}>
                  <img src="/media/icons/sports/icon-combat-sport.png" alt="" className={ebStyles.breadcrumbIcon} onError={e => { e.target.style.display = 'none' }} />
                  <span>
                    UFC I <span className="page-title-year">{year}</span> I {activeCard.name}
                    <span style={{ marginLeft: 8 }}><StatusBadge status={cardStatus} /></span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Subtitle = event name + year extension, per the UFC onboarding
              spec's Line A-B sheet (Subtitle/Extension columns: "UFC 320" +
              2026 for numbered cards, "X vs Y" + 2026 for Fight Night —
              i.e. the same text as this card's own Line B tab, not the
              raw round name it's derived from). " - " separator matches
              the app-wide subtitle convention (see ContentArea.jsx's own
              namingSubtitle: `${name} - ${year}`), not a bare space. */}
          <div className="page-subtitle">{activeCard.shortLabel} - {year}</div>

          <PageNotice />

          <div className={styles.fights}>
            {activeCard.fights.map(f => <FightRow key={f.id} fight={f} />)}
          </div>
        </>
      )}

      {isResultsSection && isWatchMode && (() => {
        // Same shared WatchCenterTemplate F1/MotoGP/Tennis all render
        // through (Mohamed 2026-08-25: "use the same tpl as F1, Tennis")
        // — Match Videos scoped to just this event via the generic
        // /results/match-videos/:seasonId route (games+media, no MMA-
        // specific table needed) filtered by round name; Iconic Moments
        // stay season-wide (Mohamed: "Iconic are tied to a season. for me
        // its'ok" — there's no per-event FK for them in this schema,
        // unlike F1's own f1_iconic_moments.grand_prix_id).
        const fetchEventMatchVideos = () => api.getMatchVideos(seasonId).then(d => ({
          items: (d?.items || [])
            .filter(item => item.round === watchCard?.name)
            .map(item => ({ ...item, competition_name: 'UFC' })),
        }))
        const fetchSeasonMoments = () => api.getIconicMoments(seasonId)
        return (
          <>
            <StubBanner
              title={watchCard ? `Watch Center — ${watchCard.shortLabel}` : 'Watch Center'}
              breadcrumbExtra={watchCard ? `${watchCard.shortLabel} I Watch Center` : 'Watch Center'}
              year={year}
              logoUrl={logoUrl}
              status={year < new Date().getFullYear() ? 'past' : 'ongoing'}
              entityId={competitionId}
            />
            <Suspense fallback={<div className="skeleton" style={{ height: 200 }} />}>
              <WatchCenterTemplate
                seasonId={watchCard ? `ufc-event-${watchCard.key}` : null}
                fetchMatchVideos={fetchEventMatchVideos}
                fetchMoments={fetchSeasonMoments}
                year={String(year)}
              />
            </Suspense>
          </>
        )
      })()}

      {isResultsSection && !activeCard && !isWatchMode && (
        <EmptyState type="default" message={`No ${section === 'ppv' ? 'numbered' : 'fight night'} cards recorded for this year.`} />
      )}
    </div>
  )
}
