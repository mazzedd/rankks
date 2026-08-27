// Renders PROFILE / TOURNAMENTS / RANKINGS / RECORD FIRSTS from GET
// /api/reports/compare. Mohamed 2026-08-21 follow-up:
// 1) "show profile image, not portrait" — entities.image_url can be either
//    a .../profile/... headshot or a .../portrait/... banner shot (see
//    AthleteAvatar.jsx's own PROFILE vs PORTRAIT comment); reusing that
//    shared component here (fallback='letter') gets the right one
//    automatically instead of rendering whatever image_url happens to be
//    (was showing Federer's portrait .mp4 broken in an <img>).
// 2) "organise table where boxes are separated" — one independent bordered
//    box per column (label column + one per player), gapped apart, not a
//    single shared-border table. Every box renders the exact same ordered
//    row list so they line up — see buildRows() below.
import { Fragment } from 'react'
import AthleteAvatar from '../../shared/AthleteAvatar'
import Flag from '../../shared/Flag'
import styles from './Reports.module.css'

function dash(v) { return v === null || v === undefined ? '—' : v }
function fmtDays(v) { return v === null || v === undefined ? '—' : `${v.toLocaleString()} days` }

const SECTIONS = [
  {
    name: 'PROFILE',
    rows: [
      { label: 'Seasons',            get: p => p.seasons },
      { label: 'Seasons in common',  get: p => p.seasons_in_common, noHighlight: true },
      { label: 'Forehand',           get: p => p.hand, noHighlight: true },
      { label: 'Backhand',           get: p => p.backhand, noHighlight: true },
    ],
  },
  {
    name: 'TOURNAMENTS',
    rows: [
      { label: 'Played',           get: p => p.tournaments_played },
      { label: 'Titles',           get: p => p.titles },
      { label: 'Finals won (%)',   get: p => p.finals_won_pct, fmt: v => v === null ? '—' : `${v}%` },
    ],
  },
  {
    name: 'RANKINGS',
    rows: [
      { label: 'Best Ranking',       get: p => p.best_ranking, fmt: v => v === null ? '—' : `No.${v}`, higherIsBetter: false },
      { label: 'Times ranked No.1',  get: p => p.times_no1 },
    ],
  },
]

const RECORD_FIRSTS_GROUPS = [
  { key: 'rankings',      label: 'Rankings',   hasTitle: false },
  { key: 'grand_slam',    label: 'Grand Slam', hasTitle: true },
  { key: 'masters_1000',  label: '1000',       hasTitle: true },
  { key: 'masters_500',   label: '500',        hasTitle: true },
  { key: 'masters_250',   label: '250',        hasTitle: true },
]

// Which player(s) hold the best value for a row — ties all highlight.
// Lower is better only for Best Ranking (rank 1 beats rank 50); everything
// else is higher-is-better, per Mohamed's literal "highlight grey the
// highest value" instruction.
function bestEntityIds(players, row) {
  if (row.noHighlight) return new Set()
  const higherIsBetter = row.higherIsBetter !== false
  const vals = players.map(p => ({ id: p.entity_id, v: row.get(p) })).filter(x => typeof x.v === 'number')
  if (!vals.length) return new Set()
  const best = higherIsBetter ? Math.max(...vals.map(x => x.v)) : Math.min(...vals.map(x => x.v))
  return new Set(vals.filter(x => x.v === best).map(x => x.id))
}

// One flat, ordered row list shared by every box (label + each player) so
// they render row-for-row in lockstep and stay visually aligned.
function buildRows() {
  const rows = []
  SECTIONS.forEach(section => {
    rows.push({ kind: 'section', text: section.name })
    section.rows.forEach(row => rows.push({ kind: 'data', row }))
  })
  rows.push({ kind: 'section', text: 'RECORD FIRSTS' })
  RECORD_FIRSTS_GROUPS.forEach(group => {
    rows.push({ kind: 'subsection', text: group.label })
    rows.push({ kind: 'rf', label: 'Age', groupKey: group.key, field: 'age' })
    rows.push({ kind: 'rf', label: 'After career debut', groupKey: group.key, field: 'days_after_debut' })
    if (group.hasTitle) rows.push({ kind: 'rf', label: 'Title', groupKey: group.key, field: 'label' })
  })
  return rows
}

function LabelCell({ rd }) {
  if (rd.kind === 'section') return <div className={styles.boxSectionCell}>{rd.text}</div>
  if (rd.kind === 'subsection') return <div className={styles.boxSubsectionCell}>{rd.text}</div>
  return <div className={styles.boxDataCell}>{rd.kind === 'rf' ? rd.label : rd.row.label}</div>
}

function ValueCell({ rd, player, highlightByRow }) {
  if (rd.kind === 'section') return <div className={styles.boxSectionCell} />
  if (rd.kind === 'subsection') return <div className={styles.boxSubsectionCell} />
  if (rd.kind === 'rf') {
    const val = player.record_firsts?.[rd.groupKey]?.[rd.field]
    const display = rd.field === 'days_after_debut' ? fmtDays(val) : dash(val)
    return <div className={styles.boxDataCell}>{display}</div>
  }
  const raw = rd.row.get(player)
  const display = rd.row.fmt ? rd.row.fmt(raw) : dash(raw)
  const isBest = highlightByRow.get(rd.row)?.has(player.entity_id)
  return <div className={`${styles.boxDataCell}${isBest ? ' ' + styles.reportHighlight : ''}`}>{display}</div>
}

export default function ReportTable({ data }) {
  if (!data) return null
  const { players } = data
  const rows = buildRows()

  const highlightByRow = new Map()
  SECTIONS.forEach(section => section.rows.forEach(row => highlightByRow.set(row, bestEntityIds(players, row))))

  return (
    <div className={styles.reportPrintArea}>
      <div className={styles.reportTableScroll}>
        <div className={styles.boxRow}>
          <div className={styles.box}>
            <div className={styles.boxHeader} />
            {rows.map((rd, i) => <Fragment key={i}><LabelCell rd={rd} /></Fragment>)}
          </div>
          {players.map(p => (
            <div className={styles.box} key={p.entity_id}>
              <div className={styles.boxHeader}>
                <AthleteAvatar src={p.image_url} name={p.name} className={styles.reportPlayerImg} fallback="letter" />
                <span className={styles.reportPlayerName}>{p.name}</span>
                <Flag iso2={p.country_iso2} name={p.name} className={styles.reportPlayerFlag} />
              </div>
              {rows.map((rd, i) => <Fragment key={i}><ValueCell rd={rd} player={p} highlightByRow={highlightByRow} /></Fragment>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
