import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../shared.js';
import db from '../db.js';

const router = new Hono();

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sha256buf(s: string): string {
  return base64url(sha256(s) as unknown as Buffer);
}

// POST /oauth/token
router.post('/oauth/token', async (c) => {
  const contentType = c.req.header('Content-Type') || '';

  let params: Record<string, string>;
  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await c.req.text();
      params = Object.fromEntries(new URLSearchParams(body));
    } else {
      params = await c.req.json();
    }
  } catch {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const grantType = params['grant_type'];
  const clientId = params['client_id'];

  if (!clientId) {
    return c.json({ error: 'invalid_request', error_description: 'client_id is required' }, 400);
  }

  // Validate client
  const clientRow = await db.execute({
    sql: 'SELECT * FROM oauth_clients WHERE client_id = ? AND active = 1',
    args: [clientId],
  });
  if (!clientRow.rows.length) {
    return c.json({ error: 'invalid_client' }, 400);
  }

  // --- authorization_code grant ---
  if (grantType === 'authorization_code') {
    const code = params['code'];
    const redirectUri = params['redirect_uri'];
    const codeVerifier = params['code_verifier'] || '';

    if (!code) {
      return c.json({ error: 'invalid_request', error_description: 'code is required' }, 400);
    }

    const codeRow = await db.execute({
      sql: `SELECT * FROM oauth_authorization_codes WHERE code = ? AND used = 0 AND expires_at > datetime('now')`,
      args: [code],
    });
    if (!codeRow.rows.length) {
      return c.json({ error: 'invalid_grant', error_description: 'Code not found, expired, or already used' }, 400);
    }
    const stored = codeRow.rows[0] as any;

    // Validate redirect_uri
    if (redirectUri !== stored.redirect_uri) {
      return c.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
    }

    // Verify PKCE if code_challenge was set
    if (stored.code_challenge) {
      const method = stored.code_challenge_method || 'S256';
      if (method === 'S256') {
        const expected = sha256buf(codeVerifier);
        if (expected !== stored.code_challenge) {
          return c.json({ error: 'invalid_grant', error_description: 'code_verifier mismatch' }, 400);
        }
      }
    }

    // Mark code as used
    await db.execute({ sql: 'UPDATE oauth_authorization_codes SET used = 1 WHERE id = ?', args: [stored.id] });

    // Generate tokens
    const accessToken = base64url(randomBytes(32));
    const refreshToken = base64url(randomBytes(32));
    const expiresIn = 3600; // 1 hour
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(); // 30 days

    // Store access token
    await db.execute({
      sql: `INSERT INTO oauth_access_tokens (token_hash, user_id, client_id, scope, expires_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [sha256(accessToken), stored.user_id, stored.client_id, stored.scope, expiresAt],
    });

    // Store refresh token
    await db.execute({
      sql: `INSERT INTO oauth_authorization_codes (code, client_id, user_id, scope, redirect_uri, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [refreshToken, stored.client_id, stored.user_id, stored.scope || '', stored.redirect_uri, refreshExpiresAt],
    });

    return c.text(
      new URLSearchParams({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: String(expiresIn),
        refresh_token: refreshToken,
        scope: stored.scope || 'openid profile email loans assets',
      }).toString(),
      200,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
  }

  // --- refresh_token grant ---
  if (grantType === 'refresh_token') {
    const refreshToken = params['refresh_token'];
    if (!refreshToken) {
      return c.json({ error: 'invalid_request', error_description: 'refresh_token is required' }, 400);
    }

    const codeRow = await db.execute({
      sql: `SELECT * FROM oauth_authorization_codes WHERE code = ? AND expires_at > datetime('now')`,
      args: [refreshToken],
    });
    if (!codeRow.rows.length) {
      return c.json({ error: 'invalid_grant' }, 400);
    }
    const stored = codeRow.rows[0] as any;

    // Issue new access token
    const accessToken = base64url(randomBytes(32));
    const expiresIn = 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await db.execute({
      sql: `INSERT INTO oauth_access_tokens (token_hash, user_id, client_id, scope, expires_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [sha256(accessToken), stored.user_id, stored.client_id, stored.scope, expiresAt],
    });

    return c.text(
      new URLSearchParams({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: String(expiresIn),
        scope: stored.scope || 'openid profile email loans assets',
      }).toString(),
      200,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
});

export default router;
