// src/routing/urlSchema.js
//
// Pure, bidirectional mapping between the app's navigation state (the
// subset of useAppStore.js's fields that determine what ContentArea.jsx
// renders) and a real URL path — the sync layer's single source of truth
// for "what does this state look like as a URL" and vice versa. No React,
// no store access here — see useUrlSync.js for the hook that wires this to
// the store/router.
//
// stateToPath's branch order deliberately MIRRORS ContentArea.jsx's own
// top-level early-return order exactly (favourite view > tennis totals/
// rankings/watch > tennis home hub > bare homepage > F1/MotoGP > generic),
// since this function's whole job is "what URL corresponds to what
// ContentArea will actually render" — getting the order wrong would produce
// a URL for a page that isn't the one on screen.
//
// Locale: an optional '/fr' prefix — no prefix at all for English (the
// default), matching Mohamed's explicit rule (2026-08-21: "rankks/fr/page
// url. rankks/page url remains the default one (english)"). No translated
// strings exist yet; this only reserves the URL shape.

const LOCALE_PREFIXES = { fr: '/fr' }

function prefixFor(locale) {
  return LOCALE_PREFIXES[locale] || ''
}

export function stateToPath(state) {
  const {
    locale, activeSport, activeCategory, activeCompetition, activeYear, activeTab, activeEvent,
    activeHomeHub, activeTennisTour, activeTennisTotals, activeTennisWatch, activeTennisRankings,
    activeTennisSchedule, activeMmaSection, favouriteViewCompetition, accountPage, accountSection,
    partnersPage, partnersTotals,
  } = state
  const prefix = prefixFor(locale)
  const tour = activeTennisTour || 'atp'

  if (accountPage) return `${prefix}/account/${accountSection || 'settings'}`
  if (partnersPage) return `${prefix}/partners${partnersTotals ? '/totals' : ''}`
  if (favouriteViewCompetition) {
    return `${prefix}/favourites/${favouriteViewCompetition.sportSlug}/${favouriteViewCompetition.competitionSlug}`
  }
  if (activeTennisTotals)   return `${prefix}/tennis/${tour}/totals`
  if (activeTennisRankings) return `${prefix}/tennis/${tour}/rankings`
  if (activeTennisSchedule) return `${prefix}/tennis/${tour}/schedule`
  if (activeTennisWatch)    return `${prefix}/tennis/${tour}/watch`
  // URL shape unchanged (/tennis/atp or /tennis/wta) even though
  // activeHomeHub itself is now always the single value 'tennis' (Mohamed
  // 2026-08-26: "No more Home of ATP neither Home of WTA") — `tour`
  // (activeTennisTour) carries which one to put in the URL, same as every
  // branch above already does for the totals/rankings/watch/schedule
  // sub-pages.
  if (activeHomeHub)        return `${prefix}/tennis/${tour}`

  // Same condition ContentArea.jsx uses for its own "render HomepageTemplate"
  // branch — activeSport can be a stale/forced 'tennis' here (HomepageTemplate
  // silently sets it so Sidebar isn't empty) without this actually being a
  // real tennis navigation, so this check must come before the sport
  // branches below, not after.
  if (!activeCompetition && !activeCategory) return prefix || '/'

  if (activeSport === 'tennis' && activeCategory) {
    // No competition picked yet within the category — ContentArea.jsx's
    // own "activeCategory && !activeCompInCategory" branch (HomeTennisTemplate
    // fallback) renders this exact state; give it its own URL instead of
    // silently falling through to the homepage.
    if (!activeCompetition) return `${prefix}/tennis/${activeCategory}`
    const tab = activeTab ? `/${activeTab}` : ''
    return `${prefix}/tennis/${activeCategory}/${activeCompetition}/${activeYear}${tab}`
  }

  if (activeSport === 'car-racing' && (activeCompetition === 'formula-1-world-championship' || activeCompetition === 'motogp')) {
    const series = activeCompetition === 'motogp' ? 'motogp' : 'f1'
    const tab = activeTab ? `/${activeTab}` : ''
    return `${prefix}/racing/${series}/${activeYear}${tab}`
  }

  if (activeSport === 'mma') {
    // Defaults to 'schedule', not 'home' (Mohamed 2026-08-23: "home page
    // becoming Schedule / first item of Line A" — Home is now a blank
    // banner-only landing, same F1/MotoGP Home/Schedule split; the useful
    // landing page is Schedule).
    const section = activeMmaSection || 'schedule'
    return `${prefix}/combat-sport/${activeCompetition || 'ufc'}/${activeYear}/${section}`
  }

  if (activeSport && activeCompetition) {
    const tab = activeTab ? `/${activeTab}` : ''
    const event = activeEvent ? `/${activeEvent}` : ''
    return `${prefix}/${activeSport}/${activeCompetition}/${activeYear}${tab}${event}`
  }

  return prefix || '/'
}

