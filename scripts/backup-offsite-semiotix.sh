#!/bin/bash
# myhistree Offsite Backup → Semiotix.net (WebDAV)
# Runs on .237, backups up both .237 (prod) and .190 (staging via SSH tunnel)
set -euo pipefail

BACKUP_BASE="/opt/myhistree/backups"
SEMIOTIX_URL="https://semiotix.net:5006/home/russo/myhistoree-backups"
SEMIOTIX_USER="russo"
SEMIOTIX_PASS="26sPss27="
RETENTION_DAYS=14
TS=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_BASE"
echo "[$TS] === myhistree offsite backup start ==="

# ─── 1. Backup PROD (.237) ───────────────────────────────────
echo "[$TS] [1/4] Stopping prod container..."
docker stop myhistree || true

echo "[$TS] [2/4] WAL checkpoint prod DB..."
sqlite3 /opt/myhistree/data/myhistoree.db 'PRAGMA wal_checkpoint(TRUNCATE);' || true

echo "[$TS] [3/4] Copy prod DB..."
PROD_DB="$BACKUP_BASE/myhistoree_prod_$TS.db"
cp /opt/myhistree/data/myhistoree.db "$PROD_DB"

echo "[$TS] [4/4] Starting prod container..."
docker start myhistree || true

# Wait for health
sleep 3
if curl -s http://localhost:3456/api/health | grep -q '"status":"ok"'; then
    echo "[$TS] Prod healthy after backup"
else
    echo "[$TS] WARN: Prod health check failed!"
fi

# ─── 2. Backup STAGING (.190 via tunnel) ─────────────────────
echo "[$TS] [staging] Stopping staging container..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -i /root/.ssh/id_ed25519 -p 8822 root@localhost "docker stop myhistree" || true

echo "[$TS] [staging] WAL checkpoint staging DB..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -i /root/.ssh/id_ed25519 -p 8822 root@localhost "sqlite3 /opt/myhistoree/data/myhistoree.db 'PRAGMA wal_checkpoint(TRUNCATE);'" || true

echo "[$TS] [staging] Copy staging DB..."
STAGING_DB_LOCAL="$BACKUP_BASE/myhistoree_staging_$TS.db"
scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i /root/.ssh/id_ed25519 -P 8822 root@localhost:/opt/myhistoree/data/myhistoree.db "$STAGING_DB_LOCAL"

echo "[$TS] [staging] Starting staging container..."
ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -i /root/.ssh/id_ed25519 -p 8822 root@localhost "docker start myhistree" || true

# ─── 3. Pack & Upload ────────────────────────────────────────
echo "[$TS] Packing prod backup..."
PROD_TAR="/tmp/myhistoree_prod_backup_$TS.tar.gz"
tar czf "$PROD_TAR" -C "$BACKUP_BASE" "myhistoree_prod_$TS.db"

echo "[$TS] Uploading prod to Semiotix..."
curl -s -k --max-time 120 -u "$SEMIOTIX_USER:$SEMIOTIX_PASS" -T "$PROD_TAR" "$SEMIOTIX_URL/myhistoree_prod_backup_$TS.tar.gz"
PROD_UPLOAD=$?

echo "[$TS] Packing staging backup..."
STAGING_TAR="/tmp/myhistoree_staging_backup_$TS.tar.gz"
tar czf "$STAGING_TAR" -C "$BACKUP_BASE" "myhistoree_staging_$TS.db"

echo "[$TS] Uploading staging to Semiotix..."
curl -s -k --max-time 120 -u "$SEMIOTIX_USER:$SEMIOTIX_PASS" -T "$STAGING_TAR" "$SEMIOTIX_URL/myhistoree_staging_backup_$TS.tar.gz"
STAGING_UPLOAD=$?

# ─── 4. Cleanup local backups ────────────────────────────────
echo "[$TS] Cleaning local backups older than $RETENTION_DAYS days..."
find "$BACKUP_BASE" -maxdepth 1 -type f -name "*.db" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true

# ─── 5. Verify uploads ───────────────────────────────────────
echo "[$TS] Verifying uploads..."
VERIFY=$(curl -s -k --max-time 15 -u "$SEMIOTIX_USER:$SEMIOTIX_PASS" -X PROPFIND -H "Depth: 1" "$SEMIOTIX_URL/" 2>/dev/null | grep -c "myhistoree.*$TS" || true)

if [ "$PROD_UPLOAD" -eq 0 ] && [ "$STAGING_UPLOAD" -eq 0 ] && [ "$VERIFY" -ge 2 ]; then
    echo "[$TS] === SUCCESS: Both backups uploaded and verified ==="
    # Cleanup temp files
    rm -f "$PROD_TAR" "$STAGING_TAR"
    exit 0
else
    echo "[$TS] === ERROR: Upload failed (prod=$PROD_UPLOAD, staging=$STAGING_UPLOAD, verify=$VERIFY) ==="
    exit 1
fi
