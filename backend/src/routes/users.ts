import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';
import { manualBlacklistHandler } from '../middleware/ipBlacklist.js';

const router = new Hono();


router.post('/api/admin/blacklist', manualBlacklistHandler);

// --- Admin: List Blacklisted IPs ---
router.get('/api/admin/blacklist', async (c) => {
  const userId: number = (c as any).userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const userRow = await db.execute({ sql: 'SELECT role FROM users WHERE id = ?', args: [userId] });
  if (!userRow.rows.length || (userRow.rows[0] as any).role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const rows = await db.execute(
    "SELECT * FROM ip_blacklist WHERE expires_at IS NULL OR expires_at > datetime('now') ORDER BY blocked_at DESC"
  );
  return c.json({ blacklist: rows.rows });
});


// --- Admin: Audit Log ---
router.get('/api/admin/audit-log', async (c) => {
  const userId: number = (c as any).userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  // Check admin role
  const userRow = await db.execute({ sql: 'SELECT role FROM users WHERE id = ?', args: [userId] });
  if (!userRow.rows.length || (userRow.rows[0] as any).role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const limit = Math.min(Number(c.req.query('limit') ?? 100), 1000);
  const offset = Number(c.req.query('offset') ?? 0);
  const ip = c.req.query('ip');
  const country = c.req.query('country');
  const action = c.req.query('action');
  const resource = c.req.query('resource');

  let sql = 'SELECT * FROM audit_log WHERE 1=1';
  const args: (string | number)[] = [];
  if (ip) { sql += ' AND ip = ?'; args.push(ip); }
  if (country) { sql += ' AND country = ?'; args.push(country); }
  if (action) { sql += ' AND action = ?'; args.push(action); }
  if (resource) { sql += ' AND resource LIKE ?'; args.push(`%${resource}%`); }
  sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
  args.push(limit, offset);

  const rows = await db.execute({ sql, args });
  return c.json({ logs: rows.rows, limit, offset });
});


// --- Users ---
router.get('/api/users', async (c) => {
  // PII cleanup task #950: remove name, phone, address from response
  const result = await db.execute(`
    SELECT u.id, u.role, u.clerk_id, u.created_at,
           COALESCE(up.email, '') AS email, up.city, up.country
    FROM users u
    LEFT JOIN user_profiles up ON up.user_id = u.id
  `);
  return c.json(result.rows);
});

// --- API Key Management ---
router.get('/api/settings/api-keys', async (c) => {
  const userId = await getUserId(c);
  const rows = await db.execute({
    sql: 'SELECT id, name, key_prefix, scope, created_at, last_used_at, active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId]
  });
  return c.json(rows.rows);
});

router.post('/api/settings/api-keys', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const name = body.name || 'default';
  const scope = body.scope === 'analytics' ? 'analytics' : 'personal';
  const rawKey = generateApiKey();
  const keyHash = sha256(rawKey);
  const keyPrefix = rawKey.slice(0, 14); // 'konto_' + first 8 chars
  const ins = await db.execute({
    sql: "INSERT INTO api_keys (user_id, key_hash, key_prefix, name, scope) VALUES (?, ?, ?, ?, ?)",
    args: [userId, keyHash, keyPrefix, name, scope]
  });
  const id = Number(ins.lastInsertRowid);
  return c.json({ id, name, key_prefix: keyPrefix, scope, key: rawKey, created_at: new Date().toISOString() });
});

router.delete('/api/settings/api-keys/:id', async (c) => {
  const userId = await getUserId(c);
  const id = Number(c.req.param('id'));
  const check = await db.execute({ sql: 'SELECT id FROM api_keys WHERE id = ? AND user_id = ?', args: [id, userId] });
  if (!check.rows.length) return c.json({ error: 'Not found' }, 404);
  await db.execute({ sql: 'DELETE FROM api_keys WHERE id = ?', args: [id] });
  return c.json({ ok: true });
});

router.post('/api/settings/api-keys/:id/renew', async (c) => {
  const userId = await getUserId(c);
  const id = Number(c.req.param('id'));
  const check = await db.execute({ sql: 'SELECT * FROM api_keys WHERE id = ? AND user_id = ?', args: [id, userId] });
  if (!check.rows.length) return c.json({ error: 'Not found' }, 404);
  const old_key = check.rows[0] as any;
  // Deactivate old key
  await db.execute({ sql: 'UPDATE api_keys SET active = 0 WHERE id = ?', args: [id] });
  // Create new key
  const rawKey = generateApiKey();
  const keyHash = sha256(rawKey);
  const keyPrefix = rawKey.slice(0, 14);
  const ins = await db.execute({
    sql: "INSERT INTO api_keys (user_id, key_hash, key_prefix, name, scope) VALUES (?, ?, ?, ?, ?)",
    args: [userId, keyHash, keyPrefix, old_key.name, old_key.scope]
  });
  const newId = Number(ins.lastInsertRowid);
  return c.json({ id: newId, name: old_key.name, key_prefix: keyPrefix, scope: old_key.scope, key: rawKey, created_at: new Date().toISOString() });
});

// --- Profile ---
router.get('/api/profile', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({
    sql: `SELECT u.id, COALESCE(up.email, '') AS email, up.city, up.country, u.created_at
          FROM users u
          LEFT JOIN user_profiles up ON up.user_id = u.id
          WHERE u.id = ?`,
    args: [userId]
  });
  if (result.rows.length === 0) return c.json({ error: 'User not found' }, 404);
  return c.json(result.rows[0]);
});

