import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff } from '../shared.js';
import { estimatePropertyPrice } from '../services/propertyEstimation.js';

const router = new Hono();


// ========== ASSETS ==========

router.get('/api/assets', async (c) => {
  const type = c.req.query('type');
  const usage = c.req.query('usage');
  const companyId = c.req.query('company_id');
  let where = '1=1';
  const params: any[] = [];
  if (type) { where += ' AND a.type = ?'; params.push(type); }
  if (usage === 'personal') { where += " AND (a.usage = 'personal' OR a.usage IS NULL) AND a.company_id IS NULL"; }
  else if (usage === 'professional') { where += " AND (a.usage = 'professional' OR a.company_id IS NOT NULL)"; }
  if (companyId) { where += ' AND a.company_id = ?'; params.push(companyId); }

  const result = await db.execute({
    sql: `SELECT a.*, ba.name as loan_name, ba.balance as loan_balance FROM assets a LEFT JOIN bank_accounts ba ON ba.id = a.linked_loan_account_id WHERE ${where} ORDER BY a.created_at DESC`,
    args: params
  });
  const assets = result.rows as any[];

  for (const asset of assets) {
    const costsResult = await db.execute({ sql: 'SELECT * FROM asset_costs WHERE asset_id = ? ORDER BY id', args: [asset.id] });
    asset.costs = costsResult.rows;
    const revenuesResult = await db.execute({ sql: 'SELECT * FROM asset_revenues WHERE asset_id = ? ORDER BY id', args: [asset.id] });
    asset.revenues = revenuesResult.rows;
    asset.monthly_costs = (asset.costs as any[]).reduce((sum: number, c: any) => sum + (c.frequency === 'yearly' ? c.amount / 12 : c.frequency === 'one_time' ? 0 : c.amount), 0);
    asset.monthly_revenues = (asset.revenues as any[]).reduce((sum: number, r: any) => sum + (r.frequency === 'yearly' ? r.amount / 12 : r.frequency === 'one_time' ? 0 : r.amount), 0);
    const totalAcquisition = asset.purchase_price ? asset.purchase_price + (asset.notary_fees || 0) + (asset.travaux || 0) : null;
    asset.pnl = asset.current_value && totalAcquisition ? asset.current_value - totalAcquisition : null;
    asset.pnl_percent = asset.pnl != null && totalAcquisition ? (asset.pnl / totalAcquisition) * 100 : null;
  }

  return c.json(assets);
});

router.get('/api/assets/:id', async (c) => {
  const result = await db.execute({ sql: 'SELECT * FROM assets WHERE id = ?', args: [c.req.param('id')] });
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const asset = result.rows[0] as any;
  const costs = await db.execute({ sql: 'SELECT * FROM asset_costs WHERE asset_id = ?', args: [asset.id] });
  asset.costs = costs.rows;
  const revenues = await db.execute({ sql: 'SELECT * FROM asset_revenues WHERE asset_id = ?', args: [asset.id] });
  asset.revenues = revenues.rows;
  return c.json(asset);
});