export function pathToState(pathname) {
  let path = pathname.replace(/\/+$/, '')
  let locale = 'en'
  if (path === '/fr' || path.startsWith('/fr/')) {
    locale = 'fr'
    path = path.slice(3) || '/'
  }
  const segs = path.split('/').filter(Boolean)

  if (!segs.length) return { locale }

  if (segs[0] === 'account') {
    const section = ['settings', 'favourites', 'videos', 'votes', 'reports'].includes(segs[1]) ? segs[1] : 'settings'
    return { locale, accountPage: true, accountSection: section }
  }

  if (segs[0] === 'partners') {
    return { locale, partnersPage: true, partnersTotals: segs[1] === 'totals' }
  }

  if (segs[0] === 'favourites' && segs[1] && segs[2]) {
    return { locale, favouriteViewCompetition: { sportSlug: segs[1], competitionSlug: segs[2] } }
  }

  if (segs[0] === 'tennis') {
    const [, a, b, c, d] = segs
    if (a && b && ['totals', 'rankings', 'watch', 'schedule'].includes(b) && !c) {
      return {
        // activeHomeHub: 'tennis' (not `a`) — ONE sport-wide hub now
        // (Mohamed 2026-08-26: "No more Home of ATP neither Home of WTA");
        // activeTennisTour still carries which tour (`a`) these sub-pages
        // are scoped to, a separate concept.
        locale, activeSport: 'tennis', activeTennisTour: a, activeHomeHub: 'tennis',
        activeTennisTotals: b === 'totals', activeTennisRankings: b === 'rankings', activeTennisWatch: b === 'watch',
        activeTennisSchedule: b === 'schedule',
      }
    }
    if (a === 'atp' || a === 'wta') {
      if (!b) return { locale, activeSport: 'tennis', activeTennisTour: a, activeHomeHub: 'tennis' }
    } else if (a && !b) {
      // /tennis/:category — category picked, no competition yet (see
      // stateToPath's matching branch).
      const tour = a.startsWith('wta') ? 'wta' : 'atp'
      return { locale, activeSport: 'tennis', activeCategory: a, activeTennisTour: tour }
    }
    if (a && b && c) {
      // Most tennis category slugs already encode the tour (e.g.
      // 'atp-masters-1000' / 'wta-1000') — Grand Slam is the one shared
      // exception (see useAppStore.js's activeTennisTour comment), so this
      // heuristic only matters for that case and defaults to 'atp'.
      const tour = a.startsWith('wta') ? 'wta' : 'atp'
      return {
        locale, activeSport: 'tennis', activeCategory: a, activeCompetition: b,
        activeYear: Number(c) || undefined, activeTab: d || null, activeTennisTour: tour,
      }
    }
    return { locale, activeSport: 'tennis' }
  }

  if (segs[0] === 'racing' && segs[1]) {
    const competitionSlug = segs[1] === 'motogp' ? 'motogp' : 'formula-1-world-championship'
    return {
      locale, activeSport: 'car-racing', activeCompetition: competitionSlug,
      activeYear: Number(segs[2]) || undefined, activeTab: segs[3] || null,
    }
  }

  if (segs[0] === 'combat-sport' && segs[1]) {
    return {
      locale, activeSport: 'mma', activeCompetition: segs[1],
      activeYear: Number(segs[2]) || undefined, activeMmaSection: segs[3] || 'schedule',
    }
  }

  // Generic: /:sport/:competition/:year/:tab?/:event?
  const [sport, competition, yearStr, tab, event] = segs
  if (sport && competition && yearStr) {
    return {
      locale, activeSport: sport, activeCompetition: competition,
      activeYear: Number(yearStr) || undefined, activeTab: tab || null, activeEvent: event || null,
    }
  }

  return { locale }
}

// ── "Intended href" helpers ─────────────────────────────────────────────
// For converting onClick-only nav elements to real <Link to="..."> (Mohamed
// 2026-08-21: hover should show the URL, right-click should copy a link).
// Each one mirrors — field-for-field — the exact resulting state its
// matching useAppStore.js action produces, so the href a user sees on
// hover/copy is byte-identical to where the real click (which still calls
// that same store action) will land, not an approximation. `current` is the
// full current store state (or at least its NAV_FIELDS-relevant slice).

export function pathForSport(current, slug) {
  const same = current.activeSport === slug
  return stateToPath({
    ...current,
    activeSport: slug,
    activeCompetition: same ? current.activeCompetition : null,
    activeEvent: same ? current.activeEvent : null,
    activeTab: same ? current.activeTab : null,
    activeCategory: same ? current.activeCategory : null,
    activeHomeHub: same ? current.activeHomeHub : null,
    activeTennisTour: same ? current.activeTennisTour : null,
    activeTennisTotals: same ? current.activeTennisTotals : false,
    activeTennisWatch: same ? current.activeTennisWatch : false,
    activeTennisRankings: same ? current.activeTennisRankings : false,
    activeTennisSchedule: same ? current.activeTennisSchedule : false,
    // 'home', not null — same fix as pathForCompetition below, same reason.
    activeMmaSection: same ? current.activeMmaSection : 'home',
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  })
}

