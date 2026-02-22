import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { verifyToken } from '@clerk/backend';
import db, { initDatabase, migrateDatabase, ensureUser } from './db.js';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as ecc from 'tiny-secp256k1';
import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';

// Import cron jobs - these will start automatically when imported
import './jobs/createDailySnapshots.js';
import './jobs/refreshStaleConnections.js';
import { cronMonitor } from './jobs/cronMonitor.js';

const bip32 = BIP32Factory(ecc);

const app = new Hono();

// --- CORS: restrict in production ---
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5003', 'http://localhost:5173'];

app.use('/*', cors({
  origin: (origin) => {
    // In production, only allow configured origins
    if (!origin) return origin; // same-origin requests
    if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) return origin;
    // Allow Vercel preview URLs
    if (origin.endsWith('.vercel.app')) return origin;
    return ALLOWED_ORIGINS[0]; // fallback
  },
  credentials: true,
}));

// --- Security headers ---
app.use('/*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

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

// --- Helper: get valid Drive access token (refresh if expired) ---
async function getDriveAccessToken(driveConn: any): Promise<string> {
  const now = new Date();
  const expiry = driveConn.token_expiry ? new Date(driveConn.token_expiry) : null;

  // If token not expired (with 5min buffer), return as-is
  if (expiry && expiry.getTime() - 5 * 60 * 1000 > now.getTime()) {
    return driveConn.access_token;
  }

  // Need to refresh
  if (!driveConn.refresh_token) {
    console.warn(`Drive connection ${driveConn.id}: no refresh_token, returning current access_token`);
    return driveConn.access_token;
  }

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  try {
    console.log(`Refreshing Drive token for connection ${driveConn.id}...`);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        refresh_token: driveConn.refresh_token,
        grant_type: 'refresh_token',
      }).toString(),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      console.error(`Drive token refresh failed for connection ${driveConn.id}:`, tokenData);
      return driveConn.access_token; // fallback to old token
    }

    const newAccessToken = tokenData.access_token;
    const newExpiry = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    await db.execute({
      sql: 'UPDATE drive_connections SET access_token = ?, token_expiry = ? WHERE id = ?',
      args: [newAccessToken, newExpiry, driveConn.id],
    });

    console.log(`Drive token refreshed for connection ${driveConn.id}`);
    return newAccessToken;
  } catch (err: any) {
    console.error(`Drive token refresh error for connection ${driveConn.id}:`, err.message);
    return driveConn.access_token; // fallback
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

// --- Profile ---
app.get('/api/profile', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({ sql: 'SELECT id, email, name, phone, address, created_at FROM users WHERE id = ?', args: [userId] });
  if (result.rows.length === 0) return c.json({ error: 'User not found' }, 404);
  return c.json(result.rows[0]);
});

app.put('/api/profile', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();
  const { name, phone, address } = body;
  await db.execute({
    sql: 'UPDATE users SET name = ?, phone = ?, address = ? WHERE id = ?',
    args: [name || '', phone || null, address || null, userId]
  });
  const result = await db.execute({ sql: 'SELECT id, email, name, phone, address, created_at FROM users WHERE id = ?', args: [userId] });
  return c.json(result.rows[0]);
});

// --- RGPD: Account deletion (right to erasure) ---
app.delete('/api/account', async (c) => {
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
  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [userId] });

  return c.json({ ok: true, message: 'All your data has been permanently deleted.' });
});

