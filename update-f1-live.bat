@echo off
REM update-f1-live.bat
REM Chains scrape.js (fetch + parse to JSON) -> load.js (JSON to Postgres).
REM Current season only. Bump the year below each January.
REM
REM Test manually first by double-clicking this file before putting it in
REM Task Scheduler -- same rule you already follow for the football .bat.

echo === F1 live update: %date% %time% ===

echo.
echo --- Step 1: scrape.js (formula1.com -^> JSON) ---
cd /d "C:\DATA\RANKKS APP\rankks-scrap"
node scrape.js 2026 2026
if errorlevel 1 (
  echo scrape.js FAILED - aborting before touching the database.
  exit /b 1
)

echo.
echo --- Step 2: load.js (JSON -^> Postgres) ---
cd /d "C:\DATA\RANKKS APP\f1-loader"

REM TODO: fill in your real connection string below, then delete this line.
set DATABASE_URL=postgres://postgres:rankks123@localhost:5432/rankks

node load.js 2026 2026
if errorlevel 1 (
  echo load.js FAILED - check output above.
  exit /b 1
)

echo.
echo === F1 live update complete: %date% %time% ===