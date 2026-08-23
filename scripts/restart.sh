#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔄 Restarting Lawson..."
echo "📁 Project: $PROJECT_DIR"

cd "$PROJECT_DIR"

echo "📦 Building..."
npm run build

echo "🔄 Restarting PM2 process..."
pm2 restart lawson 2>/dev/null || pm2 start ecosystem.config.js

echo "✅ Lawson restarted on port 29696"
pm2 status lawson