// --- RGPD: Data export (right to portability) ---
app.get('/api/account/data', async (c) => {
  const userId = await getUserId(c);
  const user = await db.execute({ sql: 'SELECT id, email, name, phone, address, created_at FROM users WHERE id = ?', args: [userId] });
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

// Powens webview wrapper — forces light mode so QR codes remain scannable
app.get('/api/bank/webview', (c) => {
  const target = c.req.query('url');
  if (!target || !target.startsWith('https://webview.powens.com/')) {
    return c.text('Invalid URL', 400);
  }
  return c.html(`<!DOCTYPE html>
<html style="color-scheme:light only">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>Bank Connection</title>
  <style>
    *{margin:0;padding:0}
    html,body{height:100%;background:#fff;color-scheme:light only}
    iframe{width:100%;height:100%;border:none}
    @media(prefers-color-scheme:dark){html,body{background:#fff;color:#000}}
  </style>
</head>
<body><iframe src="${target.replace(/"/g, '&quot;')}"></iframe></body>
</html>`);
});

// Reconnect a specific SCA-blocked connection
app.get('/api/bank/reconnect-url/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
  const userId = await getUserId(c);

  const accRes = await db.execute({
    sql: 'SELECT provider_account_id FROM bank_accounts WHERE id = ? AND user_id = ?',
    args: [accountId, userId]
  });
  if (accRes.rows.length === 0) return c.json({ error: 'Account not found' }, 404);
  const providerAccountId = (accRes.rows[0] as any).provider_account_id;

  // Find which connection owns this account
  const connsRes = await db.execute({
    sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  for (const conn of connsRes.rows as any[]) {
    try {
      const accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${conn.powens_token}` },
      });
      if (!accountsRes.ok) continue;
      const data = await accountsRes.json() as any;
      if ((data.accounts || []).some((a: any) => String(a.id) === providerAccountId)) {
        // Generate a temporary code for the webview
        const codeRes = await fetch(`${POWENS_API}/auth/token/code`, {
          headers: { 'Authorization': `Bearer ${conn.powens_token}` },
        });
        if (!codeRes.ok) {
          // Fallback: use token directly
          const url = `https://webview.powens.com/reconnect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&connection_id=${conn.powens_connection_id}&token=${conn.powens_token}`;
          return c.json({ url, connection_id: conn.powens_connection_id });
        }
        const codeData = await codeRes.json() as any;
        const url = `https://webview.powens.com/reconnect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&connection_id=${conn.powens_connection_id}&code=${codeData.code}`;
        return c.json({ url, connection_id: conn.powens_connection_id });
      }
    } catch {}
  }

  // Fallback to generic connect
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

  // Check Powens connection state — track SCA but don't block sync
  let connectionNeedsSCA = false;
  if (matchedConn?.powens_connection_id) {
    try {
      const connStateRes = await fetch(`${POWENS_API}/users/me/connections/${matchedConn.powens_connection_id}`, {
        headers: { 'Authorization': `Bearer ${connectionToken}` },
      });
      if (connStateRes.ok) {
        const connState = await connStateRes.json() as any;
        if (connState.state === 'SCARequired' || connState.error === 'SCARequired') {
          connectionNeedsSCA = true;
          console.log(`Connection ${matchedConn.id} (powens ${matchedConn.powens_connection_id}) needs SCA — will sync cached data`);
        } else if (connState.error && connState.error !== 'SCARequired') {
          // Real errors like wrongpass — require reconnect
          console.log(`Connection ${matchedConn.id} has error: ${connState.error} — requires reconnect`);
          return c.json({
            error: `Bank connection error: ${connState.error}`,
            reconnect_required: true,
          }, 400);
        }
      }
    } catch (err: any) {
      console.error(`Failed to check connection state:`, err.message);
    }
  }

  try {
    // Also update balance from Powens account data
    try {
      const accDataRes = await fetch(`${POWENS_API}/users/me/accounts/${account.provider_account_id}`, {
        headers: { 'Authorization': `Bearer ${connectionToken}` },
      });
      if (accDataRes.ok) {
        const accData = await accDataRes.json() as any;
        if (accData.balance !== undefined) {
          await db.execute({
            sql: 'UPDATE bank_accounts SET balance = ? WHERE id = ?',
            args: [accData.balance, account.id]
          });
        }
      }
    } catch {}

    // Fetch all available transactions — no date limit, paginate until bank returns nothing
    let allTransactions: any[] = [];
    let txOffset = 0;
    const txPageSize = 500;
    let firstPageRes: Response | null = null;
    while (true) {
      const txPageRes = await fetch(
        `${POWENS_API}/users/me/accounts/${account.provider_account_id}/transactions?limit=${txPageSize}&offset=${txOffset}`,
        { headers: { 'Authorization': `Bearer ${connectionToken}` } }
      );
      if (txOffset === 0) firstPageRes = txPageRes;
      if (!txPageRes.ok) break;
      const pageData = await txPageRes.json() as any;
      const pageTxs = pageData.transactions || [];
      allTransactions = allTransactions.concat(pageTxs);
      if (pageTxs.length < txPageSize) break;
      txOffset += txPageSize;
    }
    const transactions = allTransactions;
    console.log(`Sync account ${accountId}: provider_id=${account.provider_account_id}, powens_status=${firstPageRes?.status}, tx_count=${transactions.length}, sca=${connectionNeedsSCA}`);

    // If Powens returns an error but we know it's SCA — don't fail, just use whatever cached data we got
    if (firstPageRes && !firstPageRes.ok && !connectionNeedsSCA) {
      return c.json({
        error: 'Bank sync failed',
        reconnect_required: true,
        debug: { powens_status: firstPageRes.status, provider_account_id: account.provider_account_id }
      }, 502);
    }

    for (const tx of transactions) {
      const txHash = tx.id ? `powens_${tx.id}` : null;
      await db.execute({
        sql: `INSERT INTO transactions (bank_account_id, date, amount, label, category, tx_hash)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(bank_account_id, tx_hash) DO UPDATE SET
                date=excluded.date, amount=excluded.amount, label=excluded.label, category=excluded.category`,
        args: [account.id, tx.date || tx.rdate, tx.value, tx.original_wording || tx.wording, tx.category?.name || null, txHash]
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
      sql: 'UPDATE bank_accounts SET last_sync = ?, sca_required = ? WHERE id = ?',
      args: [new Date().toISOString(), connectionNeedsSCA ? 1 : 0, account.id]
    });

    return c.json({
      synced: transactions.length,
      investments_synced: investmentsSynced,
      sca_required: connectionNeedsSCA,
    });
  } catch (err: any) {
    console.error(`Sync error for account ${accountId}:`, err.message);
    return c.json({ error: err.message }, 500);
  }
});

// --- Sync all accounts at once (background-friendly) ---
app.post('/api/bank/sync-all', async (c) => {
  const userId = await getUserId(c);

  // Get all active connections
  const connectionsResult = await db.execute({
    sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  const connections = connectionsResult.rows as any[];
  if (connections.length === 0) return c.json({ error: 'No active connections', synced: 0 });

  let totalSynced = 0;
  let totalInvestments = 0;
  let scaConnections: number[] = [];
  let errors = 0;

  for (const conn of connections) {
    const token = conn.powens_token;

    try {
      // Fetch accounts visible to this connection
      const accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!accountsRes.ok) {
        // Try refresh
        const refreshedToken = await refreshPowensToken(conn.id);
        if (!refreshedToken) { errors++; continue; }
        // Retry not needed here — move on
        continue;
      }
      const accountsData = await accountsRes.json() as any;
      const powensAccounts = accountsData.accounts || [];

      // Check connection state for SCA
      let isSCA = false;
      if (conn.powens_connection_id) {
        try {
          const stateRes = await fetch(`${POWENS_API}/users/me/connections/${conn.powens_connection_id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (stateRes.ok) {
            const state = await stateRes.json() as any;
            if (state.state === 'SCARequired' || state.error === 'SCARequired') {
              isSCA = true;
              scaConnections.push(conn.powens_connection_id);
            }
          }
        } catch {}
      }

      // Sync each account
      for (const powensAcc of powensAccounts) {
        const providerId = String(powensAcc.id);
        const accRes = await db.execute({
          sql: 'SELECT id, type FROM bank_accounts WHERE user_id = ? AND provider = ? AND provider_account_id = ?',
          args: [userId, 'powens', providerId]
        });
        if (accRes.rows.length === 0) continue;
        const localAcc = accRes.rows[0] as any;

        // Update balance
        if (powensAcc.balance !== undefined) {
          await db.execute({
            sql: 'UPDATE bank_accounts SET balance = ?, last_sync = ? WHERE id = ?',
            args: [powensAcc.balance, new Date().toISOString(), localAcc.id]
          });
        }

        // Fetch all transactions with pagination — no date limit, take everything the bank provides
        try {
          let bulkAll: any[] = [], bulkOffset = 0;
          while (true) {
            const bRes = await fetch(
              `${POWENS_API}/users/me/accounts/${providerId}/transactions?limit=500&offset=${bulkOffset}`,
              { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!bRes.ok) break;
            const bData = await bRes.json() as any;
            const bTxs = bData.transactions || [];
            bulkAll = bulkAll.concat(bTxs);
            if (bTxs.length < 500) break;
            bulkOffset += 500;
          }
          for (const tx of bulkAll) {
            const txHash = tx.id ? `powens_${tx.id}` : null;
            await db.execute({
              sql: `INSERT INTO transactions (bank_account_id, date, amount, label, category, tx_hash)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(bank_account_id, tx_hash) DO UPDATE SET
                      date=excluded.date, amount=excluded.amount, label=excluded.label, category=excluded.category`,
              args: [localAcc.id, tx.date || tx.rdate, tx.value, tx.original_wording || tx.wording, tx.category?.name || null, txHash]
            });
          }
          totalSynced += bulkAll.length;
        } catch {}

        // Fetch investments for investment accounts
        if (localAcc.type === 'investment') {
          try {
            const invRes = await fetch(`${POWENS_API}/users/me/accounts/${providerId}/investments`, {
              headers: { 'Authorization': `Bearer ${token}` },
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
                  args: [localAcc.id, String(inv.id), inv.label || 'Unknown', inv.code || null, inv.code_type || 'ISIN',
                    inv.quantity || 0, inv.unitprice || 0, inv.original_unitvalue || inv.unitvalue || 0,
                    inv.valuation || 0, inv.diff || 0, inv.diff_percent || 0, inv.portfolio_share || 0,
                    inv.original_currency?.id || 'EUR', inv.vdate || null, inv.last_update || new Date().toISOString()]
                });
              }
              totalInvestments += (invData.investments || []).length;
            }
          } catch {}
        }
      }
    } catch (err: any) {
      console.error(`Sync-all error for connection ${conn.id}:`, err.message);
      errors++;
    }
  }

  console.log(`Sync-all complete: ${totalSynced} tx, ${totalInvestments} investments, ${scaConnections.length} SCA, ${errors} errors`);
  return c.json({
    synced: totalSynced,
    investments_synced: totalInvestments,
    sca_connections: scaConnections,
    errors,
  });
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

interface BlockchainTx {
  tx_hash: string;
  date: string;
  amount: number;
  label: string;
}

async function fetchBlockchainTransactions(network: string, address: string): Promise<BlockchainTx[]> {
  const txs: BlockchainTx[] = [];

  if (network === 'bitcoin') {
    // For xpub: derive addresses and aggregate txs, dedup by txid
    const addresses: string[] = [];
    const addressSet = new Set<string>();
    if (/^[xyz]pub/.test(address)) {
      const node = bip32.fromBase58(address);
      for (const chain of [0, 1]) {
        let emptyCount = 0;
        for (let i = 0; emptyCount < 5 && i < 50; i++) {
          const child = node.derive(chain).derive(i);
          const { address: addr } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network: bitcoin.networks.bitcoin });
          if (!addr) continue;
          try {
            const res = await fetch(`https://blockstream.info/api/address/${addr}`);
            const data = await res.json() as any;
            if ((data.chain_stats?.tx_count || 0) === 0) { emptyCount++; } else { emptyCount = 0; addresses.push(addr); addressSet.add(addr); }
          } catch { emptyCount++; }
        }
      }
    } else {
      addresses.push(address);
      addressSet.add(address);
    }

    const seenTxids = new Set<string>();
    for (const addr of addresses) {
      try {
        const res = await fetch(`https://blockstream.info/api/address/${addr}/txs`);
        const rawTxs = await res.json() as any[];
        for (const tx of rawTxs) {
          if (seenTxids.has(tx.txid)) continue;
          seenTxids.add(tx.txid);
          // Sum inputs from our addresses (sent) and outputs to our addresses (received)
          let sent = 0, received = 0;
          let fromAddr = '', toAddr = '';
          for (const vin of (tx.vin || [])) {
            if (vin.prevout && addressSet.has(vin.prevout.scriptpubkey_address)) {
              sent += vin.prevout.value;
            } else if (vin.prevout) {
              fromAddr = vin.prevout.scriptpubkey_address || '';
            }
          }
          for (const vout of (tx.vout || [])) {
            if (addressSet.has(vout.scriptpubkey_address)) {
              received += vout.value;
            } else {
              toAddr = vout.scriptpubkey_address || '';
            }
          }
          const net = (received - sent) / 1e8;
          const short = (s: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '?';
          const label = net >= 0
            ? `Received ${Math.abs(net).toFixed(8)} BTC from ${short(fromAddr)}`
            : `Sent ${Math.abs(net).toFixed(8)} BTC to ${short(toAddr)}`;
          const timestamp = tx.status?.block_time ? new Date(tx.status.block_time * 1000).toISOString() : new Date().toISOString();
          txs.push({ tx_hash: tx.txid, date: timestamp, amount: net, label });
        }
      } catch (e) { console.error(`BTC tx fetch failed for ${addr}:`, e); }
    }
    return txs;
  }

  if (network === 'xrp' || network === 'ripple') {
    try {
      const res = await fetch('https://s1.ripple.com:51234/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'account_tx', params: [{ account: address, limit: 50 }] }),
      });
      const data = await res.json() as any;
      const transactions = data.result?.transactions || [];
      for (const entry of transactions) {
        const tx = entry.tx_json || entry.tx || {};
        if (tx.TransactionType !== 'Payment') continue;
        const amount = typeof tx.Amount === 'string' ? parseInt(tx.Amount) / 1e6 : 0;
        if (amount === 0) continue;
        const isSent = tx.Account === address;
        const net = isSent ? -amount : amount;
        const peer = isSent ? tx.Destination : tx.Account;
        const short = (s: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '?';
        const label = isSent
          ? `Sent ${amount.toFixed(6)} XRP to ${short(peer)}`
          : `Received ${amount.toFixed(6)} XRP from ${short(peer)}`;
        // XRP epoch starts 2000-01-01, offset = 946684800
        const timestamp = tx.date ? new Date((tx.date + 946684800) * 1000).toISOString() : new Date().toISOString();
        txs.push({ tx_hash: tx.hash, date: timestamp, amount: net, label });
      }
    } catch (e) { console.error('XRP tx fetch failed:', e); }
    return txs;
  }

  if (network === 'solana') {
    try {
      // Get recent signatures
      const sigRes = await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [address, { limit: 30 }] }),
      });
      const sigData = await sigRes.json() as any;
      const signatures = sigData.result || [];
      for (const sig of signatures) {
        try {
          const txRes = await fetch('https://api.mainnet-beta.solana.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }),
          });
          const txData = await txRes.json() as any;
          const meta = txData.result?.meta;
          const msg = txData.result?.transaction?.message;
          if (!meta || !msg) continue;
          // Find our account index to compute SOL balance diff
          const accounts = msg.accountKeys?.map((k: any) => typeof k === 'string' ? k : k.pubkey) || [];
          const idx = accounts.indexOf(address);
          if (idx === -1) continue;
          const pre = (meta.preBalances?.[idx] || 0);
          const post = (meta.postBalances?.[idx] || 0);
          const diff = (post - pre) / 1e9;
          if (Math.abs(diff) < 0.000001) continue; // skip dust / fee-only
          const short = (s: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '?';
          const otherAddr = accounts.find((a: string) => a !== address) || '?';
          const label = diff >= 0
            ? `Received ${Math.abs(diff).toFixed(6)} SOL from ${short(otherAddr)}`
            : `Sent ${Math.abs(diff).toFixed(6)} SOL to ${short(otherAddr)}`;
          const timestamp = sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : new Date().toISOString();
          txs.push({ tx_hash: sig.signature, date: timestamp, amount: diff, label });
        } catch { /* skip individual tx errors */ }
      }
    } catch (e) { console.error('Solana tx fetch failed:', e); }
    return txs;
  }

  // EVM chains — use Blockscout API (free, no API key)
  const evmBlockscout: Record<string, { url: string; currency: string; decimals: number }> = {
    ethereum:  { url: 'https://eth.blockscout.com/api', currency: 'ETH', decimals: 18 },
    base:      { url: 'https://base.blockscout.com/api', currency: 'ETH', decimals: 18 },
    polygon:   { url: 'https://polygon.blockscout.com/api', currency: 'POL', decimals: 18 },
    bnb:       { url: 'https://bsc.blockscout.com/api', currency: 'BNB', decimals: 18 },
    avalanche: { url: 'https://avalanche.blockscout.com/api', currency: 'AVAX', decimals: 18 },
    arbitrum:  { url: 'https://arbitrum.blockscout.com/api', currency: 'ETH', decimals: 18 },
    optimism:  { url: 'https://optimism.blockscout.com/api', currency: 'ETH', decimals: 18 },
  };

  const chain = evmBlockscout[network];
  if (chain) {
    try {
      const res = await fetch(`${chain.url}?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=50`);
      const data = await res.json() as any;
      for (const tx of (data.result || [])) {
        const value = parseFloat(tx.value || '0') / Math.pow(10, chain.decimals);
        if (value === 0) continue; // skip contract interactions with 0 value
        const isSent = tx.from?.toLowerCase() === address.toLowerCase();
        const net = isSent ? -value : value;
        const peer = isSent ? tx.to : tx.from;
        const short = (s: string) => s ? `${s.slice(0, 6)}...${s.slice(-4)}` : '?';
        const label = isSent
          ? `Sent ${value.toFixed(6)} ${chain.currency} to ${short(peer)}`
          : `Received ${value.toFixed(6)} ${chain.currency} from ${short(peer)}`;
        const timestamp = tx.timeStamp ? new Date(parseInt(tx.timeStamp) * 1000).toISOString() : new Date().toISOString();
        txs.push({ tx_hash: tx.hash, date: timestamp, amount: net, label });
      }
    } catch (e) { console.error(`EVM tx fetch failed for ${network}:`, e); }
    return txs;
  }

  return txs;
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

    // Fetch and insert on-chain transactions
    let txCount = 0;
    try {
      const txs = await fetchBlockchainTransactions(account.blockchain_network, account.blockchain_address);
      for (const tx of txs) {
        const res = await db.execute({
          sql: `INSERT OR IGNORE INTO transactions (bank_account_id, date, amount, label, category, is_pro, tx_hash) VALUES (?, ?, ?, ?, 'Crypto', 0, ?)`,
          args: [id, tx.date, tx.amount, tx.label, tx.tx_hash],
        });
        if (res.rowsAffected > 0) txCount++;
      }
    } catch (txErr: any) {
      console.error(`Blockchain tx fetch failed for account ${id}:`, txErr.message);
    }

    return c.json({ balance, currency, synced: txCount });
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

app.get('/api/budget/cashflow', async (c) => {
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

// ========== SALARY BENCHMARKS ==========

const SALARY_BENCHMARKS: Record<string, Record<number, { p: number; gross: number }[]>> = {
  FR: {
    2021: [{ p: 10, gross: 13000 }, { p: 25, gross: 18800 }, { p: 50, gross: 25600 }, { p: 75, gross: 36200 }, { p: 90, gross: 50000 }, { p: 95, gross: 62000 }, { p: 99, gross: 95000 }],
    2022: [{ p: 10, gross: 13300 }, { p: 25, gross: 19100 }, { p: 50, gross: 26100 }, { p: 75, gross: 36900 }, { p: 90, gross: 51000 }, { p: 95, gross: 63500 }, { p: 99, gross: 98000 }],
    2023: [{ p: 10, gross: 13500 }, { p: 25, gross: 19500 }, { p: 50, gross: 26400 }, { p: 75, gross: 37500 }, { p: 90, gross: 52000 }, { p: 95, gross: 65000 }, { p: 99, gross: 100000 }],
  },
  CH: {
    2021: [{ p: 10, gross: 37000 }, { p: 25, gross: 54500 }, { p: 50, gross: 79200 }, { p: 75, gross: 107000 }, { p: 90, gross: 136000 }, { p: 95, gross: 160000 }, { p: 99, gross: 205000 }],
    2022: [{ p: 10, gross: 38000 }, { p: 25, gross: 56000 }, { p: 50, gross: 81456 }, { p: 75, gross: 110000 }, { p: 90, gross: 140000 }, { p: 95, gross: 165000 }, { p: 99, gross: 210000 }],
    2023: [{ p: 10, gross: 39000 }, { p: 25, gross: 57500 }, { p: 50, gross: 83000 }, { p: 75, gross: 112000 }, { p: 90, gross: 143000 }, { p: 95, gross: 168000 }, { p: 99, gross: 215000 }],
  },
  US: {
    2021: [{ p: 10, gross: 20000 }, { p: 25, gross: 32000 }, { p: 50, gross: 52000 }, { p: 75, gross: 82000 }, { p: 90, gross: 118000 }, { p: 95, gross: 150000 }, { p: 99, gross: 230000 }],
    2022: [{ p: 10, gross: 21000 }, { p: 25, gross: 33500 }, { p: 50, gross: 54000 }, { p: 75, gross: 86000 }, { p: 90, gross: 124000 }, { p: 95, gross: 157000 }, { p: 99, gross: 240000 }],
    2023: [{ p: 10, gross: 22000 }, { p: 25, gross: 35000 }, { p: 50, gross: 58000 }, { p: 75, gross: 90000 }, { p: 90, gross: 130000 }, { p: 95, gross: 165000 }, { p: 99, gross: 250000 }],
  },
  UK: {
    2021: [{ p: 10, gross: 14200 }, { p: 25, gross: 21800 }, { p: 50, gross: 31285 }, { p: 75, gross: 47000 }, { p: 90, gross: 68000 }, { p: 95, gross: 87000 }, { p: 99, gross: 150000 }],
    2022: [{ p: 10, gross: 14800 }, { p: 25, gross: 22500 }, { p: 50, gross: 32300 }, { p: 75, gross: 49000 }, { p: 90, gross: 71000 }, { p: 95, gross: 91000 }, { p: 99, gross: 155000 }],
    2023: [{ p: 10, gross: 15000 }, { p: 25, gross: 23000 }, { p: 50, gross: 35000 }, { p: 75, gross: 52000 }, { p: 90, gross: 75000 }, { p: 95, gross: 95000 }, { p: 99, gross: 160000 }],
  },
  DE: {
    2021: [{ p: 10, gross: 19200 }, { p: 25, gross: 28800 }, { p: 50, gross: 42600 }, { p: 75, gross: 58500 }, { p: 90, gross: 78000 }, { p: 95, gross: 97000 }, { p: 99, gross: 145000 }],
    2022: [{ p: 10, gross: 19600 }, { p: 25, gross: 29400 }, { p: 50, gross: 43200 }, { p: 75, gross: 59200 }, { p: 90, gross: 79000 }, { p: 95, gross: 98500 }, { p: 99, gross: 147000 }],
    2023: [{ p: 10, gross: 20000 }, { p: 25, gross: 30000 }, { p: 50, gross: 43750 }, { p: 75, gross: 60000 }, { p: 90, gross: 80000 }, { p: 95, gross: 100000 }, { p: 99, gross: 150000 }],
  },
};

app.get('/api/salary-benchmarks', (c) => {
  return c.json(SALARY_BENCHMARKS);
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

async function computeAnalytics(period: string, userId: number = 1, scope?: { usage?: string; company_id?: string }) {
  const [year, month] = period.split('-').map(Number);
  const startDate = `${period}-01`;
  const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  // Build scope filter (all queries JOIN ba via t.bank_account_id)
  let scopeClause = '';
  const scopeArgs: any[] = [];
  if (scope?.usage === 'personal') { scopeClause = " AND (ba.usage = 'personal' OR ba.usage IS NULL)"; }
  else if (scope?.usage === 'professional') { scopeClause = " AND ba.usage = 'professional'"; }
  else if (scope?.company_id) { scopeClause = ' AND ba.company_id = ?'; scopeArgs.push(scope.company_id); }

  const join = 'LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id';

  // Total income & expenses for the period
  const incomeRes = await db.execute({
    sql: `SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t ${join}
          WHERE t.date >= ? AND t.date < ? AND t.amount > 0${scopeClause}`,
    args: [startDate, endDate, ...scopeArgs]
  });
  const expenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total FROM transactions t ${join}
          WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}`,
    args: [startDate, endDate, ...scopeArgs]
  });

  const totalIncome = Number(incomeRes.rows[0]?.total || 0);
  const totalExpenses = Number(expenseRes.rows[0]?.total || 0);
  const savingsRate = totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 100) : 0;

  // Top 5 expense categories
  const topCatsRes = await db.execute({
    sql: `SELECT COALESCE(t.category, 'Non catégorisé') as category, SUM(ABS(t.amount)) as total
          FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}
          GROUP BY t.category ORDER BY total DESC LIMIT 5`,
    args: [startDate, endDate, ...scopeArgs]
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
    sql: `SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount > 0${scopeClause}`,
    args: [prevStart, prevEnd, ...scopeArgs]
  });
  const prevExpenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}`,
    args: [prevStart, prevEnd, ...scopeArgs]
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
    sql: `SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount > 0${scopeClause}`,
    args: [yoyStart, yoyEnd, ...scopeArgs]
  });
  const yoyExpenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}`,
    args: [yoyStart, yoyEnd, ...scopeArgs]
  });
  const yoyIncome = Number(yoyIncomeRes.rows[0]?.total || 0);
  const yoyExpenses = Number(yoyExpenseRes.rows[0]?.total || 0);

  // Recurring expenses (labels appearing 2+ months in last 3 months)
  const threeMonthsAgo = month <= 3
    ? `${year - 1}-${String(12 + month - 3).padStart(2, '0')}-01`
    : `${year}-${String(month - 3).padStart(2, '0')}-01`;

  const recurringRes = await db.execute({
    sql: `SELECT t.label, COUNT(DISTINCT strftime('%Y-%m', t.date)) as months, AVG(ABS(t.amount)) as avg_amount
          FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0 AND t.label IS NOT NULL${scopeClause}
          GROUP BY LOWER(t.label) HAVING months >= 2 ORDER BY avg_amount DESC LIMIT 10`,
    args: [threeMonthsAgo, endDate, ...scopeArgs]
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
    const inc = await db.execute({ sql: `SELECT COALESCE(SUM(t.amount), 0) as t FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount > 0${scopeClause}`, args: [s, e, ...scopeArgs] });
    const exp = await db.execute({ sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as t FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}`, args: [s, e, ...scopeArgs] });
    trends.push({ period: p, income: Number(inc.rows[0]?.t || 0), expenses: Number(exp.rows[0]?.t || 0) });
  }

  const metrics = {
    totalIncome, totalExpenses, savingsRate,
    topCategories, recurring, trends,
    mom: { income: momIncome, expenses: momExpenses },
    yoy: { income: yoyIncome, expenses: yoyExpenses, incomeChange: yoyIncome > 0 ? Math.round(((totalIncome - yoyIncome) / yoyIncome) * 100) : 0, expensesChange: yoyExpenses > 0 ? Math.round(((totalExpenses - yoyExpenses) / yoyExpenses) * 100) : 0 },
  };

  return { ...metrics, computed_at: new Date().toISOString() };
}

