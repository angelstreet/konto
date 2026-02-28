import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';
import { categorizeTransaction } from '../categorizer.js';

const router = new Hono();


router.get('/api/transactions', async (c) => {
  const userId = await getUserId(c);
  const accountId = c.req.query('account_id');
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search');
  const usage = c.req.query('usage');
  const companyId = c.req.query('company_id');
  const year = c.req.query('year');
  const month = c.req.query('month'); // 1-12

  let where = 'ba.user_id = ?';
  const params: any[] = [userId];

  if (accountId) { where += ' AND t.bank_account_id = ?'; params.push(accountId); }
  if (search) { where += ' AND t.label LIKE ?'; params.push(`%${search}%`); }
  if (year && month) {
    const m = month.padStart(2, '0');
    where += " AND t.date >= ? AND t.date < ?";
    const startDate = `${year}-${m}-01`;
    const nextMonth = parseInt(month) === 12 ? `${parseInt(year) + 1}-01-01` : `${year}-${String(parseInt(month) + 1).padStart(2, '0')}-01`;
    params.push(startDate, nextMonth);
  } else if (year) { where += " AND strftime('%Y', t.date) = ?"; params.push(year); }
  if (usage === 'personal') { where += ' AND ba.usage = ?'; params.push('personal'); }
  else if (usage === 'professional') { where += ' AND ba.usage = ?'; params.push('professional'); }
  else if (companyId) { where += ' AND ba.company_id = ?'; params.push(companyId); }

  const totalResult = await db.execute({ sql: `SELECT COUNT(*) as count FROM transactions t LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id WHERE ${where}`, args: params });
  const total = (totalResult.rows[0] as any).count;

  const rows = await db.execute({
    sql: `SELECT t.*, ba.name as account_name, ba.custom_name as account_custom_name, ba.currency as account_currency
          FROM transactions t LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
    args: [...params, limit, offset]
  });

  // Get available years for the filter (scoped to account if filtered)
  let yearsWhere = 'ba.user_id = ?';
  const yearsParams: any[] = [userId];
  if (accountId) { yearsWhere += ' AND t.bank_account_id = ?'; yearsParams.push(accountId); }
  if (usage === 'personal') { yearsWhere += ' AND ba.usage = ?'; yearsParams.push('personal'); }
  else if (usage === 'professional') { yearsWhere += ' AND ba.usage = ?'; yearsParams.push('professional'); }
  else if (companyId) { yearsWhere += ' AND ba.company_id = ?'; yearsParams.push(companyId); }
  const yearsResult = await db.execute({
    sql: `SELECT DISTINCT strftime('%Y', t.date) as year FROM transactions t LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id WHERE ${yearsWhere} ORDER BY year DESC`,
    args: yearsParams,
  });
  const years = yearsResult.rows.map((r: any) => r.year).filter(Boolean);

  return c.json({ transactions: rows.rows, total, limit, offset, years });
});

// --- Company info from SIREN ---

// ========== CSV IMPORT ==========

router.post('/api/import/csv', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();
  const { account_id, rows } = body;
  // rows: array of { date: 'YYYY-MM-DD', amount: number, label: string }

  if (!account_id || !rows || !Array.isArray(rows)) {
    return c.json({ error: 'Missing account_id or rows' }, 400);
  }

  // Verify account belongs to user
  const acc = await db.execute({
    sql: 'SELECT id FROM bank_accounts WHERE id = ? AND user_id = ?',
    args: [account_id, userId],
  });
  if (acc.rows.length === 0) return c.json({ error: 'Account not found' }, 404);

  // Generate batch ID for this import (allows undo)
  const batchId = `import_${Date.now()}`;

  // Load existing transactions for this account to deduplicate
  const existing = await db.execute({
    sql: 'SELECT date, amount, label FROM transactions WHERE bank_account_id = ?',
    args: [account_id],
  });
  const existingKeys = new Set<string>();
  for (const row of existing.rows as any[]) {
    const amt = Math.round(Number(row.amount) * 100) / 100;
    existingKeys.add(`${row.date}|${amt}`);
  }

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const amt = Math.round(Number(row.amount) * 100) / 100;
    const date = row.date;
    const key = `${date}|${amt}`;

    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }

    const txHash = `${batchId}_${date}_${amt}_${(row.label || '').slice(0, 30).replace(/[^a-zA-Z0-9]/g, '')}`;
    await db.execute({
      sql: `INSERT INTO transactions (bank_account_id, date, amount, label, category, tx_hash)
            VALUES (?, ?, ?, ?, NULL, ?)
            ON CONFLICT(bank_account_id, tx_hash) DO NOTHING`,
      args: [account_id, date, amt, row.label || '', txHash],
    });
    existingKeys.add(key);
    imported++;
  }

  return c.json({ imported, skipped, total: rows.length, batch_id: batchId });
});

// Delete all transactions from a specific CSV import batch
router.delete('/api/import/csv/:batchId', async (c) => {
  const userId = await getUserId(c);
  const batchId = c.req.param('batchId');

  const result = await db.execute({
    sql: `DELETE FROM transactions WHERE tx_hash LIKE ? || '%'
          AND bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)`,
    args: [batchId + '_', userId],
  });

  return c.json({ deleted: result.rowsAffected });
});

// List CSV import batches for an account
router.get('/api/import/csv/batches/:accountId', async (c) => {
  const userId = await getUserId(c);
  const accountId = parseInt(c.req.param('accountId'));

  const result = await db.execute({
    sql: `SELECT
            SUBSTR(tx_hash, 1, INSTR(tx_hash, '_', INSTR(tx_hash, '_') + 1 + LENGTH('import_')) - 1) as batch_prefix,
            MIN(date) as from_date, MAX(date) as to_date, COUNT(*) as count,
            MIN(created_at) as imported_at
          FROM transactions
          WHERE bank_account_id = ? AND tx_hash LIKE 'import_%'
            AND bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)
          GROUP BY batch_prefix
          ORDER BY imported_at DESC`,
    args: [accountId, userId],
  });

  // Simpler approach: group by batch prefix (import_TIMESTAMP)
  // tx_hash format: import_1234567890_2025-03-15_-950_VIRSEPALOYERNOISY
  const batches: any[] = [];
  const batchMap = new Map<string, any>();

  const allCsv = await db.execute({
    sql: `SELECT tx_hash, date, amount, created_at FROM transactions
          WHERE bank_account_id = ? AND tx_hash LIKE 'import_%'
            AND bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)
          ORDER BY date`,
    args: [accountId, userId],
  });

  for (const row of allCsv.rows as any[]) {
    // Extract batch_id: import_TIMESTAMP from tx_hash
    const match = (row.tx_hash as string).match(/^(import_\d+)_/);
    if (!match) continue;
    const bid = match[1];
    if (!batchMap.has(bid)) {
      batchMap.set(bid, { batch_id: bid, from_date: row.date, to_date: row.date, count: 0, imported_at: row.created_at });
    }
    const b = batchMap.get(bid)!;
    b.count++;
    if (row.date < b.from_date) b.from_date = row.date;
    if (row.date > b.to_date) b.to_date = row.date;
  }

  return c.json([...batchMap.values()].sort((a, b) => b.imported_at.localeCompare(a.imported_at)));
});




export default router;
