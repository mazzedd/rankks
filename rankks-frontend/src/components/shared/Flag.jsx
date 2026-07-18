// src/components/shared/Flag.jsx
// Single shared flag component — every place in RANKKS that shows a
// country flag (players, clubs, national teams, tennis score rows, the
// nav area indicator) renders through this rather than duplicating the
// <img src={...} onError={...}> markup. Path resolution lives in
// utils/flags.js; this component owns only the markup and the
// graceful-hide-on-404 behaviour, same split MatchVideo.jsx uses
// between logic and presentation.
//
// Returns null cleanly when iso2 is missing, so callers don't need to
// wrap usage in their own `{iso2 && (...)}` guard anymore.
import { getFlagUrl } from '../../utils/flags';

export default function Flag({ iso2, name, className }) {
  const src = getFlagUrl(iso2);
  if (!src) return null;

  return (
    <img
      src={src}
      alt={name || iso2 || ''}
      className={className}
      onError={e => { e.target.style.display = 'none'; }}
    />
  );
}