app.get('/api/analytics', async (c) => {
  const period = c.req.query('period') || new Date().toISOString().slice(0, 7);
  const userId = await getUserId(c);
  const usage = c.req.query('usage');
  const company_id = c.req.query('company_id');
  const scope = usage || company_id ? { usage: usage || undefined, company_id: company_id || undefined } : undefined;
  const result = await computeAnalytics(period, userId, scope);
  return c.json({ ...result, cached: false });
});

// ========== INVOICE MATCHING (Google Drive) ==========

// Get drive connection status
app.get('/api/drive/status', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');

  if (companyId) {
    // Try company-specific first, fall back to global
    const specific = await db.execute({
      sql: 'SELECT id, company_id, folder_id, folder_path, status, created_at FROM drive_connections WHERE user_id = ? AND company_id = ? AND status = ? LIMIT 1',
      args: [userId, parseInt(companyId), 'active'],
    });
    if (specific.rows.length > 0) {
      const conn: any = specific.rows[0];
      return c.json({ connected: true, ...conn });
    }
    // Fall back to global connection
    const global = await db.execute({
      sql: 'SELECT id, company_id, folder_id, folder_path, status, created_at FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
      args: [userId, 'active'],
    });
    if (global.rows.length > 0) {
      const conn: any = global.rows[0];
      return c.json({ connected: true, ...conn });
    }
    return c.json({ connected: false });
  }

  const result = await db.execute({
    sql: 'SELECT id, company_id, folder_id, folder_path, status, created_at FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
    args: [userId, 'active'],
  });
  if (result.rows.length === 0) return c.json({ connected: false });
  const conn: any = result.rows[0];
  return c.json({ connected: conn.status === 'active', ...conn });
});

