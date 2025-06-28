#!/bin/bash
# Fix node-pty build issues for Electron on Linux

echo "Fixing node-pty for Electron..."

# Install electron-rebuild if not already installed
npm install @electron/rebuild --save-dev

# Rebuild native modules for current Electron version
npx electron-rebuild

echo "node-pty fix complete! You can now run 'npm start'"

# Note: If you still have issues, downgrade Electron to v22:
# npm uninstall electron @electron/rebuild electron-rebuild
# npm install --save-dev electron@22.3.27 @electron/rebuild@3.2.13 electron-rebuild@3.2.9
# npx electron-rebuild 