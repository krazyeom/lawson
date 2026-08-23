#!/bin/bash
set -e

echo "🔴 Stopping Lawson..."
pm2 stop lawson 2>/dev/null || echo "⚠️  Lawson is not running"
echo "✅ Lawson stopped"
pm2 status lawson 2>/dev/null || true
