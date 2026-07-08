#!/bin/bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/myhistree}"
HOSTNAME=$(hostname -s 2>/dev/null || echo "unknown")

echo "[deploy] Starting on $HOSTNAME ($DEPLOY_DIR) ..."
cd "$DEPLOY_DIR"

echo "[deploy] Fetching latest code..."
git fetch origin
echo "[deploy] Resetting to origin/main..."
git reset --hard origin/main

echo "[deploy] Building TypeScript..."
npm run build

echo "[deploy] Rebuilding Docker image..."
docker compose build

echo "[deploy] Recreating container..."
docker compose up -d --force-recreate

echo "[deploy] Done on $HOSTNAME. Live commit: $(git rev-parse --short HEAD)"
