// templates/registry.js
//
// Single source of truth mapping a result_tab's `typology` (from the DB,
// see RANKKS-Spec §7 `result_tabs.typology`) to the React component that
// renders it. ContentArea.jsx imports ONLY this file for template lookup —
// it never imports a template component directly.
//
// Why this exists: at 80 sports, most new sports reuse `standings` or
// `game` as-is. Adding sport #50 should mean editing DATA (the `typology`
// column for its result_tabs in the DB / admin panel), not editing this
// file or ContentArea.jsx. This file only grows when a sport needs a
// genuinely new typology — not one entry per sport.
//
// Each component is wrapped in React.lazy so Vite code-splits it into its
// own chunk. A user who never opens a tennis draw never downloads the
// tennis draw bracket code.

import { lazy } from 'react'

export const TEMPLATES = {
  standings: lazy(() => import('./standings/standings_template')),
  game:      lazy(() => import('./game/game_template')),
  tennis_draw: lazy(() => import('./game/tennis_draw_template')),
  players:        lazy(() => import('./players/players_template')),
  players_all_time: lazy(() => import('./players/players_all_time_template')),
  player_awards:  lazy(() => import('./players/player_awards_template')),
  tennis_players: lazy(() => import('./players/tennis_players_template')),
  clubs:          lazy(() => import('./clubs/clubs_template')),
  teams:          lazy(() => import('./teams/teams_template')),
  team_honours:   lazy(() => import('./teams/team_honours_template')),
  countries:      lazy(() => import('./countries/countries_template')),
  iconic_moments: lazy(() => import('./media/iconic_moments_template')),
}

/**
 * Resolves the DB typology + current context down to a registry key.
 * This is where sport/tab-specific branching lives — kept in ONE place
 * instead of scattered through ContentArea's render logic.
 *
 * @param {string} typology   curTab.typology from the DB
 * @param {string} sport      activeSport
 * @param {string} tab        activeTab (tab_key)
 * @returns {string|null} a key into TEMPLATES, or null if nothing matches
 */
export function resolveTemplateKey(typology, sport, tab) {
  if (typology === 'game' && sport === 'tennis') return 'tennis_draw'
  if (typology === 'players' && (tab === 'players-m' || tab === 'players-f')) return 'tennis_players'
  if (typology === 'players' && tab === 'all-time-players') return 'players_all_time'
  if (TEMPLATES[typology]) return typology
  return null
}
