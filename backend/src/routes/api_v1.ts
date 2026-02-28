import { Hono } from 'hono';
import db from '../db.js';
import { categorizeTransaction } from '../categorizer.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';


const router = new Hono();


// ========== PUBLIC API v1 ==========

// Helper: get user ID from API key context or Clerk JWT
async function getApiUserId(c: any): Promise<number | null> {
  const apiUserId = (c as any).apiKeyUserId;
  if (apiUserId) return apiUserId;
  try {
    return await getUserId(c);
  } catch {
    return null;
  }
}

function getApiScope(c: any): string {
  return (c as any).apiKeyScope || 'personal';
}

// GET /api/v1/accounts
router.get('/api/v1/accounts', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const result = await db.execute({
    sql: `SELECT id, COALESCE(custom_name, name) as name, bank_name, balance, type, usage
          FROM bank_accounts WHERE user_id = ? AND hidden = 0 ORDER BY type, name`,
    args: [userId],
  });
  return c.json({
    accounts: (result.rows as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      bank_name: r.bank_name || null,
      balance: Math.round((r.balance || 0) * 100) / 100,
      type: r.type || 'checking',
      usage: r.usage || 'personal',
    })),
  });
});

// GET /api/v1/transactions
router.get('/api/v1/transactions', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const months = parseInt(c.req.query('months') || '3', 10);
  const categoryFilter = c.req.query('category');
  const minAmount = c.req.query('min_amount') ? parseFloat(c.req.query('min_amount')!) : null;
  const maxAmount = c.req.query('max_amount') ? parseFloat(c.req.query('max_amount')!) : null;
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - months);
  const fromStr = fromDate.toISOString().split('T')[0];
  let where = 'ba.user_id = ? AND t.date >= ?';
  const params: any[] = [userId, fromStr];
  if (minAmount !== null) { where += ' AND t.amount >= ?'; params.push(minAmount); }
  if (maxAmount !== null) { where += ' AND t.amount <= ?'; params.push(maxAmount); }
  const rows = await db.execute({
    sql: `SELECT t.id, t.date, t.amount, t.label, COALESCE(ba.custom_name, ba.name) as account_name
          FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
          WHERE ${where} ORDER BY t.date DESC, t.id DESC`,
    args: params,
  });
  let transactions = (rows.rows as any[]).map((r) => {
    const cat = categorizeTransaction(r.label || '');
    return {
      id: r.id,
      date: r.date ? r.date.toString().split('T')[0] : null,
      amount: Math.round((r.amount || 0) * 100) / 100,
      label: r.label || '',
      category: cat.category,
      icon: cat.icon,
      account: r.account_name,
    };
  });
  if (categoryFilter) {
    transactions = transactions.filter((t) => t.category === categoryFilter);
  }
  return c.json({ transactions, total: transactions.length });
});

// GET /api/v1/investments
router.get('/api/v1/investments', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const result = await db.execute({
    sql: `SELECT i.label, i.isin_code as code, i.quantity, i.unit_value, i.valuation as current_value, i.code_type as type
          FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id
          WHERE ba.user_id = ? ORDER BY i.valuation DESC`,
    args: [userId],
  });
  const investments = (result.rows as any[]).map((r) => ({
    label: r.label || '',
    code: r.code || null,
    quantity: r.quantity ?? null,
    unit_value: r.unit_value !== null ? Math.round((r.unit_value || 0) * 100) / 100 : null,
    current_value: Math.round((r.current_value || 0) * 100) / 100,
    type: r.type || 'other',
  }));
  const total_value = Math.round(investments.reduce((s, i) => s + i.current_value, 0) * 100) / 100;
  return c.json({ investments, total_value });
});

// GET /api/v1/assets
router.get('/api/v1/assets', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const result = await db.execute({
    sql: `SELECT a.name, a.type, a.current_value, a.purchase_price, a.monthly_rent
          FROM assets a WHERE a.user_id = ? ORDER BY a.created_at DESC`,
    args: [userId],
  });
  return c.json({
    assets: (result.rows as any[]).map((r) => ({
      name: r.name || '',
      type: r.type || 'other',
      current_value: r.current_value !== null ? Math.round((r.current_value || 0) * 100) / 100 : null,
      purchase_value: r.purchase_price !== null ? Math.round((r.purchase_price || 0) * 100) / 100 : null,
      monthly_rent: r.monthly_rent !== null ? Math.round((r.monthly_rent || 0) * 100) / 100 : null,
    })),
  });
});

// GET /api/v1/loans
router.get('/api/v1/loans', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const result = await db.execute({
    sql: `SELECT COALESCE(custom_name, name) as name, balance
          FROM bank_accounts WHERE user_id = ? AND type = 'loan' ORDER BY balance ASC`,
    args: [userId],
  });
  return c.json({
    loans: (result.rows as any[]).map((r) => ({
      name: r.name || '',
      remaining_amount: Math.round((r.balance || 0) * 100) / 100,
      monthly_payment: null,
      rate: null,
      start_date: null,
      end_date: null,
    })),
  });
});

