import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import db from './db.js';

const app = new Hono();

app.use('/*', cors());

// --- Config ---
const POWENS_CLIENT_ID = process.env.POWENS_CLIENT_ID || '91825215';
const POWENS_CLIENT_SECRET = process.env.POWENS_CLIENT_SECRET || '';
const POWENS_DOMAIN = process.env.POWENS_DOMAIN || 'kompta-sandbox.biapi.pro';
const POWENS_API = `https://${POWENS_DOMAIN}/2.0`;
const REDIRECT_URI = process.env.POWENS_REDIRECT_URI || 'https://65.108.14.251:8080/kompta/api/bank-callback';

// --- Account classification helpers ---
function classifyAccountType(powensType: number | undefined, name: string): string {
  if (powensType === 2) return 'savings';
  if (powensType === 4) return 'loan';
  if (powensType === 1) return 'checking';
  const lower = (name || '').toLowerCase();
  if (lower.includes('livret') || lower.includes('épargne') || lower.includes('epargne') || lower.includes('pea') || lower.includes('ldd')) return 'savings';
  if (lower.includes('prêt') || lower.includes('pret') || lower.includes('crédit') || lower.includes('credit') || lower.includes('loan')) return 'loan';
  return 'checking';
}

function classifyAccountUsage(companyId: number | null): string {
  return companyId ? 'professional' : 'personal';
}

// --- Health ---
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// --- Users ---
app.get('/api/users', (c) => {
  const users = db.prepare('SELECT * FROM users').all();
  return c.json(users);
});

// Ensure a default user exists (MVP)
function ensureDefaultUser(): number {
  let user = db.prepare('SELECT id FROM users WHERE email = ?').get('jo@kompta.fr') as any;
  if (!user) {
    const result = db.prepare('INSERT INTO users (email, name, role) VALUES (?, ?, ?)').run('jo@kompta.fr', 'Jo', 'admin');
    return result.lastInsertRowid as number;
  }
  return user.id;
}

// --- Companies ---
app.get('/api/companies', (c) => {
  const userId = ensureDefaultUser();
  const companies = db.prepare('SELECT * FROM companies WHERE user_id = ?').all(userId);
  return c.json(companies);
});

app.post('/api/companies', async (c) => {
  const userId = ensureDefaultUser();
  const body = await c.req.json();
  const result = db.prepare(
    'INSERT INTO companies (user_id, name, siren, legal_form, address, naf_code, capital) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, body.name, body.siren || null, body.legal_form || null, body.address || null, body.naf_code || null, body.capital || null);
  return c.json({ id: result.lastInsertRowid, ...body });
});

// Update company
app.patch('/api/companies/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const fields = ['name', 'siren', 'legal_form', 'address', 'naf_code', 'capital'];
  const updates: string[] = [];
  const params: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = ?`); params.push(body[f]); }
  }
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  params.push(id);
  db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
  return c.json(updated);
});

// Delete company
app.delete('/api/companies/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('UPDATE bank_accounts SET company_id = NULL, usage = \'personal\' WHERE company_id = ?').run(id);
  db.prepare('DELETE FROM companies WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// Unlink all accounts from a company
app.post('/api/companies/:id/unlink-all', (c) => {
  const id = c.req.param('id');
  db.prepare('UPDATE bank_accounts SET company_id = NULL, usage = \'personal\' WHERE company_id = ?').run(id);
  return c.json({ ok: true });
});

// --- Company search (API Recherche Entreprises - gouv.fr, free, no key) ---
app.get('/api/companies/search', async (c) => {
  const q = c.req.query('q');
  if (!q || q.length < 2) return c.json({ results: [] });
  try {
    const res = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(q)}&page=1&per_page=5`);
    const data = await res.json() as any;
    const results = (data.results || []).map((r: any) => {
      const latestFinances = r.finances ? Object.entries(r.finances).sort(([a]: any, [b]: any) => b - a)[0] : null;
      return {
        siren: r.siren,
        name: r.nom_complet,
        siret: r.siege?.siret,
        naf_code: r.activite_principale,
        address: r.siege?.adresse,
        date_creation: r.date_creation,
        legal_form: r.nature_juridique,
        commune: r.siege?.libelle_commune,
        code_postal: r.siege?.code_postal,
        categorie: r.categorie_entreprise,
        etat: r.siege?.etat_administratif === 'A' ? 'active' : 'fermée',
        dirigeants: (r.dirigeants || []).slice(0, 3).map((d: any) => ({
          nom: `${d.prenoms || ''} ${d.nom || ''}`.trim(),
          qualite: d.qualite,
        })),
        finances: latestFinances ? {
          year: latestFinances[0],
          ca: (latestFinances[1] as any)?.ca,
          resultat_net: (latestFinances[1] as any)?.resultat_net,
        } : null,
        effectif: r.tranche_effectif_salarie,
      };
    });
    return c.json({ results });
  } catch (err: any) {
    return c.json({ results: [], error: err.message });
  }
});

