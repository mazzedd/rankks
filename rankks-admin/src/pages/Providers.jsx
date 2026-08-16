import { useState, useEffect, useMemo } from 'react'
import api from '../api/client'
import styles from './Providers.module.css'

// Groups the flat row list (one row per provider+coverage+schedule combo)
// back into a provider -> coverage[] -> schedules[] tree for rendering.
function buildTree(rows) {
  const providers = new Map()

  for (const r of rows) {
    if (!providers.has(r.provider_id)) {
      providers.set(r.provider_id, {
        id: r.provider_id,
        name: r.provider_name,
        display_name: r.provider_display_name,
        base_url: r.provider_base_url,
        enabled: r.provider_enabled,
        coverage: new Map(),
      })
    }
    const provider = providers.get(r.provider_id)

    if (r.coverage_id && !provider.coverage.has(r.coverage_id)) {
      provider.coverage.set(r.coverage_id, {
        id: r.coverage_id,
        sport_id: r.sport_id,
        sport_name: r.sport_name,
        competition_id: r.competition_id,
        competition_name: r.competition_name,
        first_season_available: r.first_season_available,
        coverage_notes: r.coverage_notes,
        script_path: r.script_path,
        enabled: r.coverage_enabled,
        schedules: [],
      })
    }

    if (r.coverage_id && r.schedule_id) {
      provider.coverage.get(r.coverage_id).schedules.push({
        id: r.schedule_id,
        data_type: r.data_type,
        frequency_minutes: r.frequency_minutes,
        enabled: r.schedule_enabled,
        last_run_at: r.last_run_at,
        next_run_at: r.next_run_at,
        last_run_status: r.last_run_status,
        last_run_message: r.last_run_message,
      })
    }
  }

  return [...providers.values()].map(p => ({
    ...p,
    coverage: [...p.coverage.values()],
  }))
}

