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
  champion_history: lazy(() => import('./teams/champion_history_template')),
  countries:      lazy(() => import('./countries/countries_template')),
  iconic_moments: lazy(() => import('./media/iconic_moments_template')),
  coming_soon:    lazy(() => import('./shared/coming_soon_template')),
  teams_all_time: lazy(() => import('./teams/football_teams_all_time_template')),
  players_all_time_fb: lazy(() => import('./players/football_players_all_time_template')),
  champion_history_fb: lazy(() => import('./teams/football_champion_history_template')),
  champion_history_fb_ko: lazy(() => import('./teams/football_champion_history_knockout_template')),
  teams_all_time_ko: lazy(() => import('./teams/football_teams_all_time_knockout_template')),
  players_all_time_fb_ko: lazy(() => import('./players/football_players_all_time_knockout_template')),
}

/**
 * Resolves the DB typology + current context down to a registry key.
 * This is where sport/tab-specific branching lives — kept in ONE place
 * instead of scattered through ContentArea's render logic.
 *
 * @param {string} typology   curTab.typology from the DB
 * @param {string} sport      activeSport
 * @param {string} tab        activeTab (tab_key)
 * @param {string} competitionType competition.competition_type — only
 *   consulted for the one branch that needs it (champion_history_fb);
 *   every other typology ignores it, same as `tab` is only read by two.
 * @returns {string|null} a key into TEMPLATES, or null if nothing matches
 */
export function resolveTemplateKey(typology, sport, tab, competitionType) {
  if (typology === 'game' && sport === 'tennis') return 'tennis_draw'
  if (typology === 'players' && (tab === 'players-m' || tab === 'players-f')) return 'tennis_players'
  if (typology === 'players' && tab === 'all-time-players') return 'players_all_time'
  // Champion History for a knockout-final competition (World Cup, any
  // future quadrennial/biennial one with the same Final Tour shape) has no
  // league table — Champion/Runner-Up can't come from standings the way
  // champion_history_fb reads them for domestic leagues, so it gets its
  // own template instead.
  if (typology === 'champion_history_fb' && (competitionType === 'quadrennial' || competitionType === 'biennial')) {
    return 'champion_history_fb_ko'
  }
  // Team Stats for the same knockout competitions — teams_all_time reads
  // `standings WHERE tab_key='standings'`, which doesn't exist for World
  // Cup (0 rows, verified) since there's no single league table; this
  // knockout version derives Participations/Titles/Finals/Runner-up/3rd
  // and Group Stages vs Knockout W/D/L/GF/GA straight from `games`.
  if (typology === 'teams_all_time' && (competitionType === 'quadrennial' || competitionType === 'biennial')) {
    return 'teams_all_time_ko'
  }
  // Player Stats for the same knockout competitions — no per-game player
  // log exists in this schema (see the route's own comment), so this
  // knockout version drops the Group Stages/Knockout pill the other two
  // knockout pages have and reads Titles/Finals straight from `games`
  // instead of `standings`.
  if (typology === 'players_all_time_fb' && (competitionType === 'quadrennial' || competitionType === 'biennial')) {
    return 'players_all_time_fb_ko'
  }
  if (TEMPLATES[typology]) return typology
  return null
}
