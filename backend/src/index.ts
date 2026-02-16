import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { verifyToken } from '@clerk/backend';
import db, { initDatabase, migrateDatabase, ensureUser } from './db.js';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';

// Import cron jobs - these will start automatically when imported
import './jobs/createDailySnapshots.js';
import './jobs/refreshStaleConnections.js';
import { cronMonitor } from './jobs/cronMonitor.js';

const bip32 = BIP32Factory(ecc);

const app = new Hono();

app.use('/*', cors());

// --- Clerk Auth Middleware ---
// If CLERK_SECRET_KEY is set, validate Clerk JWTs on all /api/* routes.
// Falls back to unauthenticated access (default user) if Clerk is not configured.
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

app.use('/api/*', async (c, next) => {
  if (!CLERK_SECRET_KEY) return next(); // No Clerk → legacy mode (no auth)

  // Public endpoints that don't need auth
  const path = c.req.path;
  if (path === '/api/health' || path === '/api/bank-callback' || path === '/api/coinbase-callback' || path === '/api/preferences') return next();

  const authHeader = c.req.header('Authorization');

  // Allow API token access for agents (backward compatible)
  const API_TOKEN = process.env.API_TOKEN;
  if (API_TOKEN && authHeader === `Bearer ${API_TOKEN}`) {
    return next();
  }

  // Verify Clerk JWT
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const payload = await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
      (c as any).clerkUserId = payload.sub;
      return next();
    } catch {
      // Invalid token — fall through to 401
    }
  }

  return c.json({ error: 'Unauthorized' }, 401);
});

// --- Config ---
const POWENS_CLIENT_ID = process.env.POWENS_CLIENT_ID || '91825215';
const POWENS_CLIENT_SECRET = process.env.POWENS_CLIENT_SECRET || '';
const POWENS_DOMAIN = process.env.POWENS_DOMAIN || 'kompta-sandbox.biapi.pro';
const POWENS_API = `https://${POWENS_DOMAIN}/2.0`;
const REDIRECT_URI = process.env.POWENS_REDIRECT_URI || 'https://65.108.14.251:8080/konto/api/bank-callback';

// --- Account classification helpers ---
const SAVINGS_TYPES = new Set(['savings', 'deposit', 'livreta', 'livretb', 'ldds', 'cel', 'pel']);
const INVESTMENT_TYPES = new Set(['market', 'pea', 'pee', 'per', 'perco', 'perp', 'lifeinsurance', 'madelin', 'capitalisation', 'crowdlending', 'realEstate', 'article83']);
const LOAN_TYPES = new Set(['loan']);

function classifyAccountType(powensType: string | undefined, name: string): string {
  if (powensType) {
    if (powensType === 'checking' || powensType === 'card') return 'checking';
    if (SAVINGS_TYPES.has(powensType)) return 'savings';
    if (LOAN_TYPES.has(powensType)) return 'loan';
    if (INVESTMENT_TYPES.has(powensType)) return 'investment';
    return powensType;
  }
  const lower = (name || '').toLowerCase();
  if (lower.includes('livret') || lower.includes('épargne') || lower.includes('epargne') || lower.includes('ldd')) return 'savings';
  if (lower.includes('pea') || lower.includes('per ') || lower.includes('assurance')) return 'investment';
  if (lower.includes('prêt') || lower.includes('pret') || lower.includes('crédit') || lower.includes('credit') || lower.includes('loan') || lower.includes('immo')) return 'loan';
  return 'checking';
}

function classifyAccountSubtype(type: string, provider: string | undefined, name: string): string | null {
  if (type !== 'investment') return null;
  if (provider === 'blockchain' || provider === 'coinbase' || provider === 'binance') return 'crypto';
  const lower = (name || '').toLowerCase();
  if (lower.includes('pea') || lower.includes('action') || lower.includes('bourse') || lower.includes('trading') || lower.includes('stock')) return 'stocks';
  if (lower.includes('or ') || lower.includes('gold') || lower.includes('métaux') || lower.includes('metaux')) return 'gold';
  return 'other';
}

function classifyAccountUsage(powensUsage: string | undefined | null, companyId: number | null): string {
  if (powensUsage === 'professional') return 'professional';
  if (powensUsage === 'private') return 'personal';
  return companyId ? 'professional' : 'personal';
}


