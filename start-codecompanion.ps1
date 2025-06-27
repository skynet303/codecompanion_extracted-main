# CodeCompanion Launcher Script
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   CodeCompanion Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Add Node.js and Git to PATH
$env:Path = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;" + $env:Path

# Verify installations
Write-Host "Checking dependencies..." -ForegroundColor Yellow
Write-Host "Node.js: " -NoNewline
node --version
Write-Host "npm: " -NoNewline
npm --version
Write-Host "Git: " -NoNewline
git --version

Write-Host ""
Write-Host "Starting CodeCompanion..." -ForegroundColor Green
Write-Host "The app window should open shortly." -ForegroundColor Yellow
Write-Host "Look for the CodeCompanion icon in your taskbar!" -ForegroundColor Yellow
Write-Host ""

# Start the app
npm start 