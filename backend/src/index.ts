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
// Powens type is a string: checking, savings, deposit, card, loan, market, pea, pee, per, perco,
// perp, lifeinsurance, madelin, capitalisation, crowdlending, realEstate, livreta, livretb, ldds, cel, pel, etc.
const SAVINGS_TYPES = new Set(['savings', 'deposit', 'livreta', 'livretb', 'ldds', 'cel', 'pel']);
const INVESTMENT_TYPES = new Set(['market', 'pea', 'pee', 'per', 'perco', 'perp', 'lifeinsurance', 'madelin', 'capitalisation', 'crowdlending', 'realEstate', 'article83']);
const LOAN_TYPES = new Set(['loan']);

function classifyAccountType(powensType: string | undefined, name: string): string {
  if (powensType) {
    if (powensType === 'checking' || powensType === 'card') return 'checking';
    if (SAVINGS_TYPES.has(powensType)) return 'savings';
    if (LOAN_TYPES.has(powensType)) return 'loan';
    if (INVESTMENT_TYPES.has(powensType)) return 'investment';
    return powensType; // store the raw Powens type if unknown
  }
  // Fallback: name heuristic
  const lower = (name || '').toLowerCase();
  if (lower.includes('livret') || lower.includes('épargne') || lower.includes('epargne') || lower.includes('ldd')) return 'savings';
  if (lower.includes('pea') || lower.includes('per ') || lower.includes('assurance')) return 'investment';
  if (lower.includes('prêt') || lower.includes('pret') || lower.includes('crédit') || lower.includes('credit') || lower.includes('loan') || lower.includes('immo')) return 'loan';
  return 'checking';
}

