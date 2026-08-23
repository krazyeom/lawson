#!/bin/bash
set -e

echo "🗑️  Deleting Lawson from PM2..."
pm2 delete lawson 2>/dev/null || echo "⚠️  Lawson is not in PM2 process list"
echo "✅ Lawson removed from PM2"
