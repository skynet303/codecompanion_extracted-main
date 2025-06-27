@echo off
echo ========================================
echo Installing Git for Windows...
echo ========================================
echo.
echo This will download and install Git for Windows.
echo Please follow the installer prompts.
echo.
pause

REM Download Git installer
echo Downloading Git installer...
powershell -Command "Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/Git-2.47.1-64-bit.exe' -OutFile '%TEMP%\GitInstaller.exe'"

REM Run the installer
echo.
echo Starting Git installer...
echo IMPORTANT: During installation, make sure "Git from the command line and also from 3rd-party software" is selected!
"%TEMP%\GitInstaller.exe"

echo.
echo ========================================
echo After Git installation completes:
echo 1. Close this window
echo 2. Open a NEW PowerShell window
echo 3. Run: .\rebuild-and-run.ps1
echo ========================================
pause 