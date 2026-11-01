import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI, POWENS_CONNECTOR_CAPABILITIES,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         fetchPowensConnectorMap, persistPowensConnectionInfo, persistPowensAccountConnections,
         loadExcludedProviderAccounts, isProviderAccountExcluded,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';
import { categorizeTransaction } from '../categorizer.js';
import { inferAndPersistLoanDetails } from './loans.js';

// --- Helper: deduplicated bank account find-or-create ---
// Tries to find an existing account by (company_id, provider, provider_account_id) first,
// then by (user_id, provider, iban) as fallback. Returns { id } or null.
async function findBankAccountByProviderId(userId: number, companyId: number | null, provider: string, providerAccountId: string | null, iban: string | null): Promise<number | null> {
  if (providerAccountId) {
    const existing = await db.execute({
      sql: 'SELECT id FROM bank_accounts WHERE user_id = ? AND company_id = ? AND provider = ? AND provider_account_id = ?',
      args: [userId, companyId, provider, providerAccountId]
    });
    if (existing.rows.length > 0) return existing.rows[0].id as number;
  }
  if (iban) {
    const existing = await db.execute({
      sql: 'SELECT id FROM bank_accounts WHERE user_id = ? AND provider = ? AND iban = ?',
      args: [userId, provider, iban]
    });
    if (existing.rows.length > 0) return existing.rows[0].id as number;
  }
  return null;
}

/** Powens connection states that mean the user has to act before data flows again. */
const POWENS_ACTION_STATES = new Set([
  'scarequired', 'webauthrequired', 'wrongpass', 'actionneeded', 'validating', 'decoupled',
]);

const router = new Hono();


router.get('/api/bank/connect-url', async (c) => {
  const lang = c.req.query('lang') || 'fr';
  const userId = await getUserId(c);
  const state = randomBytes(16).toString('hex');
  await db.execute({ sql: 'INSERT INTO oauth_states (state, user_id) VALUES (?, ?)', args: [state, userId] });
  // Expire states older than 10 minutes
  await db.execute({ sql: "DELETE FROM oauth_states WHERE created_at < datetime('now', '-10 minutes')", args: [] });
  const capabilitiesParam = POWENS_CONNECTOR_CAPABILITIES ? `&connector_capabilities=${POWENS_CONNECTOR_CAPABILITIES}` : '';
  const url = `https://webview.powens.com/${lang}/connect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}${capabilitiesParam}`;
  return c.json({ url });
});

// Powens webview — redirect directly (Powens blocks iframes via X-Frame-Options: DENY)
router.get('/api/bank/webview', (c) => {
  const target = c.req.query('url');
  if (!target || !target.startsWith('https://webview.powens.com/')) {
    return c.text('Invalid URL', 400);
  }
  return c.redirect(target, 302);
});

/**
 * Mints a Powens webview URL for re-approving the connection that owns this
 * account. Shared by the JSON route and the redirect route below; returns null
 * when the account is not this user's.
 *
 * The URL carries a short-lived Powens code and a `state` row that is dropped
 * after 10 minutes, so it has to be minted per request — it cannot be stored
 * and sent later.
 */
async function buildReconnectUrl(
  userId: number,
  accountId: string,
  lang: string,
): Promise<{ url: string; connection_id?: string } | null> {
  const accRes = await db.execute({
    sql: 'SELECT provider_account_id, provider_connection_id FROM bank_accounts WHERE id = ? AND user_id = ?',
    args: [accountId, userId]
  });
  if (accRes.rows.length === 0) return null;
  const { provider_connection_id: providerConnectionId } = accRes.rows[0] as any;

  // The account records which Powens connection owns it. This used to be found
  // by probing each connection's token against /users/me/accounts — but a
  // Powens token is scoped to the Powens USER, not the connection, so every
  // token lists every account and the first row always "matched". When no token
  // worked the function fell through to a generic /connect, which does not
  // reconnect anything: it creates a NEW connection. That is how one bank ended
  // up behind nine connections.
  if (!providerConnectionId) return null;
  return buildReconnectUrlForConnection(userId, String(providerConnectionId), lang);
}

/**
 * Mints the reconnect webview URL for a connection directly. Needed because a
 * connection can hold zero stored accounts — it has never synced, or its
 * accounts were removed — and then there is no account to hang a link on, which
 * is exactly the connection most likely to need re-approving.
 */
async function buildReconnectUrlForConnection(
  userId: number,
  providerConnectionId: string,
  lang: string,
): Promise<{ url: string; connection_id?: string } | null> {
  const connRes = await db.execute({
    sql: `SELECT * FROM bank_connections
          WHERE user_id = ? AND powens_connection_id = ? AND status != 'replaced'
          ORDER BY id DESC LIMIT 1`,
    args: [userId, String(providerConnectionId)],
  });
  if (connRes.rows.length === 0) return null;
  const conn = decryptBankConn(connRes.rows[0] as any);

  const state = randomBytes(16).toString('hex');
  await db.execute({ sql: 'INSERT INTO oauth_states (state, user_id) VALUES (?, ?)', args: [state, userId] });
  await db.execute({ sql: "DELETE FROM oauth_states WHERE created_at < datetime('now', '-10 minutes')", args: [] });

  const base = `https://webview.powens.com/${lang}/reconnect?domain=${POWENS_DOMAIN}`
    + `&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&connection_id=${conn.powens_connection_id}&state=${state}`;

  // A temporary code is preferred over handing the webview a live token.
  for (const token of [conn.powens_token, await refreshPowensToken(conn.id)]) {
    if (!token) continue;
    try {
      const codeRes = await fetch(`${POWENS_API}/auth/token/code`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!codeRes.ok) continue;
      const codeData = await codeRes.json() as any;
      if (!codeData?.code) continue;
      return { url: `${base}&code=${codeData.code}`, connection_id: conn.powens_connection_id };
    } catch {
      // try the refreshed token
    }
  }

  // Last resort: the webview also accepts the access token directly. Never fall
  // back to /connect here — that would silently add a duplicate connection
  // instead of repairing this one.
  if (conn.powens_token) {
    return { url: `${base}&token=${conn.powens_token}`, connection_id: conn.powens_connection_id };
  }
  return null;
}

// Reconnect a specific SCA-blocked connection
router.get('/api/bank/reconnect-url/:accountId', async (c) => {
  const userId = await getUserId(c);
  const result = await buildReconnectUrl(userId, c.req.param('accountId'), c.req.query('lang') || 'fr');
  if (!result) return c.json({ error: 'Account not found' }, 404);
  return c.json(result);
});

/**
 * The Powens "manage" webview: the only screen that lets the user **activate or
 * deactivate accounts** on a connection. /reconnect does not — it only resumes
 * a connection that stopped syncing, and returns immediately when there is
 * nothing to resume, which looks like success while changing nothing.
 *
 * So an account disabled at the consent step can only be brought back here.
 */
async function buildManageUrl(userId: number, lang: string): Promise<string | null> {
  const connsRes = await db.execute({
    sql: `SELECT * FROM bank_connections WHERE user_id = ? AND status = 'active' ORDER BY id DESC`,
    args: [userId],
  });
  const state = randomBytes(16).toString('hex');
  await db.execute({ sql: 'INSERT INTO oauth_states (state, user_id) VALUES (?, ?)', args: [state, userId] });
  await db.execute({ sql: "DELETE FROM oauth_states WHERE created_at < datetime('now', '-10 minutes')", args: [] });

  const base = `https://webview.powens.com/${lang}/manage?domain=${POWENS_DOMAIN}`
    + `&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&state=${state}`;

  for (const rawConn of connsRes.rows as any[]) {
    const conn = decryptBankConn(rawConn);
    for (const token of [conn.powens_token, await refreshPowensToken(conn.id)]) {
      if (!token) continue;
      try {
        const codeRes = await fetch(`${POWENS_API}/auth/token/code`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!codeRes.ok) continue;
        const codeData = await codeRes.json() as any;
        if (codeData?.code) return `${base}&code=${codeData.code}`;
      } catch { /* next token */ }
    }
  }
  return null;
}

