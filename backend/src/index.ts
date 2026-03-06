import 'dotenv/config';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verifyToken } from '@clerk/backend';
import db, { initDatabase, migrateDatabase, ensureUser } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { auditLogMiddleware, logSecurityEvent } from './middleware/auditLog.js';
import { geoBlockMiddleware } from './middleware/geoBlock.js';
import { ipBlacklistMiddleware } from './middleware/ipBlacklist.js';
import { createHash, randomBytes } from 'crypto';
import {
  sha256, generateApiKey, getUserId, getClientIP,
  POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
  classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
  decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
  refreshPowensToken, calcInvestmentDiff, calcInvDiff,
} from './shared.js';

// Route modules
import usersRoutes from './routes/users.js';
import companiesRoutes from './routes/companies.js';
import accountsRoutes from './routes/accounts.js';
import transactionsRoutes from './routes/transactions.js';
import investmentsRoutes from './routes/investments.js';
import patrimoineRoutes from './routes/patrimoine.js';
import cryptoRoutes, { fetchBlockchainBalance, fetchBlockchainTransactions } from './routes/crypto.js';
import analyticsRoutes from './routes/analytics.js';
import toolsRoutes from './routes/tools.js';
import driveRoutes from './routes/drive.js';
import preferencesRoutes from './routes/preferences.js';
import apiV1Routes from './routes/api_v1.js';
import loansRoutes from './routes/loans.js';
import fiscalRoutes from './routes/fiscal.js';

// Lazy-load Bitcoin modules (contain WASM that breaks Vercel serverless)
let bip32: any = null;
let bitcoin: any = null;
async function loadBitcoinModules() {
  if (bip32) return;
  const ecc = await import('tiny-secp256k1');
  const { BIP32Factory } = await import('bip32');
  bitcoin = await import('bitcoinjs-lib');
  bip32 = BIP32Factory(ecc);
}

// Import cron jobs
if (!process.env.VERCEL) {
  await import('./jobs/createDailySnapshots.js');
  await import('./jobs/refreshStaleConnections.js');
  await import('./jobs/refreshPropertyEstimations.js');
  await import('./jobs/cleanupAuditLog.js');
  await import('./jobs/tursoTokenRotation.js');
}
const { cronMonitor } = await import('./jobs/cronMonitor.js');

const app = new Hono();

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed === '*') return '*';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

const allowedOriginsRaw = process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS;
const ALLOWED_ORIGINS = (allowedOriginsRaw
  ? allowedOriginsRaw.split(',')
  : ['http://localhost:5003', 'http://localhost:5173', 'https://65.108.14.251:8080', 'https://konto.angelstreet.io'])
  .map(normalizeOrigin)
  .filter(Boolean);

function isAllowedOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  return ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(normalized);
}

app.use('/*', cors({
  origin: (origin) => {
    // In production, only allow configured origins
    if (!origin) return origin; // same-origin requests
    if (isAllowedOrigin(origin)) return origin;
    // Allow Vercel preview URLs
    if (origin.endsWith('.vercel.app')) return origin;
    return ALLOWED_ORIGINS[0]; // fallback
  },
  credentials: true,
}));

// --- CSRF Protection: Origin header validation ---
// Runs on all state-changing requests (POST, PUT, PATCH, DELETE).
// Skips webhook endpoints that receive cross-origin POSTs without an Origin.
const CSRF_SKIP_PATHS = new Set(['/api/health', '/api/bank-callback', '/api/coinbase-callback']);
const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.use('/*', async (c, next) => {
  const method = c.req.method;
  if (!CSRF_METHODS.has(method)) return next();

  const reqPath = c.req.path;
  if (CSRF_SKIP_PATHS.has(reqPath)) return next();

  const origin = c.req.header('Origin');

  // Allow requests with no Origin header (same-origin / server-to-server calls)
  if (!origin) return next();

  // Allow explicitly configured origins
  if (isAllowedOrigin(origin)) return next();

  // Allow Vercel preview deployment origins (*.vercel.app)
  if (origin.endsWith('.vercel.app')) return next();

  return c.json({ error: 'Forbidden: invalid Origin header' }, 403);
});

// --- Security headers ---
app.use('/*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
});

// --- Rate Limiting (in-memory, resets on cold start — fine for serverless) ---
type RateLimitEntry = { count: number; resetAt: number };
const _rateLimitStore = new Map<string, RateLimitEntry>();

// Periodically clean up expired entries to avoid memory growth in long-running processes
if (!process.env.VERCEL) {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of _rateLimitStore) {
      if (now >= entry.resetAt) _rateLimitStore.delete(key);
    }
  }, 60_000);
}

