# RANKKS — Project Context for Claude Code

Multi-sport historical results/stats platform. Founder/sole product owner: Mohamed
Azzeddine — not a coder by trade, but strong on product/data logic (designs tables,
defines relationships, knows exactly what a field should contain and why). Comfortable
in VS Code and CMD. Database work happens in pgAdmin — Claude Code does not have
direct DB access; SQL is either run via psql if available in this environment, or
handed back to Mohamed to paste into pgAdmin.

Communicate concisely and directly. Diagnose root cause before writing any fix — do
not guess variable/column names, ask for real file contents or run a query to confirm.
Do not attempt fixes before requirements are confirmed.

## Stack

- Frontend: React + Vite PWA, Zustand (`useAppStore`), CSS Modules + global `index.css` tokens
- Backend: Node.js/Express (port 3000), PostgreSQL, node-cron scheduler, pm2
- Admin: separate Vite React app (port 5174), JWT auth, two axios instances:
  `api` → `/api/admin` prefix, `publicApi` → `/api` prefix (these have been mixed up
  before — see Known Learnings)
- Frontend dev server: port 5173

## Folder structure

```
C:\DATA\RANKKS APP\
  rankks-api\          Node/Express API
  rankks-frontend\     React/Vite PWA
  rankks-admin\        React admin panel
  rankks-ingestion\    ingestion scripts (per-sport loaders)
  rankks-scrap\        scrapers
```

All three services (api/frontend/admin) launch via a single `.bat` file.
Media files are served from `rankks-api/media/`, not the frontend's `public/`.
Ignore any file/folder with a ` - Copie` suffix — these are backups.

## Architecture philosophy

Convention over configuration. Zero per-sport code changes when adding a new sport —
the admin panel and DB drive behavior, not hardcoded branches. Single source of truth
for any repeated pattern (shared CSS classes, shared components, a registry file over
a growing switch statement).

## Core DB tables (see full spec in project docs if deeper detail needed)

sports, competitions, events, seasons, result_tabs, standings, games, entities,
entity_aliases, entity_names, entity_logos, media, region_profiles, analytics_events,
kpi_cache, iconic_moment_categories.

## Known learnings & principles — do not relitigate these

- **Verify schema before writing SQL.** Spec docs are frequently stale vs. the live
  DB. Run `SELECT column_name FROM information_schema.columns WHERE table_name = '...'`
  first, every time.
- **One confirmation at a time.** Run one query, verify actual output, then proceed.
  Never chain assumptions.
- **Structural fixes over narrow patches.** A fix should hold for all seasons/sports,
  not just the case in front of you.
- **Never trust a file save implicitly.** Use `findstr /C:"keyword" filename` (Windows)
  to verify content actually changed on disk before restarting services.
- **Year convention discipline.** Ligue 1 stores season start year
  (`year_convention='start'`); UCL stores end year. Mismatches cause silent data errors.
  Always confirm which convention a competition uses before writing date logic.
- **`pm2 restart rankks-api`** required after any backend change. Full browser tab
  close (not just refresh) required after frontend changes — Vite HMR goes stale.
- **Image paths:** `entities.image_url` stores `/media/`-prefixed paths.
  `entity_logos.logo_url` stores bare paths (no `/media/` prefix). Never hardcode
  image paths in templates — always resolve via `resolveImg(row.image_url)` or
  equivalent.
- **PostgreSQL three-valued logic:** `NOT (x OR y)` where y can be NULL silently
  excludes rows. Handle NULLs explicitly in WHERE clauses.
- **`countSql` parameter arrays** must be independent from the main query's param
  array when the counts differ — sharing arrays causes hard Postgres errors.
- **Duplicate entity prevention:** DB-level unique partial indexes + `ON CONFLICT`
  upsert. Never a JS-only in-memory cache for this.
- **`column_config` default** in the DB is `'{}'::jsonb` (an object), not an array.
  Always check `jsonb_typeof` before treating it as an array on the frontend.
- **Admin routing:** all admin routes live in one flat `admin.js`, not split into
  per-resource router files.
- **Admin axios instance bug (recurring):** admin pages must use `publicApi` for
  routes mounted publicly (`/competitions`, `/seasons/by-competition`, etc.) and the
  admin-scoped `api` only for genuinely admin-prefixed reads/writes. Getting this
  backwards causes silent 404s or wrong-sport data. New admin pages should default to
  `publicApi` for anything not admin-specific.
- **Public list route envelope:** public routes wrap payloads as `{ data: [...] }`.
  Unwrap as `r.data.data`, not `r.data`, when reading from `publicApi`.

## Verification patterns

- `findstr /C:"keyword" filename` — confirm an edit actually landed on disk
- `curl [url] -o file.json` then open in VS Code with Ctrl+F — inspect API responses
  (do not pipe minified JSON directly in CMD; long lines break)
- Staged builds only: schema confirmed → API routes → UI. Never skip a confirmation
  step to save time.

## File delivery preference

Complete replacement files, never diffs or partial patches, unless working directly
in this repo via Claude Code (in which case direct edits are fine — this preference
was for the claude.ai chat workflow where Mohamed had to download and overwrite
manually).

## New sport onboarding

Adding a new sport follows a fixed intake-then-build process — see
`onboarding-[sport-slug].md` in the project root if present for the current sport's
filled-out spec (navigation architecture, field mapping, schema deltas, admin fields,
image paths, template reuse). Build order once that doc is filled: schema → ingestion
→ API routes → frontend → admin → images → verification pass. Do not start the build
before that doc is confirmed complete.

## Current active work (update this section as it changes)

NBA/Basketball module — see onboarding doc for full navigation architecture (6 Line A
events + Iconic Moments shared gallery), NBA data sources (Kaggle
eoinamoore/historical-nba-data-and-player-box-scores, sumitrodatta/nba-aba-baa-stats
for awards), and the open `award_results` table question pending CSV review.