// --- Powens: Get connect URL ---
app.get('/api/bank/connect-url', (c) => {
  const url = `https://webview.powens.com/connect?domain=${POWENS_DOMAIN}&client_id=${POWENS_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
  return c.json({ url });
});

// --- Powens: OAuth callback ---
app.get('/api/bank-callback', async (c) => {
  const code = c.req.query('code');
  const connectionId = c.req.query('connection_id');
  const error = c.req.query('error');

  if (error) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Connection failed</h1>
      <p>${error}</p>
      <a href="/kompta/accounts" style="color:#d4a812;">← Back to Kompta</a>
    </body></html>`);
  }

  if (!code) {
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">No code received</h1>
      <a href="/kompta/accounts" style="color:#d4a812;">← Back to Kompta</a>
    </body></html>`);
  }

  try {
    // Exchange code for permanent token
    const tokenRes = await fetch(`${POWENS_API}/auth/token/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: POWENS_CLIENT_ID,
        client_secret: POWENS_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenRes.ok) {
      throw new Error(tokenData.message || 'Token exchange failed');
    }

    const accessToken = tokenData.access_token || tokenData.token;
    const userId = ensureDefaultUser();

    // Save the bank connection
    db.prepare(
      'INSERT INTO bank_connections (user_id, powens_connection_id, powens_token, status) VALUES (?, ?, ?, ?)'
    ).run(userId, connectionId || null, accessToken, 'active');

    // Try to fetch accounts from Powens
    let accounts: any[] = [];
    try {
      const accountsRes = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      const accountsData = await accountsRes.json() as any;
      accounts = accountsData.accounts || [];

      // Save accounts to DB (link to first company or none)
      const company = db.prepare('SELECT id FROM companies WHERE user_id = ? LIMIT 1').get(userId) as any;
      for (const acc of accounts) {
        const existing = db.prepare('SELECT id FROM bank_accounts WHERE provider_account_id = ?').get(String(acc.id));
        if (!existing) {
          const companyId = company?.id || null;
          db.prepare(
            'INSERT INTO bank_accounts (company_id, provider, provider_account_id, name, bank_name, account_number, iban, balance, type, usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(companyId, 'powens', String(acc.id), acc.name || acc.original_name || 'Account', acc.bic || null, acc.number || acc.webid || null, acc.iban || null, acc.balance || 0, classifyAccountType(acc.type, acc.name || acc.original_name || ''), classifyAccountUsage(companyId));
        }
      }
    } catch (e) {
      console.error('Failed to fetch accounts:', e);
    }

    return c.html(`<html><head><meta http-equiv="refresh" content="15;url=/kompta/accounts"></head><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#d4a812;">✅ Bank connected!</h1>
      <p>${accounts.length} account(s) synced.</p>
      <p style="color:#888;font-size:14px;">Redirecting in <span id="t">15</span>s...</p>
      <a href="/kompta/accounts" style="color:#d4a812;font-size:18px;">← Back to Kompta</a>
      <script>let s=15;setInterval(()=>{s--;if(s>=0)document.getElementById('t').textContent=s;},1000);</script>
    </body></html>`);
  } catch (err: any) {
    console.error('Powens callback error:', err);
    return c.html(`<html><body style="background:#0f0f0f;color:#fff;font-family:sans-serif;padding:40px;">
      <h1 style="color:#ef4444;">Error</h1>
      <p>${err.message}</p>
      <a href="/kompta/accounts" style="color:#d4a812;">← Back to Kompta</a>
    </body></html>`);
  }
});

// --- Bank connections ---
app.get('/api/bank/connections', (c) => {
  const userId = ensureDefaultUser();
  const connections = db.prepare('SELECT * FROM bank_connections WHERE user_id = ?').all(userId);
  return c.json(connections);
});

