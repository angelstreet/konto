import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';


const router = new Hono();


// ========== INVESTMENTS ==========

router.get('/api/investments', async (c) => {
  const userId = await getUserId(c);
  const accountId = c.req.query('account_id');
  const scope = c.req.query('usage');
  const companyId = c.req.query('company_id');

  let sql = `SELECT i.*, ba.name as account_name, ba.custom_name as account_custom_name
             FROM investments i
             JOIN bank_accounts ba ON i.bank_account_id = ba.id
             WHERE ba.user_id = ?`;
  const args: any[] = [userId];

  if (accountId) {
    sql += ' AND i.bank_account_id = ?';
    args.push(accountId);
  }
  if (scope === 'personal') {
    sql += " AND ba.usage = 'personal'";
  } else if (scope === 'professional') {
    sql += " AND ba.usage = 'professional'";
  }
  if (companyId) {
    sql += ' AND ba.company_id = ?';
    args.push(companyId);
  }

  sql += ' ORDER BY i.valuation DESC';

  const result = await db.execute({ sql, args });

  // Also compute totals
  let totalSql = `SELECT COALESCE(SUM(i.valuation), 0) as total_valuation, COALESCE(SUM(i.diff), 0) as total_diff
                  FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id WHERE ba.user_id = ?`;
  const totalArgs: any[] = [userId];
  if (accountId) { totalSql += ' AND i.bank_account_id = ?'; totalArgs.push(accountId); }
  if (scope === 'personal') totalSql += " AND ba.usage = 'personal'";
  else if (scope === 'professional') totalSql += " AND ba.usage = 'professional'";
  if (companyId) { totalSql += ' AND ba.company_id = ?'; totalArgs.push(companyId); }

  const totals = await db.execute({ sql: totalSql, args: totalArgs });
  const row = totals.rows[0] as any;

  return c.json({
    investments: result.rows,
    total_valuation: row.total_valuation || 0,
    total_diff: row.total_diff || 0,
  });
});

router.get('/api/export', async (c) => {
  const userId = await getUserId(c);
  const companies = await db.execute({ sql: 'SELECT * FROM companies WHERE user_id = ?', args: [userId] });
  const bankConnections = await db.execute({ sql: 'SELECT id, user_id, powens_connection_id, status, created_at FROM bank_connections WHERE user_id = ?', args: [userId] });
  const bankAccounts = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE user_id = ?', args: [userId] });
  const transactions = await db.execute('SELECT * FROM transactions');
  const assetsResult = await db.execute({ sql: 'SELECT * FROM assets WHERE user_id = ?', args: [userId] });
  const assets = assetsResult.rows as any[];
  for (const a of assets) {
    const costs = await db.execute({ sql: 'SELECT * FROM asset_costs WHERE asset_id = ?', args: [a.id] });
    a.costs = costs.rows;
    const revenues = await db.execute({ sql: 'SELECT * FROM asset_revenues WHERE asset_id = ?', args: [a.id] });
    a.revenues = revenues.rows;
  }

  return c.json({
    version: 1, exported_at: new Date().toISOString(), user_id: userId,
    companies: companies.rows, bank_connections: bankConnections.rows,
    bank_accounts: bankAccounts.rows, transactions: transactions.rows, assets,
  });
});

router.post('/api/import', async (c) => {
  const data = await c.req.json() as any;
  if (!data.version || !data.companies) return c.json({ error: 'Invalid export format' }, 400);

  const userId = await getUserId(c);
  let imported = { companies: 0, bank_accounts: 0, transactions: 0, assets: 0 };

  if (data.companies?.length) {
    for (const co of data.companies) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO companies (user_id, siren, name, address, naf_code, capital, legal_form) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, co.siren, co.name, co.address, co.naf_code, co.capital, co.legal_form]
      });
      imported.companies++;
    }
  }

  if (data.bank_accounts?.length) {
    for (const ba of data.bank_accounts) {
      await db.execute({
        sql: `INSERT OR IGNORE INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, custom_name, bank_name, account_number, iban, balance, hidden, last_sync, type, usage, subtype) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, ba.company_id, ba.provider, ba.provider_account_id, ba.name, ba.custom_name, ba.bank_name, ba.account_number, ba.iban, ba.balance, ba.hidden, ba.last_sync, ba.type, ba.usage, ba.subtype || null]
      });
      imported.bank_accounts++;
    }
  }

  if (data.transactions?.length) {
    for (const tx of data.transactions) {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO transactions (bank_account_id, date, amount, label, category, is_pro) VALUES (?, ?, ?, ?, ?, ?)',
        args: [tx.bank_account_id, tx.date, tx.amount, tx.label, tx.category, tx.is_pro ?? 1]
      });
      imported.transactions++;
    }
  }

  if (data.assets?.length) {
    for (const a of data.assets) {
      const r = await db.execute({
        sql: `INSERT INTO assets (user_id, type, name, purchase_price, notary_fees, purchase_date, current_value, current_value_date, photo_url, linked_loan_account_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [userId, a.type, a.name, a.purchase_price, a.notary_fees || null, a.purchase_date, a.current_value, a.current_value_date, a.photo_url, a.linked_loan_account_id, a.notes]
      });
      const newId = Number(r.lastInsertRowid);
      if (a.costs) for (const co of a.costs) {
        await db.execute({ sql: 'INSERT INTO asset_costs (asset_id, label, amount, frequency, category) VALUES (?, ?, ?, ?, ?)', args: [newId, co.label, co.amount, co.frequency, co.category] });
      }
      if (a.revenues) for (const rv of a.revenues) {
        await db.execute({ sql: 'INSERT INTO asset_revenues (asset_id, label, amount, frequency) VALUES (?, ?, ?, ?)', args: [newId, rv.label, rv.amount, rv.frequency] });
      }
      imported.assets++;
    }
  }

  return c.json({ ok: true, imported });
});



export default router;
