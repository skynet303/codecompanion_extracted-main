@echo off
echo ========================================
echo Node.js PATH Configuration Helper
echo ========================================
echo.
echo Node.js is installed but not in your PATH.
echo.
echo To fix this permanently, you have two options:
echo.
echo OPTION 1: Restart your computer
echo   - The PATH should update after a restart
echo.
echo OPTION 2: Add to PATH manually
echo   1. Press Windows + X
echo   2. Click "System"
echo   3. Click "Advanced system settings"
echo   4. Click "Environment Variables"
echo   5. Under "System variables", find "Path" and click "Edit"
echo   6. Click "New" and add: C:\Program Files\nodejs
echo   7. Click OK on all windows
echo   8. Close and reopen PowerShell
echo.
echo ========================================
echo For now, you can use:
echo   - run-app-direct.bat (uses full paths)
echo   - fix-path-and-run.ps1 (temporary fix)
echo ========================================
pause 