function timeAgo(dateStr) {
  if (!dateStr) return 'never'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const DATA_TYPES = ['standings', 'fixtures', 'players', 'topscorers', 'portraits']

export default function Providers() {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [lookup, setLookup]       = useState({ sports: [], competitions: [] })

  const [filterSport, setFilterSport]       = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [filterEvent, setFilterEvent]       = useState('')

  const [showAddProvider, setShowAddProvider]     = useState(false)
  const [newProvider, setNewProvider]             = useState({ name: '', display_name: '', base_url: '' })

  const [showAddCoverage, setShowAddCoverage]     = useState(null) // provider_id or null
  const [newCoverage, setNewCoverage]             = useState({ sport_id: '', competition_id: '', first_season_available: '', coverage_notes: '', script_path: '' })

  const [runningIds, setRunningIds]               = useState(new Set()) // schedule_ids currently running a manual trigger

  const load = () => {
    setLoading(true)
    api.get('/providers')
      .then(r => setRows(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    api.get('/providers/lookup-data')
      .then(r => setLookup(r.data))
      .catch(console.error)
  }, [])

  const tree = useMemo(() => buildTree(rows), [rows])

  const filteredTree = useMemo(() => {
    return tree
      .filter(p => !filterProvider || String(p.id) === filterProvider)
      .map(p => ({
        ...p,
        coverage: p.coverage.filter(c =>
          (!filterSport || String(c.sport_id) === filterSport) &&
          (!filterEvent || String(c.competition_id) === filterEvent)
        ),
      }))
      .filter(p => !filterSport && !filterEvent ? true : p.coverage.length > 0)
  }, [tree, filterSport, filterEvent, filterProvider])

  const competitionOptions = useMemo(() => {
    if (!filterSport) return lookup.competitions
    return lookup.competitions.filter(c => String(c.sport_id) === filterSport)
  }, [lookup.competitions, filterSport])

  // ── Mutations ──

  const toggleProvider = async (provider) => {
    const next = !provider.enabled
    setRows(prev => prev.map(r => r.provider_id === provider.id ? { ...r, provider_enabled: next } : r))
    try {
      await api.put(`/providers/${provider.id}`, { enabled: next })
    } catch (err) {
      alert('Failed to update provider: ' + (err.response?.data?.error || err.message))
      load()
    }
  }

  const deleteProvider = async (provider) => {
    if (!confirm(`Delete "${provider.display_name}"? This removes all its coverage and schedule rows too.`)) return
    try {
      await api.delete(`/providers/${provider.id}`)
      load()
    } catch (err) {
      alert('Failed to delete provider: ' + (err.response?.data?.error || err.message))
    }
  }

  const toggleCoverage = async (coverage) => {
    const next = !coverage.enabled
    setRows(prev => prev.map(r => r.coverage_id === coverage.id ? { ...r, coverage_enabled: next } : r))
    try {
      await api.put(`/provider-coverage/${coverage.id}`, { enabled: next })
    } catch (err) {
      alert('Failed to update coverage: ' + (err.response?.data?.error || err.message))
      load()
    }
  }

  const updateScriptPath = async (coverage, scriptPath) => {
    setRows(prev => prev.map(r => r.coverage_id === coverage.id ? { ...r, script_path: scriptPath } : r))
    try {
      await api.put(`/provider-coverage/${coverage.id}`, { script_path: scriptPath || null })
    } catch (err) {
      alert('Failed to update script path: ' + (err.response?.data?.error || err.message))
      load()
    }
  }

  const deleteCoverage = async (coverage) => {
    if (!confirm(`Remove "${coverage.competition_name}" from this provider? This deletes its schedule rows too.`)) return
    try {
      await api.delete(`/provider-coverage/${coverage.id}`)
      load()
    } catch (err) {
      alert('Failed to delete coverage: ' + (err.response?.data?.error || err.message))
    }
  }

  const toggleSchedule = async (schedule) => {
    const next = !schedule.enabled
    setRows(prev => prev.map(r => r.schedule_id === schedule.id ? { ...r, schedule_enabled: next } : r))
    try {
      await api.put(`/ingestion-schedules/${schedule.id}`, { enabled: next })
    } catch (err) {
      alert('Failed to update schedule: ' + (err.response?.data?.error || err.message))
      load()
    }
  }

  const updateFrequency = async (schedule, minutes) => {
    const val = parseInt(minutes)
    if (!val || val < 1) return
    setRows(prev => prev.map(r => r.schedule_id === schedule.id ? { ...r, frequency_minutes: val } : r))
    try {
      await api.put(`/ingestion-schedules/${schedule.id}`, { frequency_minutes: val })
    } catch (err) {
      alert('Failed to update frequency: ' + (err.response?.data?.error || err.message))
      load()
    }
  }

  const triggerNow = async (schedule) => {
    setRunningIds(prev => new Set(prev).add(schedule.id))
    try {
      const { data } = await api.post(`/ingestion-schedules/${schedule.id}/trigger`)
      setRows(prev => prev.map(r => r.schedule_id === schedule.id ? {
        ...r,
        last_run_at: data.last_run_at,
        last_run_status: data.last_run_status,
        last_run_message: data.last_run_message,
        next_run_at: data.next_run_at,
      } : r))
    } catch (err) {
      alert('Failed to trigger run: ' + (err.response?.data?.error || err.message))
    } finally {
      setRunningIds(prev => {
        const next = new Set(prev)
        next.delete(schedule.id)
        return next
      })
    }
  }

  const submitNewProvider = async () => {
    if (!newProvider.name || !newProvider.display_name) return
    try {
      await api.post('/providers', newProvider)
      setShowAddProvider(false)
      setNewProvider({ name: '', display_name: '', base_url: '' })
      load()
    } catch (err) {
      alert('Failed to create provider: ' + (err.response?.data?.error || err.message))
    }
  }

  const submitNewCoverage = async () => {
    if (!newCoverage.sport_id) return
    try {
      await api.post('/provider-coverage', {
        provider_id: showAddCoverage,
        sport_id: newCoverage.sport_id,
        // Competition is optional — a coverage row can represent a
        // cross-tournament feed (e.g. "whatever's live right now") that
        // isn't scoped to any single competition/season.
        competition_id: newCoverage.competition_id || null,
        first_season_available: newCoverage.first_season_available ? parseInt(newCoverage.first_season_available) : null,
        coverage_notes: newCoverage.coverage_notes || null,
        script_path: newCoverage.script_path || null,
      })
      // Seed all 5 data-type schedules at once, daily by default —
      // mirrors what the SQL seed block did for Ligue 1.
      const { data: created } = await api.get('/providers')
      const matches = created.filter(r =>
        r.provider_id === showAddCoverage &&
        String(r.sport_id) === String(newCoverage.sport_id) &&
        (newCoverage.competition_id
          ? String(r.competition_id) === String(newCoverage.competition_id)
          : r.competition_id == null)
      )
      // Highest coverage_id among matches = the row just inserted.
      const coverageRow = matches.reduce((best, r) => (!best || r.coverage_id > best.coverage_id) ? r : best, null)
      if (coverageRow?.coverage_id) {
        await Promise.all(DATA_TYPES.map(dt =>
          api.post('/ingestion-schedules', { coverage_id: coverageRow.coverage_id, data_type: dt, frequency_minutes: 1440, enabled: true })
        ))
      }
      setShowAddCoverage(null)
      setNewCoverage({ sport_id: '', competition_id: '', first_season_available: '', coverage_notes: '' })
      load()
    } catch (err) {
      alert('Failed to add coverage: ' + (err.response?.data?.error || err.message))
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Providers</h1>
        <p className={styles.subtitle}>Data sources, coverage, and ingestion schedules</p>
      </div>

      <div className={styles.filterBar}>
        <select className={styles.filterSelect} value={filterSport} onChange={e => { setFilterSport(e.target.value); setFilterEvent('') }}>
          <option value="">All sports</option>
          {lookup.sports.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select className={styles.filterSelect} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
          <option value="">All events</option>
          {competitionOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select className={styles.filterSelect} value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
          <option value="">All providers</option>
          {tree.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>

        <button className={styles.addProviderBtn} onClick={() => setShowAddProvider(true)}>+ Add provider</button>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : filteredTree.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🔌</span>
          <span>No providers match these filters</span>
        </div>
      ) : (
        filteredTree.map(provider => (
          <div key={provider.id} className={styles.providerGroup}>

            <div className={`${styles.providerHeader} ${!provider.enabled ? styles.disabled : ''}`}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={provider.enabled}
                  onChange={() => toggleProvider(provider)}
                />
                <span className={styles.toggleSlider} />
              </label>
              <span className={styles.providerName}>{provider.display_name}</span>
              {provider.base_url && <span className={styles.providerBaseUrl}>{provider.base_url}</span>}
              <span className={styles.providerStatusLabel}>{provider.enabled ? 'Active' : 'Disabled'}</span>
              <button className={styles.deleteBtn} onClick={() => deleteProvider(provider)}>Delete</button>
            </div>

            {provider.coverage.map(coverage => (
              <div key={coverage.id} className={styles.coverageRow}>
                <div className={`${styles.coverageHeader} ${!coverage.enabled ? styles.disabled : ''}`}>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={coverage.enabled}
                      onChange={() => toggleCoverage(coverage)}
                    />
                    <span className={styles.toggleSlider} />
                  </label>
                  <div className={styles.coverageMain}>
                    <span className={styles.coverageSport}>{coverage.sport_name}</span>
                    <span className={styles.coverageName}>{coverage.competition_name || 'All competitions (live feed)'}</span>
                  </div>
                  {coverage.first_season_available && (
                    <span className={styles.coverageSince}>since {coverage.first_season_available}</span>
                  )}
                  <button className={styles.deleteBtn} onClick={() => deleteCoverage(coverage)}>Remove</button>
                </div>

                {coverage.coverage_notes && (
                  <div className={styles.coverageNotes}>{coverage.coverage_notes}</div>
                )}

                <div className={styles.scriptPathRow}>
                  <span className={styles.scriptPathLabel}>Script:</span>
                  <input
                    className={styles.scriptPathInput}
                    defaultValue={coverage.script_path || ''}
                    placeholder="ingest-ligue1.js"
                    onBlur={e => {
                      if (e.target.value !== (coverage.script_path || '')) {
                        updateScriptPath(coverage, e.target.value)
                      }
                    }}
                  />
                </div>

                <div className={styles.scheduleList}>
                  {coverage.schedules.map(schedule => (
                    <div key={schedule.id} className={`${styles.scheduleRow} ${!schedule.enabled ? styles.disabled : ''}`}>
                      <label className={styles.toggle}>
                        <input
                          type="checkbox"
                          checked={schedule.enabled}
                          onChange={() => toggleSchedule(schedule)}
                        />
                        <span className={styles.toggleSlider} />
                      </label>
                      <span className={styles.scheduleType}>{schedule.data_type}</span>
                      <input
                        className={styles.freqInput}
                        type="number"
                        min="1"
                        defaultValue={schedule.frequency_minutes}
                        onBlur={e => updateFrequency(schedule, e.target.value)}
                      />
                      <span className={styles.freqUnit}>min</span>
                      <button
                        className={styles.runNowBtn}
                        disabled={runningIds.has(schedule.id)}
                        onClick={() => triggerNow(schedule)}
                      >
                        {runningIds.has(schedule.id) ? 'Running…' : 'Run now'}
                      </button>
                      <div className={styles.scheduleStatus}>
                        <span className={`${styles.statusDot} ${styles[schedule.last_run_status] || styles.unknown}`} />
                        <span>{schedule.last_run_status ? `${schedule.last_run_status} · ${timeAgo(schedule.last_run_at)}` : 'never run'}</span>
                        {schedule.last_run_message && (
                          <span className={styles.lastRunMessage} title={schedule.last_run_message}>
                            {schedule.last_run_message}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <button className={styles.addCompetitionBtn} onClick={() => setShowAddCoverage(provider.id)}>
              + Add competition to this provider
            </button>
          </div>
        ))
      )}

      {showAddProvider && (
        <div className={styles.modalOverlay} onClick={() => setShowAddProvider(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>Add provider</div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Internal name (slug)</label>
              <input
                className={styles.modalInput}
                value={newProvider.name}
                onChange={e => setNewProvider(p => ({ ...p, name: e.target.value }))}
                placeholder="api-sports-tennis"
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Display name</label>
              <input
                className={styles.modalInput}
                value={newProvider.display_name}
                onChange={e => setNewProvider(p => ({ ...p, display_name: e.target.value }))}
                placeholder="API-Sports (Tennis)"
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Base URL (optional)</label>
              <input
                className={styles.modalInput}
                value={newProvider.base_url}
                onChange={e => setNewProvider(p => ({ ...p, base_url: e.target.value }))}
                placeholder="https://v1.tennis.api-sports.io"
              />
            </div>

            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowAddProvider(false)}>Cancel</button>
              <button
                className={styles.modalSubmitBtn}
                onClick={submitNewProvider}
                disabled={!newProvider.name || !newProvider.display_name}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddCoverage !== null && (
        <div className={styles.modalOverlay} onClick={() => setShowAddCoverage(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalTitle}>Add competition coverage</div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Sport</label>
              <select
                className={styles.modalSelect}
                value={newCoverage.sport_id}
                onChange={e => setNewCoverage(p => ({ ...p, sport_id: e.target.value, competition_id: '' }))}
              >
                <option value="">— Select —</option>
                {lookup.sports.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Competition (optional)</label>
              <select
                className={styles.modalSelect}
                value={newCoverage.competition_id}
                onChange={e => setNewCoverage(p => ({ ...p, competition_id: e.target.value }))}
                disabled={!newCoverage.sport_id}
              >
                <option value="">— None (cross-competition feed) —</option>
                {lookup.competitions
                  .filter(c => String(c.sport_id) === String(newCoverage.sport_id))
                  .map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                }
              </select>
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>First season available</label>
              <input
                className={styles.modalInput}
                type="number"
                value={newCoverage.first_season_available}
                onChange={e => setNewCoverage(p => ({ ...p, first_season_available: e.target.value }))}
                placeholder="2010"
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Notes (optional)</label>
              <input
                className={styles.modalInput}
                value={newCoverage.coverage_notes}
                onChange={e => setNewCoverage(p => ({ ...p, coverage_notes: e.target.value }))}
                placeholder="No data before 2010"
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Script file</label>
              <input
                className={styles.modalInput}
                value={newCoverage.script_path}
                onChange={e => setNewCoverage(p => ({ ...p, script_path: e.target.value }))}
                placeholder="ingest-ligue1.js"
              />
            </div>

            <div className={styles.modalActions}>
              <button className={styles.modalCancelBtn} onClick={() => setShowAddCoverage(null)}>Cancel</button>
              <button
                className={styles.modalSubmitBtn}
                onClick={submitNewCoverage}
                disabled={!newCoverage.sport_id}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
