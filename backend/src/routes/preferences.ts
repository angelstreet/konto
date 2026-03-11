import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';


const router = new Hono();

const DEFAULT_PREFERENCES = {
  onboarded: 1,
  display_currency: 'EUR',
  crypto_display: 'native',
  kozy_enabled: 0,
};

function normalizePrefsRow(row: any) {
  return {
    ...DEFAULT_PREFERENCES,
    ...(row || {}),
  };
}

async function getExistingUserForIntegration(c: any) {
  if ((c as any).apiKeyUserId) {
    const userId = Number((c as any).apiKeyUserId);
    const row = await db.execute({
      sql: 'SELECT id, clerk_id FROM users WHERE id = ?',
      args: [userId],
    });
    return row.rows[0] || null;
  }

  const clerkId = c.clerkUserId;
  if (!clerkId) return null;

  const row = await db.execute({
    sql: 'SELECT id, clerk_id FROM users WHERE clerk_id = ?',
    args: [clerkId],
  });
  return row.rows[0] || null;
}

router.get('/api/integration/status', async (c) => {
  const authMode = (c as any).apiKeyUserId ? 'api_key' : (c as any).clerkUserId ? 'clerk' : 'none';
  const user = await getExistingUserForIntegration(c);

  if (!user) {
    return c.json({
      app_id: 'konto',
      authenticated: authMode !== 'none',
      auth_mode: authMode,
      exists: false,
      local_user_id: null,
      clerk_user_id: (c as any).clerkUserId || null,
      onboarded: false,
      available_features: [],
      summary: {
        has_bank_connections: false,
        has_accounts: false,
        has_loans: false,
        has_assets: false,
        counts: {
          bank_connections: 0,
          accounts: 0,
          loans: 0,
          assets: 0,
        },
      },
    });
  }

  const userId = Number((user as any).id);
  const [prefsRes, bankConnRes, accountsRes, loansRes, assetsRes] = await Promise.all([
    db.execute({ sql: 'SELECT onboarded FROM user_preferences WHERE user_id = ?', args: [userId] }),
    db.execute({ sql: 'SELECT COUNT(*) as c FROM bank_connections WHERE user_id = ? AND status = ?', args: [userId, 'active'] }),
    db.execute({ sql: 'SELECT COUNT(*) as c FROM bank_accounts WHERE user_id = ? AND hidden = 0', args: [userId] }),
    db.execute({ sql: "SELECT COUNT(*) as c FROM bank_accounts WHERE user_id = ? AND type = 'loan' AND hidden = 0", args: [userId] }),
    db.execute({ sql: 'SELECT COUNT(*) as c FROM assets WHERE user_id = ?', args: [userId] }),
  ]);

  const bankConnections = Number((bankConnRes.rows[0] as any)?.c || 0);
  const accounts = Number((accountsRes.rows[0] as any)?.c || 0);
  const loans = Number((loansRes.rows[0] as any)?.c || 0);
  const assets = Number((assetsRes.rows[0] as any)?.c || 0);
  const onboarded = Number((prefsRes.rows[0] as any)?.onboarded || 0) === 1;

  const availableFeatures = ['summary'];
  if (accounts > 0) availableFeatures.push('accounts', 'transactions');
  if (loans > 0) availableFeatures.push('loans');
  if (assets > 0) availableFeatures.push('assets');
  if (bankConnections > 0) availableFeatures.push('bank_sync');

  return c.json({
    app_id: 'konto',
    authenticated: true,
    auth_mode: authMode,
    exists: true,
    local_user_id: userId,
    clerk_user_id: (user as any).clerk_id || (c as any).clerkUserId || null,
    onboarded,
    available_features: availableFeatures,
    summary: {
      has_bank_connections: bankConnections > 0,
      has_accounts: accounts > 0,
      has_loans: loans > 0,
      has_assets: assets > 0,
      counts: {
        bank_connections: bankConnections,
        accounts,
        loans,
        assets,
      },
    },
  });
});

// ========== USER PREFERENCES ==========

async function ensurePreferences(userId: number) {
  // Check if this is the default demo user (demo@konto.app) — look in user_profiles
  const userCheck = await db.execute({ sql: 'SELECT email FROM user_profiles WHERE user_id = ?', args: [userId] });
  const isDefaultUser = userCheck.rows[0]?.email === 'demo@konto.app';

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
  return normalizePrefsRow(r.rows[0]);
}

router.get('/api/preferences', async (c) => {
  try {
    const userId = await getUserId(c);
    const prefs = await ensurePreferences(userId);
    return c.json(prefs);
  } catch (e: any) {
    console.error('/api/preferences GET fallback:', e?.message || e);
    return c.json(DEFAULT_PREFERENCES);
  }
});

router.patch('/api/preferences', async (c) => {
  try {
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
    return c.json(normalizePrefsRow(prefs.rows[0]));
  } catch (e: any) {
    console.error('/api/preferences PATCH fallback:', e?.message || e);
    return c.json(DEFAULT_PREFERENCES);
  }
});



export default router;
