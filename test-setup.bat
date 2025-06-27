@echo off
echo Testing Node.js installation...
echo.

node --version
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo.
npm --version
if %errorlevel% neq 0 (
    echo ERROR: npm is not installed or not in PATH
    pause
    exit /b 1
)

echo.
echo SUCCESS: Node.js and npm are properly installed!
echo You can now run the app using run-app.bat
pause 