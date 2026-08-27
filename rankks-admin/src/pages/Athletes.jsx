import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../api/client'
import CountrySelect from '../components/CountrySelect'
import SplitPathInput, { dirOf } from '../components/SplitPathInput'
import styles from './Athletes.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const SPORTS = [
  { id: 1, name: 'Football' },
  { id: 2, name: 'Tennis'   },
  { id: 3, name: 'Basketball' },
  { id: 4, name: 'Motor Racing' },
  { id: 10, name: 'Combat Sport' },
]

const CURRENT_YEAR = new Date().getFullYear()
const PRO_YEARS = Array.from({ length: CURRENT_YEAR - 1919 }, (_, i) => CURRENT_YEAR - i)

const TENNIS_HAND     = [{ v: 'R', l: 'Right-handed' }, { v: 'L', l: 'Left-handed' }]
const TENNIS_BACKHAND = [{ v: 'two', l: 'Two-handed' }, { v: 'one', l: 'One-handed' }]
const FOOTBALL_FOOT   = [{ v: 'R', l: 'Right-footed' }, { v: 'L', l: 'Left-footed' }, { v: 'B', l: 'Both' }]
const FOOTBALL_POS    = ['Goalkeeper', 'Defender', 'Midfielder', 'Attacker', 'Forward']
const BASKETBALL_POS  = ['PG', 'SG', 'SF', 'PF', 'C']

const PAGE_SIZE = 100

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function handLabel(v)     { return TENNIS_HAND.find(h => h.v === v)?.l || v || '' }
function backhandLabel(v) { return TENNIS_BACKHAND.find(b => b.v === v)?.l || v || '' }
function footLabel(v)     { return FOOTBALL_FOOT.find(f => f.v === v)?.l || v || '' }
function genderLabel(g)   { return g === 'F' ? 'Female' : g === 'M' ? 'Male' : '—' }

// death_date is only ever set by the death-backfill scripts when a death is
// actually confirmed (see backfill-tennis-death.js etc.) — there's no
// separate "checked" flag. So a NULL death_date doesn't by itself mean
// "alive"; it could just mean nobody has gathered any data on this athlete
// yet. birth_date presence is used as the proxy for "we've gathered data
// on this athlete" — if it's set and death_date isn't, show Alive.
function deathLabel(athlete) {
  if (athlete.death_date) return isoToDisplay(athlete.death_date)
  if (athlete.birth_date) return 'Alive'
  return '—'
}

function sportLabel(sportId) { return SPORTS.find(s => s.id === sportId)?.name || '—' }

function heightLabel(cm) { return cm ? `${cm} cm` : '—' }
function weightLabel(kg) { return kg ? `${kg} kg` : '—' }

