import { useState, useEffect, useMemo } from 'react'
import api, { publicApi } from '../api/client'
import styles from './MatchVideos.module.css'

// Same page used for every sport, including Car Racing. F1 has its own
// dedicated tables (f1_seasons, f1_grands_prix, f1_race_videos) instead
// of the generic seasons/games/media schema — so when the selected
// competition's sport_slug is 'car-racing', every data call below is
// swapped for its F1 equivalent. The UI, columns, and save/remove flow
// stay identical; only the endpoints change. Each loaded race/game row
// is tagged with _isF1 so save()/remove() know which endpoint to hit
// without needing to re-derive it from current selection state.
export default function MatchVideos() {
  const [competitions, setCompetitions]   = useState([])
  const [selectedSport, setSelectedSport] = useState('')
  const [selectedComp, setSelectedComp]   = useState('')
  const [compSearch, setCompSearch]       = useState('')
  const [seasons, setSeasons]             = useState([])
  const [selectedYear, setSelectedYear]   = useState('')
  const [selectedSeason, setSelectedSeason] = useState('')
  const [games, setGames]                 = useState([])
  const [loadingGames, setLoadingGames]   = useState(false)
  const [search, setSearch]               = useState('')
  const [drafts, setDrafts]               = useState({})   // gameId -> { video_url, source, embeddable }
  const [savingId, setSavingId]           = useState(null)
  const [savedId, setSavedId]             = useState(null)

  // ── Load competitions once ──
  useEffect(() => {
    publicApi.get('/competitions')
      .then(r => setCompetitions(r.data.data))
      .catch(console.error)
  }, [])

  // Sports derived from the competitions list — Column 1
  const sports = [...new Set(competitions.map(c => c.sport_name).filter(Boolean))].sort()

  // Competitions for the selected sport, filtered by search — Column 2
  const compsForSport = competitions
    .filter(c => c.sport_name === selectedSport)
    .filter(c => !compSearch || c.name.toLowerCase().includes(compSearch.toLowerCase()))

  const selectedCompObj = competitions.find(c => String(c.id) === selectedComp)
  const isF1 = selectedCompObj?.sport_slug === 'car-racing'

  // ── Load seasons when competition changes ──
  useEffect(() => {
    setSelectedYear('')
    setSelectedSeason('')
    setGames([])
    if (!selectedComp) { setSeasons([]); return }
    const request = isF1
      ? api.get('/f1/seasons')
      : publicApi.get(`/seasons/by-competition?competition_id=${selectedComp}`)
    request
      .then(r => {
        const rows = isF1 ? r.data.map(s => ({ id: s.id, year: s.year, gender: null })) : r.data.data
        setSeasons(rows)
      })
      .catch(console.error)
  }, [selectedComp, isF1])

  // ── Load games (or F1 races) when season changes ──
  useEffect(() => {
    if (!selectedSeason) { setGames([]); return }
    setLoadingGames(true)
    const request = isF1
      ? api.get(`/f1/races?season_id=${selectedSeason}`)
      : api.get(`/media/games?season_id=${selectedSeason}`)
    request
      .then(r => {
        const rows = isF1
          ? r.data.map(race => ({
              id: race.id,
              round: race.round_order,
              date_display: race.event_date,
              home_name: race.name,
              away_name: null,
              score_json: null,
              media_id: race.video_id,
              video_url: race.video_url,
              source: race.source,
              embeddable: race.embeddable,
              _isF1: true,
            }))
          : r.data.map(g => ({ ...g, _isF1: false }))
        setGames(rows)
        // seed drafts from existing media so inputs show current values
        const seeded = {}
        rows.forEach(g => {
          seeded[g.id] = {
            video_url: g.video_url || '',
            source: g.source || 'youtube',
            embeddable: g.embeddable !== undefined ? g.embeddable : true,
          }
        })
        setDrafts(seeded)
      })
      .catch(console.error)
      .finally(() => setLoadingGames(false))
  }, [selectedSeason, isF1])

  // Only events with actual games can have a match video attached — hides
  // non-game events (e.g. NBA Awards/All-Star) that would otherwise show up
  // as indistinguishable duplicate year rows. F1 rows have no has_game_tabs
  // field (separate endpoint) and are game-like by nature, so they pass through.
  const sortedSeasons = [...seasons]
    .filter(s => s.has_game_tabs !== false)
    .sort((a, b) => b.year - a.year || (a.gender || '').localeCompare(b.gender || ''))

  // Column 3 groups by year (+gender) so a year like NBA's 2025/26 is a
  // single row instead of 4 near-identical ones; Column 4 lists that
  // year's events (Regular Season/Finals/Playoffs/Play-in). Years with
  // only one event (football, tennis, F1) auto-select it on year click,
  // so those sports keep their original one-click behavior.
  const yearGroups = useMemo(() => {
    const map = new Map()
    sortedSeasons.forEach(s => {
      const key = `${s.year}_${s.gender || ''}`
      if (!map.has(key)) map.set(key, { key, year: s.year, gender: s.gender, events: [] })
      map.get(key).events.push(s)
    })
    return [...map.values()]
  }, [sortedSeasons])

  const selectedYearGroup = yearGroups.find(g => g.key === selectedYear)

  const selectYear = (group) => {
    setSelectedYear(group.key)
    setSelectedSeason(group.events.length === 1 ? String(group.events[0].id) : '')
  }

  const filteredGames = useMemo(() => {
    if (!search) return games
    const q = search.toLowerCase()
    return games.filter(g =>
      (g.home_name || '').toLowerCase().includes(q) ||
      (g.away_name || '').toLowerCase().includes(q) ||
      (g.round != null ? String(g.round) : '').toLowerCase().includes(q)
    )
  }, [games, search])

  const updateDraft = (gameId, field, value) => {
    setDrafts(prev => ({
      ...prev,
      [gameId]: { ...prev[gameId], [field]: value },
    }))
  }

  const save = async (game) => {
    const draft = drafts[game.id]
    if (!draft || !draft.video_url) return
    setSavingId(game.id)
    try {
      if (game._isF1) {
        if (game.media_id) {
          await api.put(`/f1/race-videos/${game.media_id}`, {
            video_url: draft.video_url,
            source: draft.source,
            embeddable: draft.embeddable,
          })
        } else {
          const { data } = await api.post('/f1/race-videos', {
            grand_prix_id: game.id,
            video_url: draft.video_url,
            source: draft.source,
            embeddable: draft.embeddable,
          })
          setGames(prev => prev.map(g => g.id === game.id ? { ...g, media_id: data.id } : g))
        }
      } else {
        if (game.media_id) {
          await api.put(`/media/${game.media_id}`, {
            video_url: draft.video_url,
            source: draft.source,
            embeddable: draft.embeddable,
          })
        } else {
          const { data } = await api.post('/media', {
            media_type: 'match_summary',
            season_id: selectedSeason,
            game_id: game.id,
            video_url: draft.video_url,
            source: draft.source,
            embeddable: draft.embeddable,
          })
          setGames(prev => prev.map(g => g.id === game.id ? { ...g, media_id: data.id } : g))
        }
      }
      setSavedId(game.id)
      setTimeout(() => setSavedId(null), 1800)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSavingId(null)
    }
  }

  const remove = async (game) => {
    if (!game.media_id) return
    if (!confirm('Remove this video?')) return
    try {
      if (game._isF1) {
        await api.delete(`/f1/race-videos/${game.media_id}`)
      } else {
        await api.delete(`/media/${game.media_id}`)
      }
      setGames(prev => prev.map(g => g.id === game.id ? { ...g, media_id: null, video_url: null } : g))
      setDrafts(prev => ({ ...prev, [game.id]: { video_url: '', source: 'youtube', embeddable: true } }))
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
  }

  const formatScore = (score) => {
    if (!score) return '—'
    if (typeof score === 'object') return `${score.home ?? '-'} : ${score.away ?? '-'}`
    return String(score)
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    if (isNaN(d)) return '—'
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Match Videos</h1>
        <p className={styles.subtitle}>Attach one summary video per match</p>
      </div>

      {/* ── 4-column drill-down: Sport / Competition / Season / Event ── */}
      <div className={styles.drilldown}>
        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Sport</div>
          <div className={styles.drillList}>
            {sports.map(sport => (
              <button
                key={sport}
                className={`${styles.drillItem} ${selectedSport === sport ? styles.drillItemActive : ''}`}
                onClick={() => { setSelectedSport(sport); setSelectedComp(''); setCompSearch('') }}
              >
                {sport}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Competition</div>
          {selectedSport && (
            <input
              className={styles.drillSearch}
              placeholder="Search..."
              value={compSearch}
              onChange={e => setCompSearch(e.target.value)}
            />
          )}
          <div className={styles.drillList}>
            {!selectedSport ? (
              <div className={styles.drillEmpty}>Select a sport</div>
            ) : compsForSport.length === 0 ? (
              <div className={styles.drillEmpty}>No match</div>
            ) : compsForSport.map(c => (
              <button
                key={c.id}
                className={`${styles.drillItem} ${selectedComp === String(c.id) ? styles.drillItemActive : ''}`}
                onClick={() => setSelectedComp(String(c.id))}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Season</div>
          <div className={styles.drillList}>
            {!selectedComp ? (
              <div className={styles.drillEmpty}>Select a competition</div>
            ) : yearGroups.length === 0 ? (
              <div className={styles.drillEmpty}>No seasons</div>
            ) : yearGroups.map(g => (
              <button
                key={g.key}
                className={`${styles.drillItem} ${selectedYear === g.key ? styles.drillItemActive : ''}`}
                onClick={() => selectYear(g)}
              >
                {g.year}{g.gender ? ` (${g.gender})` : ''}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Event</div>
          <div className={styles.drillList}>
            {!selectedYear ? (
              <div className={styles.drillEmpty}>Select a season</div>
            ) : selectedYearGroup.events.map(s => (
              <button
                key={s.id}
                className={`${styles.drillItem} ${selectedSeason === String(s.id) ? styles.drillItemActive : ''}`}
                onClick={() => setSelectedSeason(String(s.id))}
              >
                {s.event_name || 'Season'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectedSeason && (
        <div className={styles.tableToolbar}>
          <input
            className={styles.search}
            placeholder={isF1 ? 'Search by race name...' : 'Search by team or round...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

      {!selectedSeason ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🎬</span>
          <span>Select a sport, competition, and season to manage match videos</span>
        </div>
      ) : loadingGames ? (
        <div className={styles.loading}>Loading games...</div>
      ) : (
        <div className={styles.gameList}>
          <div className={styles.gameListHeader}>
            <span className={styles.colRound}>Round</span>
            <span className={styles.colMatch}>{isF1 ? 'Race' : 'Match'}</span>
            <span className={styles.colScore}>{isF1 ? 'Date' : 'Score'}</span>
            <span className={styles.colVideo}>Video URL</span>
            <span className={styles.colSource}>Source</span>
            <span className={styles.colAction}></span>
          </div>

          {filteredGames.length === 0 ? (
            <div className={styles.noResults}>No games match your search</div>
          ) : filteredGames.map(game => {
            const draft = drafts[game.id] || { video_url: '', source: 'youtube', embeddable: true }
            const hasVideo = !!game.media_id
            return (
              <div key={game.id} className={`${styles.gameRow} ${hasVideo ? styles.gameRowHasVideo : ''}`}>
                <span className={styles.colRound}>{game.round ?? '—'}</span>
                <span className={styles.colMatch}>
                  {game._isF1
                    ? game.home_name
                    : <>{game.home_name || '?'} <span className={styles.vs}>vs</span> {game.away_name || '?'}</>}
                </span>
                <span className={styles.colScore}>
                  {game._isF1 ? formatDate(game.date_display) : formatScore(game.score_json)}
                </span>
                <span className={styles.colVideo}>
                  <input
                    className={styles.videoInput}
                    placeholder="https://youtube.com/watch?v=... or official link"
                    value={draft.video_url}
                    onChange={e => updateDraft(game.id, 'video_url', e.target.value)}
                  />
                </span>
                <span className={styles.colSource}>
                  <select
                    className={styles.sourceSelect}
                    value={draft.source}
                    onChange={e => updateDraft(game.id, 'source', e.target.value)}
                  >
                    <option value="youtube">YouTube</option>
                    {!game._isF1 && <option value="atp">ATP</option>}
                    {!game._isF1 && <option value="wta">WTA</option>}
                    <option value="official">Official</option>
                    <option value="other">Other</option>
                  </select>
                </span>
                <span className={styles.colAction}>
                  <button
                    className={`${styles.saveBtn} ${savedId === game.id ? styles.saved : ''}`}
                    onClick={() => save(game)}
                    disabled={savingId === game.id || !draft.video_url}
                  >
                    {savingId === game.id ? '...' : savedId === game.id ? '✓' : hasVideo ? 'Update' : 'Save'}
                  </button>
                  {hasVideo && (
                    <button className={styles.removeBtn} onClick={() => remove(game)} title="Remove video">
                      ✕
                    </button>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