router.post('/api/assets', async (c) => {
  const body = await c.req.json() as any;
  const result = await db.execute({
    sql: `INSERT INTO assets (type, name, purchase_price, notary_fees, travaux, purchase_date, current_value, current_value_date, photo_url, linked_loan_account_id, notes, address, citycode, latitude, longitude, surface, property_type, estimated_value, estimated_price_m2, estimation_date, property_usage, monthly_rent, tenant_name, kozy_property_id, usage, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [body.type, body.name, body.purchase_price || null, body.notary_fees || null, body.travaux || null, body.purchase_date || null, body.current_value || null, body.current_value_date || null, body.photo_url || null, body.linked_loan_account_id || null, body.notes || null, body.address || null, body.citycode || null, body.latitude || null, body.longitude || null, body.surface || null, body.property_type || null, body.estimated_value || null, body.estimated_price_m2 || null, body.estimated_value ? new Date().toISOString() : null, body.property_usage || 'principal', body.monthly_rent || null, body.tenant_name || null, body.kozy_property_id || null, body.usage || 'personal', body.company_id || null]
  });

  const newId = Number(result.lastInsertRowid);
  if (body.costs?.length) {
    for (const cost of body.costs) {
      await db.execute({ sql: 'INSERT INTO asset_costs (asset_id, label, amount, frequency, category) VALUES (?, ?, ?, ?, ?)', args: [newId, cost.label, cost.amount, cost.frequency || 'monthly', cost.category || null] });
    }
  }
  if (body.revenues?.length) {
    for (const rev of body.revenues) {
      await db.execute({ sql: 'INSERT INTO asset_revenues (asset_id, label, amount, frequency) VALUES (?, ?, ?, ?)', args: [newId, rev.label, rev.amount, rev.frequency || 'monthly'] });
    }
  }

  return c.json({ id: newId });
});

router.patch('/api/assets/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json() as any;

  const fields = ['type', 'name', 'purchase_price', 'notary_fees', 'travaux', 'purchase_date', 'current_value', 'current_value_date', 'photo_url', 'linked_loan_account_id', 'notes', 'address', 'citycode', 'latitude', 'longitude', 'surface', 'property_type', 'estimated_value', 'estimated_price_m2', 'estimation_date', 'property_usage', 'monthly_rent', 'tenant_name', 'kozy_property_id', 'usage', 'company_id'];
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (f in body) { updates.push(`${f} = ?`); values.push(body[f]); }
  }
  if (updates.length) {
    await db.execute({ sql: `UPDATE assets SET ${updates.join(', ')} WHERE id = ?`, args: [...values, id] });
  }

  if (body.costs) {
    await db.execute({ sql: 'DELETE FROM asset_costs WHERE asset_id = ?', args: [id] });
    for (const cost of body.costs) {
      await db.execute({ sql: 'INSERT INTO asset_costs (asset_id, label, amount, frequency, category) VALUES (?, ?, ?, ?, ?)', args: [id, cost.label, cost.amount, cost.frequency || 'monthly', cost.category || null] });
    }
  }

  if (body.revenues) {
    await db.execute({ sql: 'DELETE FROM asset_revenues WHERE asset_id = ?', args: [id] });
    for (const rev of body.revenues) {
      await db.execute({ sql: 'INSERT INTO asset_revenues (asset_id, label, amount, frequency) VALUES (?, ?, ?, ?)', args: [id, rev.label, rev.amount, rev.frequency || 'monthly'] });
    }
  }

  return c.json({ ok: true });
});

router.delete('/api/assets/:id', async (c) => {
  const id = c.req.param('id');
  await db.execute({ sql: 'DELETE FROM asset_costs WHERE asset_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM asset_revenues WHERE asset_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM assets WHERE id = ?', args: [id] });
  return c.json({ ok: true });
});

// ========== MANUAL ACCOUNTS ==========

router.post('/api/accounts/manual', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json() as any;
  if (!body.name) return c.json({ error: 'Name is required' }, 400);

  const result = await db.execute({
    sql: `INSERT INTO bank_accounts (user_id, company_id, provider, name, custom_name, bank_name, balance, type, usage, subtype, currency, last_sync) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [userId, body.company_id || null, body.name, body.custom_name || null, body.bank_name || body.provider_name || null, body.balance || 0, body.type || 'checking', body.usage || 'personal', classifyAccountSubtype(body.type || 'checking', 'manual', body.name), body.currency || 'EUR', new Date().toISOString()]
  });
  const account = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE id = ?', args: [Number(result.lastInsertRowid)] });
  return c.json(account.rows[0]);
});

router.post('/api/accounts/:id/update-balance', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json() as any;
  if (body.balance === undefined) return c.json({ error: 'Balance required' }, 400);
  await db.execute({ sql: 'UPDATE bank_accounts SET balance = ?, last_sync = ? WHERE id = ?', args: [body.balance, new Date().toISOString(), id] });
  const account = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE id = ?', args: [id] });
  return c.json(account.rows[0]);
});


// ========== PROPERTY ESTIMATION ==========