// --- Helper: get authenticated user ID ---
async function getUserId(c: any): Promise<number> {
  const clerkId = c.clerkUserId;
  if (clerkId) {
    return ensureUser(clerkId);
  }
  // Legacy/API-token mode: use default user (id=1)
  const result = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: ['jo@konto.fr'] });
  if (result.rows.length > 0) return result.rows[0].id as number;
  const ins = await db.execute({ sql: 'INSERT INTO users (email, name, role) VALUES (?, ?, ?)', args: [process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com', process.env.DEFAULT_ADMIN_NAME || 'Admin', 'admin'] });
  return Number(ins.lastInsertRowid);
}

// --- Helper: refresh Powens token ---
async function refreshPowensToken(connectionId: number): Promise<string | null> {
  const connResult = await db.execute({
    sql: 'SELECT powens_refresh_token FROM bank_connections WHERE id = ?',
    args: [connectionId]
  });
  const conn = connResult.rows[0] as any;

  if (!conn?.powens_refresh_token) {
    console.log(`No refresh token for connection ${connectionId}`);
    return null;
  }

  try {
    console.log(`Attempting to refresh token for connection ${connectionId}`);
    const tokenRes = await fetch(`${POWENS_API}/auth/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: POWENS_CLIENT_ID,
        client_secret: POWENS_CLIENT_SECRET,
        refresh_token: conn.powens_refresh_token
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      console.error(`Token refresh failed for connection ${connectionId}:`, errorText);
      // Mark connection as expired
      await db.execute({
        sql: 'UPDATE bank_connections SET status = ? WHERE id = ?',
        args: ['expired', connectionId]
      });
      return null;
    }

    const tokenData = await tokenRes.json() as any;
    const newAccessToken = tokenData.access_token || tokenData.token;
    const newRefreshToken = tokenData.refresh_token || conn.powens_refresh_token;

    // Update connection with new tokens
    await db.execute({
      sql: 'UPDATE bank_connections SET powens_token = ?, powens_refresh_token = ?, status = ? WHERE id = ?',
      args: [newAccessToken, newRefreshToken, 'active', connectionId]
    });

    console.log(`Token refreshed successfully for connection ${connectionId}`);
    return newAccessToken;
  } catch (err: any) {
    console.error(`Token refresh error for connection ${connectionId}:`, err.message);
    return null;
  }
}

// --- Health ---
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Cron jobs health check endpoint
app.get('/api/health/cron', (c) => {
  const jobs = cronMonitor.getAllJobs();
  const healthy = cronMonitor.isHealthy();

  return c.json({
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    jobs,
  });
});

// --- Users ---
app.get('/api/users', async (c) => {
  const result = await db.execute('SELECT * FROM users');
  return c.json(result.rows);
});

// --- Companies ---
app.get('/api/companies', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({ sql: 'SELECT * FROM companies WHERE user_id = ?', args: [userId] });
  return c.json(result.rows);
});

app.post('/api/companies', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();
  const result = await db.execute({
    sql: 'INSERT INTO companies (user_id, name, siren, legal_form, address, naf_code, capital) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [userId, body.name, body.siren || null, body.legal_form || null, body.address || null, body.naf_code || null, body.capital || null]
  });
  return c.json({ id: Number(result.lastInsertRowid), ...body });
});

app.patch('/api/companies/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const fields = ['name', 'siren', 'legal_form', 'address', 'naf_code', 'capital'];
  const updates: string[] = [];
  const params: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(body[f]); }
  }
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  params.push(id);
  await db.execute({ sql: `UPDATE companies SET ${updates.join(', ')} WHERE id = ?`, args: params });
  const updated = await db.execute({ sql: 'SELECT * FROM companies WHERE id = ?', args: [id] });
  return c.json(updated.rows[0]);
});

app.delete('/api/companies/:id', async (c) => {
  const id = c.req.param('id');
  await db.execute({ sql: "UPDATE bank_accounts SET company_id = NULL, usage = 'personal' WHERE company_id = ?", args: [id] });
  await db.execute({ sql: 'DELETE FROM companies WHERE id = ?', args: [id] });
  return c.json({ ok: true });
});

app.post('/api/companies/:id/unlink-all', async (c) => {
  const id = c.req.param('id');
  await db.execute({ sql: "UPDATE bank_accounts SET company_id = NULL, usage = 'personal' WHERE company_id = ?", args: [id] });
  return c.json({ ok: true });
});

// --- Company search ---
app.get('/api/companies/search', async (c) => {
  const q = c.req.query('q');
  if (!q || q.length < 2) return c.json({ results: [] });
  try {
    const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&page=1&per_page=5`);
    const data = await res.json() as any;
    const results = (data.results || []).map((r: any) => {
      const latestFinances = r.finances ? Object.entries(r.finances).sort(([a]: any, [b]: any) => b - a)[0] : null;
      return {
        siren: r.siren, name: r.nom_complet, siret: r.siege?.siret,
        naf_code: r.activite_principale, address: r.siege?.adresse,
        date_creation: r.date_creation, legal_form: r.nature_juridique,
        commune: r.siege?.libelle_commune, code_postal: r.siege?.code_postal,
        categorie: r.categorie_entreprise,
        etat: r.siege?.etat_administratif === 'A' ? 'active' : 'fermée',
        dirigeants: (r.dirigeants || []).slice(0, 3).map((d: any) => ({
          nom: `${d.prenoms || ''} ${d.nom || ''}`.trim(), qualite: d.qualite,
        })),
        finances: latestFinances ? {
          year: latestFinances[0], ca: (latestFinances[1] as any)?.ca,
          resultat_net: (latestFinances[1] as any)?.resultat_net,
        } : null,
        effectif: r.tranche_effectif_salarie,
      };
    });
    return c.json({ results });
  } catch (err: any) {
    return c.json({ results: [], error: err.message });
  }
});

// --- Powens: Get connect URL ---
app.get('/api/bank/connect-url', (c) => {
  const url = `https://webview.powens.com/connect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  return c.json({ url });
});

// --- Powens: OAuth callback ---
app.get('/api/bank-callback', async (c) => {
  const code = c.req.query('code');
  const connectionId = c.req.query('connection_id');
  const error = c.req.query('error');

  if (error) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Connection failed</h1><p>${error}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }
  if (!code) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">No code received</h1>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }

  try {
    const tokenRes = await fetch(`${POWENS_API}/auth/token/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: POWENS_CLIENT_ID, client_secret: POWENS_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) throw new Error(tokenData.message || 'Token exchange failed');

    const accessToken = tokenData.access_token || tokenData.token;
    const refreshToken = tokenData.refresh_token || null;
    const userId = await getUserId(c);

    console.log('Powens token received:', { has_access: !!accessToken, has_refresh: !!refreshToken, expires_in: tokenData.expires_in });

    await db.execute({
      sql: 'INSERT INTO bank_connections (user_id, powens_connection_id, powens_token, powens_refresh_token, status) VALUES (?, ?, ?, ?, ?)',
      args: [userId, connectionId || null, accessToken, refreshToken, 'active']
    });

    let accounts: any[] = [];
    try {
      const accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      const accountsData = await accountsRes.json() as any;
      accounts = accountsData.accounts || [];

      for (const acc of accounts) {
        const accType = classifyAccountType(acc.type, acc.name || acc.original_name || '');
        const accNumber = acc.number || acc.webid || null;
        const accIban = acc.iban || null;

        // Match existing account by: 1) same provider_account_id, 2) same iban, 3) same account_number
        let existing = await db.execute({ sql: 'SELECT id FROM bank_accounts WHERE provider_account_id = ?', args: [String(acc.id)] });
        if (existing.rows.length === 0 && accIban) {
          existing = await db.execute({ sql: 'SELECT id FROM bank_accounts WHERE user_id = ? AND provider = ? AND iban = ?', args: [userId, 'powens', accIban] });
        }
        if (existing.rows.length === 0 && accNumber) {
          existing = await db.execute({ sql: 'SELECT id FROM bank_accounts WHERE user_id = ? AND provider = ? AND account_number = ?', args: [userId, 'powens', accNumber] });
        }

        let bankAccountId: number;
        if (existing.rows.length === 0) {
          const ins = await db.execute({
            sql: 'INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, bank_name, account_number, iban, balance, type, usage, subtype, last_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [userId, null, 'powens', String(acc.id), acc.name || acc.original_name || 'Account', acc.bic || null, accNumber, accIban, acc.balance || 0, accType, classifyAccountUsage(acc.usage, null), classifyAccountSubtype(accType, 'powens', acc.name || acc.original_name || ''), new Date().toISOString()]
          });
          bankAccountId = Number(ins.lastInsertRowid);
        } else {
          bankAccountId = (existing.rows[0] as any).id;
          // Update existing account: new provider_account_id, balance, last_sync
          await db.execute({
            sql: 'UPDATE bank_accounts SET provider_account_id = ?, balance = ?, last_sync = ? WHERE id = ?',
            args: [String(acc.id), acc.balance || 0, new Date().toISOString(), bankAccountId]
          });
        }

        // Sync investments for investment accounts
        if (accType === 'investment') {
          try {
            const invRes = await fetch(`${POWENS_API}/users/me/accounts/${acc.id}/investments`, {
              headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            if (invRes.ok) {
              const invData = await invRes.json() as any;
              for (const inv of (invData.investments || [])) {
                await db.execute({
                  sql: `INSERT INTO investments (bank_account_id, provider_investment_id, label, isin_code, code_type, quantity, unit_price, unit_value, valuation, diff, diff_percent, portfolio_share, currency, vdate, last_update)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(bank_account_id, isin_code) DO UPDATE SET
                          label=excluded.label, quantity=excluded.quantity, unit_price=excluded.unit_price,
                          unit_value=excluded.unit_value, valuation=excluded.valuation, diff=excluded.diff,
                          diff_percent=excluded.diff_percent, portfolio_share=excluded.portfolio_share,
                          vdate=excluded.vdate, last_update=excluded.last_update`,
                  args: [
                    bankAccountId, String(inv.id), inv.label || 'Unknown', inv.code || null,
                    inv.code_type || 'ISIN', inv.quantity || 0, inv.unitprice || 0,
                    inv.original_unitvalue || inv.unitvalue || 0, inv.valuation || 0,
                    inv.diff || 0, inv.diff_percent || 0, inv.portfolio_share || 0,
                    inv.original_currency?.id || 'EUR', inv.vdate || null,
                    inv.last_update || new Date().toISOString(),
                  ]
                });
              }
              console.log(`Synced ${(invData.investments || []).length} investments for account ${acc.id}`);
            }
          } catch (e: any) {
            console.error(`Failed to sync investments for account ${acc.id}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch accounts:', e);
    }

    return c.html(`<html><head><meta http-equiv="refresh" content="15;url=/konto/accounts"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#d4a812;">✅ Bank connected!</h1><p>${accounts.length} account(s) synced.</p>
      <p style="color:#888;font-size:14px;">Redirecting in <span id="t">15</span>s...</p>
      <a href="/konto/accounts" style="color:#d4a812;font-size:18px;">← Back to Konto</a>
      <script>let s=15;setInterval(()=>{s--;if(s>=0)document.getElementById('t').textContent=s;},1000);</script>
    </body></html>`);
  } catch (err: any) {
    console.error('Powens callback error:', err);
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1><p>${err.message}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }
});

// --- Bank connections ---
app.get('/api/bank/connections', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({ sql: 'SELECT * FROM bank_connections WHERE user_id = ?', args: [userId] });
  return c.json(result.rows);
});

// --- Sync all accounts ---
app.post('/api/bank/sync', async (c) => {
  const userId = await getUserId(c);
  const connections = await db.execute({ sql: "SELECT * FROM bank_connections WHERE status = ? AND user_id = ?", args: ['active', userId] });
  let totalSynced = 0;

  for (const conn of connections.rows as any[]) {
    try {
      const res = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${conn.powens_token}` },
      });
      const data = await res.json() as any;
      const accounts = data.accounts || [];

      for (const acc of accounts) {
        const existing = await db.execute({ sql: 'SELECT id FROM bank_accounts WHERE provider_account_id = ?', args: [String(acc.id)] });
        if (existing.rows.length > 0) {
          const full = await db.execute({ sql: 'SELECT company_id FROM bank_accounts WHERE id = ?', args: [existing.rows[0].id as number] });
          const row = full.rows[0] as any;
          await db.execute({
            sql: 'UPDATE bank_accounts SET balance = ?, last_sync = ?, type = ?, usage = ? WHERE id = ?',
            args: [acc.balance || 0, new Date().toISOString(), classifyAccountType(acc.type, acc.name || acc.original_name || ''), classifyAccountUsage(acc.usage, row?.company_id || null), existing.rows[0].id as number]
          });
        } else {
          await db.execute({
            sql: 'INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, bank_name, account_number, iban, balance, last_sync, type, usage, subtype) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [userId, null, 'powens', String(acc.id), acc.name || acc.original_name || 'Account', acc.bic || null, acc.number || acc.webid || null, acc.iban || null, acc.balance || 0, new Date().toISOString(), classifyAccountType(acc.type, acc.name || acc.original_name || ''), classifyAccountUsage(acc.usage, null), classifyAccountSubtype(classifyAccountType(acc.type, acc.name || acc.original_name || ''), 'powens', acc.name || acc.original_name || '')]
          });
        }
        totalSynced++;
      }
    } catch (err: any) {
      console.error(`Sync failed for connection ${conn.id}:`, err.message);
    }
  }
  return c.json({ synced: totalSynced });
});

// --- Dashboard ---
app.get('/api/dashboard', async (c) => {
  const userId = await getUserId(c);
  const usage = c.req.query('usage');
  const companyId = c.req.query('company_id');
  let accountWhere = 'hidden = 0 AND user_id = ?';
  const accountParams: any[] = [userId];
  if (usage === 'personal') { accountWhere += ' AND usage = ?'; accountParams.push('personal'); }
  else if (usage === 'professional') { accountWhere += ' AND usage = ?'; accountParams.push('professional'); }
  else if (companyId) { accountWhere += ' AND company_id = ?'; accountParams.push(companyId); }

  const accountsResult = await db.execute({ sql: `SELECT * FROM bank_accounts WHERE ${accountWhere}`, args: accountParams });
  const accounts = accountsResult.rows as any[];
  const companiesResult = await db.execute({ sql: 'SELECT COUNT(*) as count FROM companies WHERE user_id = ?', args: [userId] });
  const companyCount = (companiesResult.rows[0] as any)?.count || 0;

  const accountsByType: Record<string, any[]> = { checking: [], savings: [], investment: [], loan: [] };
  for (const a of accounts) {
    const type = a.type || 'checking';
    if (!accountsByType[type]) accountsByType[type] = [];
    accountsByType[type].push({ id: a.id, name: a.custom_name || a.name, balance: a.balance || 0, type, currency: a.currency || 'EUR' });
  }

  const brutBalance = [...accountsByType.checking, ...accountsByType.savings, ...accountsByType.investment]
    .reduce((sum: number, a: any) => sum + a.balance, 0);
  const loanTotal = accountsByType.loan.reduce((sum: number, a: any) => sum + a.balance, 0);
  const netBalance = brutBalance + loanTotal;

  let personalBalance = 0, proBalance = 0;
  for (const a of accounts) {
    if (a.type === 'loan') continue;
    if (a.usage === 'professional') proBalance += (a.balance || 0);
    else personalBalance += (a.balance || 0);
  }

  let assetWhere = 'a.user_id = ?';
  const assetParams: any[] = [userId];
  if (usage === 'personal') { assetWhere += ' AND a.usage = ?'; assetParams.push('personal'); }
  else if (usage === 'professional') { assetWhere += ' AND a.usage = ?'; assetParams.push('professional'); }
  else if (companyId) { assetWhere += ' AND a.company_id = ?'; assetParams.push(companyId); }
  const assetsResult = await db.execute({
    sql: `SELECT a.id, a.type, a.name, a.current_value, a.purchase_price, ba.balance as loan_balance
          FROM assets a LEFT JOIN bank_accounts ba ON ba.id = a.linked_loan_account_id WHERE ${assetWhere}`,
    args: assetParams
  });
  const assets = assetsResult.rows as any[];

  const patrimoineBrut = assets.reduce((sum: number, a: any) => sum + (a.current_value || a.purchase_price || 0), 0);
  const patrimoineLoans = assets.reduce((sum: number, a: any) => sum + (a.loan_balance || 0), 0);
  const patrimoineNet = patrimoineBrut + patrimoineLoans;

  return c.json({
    financial: { brutBalance, netBalance, accountsByType },
    patrimoine: {
      brutValue: patrimoineBrut, netValue: patrimoineNet, count: assets.length,
      assets: assets.map((a: any) => ({ id: a.id, type: a.type, name: a.name, currentValue: a.current_value || a.purchase_price || 0, loanBalance: a.loan_balance || 0 })),
    },
    totals: { brut: brutBalance + patrimoineBrut, net: netBalance + patrimoineNet },
    accountCount: accounts.length, companyCount,
    distribution: { personal: personalBalance, pro: proBalance },
  });
});

// --- Bank accounts ---
app.get('/api/bank/accounts', async (c) => {
  const userId = await getUserId(c);
  const usage = c.req.query('usage');
  const companyId = c.req.query('company_id');
  let where = 'user_id = ?';
  const params: any[] = [userId];
  if (usage === 'personal') { where += ' AND usage = ?'; params.push('personal'); }
  else if (usage === 'professional') { where += ' AND usage = ?'; params.push('professional'); }
  else if (companyId) { where += ' AND company_id = ?'; params.push(companyId); }
  const result = await db.execute({ sql: `SELECT * FROM bank_accounts WHERE ${where}`, args: params });

  // Check if user has any active powens connections
  const activeConns = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM bank_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  const hasActivePowens = (activeConns.rows[0] as any).cnt > 0;

  const rows = (result.rows as any[]).map(row => ({
    ...row,
    connection_expired: row.provider === 'powens' && !hasActivePowens ? 1 : 0
  }));

  return c.json(rows);
});

app.patch('/api/bank/accounts/:id', async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: string[] = [];
  const params: any[] = [];

  if (body.custom_name !== undefined) { updates.push('custom_name = ?'); params.push(body.custom_name); }
  if (body.hidden !== undefined) { updates.push('hidden = ?'); params.push(body.hidden ? 1 : 0); }
  if (body.type !== undefined) { updates.push('type = ?'); params.push(body.type); }
  if (body.usage !== undefined) { updates.push('usage = ?'); params.push(body.usage); }
  if (body.subtype !== undefined) { updates.push('subtype = ?'); params.push(body.subtype); }
  if (body.balance !== undefined) { updates.push('balance = ?'); params.push(body.balance); updates.push('last_sync = ?'); params.push(new Date().toISOString()); }
  if (body.company_id !== undefined) {
    updates.push('company_id = ?'); params.push(body.company_id);
    updates.push('usage = ?'); params.push(body.company_id ? 'professional' : 'personal');
  }

  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  params.push(id, userId);
  await db.execute({ sql: `UPDATE bank_accounts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, args: params });
  const updated = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?', args: [id, userId] });
  return c.json(updated.rows[0]);
});

app.delete('/api/bank/accounts/:id', async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param('id');
  await db.execute({ sql: 'DELETE FROM transactions WHERE bank_account_id = ? AND bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)', args: [id, userId] });
  await db.execute({ sql: 'DELETE FROM bank_accounts WHERE id = ? AND user_id = ?', args: [id, userId] });
  return c.json({ ok: true });
});

// --- Transactions ---
app.get('/api/transactions', async (c) => {
  const userId = await getUserId(c);
  const accountId = c.req.query('account_id');
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search');
  const usage = c.req.query('usage');
  const companyId = c.req.query('company_id');

  let where = 'ba.user_id = ?';
  const params: any[] = [userId];

  if (accountId) { where += ' AND t.bank_account_id = ?'; params.push(accountId); }
  if (search) { where += ' AND t.label LIKE ?'; params.push(`%${search}%`); }
  if (usage === 'personal') { where += ' AND ba.usage = ?'; params.push('personal'); }
  else if (usage === 'professional') { where += ' AND ba.usage = ?'; params.push('professional'); }
  else if (companyId) { where += ' AND ba.company_id = ?'; params.push(companyId); }

  const totalResult = await db.execute({ sql: `SELECT COUNT(*) as count FROM transactions t LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id WHERE ${where}`, args: params });
  const total = (totalResult.rows[0] as any).count;

  const rows = await db.execute({
    sql: `SELECT t.*, ba.name as account_name, ba.custom_name as account_custom_name
          FROM transactions t LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE ${where} ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?`,
    args: [...params, limit, offset]
  });

  return c.json({ transactions: rows.rows, total, limit, offset });
});

// --- Company info from SIREN ---
app.get('/api/companies/info/:siren', async (c) => {
  const siren = c.req.param('siren').replace(/\s/g, '');
  if (!/^\d{9}$/.test(siren)) return c.json({ error: 'Invalid SIREN' }, 400);

  try {
    const gouvRes = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`);
    const gouvData = await gouvRes.json() as any;
    const company = gouvData.results?.[0];
    if (!company || company.siren !== siren) return c.json({ error: 'Company not found' }, 404);

    const siege = company.siege || {};
    const sirenNum = parseInt(siren, 10);
    const tvaKey = (12 + 3 * (sirenNum % 97)) % 97;
    const tvaNumber = `FR${String(tvaKey).padStart(2, '0')}${siren}`;

    let capitalSocial: number | null = null;
    let pappersData: any = null;
    const pappersToken = process.env.PAPPERS_API_TOKEN;

    if (pappersToken) {
      try {
        const pRes = await fetch(`https://api.pappers.fr/v2/entreprise?siren=${siren}&api_token=${pappersToken}`);
        if (pRes.ok) pappersData = await pRes.json();
        if (pappersData?.capital) capitalSocial = pappersData.capital;
      } catch {}
    }

    let scrapedData: Record<string, string> = {};
    try {
      const slug = (company.nom_complet || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const url = `https://www.societe.com/societe/${slug}-${siren}.html`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } });
      const buf = await res.arrayBuffer();
      const html = new TextDecoder('iso-8859-1').decode(buf);
      const copyRegex = /data-copy-id="([^"]+)">(.*?)<\/template>/g;
      let m;
      while ((m = copyRegex.exec(html)) !== null) {
        scrapedData[m[1]] = m[2].trim();
      }
      if (scrapedData.legal_capital && !capitalSocial) {
        capitalSocial = parseFloat(scrapedData.legal_capital.replace(/\s/g, '').replace(',', '.'));
      }
    } catch {}

    const FORMS: Record<string, string> = {
      '1000': 'Entrepreneur individuel', '5410': 'SARL', '5485': 'EURL',
      '5499': 'SAS', '5710': 'SAS', '5720': 'SASU', '6540': 'SCI',
    };

    return c.json({
      siren: company.siren, siret: scrapedData.resume_siret || siege.siret || '',
      name: company.nom_complet || '',
      legal_form: scrapedData.legal_form || FORMS[String(company.nature_juridique)] || `Code ${company.nature_juridique}`,
      capital_social: capitalSocial,
      address: scrapedData.resume_company_address || siege.geo_adresse || siege.adresse || '',
      postal_code: siege.code_postal || '', city: siege.libelle_commune || '',
      naf_code: company.activite_principale || '',
      naf_label: scrapedData.resume_ape_label || scrapedData.legal_ape || company.libelle_activite_principale || '',
      date_creation: company.date_creation || '',
      tva_number: scrapedData.resume_tva || pappersData?.numero_tva_intracommunautaire || tvaNumber,
      rcs: pappersData?.greffe ? `${siren} R.C.S. ${pappersData.greffe}` : `${siren} R.C.S. ${siege.libelle_commune || ''}`,
      category: company.categorie_entreprise || '',
      activity_description: scrapedData.legal_activity || null,
      activity_type: scrapedData.legal_activity_type || null,
      brand_names: scrapedData.legal_brands || null,
      collective_agreement: scrapedData.legal_agreement || null,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// --- Sync transactions for an account ---
app.post('/api/bank/accounts/:id/sync', async (c) => {
  const accountId = c.req.param('id');
  const userId = await getUserId(c);

  // Get the account details
  const accountResult = await db.execute({
    sql: 'SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?',
    args: [accountId, userId]
  });
  const account = accountResult.rows[0] as any;

  if (!account) return c.json({ error: 'Account not found' }, 404);
  if (!account.provider_account_id || account.provider !== 'powens') {
    return c.json({ error: 'Only Powens bank accounts can be synced' }, 400);
  }

  // Get all active connections for this user
  const connectionsResult = await db.execute({
    sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  const connections = connectionsResult.rows as any[];

  if (connections.length === 0) return c.json({ error: 'No active bank connections found', reconnect_required: true }, 404);

  // Find which connection owns this account
  let connectionToken: string | null = null;
  let matchedConn: any = null;
  let debugInfo: any[] = [];
  for (const conn of connections) {
    let token = conn.powens_token;

    try {
      let accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      // If 404/401, try to refresh token
      if (!accountsRes.ok && (accountsRes.status === 404 || accountsRes.status === 401)) {
        console.log(`Connection ${conn.id} returned ${accountsRes.status}, attempting token refresh...`);
        const refreshedToken = await refreshPowensToken(conn.id);

        if (refreshedToken) {
          token = refreshedToken;
          // Retry with refreshed token
          accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          debugInfo.push({ conn_id: conn.id, refreshed: true, new_status: accountsRes.status });
        } else {
          debugInfo.push({ conn_id: conn.id, status: accountsRes.status, refresh_failed: true });
          continue;
        }
      }

      if (!accountsRes.ok) {
        const errorText = await accountsRes.text();
        debugInfo.push({ conn_id: conn.id, status: accountsRes.status, error: errorText });
        console.error(`Connection ${conn.id} failed with status ${accountsRes.status}:`, errorText);
        continue;
      }

      const accountsData = await accountsRes.json() as any;
      const powensAccounts = accountsData.accounts || [];
      debugInfo.push({ conn_id: conn.id, account_count: powensAccounts.length, account_ids: powensAccounts.slice(0, 3).map((a: any) => a.id) });

      // Check if this connection has our account
      if (powensAccounts.some((a: any) => String(a.id) === account.provider_account_id)) {
        connectionToken = token;
        matchedConn = conn;
        break;
      }
    } catch (err: any) {
      debugInfo.push({ conn_id: conn.id, error: err.message });
      console.error(`Failed to fetch accounts for connection ${conn.id}:`, err);
      continue;
    }
  }

  if (!connectionToken) {
    console.error(`No connection found for account ${accountId} (provider_id: ${account.provider_account_id}). Debug:`, debugInfo);
    return c.json({
      error: 'Bank connection expired. Please reconnect your bank account.',
      reconnect_required: true,
      debug: { looking_for: account.provider_account_id, checked_connections: debugInfo.length }
    }, 404);
  }

  // Check Powens connection state — if SCA required or in error, trigger reconnect
  if (matchedConn?.powens_connection_id) {
    try {
      const connStateRes = await fetch(`${POWENS_API}/users/me/connections/${matchedConn.powens_connection_id}`, {
        headers: { 'Authorization': `Bearer ${connectionToken}` },
      });
      if (connStateRes.ok) {
        const connState = await connStateRes.json() as any;
        if (connState.error || connState.state === 'SCARequired') {
          console.log(`Connection ${matchedConn.id} (powens ${matchedConn.powens_connection_id}) needs re-auth: state=${connState.state}, error=${connState.error}`);
          return c.json({
            error: `Bank connection needs re-authentication: ${connState.error || connState.state}`,
            reconnect_required: true,
          }, 400);
        }
      }
    } catch (err: any) {
      console.error(`Failed to check connection state:`, err.message);
    }
  }

  try {
    const txRes = await fetch(`${POWENS_API}/users/me/accounts/${account.provider_account_id}/transactions?limit=50`, {
      headers: { 'Authorization': `Bearer ${connectionToken}` },
    });
    const txData = await txRes.json() as any;
    const transactions = txData.transactions || [];
    console.log(`Sync account ${accountId}: provider_id=${account.provider_account_id}, powens_status=${txRes.status}, tx_count=${transactions.length}`, txRes.ok ? '' : JSON.stringify(txData));

    if (!txRes.ok) {
      return c.json({
        error: 'Bank sync failed. Please reconnect your bank account.',
        reconnect_required: true,
        debug: { powens_status: txRes.status, provider_account_id: account.provider_account_id }
      }, 502);
    }

    for (const tx of transactions) {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO transactions (bank_account_id, date, amount, label, category) VALUES (?, ?, ?, ?, ?)',
        args: [account.id, tx.date || tx.rdate, tx.value, tx.original_wording || tx.wording, tx.category?.name || null]
      });
    }

    // For investment accounts, also fetch investment positions
    let investmentsSynced = 0;
    if (account.type === 'investment') {
      try {
        const invRes = await fetch(`${POWENS_API}/users/me/accounts/${account.provider_account_id}/investments`, {
          headers: { 'Authorization': `Bearer ${connectionToken}` },
        });
        if (invRes.ok) {
          const invData = await invRes.json() as any;
          const investments = invData.investments || [];
          for (const inv of investments) {
            await db.execute({
              sql: `INSERT INTO investments (bank_account_id, provider_investment_id, label, isin_code, code_type, quantity, unit_price, unit_value, valuation, diff, diff_percent, portfolio_share, currency, vdate, last_update)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(bank_account_id, isin_code) DO UPDATE SET
                      label=excluded.label, quantity=excluded.quantity, unit_price=excluded.unit_price,
                      unit_value=excluded.unit_value, valuation=excluded.valuation, diff=excluded.diff,
                      diff_percent=excluded.diff_percent, portfolio_share=excluded.portfolio_share,
                      vdate=excluded.vdate, last_update=excluded.last_update`,
              args: [
                account.id,
                String(inv.id),
                inv.label || 'Unknown',
                inv.code || null,
                inv.code_type || 'ISIN',
                inv.quantity || 0,
                inv.unitprice || 0,
                inv.original_unitvalue || inv.unitvalue || 0,
                inv.valuation || 0,
                inv.diff || 0,
                inv.diff_percent || 0,
                inv.portfolio_share || 0,
                inv.original_currency?.id || 'EUR',
                inv.vdate || null,
                inv.last_update || new Date().toISOString(),
              ]
            });
          }
          investmentsSynced = investments.length;
          console.log(`Synced ${investments.length} investments for account ${accountId}`);
        }
      } catch (err: any) {
        console.error(`Failed to sync investments for account ${accountId}:`, err.message);
      }
    }

    await db.execute({
      sql: 'UPDATE bank_accounts SET last_sync = ? WHERE id = ?',
      args: [new Date().toISOString(), account.id]
    });

    return c.json({ synced: transactions.length, investments_synced: investmentsSynced });
  } catch (err: any) {
    return c.json({ error: err.message, reconnect_required: true }, 500);
  }
});

// ========== EXPORT / IMPORT ==========

// ========== INVESTMENTS ==========

app.get('/api/investments', async (c) => {
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

app.get('/api/export', async (c) => {
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

app.post('/api/import', async (c) => {
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

// ========== ASSETS ==========

app.get('/api/assets', async (c) => {
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

app.get('/api/assets/:id', async (c) => {
  const result = await db.execute({ sql: 'SELECT * FROM assets WHERE id = ?', args: [c.req.param('id')] });
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const asset = result.rows[0] as any;
  const costs = await db.execute({ sql: 'SELECT * FROM asset_costs WHERE asset_id = ?', args: [asset.id] });
  asset.costs = costs.rows;
  const revenues = await db.execute({ sql: 'SELECT * FROM asset_revenues WHERE asset_id = ?', args: [asset.id] });
  asset.revenues = revenues.rows;
  return c.json(asset);
});

app.post('/api/assets', async (c) => {
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

app.patch('/api/assets/:id', async (c) => {
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

app.delete('/api/assets/:id', async (c) => {
  const id = c.req.param('id');
  await db.execute({ sql: 'DELETE FROM asset_costs WHERE asset_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM asset_revenues WHERE asset_id = ?', args: [id] });
  await db.execute({ sql: 'DELETE FROM assets WHERE id = ?', args: [id] });
  return c.json({ ok: true });
});

// ========== MANUAL ACCOUNTS ==========

app.post('/api/accounts/manual', async (c) => {
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

app.post('/api/accounts/:id/update-balance', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json() as any;
  if (body.balance === undefined) return c.json({ error: 'Balance required' }, 400);
  await db.execute({ sql: 'UPDATE bank_accounts SET balance = ?, last_sync = ? WHERE id = ?', args: [body.balance, new Date().toISOString(), id] });
  const account = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE id = ?', args: [id] });
  return c.json(account.rows[0]);
});

// ========== BLOCKCHAIN WALLETS ==========

async function fetchBlockchainBalance(network: string, address: string): Promise<{ balance: number; currency: string }> {
  if (network === 'xrp' || network === 'ripple') {
    const res = await fetch(`https://api.xrpscan.com/api/v1/account/${address}`);
    const data = await res.json() as any;
    return { balance: (data.xrpBalance || 0), currency: 'XRP' };
  }
  if (network === 'solana') {
    const res = await fetch('https://api.mainnet-beta.solana.com', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
    });
    const data = await res.json() as any;
    return { balance: (data.result?.value || 0) / 1e9, currency: 'SOL' };
  }
  if (network === 'bitcoin') {
    // xpub → derive native segwit (bc1) addresses and scan via Blockstream
    if (/^[xyz]pub/.test(address)) {
      const node = bip32.fromBase58(address);
      let totalBalance = 0;
      // Scan receiving (m/0/i) and change (m/1/i) addresses
      for (const chain of [0, 1]) {
        let emptyCount = 0;
        for (let i = 0; emptyCount < 5 && i < 50; i++) {
          const child = node.derive(chain).derive(i);
          const { address: addr } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network: bitcoin.networks.bitcoin });
          if (!addr) continue;
          try {
            const res = await fetch(`https://blockstream.info/api/address/${addr}`);
            const data = await res.json() as any;
            const funded = data.chain_stats?.funded_txo_sum || 0;
            const spent = data.chain_stats?.spent_txo_sum || 0;
            const bal = funded - spent;
            const txCount = data.chain_stats?.tx_count || 0;
            if (txCount === 0) { emptyCount++; } else { emptyCount = 0; }
            totalBalance += bal;
          } catch { emptyCount++; }
        }
      }
      return { balance: totalBalance / 1e8, currency: 'BTC' };
    }
    // Single address → use Blockstream
    const res = await fetch(`https://blockstream.info/api/address/${address}`);
    const data = await res.json() as any;
    const funded = data.chain_stats?.funded_txo_sum || 0;
    const spent = data.chain_stats?.spent_txo_sum || 0;
    return { balance: (funded - spent) / 1e8, currency: 'BTC' };
  }
  // EVM chains — all use the same eth_getBalance RPC, different endpoints
  const evmChains: Record<string, { rpc: string; currency: string; decimals: number }> = {
    ethereum:  { rpc: 'https://eth.llamarpc.com', currency: 'ETH', decimals: 18 },
    base:      { rpc: 'https://mainnet.base.org', currency: 'ETH', decimals: 18 },
    polygon:   { rpc: 'https://polygon-rpc.com', currency: 'POL', decimals: 18 },
    bnb:       { rpc: 'https://bsc-dataseed.binance.org', currency: 'BNB', decimals: 18 },
    avalanche: { rpc: 'https://api.avax.network/ext/bc/C/rpc', currency: 'AVAX', decimals: 18 },
    arbitrum:  { rpc: 'https://arb1.arbitrum.io/rpc', currency: 'ETH', decimals: 18 },
    optimism:  { rpc: 'https://mainnet.optimism.io', currency: 'ETH', decimals: 18 },
  };

  const chain = evmChains[network];
  if (chain) {
    const res = await fetch(chain.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
    });
    const data = await res.json() as any;
    const balance = data.result ? parseInt(data.result, 16) / Math.pow(10, chain.decimals) : 0;
    return { balance, currency: chain.currency };
  }
  throw new Error(`Unsupported network: ${network}`);
}

app.post('/api/accounts/blockchain', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json() as any;
  if (!body.address || !body.network) return c.json({ error: 'Address and network required' }, 400);

  const network = body.network.toLowerCase();
  let balance = 0;
  const currencyMap: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', xrp: 'XRP', ripple: 'XRP', base: 'ETH', polygon: 'POL', bnb: 'BNB', avalanche: 'AVAX', arbitrum: 'ETH', optimism: 'ETH' };
  let currency = currencyMap[network] || network.toUpperCase();

  try {
    const result = await fetchBlockchainBalance(network, body.address);
    balance = result.balance; currency = result.currency;
  } catch (err: any) {
    console.error(`Blockchain balance fetch failed for ${network}:${body.address}:`, err.message);
  }

  const result = await db.execute({
    sql: `INSERT INTO bank_accounts (user_id, company_id, provider, name, custom_name, balance, type, usage, subtype, blockchain_address, blockchain_network, currency, last_sync) VALUES (?, ?, 'blockchain', ?, ?, ?, 'investment', 'personal', 'crypto', ?, ?, ?, ?)`,
    args: [userId, body.company_id || null, body.name || `${currency} Wallet`, body.custom_name || null, balance, body.address, network, currency, new Date().toISOString()]
  });
  const account = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE id = ?', args: [Number(result.lastInsertRowid)] });
  return c.json(account.rows[0]);
});

app.post('/api/accounts/:id/sync-blockchain', async (c) => {
  const id = c.req.param('id');
  const result = await db.execute({ sql: "SELECT * FROM bank_accounts WHERE id = ? AND provider = 'blockchain'", args: [id] });
  const account = result.rows[0] as any;
  if (!account) return c.json({ error: 'Not a blockchain account' }, 404);

  try {
    const { balance, currency } = await fetchBlockchainBalance(account.blockchain_network, account.blockchain_address);
    await db.execute({ sql: 'UPDATE bank_accounts SET balance = ?, currency = ?, last_sync = ? WHERE id = ?', args: [balance, currency, new Date().toISOString(), id] });
    return c.json({ balance, currency });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ========== CRYPTO PRICES ==========
app.get('/api/crypto/prices', async (c) => {
  const ids = c.req.query('ids') || 'bitcoin,ethereum,solana,ripple,matic-network,binancecoin,avalanche-2';
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur,usd&include_24hr_change=true`);
    const data = await res.json();
    return c.json(data);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ========== PROPERTY ESTIMATION ==========

app.get('/api/estimation/geocode', async (c) => {
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

app.get('/api/estimation/price', async (c) => {
  const citycode = c.req.query('citycode');
  const lat = parseFloat(c.req.query('lat') || '0');
  const lon = parseFloat(c.req.query('lon') || '0');
  const surface = parseFloat(c.req.query('surface') || '0');
  const propertyType = c.req.query('type') || 'Appartement';

  if (!citycode) return c.json({ error: 'citycode (INSEE) required' }, 400);
  if (!surface) return c.json({ error: 'surface (m²) required' }, 400);

  const dept = citycode.substring(0, 2);

  try {
    const years = ['2024', '2023', '2022'];
    let allSales: { price: number; surface: number; pricePerM2: number; date: string; type: string; lat: number; lon: number; distance: number }[] = [];

    for (const year of years) {
      try {
        const res = await fetch(`https://files.data.gouv.fr/geo-dvf/latest/csv/${year}/communes/${dept}/${citycode}.csv`);
        if (!res.ok) continue;
        const csv = await res.text();
        const lines = csv.split('\n');
        const header = lines[0].split(',');
        const idx = {
          nature: header.indexOf('nature_mutation'), valeur: header.indexOf('valeur_fonciere'),
          type_local: header.indexOf('type_local'), surface: header.indexOf('surface_reelle_bati'),
          date: header.indexOf('date_mutation'), lat: header.indexOf('latitude'), lon: header.indexOf('longitude'),
        };

        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',');
          if (cols[idx.nature] !== 'Vente') continue;
          const type = cols[idx.type_local];
          if (type !== 'Appartement' && type !== 'Maison') continue;
          const price = parseFloat(cols[idx.valeur]);
          const surf = parseFloat(cols[idx.surface]);
          if (!price || !surf || surf < 9) continue;

          const sLat = parseFloat(cols[idx.lat]);
          const sLon = parseFloat(cols[idx.lon]);
          const dist = lat && lon && sLat && sLon
            ? Math.sqrt(Math.pow((sLat - lat) * 111000, 2) + Math.pow((sLon - lon) * 111000 * Math.cos(lat * Math.PI / 180), 2))
            : 99999;

          allSales.push({ price, surface: surf, pricePerM2: price / surf, date: cols[idx.date], type, lat: sLat, lon: sLon, distance: Math.round(dist) });
        }
      } catch {}
    }

    if (allSales.length === 0) return c.json({ error: 'No sales data found for this commune', estimation: null });

    const sameType = allSales.filter(s => s.type === propertyType);
    const dataset = sameType.length >= 5 ? sameType : allSales;
    dataset.sort((a, b) => a.distance - b.distance);
    const comparables = dataset.slice(0, 50);
    const prices = comparables.map(s => s.pricePerM2).sort((a, b) => a - b);

    const median = prices[Math.floor(prices.length / 2)];
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const low = prices[Math.floor(prices.length * 0.25)];
    const high = prices[Math.floor(prices.length * 0.75)];

    return c.json({
      estimation: {
        pricePerM2: Math.round(median), estimatedValue: Math.round(median * surface),
        range: { low: Math.round(low * surface), high: Math.round(high * surface) },
        pricePerM2Range: { low: Math.round(low), median: Math.round(median), high: Math.round(high), mean: Math.round(mean) },
      },
      comparables: comparables.slice(0, 10).map(s => ({ price: s.price, surface: s.surface, pricePerM2: Math.round(s.pricePerM2), date: s.date, type: s.type, distance: s.distance })),
      meta: { totalSales: allSales.length, sameTypeSales: sameType.length, comparablesUsed: comparables.length, years, propertyType, surface },
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ========== COINBASE OAUTH2 ==========

const COINBASE_CLIENT_ID = process.env.COINBASE_CLIENT_ID || '';
const COINBASE_CLIENT_SECRET = process.env.COINBASE_CLIENT_SECRET || '';
const COINBASE_REDIRECT_URI = process.env.COINBASE_REDIRECT_URI || 'https://65.108.14.251:8080/konto/api/coinbase-callback';
const COINBASE_API = 'https://api.coinbase.com/v2';

app.get('/api/coinbase/connect-url', (c) => {
  if (!COINBASE_CLIENT_ID) return c.json({ error: 'Coinbase not configured' }, 400);
  const scopes = 'wallet:accounts:read,wallet:transactions:read,wallet:user:read';
  const url = `https://www.coinbase.com/oauth/authorize?response_type=code&client_id=${COINBASE_CLIENT_ID}&redirect_uri=${encodeURIComponent(COINBASE_REDIRECT_URI)}&scope=${scopes}&account=all`;
  return c.json({ url });
});

app.get('/api/coinbase-callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');

  if (error || !code) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Coinbase connection failed</h1><p>${error || 'No authorization code received'}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }

  try {
    const tokenRes = await fetch('https://api.coinbase.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: COINBASE_CLIENT_ID, client_secret: COINBASE_CLIENT_SECRET, redirect_uri: COINBASE_REDIRECT_URI }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');

    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const userId = await getUserId(c);

    await db.execute({
      sql: `INSERT INTO coinbase_connections (user_id, access_token, refresh_token, expires_at, status) VALUES (?, ?, ?, ?, 'active')`,
      args: [userId, accessToken, refreshToken, tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString() : null]
    });

    let accounts: any[] = [];
    try {
      const accRes = await fetch(`${COINBASE_API}/accounts?limit=100`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
      const accData = await accRes.json() as any;
      accounts = (accData.data || []).filter((a: any) => parseFloat(a.balance?.amount || '0') !== 0 || a.type === 'wallet');

      for (const acc of accounts) {
        const balance = parseFloat(acc.balance?.amount || '0');
        const currency = acc.balance?.currency || acc.currency?.code || 'USD';
        const existing = await db.execute({ sql: "SELECT id FROM bank_accounts WHERE provider = 'coinbase' AND provider_account_id = ?", args: [acc.id] });
        if (existing.rows.length === 0) {
          await db.execute({
            sql: `INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, bank_name, balance, type, usage, subtype, currency, last_sync) VALUES (?, ?, 'coinbase', ?, ?, 'Coinbase', ?, 'investment', 'personal', 'crypto', ?, ?)`,
            args: [userId, null, acc.id, acc.name || `${currency} Wallet`, balance, currency, new Date().toISOString()]
          });
        }
      }
    } catch (e) {
      console.error('Failed to fetch Coinbase accounts:', e);
    }

    return c.html(`<html><head><meta http-equiv="refresh" content="10;url=/konto/accounts"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#d4a812;">✅ Coinbase connected!</h1><p>${accounts.length} wallet(s) synced.</p>
      <p style="color:#888;font-size:14px;">Redirecting in <span id="t">10</span>s...</p>
      <a href="/konto/accounts" style="color:#d4a812;font-size:18px;">← Back to Konto</a>
      <script>let s=10;setInterval(()=>{s--;if(s>=0)document.getElementById('t').textContent=s;},1000);</script>
    </body></html>`);
  } catch (err: any) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1><p>${err.message}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }
});

app.post('/api/coinbase/sync', async (c) => {
  const userId = await getUserId(c);
  const connections = await db.execute({ sql: "SELECT * FROM coinbase_connections WHERE status = 'active' AND user_id = ?", args: [userId] });
  let totalSynced = 0;

  for (const conn of connections.rows as any[]) {
    let token = conn.access_token;

    if (conn.expires_at && new Date(conn.expires_at) < new Date()) {
      try {
        const refreshRes = await fetch('https://api.coinbase.com/oauth/token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: conn.refresh_token, client_id: COINBASE_CLIENT_ID, client_secret: COINBASE_CLIENT_SECRET }),
        });
        const refreshData = await refreshRes.json() as any;
        if (refreshRes.ok) {
          token = refreshData.access_token;
          await db.execute({
            sql: 'UPDATE coinbase_connections SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?',
            args: [refreshData.access_token, refreshData.refresh_token || conn.refresh_token, refreshData.expires_in ? new Date(Date.now() + refreshData.expires_in * 1000).toISOString() : null, conn.id]
          });
        }
      } catch (e) {
        console.error('Coinbase token refresh failed:', e);
        continue;
      }
    }

    try {
      const accRes = await fetch(`${COINBASE_API}/accounts?limit=100`, { headers: { 'Authorization': `Bearer ${token}` } });
      const accData = await accRes.json() as any;

      for (const acc of (accData.data || [])) {
        const balance = parseFloat(acc.balance?.amount || '0');
        const currency = acc.balance?.currency || acc.currency?.code || 'USD';
        const existing = await db.execute({ sql: "SELECT id FROM bank_accounts WHERE provider = 'coinbase' AND provider_account_id = ?", args: [acc.id] });
        if (existing.rows.length > 0) {
          await db.execute({ sql: 'UPDATE bank_accounts SET balance = ?, currency = ?, last_sync = ? WHERE id = ?', args: [balance, currency, new Date().toISOString(), existing.rows[0].id as number] });
        } else if (balance !== 0) {
          await db.execute({
            sql: `INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, bank_name, balance, type, usage, subtype, currency, last_sync) VALUES (?, ?, 'coinbase', ?, ?, 'Coinbase', ?, 'investment', 'personal', 'crypto', ?, ?)`,
            args: [userId, null, acc.id, acc.name || `${currency} Wallet`, balance, currency, new Date().toISOString()]
          });
        }
        totalSynced++;
      }
    } catch (e: any) {
      console.error('Coinbase sync failed:', e.message);
    }
  }

  return c.json({ synced: totalSynced });
});

// ========== BINANCE EXCHANGE INTEGRATION (Read-Only) ==========

const BINANCE_API = 'https://api.binance.com';

// Helper to create Binance signature
function createBinanceSignature(queryString: string, apiSecret: string): string {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
}

// Get Binance account info using read-only API
async function fetchBinanceAccount(apiKey: string, apiSecret: string) {
  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}`;
  const signature = createBinanceSignature(queryString, apiSecret);
  
  const res = await fetch(`${BINANCE_API}/api/v3/account?${queryString}&signature=${signature}`, {
    headers: { 'X-MBX-APIKEY': apiKey }
  });
  
  if (!res.ok) {
    const error = await res.json().catch(() => ({ msg: 'Unknown error' }));
    throw new Error(error.msg || `Binance API error: ${res.status}`);
  }
  
  return res.json();
}

// Get current prices for all symbols
async function fetchBinancePrices(): Promise<Record<string, number>> {
  const res = await fetch(`${BINANCE_API}/api/v3/ticker/price`);
  if (!res.ok) throw new Error('Failed to fetch Binance prices');
  const data = await res.json() as Array<{ symbol: string; price: string }>;
  const prices: Record<string, number> = {};
  for (const item of data) {
    prices[item.symbol] = parseFloat(item.price);
  }
  return prices;
}

// POST /api/binance/connect - Save API keys (read-only)
app.post('/api/binance/connect', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json<any>();
  
  if (!body.apiKey || !body.apiSecret) {
    return c.json({ error: 'API key and secret are required' }, 400);
  }
  
  // Validate keys by making a test request
  try {
    await fetchBinanceAccount(body.apiKey, body.apiSecret);
  } catch (e: any) {
    return c.json({ error: `Invalid API keys: ${e.message}` }, 400);
  }
  
  // Deactivate any existing connection
  await db.execute({
    sql: "UPDATE binance_connections SET status = 'inactive' WHERE user_id = ? AND status = 'active'",
    args: [userId]
  });
  
  // Save new connection
  await db.execute({
    sql: `INSERT INTO binance_connections (user_id, api_key, api_secret, account_name, status) VALUES (?, ?, ?, ?, 'active')`,
    args: [userId, body.apiKey, body.apiSecret, body.accountName || 'Binance']
  });
  
  return c.json({ success: true, message: 'Binance connected successfully' });
});

// GET /api/binance/status - Check connection status
app.get('/api/binance/status', async (c) => {
  const userId = await getUserId(c);
  const connections = await db.execute({
    sql: "SELECT id, account_name, status, last_sync, created_at FROM binance_connections WHERE user_id = ? AND status = 'active'",
    args: [userId]
  });
  
  return c.json({ 
    connected: connections.rows.length > 0,
    connections: connections.rows
  });
});

// POST /api/binance/sync - Sync balances
app.post('/api/binance/sync', async (c) => {
  const userId = await getUserId(c);
  
  const connections = await db.execute({
    sql: "SELECT * FROM binance_connections WHERE status = 'active' AND user_id = ?",
    args: [userId]
  });
  
  let totalSynced = 0;
  const prices = await fetchBinancePrices();
  
  for (const conn of connections.rows as any[]) {
    try {
      const account = await fetchBinanceAccount(conn.api_key, conn.api_secret);
      const balances = (account.balances || []).filter((b: any) => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
      
      for (const balance of balances) {
        const asset = balance.asset;
        const amount = parseFloat(balance.free) + parseFloat(balance.locked);
        
        // Calculate value in USD
        let usdValue = 0;
        if (asset === 'USDT' || asset === 'BUSD' || asset === 'USDC') {
          usdValue = amount;
        } else {
          const priceSymbol = `${asset}USDT`;
          const price = prices[priceSymbol] || prices[`${asset}BUSD`] || prices[`${asset}BTC`] * prices['BTCUSDT'] || 0;
          usdValue = amount * price;
        }
        
        // Check if account already exists
        const accountId = `binance-${conn.id}-${asset}`;
        const existing = await db.execute({
          sql: "SELECT id FROM bank_accounts WHERE provider = 'binance' AND provider_account_id = ? AND user_id = ?",
          args: [accountId, userId]
        });
        
        if (existing.rows.length > 0) {
          await db.execute({
            sql: `UPDATE bank_accounts SET balance = ?, last_sync = ? WHERE id = ?`,
            args: [usdValue, new Date().toISOString(), existing.rows[0].id]
          });
        } else {
          await db.execute({
            sql: `INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, name, bank_name, balance, type, usage, subtype, currency, last_sync) VALUES (?, ?, 'binance', ?, ?, ?, ?, 'investment', 'personal', 'crypto', 'USD', ?)`,
            args: [userId, null, accountId, `${asset} Wallet`, conn.account_name || 'Binance', usdValue, new Date().toISOString()]
          });
        }
        totalSynced++;
      }
      
      // Update last_sync time
      await db.execute({
        sql: 'UPDATE binance_connections SET last_sync = ? WHERE id = ?',
        args: [new Date().toISOString(), conn.id]
      });
      
    } catch (e: any) {
      console.error('Binance sync failed:', e.message);
      // Mark connection as potentially invalid
      await db.execute({
        sql: "UPDATE binance_connections SET status = 'error' WHERE id = ?",
        args: [conn.id]
      });
    }
  }
  
  return c.json({ synced: totalSynced });
});

// DELETE /api/binance/disconnect - Remove connection
app.delete('/api/binance/disconnect', async (c) => {
  const userId = await getUserId(c);
  
  // Deactivate connection
  await db.execute({
    sql: "UPDATE binance_connections SET status = 'inactive' WHERE user_id = ? AND status = 'active'",
    args: [userId]
  });
  
  // Optionally delete associated accounts
  await db.execute({
    sql: "DELETE FROM bank_accounts WHERE provider = 'binance' AND user_id = ?",
    args: [userId]
  });
  
  return c.json({ success: true });
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

app.post('/api/dashboard/snapshot', async (c) => {
  const userId = await getUserId(c);
  const result = await createPatrimoineSnapshot(userId);
  return c.json(result);
});

app.get('/api/dashboard/history', async (c) => {
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

  return c.json({ history: result.rows, range, category });
});

// ========== BUDGET / CASHFLOW ==========

app.get('/api/budget/cashflow', async (c) => {
  const from = c.req.query('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const to = c.req.query('to') || new Date().toISOString().split('T')[0];

  const result = await db.execute({
    sql: `SELECT t.date, t.amount, t.label, t.category, ba.usage
          FROM transactions t LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE t.date >= ? AND t.date <= ? ORDER BY t.date`,
    args: [from, to]
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

app.get('/api/report/patrimoine', async (c) => {
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

  return c.json({ sections, grandTotal: sections.reduce((s, sec) => s + sec.total, 0), generatedAt: new Date().toISOString() });
});

// ========== CREDIT SIMULATION ==========

app.get('/api/rates/current', async (c) => {
  const result = await db.execute('SELECT duration, best_rate, avg_rate, updated_at FROM market_rates ORDER BY duration');

  if (result.rows.length === 0) {
    const defaults = [
      { duration: 7, best_rate: 2.80, avg_rate: 3.05 },
      { duration: 10, best_rate: 2.85, avg_rate: 3.10 },
      { duration: 15, best_rate: 2.95, avg_rate: 3.20 },
      { duration: 20, best_rate: 3.05, avg_rate: 3.35 },
      { duration: 25, best_rate: 3.15, avg_rate: 3.45 },
      { duration: 30, best_rate: 3.30, avg_rate: 3.60 },
    ];
    const now = new Date().toISOString();
    for (const d of defaults) {
      await db.execute({ sql: 'INSERT OR REPLACE INTO market_rates (duration, best_rate, avg_rate, updated_at) VALUES (?, ?, ?, ?)', args: [d.duration, d.best_rate, d.avg_rate, now] });
    }
    return c.json({ rates: defaults.map(d => ({ ...d, updated_at: now })) });
  }

  return c.json({ rates: result.rows });
});

// ========== INCOME ENTRIES ==========

app.get('/api/income', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({
    sql: `SELECT ie.*, co.name as company_name FROM income_entries ie LEFT JOIN companies co ON co.id = ie.company_id WHERE ie.user_id = ? ORDER BY ie.year DESC, ie.start_date DESC, ie.employer`,
    args: [userId]
  });
  return c.json({ entries: result.rows });
});

app.post('/api/income', async (c) => {
  const userId = await getUserId(c);
  const { year, employer, job_title, country, gross_annual, net_annual, start_date, end_date, company_id } = await c.req.json();
  if (!year || !employer || !gross_annual) return c.json({ error: 'Missing required fields' }, 400);
  const result = await db.execute({
    sql: 'INSERT INTO income_entries (user_id, year, employer, job_title, country, gross_annual, net_annual, start_date, end_date, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [userId, year, employer, job_title || null, country || 'FR', gross_annual, net_annual || null, start_date || null, end_date || null, company_id || null]
  });
  return c.json({ id: Number(result.lastInsertRowid), year, employer, job_title, country, gross_annual, net_annual, start_date, end_date, company_id });
});

app.put('/api/income/:id', async (c) => {
  const id = c.req.param('id');
  const { year, employer, job_title, country, gross_annual, net_annual, start_date, end_date, company_id } = await c.req.json();
  await db.execute({
    sql: 'UPDATE income_entries SET year=?, employer=?, job_title=?, country=?, gross_annual=?, net_annual=?, start_date=?, end_date=?, company_id=? WHERE id=?',
    args: [year, employer, job_title || null, country || 'FR', gross_annual, net_annual || null, start_date || null, end_date || null, company_id || null, id]
  });
  return c.json({ success: true });
});

app.delete('/api/income/:id', async (c) => {
  const id = c.req.param('id');
  await db.execute({ sql: 'DELETE FROM income_entries WHERE id = ?', args: [id] });
  return c.json({ success: true });
});

// ========== TAX ESTIMATION ==========

app.post('/api/tax/estimate', async (c) => {
  const { gross_annual, country, canton, situation, children } = await c.req.json();
  if (!gross_annual || !country) return c.json({ error: 'Missing fields' }, 400);

  const kids = children || 0;
  let parts = 1;
  if (situation === 'married') parts = 2;
  parts += kids * 0.5;
  if (kids >= 3) parts += (kids - 2) * 0.5; // 3rd+ kid = 1 full part

  let tax = 0, brackets: { rate: number; amount: number }[] = [];

  if (country === 'FR') {
    // French progressive income tax (barème progressif IR 2024)
    const taxableIncome = gross_annual * 0.9; // 10% deduction
    const perPart = taxableIncome / parts;
    const frBrackets = [
      { limit: 11294, rate: 0 },
      { limit: 28797, rate: 0.11 },
      { limit: 82341, rate: 0.30 },
      { limit: 177106, rate: 0.41 },
      { limit: Infinity, rate: 0.45 },
    ];
    let prev = 0;
    for (const b of frBrackets) {
      const slice = Math.max(0, Math.min(perPart, b.limit) - prev);
      const amount = slice * b.rate * parts;
      if (slice > 0) brackets.push({ rate: b.rate * 100, amount });
      tax += amount;
      prev = b.limit;
      if (perPart <= b.limit) break;
    }
  } else if (country === 'CH') {
    // Simplified Swiss tax (federal + cantonal estimate)
    // Federal rates simplified
    const chfGross = gross_annual;
    const deductions = situation === 'married' ? 5400 : 2700;
    const childDeduction = kids * 6700;
    const taxable = Math.max(0, chfGross - deductions - childDeduction);

    // Simplified federal tax brackets
    const fedBrackets = [
      { limit: 17800, rate: 0 },
      { limit: 31600, rate: 0.0077 },
      { limit: 41400, rate: 0.0088 },
      { limit: 55200, rate: 0.026 },
      { limit: 72500, rate: 0.0307 },
      { limit: 78100, rate: 0.0334 },
      { limit: 103600, rate: 0.0361 },
      { limit: 134600, rate: 0.0388 },
      { limit: 176000, rate: 0.0415 },
      { limit: 755200, rate: 0.1315 },
      { limit: Infinity, rate: 0.135 },
    ];
    let fedTax = 0, prev = 0;
    for (const b of fedBrackets) {
      const slice = Math.max(0, Math.min(taxable, b.limit) - prev);
      fedTax += slice * b.rate;
      prev = b.limit;
      if (taxable <= b.limit) break;
    }

    // Cantonal multiplier
    const cantonMultipliers: Record<string, number> = {
      'ZH': 1.19, 'GE': 1.48, 'VD': 1.55, 'BE': 1.54, 'BS': 1.26,
      'LU': 1.05, 'AG': 1.09, 'SG': 1.15, 'TI': 1.30, 'VS': 1.25,
    };
    const multiplier = cantonMultipliers[canton || 'ZH'] || 1.19;
    tax = fedTax * (1 + multiplier);
    brackets = [{ rate: multiplier * 100, amount: tax }];
  }

  const netIncome = gross_annual - tax;
  const effectiveRate = gross_annual > 0 ? (tax / gross_annual) * 100 : 0;

  return c.json({ gross_annual, tax: Math.round(tax), netIncome: Math.round(netIncome), effectiveRate: Math.round(effectiveRate * 100) / 100, brackets, country, situation, children: kids, parts });
});

// ========== BORROWING CAPACITY ==========

app.post('/api/borrowing-capacity', async (c) => {
  const { net_monthly, existing_payments, rate, duration_years } = await c.req.json();
  if (!net_monthly) return c.json({ error: 'Missing net_monthly' }, 400);

  const maxPayment = net_monthly * 0.33;
  const available = Math.max(0, maxPayment - (existing_payments || 0));
  const r = (rate || 3.35) / 100 / 12;
  const n = (duration_years || 20) * 12;
  const maxLoan = r > 0 ? available * (1 - Math.pow(1 + r, -n)) / r : available * n;

  return c.json({
    net_monthly,
    max_payment: Math.round(maxPayment),
    available_payment: Math.round(available),
    max_loan: Math.round(maxLoan),
    rate: rate || 3.35,
    duration_years: duration_years || 20,
  });
});

// ========== ANALYTICS ==========

async function computeAnalytics(period: string, userId: number = 1) {
  const [year, month] = period.split('-').map(Number);
  const startDate = `${period}-01`;
  const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  
  // Total income & expenses for the period
  const incomeRes = await db.execute({
    sql: `SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t 
          LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE t.date >= ? AND t.date < ? AND t.amount > 0`,
    args: [startDate, endDate]
  });
  const expenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total FROM transactions t 
          LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE t.date >= ? AND t.date < ? AND t.amount < 0`,
    args: [startDate, endDate]
  });

  const totalIncome = Number(incomeRes.rows[0]?.total || 0);
  const totalExpenses = Number(expenseRes.rows[0]?.total || 0);
  const savingsRate = totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 100) : 0;

  // Top 5 expense categories
  const topCatsRes = await db.execute({
    sql: `SELECT COALESCE(t.category, 'Non catégorisé') as category, SUM(ABS(t.amount)) as total
          FROM transactions t WHERE t.date >= ? AND t.date < ? AND t.amount < 0
          GROUP BY t.category ORDER BY total DESC LIMIT 5`,
    args: [startDate, endDate]
  });
  const topCategories = topCatsRes.rows.map((r: any) => ({
    category: r.category,
    amount: Number(r.total),
    percentage: totalExpenses > 0 ? Math.round((Number(r.total) / totalExpenses) * 100) : 0,
  }));

  // Previous month for MoM
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const prevStart = `${prevPeriod}-01`;
  const prevEnd = prevMonth === 12 ? `${prevYear + 1}-01-01` : `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;

  const prevIncomeRes = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE date >= ? AND date < ? AND amount > 0`,
    args: [prevStart, prevEnd]
  });
  const prevExpenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM transactions WHERE date >= ? AND date < ? AND amount < 0`,
    args: [prevStart, prevEnd]
  });
  const prevIncome = Number(prevIncomeRes.rows[0]?.total || 0);
  const prevExpenses = Number(prevExpenseRes.rows[0]?.total || 0);

  const momIncome = prevIncome > 0 ? Math.round(((totalIncome - prevIncome) / prevIncome) * 100) : 0;
  const momExpenses = prevExpenses > 0 ? Math.round(((totalExpenses - prevExpenses) / prevExpenses) * 100) : 0;

  // YoY
  const yoyPeriod = `${year - 1}-${String(month).padStart(2, '0')}`;
  const yoyStart = `${yoyPeriod}-01`;
  const yoyEnd = month === 12 ? `${year}-01-01` : `${year - 1}-${String(month + 1).padStart(2, '0')}-01`;

  const yoyIncomeRes = await db.execute({
    sql: `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE date >= ? AND date < ? AND amount > 0`,
    args: [yoyStart, yoyEnd]
  });
  const yoyExpenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM transactions WHERE date >= ? AND date < ? AND amount < 0`,
    args: [yoyStart, yoyEnd]
  });
  const yoyIncome = Number(yoyIncomeRes.rows[0]?.total || 0);
  const yoyExpenses = Number(yoyExpenseRes.rows[0]?.total || 0);

  // Recurring expenses (labels appearing 2+ months in last 3 months)
  const threeMonthsAgo = month <= 3
    ? `${year - 1}-${String(12 + month - 3).padStart(2, '0')}-01`
    : `${year}-${String(month - 3).padStart(2, '0')}-01`;

  const recurringRes = await db.execute({
    sql: `SELECT t.label, COUNT(DISTINCT strftime('%Y-%m', t.date)) as months, AVG(ABS(t.amount)) as avg_amount
          FROM transactions t WHERE t.date >= ? AND t.date < ? AND t.amount < 0 AND t.label IS NOT NULL
          GROUP BY LOWER(t.label) HAVING months >= 2 ORDER BY avg_amount DESC LIMIT 10`,
    args: [threeMonthsAgo, endDate]
  });
  const recurring = recurringRes.rows.map((r: any) => ({
    label: r.label,
    avgAmount: Math.round(Number(r.avg_amount) * 100) / 100,
    months: Number(r.months),
  }));

  // Spending trends (last 6 months)
  const trends = [];
  for (let i = 5; i >= 0; i--) {
    let m = month - i;
    let y = year;
    while (m <= 0) { m += 12; y--; }
    const p = `${y}-${String(m).padStart(2, '0')}`;
    const s = `${p}-01`;
    const e = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const inc = await db.execute({ sql: `SELECT COALESCE(SUM(amount), 0) as t FROM transactions WHERE date >= ? AND date < ? AND amount > 0`, args: [s, e] });
    const exp = await db.execute({ sql: `SELECT COALESCE(SUM(ABS(amount)), 0) as t FROM transactions WHERE date >= ? AND date < ? AND amount < 0`, args: [s, e] });
    trends.push({ period: p, income: Number(inc.rows[0]?.t || 0), expenses: Number(exp.rows[0]?.t || 0) });
  }

  const metrics = {
    totalIncome, totalExpenses, savingsRate,
    topCategories, recurring, trends,
    mom: { income: momIncome, expenses: momExpenses },
    yoy: { income: yoyIncome, expenses: yoyExpenses, incomeChange: yoyIncome > 0 ? Math.round(((totalIncome - yoyIncome) / yoyIncome) * 100) : 0, expensesChange: yoyExpenses > 0 ? Math.round(((totalExpenses - yoyExpenses) / yoyExpenses) * 100) : 0 },
  };

  // Cache it
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT OR REPLACE INTO analytics_cache (user_id, metric_key, period, value, computed_at) VALUES (?, 'full', ?, ?, ?)`,
    args: [userId, period, JSON.stringify(metrics), now]
  });

  return { ...metrics, computed_at: now };
}

app.get('/api/analytics', async (c) => {
  const period = c.req.query('period') || new Date().toISOString().slice(0, 7);
  const userId = await getUserId(c);

  // Try cache first
  const cached = await db.execute({
    sql: `SELECT value, computed_at FROM analytics_cache WHERE user_id = ? AND metric_key = 'full' AND period = ?`,
    args: [userId, period]
  });

  if (cached.rows.length > 0) {
    const row: any = cached.rows[0];
    return c.json({ ...JSON.parse(row.value), computed_at: row.computed_at, cached: true });
  }

  // Compute on first access
  const result = await computeAnalytics(period, userId);
  return c.json({ ...result, cached: false });
});

app.post('/api/analytics/recompute', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const period = body.period || new Date().toISOString().slice(0, 7);
  const result = await computeAnalytics(period, userId);
  return c.json({ ...result, cached: false });
});

// ========== INVOICE MATCHING (Google Drive) ==========

// Get drive connection status
app.get('/api/drive/status', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({
    sql: 'SELECT id, folder_id, folder_path, status, created_at FROM drive_connections WHERE user_id = ? ORDER BY id DESC LIMIT 1',
    args: [userId]
  });
  if (result.rows.length === 0) return c.json({ connected: false });
  const conn: any = result.rows[0];
  return c.json({ connected: conn.status === 'active', ...conn });
});

// POST /api/drive/connect → generate Google OAuth URL
app.post('/api/drive/connect', async (c) => {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const DRIVE_REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI || 'https://65.108.14.251:8080/konto/api/drive-callback';

  if (!GOOGLE_CLIENT_ID) {
    return c.json({ error: 'Google Drive not configured' }, 500);
  }

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: DRIVE_REDIRECT_URI,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return c.json({ url });
});

app.delete('/api/drive/disconnect', async (c) => {
  const userId = await getUserId(c);
  await db.execute({ sql: 'DELETE FROM drive_connections WHERE user_id = ?', args: [userId] });
  return c.json({ ok: true });
});

// GET /api/drive-callback?code=... → exchange code for tokens
app.get('/api/drive-callback', async (c) => {
  const code = c.req.query('code');
  const error = c.req.query('error');

  if (error) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Drive connection failed</h1><p>${error}</p>
      <a href="/konto/invoices" style="color:#d4a812;">← Back to Invoices</a>
    </body></html>`);
  }
  if (!code) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">No code received</h1>
      <a href="/konto/invoices" style="color:#d4a812;">← Back to Invoices</a>
    </body></html>`);
  }

  const userId = await getUserId(c);
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const DRIVE_REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI || 'https://65.108.14.251:8080/konto/api/drive-callback';

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        code,
        redirect_uri: DRIVE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || tokenData.error || 'Token exchange failed');

    const { access_token, refresh_token, expires_in } = tokenData;
    const expiry = expires_in ? new Date(Date.now() + expires_in * 1000).toISOString() : null;

    await db.execute({
      sql: `INSERT INTO drive_connections (user_id, access_token, refresh_token, token_expiry, status)
            VALUES (?, ?, ?, ?, 'active')
            ON CONFLICT(id) DO UPDATE SET 
              access_token = excluded.access_token,
              refresh_token = excluded.refresh_token,
              token_expiry = excluded.token_expiry,
              status = 'active'`,
      args: [userId, access_token, refresh_token || null, expiry]
    });

    return c.html(`<html><head><meta http-equiv="refresh" content="3;url=/konto/invoices"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#10b981;">✅ Drive connected!</h1>
      <p>Tokens saved. Redirecting to Invoices...</p>
      <a href="/konto/invoices" style="color:#d4a812;">← Go to Invoices</a>
    </body></html>`);
  } catch (err: any) {
    console.error('Drive callback error:', err);
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1><p>${err.message}</p>
      <a href="/konto/invoices" style="color:#d4a812;">← Back to Invoices</a>
    </body></html>`);
  }
});

