#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🚀 Starting Lawson..."
echo "📁 Project: $PROJECT_DIR"

cd "$PROJECT_DIR"

echo "📦 Building..."
npm run build

echo "🟢 Starting with PM2..."
pm2 start ecosystem.config.js

echo "✅ Lawson is running on port 29696"
pm2 status lawson
