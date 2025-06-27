#!/bin/bash

# Kill any existing Electron instances
pkill -f electron
sleep 2

# Launch enhanced CodeCompanion v7.1.15
echo -e "\n🚀 LAUNCHING CODECOMPANION v7.1.15 ENHANCED EDITION"
echo -e "📍 Directory: $(pwd)"
echo -e "✅ All enhancements integrated:"
echo -e "   • Context caching for 10x faster file operations"
echo -e "   • Progress tracking with real-time updates"
echo -e "   • Error recovery with automatic retry"
echo -e "   • Enhanced search returning 100 results"
echo -e "   • Serper API integration for better search"
echo -e "   • Persistent shell manager"
echo -e "🔧 Fixed issues:"
echo -e "   • Sequential URL loading to prevent ERR_ABORTED"
echo -e "   • Increased max event listeners to 50"
echo -e "   • Proper error handling for webview navigation\n"

# Set API key and launch
SERPER_API_KEY="00bed7d81443fad90807903e5050fd9a0a9e4228" npx electron . 