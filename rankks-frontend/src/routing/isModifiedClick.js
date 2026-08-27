// src/routing/isModifiedClick.js
//
// react-router's own <Link> already skips ITS internal navigate() for a
// modified click (ctrl/cmd/shift/alt held, or a middle-click) — standard
// browser-native "open in new tab" behavior. But every converted nav
// element here ALSO calls its original store action directly in onClick
// (kept unchanged, per the sync-layer design — see useUrlSync.js), and
// that store update is unconditional: it doesn't know why the click
// happened, so useUrlSync's store->URL effect faithfully navigates the
// CURRENT tab too, even for a click that was only ever meant to open a
// new one. Every onClick that also drives a Link must check this first and
// bail out, so a ctrl/cmd+click leaves the current tab exactly where it
// was while the new tab opens normally.
export function isModifiedClick(e) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1
}
