/**
 * Cron job: clean up audit_log entries older than 90 days.
 * Runs every 24 hours.
 */
import db from '../db.js';

async function cleanupOldAuditLogs() {
  try {
    const result = await db.execute(
      "DELETE FROM audit_log WHERE timestamp < datetime('now', '-90 days')"
    );
    console.log(`[cleanupAuditLog] Deleted ${result.rowsAffected} old audit log entries`);
  } catch (err) {
    console.error('[cleanupAuditLog] Error:', err);
  }
}

// Run immediately on startup to catch any stale records
cleanupOldAuditLogs();

// Then run every 24 hours
setInterval(cleanupOldAuditLogs, 24 * 60 * 60 * 1000);
