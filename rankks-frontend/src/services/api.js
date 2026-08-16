const BASE='/api'

export function mediaUrl(path) {
  if (!path) return null
  if (path.startsWith('http')) return path
  return path.startsWith('/media/') ? path : `/media/${path}`
}

async function fetchJSON(url) {
  const res = await fetch(BASE + url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`)
  const json = await res.json()
  return json.data
}

// Authenticated requests (signup/login/favourites/preferences) go through
// here instead of fetchJSON — they need a Bearer token and, on failure, the
// caller needs the server's { error, cap_type, cap, message } body intact
// (not just a generic Error) so the UI can tell a cap-hit from any other
// failure and show the right inline message.
async function authFetch(url, token, options = {}) {
  const res = await fetch(BASE + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.message || json.error || `API error ${res.status}: ${url}`)
    err.code = json.error
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

export const api = {
  getSports:                  ()           => fetchJSON('/sports'),
  getSport:                   (slug)       => fetchJSON(`/sports/${slug}`),
  getCompetition:             (slug)       => fetchJSON(`/competitions/${slug}`),
  getCompetitionsByCategory:  (sport, cat, year) => fetchJSON(`/competitions?sport=${sport}&category=${cat}${year ? `&year=${year}` : ''}`),
  getTennisHome:               (tour, year) => fetchJSON(`/competitions/home/${tour}/${year}`),
  getTennisTotals:             (tour, year) => fetchJSON(`/competitions/totals/${tour}/${year}`),
  getTennisPlayerTotals:       (tour, year) => fetchJSON(`/competitions/player-totals/${tour}/${year}`),
  getTennisRankings:           (tour, year) => fetchJSON(`/competitions/rankings/${tour}/${year}`),
  // Tournament Stats' "All-Time Results" drawer — every edition of one
  // tournament, most recent first, capped through the selected year.
  getTournamentHistory: (competitionId, tour, year) => fetchJSON(`/competitions/tournament-history/${competitionId}/${tour}/${year}`),
  getNaming:                  (slug, year) => fetchJSON(`/competitions/${slug}/naming/${year}`),
  getCategoryEra:             (slug, year) => fetchJSON(`/competitions/${slug}/category-era/${year}`),
  getYearRange:               (slug)       => fetchJSON(`/competitions/${slug}/year-range`),
  getCompetitionLogo:         (slug, year) => fetchJSON(`/competitions/${slug}/logo/${year}`),
  getEntityLogo:              (slug, year) => fetchJSON(`/entities/${slug}/logo/${year}`),
  getCompetitionEvents:       (slug, year) => fetchJSON(`/competitions/${slug}/events/${year}`),
  getSeason: (competition, year, event) => {
    let url = `/seasons?competition=${competition}&year=${year}`
    if (event) url += `&event=${event}`
    return fetchJSON(url)
  },
  getStandings: (seasonId, tabKey) => fetchJSON(`/results/standings/${seasonId}/${tabKey}`),
  getGames:     (seasonId, tabKey) => fetchJSON(`/results/games/${seasonId}/${tabKey}`),
  getGamesByGroup: (seasonId, tabGroup) => fetchJSON(`/results/games-by-group/${seasonId}/${tabGroup}`),
  getPlayers:   (seasonId, tabKey, type) => {
    const params = []
    if (tabKey) params.push(`tabKey=${tabKey}`)
    if (type)   params.push(`type=${type}`)
    return fetchJSON(`/results/players/${seasonId}${params.length ? `?${params.join('&')}` : ''}`)
  },
  getClubs: (seasonId, search, country) => {
    let url = `/results/clubs/${seasonId}`
    const params = []
    if (search)  params.push(`search=${encodeURIComponent(search)}`)
    if (country) params.push(`country=${encodeURIComponent(country)}`)
    if (params.length) url += `?${params.join('&')}`
    return fetchJSON(url)
  },
  getTeams: (seasonId, search) => {
    let url = `/results/teams/${seasonId}`
    if (search) url += `?search=${encodeURIComponent(search)}`
    return fetchJSON(url)
  },
  getFootballTeamsAllTime: (seasonId) => fetchJSON(`/results/teams-all-time/${seasonId}`),
  getFootballPlayersAllTime: (seasonId) => fetchJSON(`/results/players-all-time-football/${seasonId}`),
  getFootballChampionHistory: (seasonId) => fetchJSON(`/results/champion-history-football/${seasonId}`),
  getFootballChampionHistoryKnockout: (seasonId) => fetchJSON(`/results/champion-history-football-knockout/${seasonId}`),
  getFootballTeamsAllTimeKnockout: (seasonId) => fetchJSON(`/results/teams-all-time-football-knockout/${seasonId}`),
  getFootballPlayersAllTimeKnockout: (seasonId) => fetchJSON(`/results/players-all-time-football-knockout/${seasonId}`),
  getFootballHomeKnockout: (seasonId) => fetchJSON(`/results/home-football-knockout/${seasonId}`),
  getNbaHome: (year) => fetchJSON(`/results/home-nba/${year}`),
  getTeamHonours: (seasonId, search) => {
    let url = `/results/team-honours/${seasonId}`
    if (search) url += `?search=${encodeURIComponent(search)}`
    return fetchJSON(url)
  },
  getChampionHistory: (seasonId) => {
    return fetchJSON(`/results/champion-history/${seasonId}`)
  },
  getPlayersAllTime: (seasonId, type, search) => {
    let url = `/results/players-all-time/${seasonId}?type=${type || 'regular'}`
    if (search) url += `&search=${encodeURIComponent(search)}`
    return fetchJSON(url)
  },
  getPlayerAwards: (seasonId, search) => {
    let url = `/results/player-awards/${seasonId}`
    if (search) url += `?search=${encodeURIComponent(search)}`
    return fetchJSON(url)
  },
  getCountries: (seasonId, search, confederation) => {
    let url = `/results/countries/${seasonId}`
    const params = []
    if (search)        params.push(`search=${encodeURIComponent(search)}`)
    if (confederation) params.push(`confederation=${encodeURIComponent(confederation)}`)
    if (params.length) url += `?${params.join('&')}`
    return fetchJSON(url)
  },
  getSeasonStats: (seasonId)       => fetchJSON(`/results/stats/${seasonId}`),
  getMedia:     (seasonId)         => fetchJSON(`/media?seasonId=${seasonId}`),
  getRegion:    (country)          => fetchJSON(`/regions?country=${country}`),
  trackEvent:   (payload)          => fetch(BASE + '/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {}),
  getEntityHistory: (entityId, competitionId, year, tabKey) =>
    fetchJSON(`/seasons/entity-history?entity_id=${entityId}&competition_id=${competitionId}&year=${year}${tabKey ? `&tab_key=${tabKey}` : ''}`),
  getAwardWinner: (seasonId, tabKey) =>
    fetchJSON(`/seasons/award-winner?season_id=${seasonId}&tab_key=${tabKey}`),
  getClubLeaders: (clubEntityId, competitionId, year) =>
    fetchJSON(`/seasons/club-leaders?club_entity_id=${clubEntityId}&competition_id=${competitionId}&year=${year}`),
  getGrandSlamHistory: (entityId, year, competitionId) =>
    fetchJSON(`/seasons/grand-slam-history?entity_id=${entityId}&year=${year}${competitionId ? `&competition_id=${competitionId}` : ''}`),
  getTennisTierHistory: (entityId, year, competitionId) =>
    fetchJSON(`/seasons/tennis-tier-history?entity_id=${entityId}&year=${year}${competitionId ? `&competition_id=${competitionId}` : ''}`),
  getPlayerLeaders: (entityId, competitionId, year) =>
    fetchJSON(`/seasons/player-leaders?entity_id=${entityId}&competition_id=${competitionId}&year=${year}`),
  getIconicMoments: (seasonId, category, tag) => {
    let url = `/results/iconic-moments/${seasonId}`
    const params = []
    if (category) params.push(`category=${category}`)
    if (tag)      params.push(`tag=${tag}`)
    if (params.length) url += `?${params.join('&')}`
    return fetchJSON(url)
  },
  // Per-sport category taxonomy (Build Log v2.1) — used by both the
  // Iconic Moments admin editor and, now, the public gallery template
  // itself, so category labels are never hardcoded per sport.
  getIconicMomentCategories: (sportSlug) => fetchJSON(`/iconic-moment-categories?sport_slug=${sportSlug}`),
  // Admin-configured subtitle line for one Line A/B item (Item A + Item B,
  // matching rankks-admin's Subtitles page), fully formatted — year suffix
  // already applied server-side, do not concatenate a year onto the
  // result yourself — { subtitle: string|null }. competitionSlug and
  // itemB are optional (omit competitionSlug for a sport-wide item like
  // tennis's Totals hub; omit itemB for an item with no sub-item).
  getSubtitle: (sportSlug, competitionSlug, itemA, itemB, year, isPast) => {
    const sp = sportSlug ? `sport_slug=${encodeURIComponent(sportSlug)}&` : ''
    const comp = competitionSlug ? `&competition_slug=${encodeURIComponent(competitionSlug)}` : ''
    const b = itemB ? `&item_b=${encodeURIComponent(itemB)}` : ''
    const past = isPast === undefined ? '' : `&is_past=${isPast}`
    return fetchJSON(`/subtitles/resolve?${sp}item_a=${encodeURIComponent(itemA)}${comp}${b}&year=${year}${past}`)
  },
  // ATP/WTA Watch Center — tour-wide gallery (all categories, one year),
  // same { items, total } shape as getIconicMoments above so
  // IconicMomentsTemplate can be reused unmodified via its fetchMoments prop.
  getTennisIconicMomentsTotals: (tour, year, category, tag) => {
    let url = `/competitions/iconic-moments-totals/${tour}/${year}`
    const params = []
    if (category) params.push(`category=${category}`)
    if (tag)      params.push(`tag=${tag}`)
    if (params.length) url += `?${params.join('&')}`
    return fetchJSON(url)
  },
  // ── MotoGP — own dedicated tables/routes, same "close to F1" pattern as
  // above, plus a `category` param (motogp/moto2/moto3) every F1 call
  // doesn't need — see onboarding-motogp.md ──
  getMotoGPYears:  (category)         => fetchJSON(`/motogp/years?category=${category}`),
  getMotoGPSeason: (year, category)   => fetchJSON(`/motogp/season/${year}?category=${category}`),
  getMotoGPGp:     (slug, year, category) => fetchJSON(`/motogp/gp/${slug}/${year}?category=${category}`),
  getMotoGPSessionResults: (sessionId) => fetchJSON(`/motogp/session/${sessionId}/results`),
  getMotoGPStandings: (seasonId, type) => fetchJSON(`/motogp/standings/${seasonId}/${type}`),
  // One row per round's RAC winner (plus SPR winner on sprint rounds) —
  // seasonId alone scopes it to the right category, same as getMotoGPStandings.
  getMotoGPRaces: (seasonId) => fetchJSON(`/motogp/races/${seasonId}`),
  getMotoGPPoles: (seasonId) => fetchJSON(`/motogp/poles/${seasonId}`),
  getMotoGPRidersAllTime: (seasonId) => fetchJSON(`/motogp/riders-all-time/${seasonId}`),
  getMotoGPConstructorsAllTime: (seasonId) => fetchJSON(`/motogp/constructors-all-time/${seasonId}`),
  getMotoGPRacesAllTime: (seasonId) => fetchJSON(`/motogp/races-all-time/${seasonId}`),
  // "All-Time Results" drawer for one Grand Prix — same shape as
  // getF1GPHistory, plus the category param every MotoGP route needs.
  getMotoGPGPHistory: (slug, year, category) => fetchJSON(`/motogp/gp-history/${slug}/${year}?category=${category}`),
  // One row per (round, session) for the Home tab's calendar feed — same
  // shape as getF1HomeSessions. seasonId alone scopes it to the right
  // category, same as getMotoGPStandings/Races/Poles.
  getMotoGPHomeSessions: (seasonId) => fetchJSON(`/motogp/home-sessions/${seasonId}`),
  // Single-rider career totals through a given year, scoped to one class
  // lineage — powers MotoGPChampionshipBlock's career stat bloc.
  getMotoGPRiderCareer: (entityId, category, throughYear) =>
    fetchJSON(`/motogp/rider-career/${entityId}?category=${category}&throughYear=${throughYear}`),
  // Cumulative Wins/Podiums/Sprint Wins/Sprint Podiums through a given
  // round — powers MotoGPGPBlock's stat bar (fetched twice: this round
  // and the previous one, same delta-badge pattern as F1GPBlock).
  getMotoGPRiderRoundStats: (entityId, year, category, throughRound) =>
    fetchJSON(`/motogp/rider-round-stats/${entityId}?year=${year}&category=${category}&throughRound=${throughRound}`),
  // MotoGP iconic-moments gallery — same shape as getF1IconicMoments
  // ({ items, total }), pointed at motogp_iconic_moments. seasonId alone
  // already scopes it to the right class (each (year, category) pair is
  // its own season_id — see routes/motogp.js file header), so no separate
  // category param is needed here the way getMotoGPYears/Season need one.
  getMotoGPIconicMoments: (seasonId, category, tag) => {
    let url = `/motogp/iconic-moments/${seasonId}`
    const params = []
    if (category) params.push(`category=${category}`)
    if (tag)      params.push(`tag=${tag}`)
    if (params.length) url += `?${params.join('&')}`
    return fetchJSON(url)
  },
  // Team career totals through a given year — powers MotoGPTeamsBlock's
  // career stat bloc, same "career total + this-season badge" method as
  // getF1TeamCareer. Keyed by team_name (URL-encoded), not an entity_id —
  // see /team-career's own comment for why.
  getMotoGPTeamCareer: (teamName, category, throughYear) =>
    fetchJSON(`/motogp/team-career?team_name=${encodeURIComponent(teamName)}&category=${category}&throughYear=${throughYear}`),
  // ── F1 — dedicated tables/routes, separate from the generic
  // seasons/results endpoints above (see RANKKS F1 Master Spec) ──
  getF1Years:         ()              => fetchJSON('/f1/years'),
  getF1Season:        (year)          => fetchJSON(`/f1/season/${year}`),
  getF1Gp:            (slug, year)    => fetchJSON(`/f1/gp/${slug}/${year}`),
  getF1SessionResults:(sessionId)     => fetchJSON(`/f1/session/${sessionId}/results`),
  getF1Races:         (seasonId)      => fetchJSON(`/f1/races/${seasonId}`),
  getF1HomeSessions:  (seasonId)      => fetchJSON(`/f1/home-sessions/${seasonId}`),
  getF1FastestLaps:   (seasonId)      => fetchJSON(`/f1/fastest-laps/${seasonId}`),
  getF1Poles:         (seasonId)      => fetchJSON(`/f1/poles/${seasonId}`),
  getF1Standings:     (seasonId, type)=> fetchJSON(`/f1/standings/${seasonId}/${type}`),
  getF1DriversAllTime:(seasonId)      => fetchJSON(`/f1/drivers-all-time/${seasonId}`),
  getF1TeamsAllTime:  (seasonId)      => fetchJSON(`/f1/teams-all-time/${seasonId}`),
  getF1RacesAllTime:  (seasonId)      => fetchJSON(`/f1/races-all-time/${seasonId}`),
  // Cumulative Wins/2nd/3rd for one driver within one season, up to and
  // including a given round (round_order). Powers the GP EventBlock's
  // stat bar (F1GPBlock) — shows the race winner's season-to-date
  // podium counts as of that specific race, matching the "Event-time
  // snapshot" notice already present in the block.
  getF1DriverRaceStats: (entityId, seasonId, uptoRound) =>
    fetchJSON(`/f1/driver-race-stats/${entityId}?seasonId=${seasonId}&uptoRound=${uptoRound}`),
  // Single-driver career totals through a given year — powers
  // F1ChampionshipBlock's career stat bloc (Seasons/Champion/Wins/
  // Podiums/Poles/Sprints).
  getF1DriverCareer: (entityId, throughYear) =>
    fetchJSON(`/f1/driver-career/${entityId}?throughYear=${throughYear}`),
  // Team counterpart — powers F1TeamsChampionshipBlock's own career stat bloc.
  getF1TeamCareer: (entityId, throughYear) =>
    fetchJSON(`/f1/team-career/${entityId}?throughYear=${throughYear}`),
  // F1 iconic-moments gallery — same shape as getIconicMoments above
  // ({ items, total }), pointed at f1_iconic_moments instead of the
  // generic media table, so the shared IconicMomentsTemplate component
  // can be reused unmodified via its fetchMoments prop.
  getF1IconicMoments: (seasonId, category, tag) => {
    let url = `/f1/iconic-moments/${seasonId}`
    const params = []
    if (category) params.push(`category=${category}`)
    if (tag)      params.push(`tag=${tag}`)
    if (params.length) url += `?${params.join('&')}`
    return fetchJSON(url)
  },
  // Race Stats' "All-Time Results" drawer — every Race result for one
  // Grand Prix since its 1st edition, most recent first, capped through
  // the selected year. Same "ATP model" as getTournamentHistory above.
  getF1GPHistory: (slug, year) => fetchJSON(`/f1/gp-history/${slug}/${year}`),
  // ── Auth / Favourites (Build Log — Favourites + Subscription scaffolding) ──
  signup: (email, password, display_name) =>
    authFetch('/auth/signup', null, { method: 'POST', body: JSON.stringify({ email, password, display_name }) }),
  login: (email, password) =>
    authFetch('/auth/login', null, { method: 'POST', body: JSON.stringify({ email, password }) }),
  getMe: (token) => authFetch('/auth/me', token).then(j => j.data),
  getFavourites: (token) => authFetch('/favourites', token).then(j => j.data),
  addFavourite: (token, entity_type, entity_id) =>
    authFetch('/favourites', token, { method: 'POST', body: JSON.stringify({ entity_type, entity_id }) }).then(j => j.data),
  removeFavourite: (token, id) =>
    authFetch(`/favourites/${id}`, token, { method: 'DELETE' }),
  updatePreferences: (token, userId, show_odds_data) =>
    authFetch(`/users/${userId}/preferences`, token, { method: 'PATCH', body: JSON.stringify({ show_odds_data }) }).then(j => j.data),
  // ── Video stats (Watch drawer) — views + favourited count, shared by
  // the 3 "Watch" video tables (media/f1_race_video/motogp_race_video).
  // Public: no auth, views count registered and unregistered viewers alike.
  getVideoStats: (videoType, id) => fetchJSON(`/video-stats/${videoType}/${id}`),
  trackVideoView: (videoType, id) =>
    fetch(BASE + `/video-stats/${videoType}/${id}/view`, { method: 'POST' })
      .then(r => r.json()).then(j => j.data).catch(() => null),
}
