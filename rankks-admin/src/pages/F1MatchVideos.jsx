import { useState, useEffect, useMemo } from 'react'
import api from '../api/client'
import styles from './MatchVideos.module.css'

// F1 equivalent of MatchVideos.jsx — same visual pattern (reuses the
// exact same CSS module) but a 2-column drill-down (Season -> Race)
// instead of 3-column (Sport -> Competition -> Season), since F1 has
// only one competition and its own dedicated tables (f1_seasons,
// f1_grands_prix, f1_race_videos) rather than the generic schema.
// One video per race — enforced by a UNIQUE constraint on
// f1_race_videos.grand_prix_id, so save() always PUTs by video_id once
// one exists rather than risking a duplicate insert.
export default function F1MatchVideos() {
  const [seasons, setSeasons]               = useState([])
  const [selectedSeason, setSelectedSeason] = useState('')
  const [races, setRaces]                   = useState([])
  const [loadingRaces, setLoadingRaces]     = useState(false)
  const [search, setSearch]                 = useState('')
  const [drafts, setDrafts]                 = useState({})   // raceId -> { video_url, source, embeddable }
  const [savingId, setSavingId]             = useState(null)
  const [savedId, setSavedId]               = useState(null)

  // ── Load seasons once ──
  useEffect(() => {
    api.get('/f1/seasons')
      .then(r => setSeasons(r.data))
      .catch(console.error)
  }, [])

  // ── Load races when season changes ──
  useEffect(() => {
    if (!selectedSeason) { setRaces([]); return }
    setLoadingRaces(true)
    api.get(`/f1/races?season_id=${selectedSeason}`)
      .then(r => {
        setRaces(r.data)
        const seeded = {}
        r.data.forEach(race => {
          seeded[race.id] = {
            video_url: race.video_url || '',
            source: race.source || 'youtube',
            embeddable: race.embeddable !== undefined ? race.embeddable : true,
          }
        })
        setDrafts(seeded)
      })
      .catch(console.error)
      .finally(() => setLoadingRaces(false))
  }, [selectedSeason])

  const sortedSeasons = [...seasons].sort((a, b) => b.year - a.year)

  const filteredRaces = useMemo(() => {
    if (!search) return races
    const q = search.toLowerCase()
    return races.filter(r => (r.name || '').toLowerCase().includes(q))
  }, [races, search])

  const updateDraft = (raceId, field, value) => {
    setDrafts(prev => ({
      ...prev,
      [raceId]: { ...prev[raceId], [field]: value },
    }))
  }

  const save = async (race) => {
    const draft = drafts[race.id]
    if (!draft || !draft.video_url) return
    setSavingId(race.id)
    try {
      if (race.video_id) {
        await api.put(`/f1/race-videos/${race.video_id}`, {
          video_url: draft.video_url,
          source: draft.source,
          embeddable: draft.embeddable,
        })
      } else {
        const { data } = await api.post('/f1/race-videos', {
          grand_prix_id: race.id,
          video_url: draft.video_url,
          source: draft.source,
          embeddable: draft.embeddable,
        })
        // remember the new video_id so a second save edits instead of re-creating
        setRaces(prev => prev.map(r => r.id === race.id ? { ...r, video_id: data.id } : r))
      }
      setSavedId(race.id)
      setTimeout(() => setSavedId(null), 1800)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSavingId(null)
    }
  }

  const remove = async (race) => {
    if (!race.video_id) return
    if (!confirm('Remove this video?')) return
    try {
      await api.delete(`/f1/race-videos/${race.video_id}`)
      setRaces(prev => prev.map(r => r.id === race.id ? { ...r, video_id: null, video_url: null } : r))
      setDrafts(prev => ({ ...prev, [race.id]: { video_url: '', source: 'youtube', embeddable: true } }))
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message))
    }
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
        <h1 className={styles.title}>F1 Race Videos</h1>
        <p className={styles.subtitle}>Attach one summary video per race</p>
      </div>

      {/* ── 2-column drill-down: Season / Race — F1 has one competition, so
          no Sport/Competition columns are needed here ── */}
      <div className={styles.drilldown}>
        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Season</div>
          <div className={styles.drillList}>
            {sortedSeasons.length === 0 ? (
              <div className={styles.drillEmpty}>No seasons</div>
            ) : sortedSeasons.map(s => (
              <button
                key={s.id}
                className={`${styles.drillItem} ${selectedSeason === String(s.id) ? styles.drillItemActive : ''}`}
                onClick={() => setSelectedSeason(String(s.id))}
              >
                {s.year}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.drillCol}>
          <div className={styles.drillColTitle}>Race</div>
          <div className={styles.drillList}>
            {!selectedSeason ? (
              <div className={styles.drillEmpty}>Select a season</div>
            ) : loadingRaces ? (
              <div className={styles.drillEmpty}>Loading...</div>
            ) : races.length === 0 ? (
              <div className={styles.drillEmpty}>No races</div>
            ) : (
              <div className={styles.drillEmpty}>{races.length} races this season — see table below</div>
            )}
          </div>
        </div>
      </div>

      {selectedSeason && (
        <div className={styles.tableToolbar}>
          <input
            className={styles.search}
            placeholder="Search by race name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      )}

      {!selectedSeason ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🎬</span>
          <span>Select a season to manage race videos</span>
        </div>
      ) : loadingRaces ? (
        <div className={styles.loading}>Loading races...</div>
      ) : (
        <div className={styles.gameList}>
          <div className={styles.gameListHeader}>
            <span className={styles.colRound}>Round</span>
            <span className={styles.colMatch}>Race</span>
            <span className={styles.colScore}>Date</span>
            <span className={styles.colVideo}>Video URL</span>
            <span className={styles.colSource}>Source</span>
            <span className={styles.colAction}></span>
          </div>

          {filteredRaces.length === 0 ? (
            <div className={styles.noResults}>No races match your search</div>
          ) : filteredRaces.map(race => {
            const draft = drafts[race.id] || { video_url: '', source: 'youtube', embeddable: true }
            const hasVideo = !!race.video_id
            return (
              <div key={race.id} className={`${styles.gameRow} ${hasVideo ? styles.gameRowHasVideo : ''}`}>
                <span className={styles.colRound}>{race.round_order ?? '—'}</span>
                <span className={styles.colMatch}>{race.name}</span>
                <span className={styles.colScore}>{formatDate(race.event_date)}</span>
                <span className={styles.colVideo}>
                  <input
                    className={styles.videoInput}
                    placeholder="https://youtube.com/watch?v=... or official link"
                    value={draft.video_url}
                    onChange={e => updateDraft(race.id, 'video_url', e.target.value)}
                  />
                </span>
                <span className={styles.colSource}>
                  <select
                    className={styles.sourceSelect}
                    value={draft.source}
                    onChange={e => updateDraft(race.id, 'source', e.target.value)}
                  >
                    <option value="youtube">YouTube</option>
                    <option value="official">Official</option>
                    <option value="other">Other</option>
                  </select>
                </span>
                <span className={styles.colAction}>
                  <button
                    className={`${styles.saveBtn} ${savedId === race.id ? styles.saved : ''}`}
                    onClick={() => save(race)}
                    disabled={savingId === race.id || !draft.video_url}
                  >
                    {savingId === race.id ? '...' : savedId === race.id ? '✓' : hasVideo ? 'Update' : 'Save'}
                  </button>
                  {hasVideo && (
                    <button className={styles.removeBtn} onClick={() => remove(race)} title="Remove video">
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
