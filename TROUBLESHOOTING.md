# Konto Troubleshooting Guide

## Quick Health Check

Run this command to verify everything is working:
```bash
cd /home/jndoye/shared/projects/konto
./scripts/health-check.sh
```

## Common Issues & Fixes

### 1. User/User Login Shows Onboarding Instead of Dashboard

**Symptoms:**
- Login with user/user shows onboarding screen
- No data visible

**Root Cause:**
- `onboarded` flag is 0 in user_preferences
- User email mismatch between database and backend

**Fix:**
```bash
# Check user and preferences
sqlite3 backend/db/konto.db "SELECT id, email FROM users; SELECT user_id, onboarded FROM user_preferences;"

# Fix onboarding flag
sqlite3 backend/db/konto.db "UPDATE user_preferences SET onboarded = 1 WHERE user_id = 1;"

# Restart backend
pm2 restart konto-backend
```

---

### 2. No Data Showing (Empty Dashboard)

**Symptoms:**
- Dashboard shows 0 accounts
- API returns empty data
- Database has data but frontend shows nothing

**Root Cause:**
- User email mismatch: database has `jo@konto.fr` but backend expects `jo@konto.fr`

**Diagnosis:**
```bash
# Check which user owns the data
sqlite3 backend/db/konto.db "SELECT id, email FROM users;"
sqlite3 backend/db/konto.db "SELECT user_id, COUNT(*) FROM bank_accounts GROUP BY user_id;"

# Test API
curl -s http://localhost:5004/api/dashboard | jq '.accountCount'
```

**Fix:**
```bash
# Delete duplicate user and fix email
sqlite3 backend/db/konto.db "
DELETE FROM users WHERE email = 'jo@konto.fr' AND id != 1;
UPDATE users SET email = 'jo@konto.fr' WHERE id = 1;
"

# Restart backend
pm2 restart konto-backend

# Verify fix
curl -s http://localhost:5004/api/dashboard | jq '.accountCount'
```

---

### 3. Logout Doesn't Show Login Page

**Symptoms:**
- Click logout button
- Page goes blank or doesn't redirect

**Root Cause:**
- React state not updating properly
- Frontend needs restart

**Fix:**
```bash
# Restart frontend
pm2 restart konto-frontend

# Clear browser cache
# Then in browser: Ctrl+Shift+R (or Cmd+Shift+R on Mac)
```

---

### 4. Backend Not Running / 404 Errors

**Symptoms:**
- API returns 404
- Dashboard won't load
- Network errors in browser console

**Diagnosis:**
```bash
# Check if backend is running
pm2 list | grep konto-backend

# Check backend logs
pm2 logs konto-backend --lines 50
```

**Fix:**
```bash
# Start backend if not running
cd /home/jndoye/shared/projects/konto/backend
pm2 start "npm run dev" --name konto-backend --cwd /home/jndoye/shared/projects/konto/backend

# Or restart if already running
pm2 restart konto-backend
```

---

### 5. Database Corruption / Data Loss

**Symptoms:**
- Cannot query database
- Data disappeared
- SQL errors

**Fix - Restore from Backup:**
```bash
# List available backups
ls -lah /home/jndoye/shared/projects/konto/backups/

# Restore latest backup
./scripts/restore-backup.sh

# Or manually restore specific backup
pm2 stop konto-backend
cp /home/jndoye/shared/projects/konto/backups/konto_YYYY-MM-DD_HHMM.db \
   /home/jndoye/shared/projects/konto/backend/db/konto.db
pm2 restart konto-backend
```

---

## Recovery Scripts

### Quick Recovery (Most Common Issues)
```bash
./scripts/quick-fix.sh
```

### Full Recovery from Backup
```bash
./scripts/restore-backup.sh [backup-file]
```

### Create Manual Backup
```bash
./scripts/create-backup.sh
```

---

## API Endpoints for Testing

```bash
# Health check
curl http://localhost:5004/api/health

# User preferences (should show onboarded: 1)
curl http://localhost:5004/api/preferences | jq .

# Dashboard data (should show account count)
curl http://localhost:5004/api/dashboard | jq '.accountCount'

# Bank accounts
curl http://localhost:5004/api/dashboard | jq '.financial.accountsByType'
```

---

## PM2 Process Management

```bash
# List all processes
pm2 list

# View logs
pm2 logs konto-backend
pm2 logs konto-frontend

# Restart processes
pm2 restart konto-backend
pm2 restart konto-frontend

# Stop processes
pm2 stop konto-backend konto-frontend

# Start processes
pm2 start konto-backend
pm2 start konto-frontend
```

---

## Database Maintenance

### Check Database Integrity
```bash
sqlite3 backend/db/konto.db "PRAGMA integrity_check;"
```

### View Data Counts
```bash
sqlite3 backend/db/konto.db "
SELECT 'Users:' as type, COUNT(*) as count FROM users
UNION ALL SELECT 'Bank Accounts:', COUNT(*) FROM bank_accounts
UNION ALL SELECT 'Transactions:', COUNT(*) FROM transactions
UNION ALL SELECT 'Assets:', COUNT(*) FROM assets
UNION ALL SELECT 'Companies:', COUNT(*) FROM companies;
"
```

### Fix Common Database Issues
```bash
# Run the database fix script
./scripts/fix-database.sh
```

---

## Getting Help

If these fixes don't work:
1. Check backend logs: `pm2 logs konto-backend --lines 100`
2. Check frontend logs: `pm2 logs konto-frontend --lines 100`
3. Check browser console (F12) for JavaScript errors
4. Run health check: `./scripts/health-check.sh`

---

## Preventive Maintenance

1. **Daily backups** run automatically at 3 AM (via cron)
2. **Before major changes**, create manual backup: `./scripts/create-backup.sh`
3. **After restoring backup**, run health check: `./scripts/health-check.sh`
4. **Keep at least 7 days** of backups (automatic cleanup)
