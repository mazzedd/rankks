import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import useAppStore from '../../store/useAppStore'
import { api } from '../../services/api'
import { pathForCompetitionSameSport, pathForAccountSection, pathForPartners, pathForTennisHub, pathForTennisTourSchedule } from '../../routing/urlSchema'
import { isModifiedClick } from '../../routing/isModifiedClick'
import styles from './sidebarStyles.module.css'

const ATP_SLUGS = ['atp-masters-1000', 'atp-masters-500', 'atp-masters-250', 'atp-finals', 'atp-various']
const WTA_SLUGS = ['wta-1000', 'wta-500', 'wta-250', 'wta-finals']

// Moto 2/Moto 3 (Mohamed 2026-08-23: "Moto 2 and Moto 3 seat now under
// Moto GP in sidebar. No more category dropdown needed on Line B") — not
// real DB categories/competitions the way ATP's Masters tiers are (Moto
// GP/Moto 2/Moto 3 share one competition, `motogp`, and one GP calendar;
// "category" is a query-param-only concept scoped inside that single
// competition — see MotoGPContentArea.jsx's own file header). Hardcoded
// here for the same reason ATP_SLUGS/WTA_SLUGS above are: there's no API
// list to derive this from.
const MOTO_SUB_CATEGORIES = [
  { slug: 'moto2', short_name: 'Moto 2' },
  { slug: 'moto3', short_name: 'Moto 3' },
]

const ACCOUNT_SECTIONS = [
  { key: 'settings',   label: 'Settings' },
  { key: 'favourites', label: 'Favourites' },
  { key: 'videos',     label: 'Videos' },
  { key: 'votes',      label: 'Votes' },
  { key: 'reports',    label: 'My Reports' },
]

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

