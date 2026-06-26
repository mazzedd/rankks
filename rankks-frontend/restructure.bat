@echo off
REM RANKKS frontend restructure — CMD version, no bash required.
REM Run this from rankks-frontend root (the folder containing src\).
REM Uses git mv throughout so git tracks these as renames, not delete+add.
REM
REM This script does NOT touch any "- Copie" files, trash\, or
REM EventBlock_fixed.jsx beyond deleting the two confirmed-dead items below.

setlocal enabledelayedexpansion

echo === Checking we're in the right place ===
if not exist src\components (
  echo ERROR: src\components not found. Run this from rankks-frontend root.
  exit /b 1
)

cd src\components

echo.
echo === 1. Layout group ===
mkdir layout
git mv ShortcutBar\ShortcutBar.jsx        layout\ShortcutBar.jsx
git mv ShortcutBar\ShortcutBar.module.css layout\ShortcutBar.module.css
git mv MainNav\MainNav.jsx                layout\MainNav.jsx
git mv MainNav\MainNav.module.css         layout\MainNav.module.css
git mv Sidebar\Sidebar.jsx                layout\Sidebar.jsx
git mv Sidebar\Sidebar.module.css         layout\Sidebar.module.css
git mv Footer\Footer.jsx                  layout\Footer.jsx
git mv Footer\Footer.css                  layout\Footer.css
rmdir ShortcutBar
rmdir MainNav
rmdir Sidebar
rmdir Footer

echo.
echo === 2. Navigation group ===
mkdir navigation
git mv LineA\LineA.jsx                      navigation\LineA.jsx
git mv LineA\LineA.module.css               navigation\LineA.module.css
git mv LineB\LineB.jsx                      navigation\LineB.jsx
git mv LineB\LineB.module.css               navigation\LineB.module.css
git mv YearSelector\YearSelector.jsx        navigation\YearSelector.jsx
git mv YearSelector\YearSelector.module.css navigation\YearSelector.module.css
rmdir LineA
rmdir LineB
rmdir YearSelector

echo.
echo === 3. Templates - typology subfolders + rename ===
mkdir templates\standings
mkdir templates\game
mkdir templates\players
mkdir templates\media

git mv templates\StandingsTemplate.jsx          templates\standings\standings_template.jsx
git mv templates\StandingsTemplate.module.css   templates\standings\standings_template.module.css

git mv templates\GameTemplate.jsx               templates\game\game_template.jsx
git mv templates\GameTemplate.module.css        templates\game\game_template.module.css
git mv templates\TennisDrawTemplate.jsx         templates\game\tennis_draw_template.jsx
git mv templates\TennisDrawTemplate.module.css  templates\game\tennis_draw_template.module.css

git mv templates\ScorersTemplate.jsx              templates\players\players_template.jsx
git mv templates\ScorersTemplate.module.css       templates\players\players_template.module.css
git mv templates\TennisPlayersTemplate.jsx        templates\players\tennis_players_template.jsx
git mv templates\TennisPlayersTemplate.module.css templates\players\tennis_players_template.module.css

git mv templates\IconicMomentsTemplate.jsx        templates\media\iconic_moments_template.jsx
git mv templates\IconicMomentsTemplate.module.css templates\media\iconic_moments_template.module.css

echo.
echo === 4. Remove confirmed-dead code (zero imports found anywhere) ===
git rm -r -f templates\trash
git rm -f EventBlock\EventBlock_fixed.jsx

cd ..\..

echo.
echo === Move complete. git status should now show a list of "renamed:" entries. ===
echo.
echo Next steps:
echo 1. Run: git status
echo    Confirm you see "renamed:" lines, not deleted+untracked pairs.
echo 2. Copy in the content-changed files from the unzipped folder Claude gave you:
echo    - src\components\ContentArea\ContentArea.jsx
echo    - src\App.jsx
echo    - src\index.css
echo    - src\components\templates\registry.js                          (NEW FILE)
echo    - src\components\navigation\navigation.module.css                (NEW FILE)
echo    - src\components\navigation\LineA.module.css
echo    - src\components\navigation\LineB.module.css
echo    - src\components\templates\players\players.module.css            (NEW FILE)
echo    - src\components\templates\players\players_template.module.css
echo    - src\components\templates\players\tennis_players_template.module.css
echo    - src\components\templates\game\game_template.jsx
echo    - src\components\templates\game\game_template.module.css
echo    - src\components\templates\game\tennis_draw_template.jsx
echo    - src\components\templates\game\tennis_draw_template.module.css
echo    - src\components\templates\media\iconic_moments_template.module.css
echo    - src\components\templates\standings\standings_template.jsx
echo    - src\components\templates\players\players_template.jsx
echo    - src\components\templates\players\tennis_players_template.jsx
echo    - src\components\templates\media\iconic_moments_template.jsx
echo 3. npm run dev   and click through every tab type.
echo 4. git add -A ^&^& git commit -m "Restructure: typology templates, layout/navigation groups, lazy registry"
echo 5. save-stable.bat

endlocal