// POST /api/drive/connect → generate Google OAuth URL
app.post('/api/drive/connect', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const companyId = body.company_id || null;
  const returnTo = body.return_to || null;
  const withUpload = body.with_upload || false;

  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const DRIVE_REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI || 'https://65.108.14.251:8080/konto/api/drive-callback';

  if (!GOOGLE_CLIENT_ID) {
    return c.json({ error: 'Google Drive not configured' }, 500);
  }

  // Encode company_id and return_to in state parameter for OAuth callback
  const stateData: any = {};
  if (companyId) stateData.company_id = companyId;
  if (returnTo) stateData.return_to = returnTo;
  const state = Object.keys(stateData).length > 0 ? Buffer.from(JSON.stringify(stateData)).toString('base64') : '';

  // Use drive scope: read + copy (for OCR) + upload
  const scope = 'https://www.googleapis.com/auth/drive';

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: DRIVE_REDIRECT_URI,
    scope,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    ...(state && { state }),
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return c.json({ url });
});

app.delete('/api/drive/disconnect', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');

  const sql = companyId
    ? 'DELETE FROM drive_connections WHERE user_id = ? AND company_id = ?'
    : 'DELETE FROM drive_connections WHERE user_id = ? AND company_id IS NULL';

  const args = companyId ? [userId, parseInt(companyId)] : [userId];

  await db.execute({ sql, args });
  return c.json({ ok: true });
});

// GET /api/drive/folders - List folders from Google Drive
app.get('/api/drive/folders', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');

  let driveConn: any = null;
  if (companyId) {
    const specific = await db.execute({ sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id = ? AND status = ? LIMIT 1', args: [userId, parseInt(companyId), 'active'] });
    if (specific.rows.length > 0) driveConn = specific.rows[0];
    else {
      const global = await db.execute({ sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1', args: [userId, 'active'] });
      if (global.rows.length > 0) driveConn = global.rows[0];
    }
  } else {
    const result = await db.execute({ sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1', args: [userId, 'active'] });
    if (result.rows.length > 0) driveConn = result.rows[0];
  }

  if (!driveConn) {
    return c.json({ error: 'No active Google Drive connection' }, 400);
  }
  const accessToken = await getDriveAccessToken(driveConn);

  try {
    // Get parent folder ID from query (for nested navigation)
    const parentFolderId = c.req.query('parent_id');

    // Build query for folders
    let query = "mimeType='application/vnd.google-apps.folder'";
    if (parentFolderId) {
      query += ` and '${parentFolderId}' in parents`;
    } else {
      // Root level: folders not in trash and in "My Drive" (not shared drives)
      query += " and 'root' in parents";
    }

    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&orderBy=name&pageSize=100`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      return c.json({ error: 'Drive API error', details: err }, 502);
    }

    const listData: any = await listRes.json();
    return c.json({ folders: listData.files || [] });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// PATCH /api/drive/folder - Update folder for a drive connection
app.patch('/api/drive/folder', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();
  const { company_id, folder_id, folder_name } = body;

  const sql = company_id
    ? 'UPDATE drive_connections SET folder_id = ?, folder_path = ? WHERE user_id = ? AND company_id = ? AND status = ?'
    : 'UPDATE drive_connections SET folder_id = ?, folder_path = ? WHERE user_id = ? AND company_id IS NULL AND status = ?';

  const args = company_id
    ? [folder_id || null, folder_name || null, userId, company_id, 'active']
    : [folder_id || null, folder_name || null, userId, 'active'];

  await db.execute({ sql, args });
  return c.json({ ok: true });
});

// GET /api/drive-callback?code=... → exchange code for tokens
app.get('/api/drive-callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  // Extract company_id and return_to from state parameter
  let companyId = null;
  let returnTo = '/konto/invoices';
  if (state) {
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      companyId = decoded.company_id || null;
      returnTo = decoded.return_to || '/konto/invoices';
    } catch (e) {
      console.error('Failed to decode state:', e);
    }
  }

  if (error) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Drive connection failed</h1><p>${error}</p>
      <a href="${returnTo}" style="color:#d4a812;">← Retour</a>
    </body></html>`);
  }
  if (!code) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">No code received</h1>
      <a href="${returnTo}" style="color:#d4a812;">← Retour</a>
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
      sql: `INSERT INTO drive_connections (user_id, company_id, access_token, refresh_token, token_expiry, status)
            VALUES (?, ?, ?, ?, ?, 'active')
            ON CONFLICT(id) DO UPDATE SET
              access_token = excluded.access_token,
              refresh_token = excluded.refresh_token,
              token_expiry = excluded.token_expiry,
              status = 'active'`,
      args: [userId, companyId, access_token, refresh_token || null, expiry]
    });

    return c.html(`<html><head><meta http-equiv="refresh" content="2;url=${returnTo}"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#10b981;">✅ Drive connecté !</h1>
      <p>Redirection en cours...</p>
      <a href="${returnTo}" style="color:#d4a812;">← Retour</a>
    </body></html>`);
  } catch (err: any) {
    console.error('Drive callback error:', err);
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1><p>${err.message}</p>
      <a href="${returnTo}" style="color:#d4a812;">← Retour</a>
    </body></html>`);
  }
});

// Recursively collect all subfolder IDs under a given Drive folder (max 5 levels)
async function collectDriveFolderIds(rootId: string, token: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [rootId];
  const ids = [rootId];
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and '${rootId}' in parents and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return ids;
  const data: any = await res.json();
  for (const sub of (data.files || [])) {
    const subIds = await collectDriveFolderIds(sub.id, token, depth + 1);
    ids.push(...subIds);
  }
  return ids;
}

// --- In-memory scan status tracker ---
interface ScanStatus {
  status: 'running' | 'done' | 'error';
  total: number;
  processed: number;
  scanned: number;
  matched: number;
  errors: string[];
  started_at: number;
  finished_at?: number;
}
const scanJobs = new Map<string, ScanStatus>();

// Clean up old scan jobs (>1h)
setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [id, job] of scanJobs) {
    if (job.finished_at && job.finished_at < cutoff) scanJobs.delete(id);
  }
}, 600_000);

// List all PDFs from Drive folder, handling pagination (>100 files)
async function listAllDrivePdfs(folderId: string | null, accessToken: string): Promise<{ id: string; name: string; modifiedTime: string }[]> {
  let query = "mimeType='application/pdf' and trashed=false";
  if (folderId) {
    const allFolderIds = await collectDriveFolderIds(folderId, accessToken);
    const parentClause = allFolderIds.map(id => `'${id}' in parents`).join(' or ');
    query += ` and (${parentClause})`;
  }

  const files: { id: string; name: string; modifiedTime: string }[] = [];
  let pageToken: string | null = null;

  do {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken,files(id,name,modifiedTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '200',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) break;
    const data: any = await res.json();
    files.push(...(data.files || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken && files.length < 1000); // safety cap

  return files;
}

// Start scan — returns scan_id, processes in background
app.post('/api/invoices/scan', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const companyId = body.company_id || null;

  // Drive connection is global (one per user), folders are per-company
  const conn = await db.execute({ sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND status = ? ORDER BY company_id IS NULL DESC LIMIT 1', args: [userId, 'active'] });
  if (conn.rows.length === 0) {
    return c.json({ error: 'No active Google Drive connection. Connect in Settings first.' }, 400);
  }

  const driveConn: any = conn.rows[0];
  const accessToken = await getDriveAccessToken(driveConn);
  if (!accessToken) return c.json({ error: 'Missing Drive access token' }, 400);

  // Resolve folder
  let folderId = driveConn.folder_id;
  const scanYear = body.year || null;
  if (scanYear) {
    const purpose = companyId ? `invoices_${scanYear}_${companyId}` : `invoices_${scanYear}`;
    const mapping = await db.execute({ sql: 'SELECT folder_id FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?', args: [userId, purpose] });
    if (mapping.rows.length > 0 && mapping.rows[0].folder_id) folderId = String(mapping.rows[0].folder_id);
  }

  // Force re-scan: clear existing cache for this scope
  if (body.force) {
    const delSql = companyId
      ? 'DELETE FROM invoice_cache WHERE user_id = ? AND company_id = ?'
      : 'DELETE FROM invoice_cache WHERE user_id = ? AND company_id IS NULL';
    const delArgs = companyId ? [userId, companyId] : [userId];
    await db.execute({ sql: delSql, args: delArgs });
  }

  const scanId = `scan_${userId}_${Date.now()}`;
  const job: ScanStatus = { status: 'running', total: 0, processed: 0, scanned: 0, matched: 0, errors: [], started_at: Date.now() };
  scanJobs.set(scanId, job);

  // Return immediately — process in background
  // (Do NOT await this promise)
  (async () => {
    try {
      const files = await listAllDrivePdfs(folderId, accessToken);
      job.total = files.length;

      for (const file of files) {
        try {
          // Skip already cached
          const existing = await db.execute({
            sql: 'SELECT id FROM invoice_cache WHERE drive_file_id = ?',
            args: [file.id]
          });
          if (existing.rows.length > 0) {
            job.processed++;
            continue;
          }

          // Download PDF
          const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
            headers: { Authorization: `Bearer ${accessToken}` }
          });
          if (!dlRes.ok) {
            job.errors.push(`Download failed: ${file.name}`);
            job.processed++;
            continue;
          }

          const buffer = Buffer.from(await dlRes.arrayBuffer());

          // Extract metadata: filename → pdf-parse → Drive OCR
          const extracted = await extractInvoiceMetadata(file.name, buffer, file.id, accessToken);

          // Weighted transaction matching — needs 2 of 3 signals: amount, date, label
          let matchedTxId: number | null = null;
          let bestScore = 0;
          const dateStr = extracted.date || file.modifiedTime?.slice(0, 10) || '';
          const invAmt = extracted.amount ? Math.abs(extracted.amount) : null;

          console.log(`[SCAN] ${file.name} → extracted: amount=${invAmt}, date=${dateStr}, vendor=${extracted.vendor}, method=${extracted.extraction_method}`);

          // Helper: extract USD amount from bank label (e.g. "100,05 USD" → 100.05)
          function extractUsdFromLabel(label: string): number | null {
            const m = label.match(/([\d]+[,.][\d]{2})\s*USD/i);
            if (m) return parseFloat(m[1].replace(',', '.'));
            return null;
          }

          if (invAmt || (extracted.vendor && dateStr)) {
            // Search by date range only — scoring handles the rest
            const matchQuery = companyId
              ? `SELECT t.id, t.label, t.amount, t.date FROM transactions t
                 JOIN bank_accounts ba ON t.bank_account_id = ba.id
                 WHERE ba.company_id = ? AND ba.type = 'checking'
                 AND t.date BETWEEN date(?, '-30 days') AND date(?, '+30 days')
                 AND t.id NOT IN (SELECT transaction_id FROM invoice_cache WHERE transaction_id IS NOT NULL)
                 AND ${blocklist_sql}
                 LIMIT 50`
              : `SELECT t.id, t.label, t.amount, t.date FROM transactions t
                 WHERE t.date BETWEEN date(?, '-30 days') AND date(?, '+30 days')
                 AND t.id NOT IN (SELECT transaction_id FROM invoice_cache WHERE transaction_id IS NOT NULL)
                 LIMIT 50`;
            const matchArgs = companyId
              ? [companyId, dateStr, dateStr]
              : [dateStr, dateStr];

            const txMatches = await db.execute({ sql: matchQuery, args: matchArgs });
            console.log(`[SCAN] ${file.name} → ${txMatches.rows.length} candidates in date range`);

            for (const tx of txMatches.rows as any[]) {
              let score = 0;
              const label = (tx.label as string) || '';

              // Amount scoring — check EUR amount and USD amount from label
              if (invAmt) {
                const eurDiff = Math.abs(Math.abs(tx.amount as number) - invAmt);
                const usdInLabel = extractUsdFromLabel(label);
                const usdDiff = usdInLabel ? Math.abs(usdInLabel - invAmt) : null;

                // Best of EUR or USD match
                const bestDiff = usdDiff !== null ? Math.min(eurDiff, usdDiff) : eurDiff;
                if (bestDiff < 0.02) score += 50;
                else if (bestDiff < 0.5) score += 40;
                else if (bestDiff < 2) score += 25;
                else if (bestDiff / invAmt < 0.05) score += 20;
              }

              // Date scoring
              if (dateStr && tx.date) {
                const daysDiff = Math.abs((new Date(tx.date as string).getTime() - new Date(dateStr).getTime()) / 86400000);
                if (daysDiff <= 1) score += 35;
                else if (daysDiff <= 3) score += 25;
                else if (daysDiff <= 7) score += 15;
                else if (daysDiff <= 14) score += 8;
                else score += 3;
              }

              // Vendor/label scoring
              if (extracted.vendor) {
                const v = extracted.vendor.toLowerCase();
                const l = label.toLowerCase();
                if (l.includes(v) || v.includes(l)) score += 30;
                else {
                  const vWords = v.split(/[\s.,·\-]+/).filter((w: string) => w.length > 3);
                  const matched = vWords.filter((w: string) => l.includes(w));
                  if (matched.length > 0) score += 20;
                }
              }

              if (score > bestScore) {
                bestScore = score;
                matchedTxId = tx.id as number;
              }
            }
            // Need score > 60 — requires at least 2 strong signals (e.g. date+label, date+amount, amount+label)
            console.log(`[SCAN] ${file.name} → best score=${bestScore}, matchedTxId=${matchedTxId}`);
            if (bestScore <= 60) { matchedTxId = null; bestScore = 0; }
            if (matchedTxId) job.matched++;
          } else {
            console.log(`[SCAN] ${file.name} → NO AMOUNT or VENDOR+DATE, skipping matching`);
          }

          // Truncate raw_text for storage (keep first 2000 chars)
          const storedText = extracted.raw_text ? extracted.raw_text.slice(0, 2000) : null;

          await db.execute({
            sql: `INSERT INTO invoice_cache (user_id, company_id, transaction_id, drive_file_id, filename, vendor, amount_ht, tva_amount, tva_rate, date, invoice_number, match_confidence, raw_text, extraction_method)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [userId, companyId, matchedTxId, file.id, file.name,
                   extracted.vendor || null, extracted.amount || null,
                   extracted.tva_amount || null, extracted.tva_rate || null,
                   extracted.date || null, extracted.invoice_number || null,
                   matchedTxId ? bestScore / 100 : null,
                   storedText, extracted.extraction_method]
          });
          job.scanned++;
        } catch (e: any) {
          job.errors.push(`${file.name}: ${e.message}`);
        }
        job.processed++;
      }

      job.status = 'done';
      job.finished_at = Date.now();
    } catch (e: any) {
      job.status = 'error';
      job.errors.push(e.message);
      job.finished_at = Date.now();
    }
  })();

  return c.json({ scan_id: scanId, total: 0, status: 'running' });
});