export default function Sidebar() {
  const store = useAppStore()
  const { activeSport, activeCompetition, activeCategory, activeHomeHub, activeMotoCategory, changeCompetition, setMotoCategory, setTab, setMmaSection, setHomeHub, goToTennisHub, goToTennisTourSchedule, accountPage, accountSection, setAccountSection, partnersPage, openPartnersPage } = store

  // Clicking a competition from the Topics list should land on its
  // Schedule tab (Mohamed 2026-08-26: "any click on a sidebar item leads
  // to Schedule page of the concerned league" — supersedes the same day's
  // earlier "...leads to Home" behavior below). changeCompetition itself
  // intentionally preserves activeTab (see its own comment in
  // useAppStore.js), so the redirect has to happen here at the call site
  // instead. MMA tracks its own Line A section in activeMmaSection, not
  // activeTab (see MmaEventTemplate.jsx) — same reasoning as
  // pathForCompetitionSameSport's own MMA branch. `tab` lets callers fall
  // back to 'home' for the rare football competition with no real
  // Schedule tab of its own (UCL — see sports.js's has_schedule_tab
  // comment for why forcing 'schedule' there would render nothing).
  const goToCompetitionSchedule = (slug, tab = 'schedule') => {
    changeCompetition(slug)
    if (activeSport === 'mma') setMmaSection(tab)
    else setTab(tab)
  }
  // Football is the only sport where Schedule isn't guaranteed to exist
  // (basketball/mma/car-racing all synthesize it unconditionally — see
  // home_template.jsx's isBasketball check, MmaEventTemplate's 'schedule'
  // section, F1/MotoGPContentArea's isScheduleMode) — see sports.js's own
  // has_schedule_tab comment for exactly which football competitions
  // qualify (round-robin leagues + World Cup, not UCL).
  const scheduleTabFor = (c) => activeSport === 'football' && c.has_schedule_tab === false ? 'home' : 'schedule'
  const [sportData, setSportData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activeSport || accountPage) return
    setLoading(true)
    api.getSport(activeSport)
      .then(setSportData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeSport, accountPage])

  // ── ACCOUNT PAGE sidebar — Settings/Favourites/Votes instead of whatever
  //    sport was last being browsed (Mohamed 2026-08-19: "reorganise
  //    account page", replacing one long stacked-sections page with a real
  //    sidebar-driven page like every other section of the site). Checked
  //    before the !activeSport/loading returns below since the account
  //    page is reachable with no sport selected at all.
  if (accountPage) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.sportBlock}>
          <div className={styles.header}>
            <span className={styles.sportName}>My Account</span>
          </div>
          <nav className={styles.nav}>
            {ACCOUNT_SECTIONS.map(({ key, label }) => (
              <Link
                key={key}
                to={pathForAccountSection(store, key)}
                className={`${styles.comp}${accountSection === key ? ' ' + styles.active : ''}`}
                onClick={e => !isModifiedClick(e) && setAccountSection(key)}
              >
                {accountSection === key && <span className={styles.indicator} />}
                <span className={styles.sidebarSport}>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </aside>
    )
  }

  if (!activeSport) return (
    <aside className={styles.sidebar}>
      <div className={styles.empty}><p>Select a sport</p></div>
      <MoreNavBlock store={store} partnersPage={partnersPage} openPartnersPage={openPartnersPage} />
    </aside>
  )

  if (loading) return (
    <aside className={styles.sidebar}>
      <div className={styles.loading}>
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`${styles.sk} skeleton`} />
        ))}
      </div>
    </aside>
  )

  const cats = sportData?.categories || []
  const isTennis   = activeSport === 'tennis'
  const isCarRacing = activeSport === 'car-racing'

  // ── CAR RACING sidebar — only show championship entries, not individual GPs ─
  if (isCarRacing) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.sportBlock}>
          <div className={styles.header}>
            <span className={styles.sidebarTitle}>Quick Links</span>
          </div>
          <nav className={styles.nav}>
            {cats.map(cat => {
              // Only show the championship competition (slug contains no year suffix)
              const comps = (cat.competitions || []).filter(c =>
                !/-\d{4}$/.test(c.slug)
              )
              if (!comps.length) return null
              return (
                <div key={cat.id} className={styles.group}>
                  {comps.map(c => {
                    // Moto GP gets Moto 2/Moto 3 nested underneath it
                    // (Mohamed 2026-08-23) — see MOTO_SUB_CATEGORIES'
                    // own comment for why these aren't real DB categories
                    // like ATP's Masters tiers above.
                    const isMotoGP = c.slug === 'motogp'
                    // F1/MotoGP each own their own nav tree (F1ContentArea/
                    // MotoGPContentArea, not the generic ContentArea.jsx)
                    // with sport-prefixed Schedule tab keys of their own
                    // ('f1-schedule'/'motogp-schedule', not the plain
                    // 'schedule' every other sport uses) — see those files'
                    // own isScheduleMode. Passing the generic key here
                    // silently fell through to Standings (found 2026-08-26
                    // while wiring up "any sidebar click -> Schedule").
                    const scheduleTab = isMotoGP ? 'motogp-schedule' : 'f1-schedule'
                    return (
                      <div key={c.id}>
                        <CompBtn
                          name={c.sidebar_name || c.name}
                          slug={c.slug}
                          logoUrl={c.sidebar_logo_url || c.logo_url}
                          active={activeCompetition === c.slug && (!isMotoGP || activeMotoCategory === 'motogp')}
                          onSelect={(slug) => { goToCompetitionSchedule(slug, scheduleTab); if (isMotoGP) setMotoCategory('motogp') }}
                          href={pathForCompetitionSameSport(store, c.slug, scheduleTab)}
                          hasOngoing={c.has_ongoing}
                        />
                        {isMotoGP && MOTO_SUB_CATEGORIES.map(mc => (
                          <CatBtn
                            key={mc.slug}
                            cat={mc}
                            isActive={activeCompetition === 'motogp' && activeMotoCategory === mc.slug}
                            onSelect={() => { goToCompetitionSchedule('motogp', 'motogp-schedule'); setMotoCategory(mc.slug) }}
                            href={pathForCompetitionSameSport(store, 'motogp', 'motogp-schedule')}
                            indentLogo
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </nav>
        </div>
        <MoreNavBlock store={store} partnersPage={partnersPage} openPartnersPage={openPartnersPage} />
      </aside>
    )
  }

  // ── FOOTBALL sidebar ──────────────────────────────────────────
  // Football's competitions each sit alone in their own category
  // (category_id is 1-to-1 with slug: Ligue 1/UEFA Champions League/
  // Premier League/Bundesliga/La Liga/Serie A/FIFA World Cup are 7
  // separate one-competition categories, verified live) — every one of
  // them hits the comps.length<=1 branch below, the SAME branch NBA/UFC
  // hit (each sport genuinely has just one category, one competition).
  // The two cases need opposite behavior even though they share a branch:
  // NBA/UFC have nothing else to switch TO, so every sidebar click is
  // "go to my one competition's Home" (Mohamed 2026-08-26, see below);
  // football's 7 categories ARE siblings to switch between, and Mohamed
  // now wants that switch to preserve whatever Line A/B item you were on
  // (2026-08-26: "user can browse Team Stats 2025 UCL to 2025 Ligue 1...
  // the same for other Line A/B items") — cats.length > 1 is exactly that
  // "there are siblings to switch between" signal, data-driven off however
  // many categories this sport actually has rather than a hardcoded sport
  // check, so any future sport shaped like football (many one-competition
  // categories) gets the same tab-preserving behavior for free.
  //
  // 2026-08-26 update: every sidebar click — single-competition category
  // or sibling — now forces the Schedule tab instead (see
  // goToCompetitionSchedule's own comment above), so the two branches
  // below no longer differ in that respect; both still exist because the
  // rendered markup differs (grouped under a category label vs standalone).
  if (!isTennis) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.sportBlock}>
          <div className={styles.header}>
            <span className={styles.sidebarTitle}>Quick Links</span>
          </div>
          <nav className={styles.nav}>
            {cats.map(cat => {
              const comps = cat.competitions || []
              if (comps.length <= 1) {
                const c = comps[0]
                if (!c) return null
                return (
                  <CompBtn
                    key={c.id}
                    name={c.sidebar_name || c.name}
                    slug={c.slug}
                    logoUrl={c.sidebar_logo_url || c.logo_url}
                    active={activeCompetition === c.slug}
                    onSelect={() => goToCompetitionSchedule(c.slug, scheduleTabFor(c))}
                    href={pathForCompetitionSameSport(store, c.slug, scheduleTabFor(c))}
                    hasOngoing={c.has_ongoing}
                  />
                )
              }
              return (
                <div key={cat.id} className={styles.group}>
                  <div className={styles.groupLabel}>{cat.short_name}</div>
                  {comps.map(c => (
                    <CompBtn
                      key={c.id}
                      name={c.sidebar_name || c.name}
                      slug={c.slug}
                      logoUrl={c.sidebar_logo_url || c.logo_url}
                      active={activeCompetition === c.slug}
                      // Sibling competitions in the same category (Ligue 1 /
                      // UEFA Champions League / Premier League / Bundesliga /
                      // La Liga / Serie A) now redirect to Schedule too
                      // (Mohamed 2026-08-26: "any click on a sidebar item
                      // leads to Schedule page of the concerned league" —
                      // supersedes the same day's earlier tab-preserving
                      // "user can browse Team Stats 2025 UCL to 2025 Ligue
                      // 1" behavior). scheduleTabFor falls back to 'home'
                      // for UCL specifically, which has no real Schedule
                      // tab of its own.
                      onSelect={() => goToCompetitionSchedule(c.slug, scheduleTabFor(c))}
                      href={pathForCompetitionSameSport(store, c.slug, scheduleTabFor(c))}
                      hasOngoing={c.has_ongoing}
                      indent
                    />
                  ))}
                </div>
              )
            })}
          </nav>
        </div>
        <MoreNavBlock store={store} partnersPage={partnersPage} openPartnersPage={openPartnersPage} />
      </aside>
    )
  }

  // ── TENNIS sidebar ────────────────────────────────────────────
  const grandSlam = cats.find(c => c.slug === 'grand-slam')
  const atpCats   = cats.filter(c => ATP_SLUGS.includes(c.slug))
  const wtaCats   = cats.filter(c => WTA_SLUGS.includes(c.slug))

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sportBlock}>
        <div className={styles.header}>
          <span className={styles.sportName}>Quick Links</span>
        </div>
        <nav className={styles.nav}>

          {/* Grand Slam — top-level, same tier as ATP/WTA (not nested
              under either), always first. Leads to Schedule of ATP
              (Mohamed 2026-08-26: "any click on Grand Slam -> schedule of
              ATP" — Grand Slam has no tour of its own, so it defaults to
              ATP, same as its shared-category 'atp' tag everywhere else),
              superseding the same day's earlier "opens its own category
              page" behavior. */}
          {grandSlam && (
            <Link
              to={pathForTennisTourSchedule(store, 'atp', grandSlam.slug)}
              className={`${styles.sectionLabel}${activeCategory === grandSlam.slug ? ' ' + styles.sectionLabelActive : ''}`}
              onClick={e => !isModifiedClick(e) && goToTennisTourSchedule('atp', grandSlam.slug)}
            >
              {activeCategory === grandSlam.slug && <span className={styles.indicator} />}
              {grandSlam.logo_url && <img src={resolveImg(grandSlam.logo_url)} alt="" className={styles.sectionLabelLogo} />}
              <span className="ongoing-dot-anchor">
                Grand Slam
                {grandSlam.competitions?.some(c => c.has_ongoing) && <span className="ongoing-dot" />}
              </span>
            </Link>
          )}

          {/* ATP section label — still goes to the merged Home of Tennis
              hub (Mohamed 2026-08-26: "No more Home of ATP neither Home of
              WTA" — unaffected by the change below). Every subcategory
              underneath (Masters 1000/500/250/Finals/Various) now leads to
              Schedule of ATP instead of its own category page (Mohamed
              2026-08-26: "any click on a subcat of ATP -> Schedule of
              ATP"). */}
          {atpCats.length > 0 && (
            <>
              <Link
                to={pathForTennisHub(store, 'atp')}
                className={`${styles.sectionLabel}${activeHomeHub === 'tennis' ? ' ' + styles.sectionLabelActive : ''}`}
                onClick={e => !isModifiedClick(e) && goToTennisHub('atp')}
              >
                {sportData?.tour_logos?.atp && <img src={resolveImg(sportData.tour_logos.atp)} alt="" className={styles.sectionLabelLogo} />}
                ATP
              </Link>
              {atpCats.map(cat => (
                <CatBtn
                  key={cat.id}
                  cat={cat}
                  isActive={activeCategory === cat.slug}
                  onSelect={() => goToTennisTourSchedule('atp', cat.slug)}
                  href={pathForTennisTourSchedule(store, 'atp', cat.slug)}
                  hasOngoing={cat.competitions?.some(c => c.has_ongoing)}
                  indent
                />
              ))}
            </>
          )}

          {/* WTA section label — same pattern as ATP above. */}
          {wtaCats.length > 0 && (
            <>
              <Link
                to={pathForTennisHub(store, 'wta')}
                className={`${styles.sectionLabel}${activeHomeHub === 'tennis' ? ' ' + styles.sectionLabelActive : ''}`}
                onClick={e => !isModifiedClick(e) && goToTennisHub('wta')}
              >
                {sportData?.tour_logos?.wta && <img src={resolveImg(sportData.tour_logos.wta)} alt="" className={styles.sectionLabelLogo} />}
                WTA
              </Link>
              {wtaCats.map(cat => (
                <CatBtn
                  key={cat.id}
                  cat={cat}
                  isActive={activeCategory === cat.slug}
                  onSelect={() => goToTennisTourSchedule('wta', cat.slug)}
                  href={pathForTennisTourSchedule(store, 'wta', cat.slug)}
                  hasOngoing={cat.competitions?.some(c => c.has_ongoing)}
                  indent
                />
              ))}
            </>
          )}

        </nav>
      </div>
      <MoreNavBlock store={store} partnersPage={partnersPage} openPartnersPage={openPartnersPage} />
    </aside>
  )
}

function MoreNavBlock({ store, partnersPage, openPartnersPage }) {
  return (
    <div className={styles.sportBlock}>
      <div className={styles.header}>
        <span className={styles.sidebarTitle}>Topics</span>
      </div>
      <nav className={styles.nav}>
        <div className={styles.comp}>
          <span className={styles.compLabel}>
            <img src="/media/icons/various/icon-player.png" alt="" className={styles.compLogo} />
            <span className={styles.sidebarSport}>Athletes</span>
          </span>
        </div>
        <div className={styles.comp}>
          <span className={styles.compLabel}>
            <img src="/media/icons/various/icon-club.png" alt="" className={styles.compLogo} />
            <span className={styles.sidebarSport}>Clubs</span>
          </span>
        </div>
        <div className={`${styles.comp}${partnersPage ? ' ' + styles.active : ''}`}>
          {partnersPage && <span className={styles.indicator} />}
          <Link
            to={pathForPartners(store)}
            className={styles.compLabel}
            onClick={e => !isModifiedClick(e) && openPartnersPage()}
          >
            <img src="/media/icons/various/icon-brand.png" alt="" className={styles.compLogo} />
            <span className={styles.sidebarSport}>Partners</span>
          </Link>
        </div>
      </nav>
    </div>
  )
}

function CatBtn({ cat, onSelect, href, indent, indentLogo, isActive, hasOngoing }) {
  return (
    <Link
      to={href}
      className={`${styles.comp}${isActive ? ' ' + styles.active : ''}${indent ? ' ' + styles.indent : ''}${indentLogo ? ' ' + styles.indentLogo : ''}`}
      onClick={e => !isModifiedClick(e) && onSelect()}
    >
      {isActive && <span className={styles.indicator} />}
      <span className="ongoing-dot-anchor">
        <span className={styles.sidebarSport}>{cat.short_name}</span>
        {hasOngoing && <span className="ongoing-dot" />}
      </span>
    </Link>
  )
}

function CompBtn({ name, slug, logoUrl, active, onSelect, href, indent, hasOngoing }) {
  return (
    <div className={`${styles.comp}${active ? ' ' + styles.active : ''}${indent ? ' ' + styles.indent : ''}`}>
      {active && <span className={styles.indicator} />}
      <Link to={href} className={styles.compLabel} onClick={e => !isModifiedClick(e) && onSelect(slug)}>
        {logoUrl
          ? <img src={resolveImg(logoUrl)} alt="" className={styles.compLogo} />
          : <span className={styles.compLogoFallback}>{(name || '?')[0]}</span>}
        <span className="ongoing-dot-anchor">
          <span className={styles.sidebarSport}>{name}</span>
          {hasOngoing && <span className="ongoing-dot" />}
        </span>
      </Link>
    </div>
  )
}
