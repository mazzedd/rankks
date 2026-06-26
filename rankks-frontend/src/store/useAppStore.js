import { create } from 'zustand'

const useAppStore = create((set) => ({
  activeSport:      null,
  activeSubEdition: 1,
  activeCompetition:null,
  activeEvent:      null,
  activeCategory:   null,
  activeTab:        null,
  activeYear:       new Date().getFullYear(),
  sports:           [],
  regionProfile:    null,
  isLoading:        false,

  // Set active sport — clears everything when switching sport
  setSport: (slug) => set(state => ({
    activeSport:       slug,
    activeCompetition: state.activeSport === slug ? state.activeCompetition : null,
    activeEvent:       state.activeSport === slug ? state.activeEvent : null,
    activeTab:         state.activeSport === slug ? state.activeTab : null,
    activeCategory:    state.activeSport === slug ? state.activeCategory : null,
  })),

  // Set category (tennis sidebar) — clears competition but keeps category
  setCategory: (slug) => set({
    activeCategory:    slug,
    activeCompetition: null,
    activeEvent:       null,
    activeTab:         null,
  }),

  // Set competition within current category — keeps activeCategory and activeTab for preservation
  changeCompetition: (slug) => set({
    activeCompetition: slug,
    activeEvent:       null,
    activeSubEdition:  1,
    // activeTab intentionally NOT reset — ContentArea will preserve or adapt it
  }),

  // Atomic: switch sport + competition (ShortcutBar)
  changeCompetitionWithSport: (sportSlug, competitionSlug) => set(state => ({
    activeSport:       sportSlug,
    activeCompetition: competitionSlug,
    activeCategory:    state.activeSport === sportSlug ? state.activeCategory : null,
    activeEvent:       null,
    // Keep activeTab if same sport so ContentArea can preserve gender/type
    activeTab:         state.activeSport === sportSlug ? state.activeTab : null,
  })),

  // Direct competition set (legacy)
  setCompetition: (slug) => set({ activeCompetition: slug, activeEvent: null, activeTab: null }),

  setEvent:         (slug)    => set({ activeEvent: slug }),
  setTab:           (key)     => set({ activeTab: key }),
  changeYear:       (year)    => set({ activeYear: year, activeSubEdition: 1 }),
  setSports:        (sports)  => set({ sports }),
  setRegionProfile: (profile) => set({ regionProfile: profile }),
  setSubEdition:    (n)       => set({ activeSubEdition: n }),
}))

export default useAppStore