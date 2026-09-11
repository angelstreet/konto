import db from '../db.js';
import { getCryptoEurPrices, getFiatEurRates, accountBalanceEur } from '../shared.js';

/**
 * Writes one day's patrimoine snapshot for a user: category totals plus one row
 * per holding.
 *
 * This is the single implementation — the nightly cron and the dashboard's
 * auto-snapshot both call it, so they cannot drift apart on how a balance is
 * converted to EUR.
 */
export async function createPatrimoineSnapshot(userId: number, date?: string) {
  const snapshotDate = date || new Date().toISOString().split('T')[0];

  const accountsResult = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE hidden = 0 AND user_id = ?', args: [userId] });
  const assetsResult = await db.execute({ sql: 'SELECT * FROM assets WHERE user_id = ?', args: [userId] });

  const categories: Record<string, number> = { checking: 0, savings: 0, investment: 0, loan: 0, real_estate: 0, vehicle: 0, valuable: 0, other: 0 };
  // Crypto balances are native units and foreign fiat needs converting, so both
  // go through the shared helper to keep snapshots on the same basis as the dashboard.
  const snapshotCryptoPrices = await getCryptoEurPrices();
  const snapshotFiatRates = await getFiatEurRates();
  // One row per holding alongside the category totals, so variation can later be
  // computed for an individual account or asset and not just for a category.
  const holdings: { key: string; kind: string; refId: number; name: string; type: string; value: number }[] = [];

  for (const a of accountsResult.rows as any[]) {
    const value = accountBalanceEur(a, snapshotCryptoPrices, snapshotFiatRates);
    const type = a.type || 'checking';
    categories[type] = (categories[type] || 0) + value;
    holdings.push({
      key: `account:${a.id}`, kind: 'account', refId: Number(a.id),
      name: a.custom_name || a.name || '', type, value,
    });
  }
  for (const a of assetsResult.rows as any[]) {
    const value = a.current_value || a.purchase_price || 0;
    const type = a.type || 'other';
    categories[type] = (categories[type] || 0) + value;
    holdings.push({
      key: `asset:${a.id}`, kind: 'asset', refId: Number(a.id),
      name: a.address || a.name || '', type, value,
    });
  }

  let total = 0;
  for (const [cat, val] of Object.entries(categories)) {
    if (val !== 0) {
      await db.execute({ sql: 'INSERT OR REPLACE INTO patrimoine_snapshots (date, user_id, category, total_value) VALUES (?, ?, ?, ?)', args: [snapshotDate, userId, cat, val] });
      total += val;
    }
  }
  await db.execute({ sql: 'INSERT OR REPLACE INTO patrimoine_snapshots (date, user_id, category, total_value) VALUES (?, ?, ?, ?)', args: [snapshotDate, userId, 'total', total] });

  for (const h of holdings) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO holding_snapshots (date, user_id, holding_key, kind, ref_id, name, type, value)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [snapshotDate, userId, h.key, h.kind, h.refId, h.name, h.type, h.value],
    });
  }

  return { ok: true, date: snapshotDate, categories, total, holdings: holdings.length };
}
