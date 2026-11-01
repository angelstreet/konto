import { createHash, randomBytes } from 'crypto';
import db, { ensureUser } from './db.js';
// Pure currency arithmetic lives in money.ts (no db, unit-testable); re-exported
// here so the many existing `from '../shared.js'` importers keep working.
import { FIAT_EUR_FALLBACK, FIAT_CURRENCIES, accountBalanceEur } from './money.js';
export { FIAT_CURRENCIES, accountBalanceEur };
import { encrypt, decrypt } from './crypto.js';

// --- API Key Helpers ---
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function generateApiKey(): string {
  return 'konto_' + randomBytes(16).toString('hex');
}

// --- Config ---
export const POWENS_CLIENT_ID = process.env.POWENS_CLIENT_ID || '91825215';
export const POWENS_CLIENT_SECRET = process.env.POWENS_CLIENT_SECRET || '';
export const POWENS_DOMAIN = process.env.POWENS_DOMAIN || 'your-domain.biapi.pro';
export const POWENS_API = `https://${POWENS_DOMAIN}/2.0`;
export const REDIRECT_URI = process.env.POWENS_REDIRECT_URI || (process.env.APP_URL ? `${process.env.APP_URL}/api/bank-callback` : 'http://localhost:3003/api/bank-callback');
export const POWENS_CONNECTOR_CAPABILITIES = process.env.POWENS_CONNECTOR_CAPABILITIES || '';

// --- Account classification helpers ---
const SAVINGS_TYPES = new Set(['savings', 'deposit', 'livreta', 'livretb', 'ldds', 'cel', 'pel']);
const INVESTMENT_TYPES = new Set(['market', 'pea', 'pee', 'per', 'perco', 'perp', 'lifeinsurance', 'madelin', 'capitalisation', 'crowdlending', 'realEstate', 'article83']);
const LOAN_TYPES = new Set(['loan']);

export function classifyAccountType(powensType: string | undefined, name: string): string {
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

export function classifyAccountSubtype(type: string, provider: string | undefined, name: string): string | null {
  if (type !== 'investment') return null;
  if (provider === 'blockchain' || provider === 'coinbase' || provider === 'binance') return 'crypto';
  const lower = (name || '').toLowerCase();
  if (lower.includes('pea') || lower.includes('action') || lower.includes('bourse') || lower.includes('trading') || lower.includes('stock')) return 'stocks';
  if (lower.includes('or ') || lower.includes('gold') || lower.includes('métaux') || lower.includes('metaux')) return 'gold';
  return 'other';
}

export function classifyAccountUsage(powensUsage: string | undefined | null, companyId: number | null): string {
  if (powensUsage === 'professional') return 'professional';
  if (powensUsage === 'private') return 'personal';
  return companyId ? 'professional' : 'personal';
}

export type PowensBankMeta = { bankId: string | null; bankName: string | null };

/** What a Powens connection tells us beyond its institution. */
export type PowensConnectionInfo = PowensBankMeta & {
  /** Powens `expire`: the highest expiry among the connection's sources. PSD2
   *  consent lasts ~180 days, and this is the only advance warning we get. */
  expire: string | null;
  /** e.g. 'SCARequired', 'webauthRequired', 'decoupled', 'wrongpass', or null. */
  state: string | null;
  /**
   * The connector's auth mechanism. This decides how much of a renewal can be
   * driven from the server:
   *  - 'decoupled'   the bank pushes to its own app and we send {resume:true};
   *                  no link for the user to open.
   *  - 'webauth'     Powens requires a browser; a one-tap link is the floor.
   *  - 'credentials' the webview collects credentials; worst case.
   */
  authMechanism: string | null;
};

/**
 * Institution per connection id, from `GET /users/me/connections?expand=connector`.
 *
 * Powens does not put the institution on the account object — an account only
 * carries `id_connection` — which is why probing `acc.bank` / `acc.institution`
 * returned null for every account and the UI fell back to showing a raw BIC.
 * The connector's `uuid` is stable across API domains; its `id` is not, so uuid
 * is preferred as the stored bank id.
 *
 * Returns an empty map on any failure: callers then fall back to the account
 * fields, which is the old behaviour.
 */
export async function fetchPowensConnectorMap(token: string): Promise<Map<string, PowensConnectionInfo>> {
  const map = new Map<string, PowensConnectionInfo>();
  try {
    const res = await fetch(`${POWENS_API}/users/me/connections?expand=connector`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return map;
    const data = await res.json() as any;
    for (const conn of data.connections || []) {
      if (conn?.id == null) continue;
      const connector = conn.connector || null;
      const rawId = connector?.uuid ?? connector?.id ?? conn.id_connector ?? null;
      const rawName = connector?.name ?? null;
      const rawMech = connector?.auth_mechanism ?? connector?.authMechanism ?? null;
      map.set(String(conn.id), {
        bankId: rawId == null ? null : String(rawId).trim() || null,
        bankName: rawName == null ? null : String(rawName).trim() || null,
        expire: conn.expire ? String(conn.expire) : null,
        state: conn.state ? String(conn.state) : null,
        authMechanism: rawMech == null ? null : String(rawMech).trim() || null,
      });
    }
  } catch {
    // fall through with whatever was collected
  }
  return map;
}

/**
 * The provider accounts this user deleted on purpose, as lookup keys. A delete
 * has to be remembered: the provider keeps returning the account, so without a
 * tombstone the next sync simply re-creates it and the deletion appears to be
 * ignored.
 *
 * Keys are `provider|id:<provider_account_id>` and `provider|iban:<iban>`, so a
 * re-keyed account is still recognised by its IBAN.
 */
export async function loadExcludedProviderAccounts(userId: number): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const res = await db.execute({
      sql: 'SELECT provider, provider_account_id, iban FROM excluded_provider_accounts WHERE user_id = ?',
      args: [userId],
    });
    for (const row of res.rows as any[]) {
      if (row.provider_account_id) keys.add(`${row.provider}|id:${row.provider_account_id}`);
      if (row.iban) keys.add(`${row.provider}|iban:${row.iban}`);
    }
  } catch {
    // table missing on an unmigrated database — nothing is excluded
  }
  return keys;
}