// extra: merged in AFTER the changeCompetitionWithSport-equivalent state
// below, for callers that follow the same action with one more setter call
// of their own — e.g. HomepageTemplate's goToFullCompetition calls
// changeCompetitionWithSport then setMmaSection/setTab on top.
export function pathForCompetition(current, sportSlug, competitionSlug, categorySlug, extra) {
  const same = current.activeSport === sportSlug
  return stateToPath({
    ...current,
    activeSport: sportSlug,
    activeCompetition: competitionSlug,
    activeCategory: sportSlug === 'tennis' ? (categorySlug || (same ? current.activeCategory : null)) : null,
    activeEvent: null,
    activeHomeHub: null,
    activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false, activeTennisSchedule: false,
    // 'home', not null (Mohamed 2026-08-26: "when i click Combat Sport [from
    // Racing's Home]... i get Schedule of UFC, i should see Home of Combat
    // Sport" — this href helper has its own copy of the same default
    // useAppStore.js's changeCompetitionWithSport already carries, fixed
    // there the same day but missed here; MainNav's <Link to={hrefFor(s)}>
    // navigates using THIS computed URL, not the onClick handler's state
    // alone, so a stale default here silently overrides a correct one there).
    activeMmaSection: same ? current.activeMmaSection : 'home',
    activeTab: same ? current.activeTab : (sportSlug === 'tennis' || sportSlug === 'mma') ? null : 'home',
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
    ...extra,
  })
}

// Mirrors changeCompetition (not changeCompetitionWithSport) — same sport,
// keeps activeCategory/activeTab as-is unless tabOverride is passed (e.g.
// Sidebar's goToCompetitionSchedule calls changeCompetition then
// setTab('schedule') as two separate calls; tabOverride replicates that
// combination in one). MMA tracks its active Line A section in
// activeMmaSection, not activeTab (see MmaEventTemplate.jsx) — routing
// tabOverride there instead for that sport keeps this one function correct
// for every sport's "go to Schedule" sidebar click (Mohamed 2026-08-26:
// "any click on a sidebar item leads to Schedule page of the concerned
// league" — this was the gap for any sport whose sidebar category has
// exactly one competition, e.g. NBA/UFC, fixed at the Sidebar.jsx call
// site; this is the other half, for MMA specifically).
export function pathForCompetitionSameSport(current, competitionSlug, tabOverride) {
  const isMma = current.activeSport === 'mma'
  return stateToPath({
    ...current,
    activeCompetition: competitionSlug,
    activeEvent: null,
    activeHomeHub: null,
    activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false, activeTennisSchedule: false,
    activeTab: isMma ? current.activeTab : (tabOverride !== undefined ? tabOverride : current.activeTab),
    activeMmaSection: isMma && tabOverride !== undefined ? tabOverride : current.activeMmaSection,
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  })
}

export function pathForTennisHub(current, tour) {
  return stateToPath({
    ...current,
    // activeHomeHub is always 'tennis' now (Mohamed 2026-08-26: "No more
    // Home of ATP neither Home of WTA") — mirrors goToTennisHub's own fix,
    // same reasoning in that action's comment. activeTennisTour still
    // tracks the requested tour, a separate concept.
    activeSport: 'tennis', activeCategory: 'grand-slam', activeCompetition: null,
    activeEvent: null, activeTab: null, activeHomeHub: 'tennis', activeTennisTour: tour,
    activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false, activeTennisSchedule: false,
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  })
}

// Mirrors goToTennisTourSchedule — Sidebar's ATP/WTA sub-categories and
// Grand Slam land on that tour's Schedule page as the default content,
// keeping activeCategory set so Line A still shows the clicked category's
// own tournament list (Mohamed 2026-08-26).
export function pathForTennisTourSchedule(current, tour, categorySlug) {
  return stateToPath({
    ...current,
    activeSport: 'tennis', activeCategory: categorySlug ?? null, activeCompetition: null,
    activeEvent: null, activeTab: null, activeHomeHub: null, activeTennisTour: tour,
    activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false, activeTennisSchedule: true,
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  })
}

export function pathForCategory(current, slug, tour) {
  return stateToPath({
    ...current,
    activeCategory: slug, activeCompetition: null, activeEvent: null, activeTab: null,
    activeHomeHub: null, activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false,
    ...(tour ? { activeTennisTour: tour } : {}),
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  })
}

