#!/bin/bash
# Konto Health Check Script
# Validates that backend, frontend, and data are working correctly

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_DIR="/home/jndoye/shared/projects/konto"
DB_PATH="$PROJECT_DIR/backend/db/konto.db"

echo "🔍 Konto Health Check"
echo "===================="
echo ""

# Check 1: Backend running
echo -n "✓ Backend process... "
if pm2 list | grep -q "konto-backend.*online"; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC} - Backend not running"
    echo "  Fix: pm2 restart konto-backend"
    exit 1
fi

# Check 2: Frontend running
echo -n "✓ Frontend process... "
if pm2 list | grep -q "konto-frontend.*online"; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC} - Frontend not running"
    echo "  Fix: pm2 restart konto-frontend"
    exit 1
fi

# Check 3: Database exists
echo -n "✓ Database file... "
if [ -f "$DB_PATH" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC} - Database not found at $DB_PATH"
    exit 1
fi

# Check 4: Database integrity
echo -n "✓ Database integrity... "
INTEGRITY=$(sqlite3 "$DB_PATH" "PRAGMA integrity_check;" 2>/dev/null || echo "error")
if [ "$INTEGRITY" = "ok" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC} - Database corrupted: $INTEGRITY"
    exit 1
fi

# Check 5: User exists and email is correct
echo -n "✓ User configuration... "
USER_EMAIL=$(sqlite3 "$DB_PATH" "SELECT email FROM users WHERE id = 1;" 2>/dev/null || echo "")
if [ "$USER_EMAIL" = "jo@konto.fr" ]; then
    echo -e "${GREEN}OK${NC}"
elif [ "$USER_EMAIL" != "jo@konto.fr" ]; then
    echo -e "${YELLOW}WARNING${NC} - User email is 'jo@kompta.fr', should be 'jo@konto.fr'"
    echo "  Fix: Run ./scripts/fix-database.sh"
elif [ -z "$USER_EMAIL" ]; then
    echo -e "${RED}FAILED${NC} - No user found"
    exit 1
else
    echo -e "${YELLOW}WARNING${NC} - Unexpected email: $USER_EMAIL"
fi

# Check 6: Onboarding flag
echo -n "✓ Onboarding status... "
ONBOARDED=$(sqlite3 "$DB_PATH" "SELECT onboarded FROM user_preferences WHERE user_id = 1;" 2>/dev/null || echo "")
if [ "$ONBOARDED" = "1" ]; then
    echo -e "${GREEN}OK${NC}"
elif [ "$ONBOARDED" = "0" ]; then
    echo -e "${YELLOW}WARNING${NC} - Onboarding flag is 0 (will show onboarding screen)"
    echo "  Fix: Run ./scripts/fix-database.sh"
else
    echo -e "${YELLOW}WARNING${NC} - No preferences found"
fi

# Check 7: Data counts
echo -n "✓ Data availability... "
ACCOUNT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM bank_accounts WHERE user_id = 1;" 2>/dev/null || echo "0")
if [ "$ACCOUNT_COUNT" -gt "0" ]; then
    echo -e "${GREEN}OK${NC} ($ACCOUNT_COUNT accounts)"
else
    echo -e "${YELLOW}WARNING${NC} - No bank accounts found"
fi

# Check 8: Backend API responding
echo -n "✓ Backend API... "
API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5004/api/preferences 2>/dev/null || echo "000")
if [ "$API_RESPONSE" = "200" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${RED}FAILED${NC} - API returned status $API_RESPONSE"
    echo "  Check: pm2 logs konto-backend"
    exit 1
fi

# Check 9: API returns correct data
echo -n "✓ API data integrity... "
API_ACCOUNT_COUNT=$(curl -s http://localhost:5004/api/dashboard 2>/dev/null | jq -r '.accountCount // 0' 2>/dev/null || echo "0")
if [ "$API_ACCOUNT_COUNT" = "$ACCOUNT_COUNT" ]; then
    echo -e "${GREEN}OK${NC}"
else
    echo -e "${YELLOW}WARNING${NC} - API count ($API_ACCOUNT_COUNT) != DB count ($ACCOUNT_COUNT)"
    echo "  This might indicate a user email mismatch"
    echo "  Fix: Run ./scripts/fix-database.sh"
fi

# Check 10: Backups exist
echo -n "✓ Backup availability... "
BACKUP_COUNT=$(ls -1 "$PROJECT_DIR/backups/"*.db 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt "0" ]; then
    echo -e "${GREEN}OK${NC} ($BACKUP_COUNT backups)"
    LATEST_BACKUP=$(ls -t "$PROJECT_DIR/backups/"*.db 2>/dev/null | head -1)
    echo "  Latest: $(basename "$LATEST_BACKUP")"
else
    echo -e "${YELLOW}WARNING${NC} - No backups found"
fi

echo ""
echo -e "${GREEN}✅ Health check complete!${NC}"
echo ""
echo "Summary:"
echo "  - Backend: Running"
echo "  - Frontend: Running"
echo "  - Database: OK"
echo "  - User: $USER_EMAIL"
echo "  - Accounts: $ACCOUNT_COUNT"
echo "  - Backups: $BACKUP_COUNT"
echo ""