/**
 * Single-account form of the exclusion check, for sync loops that do not load
 * the whole set up front. One indexed lookup per account — cheap, and it cannot
 * be forgotten the way a preloaded set can when a new sync path is added.
 */
export async function isExcludedProviderAccount(
  userId: number,
  provider: string,
  providerAccountId: string | null | undefined,
  iban: string | null | undefined,
): Promise<boolean> {
  if (!providerAccountId && !iban) return false;
  try {
    const res = await db.execute({
      sql: `SELECT 1 FROM excluded_provider_accounts
            WHERE user_id = ? AND provider = ?
              AND ((provider_account_id IS NOT NULL AND provider_account_id = ?)
                OR (iban IS NOT NULL AND iban = ?))
            LIMIT 1`,
      args: [userId, provider, providerAccountId ?? null, iban ?? null],
    });
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

/** True when this provider account was deleted by the user and must not return. */
export function isProviderAccountExcluded(
  excluded: Set<string>,
  provider: string,
  providerAccountId: string | null | undefined,
  iban: string | null | undefined,
): boolean {
  if (providerAccountId && excluded.has(`${provider}|id:${providerAccountId}`)) return true;
  if (iban && excluded.has(`${provider}|iban:${iban}`)) return true;
  return false;
}

/**
 * Records which Powens connection owns each account, from the account's own
 * `id_connection`. Needed so the app can offer one reconnect link per
 * connection: several connections can sit behind one institution name, and a
 * link resolves the connection that owns the account it names.
 */
export async function persistPowensAccountConnections(userId: number, accounts: any[]): Promise<void> {
  for (const acc of accounts) {
    if (acc?.id == null || acc?.id_connection == null) continue;
    try {
      await db.execute({
        sql: `UPDATE bank_accounts SET provider_connection_id = ?
              WHERE user_id = ? AND provider = 'powens' AND provider_account_id = ?`,
        args: [String(acc.id_connection), userId, String(acc.id)],
      });
    } catch {
      // column missing on an unmigrated database
    }
  }
}

/**
 * Writes what a connection told us back onto its bank_connections row, so the
 * consent clock is readable without a Powens round-trip. Called from the sync
 * paths, which already hold the connector map.
 */
export async function persistPowensConnectionInfo(
  userId: number,
  map: Map<string, PowensConnectionInfo>,
): Promise<void> {
  for (const [connectionId, info] of map) {
    try {
      await db.execute({
        sql: `UPDATE bank_connections
              SET consent_expires_at = ?, provider_state = ?,
                  provider_auth_mechanism = COALESCE(?, provider_auth_mechanism),
                  provider_name = COALESCE(?, provider_name)
              WHERE user_id = ? AND powens_connection_id = ?`,
        args: [info.expire, info.state, info.authMechanism, info.bankName, userId, connectionId],
      });
    } catch {
      // column may be missing on a database that has not migrated yet
    }
  }
}

export function extractPowensBankMeta(acc: any, connectorMap?: Map<string, PowensBankMeta>): PowensBankMeta {
  // The connection is the only place Powens states the institution.
  if (connectorMap && acc?.id_connection != null) {
    const fromConnection = connectorMap.get(String(acc.id_connection));
    if (fromConnection && (fromConnection.bankId || fromConnection.bankName)) return fromConnection;
  }

  const bankObj = acc?.bank || acc?.institution || acc?.connector || null;
  const rawId = bankObj?.id ?? acc?.bank_id ?? acc?.institution_id ?? acc?.connector_id ?? acc?.parent_id ?? null;
  const rawName = bankObj?.name ?? acc?.bank_name ?? acc?.institution_name ?? acc?.connector_name ?? acc?.bank ?? null;

  const bankId = rawId === undefined || rawId === null ? null : String(rawId).trim() || null;
  const bankName = rawName === undefined || rawName === null ? null : String(rawName).trim() || null;
  return { bankId, bankName };
}

// --- Helper: get authenticated user ID ---
export async function getUserId(c: any): Promise<number> {
  // API key auth takes priority
  if ((c as any).apiKeyUserId) return (c as any).apiKeyUserId as number;
  const clerkId = c.clerkUserId;
  if (clerkId) {
    return ensureUser(clerkId);
  }
  // Legacy/API-token mode: use default user
  const result = await db.execute({ sql: 'SELECT u.id FROM users u JOIN user_profiles up ON up.user_id = u.id WHERE up.email = ?', args: ['demo@konto.app'] });
  if (result.rows.length > 0) return result.rows[0].id as number;
  const legacyResult = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: ['demo@konto.app'] });
  if (legacyResult.rows.length > 0) return legacyResult.rows[0].id as number;
  const fallbackEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
  const fallbackName = process.env.DEFAULT_ADMIN_NAME || 'Admin';

  // Production may already contain an admin user while demo user is absent.
  // Reuse existing rows instead of trying to insert a duplicate email.
  const existingFallback = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [fallbackEmail] });
  if (existingFallback.rows.length > 0) {
    const id = Number(existingFallback.rows[0].id);
    await db.execute({ sql: 'INSERT OR IGNORE INTO user_profiles (user_id, email, name) VALUES (?, ?, ?)', args: [id, fallbackEmail, fallbackName] });
    return id;
  }

  // Final fallback: if any user exists, use it to avoid hard failure in legacy DB states.
  const anyUser = await db.execute({ sql: 'SELECT id, email, name FROM users ORDER BY id ASC LIMIT 1' });
  if (anyUser.rows.length > 0) {
    const row: any = anyUser.rows[0];
    const id = Number(row.id);
    await db.execute({ sql: 'INSERT OR IGNORE INTO user_profiles (user_id, email, name) VALUES (?, ?, ?)', args: [id, row.email || fallbackEmail, row.name || fallbackName] });
    return id;
  }

  const ins = await db.execute({ sql: 'INSERT INTO users (email, name, role) VALUES (?, ?, ?)', args: [fallbackEmail, fallbackName, 'admin'] });
  const newUserId = Number(ins.lastInsertRowid);
  await db.execute({ sql: 'INSERT OR IGNORE INTO user_profiles (user_id, email, name) VALUES (?, ?, ?)', args: [newUserId, fallbackEmail, fallbackName] });
  return newUserId;
}