// Powens usage field: "private", "professional", or null
function classifyAccountUsage(powensUsage: string | undefined | null, companyId: number | null): string {
  if (powensUsage === 'professional') return 'professional';
  if (powensUsage === 'private') return 'personal';
  // Fallback: infer from company link
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
            'INSERT INTO bank_accounts (company_id, provider, provider_account_id, name, bank_name, account_number, iban, balance, type, usage, last_sync) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(companyId, 'powens', String(acc.id), acc.name || acc.original_name || 'Account', acc.bic || null, acc.number || acc.webid || null, acc.iban || null, acc.balance || 0, classifyAccountType(acc.type, acc.name || acc.original_name || ''), classifyAccountUsage(acc.usage, companyId), new Date().toISOString());
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
            .run(acc.balance || 0, new Date().toISOString(), classifyAccountType(acc.type, acc.name || acc.original_name || ''), classifyAccountUsage(acc.usage, full?.company_id || null), existing.id);
        } else {
          db.prepare(
            'INSERT INTO bank_accounts (company_id, provider, provider_account_id, name, bank_name, account_number, iban, balance, last_sync, type, usage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).run(null, 'powens', String(acc.id), acc.name || acc.original_name || 'Account', acc.bic || null, acc.number || acc.webid || null, acc.iban || null, acc.balance || 0, new Date().toISOString(), classifyAccountType(acc.type, acc.name || acc.original_name || ''), classifyAccountUsage(acc.usage, null));
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
  if (body.type !== undefined) { updates.push('type = ?'); params.push(body.type); }
  if (body.usage !== undefined) { updates.push('usage = ?'); params.push(body.usage); }
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

// --- List transactions ---
app.get('/api/transactions', (c) => {
  const accountId = c.req.query('account_id');
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const search = c.req.query('search');

  let where = '1=1';
  const params: any[] = [];

  if (accountId) {
    where += ' AND t.bank_account_id = ?';
    params.push(accountId);
  }
  if (search) {
    where += ' AND t.label LIKE ?';
    params.push(`%${search}%`);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM transactions t WHERE ${where}`).get(...params) as any).count;

  const rows = db.prepare(
    `SELECT t.*, ba.name as account_name, ba.custom_name as account_custom_name
     FROM transactions t
     LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
     WHERE ${where}
     ORDER BY t.date DESC, t.id DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return c.json({ transactions: rows, total, limit, offset });
});

// --- Get detailed company info from SIREN ---
app.get('/api/companies/info/:siren', async (c) => {
  const siren = c.req.param('siren').replace(/\s/g, '');
  if (!/^\d{9}$/.test(siren)) return c.json({ error: 'Invalid SIREN' }, 400);

  try {
    // Fetch from gouv.fr
    const gouvRes = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${siren}&page=1&per_page=1`);
    const gouvData = await gouvRes.json() as any;
    const company = gouvData.results?.[0];
    if (!company || company.siren !== siren) return c.json({ error: 'Company not found' }, 404);

    const siege = company.siege || {};

    // Compute TVA number
    const sirenNum = parseInt(siren, 10);
    const tvaKey = (12 + 3 * (sirenNum % 97)) % 97;
    const tvaNumber = `FR${String(tvaKey).padStart(2, '0')}${siren}`;

    // Try Pappers API first (better data), fall back to societe.com scraping
    let capitalSocial: number | null = null;
    let pappersData: any = null;
    const pappersToken = process.env.PAPPERS_API_TOKEN;
    
    if (pappersToken) {
      try {
        const pRes = await fetch(`https://api.pappers.fr/v2/entreprise?siren=${siren}&api_token=${pappersToken}`);
        if (pRes.ok) pappersData = await pRes.json();
        if (pappersData?.capital) capitalSocial = pappersData.capital;
      } catch {}
    }

    // Scrape societe.com for enriched data
    let scrapedData: Record<string, string> = {};
    try {
      const slug = (company.nom_complet || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const url = `https://www.societe.com/societe/${slug}-${siren}.html`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' } });
      const buf = await res.arrayBuffer();
      const html = new TextDecoder('iso-8859-1').decode(buf);
      // Extract all data-copy-id template values
      const copyRegex = /data-copy-id="([^"]+)">(.*?)<\/template>/g;
      let m;
      while ((m = copyRegex.exec(html)) !== null) {
        scrapedData[m[1]] = m[2].trim();
      }
      if (scrapedData.legal_capital && !capitalSocial) {
        capitalSocial = parseFloat(scrapedData.legal_capital.replace(/\s/g, '').replace(',', '.'));
      }
    } catch {}

    // Legal form mapping
    const FORMS: Record<string, string> = {
      '1000': 'Entrepreneur individuel', '5410': 'SARL', '5485': 'EURL',
      '5499': 'SAS', '5710': 'SAS', '5720': 'SASU', '6540': 'SCI',
    };

    return c.json({
      siren: company.siren,
      siret: scrapedData.resume_siret || siege.siret || '',
      name: company.nom_complet || '',
      legal_form: scrapedData.legal_form || FORMS[String(company.nature_juridique)] || `Code ${company.nature_juridique}`,
      capital_social: capitalSocial,
      address: scrapedData.resume_company_address || siege.geo_adresse || siege.adresse || '',
      postal_code: siege.code_postal || '',
      city: siege.libelle_commune || '',
      naf_code: company.activite_principale || '',
      naf_label: scrapedData.resume_ape_label || scrapedData.legal_ape || company.libelle_activite_principale || '',
      date_creation: company.date_creation || '',
      tva_number: scrapedData.resume_tva || pappersData?.numero_tva_intracommunautaire || tvaNumber,
      rcs: pappersData?.greffe ? `${siren} R.C.S. ${pappersData.greffe}` : `${siren} R.C.S. ${siege.libelle_commune || ''}`,
      category: company.categorie_entreprise || '',
      // Extra from societe.com scraping
      activity_description: scrapedData.legal_activity || null,
      activity_type: scrapedData.legal_activity_type || null,
      brand_names: scrapedData.legal_brands || null,
      collective_agreement: scrapedData.legal_agreement || null,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
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

// ========== EXPORT / IMPORT (Backup) ==========

// Export all user data as JSON
app.get('/api/export', (c) => {
  const userId = 1; // TODO: multi-user
  const companies = db.prepare('SELECT * FROM companies WHERE user_id = ?').all(userId);
  const bankConnections = db.prepare('SELECT id, user_id, powens_connection_id, status, created_at FROM bank_connections WHERE user_id = ?').all(userId);
  const bankAccounts = db.prepare('SELECT * FROM bank_accounts').all();
  const transactions = db.prepare('SELECT * FROM transactions').all();
  const assets = db.prepare('SELECT * FROM assets WHERE user_id = ?').all(userId) as any[];
  for (const a of assets) {
    a.costs = db.prepare('SELECT * FROM asset_costs WHERE asset_id = ?').all(a.id);
    a.revenues = db.prepare('SELECT * FROM asset_revenues WHERE asset_id = ?').all(a.id);
  }

  const exportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    user_id: userId,
    companies,
    bank_connections: bankConnections,
    bank_accounts: bankAccounts,
    transactions,
    assets,
  };

  return c.json(exportData);
});

// Import user data from JSON
app.post('/api/import', async (c) => {
  const data = await c.req.json() as any;
  if (!data.version || !data.companies) {
    return c.json({ error: 'Invalid export format' }, 400);
  }

  const userId = 1;
  let imported = { companies: 0, bank_accounts: 0, transactions: 0, assets: 0 };

  // Import companies
  if (data.companies?.length) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO companies (user_id, siren, name, address, naf_code, capital, legal_form, siret, tva_number, rcs, date_creation, city, postal_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const co of data.companies) {
      stmt.run(userId, co.siren, co.name, co.address, co.naf_code, co.capital, co.legal_form, co.siret, co.tva_number, co.rcs, co.date_creation, co.city, co.postal_code);
      imported.companies++;
    }
  }

  // Import bank accounts
  if (data.bank_accounts?.length) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO bank_accounts (company_id, provider, provider_account_id, name, custom_name, bank_name, account_number, iban, balance, hidden, last_sync, type, usage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const ba of data.bank_accounts) {
      stmt.run(ba.company_id, ba.provider, ba.provider_account_id, ba.name, ba.custom_name, ba.bank_name, ba.account_number, ba.iban, ba.balance, ba.hidden, ba.last_sync, ba.type, ba.usage);
      imported.bank_accounts++;
    }
  }

  // Import transactions
  if (data.transactions?.length) {
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO transactions (bank_account_id, date, amount, label, category, is_pro) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const tx of data.transactions) {
      stmt.run(tx.bank_account_id, tx.date, tx.amount, tx.label, tx.category, tx.is_pro ?? 1);
      imported.transactions++;
    }
  }

  // Import assets with costs/revenues
  if (data.assets?.length) {
    const assetStmt = db.prepare(
      `INSERT INTO assets (user_id, type, name, purchase_price, purchase_date, current_value, current_value_date, photo_url, linked_loan_account_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const costStmt = db.prepare('INSERT INTO asset_costs (asset_id, label, amount, frequency, category) VALUES (?, ?, ?, ?, ?)');
    const revStmt = db.prepare('INSERT INTO asset_revenues (asset_id, label, amount, frequency) VALUES (?, ?, ?, ?)');

    for (const a of data.assets) {
      const r = assetStmt.run(userId, a.type, a.name, a.purchase_price, a.purchase_date, a.current_value, a.current_value_date, a.photo_url, a.linked_loan_account_id, a.notes);
      const newId = r.lastInsertRowid;
      if (a.costs) for (const co of a.costs) costStmt.run(newId, co.label, co.amount, co.frequency, co.category);
      if (a.revenues) for (const rv of a.revenues) revStmt.run(newId, rv.label, rv.amount, rv.frequency);
      imported.assets++;
    }
  }

  return c.json({ ok: true, imported });
});

// ========== ASSETS (Patrimoine) ==========

// List assets
app.get('/api/assets', (c) => {
  const type = c.req.query('type');
  let where = '1=1';
  const params: any[] = [];
  if (type) { where += ' AND a.type = ?'; params.push(type); }

  const assets = db.prepare(`
    SELECT a.*, ba.name as loan_name, ba.balance as loan_balance
    FROM assets a
    LEFT JOIN bank_accounts ba ON ba.id = a.linked_loan_account_id
    WHERE ${where}
    ORDER BY a.created_at DESC
  `).all(...params) as any[];

  // Attach costs and revenues for each asset
  for (const asset of assets) {
    asset.costs = db.prepare('SELECT * FROM asset_costs WHERE asset_id = ? ORDER BY id').all(asset.id);
    asset.revenues = db.prepare('SELECT * FROM asset_revenues WHERE asset_id = ? ORDER BY id').all(asset.id);
    // Calculate monthly totals
    asset.monthly_costs = (asset.costs as any[]).reduce((sum: number, c: any) => {
      return sum + (c.frequency === 'yearly' ? c.amount / 12 : c.frequency === 'one_time' ? 0 : c.amount);
    }, 0);
    asset.monthly_revenues = (asset.revenues as any[]).reduce((sum: number, r: any) => {
      return sum + (r.frequency === 'yearly' ? r.amount / 12 : r.frequency === 'one_time' ? 0 : r.amount);
    }, 0);
    // P&L
    asset.pnl = asset.current_value && asset.purchase_price
      ? asset.current_value - asset.purchase_price
      : null;
    asset.pnl_percent = asset.pnl != null && asset.purchase_price
      ? (asset.pnl / asset.purchase_price) * 100
      : null;
  }

  return c.json(assets);
});

// Get single asset
app.get('/api/assets/:id', (c) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(c.req.param('id')) as any;
  if (!asset) return c.json({ error: 'Not found' }, 404);
  asset.costs = db.prepare('SELECT * FROM asset_costs WHERE asset_id = ?').all(asset.id);
  asset.revenues = db.prepare('SELECT * FROM asset_revenues WHERE asset_id = ?').all(asset.id);
  return c.json(asset);
});

// Create asset
app.post('/api/assets', async (c) => {
  const body = await c.req.json() as any;
  const result = db.prepare(
    `INSERT INTO assets (type, name, purchase_price, purchase_date, current_value, current_value_date, photo_url, linked_loan_account_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    body.type, body.name, body.purchase_price || null, body.purchase_date || null,
    body.current_value || null, body.current_value_date || null,
    body.photo_url || null, body.linked_loan_account_id || null, body.notes || null
  );

  // Insert costs
  if (body.costs?.length) {
    const stmt = db.prepare('INSERT INTO asset_costs (asset_id, label, amount, frequency, category) VALUES (?, ?, ?, ?, ?)');
    for (const cost of body.costs) {
      stmt.run(result.lastInsertRowid, cost.label, cost.amount, cost.frequency || 'monthly', cost.category || null);
    }
  }

  // Insert revenues
  if (body.revenues?.length) {
    const stmt = db.prepare('INSERT INTO asset_revenues (asset_id, label, amount, frequency) VALUES (?, ?, ?, ?)');
    for (const rev of body.revenues) {
      stmt.run(result.lastInsertRowid, rev.label, rev.amount, rev.frequency || 'monthly');
    }
  }

  return c.json({ id: result.lastInsertRowid });
});

// Update asset
app.patch('/api/assets/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json() as any;
  
  const fields = ['type', 'name', 'purchase_price', 'purchase_date', 'current_value', 'current_value_date', 'photo_url', 'linked_loan_account_id', 'notes'];
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (f in body) { updates.push(`${f} = ?`); values.push(body[f]); }
  }
  if (updates.length) {
    db.prepare(`UPDATE assets SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);
  }

  // Replace costs if provided
  if (body.costs) {
    db.prepare('DELETE FROM asset_costs WHERE asset_id = ?').run(id);
    const stmt = db.prepare('INSERT INTO asset_costs (asset_id, label, amount, frequency, category) VALUES (?, ?, ?, ?, ?)');
    for (const cost of body.costs) {
      stmt.run(id, cost.label, cost.amount, cost.frequency || 'monthly', cost.category || null);
    }
  }

  // Replace revenues if provided
  if (body.revenues) {
    db.prepare('DELETE FROM asset_revenues WHERE asset_id = ?').run(id);
    const stmt = db.prepare('INSERT INTO asset_revenues (asset_id, label, amount, frequency) VALUES (?, ?, ?, ?)');
    for (const rev of body.revenues) {
      stmt.run(id, rev.label, rev.amount, rev.frequency || 'monthly');
    }
  }

  return c.json({ ok: true });
});

// Delete asset
app.delete('/api/assets/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM asset_costs WHERE asset_id = ?').run(id);
  db.prepare('DELETE FROM asset_revenues WHERE asset_id = ?').run(id);
  db.prepare('DELETE FROM assets WHERE id = ?').run(id);
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: 3004 }, (info) => {
  console.log(`🦎 Kompta API running on http://localhost:${info.port}`);
});
