#!/bin/bash
set -euo pipefail

BACKUP_BASE="/opt/myhistree-backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$BACKUP_BASE/$DATE"
DAILY_IMAGE_TAG="myhistree-myhistree:daily-$(date +%Y%m%d)"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"

echo "[$DATE] Staging code-only backup start..."

# 1. Tag current image with daily tag
docker tag myhistree-myhistree:latest "$DAILY_IMAGE_TAG" || true

# 2. Save Docker image to backup (essential — this is the only true source of truth)
docker save myhistree-myhistree:latest | gzip > "$BACKUP_DIR/image.tar.gz"

# 3. Backup .env (contains config, no patient data)
cp /opt/myhistoree/.env "$BACKUP_DIR/"

# 4. Backup web directory (frontend customizations)
tar czf "$BACKUP_DIR/web.tar.gz" -C /opt/myhistoree web/

# 5. Backup compose + Dockerfile
cp /opt/myhistoree/docker-compose.yml "$BACKUP_DIR/"
cp /opt/myhistoree/Dockerfile "$BACKUP_DIR/"

# 6. Git HEAD commit
cd /opt/myhistoree
git rev-parse HEAD > "$BACKUP_DIR/git-head.txt"

# 7. Cleanup old backups (keep last $RETENTION_DAYS days)
find "$BACKUP_BASE" -maxdepth 1 -type d -name "20*" -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true

# 8. Cleanup old daily image tags
for tag in $(docker images myhistree-myhistree --format "{{.Tag}}" | grep "^daily-" | sort | head -n -$RETENTION_DAYS); do
    docker rmi "myhistree-myhistree:$tag" >/dev/null 2>&1 || true
done

echo "[$DATE] Staging backup complete: $BACKUP_DIR (image + env + web + compose, NO DB)"
echo "[$DATE] Daily image tagged: $DAILY_IMAGE_TAG"