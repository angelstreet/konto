import cron from 'node-cron';
import db from '../db.js';
import 'dotenv/config';
import { cronMonitor } from './cronMonitor.js';
import { createPatrimoineSnapshot } from '../services/snapshots.js';

const JOB_NAME = 'daily-snapshots';

/**
 * Creates patrimoine snapshots for all active users
 * Called daily at 2 AM to capture end-of-day balances
 */
async function createDailySnapshots() {
  cronMonitor.startRun(JOB_NAME);
  const today = new Date().toISOString().split('T')[0];

  try {
    // Get all active users
    const usersResult = await db.execute({
      sql: 'SELECT id FROM users',
      args: []
    });

    const users = usersResult.rows as any[];
    let snapshotsCreated = 0;
    let usersFailed = 0;

    for (const user of users) {
      const userId = user.id;

      try {
        // Shared with the dashboard's auto-snapshot so both convert balances
        // the same way — crypto priced from native units, foreign fiat at the
        // current EUR rate — and both record per-holding history.
        const result = await createPatrimoineSnapshot(userId, today);
        const written = Object.values(result.categories).filter(v => v !== 0).length + 1;
        snapshotsCreated += written;
        console.log(`✅ Created ${written} snapshots + ${result.holdings} holdings for user ${userId} (total: ${result.total.toFixed(2)})`);

      } catch (err: any) {
        console.error(`❌ Snapshot creation failed for user ${userId}:`, err.message);
        usersFailed++;
      }
    }

    const summary = `${snapshotsCreated} snapshots created for ${users.length} users, ${usersFailed} errors`;
    console.log(`📊 Daily snapshot job complete: ${summary}`);
    cronMonitor.recordSuccess(JOB_NAME, summary);

  } catch (err: any) {
    console.error('❌ Daily snapshot job failed:', err.message);
    cronMonitor.recordError(JOB_NAME, err);
  }
}

// Register with monitor
cronMonitor.registerJob(JOB_NAME, '0 2 * * *');

// Schedule daily at 2 AM (when most users are asleep and balances are stable)
cron.schedule('0 2 * * *', createDailySnapshots);

console.log('⏰ Daily snapshot cron initialized (runs at 2:00 AM daily)');

// Export for manual triggering
export { createDailySnapshots };
