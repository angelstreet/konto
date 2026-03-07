import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';
import { categorizeTransaction } from '../categorizer.js';

const router = new Hono();


router.get('/api/bank/connect-url', (c) => {
  const url = `https://webview.powens.com/connect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  return c.json({ url });
});

// Powens webview wrapper — forces light mode so QR codes remain scannable
router.get('/api/bank/webview', (c) => {
  const target = c.req.query('url');
  if (!target || !target.startsWith('https://webview.powens.com/')) {
    return c.text('Invalid URL', 400);
  }
  return c.html(`<!DOCTYPE html>
<html style="color-scheme:light only">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light only">
  <title>Bank Connection</title>
  <style>
    *{margin:0;padding:0}
    html,body{height:100%;background:#fff;color-scheme:light only}
    iframe{width:100%;height:100%;border:none}
    @media(prefers-color-scheme:dark){html,body{background:#fff;color:#000}}
  </style>
</head>
<body><iframe src="${target.replace(/"/g, '&quot;')}"></iframe></body>
</html>`);
});

// Reconnect a specific SCA-blocked connection
router.get('/api/bank/reconnect-url/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
  const userId = await getUserId(c);

  const accRes = await db.execute({
    sql: 'SELECT provider_account_id FROM bank_accounts WHERE id = ? AND user_id = ?',
    args: [accountId, userId]
  });
  if (accRes.rows.length === 0) return c.json({ error: 'Account not found' }, 404);
  const providerAccountId = (accRes.rows[0] as any).provider_account_id;

  // Find which connection owns this account
  const connsRes = await db.execute({
    sql: 'SELECT * FROM bank_connections WHERE user_id = ? AND status = ?',
    args: [userId, 'active']
  });
  for (const rawConn of connsRes.rows as any[]) {
    const conn = decryptBankConn(rawConn);
    try {
      const accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${conn.powens_token}` },
      });
      if (!accountsRes.ok) continue;
      const data = await accountsRes.json() as any;
      if ((data.accounts || []).some((a: any) => String(a.id) === providerAccountId)) {
        // Generate a temporary code for the webview
        const codeRes = await fetch(`${POWENS_API}/auth/token/code`, {
          headers: { 'Authorization': `Bearer ${conn.powens_token}` },
        });
        if (!codeRes.ok) {
          // Fallback: use token directly
          const url = `https://webview.powens.com/reconnect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&connection_id=${conn.powens_connection_id}&token=${conn.powens_token}`;
          return c.json({ url, connection_id: conn.powens_connection_id });
        }
        const codeData = await codeRes.json() as any;
        const url = `https://webview.powens.com/reconnect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&connection_id=${conn.powens_connection_id}&code=${codeData.code}`;
        return c.json({ url, connection_id: conn.powens_connection_id });
      }
    } catch {}
  }

  // Fallback to generic connect
  const url = `https://webview.powens.com/connect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  return c.json({ url });
});

// --- Powens: OAuth callback ---
router.get('/api/bank-callback', async (c) => {
  const code = c.req.query('code');
  const connectionId = c.req.query('connection_id');
  const error = c.req.query('error');

  if (error) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Connection failed</h1><p>${error}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }
  if (!code) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
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
      const connsRes = await fetch(`${POWENS_API}/users/me/connections`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (connsRes.ok) {
        const connsData = await connsRes.json() as any;
        const conns = connsData.connections || [];
        if (conns.length > 0) {
          // Use first connection (most recent)
          const conn = conns[0];
          resolvedConnectionId = String(conn.id);
          providerName = conn.institution?.name || conn.institution_name || conn.bank_name || null;
          console.log('Powens connection details:', { connection_id: resolvedConnectionId, provider_name: providerName });
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

      for (const acc of accounts) {
        const accType = classifyAccountType(acc.type, acc.name || acc.original_name || '');
        const accNumber = acc.number || acc.webid || null;
        const accIban = acc.iban || null;
        const meta = extractPowensBankMeta(acc);
        const storedBankName = meta.bankName || null;

        // Match existing account by: 1) same provider_account_id, 2) same iban, 3) same account_number
        let existing = await db.execute({ sql: 'SELECT id FROM bank_accounts WHERE provider_account_id = ?', args: [String(acc.id)] });
        if (existing.rows.length === 0 && accIban) {
          existing = await db.execute({ sql: 'SELECT id FROM bank_accounts WHERE user_id = ? AND provider = ? AND iban = ?', args: [userId, 'powens', accIban] });
        }
        if (existing.rows.length === 0 && accNumber) {
          existing = await db.execute({ sql: 'SELECT id FROM bank_accounts WHERE user_id = ? AND provider = ? AND account_number = ?', args: [userId, 'powens', accNumber] });
        }

        let bankAccountId: number;
        if (existing.rows.length === 0) {
          const ins = await db.execute({
            sql: 'INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, provider_bank_id, provider_bank_name, name, bank_name, account_number, iban, balance, type, usage, subtype, last_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [userId, null, 'powens', String(acc.id), meta.bankId, meta.bankName, acc.name || acc.original_name || 'Account', storedBankName, accNumber, accIban, acc.balance || 0, accType, classifyAccountUsage(acc.usage, null), classifyAccountSubtype(accType, 'powens', acc.name || acc.original_name || ''), new Date().toISOString()]
          });
          bankAccountId = Number(ins.lastInsertRowid);
        } else {
          bankAccountId = (existing.rows[0] as any).id;
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

    return c.html(`<html><head><meta http-equiv="refresh" content="15;url=/konto/accounts"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#d4a812;">✅ Bank connected!</h1><p>${accounts.length} account(s) synced.</p>
      <p style="color:#888;font-size:14px;">Redirecting in <span id="t">15</span>s...</p>
      <a href="/konto/accounts" style="color:#d4a812;font-size:18px;">← Back to Konto</a>
      <script>let s=15;setInterval(()=>{s--;if(s>=0)document.getElementById('t').textContent=s;},1000);</script>
    </body></html>`);
  } catch (err: any) {
    console.error('Powens callback error:', err);
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1><p>${err.message}</p>
      <a href="/konto/accounts" style="color:#d4a812;">← Back to Konto</a></body></html>`);
  }
});

