# Temporarily add Node.js to PATH for this session
$env:Path = "C:\Program Files\nodejs;" + $env:Path

Write-Host "Node.js has been added to PATH for this session" -ForegroundColor Green
Write-Host ""

# Verify installation
Write-Host "Node.js version: " -NoNewline
node --version

Write-Host "npm version: " -NoNewline
npm --version

Write-Host ""
Write-Host "Rebuilding native modules for Windows..." -ForegroundColor Yellow
npm run rebuild

Write-Host ""
Write-Host "Launching CodeCompanion..." -ForegroundColor Green
npm start 