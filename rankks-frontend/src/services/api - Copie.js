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

export const api = {
  getSports:                  ()           => fetchJSON('/sports'),
  getSport:                   (slug)       => fetchJSON(`/sports/${slug}`),
  getCompetition:             (slug)       => fetchJSON(`/competitions/${slug}`),
  getCompetitionsByCategory:  (sport, cat, year) => fetchJSON(`/competitions?sport=${sport}&category=${cat}${year ? `&year=${year}` : ''}`),
  getNaming:                  (slug, year) => fetchJSON(`/competitions/${slug}/naming/${year}`),
  getCompetitionLogo:         (slug, year) => fetchJSON(`/competitions/${slug}/logo/${year}`),
  getSeason: (competition, year, event) => {
    let url = `/seasons?competition=${competition}&year=${year}`
    if (event) url += `&event=${event}`
    return fetchJSON(url)
  },
  getStandings: (seasonId, tabKey) => fetchJSON(`/results/standings/${seasonId}/${tabKey}`),
  getGames:     (seasonId, tabKey) => fetchJSON(`/results/games/${seasonId}/${tabKey}`),
  getGamesByGroup: (seasonId, tabGroup) => fetchJSON(`/results/games-by-group/${seasonId}/${tabGroup}`),
  getPlayers:   (seasonId)         => fetchJSON(`/results/players/${seasonId}`),
  getClubs: (seasonId, search, country) => {
    let url = `/results/clubs/${seasonId}`
    const params = []
    if (search)  params.push(`search=${encodeURIComponent(search)}`)
    if (country) params.push(`country=${encodeURIComponent(country)}`)
    if (params.length) url += `?${params.join('&')}`
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
  getEntityHistory: (entityId, competitionId, year) =>
    fetchJSON(`/seasons/entity-history?entity_id=${entityId}&competition_id=${competitionId}&year=${year}`),
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
}