router.put('/api/profile', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();
  // PII cleanup task #950: reject name, phone, address; accept city, country
  const { city, country } = body;
  // Upsert into user_profiles (city, country only)
  await db.execute({
    sql: `INSERT INTO user_profiles (user_id, city, country)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            city = excluded.city,
            country = excluded.country`,
    args: [userId, city || null, country || null]
  });
  const result = await db.execute({
    sql: `SELECT u.id, COALESCE(up.email, '') AS email, up.city, up.country, u.created_at
          FROM users u
          LEFT JOIN user_profiles up ON up.user_id = u.id
          WHERE u.id = ?`,
    args: [userId]
  });
  return c.json(result.rows[0]);
});

// --- RGPD: Account deletion (right to erasure) ---
router.delete('/api/account', async (c) => {
  const userId = await getUserId(c);

  // Delete all user data in dependency order
  await db.execute({ sql: 'DELETE FROM invoice_cache WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM patrimoine_snapshots WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM analytics_cache WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM income_entries WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM drive_connections WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM coinbase_connections WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM binance_connections WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM payslips WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM drive_folder_mappings WHERE user_id = ?', args: [userId] });

  // Delete asset sub-tables
  const assetIds = await db.execute({ sql: 'SELECT id FROM assets WHERE user_id = ?', args: [userId] });
  for (const a of assetIds.rows as any[]) {
    await db.execute({ sql: 'DELETE FROM asset_costs WHERE asset_id = ?', args: [a.id] });
    await db.execute({ sql: 'DELETE FROM asset_revenues WHERE asset_id = ?', args: [a.id] });
  }
  await db.execute({ sql: 'DELETE FROM assets WHERE user_id = ?', args: [userId] });

  // Delete transactions for user's accounts
  await db.execute({ sql: 'DELETE FROM transactions WHERE bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)', args: [userId] });
  await db.execute({ sql: 'DELETE FROM investments WHERE bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)', args: [userId] });
  await db.execute({ sql: 'DELETE FROM bank_accounts WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM bank_connections WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM companies WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM user_preferences WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM user_profiles WHERE user_id = ?', args: [userId] });
  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [userId] });

  return c.json({ ok: true, message: 'All your data has been permanently deleted.' });
});

// --- RGPD: Data export (right to portability) ---
router.get('/api/account/data', async (c) => {
  const userId = await getUserId(c);
  // PII cleanup task #950: remove name, phone, address from export
  const user = await db.execute({
    sql: `SELECT u.id, COALESCE(up.email, '') AS email, up.city, up.country, u.created_at
          FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
          WHERE u.id = ?`,
    args: [userId]
  });
  const companies = await db.execute({ sql: 'SELECT * FROM companies WHERE user_id = ?', args: [userId] });
  const accounts = await db.execute({ sql: 'SELECT id, name, custom_name, bank_name, account_number, iban, balance, type, usage, currency, created_at FROM bank_accounts WHERE user_id = ?', args: [userId] });
  const transactions = await db.execute({ sql: 'SELECT t.date, t.amount, t.label, t.category FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.user_id = ?', args: [userId] });
  const assets = await db.execute({ sql: 'SELECT type, name, purchase_price, current_value, address, created_at FROM assets WHERE user_id = ?', args: [userId] });
  const income = await db.execute({ sql: 'SELECT * FROM income_entries WHERE user_id = ?', args: [userId] });

  return c.json({
    exported_at: new Date().toISOString(),
    format: 'RGPD Data Export',
    user: user.rows[0] || null,
    companies: companies.rows,
    bank_accounts: accounts.rows,
    transactions: transactions.rows,
    assets: assets.rows,
    income: income.rows,
  });
});

// --- Companies ---


export default router;