// Swiss/French-style thousands separator, matching the product's existing convention
function fmtCount(n) {
  return (n ?? 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'")
}

function flagUrl(iso2) {
  return iso2 ? `https://flagcdn.com/w20/${iso2.toLowerCase()}.png` : null
}

// Tennis and motor-racing portraits are never read from entities.image_url
// at all — the frontend (EventBlock.jsx's getPortraitPath/getDriverPortraitPath,
// tennis_players_template.jsx) builds the path purely from slug + gender.
// entities.image_url for these sports is dead/unpopulated (confirmed
// 2026-08-10: only 11 of 8127 tennis players even have it set, and those
// are leftover football photo URLs from an unrelated backfill) — an
// editable input here would silently do nothing, which is what made
// Sabalenka's portrait look "missing" in admin despite displaying fine on
// the actual site. Shown read-only instead so the field isn't misleading.
// Leading '/' on every path here (Mohamed 2026-08-23: image shown in
// admin but not on the frontend — root cause was a value missing this
// slash, which resolveImg() then double-prefixes into a 404 '/media/
// media/...'; the backend now normalizes on save regardless, but these
// computed fallbacks/placeholders should model the correct convention too).
function computedPortraitPath(athlete) {
  const folder = athlete.gender === 'F' ? 'female' : 'male'
  if (athlete.sport_id === 2) return `/media/athletes/tennis/${folder}/portrait/${athlete.slug}.png`
  if (athlete.sport_id === 4) return `/media/athletes/motor-racing/male/portrait/${athlete.slug}.png`
  if (athlete.sport_id === 10) return `/media/athletes/combat-sports/${folder}/portrait/${athlete.slug}.png`
  return null
}

// Compact-row headshot (table lists, rankings, fight cards) — same
// convention as computedPortraitPath above, .../profile/ instead of
// .../portrait/, but for the SMALL table-row photo AthleteAvatar's
// fallback='letter' mode requires (it only trusts a src containing
// '/profile/', see that component's own comment). Originally UFC-only
// (Mohamed 2026-08-17: "for ufc, autogenerate path... filename =
// firstname-lastname.png"); extended to every sport (2026-08-23: "why
// only MMA? assign to all athletes/all sports") — every sport's own
// templates already build this exact path from slug+gender (confirmed via
// grep: tennis_players_template.jsx, players_template.jsx,
// player_awards_template.jsx, MmaEventTemplate.jsx all construct it this
// same way), this just surfaces the same convention in the admin UI.
// Football/Basketball hardcode 'male' — no template anywhere in the
// codebase builds a female variant of this path for those two sports yet
// (women's football/basketball portraits aren't backfilled). Display-only,
// never an editable input — there's no per-athlete override to save; the
// filename is a pure function of the slug, same as computedPortraitPath.
function computedProfilePath(athlete) {
  const folder = athlete.gender === 'F' ? 'female' : 'male'
  if (athlete.sport_id === 1)  return `/media/athletes/football/male/profile/${athlete.slug}.png`
  if (athlete.sport_id === 2)  return `/media/athletes/tennis/${folder}/profile/${athlete.slug}.png`
  if (athlete.sport_id === 3)  return `/media/athletes/basketball/male/profile/${athlete.slug}.png`
  if (athlete.sport_id === 4)  return `/media/athletes/motor-racing/male/profile/${athlete.slug}.png`
  if (athlete.sport_id === 10) return `/media/athletes/combat-sports/${folder}/profile/${athlete.slug}.png`
  return null
}

// ── Athlete row ───────────────────────────────────────────────────────────────

function AthleteRow({ athlete, open, onToggle, onSaved }) {
  const [form, setForm]         = useState({})
  const [dateText, setDateText] = useState('')
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  const isTennis     = athlete.sport_id === 2
  const isFootball   = athlete.sport_id === 1
  const isBasketball = athlete.sport_id === 3
  const isMma        = athlete.sport_id === 10
  const sa           = athlete.sport_attributes || {}

  const openEdit = () => {
    setForm({
      birth_date:      athlete.birth_date ? athlete.birth_date.slice(0, 10) : '',
      turned_pro_year: athlete.turned_pro_year || '',
      hand:            sa.hand     || '',
      backhand:        sa.backhand || '',
      foot:            sa.foot     || '',
      position:        athlete.position      || '',
      // Falls back to the computed slug-convention path when the DB column
      // is empty (true for nearly every tennis/motor-racing player — see
      // computedPortraitPath's comment) so the field shows the real path
      // that's actually live on the site instead of looking blank/missing.
      portrait_path:   athlete.portrait_path || computedPortraitPath(athlete) || '',
      // Now editable (Mohamed 2026-08-23: "profile path is not editable,
      // make it editable") — same fallback shape as portrait_path above.
      profile_path:    athlete.profile_path  || computedProfilePath(athlete)  || '',
      country_id:      athlete.country_id    || '',
    })
    setDateText(isoToDisplay(athlete.birth_date))
    setSaved(false)
    onToggle(athlete.entity_id)
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
      setTimeout(() => setSaved(false), 1200)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${styles.row} ${open ? styles.rowOpen : ''}`}>

      {/* Summary row — 8 columns + chevron */}
      <div className={styles.summary} onClick={() => open ? onToggle(null) : openEdit()}>
        <div className={styles.rowSummaryGrid}>
          <div>
            <span className={styles.name}>{athlete.name || athlete.slug}</span>
            <div>
              {isFootball && athlete.position   && <span className={styles.pill}>{athlete.position}</span>}
              {isFootball && sa.foot            && <span className={styles.pill}>{footLabel(sa.foot)}</span>}
              {isBasketball && athlete.position && <span className={styles.pill}>{athlete.position}</span>}
              {isTennis   && sa.hand          && <span className={styles.pill}>{handLabel(sa.hand)}</span>}
              {isTennis   && sa.backhand      && <span className={styles.pill}>{backhandLabel(sa.backhand)}</span>}
              {isMma      && sa.stance        && <span className={styles.pill}>{sa.stance}</span>}
              {isMma      && sa.nickname      && <span className={styles.pill}>"{sa.nickname}"</span>}
            </div>
          </div>
          <span className={styles.meta}>{sportLabel(athlete.sport_id)}</span>
          <span className={styles.meta}>{isoToDisplay(athlete.birth_date) || '—'}</span>
          <span className={styles.meta}>{deathLabel(athlete)}</span>
          <span className={styles.meta}>{genderLabel(athlete.gender)}</span>
          <div className={styles.countryCell}>
            {athlete.country_iso2 && <img className={styles.flagIcon} src={flagUrl(athlete.country_iso2)} alt="" />}
            <span className={styles.meta}>{athlete.country_name || '—'}</span>
          </div>
          <span className={styles.meta}>{heightLabel(athlete.height_cm)}</span>
          <span className={styles.meta}>{weightLabel(athlete.weight_kg)}</span>
          <span className={styles.meta}>{athlete.turned_pro_year || '—'}</span>
          <span className={styles.chevron}>{open ? '▲' : '▼'}</span>
        </div>
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

            {/* Country — same dropdown, every sport now */}
            <div className={styles.field}>
              <label className={styles.label}>Country</label>
              <CountrySelect
                value={form.country_id}
                onChange={id => set('country_id', id)}
              />
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

            {/* Basketball */}
            {isBasketball && <>
              <div className={styles.field}>
                <label className={styles.label}>Position</label>
                <select className={styles.select} value={form.position} onChange={e => set('position', e.target.value)}>
                  <option value="">— Not set —</option>
                  {BASKETBALL_POS.map(p => <option key={p} value={p}>{p}</option>)}
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

            {/* Profile path — every sport (Mohamed 2026-08-23: "why only
                MMA? assign to all athletes/all sports"), now editable
                (2026-08-23: "profile path is not editable, make it
                editable"). Saved to player_attributes.profile_path for
                football (real per-sport row already exists there) or
                entities.profile_image_url for every other sport (new
                column — those sports have no guaranteed player_attributes
                row to hang a value off, same reason portrait_path already
                uses entities.image_url for them). Shown above Portrait
                path. */}
            <div className={`${styles.field} ${styles.fieldWide}`}>
              <label className={styles.label}>Profile path</label>
              <SplitPathInput
                inputClassName={styles.input}
                value={form.profile_path}
                onChange={v => set('profile_path', v)}
                fixedDir={dirOf(computedProfilePath(athlete))}
                placeholder="slug.png"
              />
            </div>

            {/* Portrait path */}
            <div className={`${styles.field} ${styles.fieldWide}`}>
              <label className={styles.label}>Portrait path</label>
              <SplitPathInput
                inputClassName={styles.input}
                value={form.portrait_path}
                onChange={v => set('portrait_path', v)}
                fixedDir={dirOf(computedPortraitPath(athlete))}
                placeholder="slug.png"
              />
            </div>

          </div>

          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={() => onToggle(null)}>Cancel</button>
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
  const [total, setTotal]         = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading]     = useState(true)
  const [openId, setOpenId]       = useState(null)

  const [countries, setCountries] = useState([])

  const [sportFilter, setSportFilter]     = useState('')
  const [genderFilter, setGenderFilter]   = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [searchInput, setSearchInput]     = useState('')
  const [search, setSearch]               = useState('')
  const [page, setPage]                   = useState(1)

  const debounceRef = useRef(null)

  // Debounce free-text search — avoid firing a request per keystroke
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [searchInput])

  // Reset to page 1 whenever a dropdown filter changes
  useEffect(() => { setPage(1) }, [sportFilter, genderFilter, countryFilter])

  // Load full country list once (for the filter dropdown)
  useEffect(() => {
    api.get('/countries').then(r => setCountries(r.data)).catch(console.error)
  }, [])

  const load = useCallback(() => {
    setLoading(true)
    const params = { page, page_size: PAGE_SIZE }
    if (sportFilter)   params.sport_id   = sportFilter
    if (genderFilter)  params.gender     = genderFilter
    if (countryFilter) params.country_id = countryFilter
    if (search)         params.search    = search

    api.get('/athletes', { params })
      .then(r => {
        setAthletes(r.data.data)
        setTotal(r.data.total)
        setTotalPages(r.data.total_pages)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [page, sportFilter, genderFilter, countryFilter, search])

  useEffect(() => { load() }, [load])

  const sectionLabel = sportFilter
    ? SPORTS.find(s => String(s.id) === sportFilter)?.name
    : 'All Sports'

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Athletes</h1>
        <p className={styles.subtitle}>Manage player profiles, attributes and portrait paths</p>
      </div>

      <div className={styles.filtersBar}>
        <select className={styles.filterSelect} value={sportFilter} onChange={e => setSportFilter(e.target.value)}>
          <option value="">All Sports</option>
          {SPORTS.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <select className={styles.filterSelect} value={genderFilter} onChange={e => setGenderFilter(e.target.value)}>
          <option value="">All Genders</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
        </select>

        <select className={styles.filterSelect} value={countryFilter} onChange={e => setCountryFilter(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <input
          className={styles.search}
          placeholder="Search athletes..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
        />

        <button
          className={styles.clearBtn}
          onClick={() => { setSportFilter(''); setGenderFilter(''); setCountryFilter(''); setSearchInput(''); setSearch('') }}
        >
          Clear
        </button>
      </div>

      <div className={styles.sectionHeader}>
        <span className={styles.sectionLabel}>{sectionLabel}</span>
        <span className={styles.sectionCount}>{fmtCount(total)}</span>
      </div>

      {loading
        ? <div className={styles.loading}>Loading...</div>
        : (
          <div className={styles.tableWrap}>
            <div className={styles.tableHead}>
              <span>Name</span>
              <span>Sport</span>
              <span>Birthdate</span>
              <span>Death</span>
              <span>Gender</span>
              <span>Country</span>
              <span>Height</span>
              <span>Weight</span>
              <span>Turned Pro</span>
              <span></span>
            </div>

            <div className={styles.list}>
              {athletes.length === 0
                ? <div className={styles.empty}>No athletes found</div>
                : athletes.map(a => (
                    <AthleteRow
                      key={a.entity_id}
                      athlete={a}
                      open={openId === a.entity_id}
                      onToggle={setOpenId}
                      onSaved={load}
                    />
                  ))
              }
            </div>

            <div className={styles.pageBar}>
              <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(1)}>« First</button>
              <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span className={styles.pageInfo}>Page {page} of {totalPages}</span>
              <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next ›</button>
              <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Last »</button>
            </div>
          </div>
        )
      }
    </div>
  )
}