// Debug: show cached invoices extraction results and why they didn't match
app.get('/api/invoices/debug', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');
  if (!companyId) return c.json({ error: 'company_id required' });
  const cid = Number(companyId);
  const invoices = await db.execute({
    sql: `SELECT id, filename, vendor, amount_ht, date, extraction_method, transaction_id, match_confidence
          FROM invoice_cache WHERE user_id = ? AND company_id = ? ORDER BY date DESC`,
    args: [userId, cid]
  });
  // For unmatched invoices with an amount, show nearest transactions
  const results = [];
  for (const inv of invoices.rows as any[]) {
    const entry: any = { ...inv };
    if (!inv.transaction_id && inv.amount_ht) {
      const dateStr = inv.date || '2025-01-01';
      const amt = Math.abs(inv.amount_ht);
      const candidates = await db.execute({
        sql: `SELECT t.id, t.label, t.amount, t.date, ABS(ABS(t.amount) - ?) as amt_diff
              FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
              WHERE ba.company_id = ? AND ba.type = 'checking'
              AND t.date BETWEEN date(?, '-60 days') AND date(?, '+60 days')
              ORDER BY ABS(ABS(t.amount) - ?) LIMIT 5`,
        args: [amt, cid, dateStr, dateStr, amt]
      });
      entry.nearest_transactions = candidates.rows;
    }
    results.push(entry);
  }
  return c.json(results);
});

// Poll scan progress
app.get('/api/invoices/scan/:scanId', async (c) => {
  const scanId = c.req.param('scanId');
  const job = scanJobs.get(scanId);
  if (!job) return c.json({ status: 'not_found' }, 404);
  return c.json(job);
});

