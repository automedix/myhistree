#!/bin/bash
# myhistree Offsite Backup → Semiotix.net (WebDAV)
# .237: täglich volles Backup (Code + DB)
# .190: täglich Code-Backup (keine DB, keine Patientendaten)
set -euo pipefail

BACKUP_BASE="/opt/myhistree/backups"
SEMIOTIX_URL="https://semiotix.net:5006/home/russo/myhistoree-backups"
SEMIOTIX_USER="russo"
SEMIOTIX_PASS="26sPss27="
RETENTION_DAYS=14
TS=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_BASE"
echo "[$TS] === myhistree offsite backup start ==="

# ─── 1. Backup PROD (.237) — FULL (Code + DB) ───────────────
echo "[$TS] [1/6] Stopping prod container..."
docker stop myhistree || true

echo "[$TS] [2/6] WAL checkpoint prod DB..."
sqlite3 /opt/myhistree/data/myhistoree.db 'PRAGMA wal_checkpoint(TRUNCATE);' || true

echo "[$TS] [3/6] Copy prod DB..."
PROD_DB="$BACKUP_BASE/myhistoree_prod_$TS.db"
cp /opt/myhistree/data/myhistoree.db "$PROD_DB"

echo "[$TS] [4/6] Starting prod container..."
docker start myhistree || true

# Wait for health
sleep 3
if curl -s http://localhost:3456/api/health | grep -q '"status":"ok"'; then
    echo "[$TS] Prod healthy after backup"
else
    echo "[$TS] WARN: Prod health check failed!"
fi

# ─── 2. Backup STAGING (.190) — CODE ONLY (keine DB, keine Patientendaten) ───
echo "[$TS] [5/6] Code backup staging (.190)..."
STAGING_CODE_TAR="/tmp/myhistoree_staging_code_$TS.tar.gz"
tar czf "$STAGING_CODE_TAR" \
    -C /opt/myhistoree \
    --exclude='data' \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.db' \
    --exclude='*.db-shm' \
    --exclude='*.db-wal' \
    --exclude='.env' \
    web/ server/src/ server/package.json server/tsconfig.json Dockerfile docker-compose.yml 2>/dev/null || true

echo "[$TS] [6/6] Uploading to Semiotix..."
# Upload prod full backup (Code + DB)
PROD_FULL_TAR="/tmp/myhistoree_prod_full_$TS.tar.gz"
tar czf "$PROD_FULL_TAR" \
    -C /opt/myhistree \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='*.db-shm' \
    --exclude='*.db-wal' \
    --exclude='.env' \
    web/ server/src/ server/package.json server/tsconfig.json Dockerfile docker-compose.yml \
    -C "$BACKUP_BASE" "myhistoree_prod_$TS.db" 2>/dev/null || true

curl -s -k --max-time 120 -u "$SEMIOTIX_USER:$SEMIOTIX_PASS" -T "$PROD_FULL_TAR" "$SEMIOTIX_URL/myhistoree_prod_full_$TS.tar.gz"
PROD_UPLOAD=$?

curl -s -k --max-time 120 -u "$SEMIOTIX_USER:$SEMIOTIX_PASS" -T "$STAGING_CODE_TAR" "$SEMIOTIX_URL/myhistoree_staging_code_$TS.tar.gz"
STAGING_UPLOAD=$?

# ─── 3. Cleanup local backups ────────────────────────────────
echo "[$TS] Cleaning local backups older than $RETENTION_DAYS days..."
find "$BACKUP_BASE" -maxdepth 1 -type f -name "*.db" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# ─── 4. Verify uploads ───────────────────────────────────────
echo "[$TS] Verifying uploads..."
VERIFY=$(curl -s -k --max-time 15 -u "$SEMIOTIX_USER:$SEMIOTIX_PASS" -X PROPFIND -H "Depth: 1" "$SEMIOTIX_URL/" 2>/dev/null | grep -c "myhistoree.*$TS" || true)

if [ "$PROD_UPLOAD" -eq 0 ] && [ "$STAGING_UPLOAD" -eq 0 ] && [ "$VERIFY" -ge 2 ]; then
    echo "[$TS] === SUCCESS: Both backups uploaded and verified ==="
    # Cleanup temp files
    rm -f "$PROD_FULL_TAR" "$STAGING_CODE_TAR"
    exit 0
else
    echo "[$TS] === ERROR: Upload failed (prod=$PROD_UPLOAD, staging=$STAGING_UPLOAD, verify=$VERIFY) ==="
    exit 1
fi