// --- Helpers to decrypt sensitive connection rows ---
export function decryptBankConn(row: any): any {
  if (!row) return row;
  return { ...row, powens_token: decrypt(row.powens_token), powens_refresh_token: decrypt(row.powens_refresh_token) };
}
export function decryptCoinbaseConn(row: any): any {
  if (!row) return row;
  return { ...row, access_token: decrypt(row.access_token), refresh_token: decrypt(row.refresh_token) };
}
export function decryptBinanceConn(row: any): any {
  if (!row) return row;
  return { ...row, api_key: decrypt(row.api_key), api_secret: decrypt(row.api_secret) };
}
export function decryptDriveConn(row: any): any {
  if (!row) return row;
  return { ...row, access_token: decrypt(row.access_token), refresh_token: decrypt(row.refresh_token) };
}

export function calcInvestmentDiff(unitValue: number, unitPrice: number, quantity: number, apiDiff: number, apiDiffPercent: number): { diff: number, diff_percent: number } {
  const diff = (apiDiff !== 0 && apiDiff != null) ? apiDiff : (unitPrice > 0 ? (unitValue - unitPrice) * quantity : 0);
  const diff_percent = (apiDiffPercent !== 0 && apiDiffPercent != null) ? apiDiffPercent : (unitPrice > 0 ? ((unitValue / unitPrice) - 1) * 100 : 0);
  return { diff, diff_percent };
}

