import { create } from 'zustand'

const useAppStore = create((set) => ({
  // URL locale prefix ('en' = no prefix, 'fr' = '/fr/...') — see
  // src/routing/urlSchema.js. No translated strings wired up yet; this only
  // reserves the URL shape (Mohamed 2026-08-21: "I plan to translate the
  // site. rankks/fr/page url. rankks/page url remains the default one").
  locale: 'en',
  activeSport:      null,
  activeSubEdition: 1,
  activeCompetition:null,
  activeEvent:      null,
  activeCategory:   null,
  activeTab:        null,
  activeYear:       new Date().getFullYear(),
  // Year range for the shared, full-width YearSelector (App.jsx) — each
  // content area (ContentArea.jsx/F1ContentArea.jsx/MotoGPContentArea.jsx)
  // publishes its own min/max/edition years here instead of rendering
  // YearSelector itself, since the bar now lives in its own full-width
  // grid row above the sidebar, not nested inside any one content area.
  yearRange:        { minYear: null, maxYear: null, editionYears: undefined, validFrom: null, validTo: null },
  sports:           [],
  regionProfile:    null,
  isLoading:        false,
  // Unpaired from activeSport/activeCompetition entirely — the favourite
  // view is a separate transient overlay, not a navigation to that
  // competition. Opening it must never move (or later restore) where the
  // user actually is in normal browsing; closing it just clears this.
  favouriteViewCompetition: null, // { sportSlug, competitionSlug } | null
  // Transient "Player page coming soon" overlay (Mohamed 2026-08-25:
  // "Player name is clickable: opens the coming soon player page") — same
  // independent-of-navigation shape as AuthModal (useUserStore), not a real
  // routed page yet, so it doesn't touch the URL/NAV_FIELDS at all. A
  // backdrop click/close is the only way out, so there's nothing to clear
  // on navigation the way favouriteViewCompetition/accountPage are.
  playerModal: null, // { name, slug } | null
  // Real routed page (/account), not the old MyAccountModal popup (Mohamed
  // 2026-08-19: "time to create a real page 'MY ACCOUNT', not a popup.
  // Keep sidebar"). Cleared by every normal navigation action below the
  // same way favouriteViewCompetition is, so clicking anywhere else in the
  // app leaves the account page the same way any other page-to-page
  // navigation would.
  accountPage: false,
  // Which section the account page's own sidebar nav (Settings/Favourites/
  // Votes) is showing — Mohamed 2026-08-19: "reorganise account page",
  // replacing the single long stacked-sections page with a real sidebar-
  // driven page like every other section of the site.
  accountSection: 'settings',
  // Real routed /partners page (Official Partnerships) — same "own
  // overlay-ish top-level state" shape as accountPage above, deliberately
  // not touching activeSport/activeCompetition/etc so whatever sport the
  // user was browsing is still there in the sidebar underneath the
  // Athletes/Clubs/Partners block if they navigate away from this page.
  partnersPage: false,
  // Whether the /partners page is showing the year-scoped view (deals
  // active in the shared YearSelector's activeYear, the default) or the
  // all-time "Totals" ledger (every deal ever, no year filtering) — same
  // "sub-state that survives independently of the page toggle" shape as
  // accountSection above.
  partnersTotals: false,
  // ATP/WTA "Home" hub (tennis sidebar) — a cross-category landing page
  // (Grand Slam + Masters/WTA 1000/500/250 all at once), which doesn't map
  // onto activeCategory the way every other sidebar click does (that
  // always resolves to ONE real category with a real competition list;
  // this spans four at once with no competitions of its own). Kept as its
  // own field rather than a fake category slug so ContentArea can check it
  // first, before any of the real competition/category fetch logic. Now a
  // deliberately blank placeholder banner-only page (Mohamed 2026-08-24:
  // "Use the same page, remove table, keep only Home of ATP (blank
  // content) as the default Home page of ATP. Will add content later") —
  // the full schedule table that used to live here moved to
  // activeTennisSchedule below.
  // 'atp' | 'wta' | null.
  activeHomeHub: null,
  // Which tour side (ATP/WTA) the user is currently browsing within tennis —
  // drives the "Home icon + ATP/WTA" pinned Line A button so it's always
  // visible, not just from the sidebar hub click. Distinct from
  // activeHomeHub (which means "on the hub page itself"): this persists
  // across category/competition navigation too, since Grand Slam is the
  // one category shared by both tours (gender 'X' at the category row) and
  // has no other way to know which side it was entered from — Sidebar.jsx
  // passes 'atp'/'wta' explicitly on every tennis category/hub click.
  // 'atp' | 'wta' | null.
  activeTennisTour: null,
  // ATP/WTA "Totals" page (Line A pinned Totals button) — tour-wide
  // aggregated stats (Tournament Stats etc.), independent of activeHomeHub
  // since it's reachable from within a specific category page too, without
  // losing that category's own Line A tournament list (same categoryComps
  // ContentArea already has). Scope (ATP/WTA) comes from activeTennisTour,
  // same source the hub button uses.
  activeTennisTotals: false,
  // ATP/WTA "Watch center" page (Line A pinned play-icon button, tennis
  // category/hub pages only — a competition's own per-season Iconic
  // Moments tab is a separate, already-working mechanism driven by a real
  // result_tabs row, see registry.js's iconic_moments entry). Tour-wide
  // gallery for the selected year, same reach as activeTennisTotals above.
  // Mutually exclusive with activeTennisTotals — see setTennisWatch/
  // setTennisTotals, which each clear the other.
  activeTennisWatch: false,
  // ATP/WTA "Rankings" page (Line A pinned button, right after Home) —
  // same tour-wide layering as activeTennisTotals/activeTennisWatch
  // above (reachable from any category/competition page, not just the
  // hub), and mutually exclusive with both — see setTennisRankings.
  activeTennisRankings: false,
  // ATP/WTA "Schedule" page (Line A pinned button, first — before
  // Rankings) — the full tournament-schedule table (TennisHomeBlock's
  // banner + HomeTennisTemplate's filterable table) that activeHomeHub
  // used to render directly (Mohamed 2026-08-24: "Create a Line A item
  // 'Schedule' displayed first before Rankings... Use the same page,
  // remove table, keep only Home of ATP (blank content) as the default
  // Home page"). Same tour-wide layering/mutual-exclusivity as
  // Totals/Watch/Rankings above — see setTennisSchedule.
  activeTennisSchedule: false,

  // MmaEventTemplate's own Line A/B section state (Mohamed 2026-08-17:
  // "when user is on Totals -> Men's stat, and change year, keep track of
  // Totals -> Men's... same for Line A Men Ranking/Women Ranking/UFC
  // Event/Fight night"). MMA has no result_tabs-driven nav of its own (see
  // MmaEventTemplate's header comment), so unlike every other sport it kept
  // this purely as local useState — which breaks on year change because
  // ContentArea's season-refetch effect briefly sets `loading`, and
  // renderContent()'s `if (loading) return <skeleton>` unmounts the whole
  // Template component while the new year's data loads, wiping local state
  // on remount. Tennis's activeTennisTotals/Watch/Rankings above already
  // solve the exact same problem by living here instead — same fix,
  // applied to MMA. activeMmaSection mirrors MmaEventTemplate's own
  // `section` values: null | 'home' | 'rankings-m' | 'rankings-f' | 'ppv' |
  // 'fn' | 'watch' | 'totals'.
  activeMmaSection: null,
  activeMmaWeightClass: null,
  activeMmaTotalsSub: null,

  // Racing sidebar's Moto GP / Moto 2 / Moto 3 selection (Mohamed
  // 2026-08-23: "Moto 2 and Moto 3 seat now under Moto GP in sidebar. No
  // more category dropdown needed on Line B") — was local useState in
  // MotoGPContentArea.jsx; moved here for the same reason
  // activeTennisTotals/activeMmaSection already live here instead of local
  // state: it doesn't survive the loading-skeleton remount on year change,
  // and now also needs to be settable from Sidebar.jsx, a sibling
  // component with no other way to reach MotoGPContentArea's internals.
  // 'motogp' | 'moto2' | 'moto3'.
  activeMotoCategory: 'motogp',

  // RANKKS logo click (ShortcutBar) — returns to the same blank landing
  // state as a fresh page load (activeSport null), whatever sport/page the
  // user was on. No routing in this app (state-driven SPA, no URL), so
  // "homepage" means resetting nav state rather than navigating a path.
  goHome: () => set({
    activeSport:       null,
    activeSubEdition:  1,
    activeYear:        new Date().getFullYear(),
    activeCompetition: null,
    activeEvent:       null,
    activeCategory:    null,
    activeTab:         null,
    activeHomeHub:     null,
    activeTennisTour:  null,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    activeTennisSchedule: false,
    activeMmaSection: null,
    activeMmaWeightClass: null,
    activeMmaTotalsSub: null,
    activeMotoCategory: 'motogp',
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  }),

  // Set active sport — clears everything when switching sport
  setSport: (slug) => set(state => ({
    activeSport:       slug,
    activeCompetition: state.activeSport === slug ? state.activeCompetition : null,
    activeEvent:       state.activeSport === slug ? state.activeEvent : null,
    activeTab:         state.activeSport === slug ? state.activeTab : null,
    activeCategory:    state.activeSport === slug ? state.activeCategory : null,
    activeHomeHub:     state.activeSport === slug ? state.activeHomeHub : null,
    activeTennisTour:  state.activeSport === slug ? state.activeTennisTour : null,
    activeTennisTotals: state.activeSport === slug ? state.activeTennisTotals : false,
    activeTennisWatch: state.activeSport === slug ? state.activeTennisWatch : false,
    activeTennisRankings: state.activeSport === slug ? state.activeTennisRankings : false,
    activeTennisSchedule: state.activeSport === slug ? state.activeTennisSchedule : false,
    activeMmaSection:  state.activeSport === slug ? state.activeMmaSection : null,
    activeMmaWeightClass: state.activeSport === slug ? state.activeMmaWeightClass : null,
    activeMmaTotalsSub: state.activeSport === slug ? state.activeMmaTotalsSub : null,
    activeMotoCategory: state.activeSport === slug ? state.activeMotoCategory : 'motogp',
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  })),

  // Set category (tennis sidebar) — clears competition but keeps category.
  // tour is optional ('atp'/'wta') — Sidebar passes it explicitly per
  // category button (derived from the category's own gender, or hardcoded
  // per Grand-Slam instance since that one category is rendered under both
  // ATP and WTA sections); omitted for non-tennis sports, which leaves
  // activeTennisTour untouched (harmless, it's never read there).
  setCategory: (slug, tour) => set({
    activeCategory:    slug,
    activeCompetition: null,
    activeEvent:       null,
    activeTab:         null,
    activeHomeHub:     null,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    activeTennisSchedule: false,
    ...(tour ? { activeTennisTour: tour } : {}),
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  }),

  // Set competition within current category — keeps activeCategory and activeTab for preservation
  changeCompetition: (slug) => set({
    activeCompetition: slug,
    activeEvent:       null,
    activeSubEdition:  1,
    activeHomeHub:     null,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    activeTennisSchedule: false,
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
    // activeTab intentionally NOT reset — ContentArea will preserve or adapt it
  }),

  // ATP/WTA Home hub click (the pinned Home button inside LineA — only
  // ever clicked from within a category/competition page, never from a
  // bare top-level sidebar link; ATP/WTA section labels aren't clickable).
  // activeCategory is deliberately KEPT (not cleared) so the category's
  // own Line A tournament list stays visible on the hub page too, instead
  // of collapsing to bare Home/Watch/Totals icons (fixed 2026-08-10 — was
  // wiped here, same as switching category, even though the user hasn't
  // actually left that category's browsing context).
  setHomeHub: (hub) => set({
    activeHomeHub:     hub,
    activeTennisTour:  hub,
    activeCompetition: null,
    activeEvent:       null,
    activeTab:         null,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    activeTennisSchedule: false,
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  }),

  // Cross-sport ATP/WTA jump (top ShortcutBar's "ATP" icon) — lands
  // straight on Home ATP/WTA from anywhere, e.g. while browsing F1, same
  // destination as setHomeHub above but reachable when tennis isn't even
  // the active sport yet (setHomeHub alone doesn't switch activeSport).
  // Seeds activeCategory to Grand Slam — same anchor Sidebar.jsx's own
  // Grand Slam button uses — so Line A shows a real tournament list under
  // the hub instead of just the bare Home/Watch/Totals icons.
  // activeYear is deliberately left untouched: YearSelector already greys
  // out years outside a competition's own range without resetting the
  // picked year, same as switching between F1 and MotoGP already does.
  goToTennisHub: (tour) => set({
    activeSport:       'tennis',
    activeCategory:    'grand-slam',
    activeCompetition: null,
    activeEvent:       null,
    activeTab:         null,
    // Always 'tennis' — ONE sport-wide hub now, not a per-tour destination
    // (Mohamed 2026-08-26: "No more Home of ATP neither Home of WTA").
    // activeTennisTour still tracks the requested tour below — that's a
    // different concept (which tour's category pages default to), unaffected.
    activeHomeHub:     'tennis',
    activeTennisTour:  tour,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    activeTennisSchedule: false,
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  }),

  // Sidebar's ATP/WTA sub-categories (Masters 1000/500/250, ATP Finals,
  // Various, WTA's own tiers) and Grand Slam land on that tour's Schedule
  // page as the default content, WITHOUT losing Line A's own tournament
  // list for the clicked category (Mohamed 2026-08-26, corrected same day:
  // "click Master 1000: display Line A: Schedule Rankings + list of
  // tournaments M1000, same for Slam, WTA, etc" — the first cut of this
  // cleared activeCategory entirely, which zeroed out categoryComps and
  // silently dropped the tournament list from Line A alongside the pinned
  // Schedule/Rankings buttons; ContentArea's activeTennisSchedule branch
  // already renders <LineA competitions={categoryComps} .../>, so keeping
  // activeCategory set is the only change needed). activeTennisSchedule
  // still drives which content shows below Line A (the tour-wide Schedule
  // table), same mutual-exclusivity as Totals/Watch/Rankings.
  goToTennisTourSchedule: (tour, categorySlug) => set({
    activeCategory:    categorySlug ?? null,
    activeCompetition: null,
    activeEvent:       null,
    activeTab:         null,
    activeHomeHub:     null,
    activeTennisTour:  tour,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    activeTennisSchedule: true,
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  }),

  // Totals (Line A pinned button, tennis only) — see activeTennisTotals
  // above. Doesn't touch activeHomeHub/activeCategory/activeCompetition:
  // Totals layers on top of whichever category page (or Home hub) the
  // user was already on, same as F1's All-Time tab layering on top of
  // whichever GP list is showing. Clears activeTennisWatch/Rankings/
  // Schedule — the four tour-wide pages are mutually exclusive, same
  // button row.
  setTennisTotals: (val) => set({ activeTennisTotals: val, activeTennisWatch: false, activeTennisRankings: false, activeTennisSchedule: false, favouriteViewCompetition: null, accountPage: false, partnersPage: false }),

  // Watch center (Line A pinned play-icon button, tennis only) — see
  // activeTennisWatch above. Same layering behavior as setTennisTotals,
  // and clears activeTennisTotals/Rankings/Schedule for the same
  // mutual-exclusivity reason.
  setTennisWatch: (val) => set({ activeTennisWatch: val, activeTennisTotals: false, activeTennisRankings: false, activeTennisSchedule: false, favouriteViewCompetition: null, accountPage: false, partnersPage: false }),

  // Rankings (Line A pinned button, tennis only, right after Schedule) —
  // see activeTennisRankings above. Same layering/mutual-exclusivity
  // behavior as setTennisTotals/setTennisWatch/setTennisSchedule.
  setTennisRankings: (val) => set({ activeTennisRankings: val, activeTennisTotals: false, activeTennisWatch: false, activeTennisSchedule: false, favouriteViewCompetition: null, accountPage: false, partnersPage: false }),

  // Schedule (Line A pinned button, tennis only, first — before Rankings)
  // — see activeTennisSchedule above. Same layering/mutual-exclusivity
  // behavior as setTennisTotals/setTennisWatch/setTennisRankings.
  setTennisSchedule: (val) => set({ activeTennisSchedule: val, activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false, favouriteViewCompetition: null, accountPage: false, partnersPage: false }),

  // Atomic: switch sport + competition (ShortcutBar, MainNav default-competition
  // click, SidebarFavourites). categorySlug is optional — tennis is the only
  // sport whose Line A is driven off activeCategory (see ContentArea's
  // categoryComps fetch + Sidebar's isTennis branch), so callers that know
  // the competition's category (MainNav, SidebarFavourites) pass it through
  // here rather than leaving activeCategory null until the user manually
  // clicks a sidebar category — that gap was a real bug (Line A silently
  // empty after switching sport straight to a default competition, found
  // 2026-08). Falls back to the previous same-sport-preserves-category
  // behaviour when omitted (e.g. LineA.jsx's own same-sport competition
  // clicks, which never change category anyway).
  changeCompetitionWithSport: (sportSlug, competitionSlug, categorySlug) => set(state => ({
    activeSport:       sportSlug,
    activeCompetition: competitionSlug,
    // categorySlug only actually applies for tennis — it's the only sport
    // whose Line A is driven off activeCategory. Applying it unconditionally
    // was a real bug (found 2026-08): clicking Football set activeCategory
    // to Ligue 1's category, which stuck around after switching to a
    // different football competition (changeCompetition doesn't touch
    // activeCategory) and silently drove the tennis-only "reselect first
    // competition in category" effect on the next year change — landing you
    // back on Ligue 1 no matter what you'd actually navigated to.
    activeCategory:    sportSlug === 'tennis'
      ? (categorySlug || (state.activeSport === sportSlug ? state.activeCategory : null))
      : null,
    activeEvent:       null,
    activeHomeHub:     null,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    activeTennisSchedule: false,
    // 'home' now, not null (Mohamed 2026-08-26: "when u click Combat Sport
    // in main bar, open Home of Combat Sport... now it shows Schedule of
    // the UFC" — null fell through to MmaEventTemplate's own `activeMmaSection
    // || 'schedule'` default, a leftover from when Home was a blank
    // placeholder (2026-08-17) and Schedule was the more useful landing.
    // Home is the real sport-wide merged hub now, same reasoning activeTab
    // below already applies to every other sport).
    activeMmaSection:  state.activeSport === sportSlug ? state.activeMmaSection : 'home',
    activeMmaWeightClass: state.activeSport === sportSlug ? state.activeMmaWeightClass : null,
    activeMmaTotalsSub: state.activeSport === sportSlug ? state.activeMmaTotalsSub : null,
    activeMotoCategory: state.activeSport === sportSlug ? state.activeMotoCategory : 'motogp',
    // Keep activeTab if same sport so ContentArea can preserve gender/type.
    // Switching to a genuinely different sport lands on that sport's own
    // Home tab ('home') instead of null — null used to fall through to
    // ContentArea's/F1ContentArea's/MotoGPContentArea's own "pick some
    // real default tab" logic (Standings, whatever is_default in the DB,
    // etc.), not Home (found 2026-08-10: "Racing" from MainNav landed on
    // F1 Standings, not Home of Formula 1). Tennis is excluded — its
    // "Home" is the ATP/WTA hub (activeHomeHub), a different mechanism
    // entirely, handled by goToTennisHub/setHomeHub, not this synthetic
    // 'home' tab_key.
    // MMA is excluded too (2026-08-17) — its Home page is a deliberate
    // blank placeholder for now (UFC onboarding spec), and MmaEventTemplate
    // has no Line A of its own to navigate away from 'home' with (the
    // generic Line A is hidden for mma — see ContentArea's own guard).
    // null lets the existing "resolve to whichever result_tabs row has
    // is_default" logic in ContentArea's season-fetch effect land on
    // 'results' instead.
    activeTab:         state.activeSport === sportSlug ? state.activeTab
                        : (sportSlug === 'tennis' || sportSlug === 'mma') ? null : 'home',
    favouriteViewCompetition: null, accountPage: false, partnersPage: false,
  })),

  // Direct competition set (legacy)
  setCompetition: (slug) => set({ activeCompetition: slug, activeEvent: null, activeTab: null, activeHomeHub: null, activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false, activeTennisSchedule: false, activeMmaSection: null, activeMmaWeightClass: null, activeMmaTotalsSub: null, activeMotoCategory: 'motogp', favouriteViewCompetition: null, accountPage: false, partnersPage: false }),

  setEvent:         (slug)    => set({ activeEvent: slug, favouriteViewCompetition: null, accountPage: false, partnersPage: false }),
  setTab:           (key)     => set({ activeTab: key, favouriteViewCompetition: null, accountPage: false, partnersPage: false }),
  // activeYear changes deliberately leave activeMmaSection/WeightClass/
  // TotalsSub untouched — see those fields' own header comment. This is
  // the whole point of the fix: MmaEventTemplate remounts on every year
  // change, but reads its current section back from here instead of
  // resetting to a local useState default.
  changeYear:       (year)    => set({ activeYear: year, activeSubEdition: 1 }),
  setYearRange:     (range)   => set({ yearRange: range }),
  setSports:        (sports)  => set({ sports }),
  setRegionProfile: (profile) => set({ regionProfile: profile }),
  setSubEdition:    (n)       => set({ activeSubEdition: n }),
  setMmaSection:     (section) => set({ activeMmaSection: section }),
  setMmaWeightClass: (wc)      => set({ activeMmaWeightClass: wc }),
  setMmaTotalsSub:   (sub)     => set({ activeMmaTotalsSub: sub }),
  setMotoCategory:   (cat)     => set({ activeMotoCategory: cat }),

  // Opens the simplified "favourite page" view (hides Line A/B) for a
  // followed competition, clicked from the Sidebar's FAVOURITE block — a
  // distinct entry point from changeCompetitionWithSport, which drives the
  // normal full standings page. Deliberately does NOT touch
  // activeSport/activeCompetition/etc — see favouriteViewCompetition above.
  openFavouriteView: (sportSlug, competitionSlug) => set({
    favouriteViewCompetition: { sportSlug, competitionSlug },
  }),
  closeFavouriteView: () => set({ favouriteViewCompetition: null, accountPage: false, partnersPage: false }),

  openPlayerModal:  (player) => set({ playerModal: player }),
  closePlayerModal: () => set({ playerModal: null }),

  // Real routed /account page (Mohamed 2026-08-19), replacing the old
  // MyAccountModal popup — same "own overlay-ish top-level state" shape as
  // favouriteViewCompetition above, deliberately not touching
  // activeSport/activeCompetition/etc so whatever the user was browsing is
  // still there if they navigate away from the account page.
  openAccountPage:  (section = 'settings') => set({ accountPage: true, accountSection: section, favouriteViewCompetition: null, partnersPage: false }),
  closeAccountPage: () => set({ accountPage: false }),
  setAccountSection: (section) => set({ accountSection: section }),

  // Real routed /partners page (Official Partnerships) — see partnersPage
  // above. Same shape as openAccountPage/closeAccountPage.
  openPartnersPage:  (totals = false) => set({ partnersPage: true, partnersTotals: totals, favouriteViewCompetition: null, accountPage: false }),
  closePartnersPage: () => set({ partnersPage: false }),
  setPartnersTotals: (val) => set({ partnersTotals: val }),

  setLocale: (locale) => set({ locale }),

  // Restores navigation state from a parsed URL (src/routing/urlSchema.js's
  // pathToState, called by useUrlSync.js on load and on browser back/
  // forward) — a single atomic set(), unlike every action above which each
  // deliberately clear a specific subset of fields for a NEW navigation.
  // Restoring from a URL is different: pathToState always returns the FULL
  // navigational slice of state (every field below, defaulted to null/
  // false/1 when the matched route doesn't use it), so this plainly
  // replaces that whole slice in one go rather than layering partial
  // updates — no stale field from whatever page was active before this
  // hydration can leak through.
  hydrateFromUrl: (partial) => set({
    activeSport: null, activeSubEdition: 1, activeCompetition: null, activeEvent: null,
    activeCategory: null, activeTab: null, activeHomeHub: null, activeTennisTour: null,
    activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false,
    activeTennisSchedule: false,
    activeMmaSection: null, activeMmaWeightClass: null, activeMmaTotalsSub: null,
    activeMotoCategory: 'motogp',
    favouriteViewCompetition: null, accountPage: false, partnersPage: false, partnersTotals: false, accountSection: 'settings',
    ...partial,
  }),
}))

export default useAppStore
