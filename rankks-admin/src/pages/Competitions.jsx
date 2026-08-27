import { useState, useEffect } from 'react'
import { HexColorPicker } from 'react-colorful'
import api, { publicApi } from '../api/client'
import CountrySelect from '../components/CountrySelect'
import SplitPathInput, { dirOf } from '../components/SplitPathInput'
import styles from './Competitions.module.css'

const SURFACE_COLORS = {
  Grass: '#2d6a3f',
  Clay:  '#b5541a',
  Hard:  '#1a4a8a',
}

const SURFACE_LABELS = {
  grass: 'Grass',
  clay:  'Clay',
  hard:  'Hard',
}

const STATUS_LABELS = {
  past:     'Past',
  current:  'Ongoing',
  future:   'Upcoming',
  no_data:  'No data',
  cancelled:'Cancelled',
}

// ── Logo path suggestion ──────────────────────────────────────────────────────
// Competition logo folders don't follow one strict formula the way Athletes'
// photo paths do — confirmed 2026-08-25 against real logo_url data:
//   - tennis is flat: logos/competitions/tennis/{slug}.png
//   - football/basketball nest: logos/competitions/{sport}/{national|regional}/{country-or-region}/
//   - international level (World Cup, F1, MotoGP) has no country/region folder
//   - racing/mma additionally hand-pick an extra brand subfolder under
//     international/ (.../f1/, .../moto-gp/) that isn't derivable from any field
// So this is a best-effort STARTING POINT only (SplitPathInput's
// `suggestedDir`, stays editable) — sport_slug's DB value doesn't always
// match the folder name (racing is 'car-racing' in the DB, 'motor-racing'
// on disk), and country slugs are hand-typed (e.g. "usa" not
// "united-states"), so this won't always match legacy naming exactly.
const SPORT_LOGO_DIR = {
  football:   'football',
  basketball: 'basketball',
  mma:        'mma',
  tennis:     'tennis',
  'car-racing': 'motor-racing',
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function suggestedLogoDir(c) {
  const sportDir = SPORT_LOGO_DIR[c?.sport_slug]
  if (!sportDir) return ''
  if (c.sport_slug === 'tennis') return `/media/logos/competitions/${sportDir}/`
  if (c.localisation === 'international') return `/media/logos/competitions/${sportDir}/international/`
  if (c.localisation === 'regional') {
    const region = slugify(c.confederation)
    return `/media/logos/competitions/${sportDir}/regional/${region ? region + '/' : ''}`
  }
  if (c.localisation === 'national') {
    const country = slugify(c.country_name)
    return `/media/logos/competitions/${sportDir}/national/${country ? country + '/' : ''}`
  }
  return `/media/logos/competitions/${sportDir}/`
}

// ── Per-sport layout config ──────────────────────────────────────────────────
// Add an entry per sport_slug as new sports are ingested (mirrors the
// typology-registry pattern already used on the public frontend). Anything
// not listed falls back to 'default'.

// Which sports show the Surface field in Tournament Info at all.
const SURFACE_SPORTS = ['tennis']

// Seasons block: columns + how to pull cells out of a season row, per sport.
const SEASON_TABLE_CONFIGS = {
  tennis: {
    columns: ['Event', 'Start', 'End', 'Edition', 'Status', 'Ingestion', 'Players (M)', 'Games (M)', 'Players (F)', 'Games (F)'],
    getCells: (row, ctx) => [
      ctx.formatSeasonEvent(row),
      ctx.formatSeasonDate(row.season_start_date, row),
      ctx.formatSeasonDate(row.season_end_date, row),
      row.edition_number ?? '—',
      STATUS_LABELS[row.status] || row.status || '—',
      row.ingested ? 'Yes' : 'No',
      row.players_m || '—',
      row.games_m || '—',
      row.players_f || '—',
      row.games_f || '—',
    ],
  },
  basketball: {
    // All-Time (derived on the fly from player_season_stats) and Iconic
    // Moments (manually curated gallery, no dedicated season row per the
    // NBA onboarding spec) never carry per-season ingestion — exclude them
    // from this ingestion-tracking table rather than show a permanent "No".
    excludeEvents: ['All-Time', 'Iconic Moments', 'End of Season Teams'],
    columns: ['Event', 'Start', 'End', 'Edition', 'Status', 'Ingestion', 'Clubs', 'Players'],
    getCells: (row, ctx) => [
      ctx.formatSeasonEvent(row),
      ctx.formatSeasonDate(row.season_start_date, row),
      ctx.formatSeasonDate(row.season_end_date, row),
      row.edition_number ?? '—',
      STATUS_LABELS[row.status] || row.status || '—',
      row.ingested ? 'Yes' : 'No',
      row.event_name === 'Regular Season' ? (row.clubs_count || '—') : '—',
      row.event_name === 'Regular Season' ? (row.players_count || '—')
        : row.award_slots_expected != null ? `${row.award_slots_filled}/${row.award_slots_expected}`
        : '—',
    ],
  },
  default: {
    columns: ['Event', 'Start', 'End', 'Edition', 'Status', 'Ingestion', 'Clubs', 'Players', 'Scorers', 'Assists'],
    getCells: (row, ctx) => [
      ctx.formatSeasonEvent(row),
      ctx.formatSeasonDate(row.season_start_date, row),
      ctx.formatSeasonDate(row.season_end_date, row),
      row.edition_number ?? '—',
      STATUS_LABELS[row.status] || row.status || '—',
      row.ingested ? 'Yes' : 'No',
      row.clubs_count || '—',
      row.players_count || '—',
      ctx.formatCount(row.scorers_count, row.players_count),
      ctx.formatCount(row.assists_count, row.players_count),
    ],
  },
}

// Events within the same season (year + gender) can have their own actual
// start/end dates that fall entirely inside a wider "parent" event's window
// (NBA Playoffs/Play-in/Finals all run inside the Regular Season's span) —
// tag every row with the season-wide min/max so they display as one season
// instead of disjoint per-event calendars.
function withSeasonRange(rows) {
  const ranges = {}
  rows.forEach(row => {
    if (row.cancellation_reason) return
    const key = `${row.year}_${row.gender}`
    const r = ranges[key] || (ranges[key] = { start: null, end: null })
    if (row.start_date && (!r.start || row.start_date < r.start)) r.start = row.start_date
    if (row.end_date && (!r.end || row.end_date > r.end)) r.end = row.end_date
  })
  return rows.map(row => {
    const r = ranges[`${row.year}_${row.gender}`]
    return {
      ...row,
      season_start_date: r?.start ?? row.start_date,
      season_end_date:   r?.end   ?? row.end_date,
    }
  })
}

// ── Year options ─────────────────────────────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear()
const FOUNDING_YEARS = Array.from({ length: CURRENT_YEAR - 1849 }, (_, i) => CURRENT_YEAR - i)

export default function Competitions() {
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)

  // ── Top filter bar ──
  const [selectedSport, setSelectedSport]     = useState('')
  const [selectedCountry, setSelectedCountry] = useState('')
  const [selectedComp, setSelectedComp]       = useState('') // id, string
  const [globalSearch, setGlobalSearch]       = useState('')

  // ── Editor ──
  const [selected, setSelected]         = useState(null)
  const [editing, setEditing]           = useState(null)
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [activePicker, setActivePicker] = useState(null)

  // ── Collapsible blocks — only Seasons open by default ──
  const [blockOpen, setBlockOpen] = useState({
    info: false,
    cancellations: false,
    logos: false,
    naming: false,
    seasons: true,
  })
  const toggleBlock = key => setBlockOpen(p => ({ ...p, [key]: !p[key] }))

  // ── Seasons block data ──
  const [seasons, setSeasons] = useState([])
  const [loadingSeasons, setLoadingSeasons] = useState(false)

  // ── "Add future season" form — the only current use case for creating a
  // seasons row by hand: a tour announces next year's calendar (~Nov/Dec)
  // before ingestion has anything to scrape, so there's no automated source
  // for a not-yet-played tournament's scheduled dates. ──
  const [showAddSeason, setShowAddSeason] = useState(false)
  const [newSeason, setNewSeason] = useState({ year: '', gender: 'M', start_date: '', end_date: '' })
  const [savingSeason, setSavingSeason] = useState(false)
  const [addSeasonError, setAddSeasonError] = useState(null)

  // ── F1 Seasons drill-down (car-racing only) — expanding a year fetches
  // that season's Grands Prix on demand, since F1 has no per-race row in
  // the generic `seasons` table to flatten into one list up front. ──
  const [expandedF1Year, setExpandedF1Year] = useState(null)
  const [f1Races, setF1Races]               = useState([])
  const [loadingF1Races, setLoadingF1Races]  = useState(false)

  useEffect(() => {
    publicApi.get('/competitions')
      .then(r => setItems(r.data?.data ?? r.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // ── Sport options — alphabetical ──
  const sportOptions = [...new Set(items.map(i => i.sport_name).filter(Boolean))].sort()

  // ── Country options — scoped to selected sport, International + Regional pinned first ──
  const countryOptions = (() => {
    const scoped = selectedSport ? items.filter(i => i.sport_name === selectedSport) : items
    let hasIntl = false, hasRegional = false
    const names = new Set()
    scoped.forEach(c => {
      const loc = c.localisation?.toLowerCase()
      if (loc === 'international') hasIntl = true
      else if (loc === 'regional') hasRegional = true
      else if (c.country_name) names.add(c.country_name)
    })
    const sortedNames = [...names].sort((a, b) => a.localeCompare(b))
    const opts = []
    if (hasIntl) opts.push('International')
    if (hasRegional) opts.push('Regional')
    return [...opts, ...sortedNames]
  })()

  // ── Tennis name collisions — Masters 1000/WTA 1000-tier tournaments like
  // Indian Wells/Cincinnati/Miami are two SEPARATE competition rows (one
  // ATP, one WTA) sharing the same tournament, making them indistinguishable
  // in the picker list below (Mohamed 2026-08-16: "can u add (ATP/WTA)
  // extension so as to differentiate"). Two things confirmed via SQL rather
  // than assumed (2026-08-16 round-trip): the pair's names aren't always
  // byte-identical ("Cincinnati" vs "Cincinnati Open" — exact-match grouping
  // missed it) — normalized by stripping a trailing " Open" before
  // comparing. And c.gender is blank on (at least) one side of these pairs,
  // so it can't be trusted to pick ATP vs WTA — category_slug (e.g.
  // 'atp-masters-1000' vs 'wta-1000') is the reliable signal, same taxonomy
  // TOTALS_CATEGORY_SLUGS already keys off elsewhere in this codebase.
  // Computed over the full unfiltered `items` list (not filteredComps) so
  // the label stays consistent regardless of which filter is active.
  const normalizeCompName = (name) => (name || '').replace(/\s+Open$/i, '').trim().toLowerCase()
  const duplicateTennisNames = (() => {
    const counts = new Map()
    items.forEach(c => {
      if (c.sport_name?.toLowerCase() !== 'tennis' || !c.name) return
      const key = normalizeCompName(c.name)
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([name]) => name))
  })()
  const tourSuffix = (c) => duplicateTennisNames.has(normalizeCompName(c.name)) ? ` (${c.category_slug?.includes('wta') ? 'WTA' : 'ATP'})` : ''

  // ── Competition list — global search overrides sport/country filters ──
  const filteredComps = items
    .filter(c => {
      if (globalSearch) {
        return (c.name || c.slug || '').toLowerCase().includes(globalSearch.toLowerCase())
      }
      if (selectedSport && c.sport_name !== selectedSport) return false
      if (selectedCountry) {
        const loc = c.localisation?.toLowerCase()
        if (selectedCountry === 'International') return loc === 'international'
        if (selectedCountry === 'Regional') return loc === 'regional'
        return c.country_name === selectedCountry
      }
      return true
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const select = async item => {
    setSelectedComp(String(item.id))
    setSelected(item)
    setEditing({
      primary_color:      item.primary_color      || '#1a1a2e',
      secondary_color:    item.secondary_color    || '#2a2a4e',
      third_color:        item.third_color        || '',
      surface:            item.surface            || '',
      country_id:         item.country_id         || '',
      founding_year:      item.founding_year      || item.founded_year || '',
      cancelled_editions: item.cancelled_editions || [],
      logo_url:           item.logo_url           || '',
      sidebar_logo_url:   item.sidebar_logo_url   || '',
      sidebar_name:       item.sidebar_name       || '',
      short_code:         item.short_code         || '',
    })
    setActivePicker(null)
    setSaved(false)
    try {
      const { data } = await publicApi.get(`/competitions/${item.slug}`)
      const full = data.data ?? data
      setSelected(full)
      setEditing({
        primary_color:      full.primary_color      || '#1a1a2e',
        secondary_color:    full.secondary_color    || '#2a2a4e',
        third_color:        full.third_color        || '',
        surface:            full.surface            || '',
        country_id:         full.country_id         || '',
        founding_year:      full.founded_year      || '',
        cancelled_editions: full.cancelled_editions || [],
        logo_url:           full.logo_url           || '',
        sidebar_logo_url:   full.sidebar_logo_url   || '',
        sidebar_name:       full.sidebar_name       || '',
        short_code:         full.short_code         || '',
      })
    } catch (err) {
      console.error('Failed to load competition detail', err)
    }
  }

  // ── Seasons block fetch ──
  // Branches by sport: F1 has its own dedicated tables (see f1.js header),
  // so car-racing competitions fetch from /f1/seasons/by-competition
  // instead of the generic /seasons/by-competition — same response shape
  // (array of season-like rows with an `id` and `year`), different source.
  useEffect(() => {
    if (!selected?.id) { setSeasons([]); return }
    setLoadingSeasons(true)
    setExpandedF1Year(null)
    setF1Races([])
    const url = selected.sport_slug === 'car-racing'
      ? `/f1/seasons/by-competition`
      : `/seasons/by-competition?competition_id=${selected.id}`
    const excludeEvents = SEASON_TABLE_CONFIGS[selected.sport_slug]?.excludeEvents
    publicApi.get(url)
      .then(r => {
        let rows = withSeasonRange(r.data?.data ?? [])
        if (excludeEvents) rows = rows.filter(row => !excludeEvents.includes(row.event_name))
        setSeasons(rows)
      })
      .catch(console.error)
      .finally(() => setLoadingSeasons(false))
  }, [selected?.id, selected?.sport_slug])

  const reloadSeasons = () => {
    if (!selected?.id) return
    setLoadingSeasons(true)
    const url = selected.sport_slug === 'car-racing'
      ? `/f1/seasons/by-competition`
      : `/seasons/by-competition?competition_id=${selected.id}`
    const excludeEvents = SEASON_TABLE_CONFIGS[selected.sport_slug]?.excludeEvents
    publicApi.get(url)
      .then(r => {
        let rows = withSeasonRange(r.data?.data ?? [])
        if (excludeEvents) rows = rows.filter(row => !excludeEvents.includes(row.event_name))
        setSeasons(rows)
      })
      .catch(console.error)
      .finally(() => setLoadingSeasons(false))
  }

  const openAddSeason = () => {
    setNewSeason({
      year: new Date().getFullYear(),
      gender: selected?.gender && selected.gender !== 'X' ? selected.gender : 'M',
      start_date: '', end_date: '',
    })
    setAddSeasonError(null)
    setShowAddSeason(true)
  }

  const submitAddSeason = () => {
    if (!newSeason.year) { setAddSeasonError('Year is required.'); return }
    setSavingSeason(true)
    setAddSeasonError(null)
    api.post('/seasons', {
      competition_id: selected.id,
      year: Number(newSeason.year),
      gender: newSeason.gender,
      status: 'future',
      start_date: newSeason.start_date || null,
      end_date: newSeason.end_date || null,
    })
      .then(() => {
        setShowAddSeason(false)
        reloadSeasons()
      })
      .catch(err => setAddSeasonError(err.response?.data?.error || err.message))
      .finally(() => setSavingSeason(false))
  }

  // Expand/collapse a season row in the F1 drill-down, fetching its
  // Grands Prix on first expand. Clicking the already-open row collapses
  // it without refetching.
  const toggleF1Season = (season) => {
    if (expandedF1Year === season.id) { setExpandedF1Year(null); return }
    setExpandedF1Year(season.id)
    setLoadingF1Races(true)
    setF1Races([])
    publicApi.get(`/f1/grands-prix/${season.id}`)
      .then(r => setF1Races(r.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoadingF1Races(false))
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const { data } = await publicApi.put(`/competitions/${selected.id}`, editing)
      setItems(prev => prev.map(i => i.id === selected.id ? { ...i, ...data } : i))
      setSelected(prev => ({ ...prev, ...data }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert('Save failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  const surfaceLabel = SURFACE_LABELS[editing?.surface?.toLowerCase()] || editing?.surface || ''
  const surfaceColor = SURFACE_COLORS[surfaceLabel] || '#333'

  const formatSeasonEvent = row => {
    if (row.official_name) return row.official_name
    if (row.event_name) return row.event_name
    return `${selected?.name || selected?.slug || ''} ${row.year}`
  }

  const formatSeasonDate = (dateStr, row) => {
    if (row.cancellation_reason) return 'Cancelled'
    if (!dateStr) return '—'
    return new Date(dateStr).getFullYear()
  }

  const formatCount = (count, total) => {
    if (!total) return '—'
    return `${count} / ${total}`
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>Competitions</h1>
        <p className={styles.subtitle}>Tournament info, cancellations, logos and seasons — organised for scale</p>
      </div>

      {/* ── Top filter bar ── */}
      <div className={styles.filterBar}>
        <div className={styles.filterCol}>
          <div className={styles.filterColTitle}>Sport category</div>
          <div className={styles.filterList}>
            {sportOptions.map(sport => (
              <button
                key={sport}
                className={`${styles.filterItem} ${selectedSport === sport ? styles.filterItemActive : ''}`}
                onClick={() => setSelectedSport(selectedSport === sport ? '' : sport)}
              >
                {sport}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterCol}>
          <div className={styles.filterColTitle}>Select country</div>
          <div className={styles.filterList}>
            {countryOptions.map(country => (
              <button
                key={country}
                className={`${styles.filterItem} ${selectedCountry === country ? styles.filterItemActive : ''}`}
                onClick={() => setSelectedCountry(selectedCountry === country ? '' : country)}
              >
                {country}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterCol}>
          <div className={styles.filterColTitle}>Select competition</div>
          <div className={styles.filterList}>
            {loading ? (
              <div className={styles.filterEmpty}>Loading...</div>
            ) : filteredComps.length === 0 ? (
              <div className={styles.filterEmpty}>No match</div>
            ) : filteredComps.map(c => (
              <button
                key={c.id}
                className={`${styles.filterItem} ${selectedComp === String(c.id) ? styles.filterItemActive : ''}`}
                onClick={() => select(c)}
              >
                <span className={styles.dots}>
                  <span className={styles.dot} style={{ background: c.primary_color   || '#444' }} />
                  <span className={styles.dot} style={{ background: c.secondary_color || '#444' }} />
                </span>
                {(c.name || c.slug)}{tourSuffix(c)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.searchCol}>
          <div className={styles.filterColTitle}>Search league</div>
          <div className={styles.searchBox}>
            <input
              className={styles.searchInput}
              placeholder="search"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
            />
            <span className={styles.searchIcon}>🔎</span>
          </div>
        </div>
      </div>

      {/* ── Editor ── */}
      {!(selected && editing) ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>🏆</span>
          <span>Select a competition to edit</span>
        </div>
      ) : (
        <div className={styles.editor}>
          <div className={styles.editorHeader}>
            <div>
              <div className={styles.editorTitle}>{selected.name || selected.slug}</div>
              <div className={styles.editorMeta}>
                {selected.sport_name}
                {selected.category_name && <> · {selected.category_name}</>}
                {surfaceLabel && (
                  <span className={styles.surfaceBadge} style={{ background: surfaceColor }}>
                    {surfaceLabel}
                  </span>
                )}
                <span className={styles.idBadge}>ID {selected.id}</span>
              </div>
            </div>
            <button
              className={`${styles.saveBtn} ${saved ? styles.saved : ''}`}
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save'}
            </button>
          </div>

          {/* ── Block 1 — Tournament Info ── */}
          <div className={styles.block}>
            <div className={styles.blockHeader} onClick={() => toggleBlock('info')}>
              <span className={styles.blockChevron}>{blockOpen.info ? '▼' : '▶'}</span>
              <span className={styles.blockTitle}>Tournament info</span>
            </div>
            {blockOpen.info && (
              <div className={styles.blockBody}>

                {/* Naming — Competition name is the DB canonical name and
                    can't be edited here (renaming it risks breaking any
                    logic keyed off the exact value elsewhere) — shown
                    disabled purely for reference alongside the two names
                    that ARE editable: Sidebar (shown in the left-nav
                    competition list) and Shortcode (shown on the Home tab,
                    e.g. "F1"/"NBA"/"L1"). Both fall back to the DB name on
                    the public site when left blank. */}
                <div className={styles.colorSection}>
                  <div className={styles.colorSectionTitle}>Naming</div>
                  <div className={styles.infoGrid}>
                    <div className={styles.infoField}>
                      <label className={styles.infoLabel}>Competition name</label>
                      <input
                        className={styles.infoInput}
                        value={selected.name || ''}
                        disabled
                      />
                    </div>
                    <div className={styles.infoField}>
                      <label className={styles.infoLabel}>Competition Sidebar</label>
                      <input
                        className={styles.infoInput}
                        value={editing.sidebar_name || ''}
                        onChange={e => setEditing(p => ({ ...p, sidebar_name: e.target.value }))}
                        placeholder={selected.name || 'Sidebar label'}
                      />
                    </div>
                    <div className={styles.infoField}>
                      <label className={styles.infoLabel}>Competition shortcode</label>
                      <input
                        className={styles.infoInput}
                        value={editing.short_code || ''}
                        onChange={e => setEditing(p => ({ ...p, short_code: e.target.value }))}
                        placeholder="e.g. F1"
                      />
                    </div>
                  </div>
                </div>

                {/* Logo */}
                <div className={styles.colorSection}>
                  <div className={styles.colorSectionTitle}>Logo</div>
                  <div className={styles.logoRow}>
                    <div className={styles.infoField}>
                      <label className={styles.infoLabel}>Logo path</label>
                      <SplitPathInput
                        inputClassName={styles.infoInput}
                        value={editing.logo_url || ''}
                        onChange={v => setEditing(p => ({ ...p, logo_url: v }))}
                        suggestedDir={suggestedLogoDir(selected)}
                        placeholder="ligue-1.png"
                      />
                    </div>
                    {editing.logo_url && (
                      <div className={styles.logoPreview}>
                        <img
                          src={editing.logo_url}
                          alt="Logo preview"
                          className={styles.logoPreviewImg}
                          onError={e => { e.target.style.display = 'none' }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Sidebar logo — a separate, small-icon-friendly crop.
                      The main logo above is often a full crest with lots of
                      padding that shrinks to near-invisible at the sidebar's
                      18x18 size; this lets admin point the sidebar nav at a
                      tighter crop instead. Falls back to the main logo above
                      when unset (see Sidebar.jsx's c.sidebar_logo_url || c.logo_url). */}
                  <div className={styles.logoRow}>
                    <div className={styles.infoField}>
                      <label className={styles.infoLabel}>Sidebar logo path</label>
                      <SplitPathInput
                        inputClassName={styles.infoInput}
                        value={editing.sidebar_logo_url || ''}
                        onChange={v => setEditing(p => ({ ...p, sidebar_logo_url: v }))}
                        fixedDir={dirOf(editing.logo_url)}
                        suggestedDir={suggestedLogoDir(selected)}
                        placeholder="ligue-1-sidebar.png"
                      />
                    </div>
                    {editing.sidebar_logo_url && (
                      <div className={styles.logoPreview}>
                        <img
                          src={editing.sidebar_logo_url}
                          alt="Sidebar logo preview"
                          className={styles.logoPreviewImg}
                          onError={e => { e.target.style.display = 'none' }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Founded */}
                <div className={styles.colorSection}>
                  <div className={styles.colorSectionTitle}>Founded</div>
                  <div className={styles.infoGrid}>
                    <div className={styles.infoField}>
                      <label className={styles.infoLabel}>Founded in</label>
                      <div className={styles.yearRow}>
                        <input
                          className={styles.infoInput}
                          type="number"
                          min="1850"
                          max="2100"
                          value={editing.founding_year || ''}
                          onChange={e => setEditing(p => ({ ...p, founding_year: e.target.value ? parseInt(e.target.value) : '' }))}
                          placeholder="e.g. 1877"
                        />
                        <select
                          className={styles.yearSelect}
                          value={editing.founding_year || ''}
                          onChange={e => setEditing(p => ({ ...p, founding_year: e.target.value ? parseInt(e.target.value) : '' }))}
                        >
                          <option value="">— Pick —</option>
                          {FOUNDING_YEARS.map(y => (
                            <option key={y} value={y}>{y}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Country */}
                <div className={styles.colorSection}>
                  <div className={styles.colorSectionTitle}>Country</div>
                  <div className={styles.infoField}>
                    <label className={styles.infoLabel}>Country</label>
                    <CountrySelect
                      value={editing.country_id}
                      onChange={id => setEditing(p => ({ ...p, country_id: id }))}
                    />
                  </div>
                </div>

                {/* Surface — only relevant for surface-based sports */}
                {SURFACE_SPORTS.includes(selected.sport_slug) && (
                  <div className={styles.colorSection}>
                    <div className={styles.colorSectionTitle}>Surface</div>
                    <select
                      className={styles.surfaceSelect}
                      // Lowercased for the match against this select's own
                      // (always-lowercase) option values — a legacy/ingested
                      // row can hold Title Case ("Grass"), which otherwise
                      // fails to match any option and silently renders as
                      // "— Not set —" even though a real value exists.
                      value={(editing.surface || '').toLowerCase()}
                      onChange={e => setEditing(p => ({ ...p, surface: e.target.value }))}
                    >
                      <option value="">— Not set —</option>
                      <option value="grass">Grass</option>
                      <option value="clay">Clay</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>
                )}

                {/* Colour scheme */}
                <div className={styles.colorSection}>
                  <div className={styles.colorSectionTitle}>Colour scheme</div>
                  <div className={styles.colorGrid}>
                    {[
                      { key: 'primary_color',   label: 'Primary' },
                      { key: 'secondary_color', label: 'Secondary' },
                      { key: 'third_color',     label: 'Third (optional)' },
                    ].map(({ key, label }) => (
                      <div key={key} className={styles.colorCol}>
                        <div className={styles.colorLabel}>{label}</div>
                        <div className={styles.colorRow}>
                          <div
                            className={styles.swatch}
                            style={{ background: editing[key] || '#2a2a2a' }}
                            onClick={() => setActivePicker(activePicker === key ? null : key)}
                          />
                          <input
                            className={styles.colorInput}
                            value={editing[key] || ''}
                            onChange={e => setEditing(p => ({ ...p, [key]: e.target.value }))}
                            placeholder="#000000"
                            maxLength={7}
                          />
                        </div>
                        {activePicker === key && (
                          <div className={styles.picker}>
                            <HexColorPicker
                              color={editing[key] || '#000000'}
                              onChange={c => setEditing(p => ({ ...p, [key]: c }))}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* ── Block 2 — Cancellations ── */}
          <div className={styles.block}>
            <div className={styles.blockHeader} onClick={() => toggleBlock('cancellations')}>
              <span className={styles.blockChevron}>{blockOpen.cancellations ? '▼' : '▶'}</span>
              <span className={styles.blockTitle}>Cancellations</span>
              <span className={styles.blockBadge}>{(editing.cancelled_editions || []).length}</span>
            </div>
            {blockOpen.cancellations && (
              <div className={styles.blockBody}>
                <div className={styles.cancelledWrap}>

                  <div className={styles.cancelledList}>
                    {(editing.cancelled_editions || []).length === 0 && (
                      <span className={styles.cancelledEmpty}>No cancelled editions</span>
                    )}
                    {(editing.cancelled_editions || [])
                      .slice()
                      .sort((a, b) => a.year - b.year)
                      .map(entry => (
                        <div key={entry.year} className={styles.cancelledRow}>
                          <span className={styles.cancelledYear}>{entry.year}</span>
                          <input
                            className={styles.cancelledReason}
                            value={entry.reason || ''}
                            placeholder="Reason (e.g. WWI, COVID)"
                            onChange={e => {
                              const val = e.target.value
                              setEditing(p => ({
                                ...p,
                                cancelled_editions: p.cancelled_editions.map(x =>
                                  x.year === entry.year ? { ...x, reason: val } : x
                                )
                              }))
                            }}
                          />
                          <button
                            className={styles.cancelledRemove}
                            onClick={() => setEditing(p => ({
                              ...p,
                              cancelled_editions: p.cancelled_editions.filter(x => x.year !== entry.year)
                            }))}
                          >×</button>
                        </div>
                      ))
                    }
                  </div>

                  <div className={styles.cancelledAdd}>
                    <select
                      className={styles.yearSelect}
                      defaultValue=""
                      onChange={e => {
                        const y = parseInt(e.target.value)
                        if (!y) return
                        setEditing(p => {
                          if ((p.cancelled_editions || []).find(x => x.year === y)) return p
                          return {
                            ...p,
                            cancelled_editions: [...(p.cancelled_editions || []), { year: y, reason: '' }]
                              .sort((a, b) => a.year - b.year)
                          }
                        })
                        e.target.value = ''
                      }}
                    >
                      <option value="">+ Add year</option>
                      {FOUNDING_YEARS
                        .filter(y => !(editing.cancelled_editions || []).find(x => x.year === y))
                        .map(y => <option key={y} value={y}>{y}</option>)
                      }
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Block 3 — Competition Logos (link-out, single source of truth) ── */}
          <div className={styles.block}>
            <div className={styles.blockHeader} onClick={() => toggleBlock('logos')}>
              <span className={styles.blockChevron}>{blockOpen.logos ? '▼' : '▶'}</span>
              <span className={styles.blockTitle}>Competition logos</span>
            </div>
            {blockOpen.logos && (
              <div className={styles.blockBody}>
                <p className={styles.blockHint}>
                  Era-specific logo overrides (e.g. a redesigned crest for a given range of years) are managed on the dedicated Logos page to avoid duplicating that editor here.
                </p>
                <a
                  className={styles.linkOutBtn}
                  href={`/competition-logos?competition_id=${selected.id}`}
                >
                  Manage logos →
                </a>
              </div>
            )}
          </div>

          {/* ── Block 3b — Tournament Names (link-out, single source of truth) ── */}
          <div className={styles.block}>
            <div className={styles.blockHeader} onClick={() => toggleBlock('naming')}>
              <span className={styles.blockChevron}>{blockOpen.naming ? '▼' : '▶'}</span>
              <span className={styles.blockTitle}>Tournament names</span>
            </div>
            {blockOpen.naming && (
              <div className={styles.blockBody}>
                <p className={styles.blockHint}>
                  Era-specific official name overrides (e.g. a title sponsor change) are managed on the dedicated Names page to avoid duplicating that editor here.
                </p>
                <a
                  className={styles.linkOutBtn}
                  href={`/competition-naming?competition_id=${selected.id}`}
                >
                  Manage names →
                </a>
              </div>
            )}
          </div>

          {/* ── Block 4 — Seasons (open by default) ── */}
          <div className={styles.block}>
            <div className={styles.blockHeader} onClick={() => toggleBlock('seasons')}>
              <span className={styles.blockChevron}>{blockOpen.seasons ? '▼' : '▶'}</span>
              <span className={styles.blockTitle}>Seasons</span>
              <span className={styles.blockBadge}>{seasons.length}</span>
              {selected.sport_slug !== 'car-racing' && (
                <button
                  type="button"
                  className={styles.addSeasonBtn}
                  onClick={e => { e.stopPropagation(); openAddSeason() }}
                >
                  + Add future season
                </button>
              )}
            </div>
            {blockOpen.seasons && (
              <div className={styles.blockBody}>
                {showAddSeason && (
                  <div className={styles.addSeasonForm}>
                    <label>
                      Year
                      <input
                        type="number"
                        value={newSeason.year}
                        onChange={e => setNewSeason(p => ({ ...p, year: e.target.value }))}
                      />
                    </label>
                    <label>
                      Gender
                      <select
                        value={newSeason.gender}
                        onChange={e => setNewSeason(p => ({ ...p, gender: e.target.value }))}
                      >
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                    </label>
                    <label>
                      Start date
                      <input
                        type="date"
                        value={newSeason.start_date}
                        onChange={e => setNewSeason(p => ({ ...p, start_date: e.target.value }))}
                      />
                    </label>
                    <label>
                      End date
                      <input
                        type="date"
                        value={newSeason.end_date}
                        onChange={e => setNewSeason(p => ({ ...p, end_date: e.target.value }))}
                      />
                    </label>
                    <span className={styles.addSeasonHint}>Status is set to "Upcoming" automatically. Leave dates blank if not scheduled yet.</span>
                    {addSeasonError && <span className={styles.addSeasonError}>{addSeasonError}</span>}
                    <div className={styles.addSeasonActions}>
                      <button type="button" onClick={submitAddSeason} disabled={savingSeason}>
                        {savingSeason ? 'Saving...' : 'Create'}
                      </button>
                      <button type="button" onClick={() => setShowAddSeason(false)} disabled={savingSeason}>Cancel</button>
                    </div>
                  </div>
                )}
                {selected.sport_slug === 'car-racing' ? (
                  <div className={styles.seasonTable}>
                    <div className={styles.f1SeasonHeader}>
                      <span></span>
                      <span>Year</span>
                      <span>Races</span>
                      <span>Sprint races</span>
                      <span>Date range</span>
                      <span>Ingestion</span>
                    </div>

                    {loadingSeasons ? (
                      <div className={styles.seasonEmpty}>Loading...</div>
                    ) : seasons.length === 0 ? (
                      <div className={styles.seasonEmpty}>No seasons found for this competition.</div>
                    ) : seasons.map(season => {
                      const isOpen = expandedF1Year === season.id
                      return (
                        <div key={season.id}>
                          <div className={styles.f1SeasonRow} onClick={() => toggleF1Season(season)}>
                            <span className={`${styles.f1Chevron} ${isOpen ? styles.f1ChevronOpen : ''}`}>▶</span>
                            <span>{season.year}</span>
                            <span>{season.race_count}</span>
                            <span>{season.sprint_count}</span>
                            <span>
                              {season.start_date
                                ? `${new Date(season.start_date).toLocaleDateString('en-GB')} – ${new Date(season.end_date).toLocaleDateString('en-GB')}`
                                : '—'}
                            </span>
                            <span className={season.ingested ? styles.ingestedYes : styles.ingestedNo}>
                              {season.ingested ? 'Yes' : 'No'}
                            </span>
                          </div>

                          {isOpen && (
                            <div className={styles.gpWrap}>
                              <div className={styles.gpHeader}>
                                <span>Race</span>
                                <span>Date</span>
                                <span>Round</span>
                                <span>Sprint</span>
                                <span>Ingestion</span>
                              </div>
                              {loadingF1Races ? (
                                <div className={styles.gpEmpty}>Loading...</div>
                              ) : f1Races.length === 0 ? (
                                <div className={styles.gpEmpty}>No races found for this season.</div>
                              ) : f1Races.map(race => (
                                <div key={race.id} className={styles.gpRow}>
                                  <span>{race.full_title || race.name}</span>
                                  <span>{race.event_date ? new Date(race.event_date).toLocaleDateString('en-GB') : '—'}</span>
                                  <span>{race.round_order ?? '—'}</span>
                                  <span className={race.is_sprint_weekend ? styles.sprintYes : styles.sprintNo}>
                                    {race.is_sprint_weekend ? 'Yes' : 'No'}
                                  </span>
                                  <span className={race.ingested ? styles.ingestedYes : styles.ingestedNo}>
                                    {race.ingested ? 'Yes' : 'No'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className={styles.seasonTable}>
                    {(() => {
                      const config = SEASON_TABLE_CONFIGS[selected.sport_slug] || SEASON_TABLE_CONFIGS.default
                      const gridStyle = { gridTemplateColumns: `2fr repeat(${config.columns.length - 1}, 1fr)` }
                      const ctx = { formatSeasonEvent, formatSeasonDate, formatCount }
                      return (
                        <>
                          <div className={styles.seasonHeader} style={gridStyle}>
                            {config.columns.map(col => <span key={col}>{col}</span>)}
                          </div>

                          {loadingSeasons ? (
                            <div className={styles.seasonEmpty}>Loading...</div>
                          ) : seasons.length === 0 ? (
                            <div className={styles.seasonEmpty}>No seasons found for this competition.</div>
                          ) : seasons.map(row => (
                            <div key={row.id} className={styles.seasonRow} style={gridStyle}>
                              {config.getCells(row, ctx).map((cell, i) => (
                                <span
                                  key={i}
                                  className={cell === 'Yes' ? styles.ingestedYes : cell === 'No' ? styles.ingestedNo : undefined}
                                >
                                  {cell}
                                </span>
                              ))}
                            </div>
                          ))}
                        </>
                      )
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
