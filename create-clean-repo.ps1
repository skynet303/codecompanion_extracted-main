Write-Host "Creating clean repository without node_modules..." -ForegroundColor Yellow

# Move the current .git folder
if (Test-Path ".git") {
    Write-Host "Backing up current Git repository..." -ForegroundColor Yellow
    Move-Item .git .git.backup -Force
}

# Initialize new repository
Write-Host "Initializing new Git repository..." -ForegroundColor Green
git init

# Add all files (node_modules will be excluded by .gitignore)
Write-Host "Adding files to new repository..." -ForegroundColor Green
git add .

# Commit
Write-Host "Creating initial commit..." -ForegroundColor Green
git commit -m "Initial commit - CodeCompanion v7.1.15 (clean)"

# Add remote
Write-Host "Adding remote origin..." -ForegroundColor Green
git remote add origin https://github.com/skynet303/codecompanion_extracted.git

# Push
Write-Host "Pushing to GitHub..." -ForegroundColor Green
git push -u origin main --force

Write-Host "Done! Clean repository pushed to GitHub." -ForegroundColor Green 