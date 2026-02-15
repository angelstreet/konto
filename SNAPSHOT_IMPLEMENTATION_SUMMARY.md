# Patrimoine Snapshot Implementation Summary

## ✅ What Was Implemented

### 1. Daily Snapshot Cron Job ✅
**File**: `/backend/src/jobs/createDailySnapshots.ts`

- Runs daily at 2:00 AM
- Automatically creates snapshots for ALL users
- Aggregates data from:
  - Bank accounts (checking, savings, investment, loan)
  - Assets (real_estate, vehicle, valuable, other)
- Saves to `patrimoine_snapshots` table
- Includes monitoring and error tracking

### 2. Cron Job Integration ✅
**File**: `/backend/src/index.ts` (lines 11-13)

- Both cron jobs now auto-start when backend starts
- Imported at startup:
  ```typescript
  import './jobs/createDailySnapshots.js';
  import './jobs/refreshStaleConnections.js';
  ```

### 3. Auto-Create Initial Snapshot ✅
**File**: `/backend/src/index.ts`

- Added helper function `createPatrimoineSnapshot()` (line 1456)
- Modified `/api/dashboard/history` endpoint (line 1490)
- Automatically creates a snapshot when user views the dashboard IF one doesn't exist for today
- Ensures users always have data to see

### 4. Cron Monitoring System ✅
**Files**:
- `/backend/src/jobs/cronMonitor.ts` (new monitoring system)
- Updated both cron job files to use monitoring
- New health check endpoint: `/api/health/cron`

**Features:**
- Tracks last run time for each job
- Counts successes/errors
- Reports job status (running, success, error, never_run)
- Health check API for external monitoring

## 📊 How It Works Now

### Data Flow

```
┌─────────────────────────────────────────────────────┐
│  Backend Server Starts                              │
└────────────────┬────────────────────────────────────┘
                 │
                 ├─► Cron Jobs Auto-Register
                 │   ├─ Daily Snapshots (2 AM)
                 │   └─ Refresh Connections (every 6h)
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│  User Views Dashboard                               │
└────────────────┬────────────────────────────────────┘
                 │
                 ├─► GET /api/dashboard/history
                 │
                 ├─► Check: Snapshot exists for today?
                 │   ├─ NO  → Create snapshot now
                 │   └─ YES → Continue
                 │
                 ├─► Query historical snapshots
                 │
                 └─► Return data to PatrimoineChart
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│  Chart Shows Wealth Evolution                       │
│  - Day 1: €100,000                                  │
│  - Day 2: €102,500 (+2.5%)                          │
│  - Day 3: €101,800 (-0.7%)                          │
└─────────────────────────────────────────────────────┘
```

### Snapshot Schedule

- **2:00 AM Daily**: Automatic snapshot created for all users
- **On Dashboard View**: If today's snapshot missing, create it immediately
- **Manual Trigger**: POST `/api/dashboard/snapshot` anytime

## 🔍 Monitoring

### Check Cron Job Status

```bash
# Health check endpoint
curl http://localhost:5004/api/health/cron

# Example response:
{
  "status": "healthy",
  "timestamp": "2024-02-15T10:30:00.000Z",
  "jobs": [
    {
      "name": "daily-snapshots",
      "schedule": "0 2 * * *",
      "lastRun": "2024-02-15T02:00:00.000Z",
      "lastStatus": "success",
      "runCount": 5,
      "errorCount": 0,
      "healthy": true
    }
  ]
}
```

### Server Logs

When backend starts:
```
⏰ Daily snapshot cron initialized (runs at 2:00 AM daily)
⏰ Stale connections auto-refresh cron initialized (every 6 hours)
✅ Registered cron job: daily-snapshots (0 2 * * *)
✅ Registered cron job: refresh-stale-connections (0 */6 * * *)
```

When job runs:
```
▶️  Starting cron job: daily-snapshots
✅ Created 8 snapshots for user 1 (total: 125000.00)
✅ Cron job completed: daily-snapshots - 8 snapshots created for 1 users, 0 errors
```

## 🚀 Deployment & Startup

### Using PM2 (Recommended)

```bash
# Start backend
cd /home/jndoye/shared/projects/konto/backend
pm2 start dist/index.js --name konto-backend

# Save process list
pm2 save

# Configure auto-start on reboot
pm2 startup
# Follow instructions to run the generated command

# Monitor
pm2 logs konto-backend
pm2 monit
```