// Scan invoices from Drive folder (simulated — real OCR needs pdf-parse/tesseract)
app.post('/api/invoices/scan', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const companyId = body.company_id || null;

  // Check drive connection
  const conn = await db.execute({
    sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  if (conn.rows.length === 0) {
    return c.json({ error: 'No active Google Drive connection. Connect in Settings first.' }, 400);
  }

  const driveConn: any = conn.rows[0];
  const accessToken = driveConn.access_token;
  const folderId = driveConn.folder_id;

  if (!accessToken) {
    return c.json({ error: 'Missing Drive access token' }, 400);
  }

  try {
    // List PDF files in Drive folder
    let query = "mimeType='application/pdf'";
    if (folderId) query += ` and '${folderId}' in parents`;

    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=100`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      return c.json({ error: 'Drive API error', details: err }, 502);
    }

    const listData: any = await listRes.json();
    const files = listData.files || [];

    let scanned = 0;
    let matched = 0;
    let errors: string[] = [];

    for (const file of files) {
      // Skip if already cached
      const existing = await db.execute({
        sql: 'SELECT id FROM invoice_cache WHERE drive_file_id = ?',
        args: [file.id]
      });
      if (existing.rows.length > 0) continue;

      try {
        // Download file content for OCR
        const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!dlRes.ok) {
          errors.push(`Failed to download ${file.name}`);
          continue;
        }

        const buffer = await dlRes.arrayBuffer();

        // Extract metadata from filename as fallback
        // Pattern: YYYY-MM-DD_Vendor_Amount.pdf or similar
        const extracted = extractInvoiceMetadata(file.name, Buffer.from(buffer));

        // Try to match with transaction
        let matchedTxId: number | null = null;
        let confidence = 0;

        if (extracted.amount) {
          // Look for transactions within ±5 days with similar amount
          const dateStr = extracted.date || file.modifiedTime?.slice(0, 10) || '';
          const matchQuery = companyId
            ? `SELECT t.id, t.label, t.amount, t.date FROM transactions t
               JOIN bank_accounts ba ON t.bank_account_id = ba.id
               WHERE ba.company_id = ? AND ABS(ABS(t.amount) - ?) < 0.02
               AND t.date BETWEEN date(?, '-5 days') AND date(?, '+5 days')
               AND t.id NOT IN (SELECT transaction_id FROM invoice_cache WHERE transaction_id IS NOT NULL)
               ORDER BY ABS(julianday(t.date) - julianday(?)) LIMIT 1`
            : `SELECT t.id, t.label, t.amount, t.date FROM transactions t
               WHERE ABS(ABS(t.amount) - ?) < 0.02
               AND t.date BETWEEN date(?, '-5 days') AND date(?, '+5 days')
               AND t.id NOT IN (SELECT transaction_id FROM invoice_cache WHERE transaction_id IS NOT NULL)
               ORDER BY ABS(julianday(t.date) - julianday(?)) LIMIT 1`;

          const matchArgs = companyId
            ? [companyId, Math.abs(extracted.amount), dateStr, dateStr, dateStr]
            : [Math.abs(extracted.amount), dateStr, dateStr, dateStr];

          const txMatch = await db.execute({ sql: matchQuery, args: matchArgs });

          if (txMatch.rows.length > 0) {
            const tx: any = txMatch.rows[0];
            matchedTxId = tx.id;
            confidence = 0.8; // Base confidence for amount+date match

            // Boost if vendor name matches label
            if (extracted.vendor && tx.label) {
              const vendorLower = extracted.vendor.toLowerCase();
              const labelLower = (tx.label as string).toLowerCase();
              if (labelLower.includes(vendorLower) || vendorLower.includes(labelLower)) {
                confidence = 0.95;
              }
            }
            matched++;
          }
        }

        // Insert metadata into cache
        await db.execute({
          sql: `INSERT INTO invoice_cache (user_id, company_id, transaction_id, drive_file_id, filename, vendor, amount_ht, tva_amount, tva_rate, date, invoice_number, match_confidence)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [userId, companyId, matchedTxId, file.id, file.name,
                 extracted.vendor || null, extracted.amount || null,
                 extracted.tva_amount || null, extracted.tva_rate || null,
                 extracted.date || null, extracted.invoice_number || null,
                 matchedTxId ? confidence : null]
        });
        scanned++;
      } catch (e: any) {
        errors.push(`Error processing ${file.name}: ${e.message}`);
      }
    }

    return c.json({
      ok: true,
      total_files: files.length,
      scanned,
      matched,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (e: any) {
    return c.json({ error: 'Scan failed', details: e.message }, 500);
  }
});

