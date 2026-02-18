#!/bin/bash
# Restore database from backup

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="/home/jndoye/shared/projects/konto"
BACKUP_DIR="$PROJECT_DIR/backups"
DB_PATH="$PROJECT_DIR/backend/db/konto.db"

echo "📦 Konto Backup Restore Script"
echo "==============================="
echo ""

# If backup file provided as argument, use it
if [ -n "$1" ]; then
    BACKUP_FILE="$1"
    if [ ! -f "$BACKUP_FILE" ]; then
        echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
        exit 1
    fi
else
    # List available backups
    echo "Available backups:"
    ls -lh "$BACKUP_DIR"/*.db 2>/dev/null | awk '{print "  " $9 " (" $5 ", " $6 " " $7 ")"}'
    echo ""

    # Use latest backup
    BACKUP_FILE=$(ls -t "$BACKUP_DIR"/*.db 2>/dev/null | head -1)

    if [ -z "$BACKUP_FILE" ]; then
        echo -e "${RED}Error: No backups found in $BACKUP_DIR${NC}"
        exit 1
    fi

    echo "Using latest backup: $(basename "$BACKUP_FILE")"
    echo ""
fi

# Confirm
echo -e "${YELLOW}⚠️  This will replace your current database!${NC}"
echo -n "Continue? (y/N): "
read -r CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🔄 Restoring backup..."

# Stop backend
echo "  Stopping backend..."
pm2 stop konto-backend > /dev/null 2>&1

# Backup current database
echo "  Creating safety backup of current database..."
SAFETY_BACKUP="$DB_PATH.before-restore-$(date +%Y%m%d-%H%M%S)"
cp "$DB_PATH" "$SAFETY_BACKUP"
echo -e "  ${GREEN}✓${NC} Safety backup: $SAFETY_BACKUP"

# Restore
echo "  Restoring from backup..."
cp "$BACKUP_FILE" "$DB_PATH"
echo -e "  ${GREEN}✓${NC} Database restored"

# Fix database (email and onboarding)
echo ""
echo "🔧 Applying fixes to restored database..."

sqlite3 "$DB_PATH" "
DELETE FROM users WHERE email = 'jo@konto.fr' AND id != 1;
UPDATE users SET email = 'jo@konto.fr' WHERE id = 1;
INSERT OR IGNORE INTO user_preferences (user_id, onboarded) VALUES (1, 1);
UPDATE user_preferences SET onboarded = 1 WHERE user_id = 1;
" 2>/dev/null

echo -e "${GREEN}✓${NC} Fixes applied"

# Restart backend
echo ""
echo "🔄 Restarting backend..."
pm2 restart konto-backend > /dev/null 2>&1
sleep 3
echo -e "${GREEN}✓${NC} Backend restarted"

# Verify
echo ""
echo "✅ Verifying restore..."
ACCOUNT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM bank_accounts WHERE user_id = 1;")
API_COUNT=$(curl -s http://localhost:5004/api/dashboard 2>/dev/null | jq -r '.accountCount // 0' 2>/dev/null || echo "0")

echo "  Bank accounts in DB: $ACCOUNT_COUNT"
echo "  Bank accounts via API: $API_COUNT"

if [ "$ACCOUNT_COUNT" -gt "0" ] && [ "$API_COUNT" = "$ACCOUNT_COUNT" ]; then
    echo ""
    echo -e "${GREEN}✅ Restore successful!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Refresh your browser (Ctrl+Shift+R)"
    echo "  2. Login with user/user"
    echo "  3. Your data should be visible"
else
    echo ""
    echo -e "${YELLOW}⚠️  Restore may have issues${NC}"
    echo "Run: ./scripts/health-check.sh"
fi
echo ""
