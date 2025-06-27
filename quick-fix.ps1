# Add Node.js to PATH for this session
$env:Path = "C:\Program Files\nodejs;" + $env:Path

Write-Host "Quick Fix - Installing prebuilt node-pty..." -ForegroundColor Yellow

# Remove and reinstall node-pty with prebuilt binaries
npm uninstall node-pty
npm install node-pty@latest

Write-Host ""
Write-Host "Starting CodeCompanion..." -ForegroundColor Green
npm start 