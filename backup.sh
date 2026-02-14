#!/bin/bash
set -euo pipefail
BACKUP_DIR="$HOME/shared/projects/konto/backups"
DB="$HOME/shared/projects/konto/backend/db/konto.db"
DATE=$(date +%Y-%m-%d_%H%M)
cp "$DB" "$BACKUP_DIR/konto_${DATE}.db"
# Keep last 30 backups
ls -t "$BACKUP_DIR"/konto_*.db 2>/dev/null | tail -n +31 | xargs -r rm
echo "Backup done: konto_${DATE}.db"