// --- Bank connections ---
router.get('/api/bank/connections', async (c) => {
  const userId = await getUserId(c);
  const result = await db.execute({ sql: 'SELECT * FROM bank_connections WHERE user_id = ?', args: [userId] });
  return c.json(result.rows);
});

// --- Sync all accounts ---
router.post('/api/bank/sync', async (c) => {
  const userId = await getUserId(c);
  const connections = await db.execute({ sql: "SELECT * FROM bank_connections WHERE status = ? AND user_id = ?", args: ['active', userId] });
  let totalSynced = 0;

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

      for (const acc of accounts) {
        const meta = extractPowensBankMeta(acc);
        const storedBankName = meta.bankName || null;
        const accType = classifyAccountType(acc.type, acc.name || acc.original_name || '');
        const existing = await db.execute({ sql: 'SELECT id FROM bank_accounts WHERE provider_account_id = ?', args: [String(acc.id)] });
        if (existing.rows.length > 0) {
          const full = await db.execute({ sql: 'SELECT company_id FROM bank_accounts WHERE id = ?', args: [existing.rows[0].id as number] });
          const row = full.rows[0] as any;
          await db.execute({
            sql: 'UPDATE bank_accounts SET provider_bank_id = ?, provider_bank_name = COALESCE(?, provider_bank_name), name = ?, bank_name = COALESCE(?, bank_name), account_number = COALESCE(?, account_number), iban = COALESCE(?, iban), balance = ?, last_sync = ?, type = ?, usage = ?, subtype = ? WHERE id = ?',
            args: [meta.bankId, meta.bankName, acc.name || acc.original_name || 'Account', storedBankName, acc.number || acc.webid || null, acc.iban || null, acc.balance || 0, new Date().toISOString(), accType, classifyAccountUsage(acc.usage, row?.company_id || null), classifyAccountSubtype(accType, 'powens', acc.name || acc.original_name || ''), existing.rows[0].id as number]
          });
        } else {
          await db.execute({
            sql: 'INSERT INTO bank_accounts (user_id, company_id, provider, provider_account_id, provider_bank_id, provider_bank_name, name, bank_name, account_number, iban, balance, last_sync, type, usage, subtype) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            args: [userId, null, 'powens', String(acc.id), meta.bankId, meta.bankName, acc.name || acc.original_name || 'Account', storedBankName, acc.number || acc.webid || null, acc.iban || null, acc.balance || 0, new Date().toISOString(), accType, classifyAccountUsage(acc.usage, null), classifyAccountSubtype(accType, 'powens', acc.name || acc.original_name || '')]
          });
        }
        totalSynced++;
      }
    } catch (err: any) {
      console.error(`Sync failed for connection ${conn.id}:`, err.message);
    }
  }
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

  const rows = (result.rows as any[]).map(row => ({
    ...row,
    connection_expired: row.provider === 'powens' && !hasActivePowens ? 1 : 0
  }));

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
  await db.execute({ sql: 'DELETE FROM transactions WHERE bank_account_id = ? AND bank_account_id IN (SELECT id FROM bank_accounts WHERE user_id = ?)', args: [id, userId] });
  await db.execute({ sql: 'DELETE FROM bank_accounts WHERE id = ? AND user_id = ?', args: [id, userId] });
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
          connectionNeedsSCA = true;
          console.log(`Connection ${matchedConn.id} (powens ${matchedConn.powens_connection_id}) needs SCA — will sync cached data`);
        } else if (connState.error && connState.error !== 'SCARequired') {
          // Real errors like wrongpass — require reconnect
          console.log(`Connection ${matchedConn.id} has error: ${connState.error} — requires reconnect`);
          return c.json({
            error: `Bank connection error: ${connState.error}`,
            reconnect_required: true,
          }, 400);
        }
      }
    } catch (err: any) {
      console.error(`Failed to check connection state:`, err.message);
    }
  }

  try {
    // Also update balance from Powens account data
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
      for (const powensAcc of powensAccounts) {
        const providerId = String(powensAcc.id);
        const meta = extractPowensBankMeta(powensAcc);
        // Use connection's provider_name as fallback when Powens doesn't return bank info in account response
        const bankNameFromMeta = meta.bankName || connProviderName;
        const storedBankName = bankNameFromMeta || null;
        const accType = classifyAccountType(powensAcc.type, powensAcc.name || powensAcc.original_name || '');
        const accRes = await db.execute({
          sql: 'SELECT id, type, company_id FROM bank_accounts WHERE user_id = ? AND provider = ? AND provider_account_id = ?',
          args: [userId, 'powens', providerId]
        });
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
