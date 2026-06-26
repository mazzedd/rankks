@echo off
echo ================================================
echo  RANKKS — Ligue 1 Live Update
echo  %date% %time%
echo ================================================
echo.

cd /d "C:\DATA\RANKKS APP\rankks-ingestion"

echo [1/3] Updating Ligue 1 2025 season data...
node ingest-ligue1.js all 2025
echo.

echo [2/3] Downloading new player portraits...
node download-portraits.js
echo.

echo [3/3] Done.
echo  %date% %time%
echo ================================================