// --- Tesseract OCR: PDF → images → text (local, fast, no network) ---
async function tesseractOcrExtractText(buffer: Buffer): Promise<string | null> {
  try {
    // Check tesseract is available
    execSync('which tesseract', { stdio: 'ignore' });
  } catch {
    console.log('[SCAN] Tesseract not installed, skipping');
    return null;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  try {
    const pdfPath = path.join(tmpDir, 'input.pdf');
    fs.writeFileSync(pdfPath, buffer);
    // Convert PDF to PNG images (one per page)
    execSync(`pdftoppm -png -r 300 "${pdfPath}" "${path.join(tmpDir, 'page')}"`, { timeout: 15000 });
    // OCR each page
    const pages = fs.readdirSync(tmpDir).filter(f => f.startsWith('page') && f.endsWith('.png')).sort();
    let fullText = '';
    for (const page of pages) {
      const imgPath = path.join(tmpDir, page);
      const text = execSync(`tesseract "${imgPath}" - -l eng+fra 2>/dev/null`, { timeout: 15000 }).toString();
      fullText += text + '\n';
    }
    return fullText.trim() || null;
  } catch (e: any) {
    console.log(`[SCAN] Tesseract error: ${e.message}`);
    return null;
  } finally {
    // Cleanup temp files
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
}

// --- Drive OCR: copy PDF as Google Doc → export text → delete temp doc ---
async function driveOcrExtractText(driveFileId: string, accessToken: string): Promise<string | null> {
  try {
    // 1. Copy the file as a Google Doc (triggers OCR)
    const copyRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}/copy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mimeType: 'application/vnd.google-apps.document', name: '_ocr_temp' }),
    });
    if (!copyRes.ok) {
      console.error('Drive OCR copy failed:', await copyRes.text());
      return null;
    }
    const copyData: any = await copyRes.json();
    const tempDocId = copyData.id;

    // 2. Export as plain text
    const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${tempDocId}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = exportRes.ok ? await exportRes.text() : null;

    // 3. Delete temp doc (fire-and-forget)
    fetch(`https://www.googleapis.com/drive/v3/files/${tempDocId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});

    return text && text.trim().length > 5 ? text : null;
  } catch (e: any) {
    console.error('Drive OCR error:', e.message);
    return null;
  }
}

// Parse structured fields from raw text (used for both pdf-parse and Drive OCR output)
function parseInvoiceText(text: string): { vendor?: string; amount?: number; date?: string; invoice_number?: string; tva_amount?: number; tva_rate?: number } {
  const result: { vendor?: string; amount?: number; date?: string; invoice_number?: string; tva_amount?: number; tva_rate?: number } = {};

  // Date: DD/MM/YYYY or DD.MM.YYYY
  const pdfDate = text.match(/(\d{2})[/.](\d{2})[/.](\d{4})/);
  if (pdfDate) result.date = `${pdfDate[3]}-${pdfDate[2]}-${pdfDate[1]}`;

  // Date: English format "Month DD, YYYY" or "due Month DD, YYYY"
  const monthMapEn: Record<string, string> = { january:'01', february:'02', march:'03', april:'04', may:'05', june:'06', july:'07', august:'08', september:'09', october:'10', november:'11', december:'12' };
  if (!result.date) {
    const engDate = text.match(/(?:due\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i);
    if (engDate) result.date = `${engDate[3]}-${monthMapEn[engDate[1].toLowerCase()]}-${String(engDate[2]).padStart(2, '0')}`;
  }

  // Date: French format "21 novembre 2025"
  const monthMapFr: Record<string, string> = { janvier:'01', 'février':'02', fevrier:'02', mars:'03', avril:'04', mai:'05', juin:'06', juillet:'07', 'août':'08', aout:'08', septembre:'09', octobre:'10', novembre:'11', 'décembre':'12', decembre:'12' };
  if (!result.date) {
    const frDate = text.match(/(\d{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+(\d{4})/i);
    if (frDate) result.date = `${frDate[3]}-${monthMapFr[frDate[2].toLowerCase()]}-${String(frDate[1]).padStart(2, '0')}`;
  }

  // Date: YYYY-MM-DD (ISO)
  if (!result.date) {
    const isoDate = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoDate) result.date = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  }

  // Invoice number
  const pdfInv = text.match(/(?:facture|invoice|n°|nummer|rechnung)\s*:?\s*([A-Z]*-?\d{4,}[-/]?\d*)/i);
  if (pdfInv) result.invoice_number = pdfInv[1];

  // Total TTC — most reliable amount for matching (ordered by specificity)
  const ttcPatterns = [
    // "Amount due" / "Montant dû" — the most reliable final amount
    /montant\s+d[ûu]\s*:?\s*(?:[$€])?\s*([\d\s,.]+\d{2})/i,
    /amount\s+due\s*:?\s*(?:[$€])?\s*([\d\s,.]+\d{2})/i,
    // Standard French/German patterns
    /total\s+t\.?t\.?c\.?\s*:?\s*([\d\s]+[.,]\d{2})/i,
    /montant\s+t\.?t\.?c\.?\s*:?\s*([\d\s]+[.,]\d{2})/i,
    /net\s+[àa]\s+payer\s*:?\s*([\d\s]+[.,]\d{2})/i,
    /gesamtbetrag\s*:?\s*([\d\s]+[.,]\d{2})/i,
    /total\s*:?\s*([\d\s]+[.,]\d{2})\s*€?$/im,
  ];
  for (const pat of ttcPatterns) {
    const m = text.match(pat);
    if (m) {
      const val = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
      if (val > 0 && val < 1_000_000) { result.amount = val; break; }
    }
  }

  // Total HT
  if (!result.amount) {
    const htMatch = text.match(/total\s+h\.?t\.?\s*:?\s*([\d\s]+[.,]\d{2})/i)
      || text.match(/montant\s+h\.?t\.?\s*:?\s*([\d\s]+[.,]\d{2})/i);
    if (htMatch) {
      const ht = parseFloat(htMatch[1].replace(/\s/g, '').replace(',', '.'));
      if (ht > 0) result.amount = ht;
    }
  }

  // Currency-prefixed amounts: $30.00, €21.60, USD 30.00, EUR 21.60
  if (!result.amount) {
    const currMatch = text.match(/[$€]\s*([\d,]+\.\d{2})/);
    if (currMatch) {
      const val = parseFloat(currMatch[1].replace(',', ''));
      if (val > 0 && val < 1_000_000) result.amount = val;
    }
  }
  if (!result.amount) {
    const currMatch2 = text.match(/([\d\s]+[.,]\d{2})\s*(?:USD|EUR|€|\$)/);
    if (currMatch2) {
      const val = parseFloat(currMatch2[1].replace(/\s/g, '').replace(',', '.'));
      if (val > 0 && val < 1_000_000) result.amount = val;
    }
  }

  // TVA
  const tvaMatch = text.match(/t\.?v\.?a\.?\s*(?:\(?\s*(\d+(?:[.,]\d+)?)\s*%?\)?)?\s*:?\s*([\d\s]+[.,]\d{2})/i);
  if (tvaMatch) {
    if (tvaMatch[1]) result.tva_rate = parseFloat(tvaMatch[1].replace(',', '.'));
    result.tva_amount = parseFloat(tvaMatch[2].replace(/\s/g, '').replace(',', '.'));
  }

  // Vendor: first substantial line that isn't a header/date/number
  const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 3 && !/^\d+$/.test(l));
  const vendorLine = lines.find((l: string) => !/^\d/.test(l) && !/facture|invoice|date|siret|siren|tva|iban|total|montant/i.test(l) && l.length < 60);
  if (vendorLine) result.vendor = vendorLine;

  return result;
}

interface ExtractionResult {
  vendor?: string;
  amount?: number;
  date?: string;
  invoice_number?: string;
  tva_amount?: number;
  tva_rate?: number;
  raw_text?: string;
  extraction_method: string; // 'filename' | 'pdf-parse' | 'drive-ocr'
}

// Extract invoice metadata: filename → pdf-parse → Drive OCR fallback
async function extractInvoiceMetadata(filename: string, buffer: Buffer, driveFileId: string, accessToken: string): Promise<ExtractionResult> {
  const result: ExtractionResult = { extraction_method: 'filename' };

  // --- 1. Parse from filename (always) ---
  const dateMatch = filename.match(/(\d{4})-(\d{2})-(\d{2})/) || filename.match(/(\d{2})-(\d{2})-(\d{4})/);
  if (dateMatch) {
    result.date = dateMatch[1].length === 4
      ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
      : `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  }
  const amountMatch = filename.match(/(\d+[.,]\d{2})/);
  if (amountMatch) result.amount = parseFloat(amountMatch[1].replace(',', '.'));

  const cleaned = filename.replace(/\.pdf$/i, '').replace(/[\d_-]+/g, ' ').trim();
  const words = cleaned.split(/\s+/).filter(w => w.length > 2);
  if (words.length > 0) result.vendor = words.join(' ');

  const invMatch = filename.match(/(F|FA|INV|FACT)[- ]?\d+[- ]?\d*/i);
  if (invMatch) result.invoice_number = invMatch[0];

  // --- 2. Try pdf-parse (fast, for text-based PDFs) ---
  let rawText = '';
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse(new Uint8Array(buffer));
    const pdfResult = await parser.getText();
    rawText = pdfResult.text || '';
  } catch {}

  if (rawText.trim().length > 200) {
    // Substantial text from pdf-parse — trust it
    result.extraction_method = 'pdf-parse';
    result.raw_text = rawText;
    const parsed = parseInvoiceText(rawText);
    if (parsed.date) result.date = parsed.date;
    if (parsed.amount) result.amount = parsed.amount;
    if (parsed.vendor) result.vendor = parsed.vendor;
    if (parsed.invoice_number) result.invoice_number = parsed.invoice_number;
    if (parsed.tva_amount) result.tva_amount = parsed.tva_amount;
    if (parsed.tva_rate) result.tva_rate = parsed.tva_rate;
    if (result.amount && result.date) return result;
    console.log(`[SCAN] pdf-parse text >200 chars but missing amount or date, trying Tesseract`);
  } else if (rawText.trim().length > 0) {
    console.log(`[SCAN] pdf-parse got only ${rawText.trim().length} chars, falling through to Tesseract`);
  }

  // --- 3. Tesseract OCR (local, fast, no network) ---
  const tesseractText = await tesseractOcrExtractText(buffer);
  if (tesseractText && tesseractText.trim().length > 20) {
    result.extraction_method = 'tesseract';
    result.raw_text = tesseractText;
    const parsed = parseInvoiceText(tesseractText);
    if (parsed.date) result.date = parsed.date;
    if (parsed.amount) result.amount = parsed.amount;
    if (parsed.vendor) result.vendor = parsed.vendor;
    if (parsed.invoice_number) result.invoice_number = parsed.invoice_number;
    if (parsed.tva_amount) result.tva_amount = parsed.tva_amount;
    if (parsed.tva_rate) result.tva_rate = parsed.tva_rate;
    if (result.amount || result.date) return result;
    console.log(`[SCAN] Tesseract got text but no useful fields, falling through to Drive OCR`);
  }

  // --- 4. Last resort: Drive OCR (network-dependent) ---
  const ocrText = await driveOcrExtractText(driveFileId, accessToken);
  if (ocrText && ocrText.trim().length > 20) {
    result.extraction_method = 'drive-ocr';
    result.raw_text = ocrText;
    const parsed = parseInvoiceText(ocrText);
    if (parsed.date) result.date = parsed.date;
    if (parsed.amount) result.amount = parsed.amount;
    if (parsed.vendor) result.vendor = parsed.vendor;
    if (parsed.invoice_number) result.invoice_number = parsed.invoice_number;
    if (parsed.tva_amount) result.tva_amount = parsed.tva_amount;
    if (parsed.tva_rate) result.tva_rate = parsed.tva_rate;
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

// Transactions starting with these prefixes are excluded from rapprochement
// (justified by annual bank statements / IFU — no individual justificatif needed)
const RAPPROCHEMENT_LABEL_BLOCKLIST = [
  'COUPONS',
];
const blocklist_sql = RAPPROCHEMENT_LABEL_BLOCKLIST.map(p => `t.label NOT LIKE '${p}%'`).join(' AND ');

// Invoice stats — transaction-centric for companies, file-centric for personal
app.get('/api/invoices/stats', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');
  const year = parseInt(c.req.query('year') || String(new Date().getFullYear() - 1));

  if (companyId) {
    const start = `${year}-01-01`, end = `${year + 1}-01-01`;
    const cid = Number(companyId);
    const totalRes = await db.execute({
      sql: `SELECT COUNT(*) as c FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.company_id = ? AND ba.type = 'checking' AND t.date >= ? AND t.date < ? AND ${blocklist_sql}`,
      args: [cid, start, end]
    });
    const matchedRes = await db.execute({
      sql: `SELECT COUNT(*) as c FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.company_id = ? AND ba.type = 'checking' AND t.date >= ? AND t.date < ? AND ${blocklist_sql} AND EXISTS (SELECT 1 FROM invoice_cache ic WHERE ic.transaction_id = t.id)`,
      args: [cid, start, end]
    });
    const total = Number(totalRes.rows[0]?.c || 0);
    const matched = Number(matchedRes.rows[0]?.c || 0);
    return c.json({ total, matched, unmatched: total - matched, match_rate: total > 0 ? Math.round((matched / total) * 100) : 0, year });
  }

  const args: any[] = [userId];
  const total = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache WHERE user_id = ?`, args });
  const matchedCount = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache WHERE user_id = ? AND transaction_id IS NOT NULL`, args });
  const unmatchedCount = await db.execute({ sql: `SELECT COUNT(*) as c FROM invoice_cache WHERE user_id = ? AND transaction_id IS NULL`, args });
  const totalVal = Number(total.rows[0]?.c || 0);
  const matchedVal = Number(matchedCount.rows[0]?.c || 0);
  return c.json({ total: totalVal, matched: matchedVal, unmatched: Number(unmatchedCount.rows[0]?.c || 0), match_rate: totalVal > 0 ? Math.round((matchedVal / totalVal) * 100) : 0 });
});

// Transactions with invoice status (for company rapprochement view)
app.get('/api/invoices/transactions', async (c) => {
  const companyId = c.req.query('company_id');
  const year = parseInt(c.req.query('year') || String(new Date().getFullYear() - 1));
  const matched = c.req.query('matched');
  if (!companyId) return c.json([]);
  const start = `${year}-01-01`, end = `${year + 1}-01-01`;
  let sql = `SELECT t.id, t.label, t.amount, t.date, t.category,
    ic.id as invoice_id, ic.filename, ic.drive_file_id, ic.vendor, ic.amount_ht, ic.date as invoice_date
    FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
    LEFT JOIN invoice_cache ic ON ic.transaction_id = t.id
    WHERE ba.company_id = ? AND ba.type = 'checking' AND t.date >= ? AND t.date < ? AND ${blocklist_sql}`;
  const args: any[] = [Number(companyId), start, end];
  if (matched === 'true') sql += ' AND ic.id IS NOT NULL';
  else if (matched === 'false') sql += ' AND ic.id IS NULL';
  sql += ' ORDER BY t.date DESC';
  const result = await db.execute({ sql, args });
  return c.json(result.rows);
});

// List all Drive files for a company (for manual linking)
app.get('/api/invoices/files', async (c) => {
  const userId = await getUserId(c);
  const companyId = c.req.query('company_id');
  if (!companyId) return c.json([]);
  const result = await db.execute({
    sql: `SELECT ic.id, ic.filename, ic.drive_file_id, ic.date, ic.vendor, ic.amount_ht, ic.transaction_id
          FROM invoice_cache ic WHERE ic.user_id = ? AND ic.company_id = ?
          ORDER BY ic.transaction_id IS NOT NULL, ic.scanned_at DESC`,
    args: [userId, Number(companyId)]
  });
  return c.json(result.rows);
});

