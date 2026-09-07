@echo off
echo ================================
echo  RANKKS — NBA Auto Ingestion
echo  Source: TheSportsDB
echo ================================
echo.
echo This keeps running in the background and re-ingests NBA
echo standings on a daily schedule (07:00 by default).
echo.
echo Leave this window open — closing it stops the scheduler.
echo Just the database must be running.
echo.

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

echo.
echo Starting NBA scheduler...
node schedule-nba.js
