// Sandbox mode — intercepts API calls and returns mock data
// All edits stored in localStorage, never hits real backend

const SANDBOX_KEY = 'kompta_sandbox';
const SANDBOX_DATA_KEY = 'kompta_sandbox_data';

export function isSandbox(): boolean {
  return localStorage.getItem(SANDBOX_KEY) === 'true';
}

export function enableSandbox() {
  localStorage.setItem(SANDBOX_KEY, 'true');
  localStorage.setItem('kompta_auth', 'true');
  // Initialize sandbox data if not exists
  if (!localStorage.getItem(SANDBOX_DATA_KEY)) {
    localStorage.setItem(SANDBOX_DATA_KEY, JSON.stringify(generateMockData()));
  }
}

export function disableSandbox() {
  localStorage.removeItem(SANDBOX_KEY);
  localStorage.removeItem(SANDBOX_DATA_KEY);
}

function getSandboxData(): any {
  try {
    return JSON.parse(localStorage.getItem(SANDBOX_DATA_KEY) || '{}');
  } catch { return generateMockData(); }
}

function saveSandboxData(data: any) {
  localStorage.setItem(SANDBOX_DATA_KEY, JSON.stringify(data));
}

// Mock fetch interceptor
const originalFetch = window.fetch;

export function installSandboxInterceptor() {
  if (!isSandbox()) return;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method?.toUpperCase() || 'GET';

    // Only intercept /kompta/api calls
    if (!url.includes('/kompta/api')) {
      return originalFetch(input, init);
    }

    const path = url.replace(/.*\/kompta\/api/, '');
    const data = getSandboxData();

    // Route sandbox API calls
    const response = routeSandboxRequest(path, method, init?.body, data);
    if (response !== undefined) {
      saveSandboxData(data); // persist any mutations
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fallback: return empty
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

function routeSandboxRequest(path: string, method: string, body: any, data: any): any {
  const parsed = body ? JSON.parse(typeof body === 'string' ? body : '{}') : {};

  // Health
  if (path === '/health') return { status: 'ok', mode: 'sandbox' };

  // Bank accounts
  if (path === '/bank/accounts' && method === 'GET') return data.accounts;
  if (path === '/bank/connections' && method === 'GET') return data.connections;

  // Dashboard
  if (path === '/dashboard' && method === 'GET') return buildDashboard(data);

  // Transactions
  if (path.startsWith('/transactions') && method === 'GET') {
    const params = new URLSearchParams(path.split('?')[1] || '');
    let txs = data.transactions || [];
    const accountId = params.get('account_id');
    const search = params.get('search');
    if (accountId) txs = txs.filter((t: any) => t.bank_account_id === parseInt(accountId));
    if (search) txs = txs.filter((t: any) => t.label?.toLowerCase().includes(search.toLowerCase()));
    const offset = parseInt(params.get('offset') || '0');
    const limit = parseInt(params.get('limit') || '25');
    return { transactions: txs.slice(offset, offset + limit), total: txs.length, limit, offset };
  }

  // Companies
  if (path === '/companies' && method === 'GET') return data.companies;
  if (path.startsWith('/companies/search') && method === 'GET') return { results: [] }; // No real API in sandbox
  if (path.startsWith('/companies/info/')) return { error: 'Sandbox mode' };

  // Assets
  if (path.startsWith('/assets') && method === 'GET') return data.assets || [];

  // Account PATCH (edit)
  if (path.match(/\/bank\/accounts\/\d+$/) && method === 'PATCH') {
    const id = parseInt(path.split('/').pop()!);
    const acc = data.accounts.find((a: any) => a.id === id);
    if (acc) Object.assign(acc, parsed);
    return acc;
  }

  // Account DELETE
  if (path.match(/\/bank\/accounts\/\d+$/) && method === 'DELETE') {
    const id = parseInt(path.split('/').pop()!);
    data.accounts = data.accounts.filter((a: any) => a.id !== id);
    data.transactions = (data.transactions || []).filter((t: any) => t.bank_account_id !== id);
    return { ok: true };
  }

  // Manual account create
  if (path === '/accounts/manual' && method === 'POST') {
    const newAcc = { id: Date.now(), provider: 'manual', name: parsed.name, custom_name: null, bank_name: parsed.provider_name, balance: parsed.balance || 0, hidden: 0, type: parsed.type || 'checking', usage: 'personal', currency: parsed.currency || 'EUR', last_sync: new Date().toISOString(), blockchain_address: null, blockchain_network: null, account_number: null, iban: null, provider_account_id: null, company_id: null };
    data.accounts.push(newAcc);
    return newAcc;
  }

  // Blockchain wallet create
  if (path === '/accounts/blockchain' && method === 'POST') {
    const currency = parsed.network === 'bitcoin' ? 'BTC' : parsed.network === 'ethereum' ? 'ETH' : 'SOL';
    const mockBalance = parsed.network === 'bitcoin' ? 0.847 : parsed.network === 'ethereum' ? 3.21 : 42.5;
    const newAcc = { id: Date.now(), provider: 'blockchain', name: parsed.name || `${currency} Wallet`, custom_name: null, bank_name: null, balance: mockBalance, hidden: 0, type: 'investment', usage: 'personal', currency, last_sync: new Date().toISOString(), blockchain_address: parsed.address, blockchain_network: parsed.network, account_number: null, iban: null, provider_account_id: null, company_id: null };
    data.accounts.push(newAcc);
    return newAcc;
  }

  // Estimation geocode
  if (path.startsWith('/estimation/geocode')) {
    return [
      { label: '12 Rue de la République 93160 Noisy-le-Grand', citycode: '93051', lat: 48.8485, lon: 2.5521 },
      { label: '5 Avenue Aristide Briand 93160 Noisy-le-Grand', citycode: '93051', lat: 48.8440, lon: 2.5490 },
    ];
  }

  // Estimation price
  if (path.startsWith('/estimation/price')) {
    const params = new URLSearchParams(path.split('?')[1] || '');
    const surface = parseFloat(params.get('surface') || '60');
    const priceM2 = 3800 + Math.floor(Math.random() * 1200);
    return {
      estimation: { pricePerM2: priceM2, estimatedValue: Math.round(priceM2 * surface), range: { low: Math.round((priceM2 - 500) * surface), high: Math.round((priceM2 + 500) * surface) }, pricePerM2Range: { low: priceM2 - 500, median: priceM2, high: priceM2 + 500, mean: priceM2 + 50 } },
      comparables: [{ price: 245000, surface: 62, pricePerM2: 3952, date: '2024-06-15', type: 'Appartement', distance: 120 }],
      meta: { totalSales: 1847, sameTypeSales: 1203, comparablesUsed: 50, years: ['2024', '2023', '2022'], propertyType: 'Appartement', surface },
    };
  }

  // Crypto prices
  if (path.startsWith('/crypto/prices')) {
    return { bitcoin: { eur: 61200, usd: 72100, eur_24h_change: 2.3 }, ethereum: { eur: 1820, usd: 2150, eur_24h_change: 3.1 }, solana: { eur: 76, usd: 90, eur_24h_change: -1.2 } };
  }

  // Connect URLs — redirect to alert in sandbox
  if (path === '/bank/connect-url') return { url: '#sandbox-no-real-connection' };
  if (path === '/coinbase/connect-url') return { url: '#sandbox-no-real-connection' };

  // Export
  if (path === '/export') return { version: 1, exported_at: new Date().toISOString(), sandbox: true, ...data };

  // Sync endpoints — no-op in sandbox
  if (method === 'POST' && path.includes('sync')) return { synced: 0, sandbox: true };
  if (path.includes('/update-balance') && method === 'POST') {
    const id = parseInt(path.split('/')[2]);
    const acc = data.accounts.find((a: any) => a.id === id);
    if (acc) { acc.balance = parsed.balance; acc.last_sync = new Date().toISOString(); }
    return acc;
  }

  return {};
}

function buildDashboard(data: any) {
  const accounts = (data.accounts || []).filter((a: any) => !a.hidden);
  const byType: Record<string, any[]> = { checking: [], savings: [], investment: [], loan: [] };
  for (const a of accounts) {
    const t = a.type || 'checking';
    if (!byType[t]) byType[t] = [];
    byType[t].push({ id: a.id, name: a.custom_name || a.name, balance: a.balance || 0, type: t });
  }
  const brut = [...byType.checking, ...byType.savings, ...byType.investment].reduce((s, a) => s + a.balance, 0);
  const loans = byType.loan.reduce((s, a) => s + a.balance, 0);
  const assets = data.assets || [];
  const patrimoineBrut = assets.reduce((s: number, a: any) => s + (a.current_value || a.purchase_price || 0), 0);
  return {
    financial: { brutBalance: brut, netBalance: brut + loans, accountsByType: byType },
    patrimoine: { brutValue: patrimoineBrut, netValue: patrimoineBrut, count: assets.length, assets: assets.map((a: any) => ({ id: a.id, type: a.type, name: a.name, currentValue: a.current_value || 0, loanBalance: 0 })) },
    totals: { brut: brut + patrimoineBrut, net: brut + loans + patrimoineBrut },
    accountCount: accounts.length, companyCount: (data.companies || []).length,
  };
}

function generateMockData() {
  const now = new Date().toISOString();
  const accounts = [
    { id: 1, provider: 'powens', provider_account_id: '100', name: 'Compte Courant', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782195', iban: 'FR7630004008900004078219543', balance: 4832.67, hidden: 0, type: 'checking', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 2, provider: 'powens', provider_account_id: '101', name: 'Compte Joint', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782196', iban: 'FR7630004008900004078219654', balance: 1247.33, hidden: 0, type: 'checking', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 3, provider: 'powens', provider_account_id: '102', name: 'Livret A', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782197', iban: null, balance: 22950.00, hidden: 0, type: 'savings', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 4, provider: 'powens', provider_account_id: '103', name: 'LDDS', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782198', iban: null, balance: 12000.00, hidden: 0, type: 'savings', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 5, provider: 'powens', provider_account_id: '104', name: 'PEA', custom_name: 'PEA Actions', bank_name: 'Crédit Mutuel', account_number: '10293847561', iban: null, balance: 18420.55, hidden: 0, type: 'investment', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 6, provider: 'powens', provider_account_id: '105', name: 'PER Individuel', custom_name: null, bank_name: 'Crédit Mutuel', account_number: '10293847562', iban: null, balance: 8750.20, hidden: 0, type: 'investment', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 7, provider: 'powens', provider_account_id: '106', name: 'Assurance Vie', custom_name: null, bank_name: 'Crédit Mutuel', account_number: '10293847563', iban: null, balance: 35200.00, hidden: 0, type: 'investment', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 8, provider: 'powens', provider_account_id: '107', name: 'Prêt Immobilier', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782199', iban: null, balance: -186432.50, hidden: 0, type: 'loan', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 9, provider: 'manual', provider_account_id: null, name: 'Revolut', custom_name: null, bank_name: 'Revolut', account_number: null, iban: null, balance: 842.15, hidden: 0, type: 'checking', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 10, provider: 'manual', provider_account_id: null, name: 'eToro Portfolio', custom_name: null, bank_name: 'eToro', account_number: null, iban: null, balance: 5340.00, hidden: 0, type: 'investment', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 11, provider: 'blockchain', provider_account_id: null, name: 'Ledger BTC', custom_name: null, bank_name: null, account_number: null, iban: null, balance: 0.847, hidden: 0, type: 'investment', usage: 'personal', currency: 'BTC', last_sync: now, blockchain_address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', blockchain_network: 'bitcoin', company_id: null },
    { id: 12, provider: 'blockchain', provider_account_id: null, name: 'MetaMask ETH', custom_name: null, bank_name: null, account_number: null, iban: null, balance: 3.21, hidden: 0, type: 'investment', usage: 'personal', currency: 'ETH', last_sync: now, blockchain_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', blockchain_network: 'ethereum', company_id: null },
    { id: 13, provider: 'powens', provider_account_id: '108', name: 'Compte Pro', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782200', iban: 'FR7630004008900004078220076', balance: 12580.40, hidden: 0, type: 'checking', usage: 'professional', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: 1 },
  ];

  const connections = [
    { id: 1, status: 'active', provider_name: 'BNP Paribas', created_at: '2025-12-15 10:30:00' },
    { id: 2, status: 'active', provider_name: 'Crédit Mutuel', created_at: '2026-01-05 14:20:00' },
  ];

  const companies = [
    { id: 1, user_id: 1, siren: '901234567', name: 'SCI Les Tilleuls', address: '15 Rue des Lilas 93160 Noisy-le-Grand', naf_code: '68.20A', capital: 1000, legal_form: 'SCI', siret: '90123456700015', tva_number: 'FR32901234567', rcs: '901234567 R.C.S. Bobigny', date_creation: '2020-06-15', city: 'Noisy-le-Grand', postal_code: '93160', created_at: '2025-12-15 10:30:00' },
    { id: 2, user_id: 1, siren: '912345678', name: 'TechVision SAS', address: '42 Avenue de la Innovation 75008 Paris', naf_code: '62.01Z', capital: 10000, legal_form: 'SAS', siret: '91234567800012', tva_number: 'FR55912345678', rcs: '912345678 R.C.S. Paris', date_creation: '2023-03-01', city: 'Paris', postal_code: '75008', created_at: '2026-01-10 09:00:00' },
  ];

  // Generate 80 transactions
  const txLabels = [
    { label: 'VIREMENT SALAIRE SUNRISE', amount: 4250, cat: 'Salaire' },
    { label: 'LOYER 15 RUE DES LILAS', amount: -1150, cat: 'Logement' },
    { label: 'CARREFOUR NOISY', amount: -87.43, cat: 'Courses' },
    { label: 'SNCF VOYAGES', amount: -42.00, cat: 'Transport' },
    { label: 'AMAZON EU', amount: -29.99, cat: 'Shopping' },
    { label: 'EDF ELECTRICITE', amount: -76.50, cat: 'Énergie' },
    { label: 'FREE MOBILE', amount: -19.99, cat: 'Télécom' },
    { label: 'NETFLIX', amount: -17.99, cat: 'Loisirs' },
    { label: 'SPOTIFY', amount: -9.99, cat: 'Loisirs' },
    { label: 'BOULANGERIE DU MARCHE', amount: -6.80, cat: 'Alimentation' },
    { label: 'PHARMACIE CENTRALE', amount: -15.30, cat: 'Santé' },
    { label: 'IKEA VILLIERS', amount: -234.50, cat: 'Maison' },
    { label: 'VIREMENT RECU M. DUPONT', amount: 150, cat: 'Virement' },
    { label: 'REMBOURSEMENT AMELI', amount: 42.60, cat: 'Santé' },
    { label: 'UBER EATS', amount: -23.40, cat: 'Restaurant' },
    { label: 'DECATHLON', amount: -65.00, cat: 'Sport' },
    { label: 'ASSURANCE MMA', amount: -89.00, cat: 'Assurance' },
    { label: 'LEROY MERLIN', amount: -156.80, cat: 'Bricolage' },
    { label: 'FNAC PARIS', amount: -45.99, cat: 'Shopping' },
    { label: 'PRELEVEMENT IMPOTS', amount: -320.00, cat: 'Impôts' },
  ];

  const transactions: any[] = [];
  let txId = 1;
  for (let d = 0; d < 80; d++) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const numTx = 1 + Math.floor(Math.random() * 3);
    for (let j = 0; j < numTx && txId <= 120; j++) {
      const tmpl = txLabels[Math.floor(Math.random() * txLabels.length)];
      const variance = 1 + (Math.random() - 0.5) * 0.3;
      transactions.push({
        id: txId++,
        bank_account_id: Math.random() > 0.15 ? 1 : 2,
        date: date.toISOString().split('T')[0],
        amount: Math.round(tmpl.amount * variance * 100) / 100,
        label: tmpl.label,
        category: tmpl.cat,
        account_name: 'Compte Courant',
        account_custom_name: null,
      });
    }
  }

  const assets = [
    {
      id: 1, user_id: 1, type: 'real_estate', name: 'Appartement Noisy-le-Grand',
      purchase_price: 245000, purchase_date: '2021-03-15',
      current_value: 280000, current_value_date: '2026-01-15',
      linked_loan_account_id: 8, loan_name: 'Prêt Immobilier', loan_balance: -186432.50,
      notes: 'T3 65m², 3ème étage, parking',
      address: '15 Rue des Lilas 93160 Noisy-le-Grand', citycode: '93051',
      latitude: 48.8485, longitude: 2.5521, surface: 65, property_type: 'Appartement',
      estimated_value: 267500, estimated_price_m2: 4115, estimation_date: '2026-02-08',
      costs: [
        { id: 1, label: 'Charges copropriété', amount: 180, frequency: 'monthly' },
        { id: 2, label: 'Taxe foncière', amount: 1200, frequency: 'yearly' },
        { id: 3, label: 'Assurance habitation', amount: 28, frequency: 'monthly' },
      ],
      revenues: [],
      monthly_costs: 308, monthly_revenues: 0,
      pnl: 35000, pnl_percent: 14.3,
    },
  ];

  return { accounts, connections, companies, transactions, assets };
}
