# Add Node.js to PATH for this session
$env:Path = "C:\Program Files\nodejs;" + $env:Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "CodeCompanion Setup & Run Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Git is installed
Write-Host "Checking Git installation..." -ForegroundColor Yellow
try {
    git --version
    Write-Host "✓ Git is installed" -ForegroundColor Green
} catch {
    Write-Host "✗ Git is not installed. Please run install-git-and-fix.bat first!" -ForegroundColor Red
    pause
    exit
}

Write-Host ""
Write-Host "Installing @electron/rebuild package..." -ForegroundColor Yellow
npm install @electron/rebuild --save-dev

Write-Host ""
Write-Host "Rebuilding native modules for Windows..." -ForegroundColor Yellow
# Use the new @electron/rebuild package
npx electron-rebuild --force

Write-Host ""
Write-Host "Starting CodeCompanion..." -ForegroundColor Green
npm start 