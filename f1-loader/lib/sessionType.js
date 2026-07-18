// lib/sessionType.js
//
// Classifies each raw session JSON file into a canonical session_type,
// using the `label` field scrape.js stored (the actual link text from
// the site) rather than guessing from the URL slug — labels are ground
// truth, slugs are an assumption.
//
// display_order encodes the FOR1-NAV-01 Line B order from the master
// spec: Race Results, Qualifying, Sprint, Sprint Qualifying, then
// Practice N descending. 'Practice 4' (2003-2004 era, 4-practice
// weekends) isn't in the spec at all — placed right after Sprint
// Qualifying since chronologically it was the last practice before
// qualifying in that old format. This is a judgment call, not
// confirmed against the spec — flag if it looks wrong once you see
// real loaded data.
const DISPLAY_ORDER = {
  'Race': 1,
  'Qualifying': 2,
  'Sprint': 3,
  'Sprint Qualifying': 4,
  'Practice 4': 5,
  'Practice 3': 6,
  'Practice 2': 7,
  'Practice 1': 8,
};

function classifyByLabel(label, filename) {
  const l = (label || '').toLowerCase();
  if (filename === 'race-result.json') return 'Race';
  if (/practice/.test(l)) {
    const m = l.match(/(\d)/);
    return `Practice ${m ? m[1] : '1'}`;
  }
  if (/sprint/.test(l) && /(qual|shootout)/.test(l)) return 'Sprint Qualifying';
  if (/sprint/.test(l)) return 'Sprint';
  if (/qual/.test(l)) return 'Qualifying_RAW'; // resolved further in mergeQualifying — could be one of possibly several files
  return null; // starting-grid, pit-stop-summary, or anything unrecognized — intentionally skipped, not in the locked spec's Line B
}

// Modern era: one 'qualifying' file already has Q1/Q2/Q3 as table columns.
// Old era (confirmed present in 2004 data: qualifying-0/1/2.json): three
// separate files, one per qualifying segment. This merge is BEST-EFFORT —
// verify against real loaded output for a 2003-2005 test year before
// trusting it; the exact historical semantics of the 2003-2004
// single-lap-qualifying format's 3 pages weren't independently confirmed
// during scraper development.
function mergeQualifyingFiles(qualifyingFiles) {
  // qualifyingFiles: [{ filename, label, headers, rows }]
  const hasQCols = qualifyingFiles.some(f => f.headers.some(h => /^Q[123]$/i.test(h.trim())));
  if (qualifyingFiles.length === 1 && hasQCols) {
    // Modern single-file case — already has Q1/Q2/Q3 columns, no merge needed
    return qualifyingFiles[0].rows;
  }

  // Old multi-file case — merge per driver by the row's driver href/text.
  // Sort files so the one most likely to represent final order (usually
  // has 'overall' in the label, or is numbered 0) comes first — its
  // position/time becomes q1_time; subsequent files layer into q2/q3.
  const sorted = [...qualifyingFiles].sort((a, b) => {
    const score = f => (/overall|final/i.test(f.label) ? -1 : 0);
    return score(a) - score(b);
  });

  const byDriver = new Map(); // driverKey -> merged row
  sorted.forEach((file, idx) => {
    const timeKey = ['q1_time_raw', 'q2_time_raw', 'q3_time_raw'][idx] || `q${idx + 1}_time_raw`;
    file.rows.forEach(row => {
      const driverCell = row['driver'];
      const key = driverCell?.href || driverCell?.text;
      if (!key) return;
      if (!byDriver.has(key)) byDriver.set(key, { ...row, _times: {} });
      byDriver.get(key)._times[timeKey] = row['time']?.text || row['time_gap']?.text || null;
    });
  });

  return Array.from(byDriver.values()).map(row => ({
    ...row,
    q1: { text: row._times.q1_time_raw || null },
    q2: { text: row._times.q2_time_raw || null },
    q3: { text: row._times.q3_time_raw || null },
  }));
}

module.exports = { classifyByLabel, mergeQualifyingFiles, DISPLAY_ORDER };
