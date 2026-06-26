import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import styles from './Athletes.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const SPORTS = [
  { id: 1, name: 'Football' },
  { id: 2, name: 'Tennis'   },
]

const CURRENT_YEAR = new Date().getFullYear()
const PRO_YEARS = Array.from({ length: CURRENT_YEAR - 1959 }, (_, i) => CURRENT_YEAR - i)

const TENNIS_HAND     = [{ v: 'R', l: 'Right-handed' }, { v: 'L', l: 'Left-handed' }]
const TENNIS_BACKHAND = [{ v: 'two', l: 'Two-handed' }, { v: 'one', l: 'One-handed' }]
const FOOTBALL_FOOT   = [{ v: 'R', l: 'Right-footed' }, { v: 'L', l: 'Left-footed' }, { v: 'B', l: 'Both' }]
const FOOTBALL_POS    = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker', 'Forward']

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoToDisplay(iso) {
  if (!iso) return ''
  const s = typeof iso === 'string' ? iso.slice(0, 10) : ''
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

function displayToIso(str) {
  if (!str) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str
  const p = str.split('/')
  if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1]}-${p[0]}`
  return null
}

function handLabel(v) {
  return TENNIS_HAND.find(h => h.v === v)?.l || v || ''
}
function backhandLabel(v) {
  return TENNIS_BACKHAND.find(b => b.v === v)?.l || v || ''
}
function footLabel(v) {
  return FOOTBALL_FOOT.find(f => f.v === v)?.l || v || ''
}

// ── Athlete row ───────────────────────────────────────────────────────────────

function AthleteRow({ athlete, sport, onSaved }) {
  const [open, setOpen]       = useState(false)
  const [form, setForm]       = useState({})
  const [dateText, setDateText] = useState('')
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  const isTennis   = sport.id === 2
  const isFootball = sport.id === 1
  const sa         = athlete.sport_attributes || {}

  const openEdit = () => {
    setForm({
      birth_date:      athlete.birth_date ? athlete.birth_date.slice(0, 10) : '',
      turned_pro_year: athlete.turned_pro_year || '',
      hand:            sa.hand     || '',
      backhand:        sa.backhand || '',
      foot:            sa.foot     || '',
      position:        athlete.position    || '',
      portrait_path:   athlete.portrait_path || '',
    })
    setDateText(isoToDisplay(athlete.birth_date))
    setOpen(true)
    setSaved(false)
  }

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleDateType = e => {
    setDateText(e.target.value)
    const iso = displayToIso(e.target.value)
    if (iso) set('birth_date', iso)
  }

  const handleDatePicker = e => {
    set('birth_date', e.target.value)
    setDateText(isoToDisplay(e.target.value))
  }

  const save = async () => {
    setSaving(true)
    try {
      const iso = displayToIso(dateText)
      await api.put(`/athletes/${athlete.entity_id}`, {
        ...form,
        birth_date: iso || form.birth_date || null,
        sport_id:   athlete.sport_id,
      })
      setSaved(true)
      onSaved()
      setTimeout(() => { setSaved(false); setOpen(false) }, 1200)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${styles.row} ${open ? styles.rowOpen : ''}`}>

      {/* Summary */}
      <div className={styles.summary} onClick={() => open ? setOpen(false) : openEdit()}>
        <div className={styles.summaryLeft}>
          <span className={styles.name}>{athlete.name || athlete.slug}</span>
          {athlete.nationality && <span className={styles.nat}>{athlete.nationality}</span>}
          {athlete.birth_date  && <span className={styles.meta}>{isoToDisplay(athlete.birth_date)}</span>}
          {isFootball && athlete.position && <span className={styles.pill}>{athlete.position}</span>}
          {isFootball && sa.foot          && <span className={styles.pill}>{footLabel(sa.foot)}</span>}
          {isTennis   && sa.hand          && <span className={styles.pill}>{handLabel(sa.hand)}</span>}
          {isTennis   && sa.backhand      && <span className={styles.pill}>{backhandLabel(sa.backhand)}</span>}
          {isTennis   && athlete.turned_pro_year && <span className={styles.meta}>Pro {athlete.turned_pro_year}</span>}
        </div>
        <span className={styles.chevron}>{open ? '▲' : '▼'}</span>
      </div>

      {/* Form */}
      {open && (
        <div className={styles.form}>
          <div className={styles.grid}>

            {/* Birthdate */}
            <div className={styles.field}>
              <label className={styles.label}>Birthdate</label>
              <div className={styles.dateRow}>
                <input
                  className={styles.input}
                  value={dateText}
                  onChange={handleDateType}
                  placeholder="DD/MM/YYYY"
                  maxLength={10}
                />
                <input
                  type="date"
                  className={styles.datePicker}
                  value={form.birth_date || ''}
                  onChange={handleDatePicker}
                />
              </div>
            </div>

            {/* Football */}
            {isFootball && <>
              <div className={styles.field}>
                <label className={styles.label}>Position</label>
                <select className={styles.select} value={form.position} onChange={e => set('position', e.target.value)}>
                  <option value="">— Not set —</option>
                  {FOOTBALL_POS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Foot</label>
                <select className={styles.select} value={form.foot} onChange={e => set('foot', e.target.value)}>
                  <option value="">— Not set —</option>
                  {FOOTBALL_FOOT.map(f => <option key={f.v} value={f.v}>{f.l}</option>)}
                </select>
              </div>
            </>}

            {/* Tennis only */}
            {isTennis && <>
              <div className={styles.field}>
                <label className={styles.label}>Forehand</label>
                <select className={styles.select} value={form.hand} onChange={e => set('hand', e.target.value)}>
                  <option value="">— Not set —</option>
                  {TENNIS_HAND.map(h => <option key={h.v} value={h.v}>{h.l}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Backhand</label>
                <select className={styles.select} value={form.backhand} onChange={e => set('backhand', e.target.value)}>
                  <option value="">— Not set —</option>
                  {TENNIS_BACKHAND.map(b => <option key={b.v} value={b.v}>{b.l}</option>)}
                </select>
              </div>
            </>}

            {/* All sports */}
            <div className={styles.field}>
              <label className={styles.label}>Turned Pro</label>
              <select className={styles.select} value={form.turned_pro_year} onChange={e => set('turned_pro_year', e.target.value)}>
                <option value="">— Not set —</option>
                {PRO_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Portrait path */}
            <div className={`${styles.field} ${styles.fieldWide}`}>
              <label className={styles.label}>Portrait path</label>
              <input
                className={styles.input}
                value={form.portrait_path}
                onChange={e => set('portrait_path', e.target.value)}
                placeholder="media/athletes/tennis/male/portrait/slug.png"
              />
            </div>

          </div>

          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => setOpen(false)}>Cancel</button>
            <button
              className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Athletes() {
  const [athletes, setAthletes]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [search, setSearch]       = useState('')
  const [collapsed, setCollapsed] = useState({})

  const load = useCallback(() => {
    setLoading(true)
    api.get('/athletes')
      .then(r => setAthletes(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = key => setCollapsed(p => ({ ...p, [key]: !p[key] }))

  const filtered = athletes.filter(a =>
    !search || (a.name || a.slug || '').toLowerCase().includes(search.toLowerCase())
  )

  // Group by sport → gender
  const grouped = {}
  for (const sp of SPORTS) grouped[sp.id] = { sport: sp, M: [], F: [] }
  for (const a of filtered) {
    const g = grouped[parseInt(a.sport_id)]
    if (!g) continue
    const gender = a.gender === 'F' ? 'F' : 'M'
    g[gender].push(a)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Athletes</h1>
        <p className={styles.subtitle}>Manage player profiles, attributes and portrait paths</p>
      </div>

      <div className={styles.searchWrap}>
        <input
          className={styles.search}
          placeholder="Search athletes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className={styles.total}>{filtered.length} athletes</span>
      </div>

      {loading
        ? <div className={styles.loading}>Loading...</div>
        : (
          <div className={styles.tree}>
            {SPORTS.map(sport => {
              const g        = grouped[sport.id]
              const total    = g.M.length + g.F.length
              const sportKey = `sp-${sport.id}`

              return (
                <div key={sport.id} className={styles.sportBlock}>

                  <div className={styles.sportHeader} onClick={() => toggle(sportKey)}>
                    <span className={styles.chevron}>{collapsed[sportKey] ? '▶' : '▼'}</span>
                    <span className={styles.sportName}>{sport.name}</span>
                    <span className={styles.badge}>{total}</span>
                  </div>

                  {!collapsed[sportKey] && (
                    [{ key: 'M', label: 'Male' }, { key: 'F', label: 'Female' }].map(({ key, label }) => {
                      const gKey = `${sportKey}-${key}`
                      const list = g[key]
                      return (
                        <div key={key} className={styles.genderBlock}>
                          <div className={styles.genderHeader} onClick={() => toggle(gKey)}>
                            <span className={styles.chevron}>{collapsed[gKey] ? '▶' : '▼'}</span>
                            <span className={styles.genderName}>{label}</span>
                            <span className={styles.badge}>{list.length}</span>
                          </div>

                          {!collapsed[gKey] && (
                            <div className={styles.list}>
                              {list.length === 0
                                ? <div className={styles.empty}>No athletes found</div>
                                : list.map(a => (
                                    <AthleteRow
                                      key={a.pa_id || a.entity_id}
                                      athlete={a}
                                      sport={sport}
                                      onSaved={load}
                                    />
                                  ))
                              }
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>
        )
      }
    </div>
  )
}