function createRateLimiter(maxRequests: number, windowMs: number, keyPrefix: string) {
  return async (c: any, next: any) => {
    const ip = getClientIP(c);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let entry = _rateLimitStore.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      _rateLimitStore.set(key, entry);
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Limit', String(maxRequests));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
      return c.json(
        {
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down and try again later.',
          retryAfter,
        },
        429
      );
    }

    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    return next();
  };
}

// General API rate limit: 100 requests/min per IP
app.use('/api/*', createRateLimiter(100, 60_000, 'general'));

// Auth-related endpoints: 10 requests/min per IP (stricter — prevents brute force / token abuse)
// Covers OAuth callbacks, connect URLs, and Clerk-authenticated write operations
const AUTH_PATHS = [
  '/api/bank-callback',
  '/api/coinbase-callback',
  '/api/drive-callback',
  '/api/bank/connect-url',
  '/api/coinbase/connect-url',
  '/api/drive/connect',
  '/api/binance/connect',
];
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  if (AUTH_PATHS.some(p => path === p || path.startsWith(p + '/'))) {
    return createRateLimiter(10, 60_000, 'auth')(c, next);
  }
  return next();
});

// --- API Key Auth Middleware ---
// Allows agents to authenticate with Bearer konto_xxx tokens
app.use('/api/*', async (c: any, next: any) => {
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer konto_')) {
    const key = auth.slice(7);
    const hash = sha256(key);
    const row = await db.execute({ sql: 'SELECT * FROM api_keys WHERE key_hash = ? AND active = 1', args: [hash] });
    if (row.rows.length) {
      (c as any).apiKeyUserId = row.rows[0].user_id;
      (c as any).apiKeyScope = row.rows[0].scope;
      // Update last_used_at
      await db.execute({ sql: "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?", args: [row.rows[0].id] });
    }
  }
  await next();
});

// --- Clerk Auth Middleware ---
// If CLERK_SECRET_KEY is set, validate Clerk JWTs on all /api/* routes.
// Falls back to unauthenticated access (default user) if Clerk is not configured.
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

app.use('/api/*', async (c, next) => {
  if (!CLERK_SECRET_KEY) return next(); // No Clerk → legacy mode (no auth)

  // Skip Clerk auth if API key already authenticated
  if ((c as any).apiKeyUserId) return next();

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

// --- IP Blacklist Middleware ---
// Checks IP against blacklist and detects suspicious behavior (runs first)
app.use('/api/*', ipBlacklistMiddleware);

// --- Geo-Blocking Middleware ---
// Blocks requests from countries not in allowlist using CF-IPCountry header
app.use('/api/*', geoBlockMiddleware);

// --- Audit Log Middleware ---
// Logs every /api/* request to audit_log table (runs after auth so userId is available)
app.use('/api/*', auditLogMiddleware);


// --- Health ---
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/api/health/cron', (c) => {
  const jobs = cronMonitor.getAllJobs();
  const healthy = cronMonitor.isHealthy();
  return c.json({
    status: healthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    jobs,
  });
});

// --- Mount route modules ---
app.route('', usersRoutes);
app.route('', companiesRoutes);
app.route('', accountsRoutes);
app.route('', transactionsRoutes);
app.route('', investmentsRoutes);
app.route('', patrimoineRoutes);
app.route('', cryptoRoutes);
app.route('', analyticsRoutes);
app.route('', toolsRoutes);
app.route('', driveRoutes);
app.route('', preferencesRoutes);
app.route('', apiV1Routes);
app.route('', loansRoutes);
app.route('', fiscalRoutes);

// ========== START SERVER ==========

export { app };