router.get('/api/bank/manage', async (c) => {
  const t = c.req.query('t');
  let userId: number;
  if (t) {
    const row = await db.execute({
      sql: `SELECT id, user_id FROM reconnect_tokens
            WHERE token_hash = ? AND powens_connection_id = 'manage'
              AND used_at IS NULL AND expires_at > datetime('now') LIMIT 1`,
      args: [sha256(t)],
    });
    if (row.rows.length === 0) {
      return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
        <h1 style="color:#ef4444;">Lien expiré</h1><a href="/konto/accounts" style="color:#d4a812;">← Konto</a></body></html>`, 410);
    }
    userId = Number((row.rows[0] as any).user_id);
    await db.execute({ sql: "UPDATE reconnect_tokens SET used_at = datetime('now') WHERE id = ?", args: [(row.rows[0] as any).id] });
  } else {
    userId = await getUserId(c);
  }
  const url = await buildManageUrl(userId, c.req.query('lang') || 'fr');
  if (!url) {
    return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Impossible d'ouvrir la gestion des comptes</h1>
      <a href="/konto/accounts" style="color:#d4a812;">← Konto</a></body></html>`, 502);
  }
  return c.redirect(url, 302);
});

router.post('/api/bank/manage-token', async (c) => {
  const userId = await getUserId(c);
  const token = randomBytes(32).toString('hex');
  const days = Math.min(Math.max(Number(c.req.query('days') || 7), 1), 30);
  await db.execute({
    sql: `INSERT INTO reconnect_tokens (token_hash, user_id, powens_connection_id, expires_at)
          VALUES (?, ?, 'manage', datetime('now', '+' || ? || ' days'))`,
    args: [sha256(token), userId, String(days)],
  });
  const base = process.env.APP_URL || 'https://konto.angelstreet.io';
  return c.json({ url: `${base}/api/bank/manage?t=${token}`, expires_in_days: days });
});

/**
 * Mints a single-use link for re-approving one connection, for sending to a
 * phone. Needed because a notification opens in the messaging app's browser,
 * which carries no Konto session: a session-based link lands on a sign-in
 * screen and the redirect afterwards drops the query string.
 *
 * The token authorises exactly one thing — mint a Powens reconnect URL for
 * this connection — and expires. It exposes no data, and the re-approval still
 * happens at the bank with the user's own credentials.
 */
router.post('/api/bank/reconnect-token/:connectionId', async (c) => {
  const userId = await getUserId(c);
  const connectionId = c.req.param('connectionId');
  const conn = await db.execute({
    sql: `SELECT id FROM bank_connections WHERE user_id = ? AND powens_connection_id = ? AND status != 'replaced' LIMIT 1`,
    args: [userId, connectionId],
  });
  if (conn.rows.length === 0) return c.json({ error: 'Connection not found' }, 404);

  const token = randomBytes(32).toString('hex');
  const days = Math.min(Math.max(Number(c.req.query('days') || 7), 1), 30);
  await db.execute({
    sql: `INSERT INTO reconnect_tokens (token_hash, user_id, powens_connection_id, expires_at)
          VALUES (?, ?, ?, datetime('now', '+' || ? || ' days'))`,
    args: [sha256(token), userId, connectionId, String(days)],
  });
  await db.execute({ sql: "DELETE FROM reconnect_tokens WHERE expires_at < datetime('now')", args: [] });

  const base = process.env.APP_URL || 'https://konto.angelstreet.io';
  return c.json({ url: `${base}/api/bank/reconnect-connection/${connectionId}?t=${token}`, expires_in_days: days });
});

// JSON form, for the app to call with its session. The redirect form below
// cannot be opened straight from a notification: a browser navigation carries
// no Authorization header, so the API answers 401. A link sent to the phone
// therefore points at the app (/konto/accounts?reconnect=<id>), which is
// already signed in and calls this.
router.get('/api/bank/reconnect-connection-url/:connectionId', async (c) => {
  const userId = await getUserId(c);
  const result = await buildReconnectUrlForConnection(userId, c.req.param('connectionId'), c.req.query('lang') || 'fr');
  if (!result) return c.json({ error: 'Connection not found' }, 404);
  return c.json(result);
});

router.get('/api/bank/reconnect-connection/:connectionId', async (c) => {
  const connectionId = c.req.param('connectionId');
  // A single-use token stands in for a session, so the link works from a
  // notification. Consumed on use.
  const t = c.req.query('t');
  let userId: number;
  if (t) {
    const row = await db.execute({
      sql: `SELECT id, user_id FROM reconnect_tokens
            WHERE token_hash = ? AND powens_connection_id = ?
              AND used_at IS NULL AND expires_at > datetime('now') LIMIT 1`,
      args: [sha256(t), connectionId],
    });
    if (row.rows.length === 0) {
      return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
        <h1 style="color:#ef4444;">Lien expiré</h1>
        <p>Ouvrez Konto et relancez la reconnexion depuis la page Comptes.</p>
        <a href="/konto/accounts" style="color:#d4a812;">← Konto</a></body></html>`, 410);
    }
    userId = Number((row.rows[0] as any).user_id);
    await db.execute({ sql: "UPDATE reconnect_tokens SET used_at = datetime('now') WHERE id = ?", args: [(row.rows[0] as any).id] });
  } else {
    userId = await getUserId(c);
  }
  const result = await buildReconnectUrlForConnection(userId, connectionId, c.req.query('lang') || 'fr');
  if (!result?.url || !result.url.startsWith('https://webview.powens.com/')) {
    return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Could not start the reconnection</h1>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`, 404);
  }
  return c.redirect(result.url, 302);
});