router.get('/api/estimation/geocode', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Address query required' }, 400);
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`);
    const data = await res.json() as any;
    return c.json((data.features || []).map((f: any) => ({
      label: f.properties.label, city: f.properties.city, postcode: f.properties.postcode,
      citycode: f.properties.citycode, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
    })));
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

router.get('/api/estimation/price', async (c) => {
  const citycode = c.req.query('citycode');
  const lat = parseFloat(c.req.query('lat') || '0');
  const lon = parseFloat(c.req.query('lon') || '0');
  const surface = parseFloat(c.req.query('surface') || '0');
  const propertyType = c.req.query('type') || 'Appartement';

  if (!citycode) return c.json({ error: 'citycode (INSEE) required' }, 400);
  if (!surface) return c.json({ error: 'surface (m²) required' }, 400);

  try {
    const result = await estimatePropertyPrice({ citycode, lat, lon, surface, propertyType });
    if (!result) return c.json({ error: 'No sales data found for this commune', estimation: null });
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

router.post('/api/estimation/refresh-all', async (c) => {
  try {
    const assetsResult = await db.execute({
      sql: `SELECT id, citycode, latitude, longitude, surface, property_type
            FROM assets
            WHERE type = 'real_estate'
              AND citycode IS NOT NULL
              AND surface IS NOT NULL
              AND surface > 0`
    });

    let updated = 0;
    let skipped = 0;
    const errors: Array<{ assetId: number; error: string }> = [];

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
        errors.push({ assetId: Number(asset.id), error: err?.message || 'unknown error' });
      }
    }

    return c.json({ ok: true, scanned: assetsResult.rows.length, updated, skipped, errors });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});


// ========== DASHBOARD HISTORY ==========

/**
 * Helper function to create patrimoine snapshot for a user on a specific date
 * @param userId - The user ID
 * @param date - ISO date string (YYYY-MM-DD), defaults to today
 * @returns Object with snapshot data
 */
async function createPatrimoineSnapshot(userId: number, date?: string) {
  const snapshotDate = date || new Date().toISOString().split('T')[0];

  const accountsResult = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE hidden = 0 AND user_id = ?', args: [userId] });
  const assetsResult = await db.execute({ sql: 'SELECT * FROM assets WHERE user_id = ?', args: [userId] });

  const categories: Record<string, number> = { checking: 0, savings: 0, investment: 0, loan: 0, real_estate: 0, vehicle: 0, valuable: 0, other: 0 };
  for (const a of accountsResult.rows as any[]) categories[a.type || 'checking'] = (categories[a.type || 'checking'] || 0) + (a.balance || 0);
  for (const a of assetsResult.rows as any[]) categories[a.type || 'other'] = (categories[a.type || 'other'] || 0) + (a.current_value || a.purchase_price || 0);

  let total = 0;
  for (const [cat, val] of Object.entries(categories)) {
    if (val !== 0) {
      await db.execute({ sql: 'INSERT OR REPLACE INTO patrimoine_snapshots (date, user_id, category, total_value) VALUES (?, ?, ?, ?)', args: [snapshotDate, userId, cat, val] });
      total += val;
    }
  }
  await db.execute({ sql: 'INSERT OR REPLACE INTO patrimoine_snapshots (date, user_id, category, total_value) VALUES (?, ?, ?, ?)', args: [snapshotDate, userId, 'total', total] });

  return { ok: true, date: snapshotDate, categories, total };
}

router.post('/api/dashboard/snapshot', async (c) => {
  const userId = await getUserId(c);
  const result = await createPatrimoineSnapshot(userId);
  return c.json(result);
});

router.get('/api/dashboard/history', async (c) => {
  const userId = await getUserId(c);
  const range = c.req.query('range') || '6m';
  const category = c.req.query('category') || 'all';

  // Auto-create snapshot for today if it doesn't exist
  const today = new Date().toISOString().split('T')[0];
  const existingSnapshot = await db.execute({
    sql: 'SELECT 1 FROM patrimoine_snapshots WHERE user_id = ? AND date = ? LIMIT 1',
    args: [userId, today]
  });

  if (existingSnapshot.rows.length === 0) {
    // No snapshot exists for today, create one
    await createPatrimoineSnapshot(userId, today);
    console.log(`📸 Auto-created snapshot for user ${userId} on ${today}`);
  }

  let daysBack = 180;
  if (range === '1m') daysBack = 30;
  else if (range === '3m') daysBack = 90;
  else if (range === '1y') daysBack = 365;
  else if (range === 'max') daysBack = 3650;

  const fromDate = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

  let result;
  if (category === 'all') {
    result = await db.execute({ sql: "SELECT date, SUM(total_value) as value FROM patrimoine_snapshots WHERE user_id = ? AND date >= ? AND category != 'total' GROUP BY date ORDER BY date", args: [userId, fromDate] });
  } else {
    result = await db.execute({ sql: 'SELECT date, total_value as value FROM patrimoine_snapshots WHERE user_id = ? AND date >= ? AND category = ? ORDER BY date', args: [userId, fromDate, category] });
  }

  // Baseline date = when the current set of accounts/assets became complete
  // (date the most recently added account or asset was created)
  const baselineResult = await db.execute({
    sql: `SELECT MAX(d) as baseline FROM (
      SELECT MAX(DATE(created_at)) as d FROM bank_accounts WHERE user_id = ? AND hidden = 0
      UNION ALL
      SELECT MAX(DATE(created_at)) as d FROM assets WHERE user_id = ?
    )`,
    args: [userId, userId]
  });
  const baselineDate = (baselineResult.rows[0]?.baseline as string) || null;

  return c.json({ history: result.rows, range, category, baselineDate });
});

// ========== BUDGET / CASHFLOW ==========

router.get('/api/budget/cashflow', async (c) => {
  const from = c.req.query('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const to = c.req.query('to') || new Date().toISOString().split('T')[0];
  const usage = c.req.query('usage');
  const company_id = c.req.query('company_id');

  let where = 't.date >= ? AND t.date <= ?';
  const args: any[] = [from, to];
  if (usage === 'personal') { where += " AND (ba.usage = 'personal' OR ba.usage IS NULL)"; }
  else if (usage === 'professional') { where += " AND ba.usage = 'professional'"; }
  else if (company_id) { where += ' AND ba.company_id = ?'; args.push(company_id); }

  const result = await db.execute({
    sql: `SELECT t.date, t.amount, t.label, t.category, ba.usage
          FROM transactions t LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE ${where} ORDER BY t.date`,
    args
  });

  let totalIncome = 0, totalExpense = 0;
  const byCategory: Record<string, { income: number; expense: number; count: number }> = {};
  const byMonth: Record<string, { income: number; expense: number }> = {};

  for (const tx of result.rows as any[]) {
    const cat = tx.category || 'Autre';
    if (!byCategory[cat]) byCategory[cat] = { income: 0, expense: 0, count: 0 };
    if (tx.amount >= 0) { totalIncome += tx.amount; byCategory[cat].income += tx.amount; }
    else { totalExpense += Math.abs(tx.amount); byCategory[cat].expense += Math.abs(tx.amount); }
    byCategory[cat].count++;

    const month = tx.date?.substring(0, 7) || 'unknown';
    if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 };
    if (tx.amount >= 0) byMonth[month].income += tx.amount;
    else byMonth[month].expense += Math.abs(tx.amount);
  }

  return c.json({
    totalIncome, totalExpense, net: totalIncome - totalExpense, byCategory,
    byMonth: Object.entries(byMonth).map(([month, data]) => ({ month, ...data })), from, to,
  });
});


// ========== PDF PATRIMOINE REPORT ==========

function formatCurrencyFR(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v || 0);
}

function escapeHtml(s: string) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildPatrimoineReportHtml(report: { sections: { title: string; items: { name: string; value: number }[]; total: number }[]; grandTotal: number; generatedAt: string }) {
  const dateLabel = report.generatedAt ? new Date(report.generatedAt).toLocaleDateString('fr-FR') : new Date().toLocaleDateString('fr-FR');
  const sectionsHtml = (report.sections || []).map((s) => `
    <h2>${escapeHtml(s.title)}</h2>
    <table>
      ${(s.items || []).map((i) => `<tr><td>${escapeHtml(i.name)}</td><td class="right">${formatCurrencyFR(Number(i.value) || 0)}</td></tr>`).join('')}
      <tr class="total-row"><td>Total ${escapeHtml(s.title)}</td><td class="right">${formatCurrencyFR(Number(s.total) || 0)}</td></tr>
    </table>
  `).join('');

  return `<!doctype html>
  <html><head><title>Déclaration de patrimoine - Konto</title>
  <meta charset="utf-8" />
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 16px; margin-top: 24px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .date { color: #888; font-size: 12px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 13px; }
    .right { text-align: right; }
    .total-row td { font-weight: bold; border-top: 2px solid #333; }
    .grand-total { margin-top: 24px; font-size: 18px; font-weight: bold; text-align: right; }
  </style></head><body>
  <h1>Déclaration de patrimoine</h1>
  <div class="date">Généré le ${dateLabel} par Konto</div>
  ${sectionsHtml}
  <div class="grand-total">Total patrimoine : ${formatCurrencyFR(report.grandTotal || 0)}</div>
  </body></html>`;
}

router.get('/api/report/patrimoine', async (c) => {
  const categoriesParam = c.req.query('categories') || 'all';
  const scopesParam = c.req.query('scopes') || '';
  const userId = await getUserId(c);

  const accountsResult = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE hidden = 0 AND user_id = ?', args: [userId] });
  const assetsResult = await db.execute({
    sql: `SELECT a.*, ba.balance as loan_balance FROM assets a LEFT JOIN bank_accounts ba ON ba.id = a.linked_loan_account_id WHERE a.user_id = ?`,
    args: [userId]
  });

  let accounts = accountsResult.rows as any[];
  let assets = assetsResult.rows as any[];

  // Apply scope filtering if scopes parameter is provided
  if (scopesParam) {
    const scopes = scopesParam.split(',');
    const wantPersonal = scopes.includes('personal');
    const wantPro = scopes.includes('pro');
    const wantedCompanyIds = scopes.filter(s => s.startsWith('company_')).map(s => parseInt(s.replace('company_', ''), 10));

    accounts = accounts.filter((a: any) => {
      if (a.company_id && wantedCompanyIds.includes(a.company_id)) return true;
      if (a.usage === 'professional' && wantPro) return true;
      if (a.usage === 'personal' && wantPersonal) return true;
      if (!a.usage && wantPersonal) return true; // default to personal
      return false;
    });

    assets = assets.filter((a: any) => {
      if (a.company_id && wantedCompanyIds.includes(a.company_id)) return true;
      if (a.usage === 'professional' && wantPro) return true;
      if (a.usage === 'personal' && wantPersonal) return true;
      if (!a.usage && wantPersonal) return true;
      return false;
    });
  }
  const wantedCategories = categoriesParam === 'all' ? ['bank', 'immobilier', 'crypto', 'stocks'] : categoriesParam.split(',');
  const sections: { title: string; items: { name: string; value: number }[]; total: number }[] = [];

  if (wantedCategories.includes('bank')) {
    const items = accounts.filter(a => a.type === 'checking' || a.type === 'savings').map(a => ({ name: a.custom_name || a.name, value: a.balance || 0 }));
    if (items.length) sections.push({ title: 'Comptes bancaires', items, total: items.reduce((s, i) => s + i.value, 0) });
  }
  if (wantedCategories.includes('immobilier')) {
    const items = assets.filter(a => a.type === 'real_estate').map(a => ({ name: a.name, value: a.current_value || a.purchase_price || 0 }));
    if (items.length) sections.push({ title: 'Immobilier', items, total: items.reduce((s, i) => s + i.value, 0) });
  }
  if (wantedCategories.includes('crypto')) {
    const items = accounts.filter(a => a.provider === 'blockchain' || a.provider === 'coinbase' || a.provider === 'binance').map(a => ({ name: a.custom_name || a.name, value: a.balance || 0 }));
    if (items.length) sections.push({ title: 'Crypto', items, total: items.reduce((s, i) => s + i.value, 0) });
  }
  if (wantedCategories.includes('stocks')) {
    const items = accounts.filter(a => a.type === 'investment' && a.provider !== 'blockchain' && a.provider !== 'coinbase').map(a => ({ name: a.custom_name || a.name, value: a.balance || 0 }));
    if (items.length) sections.push({ title: 'Actions & Fonds', items, total: items.reduce((s, i) => s + i.value, 0) });
  }

  const payload = { sections, grandTotal: sections.reduce((s, sec) => s + sec.total, 0), generatedAt: new Date().toISOString() };
  const insert = await db.execute({
    sql: 'INSERT INTO patrimoine_reports (user_id, categories, scopes, payload_json) VALUES (?, ?, ?, ?)',
    args: [userId, categoriesParam, scopesParam, JSON.stringify(payload)]
  });

  return c.json({ ...payload, report_id: Number(insert.lastInsertRowid) || null });
});

router.get('/api/report/patrimoine/last', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({
    sql: 'SELECT id, payload_json, created_at FROM patrimoine_reports WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    args: [userId]
  });
  const row = (result.rows as any[])[0];
  if (!row) return c.json({ report: null });

  let payload: any = null;
  try {
    payload = JSON.parse(String(row.payload_json || '{}'));
  } catch {
    payload = null;
  }
  if (!payload) return c.json({ report: null });
  return c.json({ report: { ...payload, id: Number(row.id), createdAt: row.created_at } });
});

router.get('/api/report/patrimoine/last/html', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({
    sql: 'SELECT payload_json FROM patrimoine_reports WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    args: [userId]
  });
  const row = (result.rows as any[])[0];
  if (!row) return c.text('No report found', 404);

  let payload: any = null;
  try {
    payload = JSON.parse(String(row.payload_json || '{}'));
  } catch {
    payload = null;
  }
  if (!payload) return c.text('Invalid report payload', 500);
  return c.html(buildPatrimoineReportHtml(payload));
});


// ========== INCOME ENTRIES ==========

router.get('/api/income', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({
    sql: `SELECT ie.*, co.name as company_name FROM income_entries ie LEFT JOIN companies co ON co.id = ie.company_id WHERE ie.user_id = ? ORDER BY ie.year DESC, ie.start_date DESC, ie.employer`,
    args: [userId]
  });
  return c.json({ entries: result.rows });
});

router.post('/api/income', async (c) => {
  const userId = await getUserId(c);
  const { year, employer, job_title, country, gross_annual, net_annual, start_date, end_date, company_id } = await c.req.json();
  if (!year || !employer || !gross_annual) return c.json({ error: 'Missing required fields' }, 400);
  const result = await db.execute({
    sql: 'INSERT INTO income_entries (user_id, year, employer, job_title, country, gross_annual, net_annual, start_date, end_date, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [userId, year, employer, job_title || null, country || 'FR', gross_annual, net_annual || null, start_date || null, end_date || null, company_id || null]
  });
  return c.json({ id: Number(result.lastInsertRowid), year, employer, job_title, country, gross_annual, net_annual, start_date, end_date, company_id });
});

router.put('/api/income/:id', async (c) => {
  const id = c.req.param('id');
  const { year, employer, job_title, country, gross_annual, net_annual, start_date, end_date, company_id } = await c.req.json();
  await db.execute({
    sql: 'UPDATE income_entries SET year=?, employer=?, job_title=?, country=?, gross_annual=?, net_annual=?, start_date=?, end_date=?, company_id=? WHERE id=?',
    args: [year, employer, job_title || null, country || 'FR', gross_annual, net_annual || null, start_date || null, end_date || null, company_id || null, id]
  });
  return c.json({ success: true });
});

router.delete('/api/income/:id', async (c) => {
  const id = c.req.param('id');
  await db.execute({ sql: 'DELETE FROM income_entries WHERE id = ?', args: [id] });
  return c.json({ success: true });
});


// ========== BILAN ANNUEL ==========

router.get('/api/bilan/:year', async (c) => {
  const year = parseInt(c.req.param('year'));
  const companyId = c.req.query('company_id');
  const usage = c.req.query('usage'); // 'personal' or 'professional'
  const userId = await getUserId(c);

  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  // Base query filter
  let accountFilter = ' AND ba.user_id = ?';
  const baseArgs: any[] = [startDate, endDate, userId];
  if (companyId) {
    accountFilter += ' AND ba.company_id = ?';
    baseArgs.push(Number(companyId));
  }
  if (usage) {
    accountFilter += ' AND ba.usage = ?';
    baseArgs.push(usage);
  }

  // Chiffre d'affaires (income)
  const caRes = await db.execute({
    sql: `SELECT COALESCE(SUM(t.amount), 0) as total
          FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
          WHERE t.date >= ? AND t.date < ? ${accountFilter} AND t.amount > 0`,
    args: baseArgs
  });
  const ca = Number(caRes.rows[0]?.total || 0);

  // Charges (expenses) by category
  const chargesRes = await db.execute({
    sql: `SELECT COALESCE(t.category, 'Non catégorisé') as category,
          SUM(ABS(t.amount)) as total, COUNT(*) as count
          FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
          WHERE t.date >= ? AND t.date < ? ${accountFilter} AND t.amount < 0
          GROUP BY t.category ORDER BY total DESC`,
    args: [...baseArgs]
  });
  const charges = chargesRes.rows.map((r: any) => ({
    category: r.category,
    total: Math.round(Number(r.total) * 100) / 100,
    count: Number(r.count)
  }));
  const totalCharges = charges.reduce((s: number, c: any) => s + c.total, 0);

  // Résultat net
  const resultatNet = Math.round((ca - totalCharges) * 100) / 100;

  // TVA analysis
  const tvaRes = await db.execute({
    sql: `SELECT
          COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount * 0.2 ELSE 0 END), 0) as tva_collectee,
          COALESCE(SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) * 0.2 ELSE 0 END), 0) as tva_deductible
          FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
          WHERE t.date >= ? AND t.date < ? ${accountFilter}`,
    args: [...baseArgs]
  });
  const tvaCollectee = Math.round(Number(tvaRes.rows[0]?.tva_collectee || 0) * 100) / 100;
  const tvaDeductible = Math.round(Number(tvaRes.rows[0]?.tva_deductible || 0) * 100) / 100;
  const tvaNette = Math.round((tvaCollectee - tvaDeductible) * 100) / 100;

  // Use invoice_cache TVA data if available
  const invoiceTvaRes = await db.execute({
    sql: `SELECT COALESCE(SUM(tva_amount), 0) as total_tva,
          COALESCE(SUM(amount_ht), 0) as total_ht
          FROM invoice_cache
          WHERE user_id = ? AND date >= ? AND date < ? AND tva_amount IS NOT NULL`,
    args: [userId, startDate, endDate]
  });
  const invoiceTva = Number(invoiceTvaRes.rows[0]?.total_tva || 0);
  const invoiceHt = Number(invoiceTvaRes.rows[0]?.total_ht || 0);

  // Monthly breakdown
  const monthlyBreakdown = [];
  for (let m = 1; m <= 12; m++) {
    const mStart = `${year}-${String(m).padStart(2, '0')}-01`;
    const mEnd = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const mArgs: any[] = [mStart, mEnd, userId];
    if (companyId) mArgs.push(Number(companyId));
    if (usage) mArgs.push(usage);

    const inc = await db.execute({
      sql: `SELECT COALESCE(SUM(t.amount), 0) as t FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE t.date >= ? AND t.date < ? ${accountFilter} AND t.amount > 0`,
      args: mArgs
    });
    const exp = await db.execute({
      sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as t FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE t.date >= ? AND t.date < ? ${accountFilter} AND t.amount < 0`,
      args: mArgs
    });
    monthlyBreakdown.push({
      month: m,
      income: Math.round(Number(inc.rows[0]?.t || 0) * 100) / 100,
      expenses: Math.round(Number(exp.rows[0]?.t || 0) * 100) / 100,
    });
  }

  // Invoice matching stats for the year
  const invStats = await db.execute({
    sql: `SELECT COUNT(*) as total,
          SUM(CASE WHEN transaction_id IS NOT NULL THEN 1 ELSE 0 END) as matched
          FROM invoice_cache WHERE user_id = ? AND date >= ? AND date < ?`,
    args: [userId, startDate, endDate]
  });
  const invTotal = Number(invStats.rows[0]?.total || 0);
  const invMatched = Number(invStats.rows[0]?.matched || 0);

  // Account balances at year end (simplified bilan actif/passif)
  const accountsWhere = ['ba.user_id = ?'];
  const accountsArgs: any[] = [userId];
  if (companyId) { accountsWhere.push('ba.company_id = ?'); accountsArgs.push(Number(companyId)); }
  if (usage) { accountsWhere.push('ba.usage = ?'); accountsArgs.push(usage); }
  const accountsRes = await db.execute({
    sql: `SELECT ba.name, ba.type, ba.balance, ba.currency
          FROM bank_accounts ba
          WHERE ${accountsWhere.join(' AND ')}
          ORDER BY ba.type, ba.name`,
    args: accountsArgs
  });

  const actif = accountsRes.rows
    .filter((a: any) => !['loan'].includes(a.type))
    .map((a: any) => ({ name: a.name, type: a.type, balance: Number(a.balance), currency: a.currency }));
  const passif = accountsRes.rows
    .filter((a: any) => ['loan'].includes(a.type))
    .map((a: any) => ({ name: a.name, type: a.type, balance: Math.abs(Number(a.balance)), currency: a.currency }));

  const totalActif = actif.reduce((s: number, a: any) => s + a.balance, 0);
  const totalPassif = passif.reduce((s: number, a: any) => s + a.balance, 0);

  return c.json({
    year,
    company_id: companyId ? Number(companyId) : null,
    compte_de_resultat: {
      chiffre_affaires: Math.round(ca * 100) / 100,
      charges: { total: Math.round(totalCharges * 100) / 100, details: charges },
      resultat_net: resultatNet,
    },
    tva: {
      collectee: tvaCollectee,
      deductible: tvaDeductible,
      nette: tvaNette,
      from_invoices: invoiceTva > 0 ? { tva: Math.round(invoiceTva * 100) / 100, ht: Math.round(invoiceHt * 100) / 100 } : null,
    },
    bilan: {
      actif: { items: actif, total: Math.round(totalActif * 100) / 100 },
      passif: { items: passif, total: Math.round(totalPassif * 100) / 100 },
      capitaux_propres: Math.round((totalActif - totalPassif) * 100) / 100,
    },
    monthly_breakdown: monthlyBreakdown,
    justificatifs: {
      total: invTotal,
      matched: invMatched,
      match_rate: invTotal > 0 ? Math.round((invMatched / invTotal) * 100) : null,
    },
  });
});

