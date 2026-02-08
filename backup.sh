#!/bin/bash
set -euo pipefail
BACKUP_DIR="$HOME/shared/projects/kompta/backups"
DB="$HOME/shared/projects/kompta/backend/db/kompta.db"
DATE=$(date +%Y-%m-%d_%H%M)
cp "$DB" "$BACKUP_DIR/kompta_${DATE}.db"
# Keep last 30 backups
ls -t "$BACKUP_DIR"/kompta_*.db 2>/dev/null | tail -n +31 | xargs -r rm
echo "Backup done: kompta_${DATE}.db"
