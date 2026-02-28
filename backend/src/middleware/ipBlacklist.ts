import { Context, Next } from 'hono';
import db from '../db.js';
import { logSecurityEvent } from './auditLog.js';

/**
 * IP Blacklist middleware + auto-detection of suspicious behavior.
 *
 * Detection rules:
 * - >100 req/min from same IP → temp block 1h
 * - >10 failed auth/hour → temp block 24h
 * - >20 404s in 5min → temp block 1h
 */

// In-memory counters (reset on restart — lightweight, no Redis required)
const reqCounters = new Map<string, { count: number; resetAt: number }>();
const failedAuthCounters = new Map<string, { count: number; resetAt: number }>();
const notFoundCounters = new Map<string, { count: number; resetAt: number }>();

function getClientIp(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0].trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  );
}

function increment(map: Map<string, { count: number; resetAt: number }>, key: string, windowMs: number): number {
  const now = Date.now();
  const entry = map.get(key);
  if (!entry || now > entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count++;
  return entry.count;
}

async function isBlacklisted(ip: string): Promise<boolean> {
  try {
    const row = await db.execute({
      sql: `SELECT expires_at FROM ip_blacklist WHERE ip = ?
            AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      args: [ip],
    });
    return row.rows.length > 0;
  } catch {
    return false;
  }
}

async function blacklistIp(ip: string, reason: string, durationHours: number | null) {
  try {
    const expiresAt = durationHours
      ? `datetime('now', '+${durationHours} hours')`
      : 'NULL';

    await db.execute({
      sql: `INSERT INTO ip_blacklist (ip, reason, blocked_at, expires_at, auto)
            VALUES (?, ?, datetime('now'), ${expiresAt}, 1)
            ON CONFLICT(ip) DO UPDATE SET
              reason = excluded.reason,
              blocked_at = excluded.blocked_at,
              expires_at = excluded.expires_at,
              auto = 1`,
      args: [ip, reason],
    });

    await logSecurityEvent({
      ip,
      country: null,
      action: 'IP_BLACKLISTED',
      resource: 'system',
      status: 403,
      details: { reason, duration_hours: durationHours },
    });
  } catch (err) {
    console.error('[ipBlacklist] Error blacklisting IP:', err);
  }
}

export async function ipBlacklistMiddleware(c: Context, next: Next) {
  const ip = getClientIp(c);

  // Skip for unknown/loopback
  if (!ip || ip === 'unknown' || ip === '127.0.0.1' || ip === '::1') {
    return next();
  }

  // Check blacklist
  if (await isBlacklisted(ip)) {
    await logSecurityEvent({
      ip,
      country: c.req.header('CF-IPCountry') ?? null,
      action: 'BLACKLISTED_ACCESS',
      resource: c.req.path,
      status: 403,
      details: { method: c.req.method },
    });
    return c.json({ error: 'Access denied' }, 403);
  }

  // Rate detection: >100 req/min
  const reqCount = increment(reqCounters, ip, 60_000);
  if (reqCount > 100) {
    await blacklistIp(ip, 'rate_limit_exceeded', 1);
    return c.json({ error: 'Too many requests' }, 429);
  }

  await next();

  const status = c.res.status;

  // Detect failed auth (401)
  if (status === 401) {
    const authFails = increment(failedAuthCounters, ip, 60 * 60_000);
    if (authFails > 10) {
      await blacklistIp(ip, 'excessive_auth_failures', 24);
    }
  }

  // Detect scanning (404)
  if (status === 404) {
    const notFounds = increment(notFoundCounters, ip, 5 * 60_000);
    if (notFounds > 20) {
      await blacklistIp(ip, 'scanning_detected', 1);
    }
  }
}

export async function manualBlacklistHandler(c: Context): Promise<Response> {
  const userId: number = (c as any).userId;
  if (!userId) return c.json({ error: 'Unauthorized' }, 401) as unknown as Response;

  const userRow = await db.execute({ sql: 'SELECT role FROM users WHERE id = ?', args: [userId] });
  if (!userRow.rows.length || (userRow.rows[0] as any).role !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403) as unknown as Response;
  }

  const body = await c.req.json();
  const { ip, reason } = body;

  if (!ip || typeof ip !== 'string') {
    return c.json({ error: 'ip is required' }, 400) as unknown as Response;
  }

  await db.execute({
    sql: `INSERT INTO ip_blacklist (ip, reason, blocked_at, expires_at, auto)
          VALUES (?, ?, datetime('now'), NULL, 0)
          ON CONFLICT(ip) DO UPDATE SET
            reason = excluded.reason,
            blocked_at = excluded.blocked_at,
            expires_at = NULL,
            auto = 0`,
    args: [ip, reason ?? 'manual'],
  });

  await logSecurityEvent({
    ip,
    country: null,
    action: 'IP_MANUAL_BLACKLIST',
    resource: 'admin',
    status: 200,
    details: { reason, admin_user_id: userId },
  });

  return c.json({ ok: true, ip }) as unknown as Response;
}
