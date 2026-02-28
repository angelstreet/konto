import { Context, Next } from 'hono';
import db from '../db.js';

/**
 * Audit log middleware — logs every /api/* request to audit_log table.
 * Schema: audit_log(timestamp, user_id, ip, country, action, resource, status, details)
 */
export async function auditLogMiddleware(c: Context, next: Next) {
  const start = Date.now();
  await next();

  try {
    const ip =
      c.req.header('CF-Connecting-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0].trim() ||
      c.req.header('X-Real-IP') ||
      'unknown';
    const country = c.req.header('CF-IPCountry') || null;
    const method = c.req.method;
    const path = c.req.path;
    const status = c.res.status;
    const durationMs = Date.now() - start;

    // Resolve user_id: set by Clerk auth middleware or ensureUser
    const userId: number | null = (c as any).userId ?? null;

    await db.execute({
      sql: `INSERT INTO audit_log (timestamp, user_id, ip, country, action, resource, status, details)
            VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        userId,
        ip,
        country,
        method,
        path,
        status,
        JSON.stringify({ duration_ms: durationMs }),
      ],
    });
  } catch {
    // Non-blocking — never fail the request because of audit logging
  }
}

/**
 * Helper to log a specific security event to audit_log.
 * Used by geo-blocking and IP blacklisting middleware.
 */
export async function logSecurityEvent(opts: {
  ip: string;
  country: string | null;
  action: string;
  resource: string;
  status: number;
  details?: Record<string, unknown>;
}) {
  try {
    await db.execute({
      sql: `INSERT INTO audit_log (timestamp, user_id, ip, country, action, resource, status, details)
            VALUES (datetime('now'), NULL, ?, ?, ?, ?, ?, ?)`,
      args: [
        opts.ip,
        opts.country,
        opts.action,
        opts.resource,
        opts.status,
        JSON.stringify(opts.details ?? {}),
      ],
    });
  } catch {
    // Non-blocking
  }
}
