#!/bin/bash

# Simple launcher for CodeCompanion on Linux
cd "$(dirname "$0")"

# Kill any existing instances
pkill -f electron 2>/dev/null
sleep 1

# Launch CodeCompanion
echo "🚀 Launching CodeCompanion v7.1.15..."
SERPER_API_KEY="00bed7d81443fad90807903e5050fd9a0a9e4228" npm start 