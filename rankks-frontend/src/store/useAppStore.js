import { create } from 'zustand'

const useAppStore = create((set) => ({
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
  // ATP/WTA "Home" hub (tennis sidebar) — a cross-category landing page
  // (Grand Slam + Masters/WTA 1000/500/250 all at once), which doesn't map
  // onto activeCategory the way every other sidebar click does (that
  // always resolves to ONE real category with a real competition list;
  // this spans four at once with no competitions of its own). Kept as its
  // own field rather than a fake category slug so ContentArea can check it
  // first, before any of the real competition/category fetch logic.
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

  // RANKKS logo click (ShortcutBar) — returns to the same blank landing
  // state as a fresh page load (activeSport null), whatever sport/page the
  // user was on. No routing in this app (state-driven SPA, no URL), so
  // "homepage" means resetting nav state rather than navigating a path.
  goHome: () => set({
    activeSport:       null,
    activeSubEdition:  1,
    activeCompetition: null,
    activeEvent:       null,
    activeCategory:    null,
    activeTab:         null,
    activeHomeHub:     null,
    activeTennisTour:  null,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    favouriteViewCompetition: null,
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
    favouriteViewCompetition: null,
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
    ...(tour ? { activeTennisTour: tour } : {}),
    favouriteViewCompetition: null,
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
    favouriteViewCompetition: null,
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
    favouriteViewCompetition: null,
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
    activeHomeHub:     tour,
    activeTennisTour:  tour,
    activeTennisTotals: false,
    activeTennisWatch: false,
    activeTennisRankings: false,
    favouriteViewCompetition: null,
  }),

  // Totals (Line A pinned button, tennis only) — see activeTennisTotals
  // above. Doesn't touch activeHomeHub/activeCategory/activeCompetition:
  // Totals layers on top of whichever category page (or Home hub) the
  // user was already on, same as F1's All-Time tab layering on top of
  // whichever GP list is showing. Clears activeTennisWatch/Rankings —
  // the three tour-wide pages are mutually exclusive, same button row.
  setTennisTotals: (val) => set({ activeTennisTotals: val, activeTennisWatch: false, activeTennisRankings: false, favouriteViewCompetition: null }),

  // Watch center (Line A pinned play-icon button, tennis only) — see
  // activeTennisWatch above. Same layering behavior as setTennisTotals,
  // and clears activeTennisTotals/Rankings for the same mutual-exclusivity
  // reason.
  setTennisWatch: (val) => set({ activeTennisWatch: val, activeTennisTotals: false, activeTennisRankings: false, favouriteViewCompetition: null }),

  // Rankings (Line A pinned button, tennis only, right after Home) — see
  // activeTennisRankings above. Same layering/mutual-exclusivity behavior
  // as setTennisTotals/setTennisWatch.
  setTennisRankings: (val) => set({ activeTennisRankings: val, activeTennisTotals: false, activeTennisWatch: false, favouriteViewCompetition: null }),

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
    activeTab:         state.activeSport === sportSlug ? state.activeTab
                        : sportSlug === 'tennis' ? null : 'home',
    favouriteViewCompetition: null,
  })),

  // Direct competition set (legacy)
  setCompetition: (slug) => set({ activeCompetition: slug, activeEvent: null, activeTab: null, activeHomeHub: null, activeTennisTotals: false, activeTennisWatch: false, activeTennisRankings: false, favouriteViewCompetition: null }),

  setEvent:         (slug)    => set({ activeEvent: slug, favouriteViewCompetition: null }),
  setTab:           (key)     => set({ activeTab: key, favouriteViewCompetition: null }),
  changeYear:       (year)    => set({ activeYear: year, activeSubEdition: 1 }),
  setYearRange:     (range)   => set({ yearRange: range }),
  setSports:        (sports)  => set({ sports }),
  setRegionProfile: (profile) => set({ regionProfile: profile }),
  setSubEdition:    (n)       => set({ activeSubEdition: n }),

  // Opens the simplified "favourite page" view (hides Line A/B) for a
  // followed competition, clicked from the Sidebar's FAVOURITE block — a
  // distinct entry point from changeCompetitionWithSport, which drives the
  // normal full standings page. Deliberately does NOT touch
  // activeSport/activeCompetition/etc — see favouriteViewCompetition above.
  openFavouriteView: (sportSlug, competitionSlug) => set({
    favouriteViewCompetition: { sportSlug, competitionSlug },
  }),
  closeFavouriteView: () => set({ favouriteViewCompetition: null }),
}))

export default useAppStore