export function pathForAccountSection(current, section) {
  return stateToPath({ ...current, accountPage: true, accountSection: section, partnersPage: false })
}

export function pathForPartners(current, totals = false) {
  return stateToPath({ ...current, partnersPage: true, partnersTotals: totals, accountPage: false })
}

// Deliberately does NOT clear accountPage/partnersPage like the other
// pathFor* helpers below — a year click means "stay on whatever page I'm
// on, just change the year" (same as every other page's activeYear use),
// not "leave to a different page". The Partners page's own By-Year view
// relies on this to keep the shared YearSelector's year clicks landing back
// on /partners instead of bouncing the user away (found 2026-08-25, the
// same accountPage/partnersPage-clearing fix applied to pathForSport etc.
// broke this one specifically once Partners started consuming activeYear).
export function pathForYear(current, year) {
  return stateToPath({ ...current, activeYear: year })
}

export function pathForTab(current, tabKey) {
  return stateToPath({ ...current, activeTab: tabKey, favouriteViewCompetition: null, accountPage: false, partnersPage: false })
}

// Competition-specific Schedule tab_key for each racing series sharing the
// 'car-racing' sport — F1 and MotoGP each own a distinct tab_key (not a
// shared 'schedule' like basketball), so this has to key off activeCompetition,
// not activeSport alone.
const RACING_SCHEDULE_TAB_BY_COMPETITION = {
  'formula-1-world-championship': 'f1-schedule',
  motogp: 'motogp-schedule',
}

// Year click while a sport's Home tab is active must land on Schedule
// instead of Home (Mohamed 2026-08-26: unfreezing Home's year selector — see
// YearSelector.jsx — revealed Home has no per-year content of its own; it
// renders the standalone HomepageTemplate dashboard, always pinned to the
// current year. Schedule is the real per-year landing page). Started with
// basketball, extended same day to F1/MotoGP, then MMA/tennis per Mohamed's
// follow-ups. Every sport tracks "which Line A/section is active" in its
// own store field with its own setter — basketball/racing use the shared
// activeTab+setTab, MMA uses activeMmaSection+setMmaSection, tennis's hub
// uses a boolean activeTennisSchedule+setTennisSchedule instead of a
// tab_key — so this returns a small discriminated action object rather
// than a bare tab_key string, and both pathForYearFromHome (the Link's
// href) and YearSelector.jsx's onClick handlers (the immediate Zustand-
// state half of the update) apply the SAME resolution instead of
// duplicating the per-sport table twice.
export function homeYearClickAction(current) {
  if (current.activeSport === 'basketball' && current.activeTab === 'home') {
    return { setTab: 'schedule' }
  }
  // Same rule for football (World Cup + every round-robin league — Mohamed
  // 2026-08-25: "when user clicks a year, schedule page is opened by
  // default"). A football competition with no 'schedule' tab of its own
  // (e.g. UCL) just falls through to HomeTemplate's existing "coming soon"
  // placeholder on the Schedule tab rather than erroring — same graceful
  // fallback basketball would hit if it ever lost its own Schedule tab.
  if (current.activeSport === 'football' && current.activeTab === 'home') {
    return { setTab: 'schedule' }
  }
  if (current.activeSport === 'car-racing' && current.activeTab === 'home') {
    const tabKey = RACING_SCHEDULE_TAB_BY_COMPETITION[current.activeCompetition]
    return tabKey ? { setTab: tabKey } : null
  }
  if (current.activeSport === 'mma' && current.activeMmaSection === 'home') {
    return { setMmaSection: 'schedule' }
  }
  // Tennis's ATP/WTA Home hub (activeHomeHub set, none of its other
  // tour-wide pages active yet) — same "Home has no per-year content"
  // reasoning, landing on the hub's own Schedule page instead.
  if (
    current.activeSport === 'tennis' && current.activeHomeHub &&
    !current.activeTennisTotals && !current.activeTennisRankings &&
    !current.activeTennisSchedule && !current.activeTennisWatch
  ) {
    return { setTennisSchedule: true }
  }
  return null
}

export function pathForYearFromHome(current, year) {
  const action = homeYearClickAction(current)
  const next = { ...current, activeYear: year }
  if (action?.setTab) next.activeTab = action.setTab
  if (action?.setMmaSection) next.activeMmaSection = action.setMmaSection
  if (action?.setTennisSchedule) next.activeTennisSchedule = true
  return stateToPath(next)
}

// LineA.jsx's selectEvent always nulls activeTab alongside setEvent (a real
// event selected off the Home tab must also move activeTab off 'home' —
// see selectEvent's own comment there); tabAfter defaults to null to match.
export function pathForEvent(current, eventSlug, tabAfter = null) {
  return stateToPath({ ...current, activeEvent: eventSlug, activeTab: tabAfter, favouriteViewCompetition: null, accountPage: false, partnersPage: false })
}
