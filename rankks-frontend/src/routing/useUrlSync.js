// src/routing/useUrlSync.js
//
// Keeps the URL and the store's navigation state in sync, in both
// directions, without changing anything about how ContentArea.jsx decides
// what to render (it still reads purely from the store). Mounted once in
// App.jsx.
//
//   URL -> store:   on mount and on browser back/forward (location change).
//   store -> URL:   whenever a navigation-relevant store field changes, from
//                    ANY of the app's existing ~35 call sites (MainNav,
//                    Sidebar, LineA/LineB, HomepageTemplate, etc.) —
//                    unchanged, they keep calling the same store actions.
//
// Loop avoidance: both directions compare against the CURRENT URL before
// acting — the URL->store effect skips hydrating if the store already
// computes to the URL it just saw (meaning this location change was caused
// by our own store->URL sync, not a real navigation/back/forward), and the
// store->URL effect skips navigating if the computed path already matches
// window.location.pathname. Neither direction needs to know which one fired
// first; both just no-op once they're already in agreement.
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useAppStore from '../store/useAppStore'
import { stateToPath, pathToState } from './urlSchema'

// Only these fields affect the computed path (stateToPath) — watching the
// full store would re-run this on every unrelated change (sports list,
// yearRange, loading flags, etc).
const NAV_FIELDS = [
  'locale', 'activeSport', 'activeCategory', 'activeCompetition', 'activeYear', 'activeTab', 'activeEvent',
  'activeHomeHub', 'activeTennisTour', 'activeTennisTotals', 'activeTennisWatch', 'activeTennisRankings',
  'activeTennisSchedule', 'activeMmaSection', 'favouriteViewCompetition',
]

export default function useUrlSync() {
  const location = useLocation()
  const navigate = useNavigate()

  // URL -> store
  useEffect(() => {
    const computed = stateToPath(useAppStore.getState())
    if (computed === location.pathname) return // our own store->URL sync landed here; nothing to restore
    useAppStore.getState().hydrateFromUrl(pathToState(location.pathname))
  }, [location.pathname])

  // store -> URL
  useEffect(() => {
    return useAppStore.subscribe((state, prevState) => {
      if (!NAV_FIELDS.some(f => state[f] !== prevState[f])) return
      const path = stateToPath(state)
      if (path !== window.location.pathname) navigate(path)
    })
  }, [navigate])
}
