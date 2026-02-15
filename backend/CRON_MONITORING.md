# Cron Job Monitoring Guide

This document explains how to monitor the automated cron jobs in Konto backend and ensure they start correctly on system reboot.

## Overview

The Konto backend has two automated cron jobs:

1. **Daily Snapshots** (`createDailySnapshots`)
   - Schedule: Every day at 2:00 AM
   - Purpose: Creates patrimoine (wealth) snapshots for all users
   - Cron expression: `0 2 * * *`

2. **Refresh Stale Connections** (`refreshStaleConnections`)
   - Schedule: Every 6 hours
   - Purpose: Refreshes bank account data for connections that haven't synced in 7+ days
   - Cron expression: `0 */6 * * *`

## How Cron Jobs Are Started

The cron jobs automatically start when the backend server starts because:

1. They are imported in `/backend/src/index.ts`:
   ```typescript
   import './jobs/createDailySnapshots.js';
   import './jobs/refreshStaleConnections.js';
   ```

2. Each job file registers itself with `node-cron` on import
3. The cron jobs run in-process with the backend server

**Important**: The cron jobs only run while the backend server is running. If the server stops, the jobs stop.

## Monitoring Cron Jobs

### 1. Health Check Endpoint

Check if cron jobs are running correctly:

```bash
curl http://localhost:5004/api/health/cron
```

**Expected Response:**
```json
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
      "uptime": 30600000,
      "healthy": true
    },
    {
      "name": "refresh-stale-connections",
      "schedule": "0 */6 * * *",
      "lastRun": "2024-02-15T06:00:00.000Z",
      "lastStatus": "success",
      "runCount": 20,
      "errorCount": 0,
      "uptime": 16200000,
      "healthy": true
    }
  ]
}
```

### 2. Server Logs

The cron jobs log their execution to the console. Check your server logs:

```bash
# If using PM2
pm2 logs konto-backend

# If using systemd
journalctl -u konto-backend -f

# If running manually
# Check terminal output
```

**Log Examples:**
```
⏰ Daily snapshot cron initialized (runs at 2:00 AM daily)
⏰ Stale connections auto-refresh cron initialized (every 6 hours)
✅ Registered cron job: daily-snapshots (0 2 * * *)
✅ Registered cron job: refresh-stale-connections (0 */6 * * *)
▶️  Starting cron job: daily-snapshots
✅ Created 8 snapshots for user 1 (total: 125000.00)
✅ Cron job completed: daily-snapshots - 8 snapshots created for 1 users, 0 errors
```

### 3. Database Verification

Check if snapshots are being created:

```bash
# Connect to your database
sqlite3 /path/to/konto.db

# Check latest snapshots
SELECT date, user_id, category, total_value
FROM patrimoine_snapshots
ORDER BY date DESC
LIMIT 10;

# Check snapshot creation frequency
SELECT date, COUNT(*) as snapshot_count
FROM patrimoine_snapshots
GROUP BY date
ORDER BY date DESC
LIMIT 7;
```

## Ensuring Jobs Start on Reboot

The cron jobs will automatically start when your backend server starts. Here's how to ensure the backend starts on reboot:

### Option 1: PM2 (Recommended for Production)

1. **Install PM2 globally:**
   ```bash
   npm install -g pm2
   ```

2. **Start your backend with PM2:**
   ```bash
   cd /home/jndoye/shared/projects/konto/backend
   pm2 start dist/index.js --name konto-backend
   ```

3. **Save PM2 process list:**
   ```bash
   pm2 save
   ```

4. **Generate startup script:**
   ```bash
   pm2 startup
   # Follow the instructions shown (usually requires running a command with sudo)
   ```

5. **Verify PM2 will start on boot:**
   ```bash
   pm2 list
   # Should show konto-backend with status "online"
   ```

6. **Monitor your jobs:**
   ```bash
   # View logs
   pm2 logs konto-backend

   # Check status
   pm2 status

   # Restart if needed
   pm2 restart konto-backend
   ```

### Option 2: Systemd Service

1. **Create a systemd service file:**
   ```bash
   sudo nano /etc/systemd/system/konto-backend.service
   ```

