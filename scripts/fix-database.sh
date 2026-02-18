#!/bin/bash
# Fix common database issues automatically

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="/home/jndoye/shared/projects/konto"
DB_PATH="$PROJECT_DIR/backend/db/konto.db"

echo "🔧 Konto Database Fix Script"
echo "============================="
echo ""

# Backup current database first
echo "📦 Creating safety backup..."
BACKUP_FILE="$PROJECT_DIR/backend/db/konto.db.backup-$(date +%Y%m%d-%H%M%S)"
cp "$DB_PATH" "$BACKUP_FILE"
echo -e "${GREEN}✓${NC} Backup created: $BACKUP_FILE"
echo ""

# Fix 1: User email
echo "🔧 Fixing user email..."
USER_EMAIL=$(sqlite3 "$DB_PATH" "SELECT email FROM users WHERE id = 1;" 2>/dev/null || echo "")

if [ "$USER_EMAIL" = "jo@konto.fr" ]; then
    echo -e "${GREEN}✓${NC} User email already correct"
else
    echo "  Current: $USER_EMAIL"
    echo "  Fixing to: jo@konto.fr"

    sqlite3 "$DB_PATH" "
    DELETE FROM users WHERE email = 'jo@konto.fr' AND id != 1;
    UPDATE users SET email = 'jo@konto.fr' WHERE id = 1;
    " 2>/dev/null

    echo -e "${GREEN}✓${NC} User email fixed"
fi

# Fix 2: Onboarding flag
echo ""
echo "🔧 Fixing onboarding flag..."
ONBOARDED=$(sqlite3 "$DB_PATH" "SELECT onboarded FROM user_preferences WHERE user_id = 1;" 2>/dev/null || echo "")

if [ "$ONBOARDED" = "1" ]; then
    echo -e "${GREEN}✓${NC} Onboarding already set correctly"
else
    sqlite3 "$DB_PATH" "
    INSERT OR IGNORE INTO user_preferences (user_id, onboarded) VALUES (1, 1);
    UPDATE user_preferences SET onboarded = 1 WHERE user_id = 1;
    " 2>/dev/null

    echo -e "${GREEN}✓${NC} Onboarding flag fixed"
fi

# Fix 3: Restart backend
echo ""
echo "🔄 Restarting backend..."
pm2 restart konto-backend > /dev/null 2>&1
sleep 2
echo -e "${GREEN}✓${NC} Backend restarted"

# Verify fixes
echo ""
echo "✅ Verifying fixes..."
sleep 1

USER_EMAIL=$(sqlite3 "$DB_PATH" "SELECT email FROM users WHERE id = 1;")
ONBOARDED=$(sqlite3 "$DB_PATH" "SELECT onboarded FROM user_preferences WHERE user_id = 1;")
ACCOUNT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM bank_accounts WHERE user_id = 1;")
API_COUNT=$(curl -s http://localhost:5004/api/dashboard 2>/dev/null | jq -r '.accountCount // 0' 2>/dev/null || echo "0")

echo "  User email: $USER_EMAIL"
echo "  Onboarded: $ONBOARDED"
echo "  DB accounts: $ACCOUNT_COUNT"
echo "  API accounts: $API_COUNT"

if [ "$API_COUNT" = "$ACCOUNT_COUNT" ] && [ "$ONBOARDED" = "1" ]; then
    echo ""
    echo -e "${GREEN}✅ All fixes applied successfully!${NC}"
    echo ""
    echo "You can now:"
    echo "  1. Refresh your browser (Ctrl+Shift+R)"
    echo "  2. Login with user/user"
    echo "  3. You should see your data without onboarding"
else
    echo ""
    echo -e "${YELLOW}⚠️  Some issues remain${NC}"
    echo "Run: ./scripts/health-check.sh for detailed diagnosis"
fi
echo ""
