Write-Host "Starting CodeCompanion..." -ForegroundColor Green
Set-Location $PSScriptRoot

Write-Host "Rebuilding native modules for Windows..." -ForegroundColor Yellow
npm run rebuild

Write-Host "Launching CodeCompanion..." -ForegroundColor Green
npm start 