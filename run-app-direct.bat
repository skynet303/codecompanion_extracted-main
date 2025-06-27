@echo off
echo Starting CodeCompanion with direct paths...
cd /d "%~dp0"

echo Rebuilding native modules for Windows...
"C:\Program Files\nodejs\npm.cmd" run rebuild

echo.
echo Launching CodeCompanion...
"C:\Program Files\nodejs\npm.cmd" start

pause 