// Manually link an existing Drive file (invoice_cache) to a transaction
app.post('/api/invoices/link', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const { invoice_id, transaction_id } = body;
  if (!invoice_id || !transaction_id) return c.json({ error: 'Missing fields' }, 400);
  // Verify ownership
  const check = await db.execute({ sql: 'SELECT id FROM invoice_cache WHERE id = ? AND user_id = ?', args: [invoice_id, userId] });
  if (check.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  // Unlink any existing invoice for this transaction first
  await db.execute({ sql: 'UPDATE invoice_cache SET transaction_id = NULL WHERE transaction_id = ? AND user_id = ?', args: [transaction_id, userId] });
  // Link
  await db.execute({ sql: 'UPDATE invoice_cache SET transaction_id = ?, match_confidence = 1.0 WHERE id = ? AND user_id = ?', args: [transaction_id, invoice_id, userId] });
  return c.json({ ok: true });
});

// Upload invoice file to Drive and link to transaction
app.post('/api/invoices/upload', async (c) => {
  const userId = await getUserId(c);
  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const transactionId = Number(formData.get('transaction_id'));
  const companyId = formData.get('company_id') ? Number(formData.get('company_id')) : null;
  if (!file || !transactionId) return c.json({ error: 'Missing file or transaction_id' }, 400);

  const connSql = companyId
    ? 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id = ? AND status = ? LIMIT 1'
    : 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1';
  const connArgs = companyId ? [userId, companyId, 'active'] : [userId, 'active'];
  const conn = await db.execute({ sql: connSql, args: connArgs });
  if (conn.rows.length === 0) return c.json({ error: 'No Drive connection' }, 400);

  const driveConn: any = conn.rows[0];
  const accessToken = await getDriveAccessToken(driveConn);
  const folderId = driveConn.folder_id;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const metadata = JSON.stringify({ name: file.name, ...(folderId ? { parents: [folderId] } : {}) });
  const boundary = 'konto_upload_boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type || 'application/pdf'}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`)
  ]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary="${boundary}"` },
    body
  });
  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return c.json({ error: 'Drive upload failed', details: err }, 502);
  }
  const uploaded: any = await uploadRes.json();

  // Remove any existing invoice link for this transaction then insert new one
  await db.execute({ sql: 'DELETE FROM invoice_cache WHERE transaction_id = ? AND user_id = ?', args: [transactionId, userId] });
  await db.execute({
    sql: `INSERT INTO invoice_cache (user_id, company_id, transaction_id, drive_file_id, filename, match_confidence) VALUES (?, ?, ?, ?, ?, 1.0)`,
    args: [userId, companyId, transactionId, uploaded.id, file.name]
  });
  return c.json({ ok: true, drive_file_id: uploaded.id, filename: file.name });
});

// ========== BILAN ANNUEL ==========

app.get('/api/bilan/:year', async (c) => {
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

app.get('/api/bilan-pro/:year', async (c) => {
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
  const companyId = c.req.query('company_id') ? parseInt(c.req.query('company_id')!) : null;
  const userId = await getUserId(c);

  // Get date range
  const now = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const fromStr = fromDate.toISOString().split('T')[0];

  const companyFilter = companyId ? ' AND ba.company_id = ?' : '';
  const args: (string | number)[] = [fromStr, scope, userId];
  if (companyId) args.push(companyId);

  const result = await db.execute({
    sql: `SELECT t.date, t.amount, t.label, ba.usage
          FROM transactions t
          LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE t.date >= ? AND ba.usage = ? AND t.amount < 0 AND ba.user_id = ?${companyFilter}
          ORDER BY t.date`,
    args
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

// ========== PAYSLIPS (Global Drive + Monthly Payslips) ==========

// --- Drive folder mappings (per purpose) ---

app.get('/api/drive/folder-mapping', async (c) => {
  const userId = await getUserId(c);
  const purpose = c.req.query('purpose');
  if (!purpose) return c.json({ error: 'purpose required' }, 400);

  const result = await db.execute({
    sql: 'SELECT * FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?',
    args: [userId, purpose]
  });
  if (result.rows.length === 0) return c.json({ mapping: null });
  return c.json({ mapping: result.rows[0] });
});

app.put('/api/drive/folder-mapping', async (c) => {
  const userId = await getUserId(c);
  const { purpose, folder_id, folder_path } = await c.req.json();
  if (!purpose || !folder_id) return c.json({ error: 'purpose and folder_id required' }, 400);

  await db.execute({
    sql: `INSERT INTO drive_folder_mappings (user_id, purpose, folder_id, folder_path)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, purpose) DO UPDATE SET folder_id = excluded.folder_id, folder_path = excluded.folder_path`,
    args: [userId, purpose, folder_id, folder_path || null]
  });
  return c.json({ ok: true });
});

app.delete('/api/drive/folder-mapping', async (c) => {
  const userId = await getUserId(c);
  const purpose = c.req.query('purpose');
  if (!purpose) return c.json({ error: 'purpose required' }, 400);
  await db.execute({ sql: 'DELETE FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?', args: [userId, purpose] });
  return c.json({ ok: true });
});

// --- Payslips CRUD ---

app.get('/api/payslips', async (c) => {
  const userId = await getUserId(c);
  const year = parseInt(c.req.query('year') || String(new Date().getFullYear()));

  const result = await db.execute({
    sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? ORDER BY month',
    args: [userId, year]
  });
  return c.json({ payslips: result.rows });
});

app.patch('/api/payslips/:id', async (c) => {
  const userId = await getUserId(c);
  const id = parseInt(c.req.param('id'));
  const body = await c.req.json();

  const fields: string[] = [];
  const args: any[] = [];

  for (const key of ['gross', 'net', 'employer', 'status', 'drive_file_id', 'filename']) {
    if (body[key] !== undefined) {
      fields.push(`${key} = ?`);
      args.push(body[key]);
    }
  }

  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400);
  args.push(id, userId);

  await db.execute({
    sql: `UPDATE payslips SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
    args
  });
  return c.json({ ok: true });
});

app.delete('/api/payslips/:id', async (c) => {
  const userId = await getUserId(c);
  const id = parseInt(c.req.param('id'));
  await db.execute({ sql: 'DELETE FROM payslips WHERE id = ? AND user_id = ?', args: [id, userId] });
  return c.json({ ok: true });
});

// --- Payslip link (link existing Drive file to a month) ---

app.post('/api/payslips/link', async (c) => {
  const userId = await getUserId(c);
  const { year, month, drive_file_id, filename } = await c.req.json();
  if (!year || !month || !drive_file_id) return c.json({ error: 'year, month, drive_file_id required' }, 400);

  await db.execute({
    sql: `INSERT INTO payslips (user_id, year, month, drive_file_id, filename, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
          ON CONFLICT(user_id, year, month) DO UPDATE SET drive_file_id = excluded.drive_file_id, filename = excluded.filename, status = 'pending'`,
    args: [userId, year, month, drive_file_id, filename || null]
  });

  // Try to extract from this PDF
  const conn = await db.execute({
    sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
    args: [userId, 'active']
  });
  if (conn.rows.length > 0) {
    const driveConn: any = conn.rows[0];
    try {
      const driveToken = await getDriveAccessToken(driveConn);
      const extracted = await extractPayslipFromDrive(drive_file_id, driveToken);
      if (extracted.gross || extracted.net) {
        await db.execute({
          sql: `UPDATE payslips SET gross = ?, net = ?, employer = ?, status = 'extracted' WHERE user_id = ? AND year = ? AND month = ?`,
          args: [extracted.gross || null, extracted.net || null, extracted.employer || null, userId, year, month]
        });
      }
    } catch (e: any) {
      console.error('Payslip extraction error:', e.message);
    }
  }

  const result = await db.execute({
    sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? AND month = ?',
    args: [userId, year, month]
  });
  return c.json({ payslip: result.rows[0] || null });
});

// --- Payslip upload (upload local file to Drive folder + link) ---

