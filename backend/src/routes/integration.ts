import { Hono } from 'hono';
import db from '../db.js';
import { kontoIntegrationManifest } from '../integration/manifest.js';
import { kontoIntegrationActions, runKontoIntegrationAction, type KontoIntegrationActionId } from '../integration/actions.js';

const router = new Hono();

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

router.get('/api/integration/actions', (c) => {
  return c.json(kontoIntegrationManifest);
});

router.post('/api/integration/execute/:actionId', async (c) => {
  const user = await getExistingUserForIntegration(c);
  if (!user) return c.json({ error: 'No local user for integration' }, 404);

  const actionId = c.req.param('actionId') as KontoIntegrationActionId;
  if (!kontoIntegrationActions.find((action) => action.id === actionId)) {
    return c.json({ error: 'Unknown integration action' }, 404);
  }

  let input: Record<string, any> = {};
  try {
    input = await c.req.json();
  } catch {
    input = {};
  }

  const result = await runKontoIntegrationAction(actionId, Number((user as any).id), input);
  return c.json(result);
});

export default router;