// ========== BILAN PRO (consolidated per-company) ==========

router.get('/api/bilan-pro/:year', async (c) => {
  const year = parseInt(c.req.param('year'));
  const userId = await getUserId(c);
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  // Get all companies for this user
  const companiesRes = await db.execute({
    sql: `SELECT id, name FROM companies WHERE user_id = ? ORDER BY name`,
    args: [userId],
  });

  const summaries = await Promise.all(
    companiesRes.rows.map(async (company: any) => {
      const caRes = await db.execute({
        sql: `SELECT COALESCE(SUM(t.amount), 0) as total
              FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
              WHERE t.date >= ? AND t.date < ? AND ba.company_id = ? AND t.amount > 0`,
        args: [startDate, endDate, company.id],
      });
      const chargesRes = await db.execute({
        sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total
              FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
              WHERE t.date >= ? AND t.date < ? AND ba.company_id = ? AND t.amount < 0`,
        args: [startDate, endDate, company.id],
      });
      const ca = Math.round(Number(caRes.rows[0]?.total || 0) * 100) / 100;
      const charges = Math.round(Number(chargesRes.rows[0]?.total || 0) * 100) / 100;
      return {
        company_id: Number(company.id),
        name: String(company.name),
        ca,
        charges,
        resultat: Math.round((ca - charges) * 100) / 100,
      };
    })
  );

  const total = {
    ca: Math.round(summaries.reduce((s, c) => s + c.ca, 0) * 100) / 100,
    charges: Math.round(summaries.reduce((s, c) => s + c.charges, 0) * 100) / 100,
    resultat: Math.round(summaries.reduce((s, c) => s + c.resultat, 0) * 100) / 100,
  };

  // Monthly breakdown — consolidated across all company accounts
  const companyIds = companiesRes.rows.map((row: any) => Number(row.id));
  const monthly_breakdown = [];
  for (let m = 1; m <= 12; m++) {
    const mStart = `${year}-${String(m).padStart(2, '0')}-01`;
    const mEnd = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
    if (companyIds.length === 0) {
      monthly_breakdown.push({ month: m, income: 0, expenses: 0 });
      continue;
    }
    const placeholders = companyIds.map(() => '?').join(',');
    const incRes = await db.execute({
      sql: `SELECT COALESCE(SUM(t.amount), 0) as t FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE t.date >= ? AND t.date < ? AND ba.company_id IN (${placeholders}) AND t.amount > 0`,
      args: [mStart, mEnd, ...companyIds],
    });
    const expRes = await db.execute({
      sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as t FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE t.date >= ? AND t.date < ? AND ba.company_id IN (${placeholders}) AND t.amount < 0`,
      args: [mStart, mEnd, ...companyIds],
    });
    monthly_breakdown.push({
      month: m,
      income: Math.round(Number(incRes.rows[0]?.t || 0) * 100) / 100,
      expenses: Math.round(Number(expRes.rows[0]?.t || 0) * 100) / 100,
    });
  }

  return c.json({ year, companies: summaries, total, monthly_breakdown });
});


// ========== KOZY INTEGRATION ==========

router.get('/api/kozy/properties', async (c) => {
  // Proxy to Kozy external API — in production this would use Clerk JWT
  // For now, fetch from Kozy backend directly
  const KOZY_API = process.env.KOZY_API_URL || 'http://127.0.0.1:5174';
  try {
    const res = await fetch(`${KOZY_API}/api/external/properties`, {
      headers: { 'Authorization': c.req.header('Authorization') || '' },
    });
    if (!res.ok) return c.json({ properties: [] });
    const data = await res.json();
    return c.json(data);
  } catch {
    return c.json({ properties: [] });
  }
});

// ========== PROPERTY ROI — Smoobu Revenue vs Bank Costs ==========

const SMOOBU_API = 'https://login.smoobu.com/api';
const SMOOBU_API_KEY = process.env.SMOOBU_API_KEY || '';

// Property cost matching patterns (label keywords → apartment ID)
const PROPERTY_COST_PATTERNS: { apartmentId: number; patterns: string[] }[] = [
  { apartmentId: 1981817, patterns: ['maison', '33854'] },
  { apartmentId: 1981820, patterns: ['480589', 'balcon'] },
  { apartmentId: 2105584, patterns: ['480570', 'jardin'] },
];

router.get('/api/properties/roi', async (c) => {
  if (!SMOOBU_API_KEY) return c.json({ error: 'SMOOBU_API_KEY not configured' }, 500);

  const monthsParam = parseInt(c.req.query('months') || '6');
  const now = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth() - monthsParam + 1, 1);
  const fromStr = fromDate.toISOString().split('T')[0];
  const toStr = now.toISOString().split('T')[0];

  // Fetch Smoobu apartments
  const aptRes = await fetch(`${SMOOBU_API}/apartments`, { headers: { 'Api-Key': SMOOBU_API_KEY } });
  const aptData = await aptRes.json() as any;
  const apartments = aptData.apartments || [];

  // Fetch all bookings (paginated)
  let allBookings: any[] = [];
  let page = 1;
  let pageCount = 1;
  while (page <= pageCount) {
    const bkRes = await fetch(`${SMOOBU_API}/reservations?from=${fromStr}&to=${toStr}&pageSize=100&page=${page}`, {
      headers: { 'Api-Key': SMOOBU_API_KEY }
    });
    const bkData = await bkRes.json() as any;
    allBookings.push(...(bkData.bookings || []));
    pageCount = bkData.page_count || 1;
    page++;
  }

  // Calculate revenue per apartment per month
  const revenueByApt: Record<number, { total: number; byMonth: Record<string, number>; nights: number; bookingCount: number }> = {};
  for (const apt of apartments) {
    revenueByApt[apt.id] = { total: 0, byMonth: {}, nights: 0, bookingCount: 0 };
  }

  for (const b of allBookings) {
    if (b.type === 'cancellation') continue;
    const aptId = b.apartment?.id;
    if (!aptId || !revenueByApt[aptId]) continue;
    const price = b.price || 0;
    if (price <= 0) continue;
    const arrival = b.arrival;
    const departure = b.departure;
    const month = arrival?.substring(0, 7);
    if (!month) continue;
    const nights = Math.max(1, Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 86400000));
    revenueByApt[aptId].total += price;
    revenueByApt[aptId].byMonth[month] = (revenueByApt[aptId].byMonth[month] || 0) + price;
    revenueByApt[aptId].nights += nights;
    revenueByApt[aptId].bookingCount++;
  }

  // Fetch bank transactions for cost matching
  const userId = await getUserId(c);
  const txResult = await db.execute({
    sql: `SELECT t.date, t.amount, t.label FROM transactions t
          LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE t.date >= ? AND t.amount < 0 AND ba.user_id = ?`,
    args: [fromStr, userId]
  });

  // Match costs to properties
  const costsByApt: Record<number, { total: number; byMonth: Record<string, number>; matched: { label: any; amount: number; date: string }[] }> = {};
  for (const apt of apartments) {
    costsByApt[apt.id] = { total: 0, byMonth: {}, matched: [] };
  }

  for (const tx of txResult.rows as any[]) {
    const label = (tx.label || '').toLowerCase();
    for (const pattern of PROPERTY_COST_PATTERNS) {
      if (pattern.patterns.some(p => label.includes(p))) {
        const month = tx.date?.substring(0, 7);
        const amount = Math.abs(tx.amount);
        costsByApt[pattern.apartmentId].total += amount;
        if (month) costsByApt[pattern.apartmentId].byMonth[month] = (costsByApt[pattern.apartmentId].byMonth[month] || 0) + amount;
        costsByApt[pattern.apartmentId].matched.push({label: tx.label, amount, date: tx.date.substring(0,10)});
        break;
      }
    }
  }

  // Calculate occupancy rate (nights booked / total possible nights)
  const totalDays = Math.round((now.getTime() - fromDate.getTime()) / 86400000);

  // Build response
  const properties = apartments.map((apt: any) => {
    const rev = revenueByApt[apt.id] || { total: 0, byMonth: {}, nights: 0, bookingCount: 0 };
    const costs = costsByApt[apt.id] || { total: 0, byMonth: {}, matched: [] };
    const net = rev.total - costs.total;
    const occupancyRate = totalDays > 0 ? Math.round((rev.nights / totalDays) * 100) : 0;
    const monthlyRevenue = monthsParam > 0 ? Math.round(rev.total / monthsParam) : 0;
    const monthlyCosts = monthsParam > 0 ? Math.round(costs.total / monthsParam) : 0;

    return {
      id: apt.id,
      name: apt.name,
      revenue: Math.round(rev.total * 100) / 100,
      costs: Math.round(costs.total * 100) / 100,
      net: Math.round(net * 100) / 100,
      monthlyRevenue,
      monthlyCosts,
      monthlyNet: monthlyRevenue - monthlyCosts,
      occupancyRate,
      nights: rev.nights,
      bookings: rev.bookingCount,
      revenueByMonth: rev.byMonth,
      costsByMonth: costs.byMonth,
      matchedCosts: costs.matched,
    };
  });

  const totalRevenue = properties.reduce((s: number, p: any) => s + p.revenue, 0);
  const totalCosts = properties.reduce((s: number, p: any) => s + p.costs, 0);

  return c.json({
    properties,
    summary: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalCosts: Math.round(totalCosts * 100) / 100,
      totalNet: Math.round((totalRevenue - totalCosts) * 100) / 100,
      propertyCount: properties.length,
    },
    period: { from: fromStr, to: toStr, months: monthsParam },
  });
});



export default router;
