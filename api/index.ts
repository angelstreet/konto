import { Hono } from 'hono';
import { createClient } from '@libsql/client';

const app = new Hono();

// Health - no backend needed
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// ─── Vercel Cron: Powens token refresh ───────────────────────────────────────
// Runs daily at 06:00 UTC via vercel.json crons config.
// Protected by CRON_SECRET env var (set in Vercel project settings).
const CRON_SECRET = process.env.CRON_SECRET;

async function encryptText(text: string): Promise<string> {
  const crypto = await import('crypto');
  const key = Buffer.from(process.env.DB_ENCRYPTION_KEY || '', 'hex');
  if (key.length !== 32) throw new Error('DB_ENCRYPTION_KEY must be 32 hex chars');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

app.get('/api/cron/refresh-stale-connections', async (c) => {
  if (!CRON_SECRET || c.req.header('Authorization') !== `Bearer ${CRON_SECRET}`) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const start = Date.now();
  const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.KONTO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN || process.env.KONTO_AUTH_TOKEN;
  if (!tursoUrl || !tursoToken) return c.json({ error: 'Missing Turso env vars' }, 500);

  const POWENS_DOMAIN = process.env.POWENS_DOMAIN || 'banking-api.powens.com';
  const POWENS_API = `https://${POWENS_DOMAIN}/2.0`;
  const POWENS_CLIENT_ID = process.env.POWENS_CLIENT_ID;
  const POWENS_CLIENT_SECRET = process.env.POWENS_CLIENT_SECRET;
  if (!POWENS_CLIENT_ID || !POWENS_CLIENT_SECRET) return c.json({ error: 'Missing Powens env vars' }, 500);

  const db = createClient({ url: tursoUrl, authToken: tursoToken });
  let refreshed = 0, errors = 0;

  try {
    const connsRes = await db.execute({
      sql: 'SELECT id, user_id FROM bank_connections WHERE provider = "powens" AND status = "active"'
    });

    for (const row of (connsRes.rows as any[])) {
      const connId = row.id;
      try {
        // Get stored tokens
        const connRes = await db.execute({ sql: 'SELECT powens_token, powens_refresh_token FROM bank_connections WHERE id = ?', args: [connId] });
        const conn = connRes.rows[0] as any;
        if (!conn?.powens_refresh_token) { errors++; continue; }

        // Refresh via Powens
        const tokenRes = await fetch(`${POWENS_API}/auth/token/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: POWENS_CLIENT_ID, client_secret: POWENS_CLIENT_SECRET, refresh_token: conn.powens_refresh_token }),
        });

        if (!tokenRes.ok) {
          console.error(`[cron] Refresh failed for conn ${connId}: ${tokenRes.status}`);
          await db.execute({ sql: 'UPDATE bank_connections SET status = "expired" WHERE id = ?', args: [connId] });
          errors++;
          continue;
        }

        const data = await tokenRes.json() as any;
        const newAccess = data.access_token || data.token;
        const newRefresh = data.refresh_token || conn.powens_refresh_token;

        await db.execute({
          sql: 'UPDATE bank_connections SET powens_token = ?, powens_refresh_token = ?, status = "active" WHERE id = ?',
          args: [await encryptText(newAccess), await encryptText(newRefresh), connId]
        });
        refreshed++;
      } catch (err: any) {
        console.error(`[cron] Error conn ${connId}: ${err.message}`);
        errors++;
      }
    }
  } finally {
    await db.close();
  }

  const elapsed = Date.now() - start;
  const result = { refreshed, errors, elapsed_ms: elapsed, ts: new Date().toISOString() };
  console.log(`[cron] Powens token refresh: ${JSON.stringify(result)}`);
  return c.json(result);
});

// ─── All other API routes → lazy-loaded backend ────────────────────────────────
app.all('/api/:path{.*}', async (c) => {
  const { app: backend, ensureServerBootstrap } = await import('../backend/src/index.js');
  try { await ensureServerBootstrap(); } catch (e) { console.error('[vercel] bootstrap failed:', e); }
  return backend.fetch(c.req.raw);
});

export default app;

