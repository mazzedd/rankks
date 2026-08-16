// components/shared/DeceasedMark.jsx
// Small muted crescent-moon icon marking a "frozen" age (athlete has died —
// see calcAge.js's deathDate param and each template's own showDeceasedMark
// gate). Replaces the previous ✝ text glyph, duplicated identically across
// 7 templates — single source of truth for the icon itself, same
// .deceased-mark sizing/color it always had (color: var(--text3), inherits
// the surrounding text's font-size via the 1em SVG dimensions).
export default function DeceasedMark() {
  return (
    <span className="deceased-mark" title="Deceased">
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </span>
  )
}
