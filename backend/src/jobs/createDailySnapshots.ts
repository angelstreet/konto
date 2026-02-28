import cron from 'node-cron';
import db from '../db.js';
import 'dotenv/config';
import { cronMonitor } from './cronMonitor.js';

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
        // Get user's bank accounts (excluding hidden ones)
        const accountsResult = await db.execute({
          sql: 'SELECT type, balance FROM bank_accounts WHERE hidden = 0 AND user_id = ?',
          args: [userId]
        });

        // Get user's assets
        const assetsResult = await db.execute({
          sql: 'SELECT type, current_value, purchase_price FROM assets WHERE user_id = ?',
          args: [userId]
        });

        // Aggregate by category
        const categories: Record<string, number> = {
          checking: 0,
          savings: 0,
          investment: 0,
          loan: 0,
          real_estate: 0,
          vehicle: 0,
          valuable: 0,
          other: 0
        };

        // Sum up bank accounts by type
        for (const acc of accountsResult.rows as any[]) {
          const type = acc.type || 'checking';
          categories[type] = (categories[type] || 0) + (acc.balance || 0);
        }

        // Sum up assets by type
        for (const asset of assetsResult.rows as any[]) {
          const type = asset.type || 'other';
          const value = asset.current_value || asset.purchase_price || 0;
          categories[type] = (categories[type] || 0) + value;
        }

        // Save snapshots for each non-zero category
        let total = 0;
        let categoriesUpdated = 0;

        for (const [cat, val] of Object.entries(categories)) {
          if (val !== 0) {
            await db.execute({
              sql: 'INSERT OR REPLACE INTO patrimoine_snapshots (date, user_id, category, total_value) VALUES (?, ?, ?, ?)',
              args: [today, userId, cat, val]
            });
            categoriesUpdated++;
            total += val;
          }
        }

        // Save total snapshot
        await db.execute({
          sql: 'INSERT OR REPLACE INTO patrimoine_snapshots (date, user_id, category, total_value) VALUES (?, ?, ?, ?)',
          args: [today, userId, 'total', total]
        });

        snapshotsCreated += categoriesUpdated + 1;
        console.log(`✅ Created ${categoriesUpdated + 1} snapshots for user ${userId} (total: ${total.toFixed(2)})`);

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
