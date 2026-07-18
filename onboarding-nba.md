# RANKKS — New Sport Onboarding: NBA / Basketball

Status: **RESOLVED** — all product/schema/data decisions below were worked through against
the actual source files and live code (not guessed), including a full live schema check
against `games`/`standings`/`seasons`/`entities`/`entity_aliases`/`entity_names`/
`player_attributes` (2026-07-12). One thing remains before build starts: your review of
`00-nba/conference-division-history.md` (Section 3.5/5) — everything else below is decided
and should not be re-litigated.

---

## 0. Quick Reference

| Field | Value |
|---|---|
| Sport name / slug | Basketball / `basketball` |
| display_pattern | AB (events + sub-tabs) |
| `competitions.year_convention` | **`end`** — confirmed against live schema (`competitions.year_convention`, used by `seasons.js` to convert DB-stored year to UI year). Award Shares CSV's own `season` column already labels the 2024-25 season as `2025` (e.g. Shai Gilgeous-Alexander's MVP season), matching UCL's end-year convention — zero conversion needed at ingestion. |
| Gender model | Single (NBA only — men's). WNBA is a separate future sport, not a filter on this one. |
| Data source type | Static bulk dataset (Kaggle CSV/Parquet), no live API for historical |
| Primary data source(s) | Kaggle `eoinamoore/historical-nba-data-and-player-box-scores`; Kaggle `sumitrodatta/nba-aba-baa-stats` (awards) |
| Historical range available | **Confirmed from actual files.** `TeamStatistics.csv`: 1946-47 (BAA founding, pre-1949 NBA rename) through 2025-26 (in progress) — 80 seasons, 146,560 game-rows. Awards phase in unevenly: ROY from 1950, MVP from 1956, DPOY/SMOY from 1983, MIP from 1986, Clutch POY only from 2023 (brand-new award — see Section 4). |
| Target launch range (matches beta scope) | **Decided: full history, 1946-47+.** Note for ingestion (Section 3): pre-1954-55 has no shot clock, pre-1979-80 has no 3-point line — stat columns for those eras will be structurally sparser (nulls for 3PT fields etc.), not just missing data. Build ingestion to tolerate that rather than assuming all stat columns are always populated. |

---

## 1. Navigation Architecture

7 Line A events per season, consolidated across both conferences where applicable, plus
a season-level Iconic Moments gallery with no dedicated event row (reuses existing
pattern from tennis/football — same `result_tabs` mechanism, no structural change needed).

| Line A event | Line B tab(s) | typology | Notes |
|---|---|---|---|
| Regular Season | Standings | standings | Consolidates East + West into one table. Conference/Division are **in-template filters**, not separate Line A events (East/West split explicitly rejected). |
| Finals | NBA Finals / Eastern Finals / Western Finals | game | 3 flat tabs, no round-expand (unlike Playoffs). |
| Playoffs | Eastern Conf. / Western Conf. | game | 2 tabs, each with expandable round-blocks. Most-advanced-round expanded by default. |
| Play-in | Eastern Conf. / Western Conf. | game | Same 2-tab pattern as Playoffs, simpler bracket. |
| Awards | (uses existing Player EventBlock) | players | Shows no data during ongoing seasons. Requires its own `seasons` row per year, keyed by `event_id`. |
| End of Season Teams | (uses existing Player EventBlock) | players | Same pattern as Awards — own seasons row per year, keyed by `event_id`. |
| All-Star | (uses existing Player EventBlock) | players | **Added per Section 2 resolution.** Roster-only from `All-Star Selections.csv` (who was selected + `replaced` flag) — team/side dropped entirely since naming is era-inconsistent (East/West vs captain-named teams vs one-off formats), no bracket modeled. Own `seasons` row per year, keyed by `event_id`, same pattern as Awards. |
| *(no Line A row)* | Iconic Moments | iconic_moments | Season-level shared gallery, not tied to a specific event — same mechanism as tennis/football Videos tab (Build Log v1.8/v2.1). Auto-seeded per existing pattern. |

- [x] Confirmed: no new typology needed — Awards/End of Season Teams reuse the existing Player EventBlock/`players` typology.
- [x] **RESOLVED** — Iconic Moments category taxonomy for basketball. Checked actual seeded rows in `iconic_moment_categories` for football (content-type axis: Goals/Assists/Gestes techniques/Arrêts de gardien/Actions défensives/Actions clutch, French labels) vs tennis (context axis: which draw — Men Single/Women Single/.../Mixed Double/General, English labels) — the two existing sports don't share one shape, so basketball needed its own call rather than copying either directly. Basketball has no draws (single-gender), so the football content-type axis is the fit; kept single-axis discipline (no context/stage bucket, since e.g. a playoff buzzer-beater dunk would otherwise span multiple buckets) and merged "Buzzer Beaters"/"Game Winners" from the earlier draft since they were the same clip type. English labels (basketball terminology is English-native; matches tennis precedent for language choice).

  Final list (seed into `iconic_moment_categories`, `sport_id` = basketball):

  | value | label | display_order |
  |---|---|---|
  | `dunks` | Dunks | 1 |
  | `assists` | Assists | 2 |
  | `clutch_shots` | Clutch Shots | 3 |
  | `blocks` | Blocks | 4 |
  | `defensive_plays` | Defensive Plays | 5 |
  | `milestone_games` | Milestone Games | 6 |

---

## 2. Data Source Inventory

| File / endpoint | Contains | Coverage | Known gaps | Update frequency |
|---|---|---|---|---|
| TeamStatistics.csv | Quarter scoring, win/loss, home/away, round classification (`gameType`/`gameLabel`/`gameSubLabel`/`seriesGameNumber`/`seed`), 2 rows/gameId = full game record | 1946-47–2025-26, 146,560 rows | 2 dead placeholder rows (`teamId=0`) — filter at ingestion | static |
| ~~PlayerStatistics.csv~~ | **Not needed** — `PlayerStatisticsExtended.csv` is a verified superset (110 cols, includes all base box-score fields) | — | — | — |
| PlayerStatisticsExtended.csv | 110 columns: full box score + advanced metrics, `doubleDouble`/`tripleDouble`, `comment` (DNP notes) | Full history | — | static |
| ~~Games.csv~~ | **Not needed** — `TeamStatistics.csv`'s 2-rows-per-`gameId` pairing already gives a complete game record (verified) | — | — | — |
| ~~TeamHistories.csv~~ | **Not needed** — `entity_names` derivable directly from `TeamStatistics.csv` by grouping `(teamId, teamCity, teamName)` with date ranges; verified against the Hornets/Bobcats split (NBA's 2014 official record reassignment already baked into `teamId` continuity) | — | — | — |
| PlayByPlay.parquet | Play-by-play | Full history | Not needed for launch scope (confirmed, no per-play display planned) | static |
| LeagueSchedule CSVs | Future/upcoming schedule | — | Not needed — historical data comes entirely from `TeamStatistics.csv` | static |
| Player Award Shares (sumitrodatta) | MVP/DPOY/SMOY/MIP/ROY/Clutch POY voting shares | 1948–2025, plus pre-merger ABA/BAA | Not every award existed every season (see Section 4) | static |
| End of Season Teams (sumitrodatta) | All-NBA / All-Defense selections | — | — | static |
| All-Star Selections (sumitrodatta) | All-Star rosters | 1951–2026, 2,059 rows | Team-side naming is era-inconsistent (East/West vs post-2018 captain-named teams like Team LeBron/Team Giannis vs one-off formats like Team Stripes/Team World) — no stable 2-team bracket across eras. **Resolved: own 7th Line A event, roster-only** (who was selected each season + `replaced` flag for injury replacements); team/side assignment dropped entirely rather than forced into a bracket. | static |

- [x] **RESOLVED** — Finals MVP confirmed absent from every available source (checked `Player Award Shares.csv`, `End of Season Teams.csv`, `End of Season Teams (Voting).csv`, `All-Star Selections.csv`, `TeamStatistics.csv` gameLabel — none carry it). **Decision: deferred, out of scope for launch.**
- [x] Sample rows reviewed, `award_results` question resolved — see Section 4.
- Note: the actual All-Star Game box score (distinct from the selections roster above) already exists in `TeamStatistics.csv` (`gameType = 'All-Star Game'`, 14 rows) and could ride the existing `games` typology if ever wanted — separate question from All-Star Selections above, not in scope unless requested.

---

## 3. Field Mapping Table

**Source-file scope resolved first** (see `00-nba/` — only `TeamStatistics.csv` and
`PlayerStatisticsExtended.csv` from the eoinamoore dataset were actually present; the
onboarding draft assumed `Games.csv`, base `PlayerStatistics.csv`, and `TeamHistories.csv`
would also be needed). Checked each directly rather than treating the gap as blocking:
- **`Games.csv` not needed** — `TeamStatistics.csv` has exactly 2 rows per `gameId`
  (home + away perspective) that together form a complete game record. Verified 73,277 of
  73,279 gameIds pair cleanly; the other 2 are dead placeholder rows (`teamId=0`,
  `gameDateTimeEst` earlier than the real game date) — filter these at ingestion
  (`WHERE teamId != 0`).
- **Base `PlayerStatistics.csv` not needed** — `PlayerStatisticsExtended.csv` (110 columns)
  is a strict superset: every base box-score field plus `doubleDouble`/`tripleDouble`/
  `comment` (DNP notes) and ~70 advanced columns.
- **`TeamHistories.csv` not needed** — `teamId` in `TeamStatistics.csv` already stays
  constant across relocations/renames, verified against the trickiest real case: `teamId
  1610612766` runs Charlotte Hornets (1988–2002) → Charlotte Bobcats (2004–2014) →
  Charlotte Hornets (2014–present) as one continuous id, matching the NBA's official 2014
  retroactive record reassignment (the team that actually relocated to New Orleans in
  2002, `teamId 1610612740`, starts fresh with no Charlotte history). `entity_names` can be
  derived directly by grouping `(teamId, teamCity, teamName)` with date ranges.

### 3.1 `TeamStatistics.csv` → `games` (consolidate the 2 rows per `gameId` into 1 row)

**Live schema confirmed** (`information_schema.columns`, pasted 2026-07-12): `games` has no
`source_id`/external-key column, and no `ON CONFLICT` dedup pattern is used anywhere —
checked `ingest-fixtures.js` for the actual established convention: it reuses
**`match_number`** to hold the source API's fixture ID and dedupes via
`WHERE result_tab_id = $1 AND match_number = $2` (SELECT-then-INSERT/UPDATE, no unique
constraint). Basketball's `gameId` follows the same convention — this **displaces**
`seriesGameNumber` from `match_number` (can't hold both), see below.

| Source field(s) | Target column | Notes |
|---|---|---|
| `gameId` | `match_number` | Dedup key, per the established `ingest-fixtures.js` convention — not `seriesGameNumber` as originally mapped. |
| `gameDateTimeEst` | `match_date` | **Correction**: `match_date` is `date` type in the live schema, not timestamp — the time-of-day component is dropped, date-only. `gameDate` column is redundant (same value, date-only already). |
| home-perspective row's `teamId` | `home_entity_id` | Via `entities.external_ids->>'nba_team_id'` — **correction**: not `entity_aliases` (that table is name-search only, confirmed by reading `entities.js` and `ingest-players.js`; external-source IDs live in the `entities.external_ids` jsonb column, keyed by source name, e.g. football's `external_ids->>'api_sports'`). |
| away-perspective row's `teamId` | `away_entity_id` | Same mapping. |
| `teamScore` / `opponentScore` (home row) | `score` jsonb `{home, away}` | Matches existing shape used by football (`game_template.jsx`), no `penalty` sub-object needed for basketball. |
| `win` (home row) | `home_won`, `winner_entity_id` | Boolean + derived winner entity. |
| `gameType` | `round`-tier classification | `Regular Season` / `Playoffs` / `Play-in Tournament` / `All-Star Game`. Also saw 2 rows of `Emirates NBA Cup` and assorted `gameLabel` values (`AWS NBA Rivals Week`, `NBA Cup`, `NBA Paris/London/Mexico City/Berlin Game`) — these are in-season-tournament and international-game branding, not currently modeled as Line A events; flag as out-of-scope-for-launch unless wanted later. |
| `gameLabel` / `gameSubLabel` | `round` | e.g. `NBA Finals`, `East Conf. Finals`, `East First Round` — direct passthrough, as anticipated in Section 4. |
| `seriesGameNumber` | `leg_number` | **Revised** — displaced from `match_number` (see above). `leg_number` is already read by `TieCard` (`leg.leg_number ?? i+1`, falling back to chronological array position if absent) for football's two-legged ties; explicit `seriesGameNumber` gives basketball's 7-game series an authoritative source instead of relying purely on date-sort. Requires the `TieCard` series-mode fix — see Section 8. |
| `seed` (home/away rows) | `home_seed` / `away_seed` | |
| `numMinutes` (240 + OT) | `duration_minutes` | |
| `q1Points`...`q4Points`, `ot1Points`/`ot2Points`/`otAllPoints`, `assists`, `blocks`, `steals`, FG/3PT/FT made-attempted-pct, rebounds (off/def/total/team), `foulsPersonal`, `turnovers`/`turnoversTeam`, `plusMinusPoints`, `biggestLead`, `biggestScoringRun`, `leadChanges`, `pointsFastBreak`, `pointsFromTurnovers`, `pointsInThePaint`, `pointsSecondChance`, `timesTied`, `benchPoints` | `stats` jsonb, nested `{home: {...}, away: {...}}` | Full box score, same free-form pattern as football's `stats` jsonb. |
| `venue` / `venue_city` | — | **Gap: not present in source at all.** No arena data in `TeamStatistics.csv`. Leave null for launch, or build a team-home-arena reference table later if wanted (out of scope unless requested). |
| `coachId` | — | No coach-entity concept in scope; unused. |
| `is_walkover` / `is_retirement` | — | Not applicable to basketball; always `false`. |
| `scorers` | — | Football-specific concept (top scorers list); no basketball equivalent planned — leave unused unless a use case comes up. |

### 3.2 `TeamStatistics.csv` (self-derived) → `entity_names`

Group by `(teamId, teamCity, teamName)`, take `MIN(gameDateTimeEst)`/`MAX(gameDateTimeEst)`
per group as the validity date range → `entity_names.start_year`/`end_year`. **Correction**:
`teamId` is not itself `entities.id` (that's an internal serial PK) — `teamId` is the stable
lookup key stored in `entities.external_ids->>'nba_team_id'`, resolved to `entities.id` via
that jsonb lookup, same convention as player IDs below.

### 3.3 `PlayerStatisticsExtended.csv` → player stat fields

110 columns covering full per-game box score + advanced metrics (ratings, percentages,
possessions, on/off splits). **Correction** (confirmed by reading `ingest-players.js`,
not `entity_aliases` as originally mapped — that table is name-search only): `personId` →
`entities.id` via `entities.external_ids->>'nba_person_id'`, same jsonb-lookup pattern
football uses for `external_ids->>'api_sports'`. `player_id` strings from the sumitrodatta
files (e.g. `jokicni01`) get their own key in the same jsonb object,
`external_ids->>'bref_player_id'` — both point at the same `entities.id` row, don't assume
they're interchangeable. `comment`
column carries DNP/inactive notes. `doubleDouble`/`tripleDouble` are pre-computed booleans,
no need to derive them from the raw stats.

### 3.4 Award Shares → `standings` reuse

See Section 4 — resolved, no new table.

### 3.5 Regular Season standings — full NBA.com column set (see Section 5)

W/L/PCT/GB/Home/Away/Streak/Last 10, all aggregated from `TeamStatistics.csv` per
`(teamId, season)`. Conference/division isn't in any Kaggle file — see
`00-nba/conference-division-history.md` for the researched reference table
(**pending your review before use as seed data** — flags several non-obvious cases:
Detroit Pistons and Houston Rockets each crossed conferences twice with zero relocation;
Charlotte Hornets crossed conferences three times in their first three seasons; a few
low-confidence items are called out explicitly at the bottom of that file).

---

## 4. New Schema Requirements

| New table / column needed | Purpose | Confirmed necessary? |
|---|---|---|
| ~~`award_results`~~ — **RESOLVED, no new table** | Player Award Shares (MVP/DPOY/SMOY/MIP/ROY/Clutch POY voting) | **Decided:** reuse `standings` as-is. Verified live `standings` shape via `results.js` (`result_tab_id, entity_id, entity_type, position, stats jsonb`) — `entity_type` is a per-row column, so player-rows slot in cleanly alongside the team-standings use case. Model: one `result_tab` per award per season (tab_key `mvp`/`dpoy`/`roy`/`smoy`/`mip`/`clutch_poy`), one `standings` row per candidate (`entity_type='player'`, `position`=rank by share desc, `stats`={pts_won, pts_max, share, first_place_votes, age, winner}). Column display (Share/Pts Won/First-Place Votes) rides the existing `competitions.column_config` mechanism — no new frontend data path. |
| Round classification fields on `games` | Playoffs/Play-in round-block expand/collapse needs round info per game | Likely reuses `gameType`/`gameLabel`/`gameSubLabel`/`seriesGameNumber`/`seed` from source directly — confirm target column names in Claude Code against actual `games` table schema. |

**Verified from real CSV** (`00-nba/Player Award Shares.csv`, 3466 rows, seasons 1948–2025):
- Candidate count per award/season is organic, not a fixed cutoff (e.g. 2025 nba dpoy = 13 rows, 2010 nba mip = 30 rows, 1980 nba roy = 2 rows) — `standings`' existing 1..N model handles this with no special-casing, same as a small vs large league table.
- **Gotcha for ingestion (Section 3):** not every award existed in every season — e.g. 1980 only has `nba mvp` and `nba roy` rows (DPOY/SMOY/MIP didn't exist yet). Ingestion must create `result_tabs`/`seasons` rows only for award-season combos actually present in the source, never assume all 6 awards exist back to 1948.
- Award values present in source: `nba mvp`, `nba dpoy`, `nba roy`, `nba smoy`, `nba mip`, `nba clutch_poy`, plus pre-merger `aba mvp`, `aba roy`, `baa roy` (relevant to Section 0's historical-range TBD, not resolved here).
- Full-list browsing (winner down to last candidate) and season-to-season swipe (2018→2019 etc.) both fall out of this for free — swipe is the standard per-event `seasons` navigation already used everywhere else (Section 1 already calls for Awards to get its own `seasons` row per year).

---

## 5. Entity & Filter Fields

### Players list filters
**RESOLVED** — 4 slots: **Position, Country, Team (during event), Draft Year.** Mirrors the
football pattern (Position/Country/Club/Gender) with Draft Year replacing Gender, since NBA
is single-gender. Draft Year confirmed sourceable from `Draft Pick History.csv`
(`season`/`overall_pick`/`round`/`college`).

**Gap: no source file has player nationality/country at all** — checked every CSV header in
`00-nba/`, none carry it. Decision: keep Country as a filter slot anyway, source the data
separately later (manual entry or third-party lookup) rather than dropping the slot or
substituting something else. Filter will show empty/unfiltered for Country until that data
is backfilled.

### Standings columns (Regular Season)
**RESOLVED** — full NBA.com set: W / L / PCT / GB / Home / Away / Streak / Last 10, all
aggregated from `TeamStatistics.csv` per `(teamId, season)` (see Section 3.5). GB needs
conference/division grouping — see `00-nba/conference-division-history.md`, pending review.

### Sport-specific entity fields
**RESOLVED** — Draft Year, Draft Round, Draft Pick (overall), sourced from
`Draft Pick History.csv`. Height/Weight already covered by the universal athlete fields
(§21). College and Hall-of-Fame flag (both confirmed available in `Player Career Info.csv`)
considered but not included for now.

**Storage location, corrected after reading `admin.js:184-360` in full** (live
`player_attributes` schema confirmed 2026-07-12) — there are actually **two** existing
per-sport attribute mechanisms, not one:
- `entities.sport_attributes` jsonb — simple, permanent, single-value traits, merged in
  place (`sport_attributes || $1::jsonb`), no separate row. Used today for tennis's
  `hand`/`backhand`/`foot`.
- `player_attributes` EAV table (`entity_id, sport_id, attribute_key, attribute_value`,
  plus `start_year`/`end_year` for values that change over a career, plus a
  `portrait_path`/`profile_path` pair that's really just a football-specific
  admin-editing side-channel) — used for football's `position`/`nationality`.

**Draft Year/Round/Pick → `entities.sport_attributes` jsonb**, not `player_attributes` —
they're immutable facts set once (a draft happens exactly one time, never revised), the
same shape as tennis's `hand`/`backhand`/`foot`, not football's time-varying `position`.
Using the EAV table would be over-engineering for a static fact.

**Position (already a filter slot) → `player_attributes` EAV**, `attribute_key='position'`,
matching football's exact precedent — basketball is a multi-position team sport like
football, not entity-only like tennis/F1 (`sport_id` 2/4, which never get
`player_attributes` rows at all, confirmed by the `isEntityOnlySport` check in
`admin.js:309`). This means basketball ingestion needs to write `player_attributes` rows
for position, unlike a fully entity-only sport.

Also confirms Section 6's portrait decision needed no change: `entities.image_url` is the
actual runtime-read portrait field for every sport regardless of the mechanism above
("Always sync to entities.image_url — this is what EventBlock reads at runtime",
`admin.js:351`) — `player_attributes.portrait_path` is only a football-specific admin
convenience, not something basketball needs to replicate.

---

## 6. Media & Image Paths

| Asset type | Path pattern | Source |
|---|---|---|
| Competition/league logo | `/media/logos/competitions/basketball/nba/...` | Manual |
| Team logo | `/media/logos/clubs/basketball/nba/{team-slug}.png` | Manual, sourced from official/Wikipedia |
| Player portrait | `/media/athletes/basketball/male/profile/{slug}.png` | **RESOLVED** — `https://cdn.nba.com/headshots/nba/latest/1040x760/{personId}.png` (verified live pattern), `personId` = the numeric NBA id already present in `PlayerStatisticsExtended.csv`, no extra ID-mapping needed. Unlicensed CDN (not a paid API like football's API-Sports) and the `/latest/` path likely has no coverage for players retired before the CDN existed — use it where available, existing silhouette fallback for players it doesn't cover (pre-1990s-ish retirees). |
| Event BG image | TBD per event (Finals, Playoffs, etc.) | Manual |
| Silhouette fallback | **RESOLVED, zero code change** — confirmed by reading `portraits.js`: `GENDERED_SPORTS = ['football', 'tennis', 'f1']` is an explicit array, not an if/else chain, specifically designed so unlisted sports fall through to a single ungendered `/media/default/{sport}/portrait.png` automatically. Since NBA is single-gender, it must **not** be added to that array — just drop `/media/default/basketball/portrait.png` in place at build time. | Asset only, no code |

---

## 7. Admin Panel Additions

- [ ] Team management page — likely reuses existing Club admin pattern (football precedent), confirm no bespoke fields needed beyond Draft/Conference/Division if any.
- [ ] Awards/End of Season Teams admin entry — reuses standings admin form/pattern (`entity_type='player'`, per Section 4), not a bespoke form.
- [ ] Confirm column_config UI covers Regular Season standings columns without new admin fields.

---

## 8. Frontend Template Assignment

| typology used | Existing component reused? | New component needed? | Reason if new |
|---|---|---|---|
| standings | Yes — reuse StandingsTemplate | No | Regular Season is a standard ranked table |
| game | Yes — reuse GameTemplate (football pattern), NOT tennis_draw | **Yes, a small structural fix** | Finals/Playoffs/Play-in are bracket/series based like UCL knockout, not a tennis draw. But GameTemplate's round-expand does NOT generalize as-is — see below. |
| players | Yes — reuse existing Player EventBlock pattern | No | Awards + End of Season Teams |
| iconic_moments | Yes — fully generic per Build Log v1.8/v2.1 | No | — |

- [x] **RESOLVED, confirmed by reading the actual code** (`game_template.jsx:308-315`) — `sortRounds()`
  extracts a trailing number from the round label via regex (`Round of 16`→16), defaulting
  to 0 with no trailing digit, then auto-opens the first sorted round. For UCL this
  *accidentally* lands on the Final: `Final`/`Semi-Final`/`Quarter-Final` all default to 0
  and happen to alphabetize `Final < Quarter-Final < Semi-Final` — it's alphabetical luck,
  not real "most-advanced-round" logic. Basketball's actual `gameLabel` values (`East Conf.
  Finals`, `East First Round`, `East Play-In`, `NBA Finals`) have **no trailing digits at
  all**, so the sort collapses to pure alphabetical order — would silently auto-open the
  wrong round.

  **Decision: replace `sortRounds()`'s label-parsing with date-based ordering**
  (`MAX(match_date)` per round) instead of a basketball-specific branch or a new
  `round_order` schema column. No schema change, generalizes to any sport's round-naming
  convention, and fixes football's fragile alphabetical-accident dependency as a side
  effect. **Not yet implemented** — this is a Build Order step 4 (Frontend) task, once
  basketball ingestion exists to test against; flagging here so it isn't missed.

- [x] **RESOLVED, second issue found in the same component** (`TieCard`, `game_template.jsx:229-306`)
  while working out where `seriesGameNumber` should map (see Section 3.1) — `TieCard`
  groups repeat matchups within a round (`groupIntoTies`, by unordered entity-id pair,
  ordered by date) and that grouping mechanism already generalizes fine to a 7-game
  series with zero changes. But `TieCard` itself **sums scores across legs and declares
  the winner by aggregate score** — built specifically for football's two-legged
  away-goals format. A best-of-7 NBA series isn't decided by summed points across games,
  it's decided by game-win count (e.g. "4-2") — reusing `TieCard` as-is would display a
  meaningless aggregate-points total instead of a series record.

  **Decision: add a series mode to `TieCard`** (aggregate-by-summed-score for football vs.
  aggregate-by-win-count for a basketball series, plus "Game N" vs "Leg N" labeling) rather
  than a separate component — `groupIntoTies`'s grouping/date-ordering logic doesn't need
  duplicating, only `TieCard`'s scoring/label output needs a switch. **Not yet
  implemented** — same Build Order step 4 timing as the round-expand fix above.

---

## 9. Page Titles & Subtitles

No exception expected — existing client-side generation rule (tab name + season status +
year) should cover NBA cleanly. Confirm once first season is live.

---

## 10. Known Edge Cases / Open Decisions Log

| Edge case | Applies? | Decision |
|---|---|---|
| Non-annual schedule | No | NBA is fully seasonal |
| Time-aware entity naming | Yes | `entity_names` derived directly from `TeamStatistics.csv` (`teamId`+city+name grouping) — TeamHistories.csv turned out unnecessary, see Section 3 |
| Country/entity historical name changes | Not directly, but player nationality is relevant (international players) | **Gap confirmed**: no source file has player country/nationality at all. Keeping Country as a filter slot anyway, sourcing separately later. See Section 5 |
| Gender=Both split | No | NBA is single-gender; WNBA is out of scope as its own future sport |
| New table needed vs. reuse | **Resolved** | No new table — reuse `standings` (`entity_type='player'`). See Section 4 |
| Finals MVP data gap | **Resolved** | Confirmed absent from every source checked. Deferred, out of scope for launch. See Section 2 |
| All-Star team-side era inconsistency | **Resolved** | Roster-only, no bracket/side. Own 7th Line A event. See Sections 1 & 2 |
| Iconic Moments category taxonomy | **Resolved** | Dunks/Assists/Clutch Shots/Blocks/Defensive Plays/Milestone Games. See Section 1 |
| Historical range / launch scope | **Resolved** | Full history, 1946-47+. See Section 0 |
| Conference/division reference data | **Resolved, pending your review** | Not sourceable from any Kaggle file; researched separately. See `00-nba/conference-division-history.md` and Section 3.5 |
| Players list filters | **Resolved** | Position, Country (gap, see above), Team (during event), Draft Year. See Section 5 |
| Sport-specific entity fields | **Resolved** | Draft Year/Round/Pick → `entities.sport_attributes` jsonb (static-fact shape, like tennis's hand/backhand/foot); Position → `player_attributes` EAV (matches football's precedent, basketball is not entity-only). See Section 5 |
| Player portrait source | **Resolved** | `cdn.nba.com` headshot CDN for recent players, silhouette fallback for historical. See Section 6 |
| Playoffs round-expand logic reuse vs. new code | **Resolved, not yet implemented** | Confirmed by reading `game_template.jsx` — existing logic doesn't generalize. Fix: sort rounds by game date instead of label text. Deferred to Build Order step 4. See Section 8 |
| TieCard series-scoring logic (best-of-N vs two-legged aggregate) | **Resolved, not yet implemented** | Confirmed by reading `game_template.jsx` — sums scores/declares winner by aggregate, wrong for a game-win-count series. Fix: add a series mode to TieCard. Deferred to Build Order step 4. See Section 8 |
| `year_convention` for NBA | **Resolved** | `end` — matches source CSVs' own season labeling, zero conversion needed. See Section 0 |
| External-source ID crosswalk mechanism | **Resolved** | `entities.external_ids` jsonb (keyed by source name), not `entity_aliases` (name-search only) — confirmed by reading `ingest-players.js`/`entities.js`. See Section 3.3 |
| `games` dedup key (no source_id column exists) | **Resolved** | Reuses `match_number` per the established `ingest-fixtures.js` convention — displaces `seriesGameNumber` to `leg_number` instead. See Section 3.1 |

---

## Build Order

1. Schema — live `information_schema.columns` check done for `games`/`standings`/`seasons`/`entities`/`entity_aliases`/`entity_names`/`player_attributes` (2026-07-12, see Sections 3-5 for what it settled). Fully resolved — nothing outstanding here.
2. Ingestion — loader script per Section 3 mapping (once done in Claude Code)
3. API routes — reuse existing generic routes; confirm no NBA-specific route needed
4. Frontend — resolve Section 8's round-expand question before writing any registry changes
5. Admin — Team management (reuse pattern) + Awards entry (depends on Section 4)
6. Images — team logos + portraits (source TBD)
7. Verification pass — same checklist style as Premier League ingestion doc
