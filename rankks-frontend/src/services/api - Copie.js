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
  getSeason: (competition, year, event) => {
    let url = `/seasons?competition=${competition}&year=${year}`
    if (event) url += `&event=${event}`
    return fetchJSON(url)
  },
  getStandings: (seasonId, tabKey) => fetchJSON(`/results/standings/${seasonId}/${tabKey}`),
  getGames:     (seasonId, tabKey) => fetchJSON(`/results/games/${seasonId}/${tabKey}`),
  getPlayers:   (seasonId)         => fetchJSON(`/results/players/${seasonId}`),
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
}
