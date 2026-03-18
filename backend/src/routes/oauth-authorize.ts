import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../shared.js';
import db from '../db.js';

const router = new Hono();

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// GET /oauth/authorize — show login or consent page
router.get('/oauth/authorize', async (c) => {
  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const responseType = c.req.query('response_type');
  const scope = c.req.query('scope') || 'openid profile email loans assets';
  const state = c.req.query('state') || '';
  const codeChallenge = c.req.query('code_challenge') || '';
  const codeChallengeMethod = c.req.query('code_challenge_method') || 'S256';

  if (!clientId || !redirectUri || responseType !== 'code') {
    return c.json({ error: 'invalid_request', error_description: 'Missing required parameters' }, 400);
  }

  // Validate client
  const clientRow = await db.execute({
    sql: 'SELECT * FROM oauth_clients WHERE client_id = ? AND active = 1',
    args: [clientId],
  });
  if (!clientRow.rows.length) {
    return c.json({ error: 'invalid_client' }, 400);
  }
  const client = clientRow.rows[0] as any;

  // Validate redirect_uri (must match stored)
  if (redirectUri !== client.redirect_uri) {
    return c.json({ error: 'invalid_request', error_description: 'redirect_uri mismatch' }, 400);
  }

  // Check if user is already authenticated via Clerk JWT
  let userId: number | null = null;
  try {
    const { getUserId } = await import('../shared.js');
    userId = await getUserId(c);
  } catch {
    // not authenticated
  }

  // Dev mode: Clerk not configured → auto-login as user 1
  if (!userId) {
    const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
    if (!CLERK_SECRET_KEY) {
      userId = 1; // default dev user
    }
  }

  if (!userId) {
    // Show login page
    return c.html(
      getLoginPage(client.name, scope, redirectUri, state, clientId, codeChallenge, codeChallengeMethod),
      200,
      { 'Content-Type': 'text/html; charset=utf-8' }
    );
  }

  // Show consent page
  const scopes = scope.split(' ').filter(Boolean);
  return c.html(
    getConsentPage(client.name, scopes, redirectUri, state, clientId, userId, codeChallenge, codeChallengeMethod),
    200,
    { 'Content-Type': 'text/html; charset=utf-8' }
  );
});

