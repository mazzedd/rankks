@echo off
set /p version=Enter version name (e.g. v1-standings-fixed): 
git add -A
git commit -m "stable-%version%"
git tag stable-%version%
echo.
echo Saved as stable-%version%
pause