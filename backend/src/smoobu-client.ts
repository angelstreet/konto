import crypto from 'crypto';

const SMOOBU_BASE = 'https://login.smoobu.com';

/**
 * Smoobu credentials. New-style keys (usr_live_...) come with a secret and are sent
 * with HMAC-signed headers. A key without a secret is a legacy Api-Key (sunset 3 Nov 2026).
 */
export interface SmoobuCredentials {
  keyId: string;
  secret?: string;
}

/** Stored (decrypted) value: JSON {keyId, secret} for new keys, plain string for legacy keys. */
export function parseSmoobuCredentials(stored: string): SmoobuCredentials {
  if (stored.startsWith('{')) {
    const parsed = JSON.parse(stored);
    return { keyId: parsed.keyId, secret: parsed.secret };
  }
  return { keyId: stored };
}

export function serializeSmoobuCredentials(creds: SmoobuCredentials): string {
  return creds.secret ? JSON.stringify({ keyId: creds.keyId, secret: creds.secret }) : creds.keyId;
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Query string for the signature: pairs sorted by key then value, RFC 3986 encoded. */
function canonicalQuery(search: string): string {
  const pairs = [...new URLSearchParams(search).entries()];
  pairs.sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1));
  return pairs.map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`).join('&');
}

/**
 * Headers for Smoobu HMAC auth (docs.smoobu.com, HMAC Authentication). Canonical string:
 * METHOD \n path \n sorted query \n timestamp \n nonce \n sha256-hex(body) \n keyId,
 * signed with base64(HMAC-SHA256(secret, canonical)).
 */
export function signSmoobuRequest(
  creds: Required<SmoobuCredentials>,
  method: string,
  pathWithQuery: string,
  body = '',
  timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  nonce: string = crypto.randomUUID(),
): Record<string, string> {
  const url = new URL(pathWithQuery, SMOOBU_BASE);
  const canonical = [
    method.toUpperCase(),
    url.pathname,
    canonicalQuery(url.search),
    timestamp,
    nonce,
    crypto.createHash('sha256').update(body).digest('hex'),
    creds.keyId,
  ].join('\n');
  const signature = crypto.createHmac('sha256', creds.secret).update(canonical).digest('base64');
  return { 'X-API-Key': creds.keyId, 'X-Timestamp': timestamp, 'X-Nonce': nonce, 'X-Signature': signature };
}

/** fetch() against the Smoobu API with whichever auth the credentials support. */
export async function smoobuFetch(
  creds: SmoobuCredentials,
  pathWithQuery: string,
  options: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const method = options.method || 'GET';
  const body = options.body === undefined ? '' : JSON.stringify(options.body);
  const auth = creds.secret
    ? signSmoobuRequest({ keyId: creds.keyId, secret: creds.secret }, method, pathWithQuery, body)
    : { 'Api-Key': creds.keyId };
  return fetch(`${SMOOBU_BASE}${pathWithQuery}`, {
    method,
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: body || undefined,
  });
}