// GET /api/v1/summary
router.get('/api/v1/summary', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0];
  const [accountsRes, investmentsRes, assetsRes, loansRes, txsRes, subTxsRes] = await Promise.all([
    db.execute({ sql: `SELECT balance, type FROM bank_accounts WHERE user_id = ? AND hidden = 0`, args: [userId] }),
    db.execute({ sql: `SELECT i.valuation, i.code_type as asset_class, i.isin_code as code FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id WHERE ba.user_id = ?`, args: [userId] }),
    db.execute({ sql: `SELECT current_value, purchase_price FROM assets WHERE user_id = ?`, args: [userId] }),
    db.execute({ sql: `SELECT balance FROM bank_accounts WHERE user_id = ? AND type = 'loan'`, args: [userId] }),
    db.execute({ sql: `SELECT t.amount, t.label FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.user_id = ? AND t.date >= ?`, args: [userId, monthStart] }),
    db.execute({ sql: `SELECT t.amount, t.label FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.user_id = ? AND t.amount < 0 AND t.date >= ?`, args: [userId, prevMonthStart] }),
  ]);
  const accounts = accountsRes.rows as any[];
  const investments = investmentsRes.rows as any[];
  const assets = assetsRes.rows as any[];
  const loans = loansRes.rows as any[];
  const totalBalance = accounts.filter((a) => a.type !== 'loan').reduce((s: number, a: any) => s + (a.balance || 0), 0);
  const totalInvestments = investments.reduce((s: number, i: any) => s + (i.valuation || 0), 0);
  const totalAssets = assets.reduce((s: number, a: any) => s + (a.current_value || a.purchase_price || 0), 0);
  const totalLoans = loans.reduce((s: number, l: any) => s + (l.balance || 0), 0);
  const patrimoineNet = totalBalance + totalInvestments + totalAssets + totalLoans;
  let income = 0, expenses = 0;
  const catTotals = new Map<string, number>();
  for (const row of txsRes.rows as any[]) {
    if (row.amount > 0) income += row.amount;
    else {
      expenses += row.amount;
      const cat = categorizeTransaction(row.label || '');
      catTotals.set(cat.category, (catTotals.get(cat.category) || 0) + row.amount);
    }
  }
  const topCategories = [...catTotals.entries()]
    .sort((a, b) => a[1] - b[1]).slice(0, 5)
    .map(([name, amount]) => {
      const cat = categorizeTransaction(name);
      return { name, icon: cat.icon, pct: expenses !== 0 ? Math.round((amount / expenses) * 100) : 0 };
    });
  const subMap = new Map<string, number[]>();
  for (const r of subTxsRes.rows as any[]) {
    const key = (r.label || '').trim().toUpperCase().split(/\s+/).slice(0, 2).join(' ');
    if (!subMap.has(key)) subMap.set(key, []);
    subMap.get(key)!.push(r.amount);
  }
  let subCount = 0, subMonthly = 0;
  for (const [, amounts] of subMap.entries()) {
    if (amounts.length >= 2) { subCount++; subMonthly += amounts[0]; }
  }
  const cryptoMap = new Map<string, number>();
  for (const inv of investments) {
    if ((inv.asset_class || '').toLowerCase() === 'crypto' && inv.code) {
      cryptoMap.set(inv.code, (cryptoMap.get(inv.code) || 0) + (inv.valuation || 0));
    }
  }
  const cryptoHoldings = [...cryptoMap.entries()]
    .map(([code, value]) => ({ code, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => b.value - a.value);
  return c.json({
    patrimoine_net: Math.round(patrimoineNet * 100) / 100,
    accounts: { count: accounts.filter((a) => a.type !== 'loan').length, total_balance: Math.round(totalBalance * 100) / 100 },
    investments: { count: investments.length, total_value: Math.round(totalInvestments * 100) / 100 },
    assets: { count: assets.length, total_value: Math.round(totalAssets * 100) / 100 },
    loans: { count: loans.length, total_remaining: Math.round(totalLoans * 100) / 100 },
    monthly: { income: Math.round(income * 100) / 100, expenses: Math.round(expenses * 100) / 100, savings: Math.round((income + expenses) * 100) / 100 },
    subscriptions: { count: subCount, monthly: Math.round(subMonthly * 100) / 100 },
    top_expense_categories: topCategories,
    crypto_holdings: cryptoHoldings,
  });
});

// ---- Analytics Endpoints (scope=analytics required) ----

function requireAnalyticsScope(c: any): boolean {
  return getApiScope(c) === 'analytics';
}

