// src/components/shared/ChevronIcon.jsx
// Clean line-art chevron (Mohamed 2026-08-21, HomepageTemplate.jsx's
// original: "design a nicer arrow" — replaced the old unicode "⌄" glyph,
// whose weight/alignment varied by font). Points down by default; `open`
// rotates it 180° to point up. Extracted here (Mohamed 2026-08-25: "use
// the arrow (homepage for expandable tables)") so any other expandable/
// sortable UI reuses the exact same icon instead of a re-hand-rolled one
// or a unicode ▲/▼ character — HomepageTemplate.jsx's own league-box
// chevron now also renders through this instead of its former local copy.
// Color comes from the surrounding element's CSS `color` (stroke="currentColor"),
// not a prop — matches how the original inline version worked via its
// .chevron CSS class.
export default function ChevronIcon({ open, size = 14, className, style }) {
  return (
    <svg
      className={className}
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none', ...style }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
