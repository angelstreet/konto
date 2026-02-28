import cron from 'node-cron';
import db from '../db.js';
import 'dotenv/config';
import { cronMonitor } from './cronMonitor.js';
import { estimatePropertyPrice } from '../services/propertyEstimation.js';

const JOB_NAME = 'refresh-property-estimations';

/**
 * Recompute market estimations (DVF) for all real-estate assets nightly.
 * Keeps estimated_value / estimated_price_m2 fresh while preserving user current_value.
 */
export async function refreshPropertyEstimations() {
  cronMonitor.startRun(JOB_NAME);

  try {
    const assetsResult = await db.execute({
      sql: `SELECT id, citycode, latitude, longitude, surface, property_type
            FROM assets
            WHERE type = 'real_estate'
              AND citycode IS NOT NULL
              AND surface IS NOT NULL
              AND surface > 0`,
    });

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const asset of assetsResult.rows as any[]) {
      try {
        const citycode = String(asset.citycode || '');
        const lat = Number(asset.latitude || 0);
        const lon = Number(asset.longitude || 0);
        const surface = Number(asset.surface || 0);
        const propertyType = String(asset.property_type || 'Appartement');

        if (!citycode || !surface) {
          skipped++;
          continue;
        }

        const result = await estimatePropertyPrice({ citycode, lat, lon, surface, propertyType });
        if (!result) {
          skipped++;
          continue;
        }

        await db.execute({
          sql: `UPDATE assets
                SET estimated_value = ?,
                    estimated_price_m2 = ?,
                    estimation_date = ?
                WHERE id = ?`,
          args: [
            result.estimation.estimatedValue,
            result.estimation.pricePerM2,
            new Date().toISOString(),
            asset.id,
          ],
        });

        updated++;
      } catch (err: any) {
        failed++;
        console.error(`❌ Estimation refresh failed for asset ${asset.id}:`, err?.message || err);
      }
    }

    const summary = `${assetsResult.rows.length} scanned, ${updated} updated, ${skipped} skipped, ${failed} failed`;
    console.log(`🏠 Property estimation refresh complete: ${summary}`);
    if (failed > 0) cronMonitor.recordError(JOB_NAME, summary);
    else cronMonitor.recordSuccess(JOB_NAME, summary);
  } catch (err: any) {
    console.error('❌ Property estimation refresh job failed:', err.message);
    cronMonitor.recordError(JOB_NAME, err);
  }
}

cronMonitor.registerJob(JOB_NAME, '0 3 * * *');
cron.schedule('0 3 * * *', refreshPropertyEstimations);

console.log('⏰ Property estimation refresh cron initialized (runs at 3:00 AM daily)');
