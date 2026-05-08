@echo off
echo ================================
echo  RANKKS — Data Ingestion
echo  Source: TheSportsDB
echo ================================
echo.
echo This will load 10 seasons of:
echo  - Ligue 1 (2015-2025)
echo  - Champions League (2015-2025)
echo.
echo Make sure your API server is NOT needed for this.
echo Just the database must be running.
echo.
set /p confirm=Press Enter to start, or Ctrl+C to cancel...

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo.
echo Starting ingestion...
node ingest.js
echo.
echo Done! Check pgAdmin to verify data.
pause