// POST /oauth/authorize — form submission (approve or deny)
router.post('/oauth/authorize', async (c) => {
  const body = await c.req.parseBody();
  const action = body['action'] as string;
  const clientId = body['client_id'] as string;
  const redirectUri = body['redirect_uri'] as string;
  const state = (body['state'] as string) || '';
  const userId = parseInt(body['user_id'] as string, 10);
  const codeChallenge = (body['code_challenge'] as string) || '';
  const codeChallengeMethod = (body['code_challenge_method'] as string) || 'S256';
  const scope = (body['scope'] as string) || 'openid profile email loans assets';

  if (action === 'deny') {
    return c.redirect(`${redirectUri}?error=access_denied&state=${encodeURIComponent(state)}`);
  }

  if (action !== 'authorize' || !clientId || !userId || isNaN(userId)) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  // Generate authorization code
  const code = base64url(randomBytes(32));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  await db.execute({
    sql: `INSERT INTO oauth_authorization_codes (code, client_id, user_id, scope, code_challenge, code_challenge_method, redirect_uri, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [code, clientId, userId, scope, codeChallenge || null, codeChallengeMethod || null, redirectUri, expiresAt],
  });

  // Clean up expired codes
  await db.execute({
    sql: `DELETE FROM oauth_authorization_codes WHERE expires_at < datetime('now')`,
    args: [],
  });

  const params = new URLSearchParams({ code, state });
  return c.redirect(`${redirectUri}?${params.toString()}`);
});

function getLoginPage(
  clientName: string,
  scope: string,
  redirectUri: string,
  state: string,
  clientId: string,
  codeChallenge: string,
  codeChallengeMethod: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign in — Konto</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 40px; width: 100%; max-width: 400px; }
  .logo { text-align: center; margin-bottom: 32px; }
  .logo h1 { font-size: 28px; font-weight: 800; color: #1a1a2e; letter-spacing: -0.5px; }
  .logo span { color: #f0a500; }
  h2 { font-size: 22px; font-weight: 600; margin-bottom: 8px; color: #1a1a2e; }
  p { color: #666; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
  .notice { background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 13px; color: #92400e; }
  input { width: 100%; padding: 12px 16px; border: 1.5px solid #e5e7eb; border-radius: 10px; font-size: 15px; transition: border-color 0.2s; }
  input:focus { outline: none; border-color: #f0a500; }
  button { width: 100%; padding: 14px; background: #1a1a2e; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 8px; transition: background 0.2s; }
  button:hover { background: #2d2d5a; }
</style>
</head>
<body>
<div class="card">
  <div class="logo"><h1>Konto<span>.</span></h1></div>
  <h2>Sign in to continue</h2>
  <p>You are signing in to <strong>${escapeHtml(clientName)}</strong></p>
  <div class="notice">Dev mode: enter any credentials to continue (Clerk not configured in dev)</div>
  <form method="POST">
    <input type="hidden" name="action" value="authorize">
    <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
    <input type="hidden" name="state" value="${escapeHtml(state)}">
    <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">
    <input type="hidden" name="scope" value="${escapeHtml(scope)}">
    <input type="hidden" name="user_id" value="1">
    <div style="margin-bottom: 16px;">
      <input type="email" name="email" placeholder="Email address" value="dev@konto.local" required>
    </div>
    <div style="margin-bottom: 16px;">
      <input type="password" name="password" placeholder="Password" value="devpass" required>
    </div>
    <button type="submit">Sign in</button>
  </form>
</div>
</body>
</html>`;
}

function getConsentPage(
  clientName: string,
  scopes: string[],
  redirectUri: string,
  state: string,
  clientId: string,
  userId: number,
  codeChallenge: string,
  codeChallengeMethod: string
): string {
  const scopeDescriptions: Record<string, string> = {
    openid: 'Your profile information',
    profile: 'Your name and avatar',
    email: 'Your email address',
    loans: 'Your loan and credit information',
    assets: 'Your asset and patrimoine data',
  };
  const scopeList = scopes
    .map((s) => `<li><strong>${escapeHtml(s)}</strong> — ${escapeHtml(scopeDescriptions[s] || s)}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Authorize — Konto</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 40px; width: 100%; max-width: 480px; }
  .logo { text-align: center; margin-bottom: 32px; }
  .logo h1 { font-size: 28px; font-weight: 800; color: #1a1a2e; letter-spacing: -0.5px; }
  .logo span { color: #f0a500; }
  .client-badge { display: inline-block; background: #1a1a2e; color: #fff; padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 600; margin-bottom: 20px; }
  h2 { font-size: 22px; font-weight: 600; margin-bottom: 8px; color: #1a1a2e; }
  p { color: #666; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
  .permissions { background: #f8f9fa; border-radius: 12px; padding: 20px; margin-bottom: 24px; }
  .permissions h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 12px; font-weight: 600; }
  .permissions ul { list-style: none; }
  .permissions li { padding: 10px 0; border-bottom: 1px solid #eee; font-size: 14px; color: #333; }
  .permissions li:last-child { border-bottom: none; }
  .permissions li strong { color: #1a1a2e; }
  .btn-group { display: flex; gap: 12px; }
  button { flex: 1; padding: 14px; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .btn-authorize { background: #1a1a2e; color: #fff; transition: background 0.2s; }
  .btn-authorize:hover { background: #2d2d5a; }
  .btn-deny { background: #fff; color: #666; border: 1.5px solid #e5e7eb; transition: background 0.2s; }
  .btn-deny:hover { background: #f5f5f5; }
</style>
</head>
<body>
<div class="card">
  <div class="logo"><h1>Konto<span>.</span></h1></div>
  <span class="client-badge">${escapeHtml(clientName)}</span>
  <h2>Authorize access</h2>
  <p>This application is requesting access to your Konto account. Review the permissions below before authorizing.</p>
  <div class="permissions">
    <h3>Permissions requested</h3>
    <ul>
      ${scopeList}
    </ul>
  </div>
  <div class="btn-group">
    <form method="POST" style="flex:1">
      <input type="hidden" name="action" value="deny">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <button type="submit" class="btn-deny">Deny</button>
    </form>
    <form method="POST" style="flex:2">
      <input type="hidden" name="action" value="authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="user_id" value="${userId}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">
      <input type="hidden" name="scope" value="${escapeHtml(scopes.join(' '))}">
      <button type="submit" class="btn-authorize">Authorize</button>
    </form>
  </div>
</div>
</body>
</html>`;
}

export default router;
