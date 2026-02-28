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