// Stable, shareable entry point for re-approving a bank.
//
// /api/bank/reconnect-url/:accountId returns a Powens webview URL that carries a
// short-lived code and a `state` row that is deleted after 10 minutes, so a URL
// pasted into a notification is usually dead by the time it is tapped. This
// route mints a fresh one per request and redirects, so a link sent to the phone
// keeps working. It relies on the normal session, so it is not a secret URL.
router.get('/api/bank/reconnect/:accountId', async (c) => {
  const userId = await getUserId(c);
  const result = await buildReconnectUrl(userId, c.req.param('accountId'), c.req.query('lang') || 'fr');
  if (!result?.url) {
    return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Could not start the reconnection</h1>
      <p>Open Konto and use the reconnect button on the account instead.</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`, 404);
  }
  if (!result.url.startsWith('https://webview.powens.com/')) return c.redirect('/konto/accounts', 302);
  return c.redirect(result.url, 302);
});

// --- Powens: OAuth callback ---
router.get('/api/bank-callback', async (c) => {
  const code = c.req.query('code');
  const connectionId = c.req.query('connection_id');
  const error = c.req.query('error');
  const state = c.req.query('state');

  if (error) {
    return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Connection failed</h1><p>${escapeHtml(error)}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }
  // Validate OAuth state to prevent CSRF (always — code and no-code flows)
  let stateUserId: number | null = null;
  if (state) {
    const stateRes = await db.execute({ sql: 'SELECT user_id FROM oauth_states WHERE state = ?', args: [state] });
    if (stateRes.rows.length === 0) {
      return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
        <h1 style="color:#ef4444;">Invalid or expired session</h1><p>Please try connecting your bank again.</p>
        <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`, 403);
    }
    stateUserId = (stateRes.rows[0] as any).user_id;
    // Consume the state (one-time use)
    await db.execute({ sql: 'DELETE FROM oauth_states WHERE state = ?', args: [state] });
  }

  // Powens reconnect flow: redirects back with connection_id but no code when SCA is resolved
  // In this case the existing token is still valid — just clear the flags and
  // re-read the connection's state so the UI is right the moment he lands.
  if (!code && connectionId) {
    const userId = stateUserId ?? await getUserId(c);
    await db.execute({
      sql: 'UPDATE bank_connections SET status = ? WHERE user_id = ? AND powens_connection_id = ? AND status = ?',
      args: ['active', userId, connectionId, 'sca_required'],
    });
    // Scoped to this connection — provider_connection_id makes that possible.
    await db.execute({
      sql: `UPDATE bank_accounts SET sca_required = 0
            WHERE user_id = ? AND provider = 'powens' AND provider_connection_id = ?`,
      args: [userId, connectionId],
    });

    // Without this the account rows keep showing "auth required" until the next
    // sync, because that flag is derived from bank_connections.provider_state
    // and nothing here used to refresh it. Returning from the bank is exactly
    // when it changes, so ask Powens for the new state now.
    try {
      const connRow = await db.execute({
        sql: `SELECT * FROM bank_connections
              WHERE user_id = ? AND powens_connection_id = ? AND status != 'replaced'
              ORDER BY id DESC LIMIT 1`,
        args: [userId, connectionId],
      });
      if (connRow.rows.length > 0) {
        const conn = decryptBankConn(connRow.rows[0] as any);
        for (const token of [conn.powens_token, await refreshPowensToken(conn.id)]) {
          if (!token) continue;
          const map = await fetchPowensConnectorMap(token);
          if (map.size === 0) continue;
          await persistPowensConnectionInfo(userId, map);
          break;
        }
      }
    } catch (e) {
      console.error('[bank-callback] could not refresh connection state:', e);
    }

    return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#d4a812;">✅ Bank reconnected!</h1><p>Your accounts have been refreshed.</p>
      <p style="color:#888;">Redirecting to accounts...</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a>
      <script>
        try { new BroadcastChannel('konto-bank').postMessage('reconnected'); } catch(e) {}
        setTimeout(() => { window.location.href = '/konto/accounts'; }, 1500);
      </script>
    </body></html>`);
  }

  if (!code) {
    return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">No code received</h1>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }

  try {
    const tokenRes = await fetch(`${POWENS_API}/auth/token/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: POWENS_CLIENT_ID, client_secret: POWENS_CLIENT_SECRET, code }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenRes.ok) throw new Error(tokenData.message || 'Token exchange failed');

    const accessToken = tokenData.access_token || tokenData.token;
    const refreshToken = tokenData.refresh_token || null;
    const userId = await getUserId(c);

    console.log('Powens token received:', { has_access: !!accessToken, has_refresh: !!refreshToken, expires_in: tokenData.expires_in });

    // Fetch connection details to get bank/institution info
    let providerName: string | null = null;
    let resolvedConnectionId: string | null = connectionId || null;
    try {
      const connsRes = await fetch(`${POWENS_API}/users/me/connections?expand=connector`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (connsRes.ok) {
        const connsData = await connsRes.json() as any;
        const conns = connsData.connections || [];
        // The callback's connection_id is authoritative — this token can see every
        // connection of the Powens user, so picking one from the list used to
        // attach the new token to whichever connection happened to come first.
        // Only fall back to the list when the callback gave us nothing, and then
        // take the newest connection rather than the first.
        const chosen = resolvedConnectionId
          ? conns.find((x: any) => String(x.id) === String(resolvedConnectionId))
          : conns.reduce((newest: any, x: any) => (!newest || Number(x.id) > Number(newest.id) ? x : newest), null);
        if (chosen?.id != null) {
          resolvedConnectionId = String(chosen.id);
          providerName = chosen.connector?.name || chosen.institution?.name
            || chosen.institution_name || chosen.bank_name || null;
          console.log('Powens connection details:', { connection_id: resolvedConnectionId, provider_name: providerName, from_callback: !!connectionId });
        }
      }
    } catch (err) {
      console.error('Failed to fetch connection details:', err);
    }

    if (connectionId || resolvedConnectionId) {
      const existingConnRes = await db.execute({
        sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND powens_connection_id = ? ORDER BY id DESC LIMIT 1',
        args: [userId, resolvedConnectionId],
      });
      if (existingConnRes.rows.length > 0) {
        const existingConn = decryptBankConn(existingConnRes.rows[0] as any);
        const mergedRefresh = refreshToken || existingConn.powens_refresh_token || null;
        const mergedProvider = providerName || existingConn.provider_name || null;
        await db.execute({
          sql: 'UPDATE bank_connections SET powens_token = ?, powens_refresh_token = ?, status = ?, powens_connection_id = ?, provider_name = ? WHERE id = ?',
          args: [encrypt(accessToken), encrypt(mergedRefresh), 'active', resolvedConnectionId, mergedProvider, (existingConnRes.rows[0] as any).id],
        });
        // Keep only latest active row for this Powens connection id.
        await db.execute({
          sql: 'UPDATE bank_connections SET status = ? WHERE user_id = ? AND powens_connection_id = ? AND id != ? AND status = ?',
          args: ['replaced', userId, resolvedConnectionId, (existingConnRes.rows[0] as any).id, 'active'],
        });
      } else {
        await db.execute({
          sql: 'INSERT INTO bank_connections (user_id, powens_connection_id, powens_token, powens_refresh_token, status, provider_name) VALUES (?, ?, ?, ?, ?, ?)',
          args: [userId, resolvedConnectionId, encrypt(accessToken), encrypt(refreshToken), 'active', providerName]
        });
      }
    } else {
      await db.execute({
        sql: 'INSERT INTO bank_connections (user_id, powens_connection_id, powens_token, powens_refresh_token, status, provider_name) VALUES (?, ?, ?, ?, ?, ?)',
        args: [userId, resolvedConnectionId, encrypt(accessToken), encrypt(refreshToken), 'active', providerName]
      });
    }

    let accounts: any[] = [];
    try {
      const accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      const accountsData = await accountsRes.json() as any;
      accounts = accountsData.accounts || [];
      const connectorMap = await fetchPowensConnectorMap(accessToken);
      await persistPowensConnectionInfo(userId, connectorMap);
      const excludedOnConnect = await loadExcludedProviderAccounts(userId);

      for (const acc of accounts) {
        const accType = classifyAccountType(acc.type, acc.name || acc.original_name || '');
        const accNumber = acc.number || acc.webid || null;
        const accIban = acc.iban || null;
        if (isProviderAccountExcluded(excludedOnConnect, 'powens', String(acc.id), accIban)) continue;
        const meta = extractPowensBankMeta(acc, connectorMap);
        const storedBankName = meta.bankName || null;

        // Deduplicate: find existing account by (company_id, provider, provider_account_id) or by iban
        const existingId = await findBankAccountByProviderId(userId, null, 'powens', String(acc.id), accIban);

        let bankAccountId: number;
        if (existingId === null) {
          const ins = await db.execute({
            sql: 'INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, provider_bank_id, provider_bank_name, name, bank_name, account_number, iban, balance, type, usage, subtype, last_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [userId, null, 'powens', String(acc.id), meta.bankId, meta.bankName, acc.name || acc.original_name || 'Account', storedBankName, accNumber, accIban, acc.balance || 0, accType, classifyAccountUsage(acc.usage, null), classifyAccountSubtype(accType, 'powens', acc.name || acc.original_name || ''), new Date().toISOString()]
          });
          bankAccountId = Number(ins.lastInsertRowid);
        } else {
          bankAccountId = existingId;
          // Update existing account: identifiers + metadata + balance
          await db.execute({
            sql: 'UPDATE bank_accounts SET provider_account_id = ?, provider_bank_id = ?, provider_bank_name = COALESCE(?, provider_bank_name), name = ?, bank_name = COALESCE(?, bank_name), account_number = COALESCE(?, account_number), iban = COALESCE(?, iban), type = ?, usage = ?, subtype = ?, balance = ?, last_sync = ? WHERE id = ?',
            args: [String(acc.id), meta.bankId, meta.bankName, acc.name || acc.original_name || 'Account', storedBankName, accNumber, accIban, accType, classifyAccountUsage(acc.usage, null), classifyAccountSubtype(accType, 'powens', acc.name || acc.original_name || ''), acc.balance || 0, new Date().toISOString(), bankAccountId]
          });
        }

        // Sync investments for investment accounts
        if (accType === 'investment') {
          try {
            const invRes = await fetch(`${POWENS_API}/users/me/accounts/${acc.id}/investments`, {
              headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            if (invRes.ok) {
              const invData = await invRes.json() as any;
              for (const inv of (invData.investments || [])) {
                await db.execute({
                  sql: `INSERT INTO investments (bank_account_id, provider_investment_id, label, isin_code, code_type, quantity, unit_price, unit_value, valuation, diff, diff_percent, portfolio_share, currency, vdate, last_update)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(bank_account_id, isin_code) DO UPDATE SET
                          label=excluded.label, quantity=excluded.quantity, unit_price=excluded.unit_price,
                          unit_value=excluded.unit_value, valuation=excluded.valuation, diff=excluded.diff,
                          diff_percent=excluded.diff_percent, portfolio_share=excluded.portfolio_share,
                          vdate=excluded.vdate, last_update=excluded.last_update`,
                  args: [
                    bankAccountId, String(inv.id), inv.label || 'Unknown', inv.code || null,
                    inv.code_type || 'ISIN', inv.quantity || 0, inv.unitprice || 0,
                    inv.original_unitvalue || inv.unitvalue || 0, inv.valuation || 0,
                    ...calcInvDiff(inv.original_unitvalue || inv.unitvalue || 0, inv.unitprice || 0, inv.quantity || 0, inv.diff || 0, inv.diff_percent || 0), inv.portfolio_share || 0,
                    inv.original_currency?.id || 'EUR', inv.vdate || null,
                    inv.last_update || new Date().toISOString(),
                  ]
                });
              }
              console.log(`Synced ${(invData.investments || []).length} investments for account ${acc.id}`);
            }
          } catch (e: any) {
            console.error(`Failed to sync investments for account ${acc.id}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch accounts:', e);
    }

    await persistPowensAccountConnections(userId, accounts);

    // Infer loan details from newly connected accounts (non-blocking)
    inferAndPersistLoanDetails(userId).catch(e => console.error('[bank-callback] loan inference failed:', e));

    return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#d4a812;">✅ Bank connected!</h1><p>${accounts.length} account(s) synced.</p>
      <p style="color:#888;">Redirecting to accounts...</p>
      <a href="/konto/accounts" style="color:#d4a812;font-size:18px;">← Back to Konto</a>
      <script>
        try { new BroadcastChannel('konto-bank').postMessage('reconnected'); } catch(e) {}
        setTimeout(() => { window.location.href = '/konto/accounts'; }, 2000);
      </script>
    </body></html>`);
  } catch (err: any) {
    console.error('Powens callback error:', err);
    return c.html(`<html><head><link rel="icon" href="https://konto.angelstreet.io/favicon.ico"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1><p>${err.message}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }
});

// --- Bank connections ---
router.get('/api/bank/connections', async (c) => {
  const userId = await getUserId(c);
  // One row per connection, with the PSD2 consent clock and an account to hang
  // a reconnect link on. reconnect_account_id prefers an account already
  // flagged sca_required, so the link lands where the problem is.
  const result = await db.execute({
    sql: `SELECT bc.id, bc.powens_connection_id, bc.provider_name, bc.status,
                 bc.created_at, bc.consent_expires_at, bc.provider_state,
                 bc.provider_auth_mechanism,
                 (SELECT ba.id FROM bank_accounts ba
                   WHERE ba.user_id = bc.user_id
                     AND ba.provider = 'powens'
                     AND ba.provider_connection_id = bc.powens_connection_id
                   ORDER BY ba.sca_required DESC, ba.id ASC LIMIT 1) AS reconnect_account_id,
                 (SELECT COALESCE(ba.provider_bank_name, ba.bank_name) FROM bank_accounts ba
                   WHERE ba.user_id = bc.user_id
                     AND ba.provider = 'powens'
                     AND ba.provider_connection_id = bc.powens_connection_id
                     AND COALESCE(ba.provider_bank_name, ba.bank_name) IS NOT NULL
                   ORDER BY ba.id ASC LIMIT 1) AS bank_name,
                 (SELECT COUNT(*) FROM bank_accounts ba
                   WHERE ba.user_id = bc.user_id
                     AND ba.provider = 'powens'
                     AND ba.provider_connection_id = bc.powens_connection_id) AS account_count,
                 (SELECT MAX(ba.sca_required) FROM bank_accounts ba
                   WHERE ba.user_id = bc.user_id
                     AND ba.provider = 'powens'
                     AND ba.provider_connection_id = bc.powens_connection_id) AS sca_required,
                 (SELECT MAX(ba.last_sync) FROM bank_accounts ba
                   WHERE ba.user_id = bc.user_id
                     AND ba.provider = 'powens'
                     AND ba.provider_connection_id = bc.powens_connection_id) AS last_sync
          FROM bank_connections bc
          WHERE bc.user_id = ?
          ORDER BY bc.id`,
    args: [userId]
  });
  return c.json(result.rows);
});

/**
 * What the provider actually sends us, per connection — read-only, writes
 * nothing. Uses `?all`, which includes accounts Powens omits by default
 * (disabled ones, and accounts left out of the consent), so a bank account the
 * user can see but Konto cannot is diagnosable without guessing.
 */
router.get('/api/bank/provider-accounts', async (c) => {
  const userId = await getUserId(c);
  const connsRes = await db.execute({
    sql: "SELECT * FROM bank_connections WHERE user_id = ? AND status != 'replaced'",
    args: [userId],
  });

  const out: any[] = [];
  for (const rawConn of connsRes.rows as any[]) {
    const conn = decryptBankConn(rawConn);
    let reported: any[] | null = null;
    let error: string | null = null;
    for (const token of [conn.powens_token, await refreshPowensToken(conn.id)]) {
      if (!token) continue;
      try {
        const res = await fetch(`${POWENS_API}/users/me/accounts?all`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) { error = `HTTP ${res.status}`; continue; }
        const data = await res.json() as any;
        reported = data.accounts || [];
        error = null;
        break;
      } catch (err: any) {
        error = err?.message || 'fetch failed';
      }
    }

    const known = await db.execute({
      sql: `SELECT provider_account_id FROM bank_accounts
            WHERE user_id = ? AND provider = 'powens' AND provider_connection_id = ?`,
      args: [userId, conn.powens_connection_id],
    });
    const knownIds = new Set((known.rows as any[]).map(r => String(r.provider_account_id)));

    out.push({
      connection_id: conn.powens_connection_id,
      provider_name: conn.provider_name,
      error,
      // Attribute strictly by id_connection. Defaulting a missing one to the
      // current connection made every unattributed account appear under
      // whichever connection was listed first.
      accounts: (reported || [])
        .filter((a: any) => a.id_connection != null
          && String(a.id_connection) === String(conn.powens_connection_id))
        .map((a: any) => ({
          id: a.id,
          name: a.name || a.original_name || null,
          type: a.type || null,
          disabled: a.disabled ?? null,
          deleted: a.deleted ?? null,
          balance: a.balance ?? null,
          stored_in_konto: knownIds.has(String(a.id)),
        })),
    });
  }
  return c.json(out);
});

// --- Sync all accounts ---
router.post('/api/bank/sync', async (c) => {
  const userId = await getUserId(c);
  const connections = await db.execute({ sql: "SELECT * FROM bank_connections WHERE status = ? AND user_id = ?", args: ['active', userId] });
  let totalSynced = 0;
  // Powens accounts seen this run, so the account -> connection links can be
  // written once the accounts themselves exist.
  const pendingConnectionLinks: any[] = [];
  const excludedAccounts = await loadExcludedProviderAccounts(userId);

  for (const rawConn of connections.rows as any[]) {
    const conn = decryptBankConn(rawConn);
    try {
      let token = conn.powens_token;
      if (!conn.powens_refresh_token) {
        const recoveredToken = await refreshPowensToken(conn.id);
        if (recoveredToken) token = recoveredToken;
      }
      const res = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json() as any;
      const accounts = data.accounts || [];
      const connectorMap = await fetchPowensConnectorMap(token);
      await persistPowensConnectionInfo(userId, connectorMap);
      pendingConnectionLinks.push(...accounts);

      for (const acc of accounts) {
        const meta = extractPowensBankMeta(acc, connectorMap);
        const storedBankName = meta.bankName || null;
        const accType = classifyAccountType(acc.type, acc.name || acc.original_name || '');
        const accNumber = acc.number || acc.webid || null;
        const accIban = acc.iban || null;
        if (isProviderAccountExcluded(excludedAccounts, 'powens', String(acc.id), accIban)) continue;
        // Deduplicate: find by (company_id, provider, provider_account_id) or by iban
        const existingId = await findBankAccountByProviderId(userId, null, 'powens', String(acc.id), accIban);
        let bankAccountId: number;
        if (existingId !== null) {
          const full = await db.execute({ sql: 'SELECT company_id FROM bank_accounts WHERE id = ?', args: [existingId] });
          const row = full.rows[0] as any;
          bankAccountId = existingId;
          await db.execute({
            sql: 'UPDATE bank_accounts SET provider_account_id = ?, provider_bank_id = ?, provider_bank_name = COALESCE(?, provider_bank_name), name = ?, bank_name = COALESCE(?, bank_name), account_number = COALESCE(?, account_number), iban = COALESCE(?, iban), balance = ?, last_sync = ?, type = ?, usage = ?, subtype = ? WHERE id = ?',
            args: [String(acc.id), meta.bankId, meta.bankName, acc.name || acc.original_name || 'Account', storedBankName, accNumber, accIban, acc.balance || 0, new Date().toISOString(), accType, classifyAccountUsage(acc.usage, row?.company_id || null), classifyAccountSubtype(accType, 'powens', acc.name || acc.original_name || ''), bankAccountId]
          });
        } else {
          const ins = await db.execute({
            sql: 'INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, provider_bank_id, provider_bank_name, name, bank_name, account_number, iban, balance, last_sync, type, usage, subtype) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [userId, null, 'powens', String(acc.id), meta.bankId, meta.bankName, acc.name || acc.original_name || 'Account', storedBankName, accNumber, accIban, acc.balance || 0, new Date().toISOString(), accType, classifyAccountUsage(acc.usage, null), classifyAccountSubtype(accType, 'powens', acc.name || acc.original_name || '')]
          });
          bankAccountId = Number(ins.lastInsertRowid);
        }
        // Extract loan fields from Powens for loan accounts
        if (accType === 'loan') {
          const startDate = acc.opening_date ? acc.opening_date.slice(0, 10) : null;
          const endDate = acc.maturity_date ? acc.maturity_date.slice(0, 10) : null;
          const rate = acc.rate != null ? Number(acc.rate) : null;
          const principal = acc.total_amount != null ? Math.abs(Number(acc.total_amount)) : null;
          const monthlyPayment = acc.next_payment_amount != null ? Math.abs(Number(acc.next_payment_amount)) : null;
          if (startDate || endDate || rate || principal || monthlyPayment) {
            await db.execute({
              sql: `INSERT INTO loan_details (user_id, bank_account_id, loan_type, principal_amount, start_date, end_date, interest_rate, monthly_payment, source, updated_at)
                    VALUES (?, ?, 'amortizing', ?, ?, ?, ?, ?, 'powens', datetime('now'))
                    ON CONFLICT(bank_account_id) DO UPDATE SET
                      principal_amount = COALESCE(?, loan_details.principal_amount),
                      start_date = COALESCE(?, loan_details.start_date),
                      end_date = COALESCE(?, loan_details.end_date),
                      interest_rate = COALESCE(?, loan_details.interest_rate),
                      monthly_payment = COALESCE(?, loan_details.monthly_payment),
                      source = CASE WHEN loan_details.source = 'manual' THEN 'manual' ELSE 'powens' END,
                      updated_at = datetime('now')`,
              args: [userId, bankAccountId, principal, startDate, endDate, rate, monthlyPayment,
                     principal, startDate, endDate, rate, monthlyPayment]
            });
          }
        }
        totalSynced++;
      }
    } catch (err: any) {
      console.error(`Sync failed for connection ${conn.id}:`, err.message);
    }
  }
  // Infer loan details from synced data (non-blocking)
  inferAndPersistLoanDetails(userId).catch(e => console.error('[sync] loan inference failed:', e));

  await persistPowensAccountConnections(userId, pendingConnectionLinks);
  return c.json({ synced: totalSynced });
});

// --- Dashboard ---

router.get('/api/bank/accounts', async (c) => {
  const userId = await getUserId(c);
  const usage = c.req.query('usage');
  const companyId = c.req.query('company_id');
  let where = 'user_id = ?';
  const params: any[] = [userId];
  if (usage === 'personal') {
    where += ' AND (usage = ? OR usage IS NULL) AND company_id IS NULL';
    params.push('personal');
  }
  else if (usage === 'professional') {
    where += ' AND (usage = ? OR company_id IS NOT NULL)';
    params.push('professional');
  }
  else if (companyId) { where += ' AND company_id = ?'; params.push(companyId); }
  const result = await db.execute({ sql: `SELECT * FROM bank_accounts WHERE ${where}`, args: params });

  // Check if user has any active powens connections
  const activeConns = await db.execute({
    sql: 'SELECT COUNT(*) as cnt FROM bank_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  const hasActivePowens = (activeConns.rows[0] as any).cnt > 0;

  // The bank's own verdict on each connection. An account can be syncing
  // happily on cached data while its connection already needs the user to
  // re-authenticate, so "last_sync was recent" is not evidence of health.
  const connRes = await db.execute({
    sql: `SELECT powens_connection_id, provider_state, status, consent_expires_at
          FROM bank_connections WHERE user_id = ?`,
    args: [userId],
  });
  const connState = new Map<string, any>();
  for (const row of connRes.rows as any[]) {
    if (row.powens_connection_id != null) connState.set(String(row.powens_connection_id), row);
  }

  const rows = (result.rows as any[]).map(row => {
    const conn = row.provider_connection_id != null
      ? connState.get(String(row.provider_connection_id))
      : undefined;
    const expired = row.provider === 'powens' && !hasActivePowens ? 1 : 0;
    const state = (conn?.provider_state || '').toLowerCase();
    const needsAuth = row.provider === 'powens' && (
      !!row.sca_required || !!expired || POWENS_ACTION_STATES.has(state)
    );
    return {
      ...row,
      connection_expired: expired,
      // What the UI needs to flag a row without anyone pressing sync first.
      auth_required: needsAuth ? 1 : 0,
      connection_state: conn?.provider_state ?? null,
      consent_expires_at: conn?.consent_expires_at ?? null,
    };
  });

  return c.json(rows);
});

router.patch('/api/bank/accounts/:id', async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: string[] = [];
  const params: any[] = [];

  if (body.custom_name !== undefined) { updates.push('custom_name = ?'); params.push(body.custom_name); }
  if (body.hidden !== undefined) { updates.push('hidden = ?'); params.push(body.hidden ? 1 : 0); }
  if (body.type !== undefined) { updates.push('type = ?'); params.push(body.type); }
  if (body.usage !== undefined) { updates.push('usage = ?'); params.push(body.usage); }
  if (body.subtype !== undefined) { updates.push('subtype = ?'); params.push(body.subtype); }
  if (body.balance !== undefined) { updates.push('balance = ?'); params.push(body.balance); updates.push('last_sync = ?'); params.push(new Date().toISOString()); }
  if (body.company_id !== undefined) {
    updates.push('company_id = ?'); params.push(body.company_id);
    updates.push('usage = ?'); params.push(body.company_id ? 'professional' : 'personal');
  }

  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  params.push(id, userId);
  await db.execute({ sql: `UPDATE bank_accounts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, args: params });
  const updated = await db.execute({ sql: 'SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?', args: [id, userId] });
  return c.json(updated.rows[0]);
});

router.delete('/api/bank/accounts/:id', async (c) => {
  const userId = await getUserId(c);
  const id = c.req.param('id');

  // Remember the deletion before performing it. A provider-sourced account is
  // returned by the provider on every sync, so deleting the row alone just
  // re-creates it minutes later — the deletion has to be recorded to stick.
  const accRes = await db.execute({
    sql: 'SELECT provider, provider_account_id, iban, COALESCE(custom_name, name) AS name FROM bank_accounts WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });
  const acc = accRes.rows[0] as any;
  if (acc && acc.provider && acc.provider !== 'manual' && (acc.provider_account_id || acc.iban)) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO excluded_provider_accounts (user_id, provider, provider_account_id, iban, name)
            VALUES (?, ?, ?, ?, ?)`,
      args: [userId, acc.provider, acc.provider_account_id ?? null, acc.iban ?? null, acc.name ?? null],
    });
  }

  if (!acc) return c.json({ error: 'Account not found' }, 404);

  // Children first. transactions and investments reference bank_accounts
  // without ON DELETE CASCADE, so leaving either behind fails the delete on a
  // foreign key — which is what happened to an investment account holding
  // positions: the tombstone was written and the row survived.
  await db.execute({ sql: 'DELETE FROM transactions WHERE bank_account_id = ? AND bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)', args: [id, userId] });
  await db.execute({ sql: 'DELETE FROM investments WHERE bank_account_id = ? AND bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)', args: [id, userId] });
  // An asset may point at this account as its loan; unlink rather than delete it.
  await db.execute({ sql: 'UPDATE assets SET linked_loan_account_id = NULL WHERE linked_loan_account_id = ? AND user_id = ?', args: [id, userId] });

  await db.execute({ sql: 'DELETE FROM bank_accounts WHERE id = ? AND user_id = ?', args: [id, userId] });
  return c.json({ ok: true, excluded: acc.provider !== 'manual' });
});

// What the user has deleted, and a way back — otherwise a mistaken delete is
// permanent and invisible.
router.get('/api/bank/excluded', async (c) => {
  const userId = await getUserId(c);
  const res = await db.execute({
    sql: 'SELECT id, provider, provider_account_id, iban, name, created_at FROM excluded_provider_accounts WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });
  return c.json(res.rows);
});

router.delete('/api/bank/excluded/:id', async (c) => {
  const userId = await getUserId(c);
  await db.execute({
    sql: 'DELETE FROM excluded_provider_accounts WHERE id = ? AND user_id = ?',
    args: [c.req.param('id'), userId],
  });
  // It reappears on the next sync, which is the point.
  return c.json({ ok: true });
});

// --- Transactions ---

router.post('/api/bank/accounts/:id/sync', async (c) => {
  const accountId = c.req.param('id');
  const userId = await getUserId(c);

  // Get the account details
  const accountResult = await db.execute({
    sql: 'SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?',
    args: [accountId, userId]
  });
  const account = accountResult.rows[0] as any;

  if (!account) return c.json({ error: 'Account not found' }, 404);
  if (!account.provider_account_id || account.provider !== 'powens') {
    return c.json({ error: 'Only Powens bank accounts can be synced' }, 400);
  }

  // Get all active connections for this user
  const connectionsResult = await db.execute({
    sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  const connections = (connectionsResult.rows as any[]).map(decryptBankConn);

  if (connections.length === 0) return c.json({ error: 'No active bank connections found', reconnect_required: true }, 404);

  // Find which connection owns this account
  let connectionToken: string | null = null;
  let matchedConn: any = null;
  let debugInfo: any[] = [];
  for (const conn of connections) {
    let token = conn.powens_token;

    try {
      if (!conn.powens_refresh_token) {
        const recoveredToken = await refreshPowensToken(conn.id);
        if (recoveredToken) token = recoveredToken;
      }
      let accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      // If 404/401, try to refresh token
      if (!accountsRes.ok && (accountsRes.status === 404 || accountsRes.status === 401)) {
        console.log(`Connection ${conn.id} returned ${accountsRes.status}, attempting token refresh...`);
        const refreshedToken = await refreshPowensToken(conn.id);

        if (refreshedToken) {
          token = refreshedToken;
          // Retry with refreshed token
          accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          debugInfo.push({ conn_id: conn.id, refreshed: true, new_status: accountsRes.status });
        } else {
          debugInfo.push({ conn_id: conn.id, status: accountsRes.status, refresh_failed: true });
          continue;
        }
      }

      if (!accountsRes.ok) {
        const errorText = await accountsRes.text();
        debugInfo.push({ conn_id: conn.id, status: accountsRes.status, error: errorText });
        console.error(`Connection ${conn.id} failed with status ${accountsRes.status}:`, errorText);
        continue;
      }

      const accountsData = await accountsRes.json() as any;
      const powensAccounts = accountsData.accounts || [];
      debugInfo.push({ conn_id: conn.id, account_count: powensAccounts.length, account_ids: powensAccounts.slice(0, 3).map((a: any) => a.id) });

      // Check if this connection has our account
      if (powensAccounts.some((a: any) => String(a.id) === account.provider_account_id)) {
        connectionToken = token;
        matchedConn = conn;
        break;
      }
    } catch (err: any) {
      debugInfo.push({ conn_id: conn.id, error: err.message });
      console.error(`Failed to fetch accounts for connection ${conn.id}:`, err);
      continue;
    }
  }

  if (!connectionToken) {
    console.error(`No connection found for account ${accountId} (provider_id: ${account.provider_account_id}). Debug:`, debugInfo);
    return c.json({
      error: 'Bank connection expired. Please reconnect your bank account.',
      reconnect_required: true,
      debug: { looking_for: account.provider_account_id, checked_connections: debugInfo.length }
    }, 404);
  }

  // Check Powens connection state — track SCA but don't block sync
  let connectionNeedsSCA = false;
  if (matchedConn?.powens_connection_id) {
    try {
      const connStateRes = await fetch(`${POWENS_API}/users/me/connections/${matchedConn.powens_connection_id}`, {
        headers: { 'Authorization': `Bearer ${connectionToken}` },
      });
      if (connStateRes.ok) {
        const connState = await connStateRes.json() as any;
        if (connState.state === 'SCARequired' || connState.error === 'SCARequired') {
          // Before giving up, try to silently refresh the token — refresh tokens can sometimes
          // resolve an expired-session SCARequired without the user going through the webview
          if (matchedConn.powens_refresh_token) {
            const refreshed = await refreshPowensToken(matchedConn.id);
            if (refreshed) {
              connectionToken = refreshed;
              // Re-check connection state with the fresh token
              const reCheckRes = await fetch(`${POWENS_API}/users/me/connections/${matchedConn.powens_connection_id}`, {
                headers: { 'Authorization': `Bearer ${connectionToken}` },
              });
              if (reCheckRes.ok) {
                const reState = await reCheckRes.json() as any;
                if (!reState.state || reState.state === 'active' || (!reState.error)) {
                  console.log(`Connection ${matchedConn.id} SCA resolved by token refresh`);
                  // SCA resolved — continue without flagging
                } else {
                  connectionNeedsSCA = true;
                  console.log(`Connection ${matchedConn.id} still needs SCA after token refresh`);
                }
              } else {
                connectionNeedsSCA = true;
              }
            } else {
              connectionNeedsSCA = true;
              console.log(`Connection ${matchedConn.id} (powens ${matchedConn.powens_connection_id}) needs SCA — will sync cached data`);
            }
          } else {
            connectionNeedsSCA = true;
            console.log(`Connection ${matchedConn.id} (powens ${matchedConn.powens_connection_id}) needs SCA — will sync cached data`);
          }
        } else if (connState.error && connState.error !== 'SCARequired') {
          // Real errors like wrongpass — but first try refresh token before forcing reconnect
          if (matchedConn.powens_refresh_token) {
            const refreshed = await refreshPowensToken(matchedConn.id);
            if (refreshed) {
              connectionToken = refreshed;
              console.log(`Connection ${matchedConn.id} error '${connState.error}' resolved by token refresh`);
            } else {
              console.log(`Connection ${matchedConn.id} has error: ${connState.error} — requires reconnect`);
              return c.json({ error: `Bank connection error: ${connState.error}`, reconnect_required: true }, 400);
            }
          } else {
            console.log(`Connection ${matchedConn.id} has error: ${connState.error} — requires reconnect`);
            return c.json({ error: `Bank connection error: ${connState.error}`, reconnect_required: true }, 400);
          }
        }
      }
    } catch (err: any) {
      console.error(`Failed to check connection state:`, err.message);
    }
  }

  try {
    // Also update balance + loan details from Powens account data
    try {
      const accDataRes = await fetch(`${POWENS_API}/users/me/accounts/${account.provider_account_id}`, {
        headers: { 'Authorization': `Bearer ${connectionToken}` },
      });
      if (accDataRes.ok) {
        const accData = await accDataRes.json() as any;
        if (accData.balance !== undefined) {
          await db.execute({
            sql: 'UPDATE bank_accounts SET balance = ? WHERE id = ?',
            args: [accData.balance, account.id]
          });
        }
        // Extract loan-specific fields Powens provides for loan accounts
        if (account.type === 'loan') {
          const startDate = accData.opening_date ? accData.opening_date.slice(0, 10) : null;
          const endDate = accData.maturity_date ? accData.maturity_date.slice(0, 10) : null;
          const rate = accData.rate != null ? Number(accData.rate) : null;
          const principal = accData.total_amount != null ? Math.abs(Number(accData.total_amount)) : null;
          const monthlyPayment = accData.next_payment_amount != null ? Math.abs(Number(accData.next_payment_amount)) : null;
          const hasAnyField = startDate || endDate || rate || principal || monthlyPayment;
          if (hasAnyField) {
            console.log(`Loan ${account.id} Powens fields: start=${startDate} end=${endDate} rate=${rate} principal=${principal} payment=${monthlyPayment}`);
            await db.execute({
              sql: `INSERT INTO loan_details (user_id, bank_account_id, loan_type, principal_amount, start_date, end_date, interest_rate, monthly_payment, source, updated_at)
                    VALUES (?, ?, 'amortizing', ?, ?, ?, ?, ?, 'powens', datetime('now'))
                    ON CONFLICT(bank_account_id) DO UPDATE SET
                      principal_amount = COALESCE(?, loan_details.principal_amount),
                      start_date = COALESCE(?, loan_details.start_date),
                      end_date = COALESCE(?, loan_details.end_date),
                      interest_rate = COALESCE(?, loan_details.interest_rate),
                      monthly_payment = COALESCE(?, loan_details.monthly_payment),
                      source = CASE WHEN loan_details.source = 'manual' THEN 'manual' ELSE 'powens' END,
                      updated_at = datetime('now')`,
              args: [
                account.user_id, account.id, principal, startDate, endDate, rate, monthlyPayment,
                principal, startDate, endDate, rate, monthlyPayment
              ]
            });
          }
        }
      }
    } catch {}

    // Fetch all available transactions — no date limit, paginate until bank returns nothing
    let allTransactions: any[] = [];
    let txOffset = 0;
    const txPageSize = 500;
    let firstPageRes: Response | null = null;
    while (true) {
      const txPageRes = await fetch(
        `${POWENS_API}/users/me/accounts/${account.provider_account_id}/transactions?limit=${txPageSize}&offset=${txOffset}`,
        { headers: { 'Authorization': `Bearer ${connectionToken}` } }
      );
      if (txOffset === 0) firstPageRes = txPageRes;
      if (!txPageRes.ok) break;
      const pageData = await txPageRes.json() as any;
      const pageTxs = pageData.transactions || [];
      allTransactions = allTransactions.concat(pageTxs);
      if (pageTxs.length < txPageSize) break;
      txOffset += txPageSize;
    }
    const transactions = allTransactions;
    console.log(`Sync account ${accountId}: provider_id=${account.provider_account_id}, powens_status=${firstPageRes?.status}, tx_count=${transactions.length}, sca=${connectionNeedsSCA}`);

    // If Powens returns an error but we know it's SCA — don't fail, just use whatever cached data we got
    if (firstPageRes && !firstPageRes.ok && !connectionNeedsSCA) {
      return c.json({
        error: 'Bank sync failed',
        reconnect_required: true,
        debug: { powens_status: firstPageRes.status, provider_account_id: account.provider_account_id }
      }, 502);
    }

    for (const tx of transactions) {
      const baseLabel = (tx.original_wording || tx.wording || '').trim();
      const fallbackKey = `${account.id}|${tx.date || tx.rdate}|${tx.value}|${baseLabel}`;
      const txHash = tx.id ? `powens_${tx.id}` : `powens_f_${sha256(fallbackKey).slice(0, 20)}`;
      await db.execute({
        sql: `INSERT INTO transactions (bank_account_id, date, amount, label, category, tx_hash)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(bank_account_id, tx_hash) DO UPDATE SET
                date=excluded.date, amount=excluded.amount, label=excluded.label, category=excluded.category`,
        args: [account.id, tx.date || tx.rdate, tx.value, tx.original_wording || tx.wording, tx.category?.name || null, txHash]
      });
    }

    // For investment accounts, also fetch investment positions
    let investmentsSynced = 0;
    if (account.type === 'investment') {
      try {
        const invRes = await fetch(`${POWENS_API}/users/me/accounts/${account.provider_account_id}/investments`, {
          headers: { 'Authorization': `Bearer ${connectionToken}` },
        });
        if (invRes.ok) {
          const invData = await invRes.json() as any;
          const investments = invData.investments || [];
          for (const inv of investments) {
            await db.execute({
              sql: `INSERT INTO investments (bank_account_id, provider_investment_id, label, isin_code, code_type, quantity, unit_price, unit_value, valuation, diff, diff_percent, portfolio_share, currency, vdate, last_update)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(bank_account_id, isin_code) DO UPDATE SET
                      label=excluded.label, quantity=excluded.quantity, unit_price=excluded.unit_price,
                      unit_value=excluded.unit_value, valuation=excluded.valuation, diff=excluded.diff,
                      diff_percent=excluded.diff_percent, portfolio_share=excluded.portfolio_share,
                      vdate=excluded.vdate, last_update=excluded.last_update`,
              args: [
                account.id,
                String(inv.id),
                inv.label || 'Unknown',
                inv.code || null,
                inv.code_type || 'ISIN',
                inv.quantity || 0,
                inv.unitprice || 0,
                inv.original_unitvalue || inv.unitvalue || 0,
                inv.valuation || 0,
                ...calcInvDiff(inv.original_unitvalue || inv.unitvalue || 0, inv.unitprice || 0, inv.quantity || 0, inv.diff || 0, inv.diff_percent || 0),
                inv.portfolio_share || 0,
                inv.original_currency?.id || 'EUR',
                inv.vdate || null,
                inv.last_update || new Date().toISOString(),
              ]
            });
          }
          investmentsSynced = investments.length;
          console.log(`Synced ${investments.length} investments for account ${accountId}`);
        }
      } catch (err: any) {
        console.error(`Failed to sync investments for account ${accountId}:`, err.message);
      }
    }

    await db.execute({
      sql: 'UPDATE bank_accounts SET last_sync = ?, sca_required = ? WHERE id = ?',
      args: [new Date().toISOString(), connectionNeedsSCA ? 1 : 0, account.id]
    });

    // When reconnect succeeds (no SCA), clear the flag on all sibling accounts sharing the same connection
    if (!connectionNeedsSCA && matchedConn?.powens_connection_id) {
      await db.execute({
        sql: `UPDATE bank_accounts SET sca_required = 0
              WHERE user_id = ? AND provider = 'powens' AND sca_required = 1 AND id != ?`,
        args: [account.user_id, account.id],
      });
    }

    return c.json({
      synced: transactions.length,
      investments_synced: investmentsSynced,
      sca_required: connectionNeedsSCA,
    });
  } catch (err: any) {
    console.error(`Sync error for account ${accountId}:`, err.message);
    return c.json({ error: err.message }, 500);
  }
});

// --- Sync all accounts at once (background-friendly) ---
router.post('/api/bank/sync-all', async (c) => {
  const userId = await getUserId(c);

  // Get all active connections
  const connectionsResult = await db.execute({
    sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  const connections = (connectionsResult.rows as any[]).map(decryptBankConn);
  if (connections.length === 0) return c.json({ error: 'No active connections', synced: 0 });

  let totalSynced = 0;
  let totalInvestments = 0;
  let scaConnections: number[] = [];
  let errors = 0;
  const pendingConnectionLinks: any[] = [];
  const excludedAccounts = await loadExcludedProviderAccounts(userId);

  for (const conn of connections) {
    let token = conn.powens_token;

    try {
      if (!conn.powens_refresh_token) {
        const recoveredToken = await refreshPowensToken(conn.id);
        if (recoveredToken) token = recoveredToken;
      }
      // Fetch accounts visible to this connection
      let accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!accountsRes.ok) {
        // Try refresh
        const refreshedToken = await refreshPowensToken(conn.id);
        if (!refreshedToken) { errors++; continue; }
        token = refreshedToken;
        accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!accountsRes.ok) { errors++; continue; }
      }
      const accountsData = await accountsRes.json() as any;
      const powensAccounts = accountsData.accounts || [];

      // Check connection state for SCA
      let isSCA = false;
      if (conn.powens_connection_id) {
        try {
          const stateRes = await fetch(`${POWENS_API}/users/me/connections/${conn.powens_connection_id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (stateRes.ok) {
            const state = await stateRes.json() as any;
            if (state.state === 'SCARequired' || state.error === 'SCARequired') {
              isSCA = true;
              scaConnections.push(conn.powens_connection_id);
            }
          }
        } catch {}
      }

      // Sync each account
      const connProviderName = conn.provider_name || null;
      const connectorMap = await fetchPowensConnectorMap(token);
      await persistPowensConnectionInfo(userId, connectorMap);
      pendingConnectionLinks.push(...powensAccounts);
      for (const powensAcc of powensAccounts) {
        const providerId = String(powensAcc.id);
        if (isProviderAccountExcluded(excludedAccounts, 'powens', providerId, powensAcc.iban || null)) continue;
        const meta = extractPowensBankMeta(powensAcc, connectorMap);
        // Use connection's provider_name as fallback when Powens doesn't return bank info in account response
        const bankNameFromMeta = meta.bankName || connProviderName;
        const storedBankName = bankNameFromMeta || null;
        const accType = classifyAccountType(powensAcc.type, powensAcc.name || powensAcc.original_name || '');
        // Deduplicate: try by provider_account_id first, then by iban
        let accRes = await db.execute({
          sql: 'SELECT id, type, company_id FROM bank_accounts WHERE user_id = ? AND provider = ? AND provider_account_id = ?',
          args: [userId, 'powens', providerId]
        });
        if (accRes.rows.length === 0 && powensAcc.iban) {
          accRes = await db.execute({
            sql: 'SELECT id, type, company_id FROM bank_accounts WHERE user_id = ? AND provider = ? AND iban = ?',
            args: [userId, 'powens', powensAcc.iban]
          });
        }
        if (accRes.rows.length === 0) continue;
        const localAcc = accRes.rows[0] as any;

        // Update balance
        if (powensAcc.balance !== undefined) {
          await db.execute({
            sql: 'UPDATE bank_accounts SET provider_bank_id = ?, provider_bank_name = COALESCE(?, provider_bank_name), name = ?, bank_name = COALESCE(?, bank_name), account_number = COALESCE(?, account_number), iban = COALESCE(?, iban), type = ?, usage = ?, subtype = ?, balance = ?, last_sync = ? WHERE id = ?',
            args: [meta.bankId, meta.bankName, powensAcc.name || powensAcc.original_name || 'Account', storedBankName, powensAcc.number || powensAcc.webid || null, powensAcc.iban || null, accType, classifyAccountUsage(powensAcc.usage, localAcc.company_id || null), classifyAccountSubtype(accType, 'powens', powensAcc.name || powensAcc.original_name || ''), powensAcc.balance, new Date().toISOString(), localAcc.id]
          });
        }

        // Fetch all transactions with pagination — no date limit, take everything the bank provides
        try {
          let bulkAll: any[] = [], bulkOffset = 0;
          while (true) {
            const bRes = await fetch(
              `${POWENS_API}/users/me/accounts/${providerId}/transactions?limit=500&offset=${bulkOffset}`,
              { headers: { 'Authorization': `Bearer ${token}` } }
            );
            if (!bRes.ok) break;
            const bData = await bRes.json() as any;
            const bTxs = bData.transactions || [];
            bulkAll = bulkAll.concat(bTxs);
            if (bTxs.length < 500) break;
            bulkOffset += 500;
          }
          for (const tx of bulkAll) {
            const txHash = tx.id ? `powens_${tx.id}` : null;
            await db.execute({
              sql: `INSERT INTO transactions (bank_account_id, date, amount, label, category, tx_hash)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(bank_account_id, tx_hash) DO UPDATE SET
                      date=excluded.date, amount=excluded.amount, label=excluded.label, category=excluded.category`,
              args: [localAcc.id, tx.date || tx.rdate, tx.value, tx.original_wording || tx.wording, tx.category?.name || null, txHash]
            });
          }
          totalSynced += bulkAll.length;
        } catch {}

        // Fetch investments for investment accounts
        if (localAcc.type === 'investment') {
          try {
            const invRes = await fetch(`${POWENS_API}/users/me/accounts/${providerId}/investments`, {
              headers: { 'Authorization': `Bearer ${token}` },
            });
            if (invRes.ok) {
              const invData = await invRes.json() as any;
              for (const inv of (invData.investments || [])) {
                await db.execute({
                  sql: `INSERT INTO investments (bank_account_id, provider_investment_id, label, isin_code, code_type, quantity, unit_price, unit_value, valuation, diff, diff_percent, portfolio_share, currency, vdate, last_update)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(bank_account_id, isin_code) DO UPDATE SET
                          label=excluded.label, quantity=excluded.quantity, unit_price=excluded.unit_price,
                          unit_value=excluded.unit_value, valuation=excluded.valuation, diff=excluded.diff,
                          diff_percent=excluded.diff_percent, portfolio_share=excluded.portfolio_share,
                          vdate=excluded.vdate, last_update=excluded.last_update`,
                  args: [localAcc.id, String(inv.id), inv.label || 'Unknown', inv.code || null, inv.code_type || 'ISIN',
                    inv.quantity || 0, inv.unitprice || 0, inv.original_unitvalue || inv.unitvalue || 0,
                    inv.valuation || 0, ...calcInvDiff(inv.original_unitvalue || inv.unitvalue || 0, inv.unitprice || 0, inv.quantity || 0, inv.diff || 0, inv.diff_percent || 0), inv.portfolio_share || 0,
                    inv.original_currency?.id || 'EUR', inv.vdate || null, inv.last_update || new Date().toISOString()]
                });
              }
              totalInvestments += (invData.investments || []).length;
            }
          } catch {}
        }
      }
    } catch (err: any) {
      console.error(`Sync-all error for connection ${conn.id}:`, err.message);
      errors++;
    }
  }

  await persistPowensAccountConnections(userId, pendingConnectionLinks);

  console.log(`Sync-all complete: ${totalSynced} tx, ${totalInvestments} investments, ${scaConnections.length} SCA, ${errors} errors`);
  return c.json({
    synced: totalSynced,
    investments_synced: totalInvestments,
    sca_connections: scaConnections,
    errors,
  });
});



// Migration: backfill bank info for existing connections
router.post("/api/bank/migrate-connection-info", async (c) => {
  try {
    console.log("[migrate] Starting migration");
    const userId = await getUserId(c);
    console.log("[migrate] userId:", userId);
    const connectionsResult = await db.execute({
      sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ? AND provider_name IS NULL',
      args: [userId, 'active']
    });
    console.log("[migrate] connections found:", connectionsResult.rows.length);
    const connections = (connectionsResult.rows as any[]).map(decryptBankConn);

  let updated = 0;
  for (const conn of connections) {
    if (!conn.powens_token) continue;
    try {
      // Fetch connections to get bank info
      const connsRes = await fetch(`${POWENS_API}/users/me/connections`, {
        headers: { 'Authorization': `Bearer ${conn.powens_token}` },
      });
      if (!connsRes.ok) continue;
      const connsData = await connsRes.json() as any;
      const conns = connsData.connections || [];
      if (conns.length > 0) {
        const connData = conns[0];
        const providerName = connData.institution?.name || connData.institution_name || connData.bank_name || null;
        const connId = String(connData.id);
        await db.execute({
          sql: 'UPDATE bank_connections SET powens_connection_id = ?, provider_name = ? WHERE id = ?',
          args: [connId, providerName, conn.id]
        });
        updated++;
        console.log(`Migrated connection ${conn.id}: ${connId} -> ${providerName}`);
      }
    } catch (err) {
      console.error(`Migration failed for connection ${conn.id}:`, err);
    }
  }

  // Also backfill bank_accounts with provider_bank_name from connection
  const accountsResult = await db.execute({
    sql: `SELECT ba.*, bc.provider_name FROM bank_accounts ba 
          JOIN bank_connections bc ON bc.user_id = ba.user_id AND bc.status = 'active'
          WHERE ba.user_id = ? AND ba.provider = 'powens' AND (ba.provider_bank_name IS NULL OR ba.provider_bank_name = '')`,
    args: [userId]
  });
  let accountsUpdated = 0;
  for (const acc of accountsResult.rows as any[]) {
    if (acc.provider_name) {
      await db.execute({
        sql: 'UPDATE bank_accounts SET provider_bank_name = ? WHERE id = ?',
        args: [acc.provider_name, acc.id]
      });
      accountsUpdated++;
    }
  }

    return c.json({ connections_updated: updated, accounts_updated: accountsUpdated });
  } catch (err: any) {
    console.error('[migrate] Error:', err);
    return c.json({ error: err.message }, 500);
  }
});

export default router;
