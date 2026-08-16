# RANKKS — New Sport Onboarding: MotoGP / Moto2 / Moto3

Status: **SCHEMA RESOLVED, ready for ingestion.** Navigation, table layout, category lineage,
data-source shape, and now the schema itself have all been worked through against the actual
live DB/API (not guessed) — including two wrong guesses caught and corrected along the way
(assumed sport slug `motorcycle`, actually `moto-racing`; assumed `event_categories` meant a
tennis-style multi-competition grouping, actually 1:1 with the competition like F1's own row).
See Section 4 for the real, already-applied migration.

---

## 0. Quick Reference

| Field | Value |
|---|---|
| Sport name / slug | "Moto Racing" / `moto-racing` — **already existed in the DB** (`sports.id 5`, `display_pattern 'AB'`, same as `car-racing`), confirmed live rather than assumed. `motogp` is the competition slug within it, not the sport slug. Rider media storage path is `/media/athletes/motorcycle/...` per explicit instruction — a separate, independent naming choice from the `moto-racing` sport slug, not a mismatch to fix. See Sections 1 and 6. |
| Competition | `competitions.id 4829`, name "MotoGP World Championship", slug `motogp`, `category_id 1214` (new `event_categories` row, 1:1 with this competition, mirrors F1's own row exactly) |
| display_pattern | F1-shaped (Final Standings + GP-by-round), not the football/tennis tab_group system — see Section 1 |
| `seasons` category dimension | **Pending live schema check.** Working plan: a `category` column on `seasons` (values `motogp`/`moto2`/`moto3`), sibling to tennis's `gender`, so all three classes share one `competitions` row and one GP calendar. Not yet run against the live table. |
| Gender model | Single (no female category observed anywhere in the scraped data, 1949-2026) |
| Data source type | **Live public JSON API** — `api.pulselive.motogp.com` (the same API motogp.com's own results pages call client-side). Not a static bulk dataset like NBA's Kaggle CSVs — this needs re-fetching for the current season, same caching split as the F1 scraper (past seasons cached forever, current season never cached). |
| Primary data source | `api.pulselive.motogp.com/motogp/v1/results/*` + `/motogp/v1/riders/{id}` for bios. No API key required. |
| Historical range available | Confirmed 1949-2026, 78 seasons, via the season list endpoint. |
| Target launch range | Full history, 1949-2026 (matches the scraper already built and spot-validated — see Section 2). |

---

## 1. Navigation Architecture

**Locked in this session**, after two false starts (tennis-style separate competitions was
rejected — fragments a rider's career across category boundaries; a 3rd "Line C" nav row
was considered and rejected in favor of folding category into Line B):

- **One competition** ("MotoGP World Championship" or similar), not three — a rider's
  Moto3 → Moto2 → MotoGP career must aggregate under one `competitions.id` for the "Totals"
  view, the same reason tennis uses `gender`/`sub_edition` on `seasons` instead of separate
  competitions per Grand Slam.
- **Line A** — exactly F1's existing shape, reused unmodified: "Final Standings" + one tab
  per GP in round order, Iconic Moments + Totals pinned right. Line A never changes when
  category changes.
- **Line B** — an expandable category pill (`Moto GP ▽`) prepended to the front, followed by
  the normal category-scoped sub-tabs: Riders / Teams / Constructors under Final Standings,
  or the session list (FP1/FP2/PR/Q1/Q2/Sprint/Warm Up/Race — read off the API, never
  hardcoded, exactly like F1's session discovery) under a GP.
- **Switching category via the Line B pill preserves whichever Line A tab is active** — if
  you're on 2012 / Final Standings / Moto GP and click Moto 2, you land on 2012 / Final
  Standings / Moto 2, never reset to a default. Same rule F1ContentArea already applies to
  year changes; this is the identical mechanism, keyed on category instead of year.
- Explicitly named as a **generic pattern**, not MotoGP-specific — any future sport with the
  same "shared calendar, N parallel classes" shape (the category pill + preserved Line A
  position) should reuse this, not reinvent it.
- Table layout **reuses F1's exact templates**, not a new design (mockup-validated against
  real 2026 German GP data — see Section 8 for the precise column mapping).

---

## 2. Data Source Inventory

`api.pulselive.motogp.com` — confirmed via the site's own client-side network calls, not
reverse-engineered from HTML. No auth/API key needed. Endpoints actually used by the scraper
(`rankks-scrap/motogp-scraper/`):

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /motogp/v1/results/seasons` | All 78 seasons (`{id, year, current}`) | |
| `GET /motogp/v1/results/events?seasonUuid=` | All events (GPs) for a season, incl. `test:true` pre-season tests (filtered out) and `status` (FINISHED/NOT-STARTED) | |
| `GET /motogp/v1/results/categories?eventUuid=` | Categories that raced at that specific event (varies by era — see Section 3 lineage table) | |
| `GET /motogp/v1/results/sessions?eventUuid=&categoryUuid=` | Every session for that event+category, with `type` (FP/PR/Q/SPR/WUP/RAC), `number`, `date`, weather `condition`, `status` | Self-describing — 1949 events have just one `RAC` session, 2026 events have up to 8. Never hardcode the session list. |
| `GET /motogp/v1/results/session/{id}/classification` | Full classification for that session — position, rider, team, constructor, time/gap/points (race-shaped) or best_lap/top_speed (practice-shaped) | Shape differs by session type; store as-is, let the loader branch on it. |
| `GET /motogp/v1/results/standings?seasonUuid=&categoryUuid=` | Season-long riders' championship standings — points, race_wins, podiums, sprint_wins, sprint_podiums, last 3 round positions | **Not yet in the scraper** — discovered while building the nav mockup (Section 8). Needed for the Final Standings page; add to scrape.js before the loader is written. |
| `GET /motogp/v1/riders/{riderUuid}` | Rider bio: `birth_date`, `birth_city`, `country`, `physical_attributes.{height,weight}`, `retired`/`retired_year`, `start_year`, `career[]` (per-season team/category/number history), biography text (6 languages), portrait photo, social links | **No `death_date` field at all** — confirmed against Harold Daniell (born 1909, raced 1949-1950): the API returns `years_old: 116`, i.e. it computes age from `birth_date` to *today* with no awareness the rider died decades ago. See Section 5 — this is a real gap, not an oversight in reading the response. |

Rider UUIDs are harvested for free from every classification/standings row already scraped —
no separate "riders list" endpoint is needed; the bio-fetch pass just dedupes the UUIDs seen
across all scraped files and fetches each rider once.

**Scraper status**: `rankks-scrap/motogp-scraper/` is built and validated (spot-checked
1949, 2015, full 2026). Raw JSON only, does not touch Postgres — same two-step convention as
the existing F1 scraper. Full 1949-2026 run not yet executed (estimated ~25-30k requests,
3.5-4.5 hours at a polite 500ms delay) — pending your go-ahead.

---

## 3. Category Lineage (critical — corrects an early scoping mistake this session)

Only three continuous lineages are in scope, confirmed against the live API across
1949/1950/1951/1955/1965/1975/1985/1995/2005/2009/2010/2011/2012/2013/2026:

| RANKKS category | Era 1 | Era 2 | Same category id across the switch? |
|---|---|---|---|
| `motogp` | 500cc, 1949-2001 (legacy_id 3) | MotoGP, 2002-present (legacy_id 3) | **Yes** — one continuous category UUID the whole way. |
| `moto2` | 250cc, 1949-2009 (legacy_id 5) | Moto2, 2010-present (legacy_id 2) | **No** — the 2010 launch got a brand-new category id/legacy_id. Both matched into one `moto2` output folder. |
| `moto3` | 125cc, 1949-2011 (legacy_id 10) | Moto3, 2012-present (legacy_id 1) | **No** — same situation; 125cc actually ran two more years alongside Moto2 (2010-2011) before Moto3 replaced it in 2012. Both matched into one `moto3` output folder. |

Explicitly excluded (historical classes with no modern lineage): 350cc (~1949-1975), 50cc,
80cc, sidecars.

This is not just an ingestion detail — it means the "Totals"/all-time view for Moto2
legitimately includes riders who only ever raced 250cc and retired before 2010, and same for
Moto3/125cc. Worth confirming that's the intended product meaning (it matches how the sport
itself talks about these lineages, per your own note: "Moto 2 (actual), 1st year 1949, 1949-2009: 250cc, since 2010: Moto2").

---

## 4. Schema Requirements — **RESOLVED and applied to the live DB**

Verified against real `information_schema.columns`/`pg_constraint` output at every step, with
two wrong initial guesses caught and corrected before anything was run (see Section 10).

**No new `sports` row** — `Moto Racing` already existed (`id 5`, slug `moto-racing`,
`display_pattern 'AB'`, same as `car-racing`). Confirmed both `event_categories` and
`competitions` had nothing yet for `sport_id 5` before creating either.

**Applied migration:**

```sql
WITH new_category AS (
  INSERT INTO event_categories (sport_id, canonical_name, short_name, slug, level, gender, founded_year)
  VALUES (5, 'MotoGP', 'MotoGP', 'motogp', 'world', 'M', 1949)
  RETURNING id
)
INSERT INTO competitions (category_id, name, slug, year_convention, gender, is_default, display_order)
SELECT id, 'MotoGP World Championship', 'motogp', 'end', 'M', true, 0
FROM new_category
RETURNING id, name, slug, category_id;
-- -> competitions.id 4829, event_categories.id 1214

ALTER TABLE seasons ADD COLUMN category character varying;
ALTER TABLE seasons DROP CONSTRAINT seasons_competition_id_event_id_year_gender_sub_edition_key;
ALTER TABLE seasons ADD CONSTRAINT seasons_competition_id_event_id_year_gender_sub_edition_category_key
  UNIQUE (competition_id, event_id, year, gender, sub_edition, category);
-- (constraint name silently truncated to 63 chars by Postgres — harmless NOTICE, not an error)
```

Result: **one** `competitions` row (`id 4829`) covers MotoGP/Moto2/Moto3 — a rider's career
across all three classes aggregates under this single `competition_id`, no cross-competition
stitching needed for Totals. Per year, **three** `seasons` rows will be inserted at ingestion
time, all sharing `competition_id 4829`, `gender 'M'`, `sub_edition 1` (constant — not the
differentiator), varying only by the new `category` column (`motogp`/`moto2`/`moto3`).
`event_id` stays `NULL` on all of them — MotoGP doesn't use the generic `events`-table Line A
mechanism (that's the NBA/tennis pattern), it uses the F1-shaped bespoke content area instead
(Section 8).

Deliberately **no CHECK constraint** on `seasons.category` restricting it to these three
values — per Section 1, this column is meant to be reusable by any future "shared calendar,
parallel classes" sport, not MotoGP-specific.

`standings.stats` is `jsonb` — confirmed no schema change needed for Final Standings
(race_wins/podiums/sprint_wins/sprint_podiums slot straight in, same as every other sport's
free-form stats). `standings.group_name` exists but is not needed here — each category's own
`seasons` row scopes its own `result_tabs`/`standings` independently, no extra differentiator
required on the `standings` side.

**Still open, deferred to the ingestion step**: whether GP session results (Race/Sprint/
Qualifying/Practice) reuse a generic `games`-shaped table or need their own
`motogp_sessions`/`motogp_session_results` pair (F1's own precedent uses dedicated
`f1_`-prefixed tables, not the generic `games` table) — not checked yet, do this before
writing the loader.

---

## 5. Entity & Filter Fields — athlete-level data (confirmed against the live API)

| Field | Available from source? | Notes |
|---|---|---|
| Country | **Yes** — both on every classification row (`rider.country.{iso,name}`) and on the rider bio endpoint (`country.{iso,name,flag}`, plus a ready-made flag SVG URL) | No gap, unlike NBA which had to backfill this via Wikidata. |
| Birth date | **Yes** — `birth_date` on the rider bio endpoint (`/motogp/v1/riders/{id}`) | Confirmed present for both a 2026 active rider (Marc Marquez, 1993-02-17) and a 1949-era retired rider (Harold Daniell, 1909-10-20). |
| **Death date** | **No — confirmed gap.** | The rider bio endpoint has no `death_date` field at all. Verified directly: Harold Daniell (raced 1949-1950, actually died in 1990) returns `years_old: 116` — the API is computing live age from `birth_date` with zero awareness the rider is deceased. This will produce wrong/absurd ages for any pre-1990s-ish rider unless backfilled separately. **Same shape of gap as NBA's missing player nationality** — recommend the same fix: a Wikidata backfill pass (`death_date` by matching rider name + birth_date + nationality), analogous to `backfill-nba-player-bio.js`. Frontend already has the machinery for this (`calcAge(birthDate, refDate, deathDate)` already supports a death date, used by every F1 template) — this is purely a data-sourcing gap, not a frontend gap. |
| Height / Weight | **Partial.** Present for modern riders (`physical_attributes.{height,weight}`, e.g. Marquez 169cm/64kg) | Null for historical riders (confirmed on Daniell). Same "sparse for older eras" shape as F1/NBA — don't backfill unless requested, matches existing precedent of tolerating nulls for old eras rather than blocking on 100% coverage. |
| Retired flag / year | **Yes** — `retired` (bool), `retired_year` | |
| Team + Constructor (F1's "Engine" equivalent) | **Yes**, already split into two fields on every classification/standings row — `team.name` (e.g. "Ducati Lenovo Team") and `constructor.name` (e.g. "Ducati") | Exact same two-field shape as F1's Team/Engine split — no data-mapping gap. Constructor label replaces "Engine:" in the UI per your instruction (Section 8). |
| Rider number, nickname/short_nickname | **Yes** | `number` on classification rows, `nickname`/`short_nickname` (e.g. "MM93") on the bio endpoint. |
| Portrait photo | **Yes** — `pictures.profile.main` on the per-season career entry, plus a separate `biography.media.picture` | Real CDN URLs (`photos.motogp.com`), same "resolve or fall back to silhouette" pattern as every other sport. |

**Rider portraits — deferred.** Downloaded 216 available source images (of 2,539 riders),
but they turned out to be unoptimized full-body cutout photos (some 5-6MB each, 393MB total)
where the face is a small fraction of the frame — a naive top-crop doesn't reliably isolate
just the face across the varying photo styles (tall PNG cutouts vs wide JPG press shots), and
proper face detection was out of scope for this pass. Punted entirely — production fallback
is `AthleteAvatar`'s existing `fallback="letter"` prop (40x40 rounded-square, first initial,
`.avatar-placeholder` in `index.css`), same as F1/basketball/tennis already use, confirmed by
reading `AthleteAvatar.jsx` directly rather than guessing. `entities.image_url` stays null for
effectively every rider until a proper face-cropped image source is found.

**Death date — done.** `rankks-ingestion/backfill-motogp-rider-death.js`, matched by name
against Wikidata occupation `Q3014296` ("motorcycle racer", confirmed via SPARQL against our
own Umberto Masetti entity, not guessed). 249 of 2,541 riders filled (the rest are either
still alive or have no Wikidata page at all — expected, not a gap). One real bug caught and
fixed: a MotoGP rider named "Pedro Rodriguez" (born 1994 per source data) initially matched
the famous 1940-1971 F1/sports-car racer of the same name, who apparently also carries a
"motorcycle racer" tag on Wikidata — occupation filtering alone wasn't precise enough. Fixed
with a chronological sanity check (reject any match whose death date precedes the rider's
own already-known birth date) — cheap, high-confidence, and now guards every future re-run.

---

## 6. Media & Image Paths

| Asset type | Source | RANKKS storage path |
|---|---|---|
| Rider portrait | `photos.motogp.com/riders/.../profile/main-*.png` (from the bio/career endpoint) — real CDN, licensed to Dorna/motogp.com, same "unlicensed but publicly served" caveat as NBA's headshot CDN; confirm usage terms before launch same as that precedent. | **`/media/athletes/motorcycle/male/profile/{slug}.png`** — confirmed convention, mirrors NBA's `/media/athletes/basketball/male/profile/{slug}.png` exactly (single-gender sport, same "male" segment kept for asset-organization consistency even though it's not in `GENDERED_SPORTS` for fallback-silhouette purposes — see NBA onboarding doc Section 6). Resolve via `entities.image_url`/`resolveImg()` per the usual rule — never hardcode this path in a template. |
| Country flag | `photos.motogp.com/countries/flags/iso2/{ISO}.svg` | Ready-made, no need for RANKKS's own flag asset for MotoGP specifically if this URL pattern is deemed acceptable to hotlink — otherwise reuse the existing shared `Flag` component/asset set as every other sport does. |
| Team logo/livery | `team.picture` / `team.background_picture` on classification rows | Per-season (teams change livery/sponsor yearly) — needs an era-aware storage approach, same concept as F1's `competition_logos` per-year override, not a single static team logo. |
| Constructor | No logo field observed | Text-only (Ducati/Aprilia/KTM/Honda/Yamaha) unless a manual logo set is built, same as any manufacturer-badge asset elsewhere in the app. |

---

## 7. Admin Panel Additions

- [ ] Category selector on whatever admin screens manage MotoGP seasons/standings (parallel
      to tennis's gender selector) — depends on Section 4's schema resolution.
- [ ] Confirm `column_config` mechanism covers Final Standings' Riders/Teams/Constructors
      column sets without new admin fields (same mechanism F1/NBA already use).
- [ ] Team livery/logo per-season upload — likely a new admin affordance if Section 6's
      era-aware team logo isn't already covered by an existing pattern; confirm against
      F1's `competition_logos` admin UI before assuming new code is needed.

---

## 8. Frontend Template Assignment

Locked this session, validated against a live mockup built from real scraped 2026 German GP
data (all three categories) plus real season standings (top 6 per category).

| Page | Reuses | Columns |
|---|---|---|
| Final Standings (Riders) | `F1DriversTemplate.jsx` pattern | `Pos \| Rider (avatar + name, flag + country beneath) \| Age (age bold + birthdate beneath) \| No \| Team (logo + name, "Constructor: X" beneath) \| Wins \| Podiums (total, then W/2nd/3rd beneath) \| Poles \| Sprint \| Fast. Lap \| Points` — identical to F1's Drivers table, **"Engine:" relabeled to "Constructor:"** per your instruction. |
| GP session results (Race/Sprint/Qualifying/Practice/Warm-Up) | `F1SessionResultsTemplate.jsx` pattern | `Pos \| Rider \| Age \| No \| Team \| Time/Retired (or Time/Gap for practice) \| Laps \| Pts` (points column only on Race/Sprint) — same "Constructor:" relabel in the Team cell. |
| Final Standings (Teams/Constructors) | `F1TeamsTemplate.jsx` pattern | Not yet detailed — same exercise as Drivers, deferred until Drivers is confirmed working end to end. |
| Category switcher | **New, small, generic component** — the Line B pill described in Section 1 | Not F1-specific — reusable by any future sport with the same "N parallel classes, shared calendar" shape. |

`calcAge` needs no change — it already supports `deathDate` (currently unused by F1 since no
F1 driver data has needed it yet, but MotoGP's pre-1990s riders will exercise that code path
for the first time once Section 5's death-date gap is backfilled).

---

## 9. Page Titles & Subtitles

Expected to follow F1ContentArea's existing breadcrumb construction (`Year I Line A label I
Line B label`) with no new logic — the category pill's current selection feeds into the
existing Line B label slot. Confirm once the first category/GP page is live.

---

## 10. Known Edge Cases / Open Decisions Log

| Edge case | Applies? | Decision |
|---|---|---|
| Rider career spans multiple categories (Moto3 → Moto2 → MotoGP) | Yes, this was the core design driver | One competition, category as a `seasons`-level dimension, so Totals aggregates across all three without cross-competition stitching. See Section 1. |
| Category rename got a new category id (Moto2/Moto3) vs. kept the same id (MotoGP) | Yes | Matched by a small legacy_id lookup table per RANKKS category, not by name string or a single UUID — see Section 3. |
| Death date missing from source entirely | Yes, confirmed | Real gap, not yet backfilled. Recommend Wikidata pass, same precedent as NBA's nationality gap. `calcAge` already supports it once sourced. See Section 5. |
| `seasons` schema for the category dimension | **Resolved and applied** | New nullable `seasons.category` column, folded into the real unique constraint. See Section 4. |
| Sport slug guessed as `motorcycle` | **Wrong guess, corrected** | Real slug is `moto-racing` — the sport row already existed in the DB (`id 5`), never checked before assuming. Caught before any INSERT was written. |
| `event_categories` meaning guessed as a tennis-style multi-competition grouping | **Wrong guess, corrected** | Confirmed via FK lookup + `SELECT *` that it's usually 1:1 with a competition (Ligue 1, Premier League, and critically F1's own row) — the multi-competition grouping behavior only applies to tennis's "Grand Slam" row. MotoGP got its own 1:1 row, matching F1's precedent, not tennis's. |
| Full 1949-2026 scrape | Built, spot-validated, not yet run in full | ~25-30k requests, 3.5-4.5 hours. Awaiting go-ahead. |
| Season-long standings endpoint | Found late (while mockup-building), not yet in `scrape.js` | Add `GET /motogp/v1/results/standings?seasonUuid=&categoryUuid=` to the scraper before the loader is written. |
| Table column layout | **Resolved** | Reuse F1's exact Drivers/SessionResults column sets, "Engine" → "Constructor". See Section 8. |
| Nav shape (Line A/B + category) | **Resolved** | Category pill prepended to Line B, preserves Line A position across category switches. See Section 1. |

---

## 11. Frontend Build — done, tested live in browser

- `MotoGPCategoryPill.jsx`/`.module.css` — generic Line B category switcher (Section 1),
  reusable by any future "shared calendar, parallel classes" sport, not MotoGP-specific.
- `MotoGPContentArea.jsx` — mirrors `F1ContentArea.jsx`'s Line A/B shape exactly, category
  pill prepended to Line B. Reuses `templates/f1/f1.module.css` directly (generic table
  styling, nothing F1-branded in it).
- `MotoGPRidersTemplate.jsx` / `MotoGPSessionResultsTemplate.jsx` — F1-pattern columns,
  "Constructor:" relabel, `fallback="letter"` on `AthleteAvatar` (Section 5/6).
- `rankks-api/src/routes/motogp.js` — mirrors `f1.js`, `?category=` param on every
  season-scoped route since MotoGP (unlike F1) has 3 season rows per year.
- **Structural correction mid-build**: MotoGP does NOT get its own top-nav sport tab. It
  lives inside the existing "Racing" sport (`car-racing`, `sports.id 4`) alongside Formula 1,
  reached via the sidebar competition list — same pattern football uses for multiple
  leagues. Required moving `event_categories.id 1214`'s `sport_id` from the placeholder
  `moto-racing` sport (which was reverted back to `is_active=false`) to `car-racing`, and
  setting `competitions.is_default=false` on the MotoGP row so F1 stays the sport's default
  competition (MotoGP reached via explicit sidebar click, not auto-selected).
- **Two real bugs caught during live testing, not just cosmetic**:
  1. Missing `.area`/`.content` wrapper CSS (`width:100%; min-width:0`) — without it, the
     Line A GP-tab row and results table blew out the page to 4213px wide instead of
     scrolling internally. Fixed by mirroring `F1ContentArea.module.css` exactly.
  2. `display_order` fallback (99) was hit by **1,906 of 8,733 sessions**, not just the rare
     red-flag-restart edge case that surfaced it — historical eras used session-type codes
     (`P1-3`, `QP1/2`, `FP3/FP4`) the original F1-derived map never accounted for. Fixed with
     a fuller `BASE_ORDER`/`TYPE_ORDER` map in `ingest-motogp.js`, then re-applied to every
     existing row (4,096 corrected). One single session (`TTS`, 1 occurrence, meaning
     unconfirmed) still falls to 99 — negligible, not investigated further.
- Verified live: category switch preserves Line A position exactly as designed (GP stays
  selected, session stays selected where it still exists), real 2026 standings/race data
  renders correctly, session ordering correct for both modern and historical vocabularies.
- **Not built yet**: Iconic Moments, All-Time, rider portraits (deferred, Section 6),
  Teams/Constructors standings use a plain shared table component rather than a dedicated
  template (parity with Riders deferred until requested).

## 12. Event Blocks — done, tested live in browser

`MotoGPEventBlock.jsx` — mirrors `F1EventBlock.jsx`'s three-block shape (Championship/
Teams/GP), same shared `EventBlock.module.css`, same `StatusBadge`/`Flag`/`AthleteAvatar`
building blocks. One category-driven difference throughout: since MotoGP/Moto2/Moto3 share
one competition row, every block shows the active class as a real label in `categoryRow`
(`MOTO GP`/`MOTO 2`/`MOTO 3`) — F1 drops that row entirely since it only ever has one class.

- **`MotoGPChampionshipBlock`** (Final Standings > Riders) — rider-focused, career stat bloc
  (Seasons/Champion/Wins/Podiums/Sprint Wins/Sprint Podiums — the exact 4-metric field set
  `motogp_rider_standings` itself stores; there is no `poles` column in this schema, unlike
  F1, so the bloc never claims one). Backed by two new API routes:
  - `GET /api/motogp/rider-career/:entityId?category=&throughYear=` — career totals through
    a year, scoped to one class lineage. Same "championships" guard as F1's
    `/driver-career`: a season only counts once every round on the shared calendar for that
    year has actually been raced (`NOT EXISTS` on any `motogp_grands_prix` row with
    `event_date_start > CURRENT_DATE`), so an in-progress season's points leader isn't
    credited with a title before it's decided.
  - Season-context fields (`season_status`/`season_start_date`/`season_end_date`/`edition`/
    `riders_count`/`teams_count`) added to all three `/standings/:seasonId/*` routes via a
    shared `getSeasonContext()` helper in `motogp.js` — computed live from
    `motogp_grands_prix` joined through `motogp_sessions.category`, never read from
    `seasons.status` (confirmed stale/unmaintained via direct query, same as F1's own
    `f1_seasons` has no status column by design).
- **`MotoGPTeamsBlock`** (Final Standings > Teams or Constructors, `type` prop switches
  between them) — deliberately **leaner** than `F1TeamsChampionshipBlock`:
  `motogp_team_standings`/`motogp_constructor_standings` are text-only (name/position/points,
  no `entity_id`, no logo, no wins/podiums breakdown at all), so there is no career stat bloc
  and no portrait — just the leader's name + this season's points, plus the same
  Schedule/Edition/Riders/Teams bottom bar. Same "leaner variant when the data doesn't
  support the richer one" precedent as `F1AllTimeBlock`.
- **`MotoGPGPBlock`** (any GP page) — race-focused, winner always the main `RAC` session's
  P1 result regardless of active Line B session tab (matches F1GPBlock convention). Stat
  bloc badges show this-round's own delta (fetched twice — through this round and through
  the previous one) via a new route:
  `GET /api/motogp/rider-round-stats/:entityId?year=&category=&throughRound=`. No "Laps"
  bottom-bar tile (unlike F1) — `motogp_sessions` has no session-level scheduled-laps column,
  only per-rider `laps` on results rows, so it isn't fabricated here.
- **`gp.season_id`** added to the `/gp/:slug/:year` response — `motogp_grands_prix` itself
  has no `season_id`/`category` (one shared calendar row across all three classes), so it's
  looked up separately purely to let `MotoGPGPBlock` fetch season-context fields, same
  purpose `gp.f1_season_id` serves in F1's own GP route.
- **Known data-currency caveat, not a code bug**: `season_status` currently resolves to
  `'past'` for the live 2026 season even though real-world MotoGP is still mid-season as of
  this build (2026-07-30) — the scraper only ever captured sessions for rounds that had
  already run (MotoGP's API has no classification data for a future round), so
  `motogp_grands_prix` simply has no rows yet for Aug-Nov 2026. `season_status` will resolve
  correctly once the next scrape/ingestion cycle adds those rounds — no schema or logic
  change needed, purely a "re-run the pipeline" gap.
- Portrait slots use `AthleteAvatar src={null}` everywhere (rider portraits were abandoned
  this build, Section 6) — falls through to the shared default silhouette.
  `utils/portraits.js`'s `GENDERED_SPORTS` list gained `'motorcycle'` so this resolves to the
  real uploaded `/media/default/motorcycle/portrait-{male,female}.png` assets rather than a
  404.
- Verified live for MotoGP category (Jorge Martin champion block, Marco Bezzecchi Thailand
  GP winner block, Aprilia Racing/Aprilia Teams+Constructors blocks) and confirmed category
  switch correctly reloads all three blocks with the new class's data (Moto 2 → Kalex
  Constructors leader).

## Build Order

1. ~~Schema~~ — **done.** `competitions.id 4829` / `event_categories.id 1214` created,
   `seasons.category` column + constraint applied. See Section 4.
2. ~~Scraper~~ — **done.** Full 1949-2026 scrape completed (78 seasons, 10,545 session
   classification files, 317MB, zero errors), including the standings endpoint added
   mid-session.
3. ~~Rider bio backfill~~ — **done.** 2,539/2,541 riders fetched (99.9%; 2 genuinely have no
   bio page). Death-date Wikidata pass still outstanding (Section 5) — not blocking, can run
   in parallel with ingestion.
4. Ingestion (session results) — **done.** `rankks-ingestion/ingest-motogp.js`, dedicated
   `motogp_*` tables (close to F1's own pattern, per your call). Full 1949-2026 run: 234
   season rows (78 years x 3 categories, zero gaps in any lineage), 1,079 GPs, 8,733
   sessions, **217,269 session results**, zero errors. Spot-checked 1949 (correct historical
   riders/times/constructors) and 2026 Germany (all 8 session types for MotoGP, correctly
   only 6 for Moto2/Moto3 — no Sprint/Warm Up in those classes, nothing hardcoded).
   `entity_type='driver'` reused for riders (CHECK-constrained enum, no `rider` value existed
   — confirmed live rather than guessed).
4b. Ingestion (season standings) — **done.** `rankks-ingestion/ingest-motogp-standings.js`,
   own `motogp_rider_standings` table (dedicated, like `f1_driver_standings` — not the
   generic `standings`/`result_tabs` mechanism; corrected from an earlier wrong note in this
   doc that assumed the NBA-awards pattern applied here too). Full 1949-2026 run: 6,877
   rows, zero errors. Closed the 132-rider entity gap from step 4 exactly as expected.
4c. Ingestion (team/constructor standings) — **done.** Separate `/v2/results/world-standings`
   endpoint discovered while building this — self-describing availability, no fixed rule:
   MotoGP-class team standings from 2002, MotoGP constructor from 2006, Moto2/Moto3 team
   from 2018, Moto2/Moto3 constructor from 2006. `motogp_team_standings` (553 rows) /
   `motogp_constructor_standings` (326 rows), zero errors. One real scraper bug caught and
   fixed mid-session: an early `continue` meant for the (already-cached) rider-standings
   fetch was silently skipping this whole block on every already-scraped year — a full
   backfill produced zero new files until traced and fixed (see `scrape.js` comment).
5. API routes — likely mostly reuse of existing generic routes (F1 precedent); confirm no
   MotoGP-specific route is needed beyond the category parameter.
6. Frontend — category-pill component (Section 1/8), then the two F1-pattern templates
   relabeled for Constructor.
7. Admin — category selector + team livery upload (Section 7), pending Section 4.
8. Images — rider portraits, team liveries, country flags (Section 6) — confirm usage terms
   on `photos.motogp.com` hotlinking before launch.
9. Verification pass — same checklist style as the NBA/Premier League onboarding docs.
