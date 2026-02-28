import { Context, Next } from 'hono';
import { logSecurityEvent } from './auditLog.js';

/**
 * Geo-blocking middleware — blocks requests from countries not in the allowlist.
 * Uses CF-IPCountry header from Cloudflare.
 * Requests without the header are allowed only from trusted proxies (localhost, LAN).
 */

const ALLOWED_COUNTRIES = new Set([
  'CH', 'FR', 'DE', 'AT', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU',
  'GB', 'IE', 'US', 'CA', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ',
]);

const TRUSTED_PROXY_PATTERN = /^(127\.|::1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;

function getClientIp(c: Context): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0].trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  );
}

export async function geoBlockMiddleware(c: Context, next: Next) {
  const cfCountry = c.req.header('CF-IPCountry');
  const ip = getClientIp(c);

  // No CF-IPCountry header: allow through (Vercel serverless doesn't forward CF headers)
  if (!cfCountry) {
    return next();
  }

  // Check allowlist
  if (!ALLOWED_COUNTRIES.has(cfCountry)) {
    await logSecurityEvent({
      ip,
      country: cfCountry,
      action: 'GEO_BLOCK',
      resource: c.req.path,
      status: 403,
      details: { reason: 'country_not_allowed', method: c.req.method },
    });
    return c.json({ error: 'Access denied from your region' }, 403);
  }

  return next();
}