2. **Add the following content:**
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
   RestartSec=10
   StandardOutput=journal
   StandardError=journal
   SyslogIdentifier=konto-backend

   Environment=NODE_ENV=production
   Environment=TURSO_DATABASE_URL=your_database_url
   Environment=TURSO_AUTH_TOKEN=your_auth_token

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable and start the service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable konto-backend
   sudo systemctl start konto-backend
   ```

4. **Check status:**
   ```bash
   sudo systemctl status konto-backend
   ```

5. **View logs:**
   ```bash
   journalctl -u konto-backend -f
   ```

### Option 3: Docker (if containerized)

If you're using Docker, ensure the container has a restart policy:

```bash
docker run -d \
  --name konto-backend \
  --restart unless-stopped \
  -p 5004:5004 \
  konto-backend:latest
```

Or in `docker-compose.yml`:
```yaml
services:
  konto-backend:
    image: konto-backend:latest
    restart: unless-stopped
    ports:
      - "5004:5004"
```

## Troubleshooting

### Cron Jobs Not Running

1. **Check if backend is running:**
   ```bash
   curl http://localhost:5004/api/health
   ```

2. **Check cron job registration logs:**
   ```bash
   # Look for these lines in startup logs:
   # ✅ Registered cron job: daily-snapshots (0 2 * * *)
   # ✅ Registered cron job: refresh-stale-connections (0 */6 * * *)
   ```

3. **Verify imports are correct:**
   ```bash
   # Check that index.ts imports the job files
   grep "import.*jobs" backend/src/index.ts
   ```

4. **Check for errors:**
   ```bash
   # Look for error logs
   pm2 logs konto-backend --err
   ```

### Cron Jobs Failing

1. **Check the health endpoint:**
   ```bash
   curl http://localhost:5004/api/health/cron | jq
   ```

2. **Look for error messages in logs:**
   ```bash
   pm2 logs konto-backend | grep "❌"
   ```

3. **Manually trigger a snapshot:**
   ```bash
   curl -X POST http://localhost:5004/api/dashboard/snapshot
   ```

### Snapshots Not Created

1. **Check database permissions:**
   ```bash
   # Ensure the database is writable
   ls -la /path/to/konto.db
   ```

2. **Verify users exist:**
   ```bash
   sqlite3 /path/to/konto.db "SELECT COUNT(*) FROM users;"
   ```

3. **Check for database errors in logs**

## Monitoring Best Practices

1. **Set up external monitoring:**
   - Use a service like UptimeRobot or Pingdom to check `/api/health/cron` every hour
   - Alert if status changes to "unhealthy"

2. **Regular log checks:**
   - Review logs daily for error messages
   - Set up log aggregation (e.g., Grafana Loki, ELK stack)

3. **Database backups:**
   - Ensure `patrimoine_snapshots` table is included in backups
   - Test restore procedures

4. **Alert on missing snapshots:**
   ```bash
   # Create a script to check if today's snapshot exists
   #!/bin/bash
   TODAY=$(date +%Y-%m-%d)
   COUNT=$(sqlite3 /path/to/konto.db "SELECT COUNT(*) FROM patrimoine_snapshots WHERE date = '$TODAY';")

   if [ "$COUNT" -eq 0 ]; then
     echo "WARNING: No snapshots created for $TODAY"
     # Send alert (email, Slack, etc.)
   fi
   ```

## Manual Testing

To test the cron jobs without waiting:

1. **Manually trigger daily snapshot:**
   ```bash
   curl -X POST http://localhost:5004/api/dashboard/snapshot
   ```

2. **Verify snapshot was created:**
   ```bash
   curl http://localhost:5004/api/dashboard/history?range=1m
   ```

3. **Check cron status:**
   ```bash
   curl http://localhost:5004/api/health/cron | jq '.jobs'
   ```

## Production Checklist

- [ ] Backend starts automatically on server reboot (PM2/systemd)
- [ ] Cron jobs are registered on startup (check logs)
- [ ] Health endpoint is accessible
- [ ] External monitoring is configured
- [ ] Logs are being collected and retained
- [ ] Database backups include `patrimoine_snapshots` table
- [ ] Alert system is configured for failures
- [ ] Team knows how to check cron job status
