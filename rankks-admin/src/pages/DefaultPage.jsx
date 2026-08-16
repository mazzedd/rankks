import { useState, useEffect, useMemo } from 'react'
import api, { publicApi } from '../api/client'
import styles from './DefaultPage.module.css'

// Car-racing competitions include per-season synthetic rows (e.g.
// "formula-1-world-championship-2023") alongside the evergreen championship
// row — same filter Sidebar.jsx applies, since only the championship-level
// row is a sensible "default landing page".
const YEAR_SUFFIX = /-\d{4}$/

export default function DefaultPage() {
  const [sports, setSports]           = useState([])
  const [activeSlug, setActiveSlug]   = useState(null)
  const [sportDetail, setSportDetail] = useState(null)
  const [loading, setLoading]         = useState(false)
  const [savingSlug, setSavingSlug]   = useState(null)

  useEffect(() => {
    publicApi.get('/sports')
      .then(r => {
        const list = r.data.data || []
        setSports(list)
        if (list.length) setActiveSlug(list[0].slug)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (!activeSlug) return
    setLoading(true)
    publicApi.get(`/sports/${activeSlug}`)
      .then(r => setSportDetail(r.data.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [activeSlug])

  const isCarRacing = activeSlug === 'car-racing'

  const groups = useMemo(() => {
    if (!sportDetail) return []
    return (sportDetail.categories || [])
      .map(cat => ({
        ...cat,
        competitions: (cat.competitions || []).filter(c =>
          isCarRacing ? !YEAR_SUFFIX.test(c.slug) : true
        ),
      }))
      .filter(cat => cat.competitions.length)
  }, [sportDetail, isCarRacing])

  const toggleDefault = async (competition) => {
    const turningOn = !competition.is_default
    const sportId = sportDetail.id

    setSportDetail(prev => ({
      ...prev,
      categories: prev.categories.map(cat => ({
        ...cat,
        competitions: cat.competitions.map(c => ({
          ...c,
          is_default: turningOn ? c.id === competition.id : (c.id === competition.id ? false : c.is_default),
        })),
      })),
    }))
    setSavingSlug(competition.slug)
    try {
      await api.put(`/sports/${sportId}/default-competition`, {
        competition_id: turningOn ? competition.id : null,
      })
    } catch (err) {
      alert('Failed to update default: ' + (err.response?.data?.error || err.message))
      publicApi.get(`/sports/${activeSlug}`).then(r => setSportDetail(r.data.data)).catch(console.error)
    } finally {
      setSavingSlug(null)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Default Page</h1>
        <p className={styles.subtitle}>Pick one competition per sport to land on when a visitor clicks that sport in the main bar</p>
      </div>

      <div className={styles.sportTabs}>
        {sports.map(s => (
          <button
            key={s.slug}
            className={`${styles.sportTab}${activeSlug === s.slug ? ' ' + styles.active : ''}`}
            onClick={() => setActiveSlug(s.slug)}
          >
            {s.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={styles.loading}>Loading...</div>
      ) : groups.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🎯</span>
          <span>No competitions found for this sport</span>
        </div>
      ) : (
        groups.map(cat => (
          <div key={cat.id} className={styles.group}>
            <div className={styles.groupLabel}>{cat.short_name}</div>
            {cat.competitions.map(c => (
              <div key={c.id} className={`${styles.compRow}${c.is_default ? ' ' + styles.isDefault : ''}`}>
                <label className={styles.toggle}>
                  <input
                    type="checkbox"
                    checked={!!c.is_default}
                    disabled={savingSlug === c.slug}
                    onChange={() => toggleDefault(c)}
                  />
                  <span className={styles.toggleSlider} />
                </label>
                <span className={styles.compName}>{c.name}</span>
                {c.is_default && <span className={styles.defaultBadge}>Default</span>}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