// GET /api/v1/analytics/demographics
router.get('/api/v1/analytics/demographics', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  if (!requireAnalyticsScope(c)) return c.json({ error: 'Analytics scope required' }, 403);
  const [usersRes, accountsRes, investmentsRes, assetsRes] = await Promise.all([
    db.execute({ sql: 'SELECT id FROM users', args: [] }),
    db.execute({ sql: 'SELECT user_id, COUNT(*) as cnt FROM bank_accounts WHERE hidden = 0 GROUP BY user_id', args: [] }),
    db.execute({ sql: `SELECT DISTINCT ba.user_id FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id WHERE LOWER(i.code_type) = 'crypto'`, args: [] }),
    db.execute({ sql: `SELECT DISTINCT user_id FROM assets WHERE type = 'real_estate'`, args: [] }),
  ]);
  const totalUsers = usersRes.rows.length;
  if (totalUsers === 0) return c.json({ total_users: 0, avg_patrimoine: 0, crypto_holders_pct: 0, real_estate_holders_pct: 0, avg_accounts_per_user: 0 });
  const patRes = await db.execute({
    sql: `SELECT ba.user_id,
            SUM(CASE WHEN ba.type != 'loan' THEN ba.balance ELSE 0 END) +
            COALESCE((SELECT SUM(i.valuation) FROM investments i WHERE i.bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ba.user_id)), 0) +
            COALESCE((SELECT SUM(COALESCE(a.current_value, a.purchase_price, 0)) FROM assets a WHERE a.user_id = ba.user_id), 0) +
            COALESCE((SELECT SUM(ba2.balance) FROM bank_accounts ba2 WHERE ba2.user_id = ba.user_id AND ba2.type = 'loan'), 0) as patrimoine
          FROM bank_accounts ba GROUP BY ba.user_id`,
    args: [],
  });
  const avgPatrimoine = patRes.rows.length > 0 ? patRes.rows.reduce((s: number, r: any) => s + (r.patrimoine || 0), 0) / patRes.rows.length : 0;
  const totalAccounts = (accountsRes.rows as any[]).reduce((s: number, r: any) => s + (r.cnt || 0), 0);
  return c.json({
    total_users: totalUsers,
    avg_patrimoine: Math.round(avgPatrimoine * 100) / 100,
    crypto_holders_pct: Math.round((investmentsRes.rows.length / totalUsers) * 100),
    real_estate_holders_pct: Math.round((assetsRes.rows.length / totalUsers) * 100),
    avg_accounts_per_user: Math.round((totalAccounts / totalUsers) * 100) / 100,
  });
});

// GET /api/v1/analytics/categories
router.get('/api/v1/analytics/categories', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  if (!requireAnalyticsScope(c)) return c.json({ error: 'Analytics scope required' }, 403);
  const from = new Date();
  from.setMonth(from.getMonth() - 3);
  const fromStr = from.toISOString().split('T')[0];
  const txs = await db.execute({
    sql: `SELECT t.amount, t.label, ba.user_id FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE t.date >= ? AND t.amount < 0`,
    args: [fromStr],
  });
  const userCatMap = new Map<number, Map<string, number>>();
  for (const row of txs.rows as any[]) {
    const uid = row.user_id as number;
    if (!userCatMap.has(uid)) userCatMap.set(uid, new Map());
    const catMap = userCatMap.get(uid)!;
    const cat = categorizeTransaction(row.label || '');
    catMap.set(cat.category, (catMap.get(cat.category) || 0) + Math.abs(row.amount));
  }
  const catAgg = new Map<string, { totals: number[]; monthlies: number[] }>();
  for (const [, catMap] of userCatMap.entries()) {
    const userTotal = [...catMap.values()].reduce((s, v) => s + v, 0);
    for (const [cat, amount] of catMap.entries()) {
      if (!catAgg.has(cat)) catAgg.set(cat, { totals: [], monthlies: [] });
      const entry = catAgg.get(cat)!;
      entry.totals.push(userTotal > 0 ? (amount / userTotal) * 100 : 0);
      entry.monthlies.push(-(amount / 3));
    }
  }
  const categories = [...catAgg.entries()].map(([name, data]) => {
    const sorted = [...data.monthlies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    const avg_pct = data.totals.reduce((s, v) => s + v, 0) / data.totals.length;
    const cat = categorizeTransaction(name);
    return { name, icon: cat.icon, avg_pct: Math.round(avg_pct), median_monthly: Math.round(median * 100) / 100 };
  }).sort((a, b) => b.avg_pct - a.avg_pct);
  return c.json({ categories });
});

