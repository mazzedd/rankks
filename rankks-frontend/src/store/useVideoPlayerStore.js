import { create } from 'zustand'

// Single global "which slide-in drawer is open" slot — despite the name
// (kept for MatchVideo, its original caller), this now governs every
// drawer built on SlideDrawer.module.css, e.g. FullStandingsDrawer too —
// every instance reads/writes the same key instead of owning its own
// local open state, so opening one drawer always tears down any other
// still-open one instead of just hiding behind it (an orphaned video
// iframe kept its audio going even after its own drawer was closed, since
// nothing ever forced it to unmount — the same stacking bug would hit any
// two drawers left open at once, not just two videos).
const useVideoPlayerStore = create((set) => ({
  openKey: null,
  openVideo: (key) => set({ openKey: key }),
  closeVideo: () => set({ openKey: null }),
}))

export default useVideoPlayerStore
