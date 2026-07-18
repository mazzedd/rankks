RANKKS F1 loader — setup and known risk areas
================================================

WHAT THIS DOES
--------------
Reads ./f1-raw/{year}/** (from the scraper) and loads into:
  f1_seasons, f1_grands_prix, f1_sessions, f1_session_results,
  f1_fastest_laps, f1_driver_standings, f1_team_standings

Idempotent — every insert uses ON CONFLICT ... DO UPDATE, so re-running
for a year you've already loaded updates rows rather than duplicating.

THIS HAS NOT BEEN RUN AGAINST A LIVE DATABASE YET. Same situation as the
scraper before its first run — I've written it carefully against the
real JSON shapes we verified together, but Postgres-specific issues
(a typo in a column name, a query that's technically valid SQL but
returns the wrong thing) only surface by actually running it. Expect
at least one round of fixes, same as the scraper needed.

SETUP
-----
1. Copy this folder (f1-loader) next to your f1-scraper folder — it
   reads from ../f1-scraper/f1-raw by default... actually no: copy
   the f1-raw folder itself INTO this f1-loader folder (or edit
   RAW_DIR at the top of load.js to point at wherever f1-raw lives).

2. npm install

3. Set your DB connection (Windows CMD, once per terminal session):
     set DATABASE_URL=postgres://youruser:yourpass@localhost:5432/yourdb

4. Test on 2004 ONLY first:
     node load.js 2004 2004

5. Check the actual rows in pgAdmin before trusting any of it:
     SELECT * FROM f1_grands_prix WHERE f1_season_id = (SELECT id FROM f1_seasons WHERE year=2004);
     SELECT * FROM f1_sessions WHERE grand_prix_id IN (SELECT id FROM f1_grands_prix WHERE f1_season_id = (SELECT id FROM f1_seasons WHERE year=2004));
     SELECT * FROM f1_session_results LIMIT 20;
     SELECT * FROM f1_driver_standings WHERE f1_season_id = (SELECT id FROM f1_seasons WHERE year=2004) ORDER BY points DESC;

   Specifically verify:
     - Michael Schumacher shows wins=13 for 2004 (this is a known,
       checkable historical fact — 2004 was his 13-win season)
     - Points match what we saw in the raw JSON (148 for Schumacher)
     - No driver has NULL where a real value should be

KNOWN RISK AREAS — check these specifically before scaling up
----------------------------------------------------------------
1. QUALIFYING MERGE (lib/sessionType.js, mergeQualifyingFiles) — the
   2003-2005-ish era used 3 separate qualifying pages instead of one.
   I could NOT independently verify the exact real label text F1.com
   uses for these 3 pages (never fetched one directly), so the merge
   logic's assumption about which file is "first/final" is a
   best-effort guess. Check a 2004 GP's Qualifying session specifically:
     SELECT * FROM f1_session_results sr
     JOIN f1_sessions s ON s.id = sr.session_id
     WHERE s.session_type = 'Qualifying'
       AND s.grand_prix_id = (SELECT id FROM f1_grands_prix WHERE source_race_id='753');
   If q1_time/q2_time look swapped or wrong, tell me and I'll fix the
   merge logic against real data instead of the current guess.

2. TEAM STANDINGS COLUMN MAPPING (load.js, the tsRaw section) — I
   never actually saw a real team-standings.json dump in this
   conversation, only drivers-standings.json. The column names
   ('team'/'constructor', 'position'/'pos', 'points'/'pts') are
   guessed to cover likely variations. Check this specifically:
     SELECT * FROM f1_team_standings WHERE f1_season_id = (SELECT id FROM f1_seasons WHERE year=2004) ORDER BY points DESC;
   Ferrari should be #1 with 262 points for 2004 (checkable fact).

3. FASTEST LAPS RACE-MATCHING (load.js, flRaw section) — assumes the
   fastest-laps.json rows have an href on the race-name cell pointing
   back to /races/{id}/... so we can join to f1_grands_prix. Never
   confirmed this href actually exists on that specific page. Check:
     SELECT * FROM f1_fastest_laps WHERE grand_prix_id IN (SELECT id FROM f1_grands_prix WHERE f1_season_id = (SELECT id FROM f1_seasons WHERE year=2004));
   If this table is empty after loading 2004, that's the cause —
   paste me a real fastest-laps.json and I'll fix the matching.

4. is_sprint_weekend / Sprint session detection — depends on the
   `label` text containing "sprint". Never confirmed the exact label
   text F1.com uses on a real sprint-weekend page (all our test years
   so far were pre-sprint-format, which started in 2021). Test against
   a 2022+ year once you get there, not just 2004.

ONCE 2004 LOOKS RIGHT
----------------------
Scale up gradually, same pattern as the scraper:
  node load.js 2000 2010
  (spot check again)
  node load.js 1950 2026
