// Derives NBA season-year labels (end-year convention, matching competitions.year_convention='end')
// from actual game dates rather than a fixed calendar-month cutoff — a month cutoff breaks on
// the 2019-20 COVID "bubble" season (games ran July-October 2020) and the shifted 2020-21 season.
// Season boundaries are found as gaps of 45+ days with no games anywhere in TeamStatistics.csv.
const fs = require('fs');
const { parse } = require('csv-parse/sync');

let seasonEnds = null; // sorted array of { endDate: Date, label: number }, built once

function buildSeasonBoundaries(csvPath) {
  const raw = fs.readFileSync(csvPath, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  const dateSet = new Set();
  for (const r of records) {
    if (r.teamId === '0' || !r.gameDateTimeEst) continue;
    dateSet.add(r.gameDateTimeEst.slice(0, 10));
  }
  const dates = [...dateSet].map(s => new Date(s)).sort((a, b) => a - b);

  const ends = [];
  for (let i = 1; i < dates.length; i++) {
    const gapDays = (dates[i] - dates[i - 1]) / 86400000;
    if (gapDays > 45) {
      ends.push({ endDate: dates[i - 1], label: dates[i - 1].getUTCFullYear() });
    }
  }
  // Final in-progress/most-recent block's label is the last game's year (or year+1 if it
  // started the prior calendar year — matches the same "block ends in year X, labeled X" rule).
  const lastDate = dates[dates.length - 1];
  ends.push({ endDate: lastDate, label: lastDate.getUTCFullYear() });

  return ends;
}

function getSeasonYear(dateStr, csvPath) {
  if (!seasonEnds) seasonEnds = buildSeasonBoundaries(csvPath);
  const d = new Date(dateStr.slice(0, 10));
  for (const block of seasonEnds) {
    if (d <= block.endDate) return block.label;
  }
  return seasonEnds[seasonEnds.length - 1].label;
}

// Data-quality fallback: the entire 2021-22 season (and scattered smaller
// gaps elsewhere, ~4% or less — normal preseason noise) has a blank
// gameType column in TeamStatistics.csv — but gameId's leading digit
// reliably encodes it (verified against every other season where both are
// populated): 1=preseason, 2=regular season, 3=all-star, 4=playoffs,
// 5=play-in, 6=in-season tournament. Only regular season is recoverable
// this way — playoffs/play-in also need gameLabel for round/conference
// routing, which is blank in the same rows, so those still can't be
// routed and are skipped same as before.
function resolveGameType(gameType, gameId) {
  if (gameType) return gameType;
  if (!gameId) return gameType;
  const prefix = gameId[0];
  if (prefix === '2') return 'Regular Season';
  if (prefix === '4') return 'Playoffs';
  if (prefix === '5') return 'Play-in Tournament';
  return gameType;
}

module.exports = { getSeasonYear, buildSeasonBoundaries, resolveGameType };