### Using Systemd

Create `/etc/systemd/system/konto-backend.service`:

```ini
[Unit]
Description=Konto Backend API
After=network.target

[Service]
Type=simple
User=jndoye
WorkingDirectory=/home/jndoye/shared/projects/konto/backend
ExecStart=/usr/bin/node /home/jndoye/shared/projects/konto/backend/dist/index.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable konto-backend
sudo systemctl start konto-backend
sudo systemctl status konto-backend
```

## 📝 Database Schema

The `patrimoine_snapshots` table structure:

```sql
CREATE TABLE patrimoine_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,          -- checking, savings, investment, etc.
  total_value REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(date, user_id, category)  -- One snapshot per user/date/category
);
```

## 🧪 Testing

### 1. Start the Backend

```bash
cd /home/jndoye/shared/projects/konto/backend
npm run build
npm start
```

### 2. Check Cron Jobs Are Registered

Look for these logs:
```
✅ Registered cron job: daily-snapshots (0 2 * * *)
✅ Registered cron job: refresh-stale-connections (0 */6 * * *)
```

### 3. Check Health Endpoint

```bash
curl http://localhost:5004/api/health/cron | jq
```

### 4. Manually Create a Snapshot

```bash
curl -X POST http://localhost:5004/api/dashboard/snapshot | jq
```

### 5. View History

```bash
curl http://localhost:5004/api/dashboard/history?range=1m | jq
```

### 6. Check Database

```bash
sqlite3 /path/to/konto.db
SELECT date, category, total_value FROM patrimoine_snapshots ORDER BY date DESC LIMIT 10;
```

## 📂 Files Changed/Created

### New Files
1. `/backend/src/jobs/createDailySnapshots.ts` - Daily snapshot cron job
2. `/backend/src/jobs/cronMonitor.ts` - Monitoring system
3. `/backend/CRON_MONITORING.md` - Complete monitoring guide
4. `/SNAPSHOT_IMPLEMENTATION_SUMMARY.md` - This file

### Modified Files
1. `/backend/src/index.ts`
   - Added cron job imports (lines 11-13)
   - Added cronMonitor import (line 14)
   - Added `createPatrimoineSnapshot()` helper function
   - Modified POST `/api/dashboard/snapshot` to use helper
   - Modified GET `/api/dashboard/history` to auto-create snapshots
   - Added GET `/api/health/cron` endpoint

2. `/backend/src/jobs/refreshStaleConnections.ts`
   - Added monitoring integration
   - Reports success/error to cronMonitor

## 🎯 Next Steps

1. **Start the backend** and verify cron jobs are registered
2. **Set up PM2** or systemd for auto-restart on reboot
3. **Configure external monitoring** (optional but recommended)
   - Set up UptimeRobot to ping `/api/health/cron` every hour
   - Alert if status becomes "unhealthy"
4. **Test snapshot creation**:
   - Wait until 2 AM or manually trigger via API
   - Check database for new snapshots
   - View dashboard to see charts populate
5. **Monitor logs** for the first few days

## ⚠️ Important Notes

1. **Cron jobs require server to be running**
   - Jobs only run while Node.js process is active
   - Set up PM2/systemd to ensure process stays running

2. **First snapshot creation**
   - Users will see their first snapshot when they visit the dashboard
   - Or wait until 2 AM the next day for automatic creation

3. **Timezone**
   - Cron runs in server's local timezone
   - 2 AM = server's local 2 AM (not UTC)
   - Adjust schedule in `createDailySnapshots.ts` if needed

4. **Performance**
   - Snapshots are lightweight (just aggregating existing data)
   - Daily job should complete in < 1 second per user
   - No impact on user-facing performance

## 📖 Documentation

See `/backend/CRON_MONITORING.md` for:
- Detailed monitoring guide
- Troubleshooting steps
- Production deployment checklist
- Alert configuration examples

## ✨ Benefits

1. **Automatic Data Tracking**: Users get daily snapshots without any action
2. **Historical Analysis**: Can track wealth evolution over time
3. **Smart Initialization**: First-time users immediately see their current snapshot
4. **Robust Monitoring**: Built-in health checks and error tracking
5. **Production Ready**: Auto-restart on failures, comprehensive logging
