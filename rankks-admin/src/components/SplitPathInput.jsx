import styles from './SplitPathInput.module.css'

// Directory portion of a path (everything up to and including the last
// '/'), for building a fixedDir prop from a sibling field's value — e.g.
// locking a "sidebar logo" field to the same folder as the main "logo"
// field next to it, so admin only ever has to type the differing filename.
export function dirOf(path) {
  if (!path) return ''
  return path.slice(0, path.lastIndexOf('/') + 1)
}

// Splits an image path field into a directory box + an editable filename
// box, so fixing a typo in the filename can't also fat-finger the shared
// folder convention. Always renders both boxes — a brand-new/empty record
// (e.g. a competition with no logo set yet) looks the same as an already-
// populated one, just with an empty directory box, rather than silently
// collapsing to a single plain input (that inconsistency was the bug:
// Mohamed 2026-08-25, "why u did not assign the split for FIFA World Cup?
// Should be the same everywhere"). Two modes:
//
//  - `fixedDir` supplied: the directory is a real computed formula (e.g.
//    Athletes' sport/gender/slug convention, or a sibling "logo path"
//    field's own directory) and is ALWAYS locked to that value, regardless
//    of what's actually saved in the DB column.
//
//  - `fixedDir` omitted: there's no formula (club/competition/partner logos
//    — the folder was hand-typed once, e.g. "logos/clubs/football/france/").
//    The directory is derived from the current value's own prefix (up to
//    the last '/'). Once that prefix exists it locks (read-only), same as
//    fixedDir mode; while it's still empty (nothing saved yet) the
//    directory box itself is editable, so the very first save can
//    establish the folder — it locks automatically from then on.
export default function SplitPathInput({ value, onChange, fixedDir, suggestedDir, placeholder, inputClassName }) {
  const val    = value || ''
  const slash  = val.lastIndexOf('/')
  const autoDir = slash >= 0 ? val.slice(0, slash + 1) : ''

  // The REAL directory — either a fixedDir formula or whatever the current
  // value's own prefix already establishes. Only this is ever locked.
  const realDir   = fixedDir != null ? fixedDir : autoDir
  const dirLocked = realDir !== ''

  // `suggestedDir` (e.g. Competitions.jsx's sport/level/country best-effort
  // guess) fills the box when there's no real directory yet, purely for
  // display — it's never committed until the admin actually types a
  // filename or edits the box, so it stays editable rather than locking on
  // a guess (unlike Athletes' fixedDir, which is a real, reliable formula —
  // competition logo folders aren't: Mohamed 2026-08-25).
  const dir = dirLocked ? realDir : (suggestedDir || '')

  const filename = fixedDir != null
    ? (val.startsWith(fixedDir) ? val.slice(fixedDir.length) : (slash >= 0 ? val.slice(slash + 1) : val))
    : (slash >= 0 ? val.slice(slash + 1) : val)

  return (
    <div className={styles.splitPath}>
      <input
        className={styles.dirPart}
        value={dir}
        readOnly={dirLocked}
        tabIndex={dirLocked ? -1 : 0}
        title={dirLocked ? dir : undefined}
        placeholder={dirLocked ? undefined : 'logos/…/'}
        onChange={dirLocked ? undefined : e => onChange(e.target.value + filename)}
      />
      <input
        className={`${styles.filePart} ${inputClassName || ''}`}
        value={filename}
        onChange={e => onChange(dir + e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}
