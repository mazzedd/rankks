const BASE='/api'

export function mediaUrl(path) {
  if (!path) return null
  if (path.startsWith('http')) return path
  return `http://localhost:3000${path}`
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
  getNaming:                  (slug, year) => fetchJSON(`/competitions/${slug}/naming/${year}`),
  getCompetitionLogo:         (slug, year) => fetchJSON(`/competitions/${slug}/logo/${year}`),
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
  getTeamHonours: (seasonId, search) => {
    let url = `/results/team-honours/${seasonId}`
    if (search) url += `?search=${encodeURIComponent(search)}`
    return fetchJSON(url)
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
  // ── F1 — dedicated tables/routes, separate from the generic
  // seasons/results endpoints above (see RANKKS F1 Master Spec) ──
  getF1Years:         ()              => fetchJSON('/f1/years'),
  getF1Season:        (year)          => fetchJSON(`/f1/season/${year}`),
  getF1Gp:            (slug, year)    => fetchJSON(`/f1/gp/${slug}/${year}`),
  getF1SessionResults:(sessionId)     => fetchJSON(`/f1/session/${sessionId}/results`),
  getF1Races:         (seasonId)      => fetchJSON(`/f1/races/${seasonId}`),
  getF1FastestLaps:   (seasonId)      => fetchJSON(`/f1/fastest-laps/${seasonId}`),
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
}
