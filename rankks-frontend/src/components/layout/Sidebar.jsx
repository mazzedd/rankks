import { useEffect, useState } from 'react'
import useAppStore from '../../store/useAppStore'
import useUserStore from '../../store/useUserStore'
import { api } from '../../services/api'
import SidebarFavourites from './SidebarFavourites'
import FavouriteStar from '../shared/FavouriteStar'
import styles from './sidebarStyles.module.css'

const ATP_SLUGS = ['atp-masters-1000', 'atp-masters-500', 'atp-masters-250', 'atp-finals', 'atp-various']
const WTA_SLUGS = ['wta-1000', 'wta-500', 'wta-250', 'wta-finals']

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/media/')) return url
  return `/media/${url}`
}

// TOPICS / FAVOURITES switch — replaces the old always-stacked layout
// (sport list + a separate favourites card shown at the same time).
// Defaults to 'topics'; a signed-in user with a saved
// sidebar_default_view preference (My Account settings) opens straight
// into whichever pane they picked instead.
function ViewToggle({ view, setView }) {
  return (
    <div className={styles.viewToggle}>
      <button
        type="button"
        className={`${styles.viewToggleBtn}${view === 'topics' ? ' ' + styles.active : ''}`}
        onClick={() => setView('topics')}
      >
        Topics
      </button>
      <button
        type="button"
        className={`${styles.viewToggleBtn}${view === 'favourites' ? ' ' + styles.active : ''}`}
        onClick={() => setView('favourites')}
      >
        Favourites
      </button>
    </div>
  )
}