// GET /api/v1/analytics/investments
router.get('/api/v1/analytics/investments', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  if (!requireAnalyticsScope(c)) return c.json({ error: 'Analytics scope required' }, 403);
  const [totalUsersRes, cryptoUsersRes, cryptoRes, portfolioRes, assetClassRes] = await Promise.all([
    db.execute({ sql: 'SELECT COUNT(*) as cnt FROM users', args: [] }),
    db.execute({ sql: `SELECT DISTINCT ba.user_id FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id WHERE LOWER(i.code_type) = 'crypto'`, args: [] }),
    db.execute({ sql: `SELECT i.isin_code as code, COUNT(DISTINCT ba.user_id) as holders FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id WHERE LOWER(i.code_type) = 'crypto' AND i.isin_code IS NOT NULL GROUP BY i.isin_code ORDER BY holders DESC LIMIT 10`, args: [] }),
    db.execute({ sql: `SELECT ba.user_id, SUM(i.valuation) as total FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id GROUP BY ba.user_id`, args: [] }),
    db.execute({ sql: `SELECT i.code_type as asset_class, SUM(i.valuation) as total FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id GROUP BY i.code_type`, args: [] }),
  ]);
  const totalUsers = (totalUsersRes.rows[0] as any)?.cnt || 1;
  const avgPortfolio = portfolioRes.rows.length > 0 ? portfolioRes.rows.reduce((s: number, r: any) => s + (r.total || 0), 0) / portfolioRes.rows.length : 0;
  const assetByClass = new Map<string, number>();
  for (const r of assetClassRes.rows as any[]) { assetByClass.set((r.asset_class || '').toLowerCase(), r.total || 0); }
  const etfTotal = assetByClass.get('etf') || 0;
  const stockTotal = assetByClass.get('stock') || 0;
  const etfVsStocksRatio = (etfTotal + stockTotal) > 0 ? Math.round((etfTotal / (etfTotal + stockTotal)) * 100) / 100 : null;
  return c.json({
    crypto_holders_pct: Math.round((cryptoUsersRes.rows.length / totalUsers) * 100),
    top_cryptos: (cryptoRes.rows as any[]).map((r) => ({ code: r.code, holders_pct: Math.round(((r.holders || 0) / totalUsers) * 100) })),
    avg_portfolio_size: Math.round(avgPortfolio * 100) / 100,
    etf_vs_stocks_ratio: etfVsStocksRatio,
  });
});

// GET /api/v1/analytics/subscriptions
router.get('/api/v1/analytics/subscriptions', async (c) => {
  const userId = await getApiUserId(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  if (!requireAnalyticsScope(c)) return c.json({ error: 'Analytics scope required' }, 403);
  const from = new Date();
  from.setMonth(from.getMonth() - 3);
  const fromStr = from.toISOString().split('T')[0];
  const txs = await db.execute({
    sql: `SELECT t.amount, t.label, ba.user_id FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE t.amount < 0 AND t.date >= ?`,
    args: [fromStr],
  });
  const totalUsersRes = await db.execute({ sql: 'SELECT COUNT(*) as cnt FROM users', args: [] });
  const totalUsers = (totalUsersRes.rows[0] as any)?.cnt || 1;
  const userMerchantMap = new Map<number, Map<string, number[]>>();
  for (const row of txs.rows as any[]) {
    const uid = row.user_id as number;
    const key = (row.label || '').trim().toUpperCase().split(/\s+/).slice(0, 2).join(' ');
    if (!userMerchantMap.has(uid)) userMerchantMap.set(uid, new Map());
    const mm = userMerchantMap.get(uid)!;
    if (!mm.has(key)) mm.set(key, []);
    mm.get(key)!.push(row.amount);
  }
  const merchantStats = new Map<string, { userCount: number; amounts: number[] }>();
  for (const [, merchantMap] of userMerchantMap.entries()) {
    for (const [merchant, amounts] of merchantMap.entries()) {
      if (amounts.length < 2) continue;
      const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      const allSimilar = amounts.every((a) => Math.abs(a - avg) / Math.abs(avg) <= 0.15);
      if (!allSimilar) continue;
      if (!merchantStats.has(merchant)) merchantStats.set(merchant, { userCount: 0, amounts: [] });
      const stat = merchantStats.get(merchant)!;
      stat.userCount++;
      stat.amounts.push(avg);
    }
  }
  const topSubscriptions = [...merchantStats.entries()]
    .sort((a, b) => b[1].userCount - a[1].userCount).slice(0, 20)
    .map(([merchant, stat]) => ({
      merchant,
      users_pct: Math.round((stat.userCount / totalUsers) * 100),
      avg_amount: Math.round((stat.amounts.reduce((s, a) => s + a, 0) / stat.amounts.length) * 100) / 100,
    }));
  const avgMonthlySubscriptions = topSubscriptions.reduce((s, sub) => s + sub.avg_amount, 0);
  return c.json({
    top_subscriptions: topSubscriptions,
    avg_monthly_subscriptions: Math.round(avgMonthlySubscriptions * 100) / 100,
  });
});



export default router;
