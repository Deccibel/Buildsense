@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe.
  echo Telecharge la version LTS sur https://nodejs.org puis relance ce fichier.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist" (
  echo Premiere installation, 1 a 2 minutes...
  call npm install
  if errorlevel 1 (
    echo L'installation a echoue. Verifie ta connexion internet puis relance.
    pause
    exit /b 1
  )
)
start "BuildSense" /min cmd /c "npm start"