async function backgroundSyncAll() {
  try {
    const usersRes = await db.execute({ sql: 'SELECT DISTINCT user_id FROM bank_connections WHERE status = ?', args: ['active'] });
    for (const row of usersRes.rows as any[]) {
      const userId = row.user_id;
      const connsRes = await db.execute({ sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ?', args: [userId, 'active'] });
      for (const rawConn of connsRes.rows as any[]) {
        const conn = decryptBankConn(rawConn);
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
            const meta = extractPowensBankMeta(powensAcc);
            const storedBankName = meta.bankName || null;
            const accType = classifyAccountType(powensAcc.type, powensAcc.name || powensAcc.original_name || '');
            const accRes = await db.execute({
              sql: 'SELECT id, type FROM bank_accounts WHERE user_id = ? AND provider = ? AND provider_account_id = ?',
              args: [userId, 'powens', String(powensAcc.id)]
            });
            if (accRes.rows.length === 0) continue;
            const localAcc = accRes.rows[0] as any;
            // Update balance + last_sync + sca_required
            await db.execute({
              sql: 'UPDATE bank_accounts SET provider_bank_id = ?, provider_bank_name = COALESCE(?, provider_bank_name), name = ?, bank_name = COALESCE(?, bank_name), account_number = COALESCE(?, account_number), iban = COALESCE(?, iban), type = ?, subtype = ?, usage = ?, balance = ?, last_sync = ?, sca_required = ? WHERE id = ?',
              args: [meta.bankId, meta.bankName, powensAcc.name || powensAcc.original_name || 'Account', storedBankName, powensAcc.number || powensAcc.webid || null, powensAcc.iban || null, accType, classifyAccountSubtype(accType, 'powens', powensAcc.name || powensAcc.original_name || ''), classifyAccountUsage(powensAcc.usage, null), powensAcc.balance || 0, new Date().toISOString(), isSCA ? 1 : 0, localAcc.id]
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


async function seedDemoCryptoTransactions() {
  try {
    // Only run for demo user (user_id 1) — ALL investment accounts (crypto + stocks/funds)
    const cryptoAccs = await db.execute({
      sql: "SELECT id, name, subtype FROM bank_accounts WHERE user_id = 1 AND type = 'investment'",
      args: []
    });
    if (cryptoAccs.rows.length === 0) return;

    for (const acc of cryptoAccs.rows as any[]) {
      const existing = await db.execute({
        sql: 'SELECT COUNT(*) as cnt FROM transactions WHERE bank_account_id = ?',
        args: [acc.id]
      });
      const hasDemo = await db.execute({ sql: "SELECT COUNT(*) as cnt FROM transactions WHERE bank_account_id = ? AND label LIKE 'Achat%'", args: [acc.id] });
      if ((hasDemo.rows[0] as any).cnt > 0) continue;

      console.log(`Seeding demo crypto transactions for ${acc.name} (id=${acc.id})`);

      // Generate ~14 months of monthly buy transactions (upward with volatility)
      // Different patterns per subtype
      const subtype = (acc as any).subtype || 'other';
      const isCrypto = subtype === 'crypto';
      const isStocks = acc.name.toLowerCase().includes('pea') || acc.name.toLowerCase().includes('action');
      const baseAmounts = isCrypto ? [80, 120, 95, 150, 110, 180, 75, 200, 130, 90, 160, 140, 105, 170]
        : isStocks ? [150, 200, 180, 250, 300, 220, 280, 190, 260, 210, 240, 170, 230, 200]
        : [200, 300, 250, 350, 400, 280, 320, 450, 380, 270, 310, 420, 340, 290];
      const now = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 10 + Math.floor(i * 1.5));
        const dateStr = d.toISOString().split('T')[0];
        const amount = baseAmounts[13 - i];
        const label = isCrypto
          ? (acc.name.toLowerCase().includes('btc') ? 'Achat BTC' : acc.name.toLowerCase().includes('eth') ? 'Achat ETH' : 'Achat crypto')
          : isStocks ? 'Achat actions' : 'Versement ' + acc.name;
        const category = isCrypto ? 'Crypto' : 'Investissement';
        await db.execute({
          sql: "INSERT OR IGNORE INTO transactions (bank_account_id, date, amount, label, category, is_pro) VALUES (?, ?, ?, ?, ?, 0)",
          args: [acc.id, dateStr, amount, label, category]
        });
      }
    }
  } catch (e: any) {
    console.error('seedDemoCryptoTransactions error:', e.message);
  }
}

let serverBootstrapPromise: Promise<void> | null = null;

export async function ensureServerBootstrap(): Promise<void> {
  if (!serverBootstrapPromise) {
    serverBootstrapPromise = (async () => {
      await initDatabase();
      await migrateDatabase();
      // Keep demo seed behavior on both local and serverless cold starts.
      await seedDemoCryptoTransactions();
    })();
  }
  return serverBootstrapPromise;
}

async function main() {
  await ensureServerBootstrap();
  const { serve } = await import('@hono/node-server');
  serve({ fetch: app.fetch, port: Number(process.env.PORT) || 5004 }, (info) => {
    console.log(`🦎 Konto API running on http://localhost:${info.port}`);
    // Sync all accounts in background on startup
    setTimeout(() => backgroundSyncAll(), 3000);
  });
}

if (!process.env.VERCEL) {
  main().catch(console.error);
}
