@echo off
echo ================================
echo  RANKKS — Starting API Server
echo ================================
echo.

REM Check Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Download from: https://nodejs.org
    pause
    exit /b 1
)

echo Node.js found:
node --version

REM Install dependencies if needed
if not exist node_modules (
    echo.
    echo Installing dependencies...
    npm install
)

REM Copy .env.example to .env if .env doesn't exist
if not exist .env (
    echo.
    echo Creating .env file from template...
    copy .env.example .env
)

echo.
echo Starting RANKKS API...
echo Open browser at: http://localhost:3000/health
echo Press Ctrl+C to stop
echo.
npm run dev
