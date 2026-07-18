import { useState, useEffect, useMemo } from 'react'
import api, { publicApi } from '../api/client'
import styles from './MatchVideos.module.css'

export default function MatchVideos() {
  const [competitions, setCompetitions]   = useState([])
  const [selectedSport, setSelectedSport] = useState('')
  const [selectedComp, setSelectedComp]   = useState('')
  const [compSearch, setCompSearch]       = useState('')
  const [seasons, setSeasons]             = useState([])
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

  // ── Load seasons when competition changes ──
  useEffect(() => {
    setSelectedSeason('')
    setGames([])
    if (!selectedComp) { setSeasons([]); return }
    publicApi.get(`/seasons/by-competition?competition_id=${selectedComp}`)
      .then(r => setSeasons(r.data.data))
      .catch(console.error)
  }, [selectedComp])

  // ── Load games when season changes ──
  useEffect(() => {
    if (!selectedSeason) { setGames([]); return }
    setLoadingGames(true)
    api.get(`/media/games?season_id=${selectedSeason}`)
      .then(r => {
        setGames(r.data)
        // seed drafts from existing media so inputs show current values
        const seeded = {}
        r.data.forEach(g => {
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
  }, [selectedSeason])

  const sortedSeasons = [...seasons].sort((a, b) => b.year - a.year || (a.gender || '').localeCompare(b.gender || ''))

  const filteredGames = useMemo(() => {
    if (!search) return games
    const q = search.toLowerCase()
    return games.filter(g =>
      (g.home_name || '').toLowerCase().includes(q) ||
      (g.away_name || '').toLowerCase().includes(q) ||
      (g.round || '').toLowerCase().includes(q)
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
        // remember the new media_id so a second save edits instead of re-creating
        setGames(prev => prev.map(g => g.id === game.id ? { ...g, media_id: data.id } : g))
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
      await api.delete(`/media/${game.media_id}`)
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

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Match Videos</h1>
        <p className={styles.subtitle}>Attach one summary video per match</p>
      </div>

      {/* ── 3-column drill-down: Sport / Competition / Season ── */}
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
            ) : sortedSeasons.length === 0 ? (
              <div className={styles.drillEmpty}>No seasons</div>
            ) : sortedSeasons.map(s => (
              <button
                key={s.id}
                className={`${styles.drillItem} ${selectedSeason === String(s.id) ? styles.drillItemActive : ''}`}
                onClick={() => setSelectedSeason(String(s.id))}
              >
                {s.year}{s.gender ? ` (${s.gender})` : ''}
              </button>
            ))}
          </div>
        </div>
      </div>

      {selectedSeason && (
        <div className={styles.tableToolbar}>
          <input
            className={styles.search}
            placeholder="Search by team or round..."
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
            <span className={styles.colMatch}>Match</span>
            <span className={styles.colScore}>Score</span>
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
                <span className={styles.colRound}>{game.round || '—'}</span>
                <span className={styles.colMatch}>
                  {game.home_name || '?'} <span className={styles.vs}>vs</span> {game.away_name || '?'}
                </span>
                <span className={styles.colScore}>{formatScore(game.score_json)}</span>
                <span className={styles.colVideo}>
                  <input
                    className={styles.videoInput}
                    placeholder="https://youtube.com/watch?v=... or ATP/WTA link"
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
                    <option value="atp">ATP</option>
                    <option value="wta">WTA</option>
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