// Extract invoice metadata from filename (and basic text extraction)
function extractInvoiceMetadata(filename: string, _buffer: Buffer) {
  const result: { vendor?: string; amount?: number; date?: string; invoice_number?: string; tva_amount?: number; tva_rate?: number } = {};

  // Try to extract date from filename: YYYY-MM-DD or DD-MM-YYYY
  const dateMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/) || filename.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (dateMatch) {
    if (dateMatch[1].length === 4) {
      result.date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    } else {
      result.date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    }
  }

  // Try to extract amount: look for numbers like 123.45 or 1234,56
  const amountMatch = filename.match(/(\d+[.,]\d{2})/);
  if (amountMatch) {
    result.amount = parseFloat(amountMatch[1].replace(',', '.'));
  }

  // Vendor: take the part between date and amount, or first meaningful word
  const cleaned = filename.replace(/\.pdf$/i, '').replace(/[\d_-]+/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 0) {
    result.vendor = words.join(' ');
  }

  // Invoice number: look for patterns like F-2024-001, INV-123, etc.
  const invMatch = filename.match(/(F|FA|INV|FACT)[- ]?\d+[- ]?\d*/i);
  if (invMatch) {
    result.invoice_number = invMatch[0];
  }

  return result;
}

// Get all cached invoices
app.get('/api/invoices', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');
  const matched = c.req.query('matched'); // 'true', 'false', or omit for all

  let sql = 'SELECT ic.*, t.label as tx_label, t.amount as tx_amount, t.date as tx_date FROM invoice_cache ic LEFT JOIN transactions t ON ic.transaction_id = t.id WHERE ic.user_id = ?';
  const args: any[] = [userId];

  if (companyId) {
    sql += ' AND ic.company_id = ?';
    args.push(Number(companyId));
  }
  if (matched === 'true') {
    sql += ' AND ic.transaction_id IS NOT NULL';
  } else if (matched === 'false') {
    sql += ' AND ic.transaction_id IS NULL';
  }

  sql += ' ORDER BY ic.date DESC, ic.scanned_at DESC';

  const result = await db.execute({ sql, args });
  return c.json(result.rows);
});