export default function Sidebar() {
  const { activeSport, activeCompetition, activeCategory, activeHomeHub, changeCompetition, setCategory, setTab, setHomeHub } = useAppStore()

  // Clicking a competition from the Topics list should land on its Home
  // tab, not wherever the previous competition/tab happened to be —
  // changeCompetition itself intentionally preserves activeTab (see its
  // own comment in useAppStore.js), so the Home redirect has to happen
  // here at the call site instead.
  const goToCompetitionHome = (slug) => { changeCompetition(slug); setTab('home') }
  const user = useUserStore(s => s.user)
  const [sportData, setSportData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState('topics')

  useEffect(() => {
    if (!activeSport) return
    setLoading(true)
    api.getSport(activeSport)
      .then(setSportData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeSport])

  // Only auto-opens into Favourites on load when that's the user's saved
  // preference — a manual toggle click during the session isn't reverted
  // by unrelated user-object updates, since this only re-runs on login/logout.
  useEffect(() => {
    if (user?.sidebar_default_view === 'favourites') setView('favourites')
  }, [user?.id])

  if (!activeSport) return (
    <aside className={styles.sidebar}>
      <div className={styles.empty}><p>Select a sport</p></div>
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
          <ViewToggle view={view} setView={setView} />
          {view === 'favourites' ? <SidebarFavourites /> : (
            <>
              <div className={styles.header}>
                <span className={styles.sidebarTitle}>{sportData?.name}</span>
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
                      {comps.map(c => (
                        <CompBtn
                          key={c.id}
                          id={c.id}
                          name={c.sidebar_name || c.name}
                          slug={c.slug}
                          logoUrl={c.logo_url}
                          active={activeCompetition === c.slug}
                          onSelect={goToCompetitionHome}
                        />
                      ))}
                    </div>
                  )
                })}
              </nav>
            </>
          )}
        </div>
      </aside>
    )
  }

  // ── FOOTBALL sidebar (unchanged) ─────────────────────────────
  if (!isTennis) {
    return (
      <aside className={styles.sidebar}>
        <div className={styles.sportBlock}>
          <ViewToggle view={view} setView={setView} />
          {view === 'favourites' ? <SidebarFavourites /> : (
            <>
              <div className={styles.header}>
                <span className={styles.sidebarTitle}>{sportData?.name}</span>
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
                        id={c.id}
                        name={c.sidebar_name || c.name}
                        slug={c.slug}
                        logoUrl={c.logo_url}
                        active={activeCompetition === c.slug}
                        onSelect={changeCompetition}
                      />
                    )
                  }
                  return (
                    <div key={cat.id} className={styles.group}>
                      <div className={styles.groupLabel}>{cat.short_name}</div>
                      {comps.map(c => (
                        <CompBtn
                          key={c.id}
                          id={c.id}
                          name={c.sidebar_name || c.name}
                          slug={c.slug}
                          logoUrl={c.logo_url}
                          active={activeCompetition === c.slug}
                          onSelect={goToCompetitionHome}
                          indent
                        />
                      ))}
                    </div>
                  )
                })}
              </nav>
            </>
          )}
        </div>
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
        <ViewToggle view={view} setView={setView} />
        {view === 'favourites' ? <SidebarFavourites /> : (
          <>
            <div className={styles.header}>
              <span className={styles.sportName}>{sportData?.name}</span>
            </div>
            <nav className={styles.nav}>

              {/* Grand Slam — top-level, same tier as ATP/WTA (not nested
                  under either), always first. Each sidebar item is
                  individually clickable (2026-08-09, final) — opens its
                  own category page (Australian Open/Roland Garros/
                  Wimbledon/US Open on Line A, pinned Home/Watch center/
                  Totals ahead of it — see LineA.jsx's competitions
                  branch), same as every item below. Tagged 'atp' (shared
                  mixed-gender category, no per-tour view of its own — the
                  pinned Home icon on that page still goes to Home of ATP
                  either way). Falls back to Home of ATP automatically if
                  the category is ever empty for the selected year (see
                  ContentArea.jsx's categoryComps.length === 0 branch) —
                  never a blank page. */}
              {grandSlam && (
                <button
                  type="button"
                  className={`${styles.sectionLabel}${activeCategory === grandSlam.slug ? ' ' + styles.sectionLabelActive : ''}`}
                  onClick={() => setCategory(grandSlam.slug, 'atp')}
                >
                  {activeCategory === grandSlam.slug && <span className={styles.indicator} />}
                  Grand Slam
                </button>
              )}

              {/* ATP section — the label itself is non-interactive ("ATP
                  and WTA: no link"). Every subcategory underneath (Masters
                  1000/500/250/Finals/Various) is individually clickable,
                  same pattern as Grand Slam above. */}
              {atpCats.length > 0 && (
                <>
                  <div className={`${styles.sectionLabel}${activeHomeHub === 'atp' ? ' ' + styles.sectionLabelActive : ''}`}>
                    ATP
                  </div>
                  {atpCats.map(cat => (
                    <CatBtn
                      key={cat.id}
                      cat={cat}
                      isActive={activeCategory === cat.slug}
                      onSelect={() => setCategory(cat.slug, 'atp')}
                      indent
                    />
                  ))}
                </>
              )}

              {/* WTA section — same pattern as ATP above. */}
              {wtaCats.length > 0 && (
                <>
                  <div className={`${styles.sectionLabel}${activeHomeHub === 'wta' ? ' ' + styles.sectionLabelActive : ''}`}>
                    WTA
                  </div>
                  {wtaCats.map(cat => (
                    <CatBtn
                      key={cat.id}
                      cat={cat}
                      isActive={activeCategory === cat.slug}
                      onSelect={() => setCategory(cat.slug, 'wta')}
                      indent
                    />
                  ))}
                </>
              )}

            </nav>
          </>
        )}
      </div>
    </aside>
  )
}

function CatBtn({ cat, onSelect, indent, isActive }) {
  return (
    <button
      className={`${styles.comp}${isActive ? ' ' + styles.active : ''}${indent ? ' ' + styles.indent : ''}`}
      onClick={onSelect}
    >
      {isActive && <span className={styles.indicator} />}
      <span className={styles.sidebarSport}>{cat.short_name}</span>
    </button>
  )
}

function CompBtn({ id, name, slug, logoUrl, active, onSelect, indent }) {
  return (
    <div className={`${styles.comp}${active ? ' ' + styles.active : ''}${indent ? ' ' + styles.indent : ''}`}>
      {active && <span className={styles.indicator} />}
      <button type="button" className={styles.compLabel} onClick={() => onSelect(slug)}>
        {logoUrl
          ? <img src={resolveImg(logoUrl)} alt="" className={styles.compLogo} />
          : <span className={styles.compLogoFallback}>{(name || '?')[0]}</span>}
        <span className={styles.sidebarSport}>{name}</span>
      </button>
      {id && (
        <span className={styles.compStar}>
          <FavouriteStar entityType="competition" entityId={id} label={name} size="sm" />
        </span>
      )}
    </div>
  )
}