// --- Sync all accounts from existing connections ---
app.post('/api/bank/sync', async (c) => {
  const connections = db.prepare('SELECT * FROM bank_connections WHERE status = ?').all('active') as any[];
  let totalSynced = 0;

  for (const conn of connections) {
    try {
      const res = await fetch(`${POWENS_API}/users/me/accounts`, {
        headers: { 'Authorization': `Bearer ${conn.powens_token}` },
      });
      const data = await res.json() as any;
      const accounts = data.accounts || [];

      for (const acc of accounts) {
        const existing = db.prepare('SELECT id FROM bank_accounts WHERE provider_account_id = ?').get(String(acc.id)) as any;
        if (existing) {
          const full = db.prepare('SELECT company_id FROM bank_accounts WHERE id = ?').get(existing.id) as any;
          db.prepare('UPDATE bank_accounts SET balance = ?, last_sync = ?, type = ?, usage = ? WHERE id = ?')
            .run(acc.balance || 0, new Date().toISOString(), classifyAccountType(acc.type, acc.name || acc.original_name || ''), classifyAccountUsage(full?.company_id || null), existing.id);
        } else {
          db.prepare(
            'INSERT INTO bank_accounts (company_id, provider, provider_account_id, name, bank_name, account_number, iban, balance, last_sync, type, usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(null, 'powens', String(acc.id), acc.name || acc.original_name || 'Account', acc.bic || null, acc.number || acc.webid || null, acc.iban || null, acc.balance || 0, new Date().toISOString(), classifyAccountType(acc.type, acc.name || acc.original_name || ''), classifyAccountUsage(null));
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
app.get('/api/dashboard', (c) => {
  const userId = ensureDefaultUser();
  const accounts = db.prepare('SELECT * FROM bank_accounts WHERE hidden = 0').all() as any[];
  const totalBalance = accounts.reduce((sum: number, a: any) => sum + (a.balance || 0), 0);
  const connections = db.prepare('SELECT COUNT(*) as count FROM bank_connections WHERE user_id = ?').get(userId) as any;
  const companies = db.prepare('SELECT COUNT(*) as count FROM companies WHERE user_id = ?').get(userId) as any;
  
  return c.json({
    totalBalance,
    accountCount: accounts.length,
    connectionCount: connections?.count || 0,
    companyCount: companies?.count || 0,
    accounts: accounts.map((a: any) => ({
      id: a.id,
      name: a.custom_name || a.name,
      balance: a.balance,
      type: a.type || 'checking',
    })),
  });
});

// --- Bank accounts ---
app.get('/api/bank/accounts', (c) => {
  const accounts = db.prepare('SELECT * FROM bank_accounts').all();
  return c.json(accounts);
});

// Update account (custom name, hidden)
app.patch('/api/bank/accounts/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: string[] = [];
  const params: any[] = [];

  if (body.custom_name !== undefined) { updates.push('custom_name = ?'); params.push(body.custom_name); }
  if (body.hidden !== undefined) { updates.push('hidden = ?'); params.push(body.hidden ? 1 : 0); }
  if (body.company_id !== undefined) {
    updates.push('company_id = ?'); params.push(body.company_id);
    updates.push('usage = ?'); params.push(body.company_id ? 'professional' : 'personal');
  }

  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400);
  params.push(id);
  db.prepare(`UPDATE bank_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
  return c.json(updated);
});

// Delete account
app.delete('/api/bank/accounts/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM transactions WHERE bank_account_id = ?').run(id);
  db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id);
  return c.json({ ok: true });
});

// --- Sync transactions for an account ---
app.post('/api/bank/accounts/:id/sync', async (c) => {
  const accountId = c.req.param('id');
  const account = db.prepare('SELECT ba.*, bc.powens_token FROM bank_accounts ba JOIN bank_connections bc ON bc.user_id = (SELECT user_id FROM companies WHERE id = ba.company_id) WHERE ba.id = ?').get(accountId) as any;
  
  if (!account?.powens_token) {
    return c.json({ error: 'No connection found' }, 404);
  }

  try {
    const txRes = await fetch(`${POWENS_API}/users/me/accounts/${account.provider_account_id}/transactions?limit=50`, {
      headers: { 'Authorization': `Bearer ${account.powens_token}` },
    });
    const txData = await txRes.json() as any;
    const transactions = txData.transactions || [];

    for (const tx of transactions) {
      db.prepare(
        'INSERT OR IGNORE INTO transactions (bank_account_id, date, amount, label, category) VALUES (?, ?, ?, ?, ?)'
      ).run(account.id, tx.date || tx.rdate, tx.value, tx.original_wording || tx.wording, tx.category?.name || null);
    }

    db.prepare('UPDATE bank_accounts SET last_sync = ?, balance = ? WHERE id = ?')
      .run(new Date().toISOString(), account.balance, account.id);

    return c.json({ synced: transactions.length });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

serve({ fetch: app.fetch, port: 3004 }, (info) => {
  console.log(`🦎 Kompta API running on http://localhost:${info.port}`);
});
