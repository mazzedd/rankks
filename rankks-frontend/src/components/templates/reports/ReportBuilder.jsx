// Comparison-report builder: gender toggle -> 2-4 players -> Category/
// Surface filters -> live compare -> save/PDF. See the approved plan
// (Tennis Player Comparison Reports) for the section-scoping rule: PROFILE/
// RANKINGS are career-wide, TOURNAMENTS is scoped by both filters.
import { useState, useEffect, useRef } from 'react'
import useUserStore from '../../../store/useUserStore'
import { api } from '../../../services/api'
import PlayerSearchPicker from './PlayerSearchPicker'
import CheckDropdown from './CheckDropdown'
import ReportTable from './ReportTable'
import styles from './Reports.module.css'

function resolveImg(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  return url.startsWith('/media/') ? url : `/media/${url}`
}

const CATEGORY_OPTIONS = [
  { key: 'grand_slam',   label: 'Grand Slam' },
  { key: 'masters_1000', label: '1000' },
  { key: 'masters_500',  label: '500' },
  { key: 'masters_250',  label: '250' },
  { key: 'challenger',   label: 'Challenger' },
]
const SURFACE_OPTIONS = [
  { key: 'Hard',   label: 'Hard' },
  { key: 'Clay',   label: 'Clay' },
  { key: 'Grass',  label: 'Grass' },
  { key: 'Carpet', label: 'Carpet' },
]

export default function ReportBuilder({ initial, onSaved, onCancel }) {
  const token = useUserStore(s => s.token)

  const [gender, setGender] = useState(initial?.gender || 'M')
  const [slots, setSlots] = useState(() => {
    const arr = [null, null, null, null]
    if (initial?.players) initial.players.forEach((p, i) => { if (i < 4) arr[i] = p })
    return arr
  })
  const [categoryFilter, setCategoryFilter] = useState(initial?.category_filter || [])
  const [surfaceFilter, setSurfaceFilter] = useState(initial?.surface_filter || [])
  const [reportData, setReportData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [reportName, setReportName] = useState(initial?.name || '')
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState(null)
  const autoRanRef = useRef(false)

  const filledSlots = slots.filter(Boolean)
  const canGenerate = filledSlots.length >= 2

  const generate = async () => {
    if (!canGenerate) return
    setLoading(true)
    setError(null)
    setSaveMessage(null)
    try {
      const data = await api.compareReport({
        gender,
        playerIds: filledSlots.map(p => p.id ?? p.entity_id),
        categoryFilter,
        surfaceFilter,
      })
      setReportData(data)
    } catch (err) {
      setError(err.message || 'Could not generate report')
      setReportData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (initial && !autoRanRef.current && filledSlots.length >= 2) {
      autoRanRef.current = true
      generate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setSlot = (index, entity) => {
    setSlots(prev => prev.map((s, i) => i === index ? entity : s))
    setReportData(null)
  }
  const clearSlot = (index) => {
    setSlots(prev => prev.map((s, i) => i === index ? null : s))
    setReportData(null)
  }
  const changeGender = (g) => {
    if (g === gender) return
    setGender(g)
    setSlots([null, null, null, null])
    setReportData(null)
  }
  const toggleCategory = (key) => {
    setCategoryFilter(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
    setReportData(null)
  }
  const toggleSurface = (key) => {
    setSurfaceFilter(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
    setReportData(null)
  }

  const save = async () => {
    if (!reportData || !reportName.trim()) return
    setSaving(true)
    setSaveMessage(null)
    try {
      const saved = await api.saveReport(token, {
        name: reportName.trim(),
        gender,
        player_ids: filledSlots.map(p => p.id ?? p.entity_id),
        category_filter: categoryFilter,
        surface_filter: surfaceFilter,
      })
      setSaveMessage('Report saved.')
      onSaved?.(saved)
    } catch (err) {
      setSaveMessage(err.message || 'Could not save report')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.builder}>
      <div className={styles.builderHeader}>
        <div className={styles.genderToggle}>
          <button type="button" className={`${styles.genderBtn}${gender === 'M' ? ' ' + styles.genderBtnActive : ''}`} onClick={() => changeGender('M')}>Men</button>
          <button type="button" className={`${styles.genderBtn}${gender === 'F' ? ' ' + styles.genderBtnActive : ''}`} onClick={() => changeGender('F')}>Women</button>
        </div>
        {onCancel && <button type="button" className={styles.linkBtn} onClick={onCancel}>&larr; Back to My Reports</button>}
      </div>

      {/* 5-column layout (Mohamed 2026-08-20: "1 col = criteria and 4
          other columns = players") — criteria panel first, then 4 player
          slots; the last 2 are dashed + "optional" since only 2 are
          required. */}
      <div className={styles.builderGrid}>
        <div className={styles.criteriaPanel}>
          <div className={styles.criteriaPanelTitle}>Criteria</div>
          <CheckDropdown label="Category" options={CATEGORY_OPTIONS} selected={categoryFilter} onToggle={toggleCategory} onClear={() => setCategoryFilter([])} />
          <CheckDropdown label="Surface" options={SURFACE_OPTIONS} selected={surfaceFilter} onToggle={toggleSurface} onClear={() => setSurfaceFilter([])} />
        </div>

        {slots.map((entity, i) => {
          const optional = i >= 2
          return (
            <div key={i} className={`${styles.slot}${optional ? ' ' + styles.slotOptional : ''}`}>
              {entity ? (
                <div className={styles.slotFilled}>
                  {entity.image_url && <img src={resolveImg(entity.image_url)} alt="" className={styles.slotImg} />}
                  <span className={styles.slotName}>{entity.canonical_name || entity.name}</span>
                  <button type="button" className={styles.slotRemove} onClick={() => clearSlot(i)} aria-label="Remove">×</button>
                </div>
              ) : (
                <>
                  <PlayerSearchPicker
                    gender={gender}
                    excludeIds={filledSlots.map(p => p.id ?? p.entity_id)}
                    onSelect={(picked) => setSlot(i, picked)}
                    placeholder="Choose player"
                  />
                  {optional && <span className={styles.slotOptionalLabel}>optional</span>}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className={styles.actionsRow}>
        <button type="button" className={styles.primaryBtn} disabled={!canGenerate || loading} onClick={generate}>
          {loading ? 'Generating…' : 'Generate Report'}
        </button>
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      {reportData && (
        <>
          <ReportTable data={reportData} />
          <div className={styles.saveRow}>
            <input
              type="text"
              className={styles.nameInput}
              placeholder="Name this report"
              value={reportName}
              onChange={e => setReportName(e.target.value)}
            />
            <button type="button" className={styles.primaryBtn} disabled={!reportName.trim() || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save Report'}
            </button>
            <button type="button" className={styles.secondaryBtn} onClick={() => window.print()}>Download PDF</button>
            {saveMessage && <span className={styles.saveMessage}>{saveMessage}</span>}
          </div>
        </>
      )}
    </div>
  )
}