app.post('/api/payslips/upload', async (c) => {
  const userId = await getUserId(c);

  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  const year = parseInt(formData.get('year') as string);
  const month = parseInt(formData.get('month') as string);

  if (!file || !year || !month) return c.json({ error: 'file, year, month required' }, 400);

  // Get global drive connection
  const conn = await db.execute({
    sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
    args: [userId, 'active']
  });
  if (conn.rows.length === 0) return c.json({ error: 'No Drive connection' }, 400);
  const driveConn: any = conn.rows[0];
  const uploadToken = await getDriveAccessToken(driveConn);

  // Get payslips folder mapping
  const mapping = await db.execute({
    sql: 'SELECT * FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?',
    args: [userId, 'payslips']
  });
  if (mapping.rows.length === 0) return c.json({ error: 'No payslips folder configured' }, 400);
  const folderId = (mapping.rows[0] as any).folder_id;

  try {
    // Upload to Google Drive
    const fileBuffer = await file.arrayBuffer();
    const metadata = {
      name: file.name,
      parents: [folderId],
    };

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const body = new Uint8Array(await new Blob([
      delimiter,
      'Content-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadata),
      delimiter,
      `Content-Type: ${file.type || 'application/pdf'}\r\n\r\n`,
      new Uint8Array(fileBuffer),
      closeDelimiter,
    ]).arrayBuffer());

    const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${uploadToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return c.json({ error: 'Upload failed', details: err }, 502);
    }

    const uploaded: any = await uploadRes.json();

    // Link the uploaded file to the payslip
    await db.execute({
      sql: `INSERT INTO payslips (user_id, year, month, drive_file_id, filename, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
            ON CONFLICT(user_id, year, month) DO UPDATE SET drive_file_id = excluded.drive_file_id, filename = excluded.filename, status = 'pending'`,
      args: [userId, year, month, uploaded.id, uploaded.name]
    });

    // Try extraction
    try {
      const extracted = await extractPayslipFromDrive(uploaded.id, uploadToken);
      if (extracted.gross || extracted.net) {
        await db.execute({
          sql: `UPDATE payslips SET gross = ?, net = ?, employer = ?, status = 'extracted' WHERE user_id = ? AND year = ? AND month = ?`,
          args: [extracted.gross || null, extracted.net || null, extracted.employer || null, userId, year, month]
        });
      }
    } catch {}

    const result = await db.execute({
      sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? AND month = ?',
      args: [userId, year, month]
    });
    return c.json({ payslip: result.rows[0] || null });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// --- Scan payslips from Drive folder ---

app.post('/api/payslips/scan', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const year = parseInt(body.year || String(new Date().getFullYear()));

  // Get global drive connection
  const conn = await db.execute({
    sql: 'SELECT * FROM drive_connections WHERE user_id = ? AND company_id IS NULL AND status = ? LIMIT 1',
    args: [userId, 'active']
  });
  if (conn.rows.length === 0) return c.json({ error: 'No Drive connection' }, 400);
  const driveConn: any = conn.rows[0];
  const scanToken = await getDriveAccessToken(driveConn);

  // Get payslips folder mapping
  const mapping = await db.execute({
    sql: 'SELECT * FROM drive_folder_mappings WHERE user_id = ? AND purpose = ?',
    args: [userId, 'payslips']
  });
  if (mapping.rows.length === 0) return c.json({ error: 'No payslips folder configured' }, 400);
  const folderId = (mapping.rows[0] as any).folder_id;

  try {
    // List all PDFs in the payslips folder (and subfolders)
    const allFolderIds = await collectDriveFolderIds(folderId, scanToken);
    const parentClause = allFolderIds.map(id => `'${id}' in parents`).join(' or ');
    const query = `mimeType='application/pdf' and trashed=false and (${parentClause})`;

    const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=200`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${scanToken}` }
    });

    if (!listRes.ok) {
      const err = await listRes.text();
      return c.json({ error: 'Drive API error', details: err }, 502);
    }

    const listData: any = await listRes.json();
    const files = listData.files || [];

    const MONTH_NAMES_FR: Record<string, number> = {
      janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
      juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
    };

    const results: { month: number; file_id: string; filename: string }[] = [];

    for (const file of files) {
      const name = (file.name || '').toLowerCase();

      // Try to match file to a month of the given year
      let matchedMonth: number | null = null;

      // Pattern 1: YYYY-MM in filename (e.g., "fiche-paie-2026-01.pdf")
      const ymMatch = name.match(new RegExp(`${year}[\\-_\\s]?(0[1-9]|1[0-2])`));
      if (ymMatch) matchedMonth = parseInt(ymMatch[1]);

      // Pattern 2: MM-YYYY (e.g., "01-2026.pdf")
      if (!matchedMonth) {
        const myMatch = name.match(new RegExp(`(0[1-9]|1[0-2])[\\-_\\s]?${year}`));
        if (myMatch) matchedMonth = parseInt(myMatch[1]);
      }

      // Pattern 3: French month name + year (e.g., "janvier-2026.pdf")
      if (!matchedMonth) {
        for (const [mName, mNum] of Object.entries(MONTH_NAMES_FR)) {
          if (name.includes(mName) && name.includes(String(year))) {
            matchedMonth = mNum;
            break;
          }
        }
      }

      // Pattern 4: file created/modified in the target year — use month from that date
      if (!matchedMonth && file.createdTime) {
        const created = new Date(file.createdTime);
        if (created.getFullYear() === year) {
          matchedMonth = created.getMonth() + 1;
        }
      }

      if (matchedMonth && matchedMonth >= 1 && matchedMonth <= 12) {
        // Check if we already have a better match for this month
        const existing = results.find(r => r.month === matchedMonth);
        if (!existing) {
          results.push({ month: matchedMonth, file_id: file.id, filename: file.name });
        }
      }
    }

    // For each matched file, create/update payslip entry and try extraction
    let scanned = 0;
    let extracted = 0;

    for (const match of results) {
      // Upsert payslip entry
      await db.execute({
        sql: `INSERT INTO payslips (user_id, year, month, drive_file_id, filename, status)
              VALUES (?, ?, ?, ?, ?, 'pending')
              ON CONFLICT(user_id, year, month) DO UPDATE SET
                drive_file_id = CASE WHEN payslips.status = 'confirmed' THEN payslips.drive_file_id ELSE excluded.drive_file_id END,
                filename = CASE WHEN payslips.status = 'confirmed' THEN payslips.filename ELSE excluded.filename END`,
        args: [userId, year, match.month, match.file_id, match.filename]
      });
      scanned++;

      // Try PDF extraction (skip if already confirmed)
      const existing = await db.execute({
        sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? AND month = ?',
        args: [userId, year, match.month]
      });
      const payslip: any = existing.rows[0];
      if (payslip && payslip.status !== 'confirmed') {
        try {
          const data = await extractPayslipFromDrive(match.file_id, scanToken);
          if (data.gross || data.net) {
            await db.execute({
              sql: `UPDATE payslips SET gross = ?, net = ?, employer = ?, status = 'extracted' WHERE user_id = ? AND year = ? AND month = ?`,
              args: [data.gross || null, data.net || null, data.employer || null, userId, year, match.month]
            });
            extracted++;
          }
        } catch (e: any) {
          console.error(`Extraction failed for ${match.filename}:`, e.message);
        }
      }
    }

    // Return updated payslips
    const payslipsResult = await db.execute({
      sql: 'SELECT * FROM payslips WHERE user_id = ? AND year = ? ORDER BY month',
      args: [userId, year]
    });

    return c.json({
      ok: true,
      total_files: files.length,
      matched: results.length,
      scanned,
      extracted,
      payslips: payslipsResult.rows,
    });
  } catch (e: any) {
    return c.json({ error: 'Scan failed', details: e.message }, 500);
  }
});

// --- PDF extraction helper for payslips ---

async function extractPayslipFromDrive(fileId: string, accessToken: string): Promise<{ gross: number | null; net: number | null; employer: string | null }> {
  const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!dlRes.ok) throw new Error('Failed to download file');

  const buffer = Buffer.from(await dlRes.arrayBuffer());

  let text = '';
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse(new Uint8Array(buffer));
    const result = await parser.getText();
    text = result.text || '';
  } catch (e: any) {
    console.error('pdf-parse error:', e.message);
    return { gross: null, net: null, employer: null };
  }

  let gross: number | null = null;
  let net: number | null = null;
  let employer: string | null = null;

  // French payslip patterns
  // "Salaire brut" or "SALAIRE BRUT" followed by an amount
  const grossMatch = text.match(/salaire\s+brut[^\d]*?([\d\s]+[.,]\d{2})/i);
  if (grossMatch) {
    gross = parseFloat(grossMatch[1].replace(/\s/g, '').replace(',', '.'));
  }

  // "Net à payer" or "NET A PAYER" or "Net à payer avant impôt"
  const netMatch = text.match(/net\s+[àa]\s+payer(?:\s+avant\s+imp[ôo]t)?[^\d]*?([\d\s]+[.,]\d{2})/i);
  if (netMatch) {
    net = parseFloat(netMatch[1].replace(/\s/g, '').replace(',', '.'));
  }

  // If net not found, try "Net imposable"
  if (!net) {
    const netImpMatch = text.match(/net\s+imposable[^\d]*?([\d\s]+[.,]\d{2})/i);
    if (netImpMatch) {
      net = parseFloat(netImpMatch[1].replace(/\s/g, '').replace(',', '.'));
    }
  }

  // Employer: often in the first few lines of the PDF
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  if (lines.length > 0) {
    // First non-numeric substantial line is often the employer
    for (const line of lines.slice(0, 10)) {
      if (line.length > 3 && !/^\d+$/.test(line) && !/bulletin/i.test(line) && !/fiche de paie/i.test(line)) {
        employer = line.substring(0, 80);
        break;
      }
    }
  }

  return { gross, net, employer };
}

// ========== CSV IMPORT ==========

app.post('/api/import/csv', async (c) => {
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
app.delete('/api/import/csv/:batchId', async (c) => {
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
app.get('/api/import/csv/batches/:accountId', async (c) => {
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

// ========== START SERVER ==========

export { app };

// Background sync: refresh all accounts using active tokens + check SCA state
async function backgroundSyncAll() {
  try {
    const usersRes = await db.execute({ sql: 'SELECT DISTINCT user_id FROM bank_connections WHERE status = ?', args: ['active'] });
    for (const row of usersRes.rows as any[]) {
      const userId = row.user_id;
      const connsRes = await db.execute({ sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ?', args: [userId, 'active'] });
      for (const conn of connsRes.rows as any[]) {
        try {
          const token = conn.powens_token;
          const accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, { headers: { 'Authorization': `Bearer ${token}` } });
          if (!accountsRes.ok) continue;
          const accountsData = await accountsRes.json() as any;

          // Check connection SCA state
          let isSCA = false;
          if (conn.powens_connection_id) {
            try {
              const stateRes = await fetch(`${POWENS_API}/users/me/connections/${conn.powens_connection_id}`, {
                headers: { 'Authorization': `Bearer ${token}` },
              });
              if (stateRes.ok) {
                const state = await stateRes.json() as any;
                isSCA = state.state === 'SCARequired' || state.error === 'SCARequired';
              }
            } catch {}
          }

          for (const powensAcc of (accountsData.accounts || [])) {
            const accRes = await db.execute({
              sql: 'SELECT id, type FROM bank_accounts WHERE user_id = ? AND provider = ? AND provider_account_id = ?',
              args: [userId, 'powens', String(powensAcc.id)]
            });
            if (accRes.rows.length === 0) continue;
            const localAcc = accRes.rows[0] as any;
            // Update balance + last_sync + sca_required
            await db.execute({
              sql: 'UPDATE bank_accounts SET balance = ?, last_sync = ?, sca_required = ? WHERE id = ?',
              args: [powensAcc.balance || 0, new Date().toISOString(), isSCA ? 1 : 0, localAcc.id]
            });
          }
          if (isSCA) console.log(`Connection ${conn.id} (powens=${conn.powens_connection_id}) needs SCA`);
        } catch (e: any) {
          console.error(`Background sync error for connection ${conn.id}:`, e.message);
        }
      }
    }
    // Sync blockchain accounts: refresh balances + fetch transactions
    const blockchainAccs = await db.execute({ sql: "SELECT * FROM bank_accounts WHERE provider = 'blockchain'", args: [] });
    for (const acc of blockchainAccs.rows as any[]) {
      try {
        const { balance, currency } = await fetchBlockchainBalance(acc.blockchain_network, acc.blockchain_address);
        await db.execute({ sql: 'UPDATE bank_accounts SET balance = ?, currency = ?, last_sync = ? WHERE id = ?', args: [balance, currency, new Date().toISOString(), acc.id] });
        const txs = await fetchBlockchainTransactions(acc.blockchain_network, acc.blockchain_address);
        let count = 0;
        for (const tx of txs) {
          const res = await db.execute({
            sql: `INSERT OR IGNORE INTO transactions (bank_account_id, date, amount, label, category, is_pro, tx_hash) VALUES (?, ?, ?, ?, 'Crypto', 0, ?)`,
            args: [acc.id, tx.date, tx.amount, tx.label, tx.tx_hash],
          });
          if (res.rowsAffected > 0) count++;
        }
        if (count > 0) console.log(`Synced ${count} new txs for ${acc.name} (${acc.blockchain_network})`);
      } catch (e: any) {
        console.error(`Background blockchain sync error for ${acc.name}:`, e.message);
      }
    }

    console.log('Background sync complete — all balances + SCA states updated');
  } catch (e: any) {
    console.error('Background sync failed:', e.message);
  }
}

async function main() {
  await initDatabase();
  await migrateDatabase();
  serve({ fetch: app.fetch, port: Number(process.env.PORT) || 5004 }, (info) => {
    console.log(`🦎 Konto API running on http://localhost:${info.port}`);
    // Sync all accounts in background on startup
    setTimeout(() => backgroundSyncAll(), 3000);
  });
}

main().catch(console.error);