// Delete cached invoice
app.delete('/api/invoices/:id', async (c) => {
  const id = c.req.param('id');
  await db.execute({ sql: 'DELETE FROM invoice_cache WHERE id = ?', args: [Number(id)] });
  return c.json({ ok: true });
});

// Manual match: link invoice to transaction
app.post('/api/invoices/:id/match', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { transaction_id } = body;
  await db.execute({
    sql: 'UPDATE invoice_cache SET transaction_id = ?, match_confidence = 1.0 WHERE id = ?',
    args: [transaction_id, Number(id)]
  });
  return c.json({ ok: true });
});

// Unmatch invoice
app.post('/api/invoices/:id/unmatch', async (c) => {
  const id = c.req.param('id');
  await db.execute({
    sql: 'UPDATE invoice_cache SET transaction_id = NULL, match_confidence = NULL WHERE id = ?',
    args: [Number(id)]
  });
  return c.json({ ok: true });
});

// Invoice stats
app.get('/api/invoices/stats', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');

  let whereClause = 'WHERE user_id = ?';
  const args: any[] = [userId];
  if (companyId) {
    whereClause += ' AND company_id = ?';
    args.push(Number(companyId));
  }

  const total = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache ${whereClause}`, args });
  const matchedCount = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache ${whereClause} AND transaction_id IS NOT NULL`, args });
  const unmatchedCount = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache ${whereClause} AND transaction_id IS NULL`, args });

  const totalVal = Number(total.rows[0]?.c || 0);
  const matchedVal = Number(matchedCount.rows[0]?.c || 0);

  return c.json({
    total: totalVal,
    matched: matchedVal,
    unmatched: Number(unmatchedCount.rows[0]?.c || 0),
    match_rate: totalVal > 0 ? Math.round((matchedVal / totalVal) * 100) : 0
  });
});

// ========== BILAN ANNUEL ==========

app.get('/api/bilan/:year', async (c) => {
  const year = parseInt(c.req.param('year'));
  const companyId = c.req.query('company_id');
  const userId = await getUserId(c);

  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  // Base query filter
  let accountFilter = '';
  const baseArgs: any[] = [startDate, endDate];
  if (companyId) {
    accountFilter = 'AND ba.company_id = ?';
    baseArgs.push(Number(companyId));
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
    const mArgs = [mStart, mEnd];
    if (companyId) mArgs.push(companyId as any);

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
  const accountsRes = await db.execute({
    sql: `SELECT ba.name, ba.type, ba.balance, ba.currency
          FROM bank_accounts ba
          WHERE ba.user_id = ? ${companyId ? 'AND ba.company_id = ?' : ''}
          ORDER BY ba.type, ba.name`,
    args: companyId ? [userId, Number(companyId)] : [userId]
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

// ========== USER PREFERENCES ==========

async function ensurePreferences(userId: number) {
  // Check if this is the default demo user (jo@konto.fr)
  const userCheck = await db.execute({ sql: 'SELECT email FROM users WHERE id = ?', args: [userId] });
  const isDefaultUser = userCheck.rows[0]?.email === 'jo@konto.fr';

  // For default user, set onboarded=1 to skip onboarding screen
  if (isDefaultUser) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO user_preferences (user_id, onboarded) VALUES (?, ?)',
      args: [userId, 1]
    });
  } else {
    await db.execute({ sql: 'INSERT OR IGNORE INTO user_preferences (user_id) VALUES (?)', args: [userId] });
  }

  const r = await db.execute({ sql: 'SELECT * FROM user_preferences WHERE user_id = ?', args: [userId] });
  return r.rows[0];
}

app.get('/api/preferences', async (c) => {
  const userId = await getUserId(c);
  const prefs = await ensurePreferences(userId);
  return c.json(prefs);
});

app.patch('/api/preferences', async (c) => {
  const userId = await getUserId(c);
  await ensurePreferences(userId);
  const body = await c.req.json();
  const allowed = ['onboarded', 'display_currency', 'crypto_display', 'kozy_enabled'];
  const sets: string[] = [];
  const args: any[] = [];
  for (const key of allowed) {
    if (body[key] !== undefined) {
      sets.push(`${key} = ?`);
      args.push(body[key]);
    }
  }
  if (sets.length === 0) return c.json({ error: 'No valid fields' }, 400);
  sets.push("updated_at = datetime('now')");
  args.push(userId);
  await db.execute({ sql: `UPDATE user_preferences SET ${sets.join(', ')} WHERE user_id = ?`, args });
  const prefs = await db.execute({ sql: 'SELECT * FROM user_preferences WHERE user_id = ?', args: [userId] });
  return c.json(prefs.rows[0]);
});

// ========== KOZY INTEGRATION ==========

app.get('/api/kozy/properties', async (c) => {
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

app.get('/api/properties/roi', async (c) => {
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
  const costsByApt: Record<number, { total: number; byMonth: Record<string, number>; matched: string[] }> = {};
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

// ========== TRENDS — Universal Category Mapping + Anomaly Detection ==========

const CATEGORY_MAP: Record<string, string[]> = {
  'Énergie': ['edf', 'engie', 'electricite', 'électricité', 'gaz', 'gasoil', 'fioul', 'total energies', 'totalenergies', 'direct energie'],
  'Alimentation': ['carrefour', 'leclerc', 'auchan', 'lidl', 'aldi', 'intermarche', 'monoprix', 'picard', 'franprix', 'casino', 'super u', 'match', 'cora', 'spar', 'biocoop', 'naturalia', 'boulangerie', 'patisserie', 'restaurant', 'mcdo', 'burger', 'kebab', 'sushi', 'pizza', 'uber eats', 'deliveroo', 'just eat'],
  'Eau': ['eau', 'veolia', 'suez', 'lyonnaise des eaux', 'saur'],
  'Transport': ['essence', 'shell', 'bp ', 'sncf', 'ratp', 'navigo', 'uber', 'bolt', 'taxi', 'parking', 'stationnement', 'peage', 'péage', 'autoroute', 'vinci autoroute'],
  'Impôts & Taxes': ['impot', 'impôt', 'dgfip', 'tresor public', 'trésor public', 'taxe', 'prelevement a la source', 'urssaf', 'direction generale'],
  'Assurances': ['axa', 'maif', 'macif', 'matmut', 'groupama', 'allianz', 'generali', 'assurance', 'mutuelle', 'harmonie', 'mgen'],
  'Internet & Mobile': ['bouygues telecom', 'orange', 'sfr', 'free ', 'free mobile', 'sosh', 'red by sfr', 'b&you'],
  'Habillement': ['zara', 'h&m', 'kiabi', 'decathlon', 'nike', 'adidas', 'primark', 'uniqlo', 'celio', 'jules'],
  'Loisirs': ['netflix', 'spotify', 'disney', 'canal+', 'amazon prime', 'cinema', 'cinéma', 'fnac', 'cultura', 'jeux', 'playstation', 'xbox', 'steam', 'apple.com/bill'],
  'Loyers & Charges': ['loyer', 'copropriete', 'copropriété', 'syndic', 'foncia', 'nexity', 'credit immobilier', 'crédit immobilier', 'pret immobilier', 'prêt immobilier', 'emprunt', 'mortgage'],
};

function classifyTransaction(label: string): string {
  const lower = (label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lowerOrig = (label || '').toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    for (const kw of keywords) {
      if (lowerOrig.includes(kw) || lower.includes(kw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
        return cat;
      }
    }
  }
  return 'Autre';
}

app.get('/api/trends', async (c) => {
  const months = parseInt(c.req.query('months') || '6');
  const scope = c.req.query('usage') || c.req.query('scope') || 'personal'; // personal or professional
  const userId = await getUserId(c);

  // Get date range
  const now = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const fromStr = fromDate.toISOString().split('T')[0];

  const result = await db.execute({
    sql: `SELECT t.date, t.amount, t.label, ba.usage
          FROM transactions t
          LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE t.date >= ? AND ba.usage = ? AND t.amount < 0 AND ba.user_id = ?
          ORDER BY t.date`,
    args: [fromStr, scope, userId]
  });

  // Group by category + month
  const grouped: Record<string, Record<string, number>> = {};
  for (const tx of result.rows as any[]) {
    const cat = classifyTransaction(tx.label);
    const month = tx.date?.substring(0, 7);
    if (!month) continue;
    if (!grouped[cat]) grouped[cat] = {};
    if (!grouped[cat][month]) grouped[cat][month] = 0;
    grouped[cat][month] += Math.abs(tx.amount);
  }

  // Build result with anomaly detection
  const allMonths: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
    allMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const categories: {
    category: string;
    totalSpend: number;
    months: { month: string; amount: number; avgLast3: number | null; changePercent: number | null }[];
  }[] = [];

  for (const [cat, monthData] of Object.entries(grouped)) {
    let totalSpend = 0;
    const monthEntries = allMonths.map((m, idx) => {
      const amount = monthData[m] || 0;
      totalSpend += amount;

      // Rolling 3-month average (from previous months)
      let avgLast3: number | null = null;
      let changePercent: number | null = null;
      if (idx >= 3) {
        const prev3 = [allMonths[idx - 1], allMonths[idx - 2], allMonths[idx - 3]];
        const avg = prev3.reduce((s, pm) => s + (monthData[pm] || 0), 0) / 3;
        avgLast3 = Math.round(avg * 100) / 100;
        if (avg > 0) {
          changePercent = Math.round(((amount - avg) / avg) * 100);
        }
      }

      return { month: m, amount: Math.round(amount * 100) / 100, avgLast3, changePercent };
    });

    categories.push({ category: cat, totalSpend: Math.round(totalSpend * 100) / 100, months: monthEntries });
  }

  // Sort by total spend descending, return top 6
  categories.sort((a, b) => b.totalSpend - a.totalSpend);

  return c.json({ categories: categories.slice(0, 6), allMonths, scope });
});

// ========== START SERVER ==========

export { app };

async function main() {
  await initDatabase();
  await migrateDatabase();
  serve({ fetch: app.fetch, port: Number(process.env.PORT) || 5004 }, (info) => {
    console.log(`🦎 Konto API running on http://localhost:${info.port}`);
  });
}

main().catch(console.error);
