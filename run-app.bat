@echo off
echo Starting CodeCompanion...
cd /d "%~dp0"
npm run rebuild
npm start 