export function calcInvDiff(unitValue: number, unitPrice: number, quantity: number, apiDiff: number, apiDiffPct: number): [number, number] {
  const diff = (apiDiff !== 0) ? apiDiff : (unitPrice > 0 ? (unitValue - unitPrice) * quantity : 0);
  const diff_percent = (apiDiffPct !== 0) ? apiDiffPct : (unitPrice > 0 ? ((unitValue / unitPrice) - 1) * 100 : 0);
  return [diff, diff_percent];
}

export function getClientIP(c: any): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    '127.0.0.1'
  );
}

// --- Helper: refresh Powens token ---
export async function refreshPowensToken(connectionId: number): Promise<string | null> {
  const connResult = await db.execute({
    sql: 'SELECT powens_token, powens_refresh_token FROM bank_connections WHERE id = ?',
    args: [connectionId]
  });
  const conn = decryptBankConn(connResult.rows[0] as any);

  if (!conn?.powens_refresh_token) {
    // Auto-heal legacy rows: if refresh token is missing but access token still works,
    // generate a temporary code and exchange it for a fresh access/refresh token pair.
    if (!conn?.powens_token) {
      console.log(`No refresh token and no access token for connection ${connectionId}`);
      return null;
    }
    try {
      console.log(`No refresh token for connection ${connectionId}, trying code exchange recovery...`);
      const codeRes = await fetch(`${POWENS_API}/auth/token/code`, {
        headers: { 'Authorization': `Bearer ${conn.powens_token}` },
      });
      if (!codeRes.ok) {
        const errorText = await codeRes.text();
        console.error(`Code generation failed for connection ${connectionId}:`, errorText);
        return null;
      }
      const codeData = await codeRes.json() as any;
      if (!codeData?.code) {
        console.error(`Code generation returned no code for connection ${connectionId}`);
        return null;
      }

      const tokenRes = await fetch(`${POWENS_API}/auth/token/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: POWENS_CLIENT_ID,
          client_secret: POWENS_CLIENT_SECRET,
          code: codeData.code
        }),
      });
      if (!tokenRes.ok) {
        const errorText = await tokenRes.text();
        console.error(`Code exchange failed for connection ${connectionId}:`, errorText);
        return null;
      }
      const tokenData = await tokenRes.json() as any;
      const recoveredAccessToken = tokenData.access_token || tokenData.token || conn.powens_token;
      const recoveredRefreshToken = tokenData.refresh_token || null;
      if (!recoveredRefreshToken) {
        console.error(`Code exchange for connection ${connectionId} returned no refresh token`);
        return null;
      }

      await db.execute({
        sql: 'UPDATE bank_connections SET powens_token = ?, powens_refresh_token = ?, status = ? WHERE id = ?',
        args: [encrypt(recoveredAccessToken), encrypt(recoveredRefreshToken), 'active', connectionId]
      });
      console.log(`Recovered missing refresh token for connection ${connectionId}`);
      return recoveredAccessToken;
    } catch (err: any) {
      console.error(`Refresh-token recovery failed for connection ${connectionId}:`, err.message);
      return null;
    }
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
      await db.execute({
        sql: 'UPDATE bank_connections SET status = ? WHERE id = ?',
        args: ['expired', connectionId]
      });
      return null;
    }

    const tokenData = await tokenRes.json() as any;
    const newAccessToken = tokenData.access_token || tokenData.token;
    const newRefreshToken = tokenData.refresh_token || conn.powens_refresh_token;

    await db.execute({
      sql: 'UPDATE bank_connections SET powens_token = ?, powens_refresh_token = ?, status = ? WHERE id = ?',
      args: [encrypt(newAccessToken), encrypt(newRefreshToken), 'active', connectionId]
    });

    console.log(`Token refreshed successfully for connection ${connectionId}`);
    return newAccessToken;
  } catch (err: any) {
    console.error(`Token refresh error for connection ${connectionId}:`, err.message);
    return null;
  }
}

// --- Helper: get valid Drive access token (refresh if expired) ---
export async function getDriveAccessToken(driveConn: any): Promise<string> {
  const now = new Date();
  const expiry = driveConn.token_expiry ? new Date(driveConn.token_expiry) : null;

  if (expiry && expiry.getTime() - 5 * 60 * 1000 > now.getTime()) {
    return driveConn.access_token;
  }

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
      return driveConn.access_token;
    }

    const newAccessToken = tokenData.access_token;
    const newExpiry = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    await db.execute({
      sql: 'UPDATE drive_connections SET access_token = ?, token_expiry = ? WHERE id = ?',
      args: [encrypt(newAccessToken), newExpiry, driveConn.id],
    });

    console.log(`Drive token refreshed for connection ${driveConn.id}`);
    return newAccessToken;
  } catch (err: any) {
    console.error(`Drive token refresh error for connection ${driveConn.id}:`, err.message);
    return driveConn.access_token;
  }
}

// Currency formatter
export function formatCurrencyFR(v: number) {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// --- Crypto EUR prices (cached 5 min) ---
// CoinGecko ids. POL is 'polygon-ecosystem-token'; 'matic-network' is the old
// pre-migration MATIC and trades ~37% above POL, so it overvalued the holding.
const CG_MAP: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', POL: 'polygon-ecosystem-token', BNB: 'binancecoin', AVAX: 'avalanche-2' };
let _cryptoPriceCache: { prices: Record<string, number>; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

export async function getCryptoEurPrices(): Promise<Record<string, number>> {
  if (_cryptoPriceCache && Date.now() - _cryptoPriceCache.ts < CACHE_TTL) return _cryptoPriceCache.prices;

  // Check DB cache (survives Vercel cold starts)
  const DB_KEY = 'crypto_eur_prices';
  try {
    const row = await db.execute({ sql: "SELECT data, updated_at FROM kv_cache WHERE key = ?", args: [DB_KEY] });
    if (row.rows.length > 0) {
      const r = row.rows[0] as any;
      const ts = new Date(r.updated_at).getTime();
      const prices = JSON.parse(r.data) as Record<string, number>;
      if (Date.now() - ts < CACHE_TTL) {
        _cryptoPriceCache = { prices, ts };
        return prices;
      }
      // Stale but usable as fallback
      _cryptoPriceCache = { prices, ts };
    }
  } catch {}

  const ids = Object.values(CG_MAP).join(',');
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur`);
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json() as Record<string, { eur?: number }>;
    const prices: Record<string, number> = {};
    for (const [code, cgId] of Object.entries(CG_MAP)) {
      if (data[cgId]?.eur) prices[code] = data[cgId].eur;
    }
    _cryptoPriceCache = { prices, ts: Date.now() };
    // Persist to DB
    try {
      await db.execute({
        sql: "INSERT OR REPLACE INTO kv_cache (key, data, updated_at) VALUES (?, ?, ?)",
        args: [DB_KEY, JSON.stringify(prices), new Date().toISOString()],
      });
    } catch {}
    return prices;
  } catch {
    return _cryptoPriceCache?.prices || {};
  }
}

// --- Fiat EUR rates (cached 12h — the ECB publishes once per working day) ---


let _fiatRateCache: { rates: Record<string, number>; ts: number } | null = null;
const FIAT_CACHE_TTL = 12 * 60 * 60 * 1000; // 12h

/**
 * Live EUR reference rates, expressed as units of currency per 1 EUR
 * (so CHF 0.94 means 1 EUR = 0.94 CHF). Falls back to the static table.
 */
export async function getFiatEurRates(): Promise<Record<string, number>> {
  if (_fiatRateCache && Date.now() - _fiatRateCache.ts < FIAT_CACHE_TTL) return _fiatRateCache.rates;

  const DB_KEY = 'fiat_eur_rates';
  try {
    const row = await db.execute({ sql: 'SELECT data, updated_at FROM kv_cache WHERE key = ?', args: [DB_KEY] });
    if (row.rows.length > 0) {
      const r = row.rows[0] as any;
      const ts = new Date(r.updated_at).getTime();
      const rates = { ...FIAT_EUR_FALLBACK, ...JSON.parse(r.data) } as Record<string, number>;
      if (Date.now() - ts < FIAT_CACHE_TTL) {
        _fiatRateCache = { rates, ts };
        return rates;
      }
      // Stale but still better than the static table if the fetch below fails.
      _fiatRateCache = { rates, ts };
    }
  } catch {}

  // ECB reference rates via Frankfurter — no API key required.
  const symbols = Object.keys(FIAT_EUR_FALLBACK).filter(c => c !== 'EUR' && c !== 'XOF').join(',');
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${symbols}`);
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
    const data = await res.json() as { rates?: Record<string, number> };
    if (!data.rates || Object.keys(data.rates).length === 0) throw new Error('Frankfurter: empty rates');

    const fetched: Record<string, number> = {};
    for (const [code, rate] of Object.entries(data.rates)) {
      if (typeof rate === 'number' && rate > 0) fetched[code] = rate;
    }
    const rates = { ...FIAT_EUR_FALLBACK, ...fetched };
    _fiatRateCache = { rates, ts: Date.now() };
    try {
      await db.execute({
        sql: 'INSERT OR REPLACE INTO kv_cache (key, data, updated_at) VALUES (?, ?, ?)',
        args: [DB_KEY, JSON.stringify(fetched), new Date().toISOString()],
      });
    } catch {}
    return rates;
  } catch {
    return _fiatRateCache?.rates || FIAT_EUR_FALLBACK;
  }
}


/** Update balance_native (EUR) for all crypto accounts that have a known price */
export async function updateCryptoBalanceNative(userId: number, prices: Record<string, number>) {
  if (Object.keys(prices).length === 0) return;
  try {
    const res = await db.execute({
      sql: "SELECT id, balance, currency FROM bank_accounts WHERE user_id = ? AND subtype = 'crypto' AND balance_native IS NULL OR (subtype = 'crypto' AND user_id = ?)",
      args: [userId, userId],
    });
    for (const row of res.rows as any[]) {
      const cur = row.currency || '';
      const eurPrice = prices[cur];
      if (eurPrice && row.balance) {
        const eurValue = Math.round(row.balance * eurPrice * 100) / 100;
        await db.execute({
          sql: "UPDATE bank_accounts SET balance_native = ? WHERE id = ?",
          args: [eurValue, row.id],
        });
      }
    }
  } catch {}
}
