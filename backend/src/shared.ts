import { createHash, randomBytes } from 'crypto';
import db, { ensureUser } from './db.js';
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

export function extractPowensBankMeta(acc: any): { bankId: string | null; bankName: string | null } {
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
