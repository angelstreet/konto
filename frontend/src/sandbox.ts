// Sandbox mode — intercepts API calls and returns mock data
// All edits stored in localStorage, never hits real backend

const SANDBOX_KEY = 'konto_sandbox';
const SANDBOX_DATA_KEY = 'konto_sandbox_data';
const SANDBOX_PROFILE = {
  id: 1,
  email: 'sandbox@konto.demo',
  name: 'Sandbox User',
  phone: '+33 6 00 00 00 00',
  address: 'Adresse de demonstration',
  created_at: '2025-12-15 10:30:00',
};

export function isSandbox(): boolean {
  return localStorage.getItem(SANDBOX_KEY) === 'true';
}

export function enableSandbox() {
  localStorage.setItem(SANDBOX_KEY, 'true');
  localStorage.setItem('konto_auth', 'true');
  localStorage.setItem('konto_hide_amounts', 'false');
  // Initialize sandbox data if not exists
  if (!localStorage.getItem(SANDBOX_DATA_KEY)) {
    localStorage.setItem(SANDBOX_DATA_KEY, JSON.stringify(generateMockData()));
  } else {
    const data = getSandboxData();
    data.profile = sanitizeSandboxProfile(data.profile);
    saveSandboxData(data);
  }
  // Install the fetch interceptor after enabling sandbox
  installSandboxInterceptor();
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

function sanitizeSandboxProfile(profile: any) {
  return {
    ...SANDBOX_PROFILE,
    ...(profile || {}),
    id: SANDBOX_PROFILE.id,
    email: SANDBOX_PROFILE.email,
    created_at: SANDBOX_PROFILE.created_at,
  };
}

// Mock fetch interceptor
const originalFetch = window.fetch;

export function installSandboxInterceptor() {
  if (!isSandbox()) return;
  const existing = getSandboxData();
  existing.profile = sanitizeSandboxProfile(existing.profile);
  saveSandboxData(existing);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method?.toUpperCase() || 'GET';
    const parsedUrl = new URL(url, window.location.origin);
    const sameOrigin = parsedUrl.origin === window.location.origin;

    // Intercept same-origin API calls for both base paths:
    // - /konto/api/* (default)
    // - /api/* (when app is served at root)
    const isKontoApi = parsedUrl.pathname === '/konto/api' || parsedUrl.pathname.startsWith('/konto/api/');
    const isRootApi = parsedUrl.pathname === '/api' || parsedUrl.pathname.startsWith('/api/');
    if (!sameOrigin || (!isKontoApi && !isRootApi)) {
      return originalFetch(input, init);
    }

    const apiPrefix = isKontoApi ? '/konto/api' : '/api';
    const path = `${parsedUrl.pathname.slice(apiPrefix.length)}${parsedUrl.search}`;
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
  const [route, query = ''] = path.split('?');

  // Health
  if (route === '/health') return { status: 'ok', mode: 'sandbox' };

  // Preferences
  if (route === '/preferences' && method === 'GET') {
    return data.preferences || { onboarded: 1, display_currency: 'EUR', crypto_display: 'native', kozy_enabled: 0 };
  }
  if (route === '/preferences' && method === 'PATCH') {
    data.preferences = { ...(data.preferences || { onboarded: 1, display_currency: 'EUR', crypto_display: 'native', kozy_enabled: 0 }), ...parsed };
    return data.preferences;
  }

  // Bank accounts
  if (route === '/bank/accounts' && method === 'GET') {
    return (data.accounts || []).map((a: any) => {
      if (a?.type === 'investment' && (a?.provider === 'blockchain' || a?.provider === 'coinbase')) {
        return { ...a, subtype: a.subtype || 'crypto' };
      }
      return a;
    });
  }
  if (route === '/bank/connections' && method === 'GET') return data.connections;
  if (route === '/investments' && method === 'GET') {
    const params = new URLSearchParams(query);
    const accountId = params.get('account_id');
    const all = data.investments || [];
    const investments = accountId
      ? all.filter((i: any) => i.bank_account_id === parseInt(accountId))
      : all;
    const total_valuation = investments.reduce((s: number, i: any) => s + Number(i.valuation || 0), 0);
    const total_diff = investments.reduce((s: number, i: any) => s + Number(i.diff || 0), 0);
    return { investments, total_valuation, total_diff };
  }

  // Dashboard
  if (route === '/dashboard' && method === 'GET') return buildDashboard(data);
  if (route.startsWith('/dashboard/history') && method === 'GET') {
    return buildDashboardHistory(data, query);
  }

  // Transactions
  if (route.startsWith('/transactions') && method === 'GET') {
    const params = new URLSearchParams(query);
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
  if (route === '/companies' && method === 'GET') return data.companies;
  if (route.startsWith('/companies/search') && method === 'GET') return { results: [] }; // No real API in sandbox
  if (route.startsWith('/companies/info/')) return { error: 'Sandbox mode' };

  // Profile
  if (route === '/profile' && method === 'GET') {
    data.profile = sanitizeSandboxProfile(data.profile);
    return data.profile;
  }
  if (route === '/profile' && method === 'PUT') {
    data.profile = { ...sanitizeSandboxProfile(data.profile), ...parsed };
    data.profile.id = SANDBOX_PROFILE.id;
    data.profile.email = SANDBOX_PROFILE.email;
    data.profile.created_at = SANDBOX_PROFILE.created_at;
    return data.profile;
  }

  // Assets
  if (route.startsWith('/assets') && method === 'GET') {
    const params = new URLSearchParams(query);
    const type = params.get('type');
    const usage = params.get('usage');
    const companyId = params.get('company_id');
    let assets = data.assets || [];
    if (type) assets = assets.filter((a: any) => a.type === type);
    if (usage) assets = assets.filter((a: any) => (a.usage || 'personal') === usage);
    if (companyId) assets = assets.filter((a: any) => String(a.company_id || '') === companyId);
    return assets;
  }
  if (route === '/assets' && method === 'POST') {
    const newAsset = {
      id: Date.now(),
      user_id: 1,
      type: parsed.type || 'other',
      name: parsed.name || 'Nouvel actif',
      purchase_price: parsed.purchase_price ?? null,
      notary_fees: parsed.notary_fees ?? null,
      travaux: parsed.travaux ?? null,
      purchase_date: parsed.purchase_date ?? null,
      current_value: parsed.current_value ?? parsed.purchase_price ?? null,
      current_value_date: parsed.current_value_date ?? new Date().toISOString().split('T')[0],
      linked_loan_account_id: parsed.linked_loan_account_id ?? null,
      loan_name: null,
      loan_balance: null,
      notes: parsed.notes ?? null,
      address: parsed.address ?? null,
      citycode: parsed.citycode ?? null,
      latitude: parsed.latitude ?? null,
      longitude: parsed.longitude ?? null,
      surface: parsed.surface ?? null,
      property_type: parsed.property_type ?? null,
      estimated_value: parsed.estimated_value ?? null,
      estimated_price_m2: parsed.estimated_price_m2 ?? null,
      estimation_date: parsed.estimated_value ? new Date().toISOString().split('T')[0] : null,
      property_usage: parsed.property_usage ?? null,
      monthly_rent: parsed.monthly_rent ?? null,
      tenant_name: parsed.tenant_name ?? null,
      kozy_property_id: null,
      costs: parsed.costs || [],
      revenues: parsed.revenues || [],
      monthly_costs: (parsed.costs || []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0),
      monthly_revenues: (parsed.revenues || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0),
      pnl: parsed.current_value && parsed.purchase_price ? Number(parsed.current_value) - Number(parsed.purchase_price) : null,
      pnl_percent: parsed.current_value && parsed.purchase_price && Number(parsed.purchase_price) > 0
        ? ((Number(parsed.current_value) - Number(parsed.purchase_price)) / Number(parsed.purchase_price)) * 100
        : null,
      usage: parsed.usage || 'personal',
      company_id: parsed.company_id ?? null,
    };
    data.assets = [...(data.assets || []), newAsset];
    return newAsset;
  }
  if (route.match(/^\/assets\/\d+$/) && method === 'PATCH') {
    const id = parseInt(route.split('/').pop()!);
    const idx = (data.assets || []).findIndex((a: any) => a.id === id);
    if (idx === -1) return { error: 'Asset not found' };
    const updated = { ...(data.assets[idx] || {}), ...parsed };
    updated.monthly_costs = (updated.costs || []).reduce((s: number, c: any) => s + Number(c.amount || 0), 0);
    updated.monthly_revenues = (updated.revenues || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    if (updated.current_value != null && updated.purchase_price != null && Number(updated.purchase_price) > 0) {
      updated.pnl = Number(updated.current_value) - Number(updated.purchase_price);
      updated.pnl_percent = (updated.pnl / Number(updated.purchase_price)) * 100;
    }
    data.assets[idx] = updated;
    return updated;
  }
  if (route.match(/^\/assets\/\d+$/) && method === 'DELETE') {
    const id = parseInt(route.split('/').pop()!);
    data.assets = (data.assets || []).filter((a: any) => a.id !== id);
    return { ok: true };
  }

  // Account PATCH (edit)
  if (route.match(/\/bank\/accounts\/\d+$/) && method === 'PATCH') {
    const id = parseInt(route.split('/').pop()!);
    const acc = data.accounts.find((a: any) => a.id === id);
    if (acc) Object.assign(acc, parsed);
    return acc;
  }

  // Account DELETE
  if (route.match(/\/bank\/accounts\/\d+$/) && method === 'DELETE') {
    const id = parseInt(route.split('/').pop()!);
    data.accounts = data.accounts.filter((a: any) => a.id !== id);
    data.transactions = (data.transactions || []).filter((t: any) => t.bank_account_id !== id);
    return { ok: true };
  }

  // Manual account create
  if (route === '/accounts/manual' && method === 'POST') {
    const newAcc = { id: Date.now(), provider: 'manual', name: parsed.name, custom_name: null, bank_name: parsed.provider_name, balance: parsed.balance || 0, hidden: 0, type: parsed.type || 'checking', usage: 'personal', currency: parsed.currency || 'EUR', last_sync: new Date().toISOString(), blockchain_address: null, blockchain_network: null, account_number: null, iban: null, provider_account_id: null, company_id: null };
    data.accounts.push(newAcc);
    return newAcc;
  }

  // Blockchain wallet create
  if (route === '/accounts/blockchain' && method === 'POST') {
    const currency = parsed.network === 'bitcoin' ? 'BTC' : parsed.network === 'ethereum' ? 'ETH' : 'SOL';
    const mockBalance = parsed.network === 'bitcoin' ? 0.847 : parsed.network === 'ethereum' ? 3.21 : 42.5;
    const newAcc = { id: Date.now(), provider: 'blockchain', name: parsed.name || `${currency} Wallet`, custom_name: null, bank_name: null, balance: mockBalance, hidden: 0, type: 'investment', subtype: 'crypto', usage: 'personal', currency, last_sync: new Date().toISOString(), blockchain_address: parsed.address, blockchain_network: parsed.network, account_number: null, iban: null, provider_account_id: null, company_id: null };
    data.accounts.push(newAcc);
    return newAcc;
  }

  // Estimation geocode
  if (route.startsWith('/estimation/geocode')) {
    return [
      { label: '12 Rue de la République 93160 Noisy-le-Grand', citycode: '93051', lat: 48.8485, lon: 2.5521 },
      { label: '5 Avenue Aristide Briand 93160 Noisy-le-Grand', citycode: '93051', lat: 48.8440, lon: 2.5490 },
    ];
  }

  // Estimation price
  if (route.startsWith('/estimation/price')) {
    const params = new URLSearchParams(query);
    const surface = parseFloat(params.get('surface') || '60');
    const priceM2 = 3800 + Math.floor(Math.random() * 1200);
    return {
      estimation: { pricePerM2: priceM2, estimatedValue: Math.round(priceM2 * surface), range: { low: Math.round((priceM2 - 500) * surface), high: Math.round((priceM2 + 500) * surface) }, pricePerM2Range: { low: priceM2 - 500, median: priceM2, high: priceM2 + 500, mean: priceM2 + 50 } },
      comparables: [{ price: 245000, surface: 62, pricePerM2: 3952, date: '2024-06-15', type: 'Appartement', distance: 120 }],
      meta: { totalSales: 1847, sameTypeSales: 1203, comparablesUsed: 50, years: ['2024', '2023', '2022'], propertyType: 'Appartement', surface },
    };
  }

  // Crypto prices
  if (route.startsWith('/crypto/prices')) {
    return { bitcoin: { eur: 61200, usd: 72100, eur_24h_change: 2.3 }, ethereum: { eur: 1820, usd: 2150, eur_24h_change: 3.1 }, solana: { eur: 76, usd: 90, eur_24h_change: -1.2 } };
  }

  // Connect URLs — redirect to alert in sandbox
  if (route === '/bank/connect-url') return { url: '#sandbox-no-real-connection' };
  if (route === '/coinbase/connect-url') return { url: '#sandbox-no-real-connection' };

  // Budget/Cashflow
  if (route.startsWith('/budget/cashflow')) {
    const months: any[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      months.push({ month: d.toISOString().slice(0, 7), income: 4250 + Math.random() * 500, expenses: 2800 + Math.random() * 800 });
    }
    return { months: months.reverse() };
  }

  // Analytics
  if (route.startsWith('/analytics')) {
    if (method === 'POST') return { ok: true };
    const totalIncome = 4250;
    const totalExpenses = 2800;
    return {
      totalIncome,
      totalExpenses,
      savingsRate: Math.round(((totalIncome - totalExpenses) / totalIncome) * 100),
      topCategories: [
        { category: 'Logement', amount: 1150, percentage: 41 },
        { category: 'Courses', amount: 520, percentage: 19 },
        { category: 'Transport', amount: 180, percentage: 6 },
        { category: 'Loisirs', amount: 150, percentage: 5 },
      ],
      recurring: [
        { label: 'LOYER 15 RUE DES LILAS', avgAmount: 1150, months: 3 },
        { label: 'FREE MOBILE', avgAmount: 19.99, months: 3 },
        { label: 'NETFLIX', avgAmount: 17.99, months: 3 },
      ],
      trends: [
        { period: '2025-09', income: 4200, expenses: 2750 },
        { period: '2025-10', income: 4250, expenses: 2820 },
        { period: '2025-11', income: 4250, expenses: 2790 },
        { period: '2025-12', income: 4300, expenses: 2860 },
        { period: '2026-01', income: 4250, expenses: 2810 },
        { period: '2026-02', income: 4250, expenses: 2800 },
      ],
      mom: { income: 0, expenses: -1 },
      yoy: { income: 4050, expenses: 2680, incomeChange: 5, expensesChange: 4 },
      computed_at: new Date().toISOString(),
      cached: false,
    };
  }

  // Invoices
  if (route.startsWith('/invoices')) {
    if (route.includes('/stats')) return { total: 0, matched: 0, unmatched: 0 };
    if (route.includes('/scan')) return { scanned: 0 };
    return [];
  }

  // Drive status
  if (route.startsWith('/drive/status')) return { connected: false };

  // Property ROI
  if (route.startsWith('/properties/roi') && method === 'GET') {
    const monthsParam = parseInt(new URLSearchParams(query).get('months') || '6');
    const properties = [
      {
        id: 1981817,
        name: 'Appartement Noisy-le-Grand',
        revenue: 11640,
        costs: 3180,
        net: 8460,
        monthlyRevenue: 1940,
        monthlyCosts: 530,
        monthlyNet: 1410,
        occupancyRate: 78,
        nights: 143,
        bookings: 19,
        revenueByMonth: { '2025-09': 1820, '2025-10': 1910, '2025-11': 1880, '2025-12': 2050, '2026-01': 1980, '2026-02': 2000 },
        costsByMonth: { '2025-09': 510, '2025-10': 540, '2025-11': 495, '2025-12': 560, '2026-01': 535, '2026-02': 540 },
      },
      {
        id: 1981820,
        name: 'Studio Paris 11e',
        revenue: 8340,
        costs: 2640,
        net: 5700,
        monthlyRevenue: 1390,
        monthlyCosts: 440,
        monthlyNet: 950,
        occupancyRate: 71,
        nights: 129,
        bookings: 23,
        revenueByMonth: { '2025-09': 1310, '2025-10': 1380, '2025-11': 1400, '2025-12': 1460, '2026-01': 1370, '2026-02': 1420 },
        costsByMonth: { '2025-09': 420, '2025-10': 430, '2025-11': 445, '2025-12': 470, '2026-01': 430, '2026-02': 445 },
      },
    ];
    const totalRevenue = properties.reduce((s, p) => s + p.revenue, 0);
    const totalCosts = properties.reduce((s, p) => s + p.costs, 0);
    return {
      properties,
      summary: {
        totalRevenue,
        totalCosts,
        totalNet: totalRevenue - totalCosts,
        propertyCount: properties.length,
      },
      period: {
        from: '2025-09-01',
        to: new Date().toISOString().split('T')[0],
        months: monthsParam,
      },
    };
  }

  // Income
  if (route === '/income' && method === 'GET') {
    return {
      entries: [
        { id: 1, year: 2022, employer: 'Capgemini', job_title: 'Développeur Full Stack', country: 'FR', gross_annual: 42000, net_annual: 32500, start_date: '2020-09-01', end_date: '2022-12-31', company_id: null, company_name: null },
        { id: 2, year: 2023, employer: 'Capgemini', job_title: 'Lead Developer', country: 'FR', gross_annual: 48000, net_annual: 37000, start_date: '2023-01-01', end_date: '2023-12-31', company_id: null, company_name: null },
        { id: 3, year: 2024, employer: 'Sunrise Technologies', job_title: 'Senior Full Stack Engineer', country: 'FR', gross_annual: 54000, net_annual: 41500, start_date: '2024-01-01', end_date: null, company_id: null, company_name: null },
        { id: 4, year: 2025, employer: 'Sunrise Technologies', job_title: 'Senior Full Stack Engineer', country: 'FR', gross_annual: 58000, net_annual: 44500, start_date: '2025-01-01', end_date: null, company_id: null, company_name: null },
        { id: 5, year: 2026, employer: 'Sunrise Technologies', job_title: 'Senior Full Stack Engineer', country: 'FR', gross_annual: 60000, net_annual: 46000, start_date: '2026-01-01', end_date: null, company_id: null, company_name: null },
      ]
    };
  }
  if (route === '/income' && method === 'POST') {
    return { id: Date.now(), ...parsed };
  }
  if (route.match(/^\/income\/\d+$/) && method === 'PUT') {
    return { id: parseInt(route.split('/')[2]), ...parsed };
  }
  if (route.match(/^\/income\/\d+$/) && method === 'DELETE') {
    return { ok: true };
  }

  // Salary benchmarks
  if (route === '/salary-benchmarks' && method === 'GET') {
    return {
      FR: {
        2022: [
          { p: 10, gross: 22000 }, { p: 25, gross: 30000 }, { p: 50, gross: 40000 },
          { p: 75, gross: 55000 }, { p: 90, gross: 75000 }, { p: 95, gross: 95000 },
        ],
        2023: [
          { p: 10, gross: 23000 }, { p: 25, gross: 32000 }, { p: 50, gross: 42000 },
          { p: 75, gross: 58000 }, { p: 90, gross: 78000 }, { p: 95, gross: 100000 },
        ],
        2024: [
          { p: 10, gross: 24000 }, { p: 25, gross: 33000 }, { p: 50, gross: 44000 },
          { p: 75, gross: 60000 }, { p: 90, gross: 82000 }, { p: 95, gross: 105000 },
        ],
        2025: [
          { p: 10, gross: 25000 }, { p: 25, gross: 35000 }, { p: 50, gross: 46000 },
          { p: 75, gross: 63000 }, { p: 90, gross: 85000 }, { p: 95, gross: 110000 },
        ],
        2026: [
          { p: 10, gross: 26000 }, { p: 25, gross: 36000 }, { p: 50, gross: 48000 },
          { p: 75, gross: 65000 }, { p: 90, gross: 88000 }, { p: 95, gross: 115000 },
        ],
      },
      CH: {
        2024: [
          { p: 10, gross: 62000 }, { p: 25, gross: 78000 }, { p: 50, gross: 98000 },
          { p: 75, gross: 125000 }, { p: 90, gross: 160000 }, { p: 95, gross: 200000 },
        ],
        2025: [
          { p: 10, gross: 65000 }, { p: 25, gross: 82000 }, { p: 50, gross: 102000 },
          { p: 75, gross: 130000 }, { p: 90, gross: 168000 }, { p: 95, gross: 210000 },
        ],
      },
    };
  }

  // Passive income analysis
  if (route.startsWith('/analysis/passive-income') && method === 'GET') {
    return {
      monthly: 1940,
      yearly: 23280,
      yield_pct: 4.8,
      upcoming: [
        { source: 'Studio Paris 11e', type: 'rental', amount: 1450, date: '2026-03-05' },
        { source: 'ETF MSCI World', type: 'dividend', amount: 120, date: '2026-03-12' },
        { source: 'Air Liquide', type: 'dividend', amount: 42, date: '2026-03-20' },
      ],
      received: [
        { source: 'Studio Paris 11e', type: 'rental', amount: 1450, date: '2026-02-05' },
        { source: 'Studio Paris 11e', type: 'rental', amount: 1450, date: '2026-01-05' },
        { source: 'TotalEnergies', type: 'dividend', amount: 58, date: '2026-01-18' },
        { source: 'Air Liquide', type: 'dividend', amount: 37, date: '2025-12-20' },
      ],
      by_source: [
        { type: 'rental', label: 'Immobilier locatif', monthly: 1450, pct: 74.7 },
        { type: 'dividend', label: 'Dividendes actions', monthly: 310, pct: 16.0 },
        { type: 'interest', label: 'Intérêts & autres', monthly: 180, pct: 9.3 },
      ],
    };
  }

  // Trends
  if (route.startsWith('/trends')) {
    const tParams = new URLSearchParams(query);
    const tMonths = parseInt(tParams.get('months') || '6');
    const allMonths: string[] = [];
    for (let i = tMonths - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
      allMonths.push(d.toISOString().slice(0, 7));
    }
    const buildCat = (catName: string, base: number) => ({
      category: catName,
      totalSpend: base * tMonths,
      months: allMonths.map((month, idx) => {
        const amount = Math.round(base * (0.8 + (idx % 5) * 0.1));
        const avgLast3 = idx >= 3 ? Math.round(base * 1.0) : null;
        const changePercent = avgLast3 ? Math.round(((amount - avgLast3) / avgLast3) * 100) : null;
        return { month, amount, avgLast3, changePercent };
      }),
    });
    const isProTrends = query.includes('usage=professional');
    const tCategories = isProTrends ? [
      buildCat('Salaires & Charges', 3200),
      buildCat('Logiciels & SaaS', 450),
      buildCat('Déplacements Pro', 380),
      buildCat('Matériel & Équipement', 290),
      buildCat('Marketing', 520),
      buildCat('Frais bancaires', 85),
    ] : [
      buildCat('Logement', 1150),
      buildCat('Alimentation', 520),
      buildCat('Transport', 180),
      buildCat('Énergie', 95),
      buildCat('Loisirs', 150),
      buildCat('Assurances', 89),
      buildCat('Internet & Mobile', 40),
    ];
    return { categories: tCategories, allMonths, scope: isProTrends ? 'professional' : 'personal' };
  }

  // Bilan Pro (must come before personal bilan)
  if (route.match(/^\/bilan-pro\/\d+$/)) {
    const bilanProYear = parseInt(route.split('/')[2]) || new Date().getFullYear();
    return {
      year: bilanProYear,
      companies: [
        { company_id: 1, name: 'SCI Les Tilleuls', ca: 48200, charges: 22800, resultat: 25400 },
        { company_id: 2, name: 'TechVision SAS', ca: 87500, charges: 31200, resultat: 56300 },
      ],
      total: { ca: 135700, charges: 54000, resultat: 81700 },
      monthly_breakdown: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        income: Math.round(11308 * (0.8 + (i % 3) * 0.1)),
        expenses: Math.round(4500 * (0.8 + (i % 4) * 0.1)),
      })),
    };
  }

  // Bilan (personal or company detail)
  if (route.match(/^\/bilan\/\d+$/)) {
    const bilanYear = parseInt(route.split('/')[2]) || new Date().getFullYear();
    const bilanParams = new URLSearchParams(query);
    const companyId = bilanParams.get('company_id');

    if (companyId) {
      const isCo2 = companyId === '2';
      const ca = isCo2 ? 87500 : 48200;
      const charges = isCo2 ? 31200 : 22800;
      return {
        year: bilanYear,
        compte_de_resultat: {
          chiffre_affaires: ca,
          charges: {
            total: charges,
            details: isCo2
              ? [{ category: 'Salaires', total: 18000, count: 12 }, { category: 'Logiciels', total: 5400, count: 6 }, { category: 'Déplacements', total: 4200, count: 8 }, { category: 'Matériel', total: 3600, count: 3 }]
              : [{ category: 'Charges sociales', total: 12000, count: 12 }, { category: 'Fournitures', total: 5800, count: 4 }, { category: 'Services extérieurs', total: 5000, count: 3 }],
          },
          resultat_net: ca - charges,
        },
        tva: { collectee: Math.round(ca * 0.2), deductible: Math.round(charges * 0.12), nette: Math.round(ca * 0.2 - charges * 0.12), from_invoices: null },
        bilan: {
          actif: {
            items: [
              { name: 'Trésorerie', type: 'cash', balance: isCo2 ? 12580 : 8450 },
              { name: 'Créances clients', type: 'receivable', balance: isCo2 ? 14200 : 6300 },
              { name: 'Matériel informatique', type: 'fixed_asset', balance: isCo2 ? 8400 : 3200 },
            ],
            total: isCo2 ? 35180 : 17950,
          },
          passif: {
            items: [
              { name: 'Dettes fournisseurs', type: 'payable', balance: isCo2 ? 4800 : 2100 },
              { name: 'TVA à payer', type: 'tax', balance: isCo2 ? 3200 : 1800 },
            ],
            total: isCo2 ? 8000 : 3900,
          },
          capitaux_propres: isCo2 ? 27180 : 14050,
        },
        monthly_breakdown: Array.from({ length: 12 }, (_, i) => ({
          month: i + 1,
          income: Math.round((ca / 12) * (0.8 + (i % 3) * 0.15)),
          expenses: Math.round((charges / 12) * (0.8 + (i % 4) * 0.15)),
        })),
      };
    }

    // Personal bilan
    return {
      year: bilanYear,
      compte_de_resultat: {
        chiffre_affaires: 51000,
        charges: {
          total: 32400,
          details: [
            { category: 'Logement', total: 13800, count: 12 },
            { category: 'Alimentation', total: 6240, count: 12 },
            { category: 'Transport', total: 2160, count: 12 },
            { category: 'Loisirs', total: 1800, count: 12 },
            { category: 'Assurances', total: 1068, count: 12 },
            { category: 'Énergie', total: 1140, count: 12 },
            { category: 'Autres', total: 6192, count: 12 },
          ],
        },
        resultat_net: 18600,
      },
      tva: { collectee: 0, deductible: 0, nette: 0, from_invoices: null },
      bilan: {
        actif: {
          items: [
            { name: 'Immobilier', type: 'real_estate', balance: 250000 },
            { name: 'Investissements', type: 'investment', balance: 50000 },
            { name: 'Liquidités', type: 'cash', balance: 15000 },
            { name: 'Véhicule', type: 'vehicle', balance: 25000 },
          ],
          total: 340000,
        },
        passif: {
          items: [
            { name: 'Crédit immobilier', type: 'mortgage', balance: 180000 },
            { name: 'Crédit auto', type: 'auto_loan', balance: 8200 },
          ],
          total: 188200,
        },
        capitaux_propres: 151800,
      },
      monthly_breakdown: Array.from({ length: 12 }, (_, i) => ({
        month: i + 1,
        income: Math.round(4250 * (0.9 + (i % 3) * 0.05)),
        expenses: Math.round(2700 * (0.9 + (i % 4) * 0.05)),
      })),
      justificatifs: { total: 156, matched: 141, match_rate: 90 },
    };
  }

  // Report
  if (route.startsWith('/report/patrimoine/last/html')) return '<html><body><h1>Sandbox report</h1></body></html>';
  if (route.startsWith('/report/patrimoine/last')) return { report: null };
  if (route.startsWith('/report/patrimoine')) {
    return {
      sections: [
        { title: 'Comptes bancaires', items: [{ name: 'Compte courant', value: 4832.67 }], total: 4832.67 },
        { title: 'Immobilier', items: [{ name: 'Appartement Paris', value: 520000 }], total: 520000 }
      ],
      grandTotal: 524832.67,
      generatedAt: new Date().toISOString(),
      report_id: 1
    };
  }
  if (route.startsWith('/report')) return {};

  // Export
  if (route === '/export') return { version: 1, exported_at: new Date().toISOString(), sandbox: true, ...data };

  // Sync endpoints — no-op in sandbox
  if (method === 'POST' && route.includes('sync')) return { synced: 0, sandbox: true };
  if (route.includes('/update-balance') && method === 'POST') {
    const id = parseInt(route.split('/')[2]);
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

function buildDashboardHistory(data: any, query: string) {
  const params = new URLSearchParams(query);
  const range = (params.get('range') || '6m').toLowerCase();
  const useNet = params.get('net') === '1';

  const daysByRange: Record<string, number> = {
    '1m': 30,
    '3m': 90,
    '6m': 180,
    '1y': 365,
    max: 730,
  };
  const days = daysByRange[range] ?? 180;

  const dashboard = buildDashboard(data);
  const targetValue = useNet ? Number(dashboard?.totals?.net || 0) : Number(dashboard?.totals?.brut || 0);

  // Build a smooth, realistic progression toward today's value.
  const startValue = Math.max(1000, targetValue * 0.84);
  const startTs = Date.now() - days * 24 * 60 * 60 * 1000;
  const history: { date: string; value: number }[] = [];

  for (let i = 0; i <= days; i++) {
    const progress = i / Math.max(1, days);
    const trend = startValue + (targetValue - startValue) * progress;
    const wave = Math.sin(i / 9) * targetValue * 0.006;
    const noise = (Math.random() - 0.5) * targetValue * 0.0025;
    const value = Math.max(0, trend + wave + noise);
    const date = new Date(startTs + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    history.push({ date, value: Math.round(value) });
  }

  return {
    history,
    baselineDate: history.length > 0 ? history[0].date : null,
  };
}

function generateMockData() {
  const now = new Date().toISOString();
  const accounts = [
    { id: 1, provider: 'powens', provider_account_id: '100', name: 'Compte Courant', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782195', iban: 'FR7630004008900004078219543', balance: 4832.67, hidden: 0, type: 'checking', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 2, provider: 'powens', provider_account_id: '101', name: 'Compte Joint', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782196', iban: 'FR7630004008900004078219654', balance: 1247.33, hidden: 0, type: 'checking', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 3, provider: 'powens', provider_account_id: '102', name: 'Livret A', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782197', iban: null, balance: 22950.00, hidden: 0, type: 'savings', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 4, provider: 'powens', provider_account_id: '103', name: 'LDDS', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782198', iban: null, balance: 12000.00, hidden: 0, type: 'savings', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 5, provider: 'powens', provider_account_id: '104', name: 'PEA', custom_name: 'PEA Actions', bank_name: 'Crédit Mutuel', account_number: '10293847561', iban: null, balance: 18420.55, hidden: 0, type: 'investment', subtype: 'stocks', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 6, provider: 'powens', provider_account_id: '105', name: 'PER Individuel', custom_name: null, bank_name: 'Crédit Mutuel', account_number: '10293847562', iban: null, balance: 8750.20, hidden: 0, type: 'investment', subtype: 'other', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 7, provider: 'powens', provider_account_id: '106', name: 'Assurance Vie', custom_name: null, bank_name: 'Crédit Mutuel', account_number: '10293847563', iban: null, balance: 35200.00, hidden: 0, type: 'investment', subtype: 'other', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 8, provider: 'powens', provider_account_id: '107', name: 'Prêt Immobilier', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782199', iban: null, balance: -186432.50, hidden: 0, type: 'loan', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 9, provider: 'manual', provider_account_id: null, name: 'Revolut', custom_name: null, bank_name: 'Revolut', account_number: null, iban: null, balance: 842.15, hidden: 0, type: 'checking', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 10, provider: 'manual', provider_account_id: null, name: 'eToro Portfolio', custom_name: null, bank_name: 'eToro', account_number: null, iban: null, balance: 5340.00, hidden: 0, type: 'investment', subtype: 'stocks', usage: 'personal', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: null },
    { id: 11, provider: 'blockchain', provider_account_id: null, name: 'Ledger BTC', custom_name: null, bank_name: null, account_number: null, iban: null, balance: 0.847, hidden: 0, type: 'investment', subtype: 'crypto', usage: 'personal', currency: 'BTC', last_sync: now, blockchain_address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', blockchain_network: 'bitcoin', company_id: null },
    { id: 12, provider: 'blockchain', provider_account_id: null, name: 'MetaMask ETH', custom_name: null, bank_name: null, account_number: null, iban: null, balance: 3.21, hidden: 0, type: 'investment', subtype: 'crypto', usage: 'personal', currency: 'ETH', last_sync: now, blockchain_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18', blockchain_network: 'ethereum', company_id: null },
    { id: 13, provider: 'blockchain', provider_account_id: null, name: 'MetaMask SOL', custom_name: null, bank_name: null, account_number: null, iban: null, balance: 42.5, hidden: 0, type: 'investment', subtype: 'crypto', usage: 'personal', currency: 'SOL', last_sync: now, blockchain_address: '7YQf9h7Q8r4JgLrZr2f9d2rV7qJ5mH2WvA9xq5u8s3Pn', blockchain_network: 'solana', company_id: null },
    { id: 14, provider: 'powens', provider_account_id: '108', name: 'Compte Pro', custom_name: null, bank_name: 'BNP Paribas', account_number: '00040782200', iban: 'FR7630004008900004078220076', balance: 12580.40, hidden: 0, type: 'checking', usage: 'professional', currency: 'EUR', last_sync: now, blockchain_address: null, blockchain_network: null, company_id: 1 },
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

  // Investment transaction templates
  const investTxLabels = [
    { label: 'ACHAT 10 AIR LIQUIDE', amount: -1820, account_id: 5, account_name: 'PEA Actions' },
    { label: 'ACHAT 5 LVMH', amount: -3750, account_id: 5, account_name: 'PEA Actions' },
    { label: 'ACHAT 15 TOTALENERGIES', amount: -870, account_id: 5, account_name: 'PEA Actions' },
    { label: 'ACHAT 3 AM.M.WOR.ETF EUR C', amount: -1560, account_id: 5, account_name: 'PEA Actions' },
    { label: 'VENTE 8 MICHELIN', amount: 2480, account_id: 5, account_name: 'PEA Actions' },
    { label: 'DIVIDENDE AIR LIQUIDE', amount: 42.30, account_id: 5, account_name: 'PEA Actions' },
    { label: 'DIVIDENDE TOTALENERGIES', amount: 28.50, account_id: 5, account_name: 'PEA Actions' },
    { label: 'FRAIS DE COURTAGE', amount: -4.95, account_id: 5, account_name: 'PEA Actions' },
    { label: 'ARBITRAGE FONDS EURO', amount: -5000, account_id: 7, account_name: 'Assurance Vie' },
    { label: 'VERSEMENT MENSUEL', amount: -200, account_id: 7, account_name: 'Assurance Vie' },
    { label: 'INTERETS FONDS EURO', amount: 85.60, account_id: 7, account_name: 'Assurance Vie' },
    { label: 'VERSEMENT PROGRAMME PER', amount: -150, account_id: 6, account_name: 'PER Individuel' },
    { label: 'ACHAT TESLA INC', amount: -890, account_id: 10, account_name: 'eToro Portfolio' },
    { label: 'ACHAT NVIDIA CORP', amount: -1240, account_id: 10, account_name: 'eToro Portfolio' },
    { label: 'VENTE APPLE INC', amount: 650, account_id: 10, account_name: 'eToro Portfolio' },
    { label: 'DIVIDENDE MICROSOFT', amount: 18.40, account_id: 10, account_name: 'eToro Portfolio' },
  ];

  const transactions: any[] = [];
  let txId = 1;

  // Investment transactions (12 months, ~2/week)
  for (let d = 0; d < 365; d += 3 + Math.floor(Math.random() * 5)) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const tmpl = investTxLabels[Math.floor(Math.random() * investTxLabels.length)];
    const variance = 1 + (Math.random() - 0.5) * 0.2;
    transactions.push({
      id: txId++,
      bank_account_id: tmpl.account_id,
      date: date.toISOString().split('T')[0],
      amount: Math.round(tmpl.amount * variance * 100) / 100,
      label: tmpl.label,
      category: 'Investissement',
      account_name: tmpl.account_name,
      account_custom_name: null,
    });
  }

  // Crypto transactions: force a visible non-flat progression in sandbox charts
  const cryptoFlow = [-24, -18, 9, -11, 14, -8, 6, -5, 11, -7, 8, 12];
  for (let i = 0; i < cryptoFlow.length; i++) {
    const date = new Date();
    date.setMonth(date.getMonth() - (cryptoFlow.length - 1 - i));
    const accountId = i % 3 === 0 ? 11 : (i % 3 === 1 ? 12 : 13);
    const label =
      cryptoFlow[i] < 0
        ? (accountId === 11 ? 'ACHAT BTC' : accountId === 12 ? 'ACHAT ETH' : 'ACHAT SOL')
        : (accountId === 11 ? 'VENTE BTC' : accountId === 12 ? 'VENTE ETH' : 'VENTE SOL');
    transactions.push({
      id: txId++,
      bank_account_id: accountId,
      date: date.toISOString().split('T')[0],
      amount: cryptoFlow[i],
      label,
      category: 'Investissement',
      account_name: accountId === 11 ? 'Ledger BTC' : accountId === 12 ? 'MetaMask ETH' : 'MetaMask SOL',
      account_custom_name: null,
    });
  }

  // Banking transactions (80 days)
  for (let d = 0; d < 80; d++) {
    const date = new Date();
    date.setDate(date.getDate() - d);
    const numTx = 1 + Math.floor(Math.random() * 3);
    for (let j = 0; j < numTx && txId <= 250; j++) {
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
      usage: 'personal', company_id: null,
    },
    {
      id: 2, user_id: 1, type: 'real_estate', name: 'Studio Paris 11e',
      purchase_price: 198000, purchase_date: '2022-08-02',
      current_value: 226000, current_value_date: '2026-01-22',
      linked_loan_account_id: null, loan_name: null, loan_balance: null,
      notes: 'Investissement locatif meublé',
      address: '22 Rue Oberkampf 75011 Paris', citycode: '75111',
      latitude: 48.8654, longitude: 2.3782, surface: 27, property_type: 'Appartement',
      estimated_value: 223400, estimated_price_m2: 8274, estimation_date: '2026-02-10',
      property_usage: 'rented_short', monthly_rent: 1450, tenant_name: null,
      costs: [
        { id: 4, label: 'Charges', amount: 95, frequency: 'monthly' },
        { id: 5, label: 'Assurance PNO', amount: 22, frequency: 'monthly' },
      ],
      revenues: [
        { id: 1, label: 'Loyers courte durée', amount: 1450, frequency: 'monthly' },
      ],
      monthly_costs: 117, monthly_revenues: 1450,
      pnl: 28000, pnl_percent: 14.1,
      usage: 'personal', company_id: null,
    },
    {
      id: 3, user_id: 1, type: 'vehicle', name: 'Tesla Model 3',
      purchase_price: 43500, purchase_date: '2023-10-12',
      current_value: 35100, current_value_date: '2026-02-01',
      linked_loan_account_id: null, loan_name: null, loan_balance: null,
      notes: 'Version Grande Autonomie',
      address: null, citycode: null, latitude: null, longitude: null, surface: null, property_type: null,
      estimated_value: null, estimated_price_m2: null, estimation_date: null,
      property_usage: null, monthly_rent: null, tenant_name: null,
      costs: [
        { id: 6, label: 'Assurance auto', amount: 92, frequency: 'monthly' },
      ],
      revenues: [],
      monthly_costs: 92, monthly_revenues: 0,
      pnl: -8400, pnl_percent: -19.3,
      usage: 'personal', company_id: null,
    },
    {
      id: 4, user_id: 1, type: 'real_estate', name: 'Bureau Montreuil',
      purchase_price: 185000, purchase_date: '2024-01-20',
      current_value: 195000, current_value_date: '2026-02-01',
      linked_loan_account_id: null, loan_name: null, loan_balance: null,
      notes: 'Local commercial 45m²',
      address: '8 Rue de Paris 93100 Montreuil', citycode: '93048',
      latitude: 48.8567, longitude: 2.4388, surface: 45, property_type: 'Local commercial',
      estimated_value: 192000, estimated_price_m2: 4267, estimation_date: '2026-02-15',
      property_usage: null, monthly_rent: null, tenant_name: null,
      costs: [
        { id: 7, label: 'Charges', amount: 150, frequency: 'monthly' },
      ],
      revenues: [],
      monthly_costs: 150, monthly_revenues: 0,
      pnl: 10000, pnl_percent: 5.4,
      usage: 'professional', company_id: 1,
    },
  ];

  const investments = [
    { id: 1, bank_account_id: 5, account_name: 'PEA', account_custom_name: 'PEA Actions', label: 'Air Liquide', isin_code: 'FR0000120073', quantity: 22, unit_price: 145, unit_value: 171, valuation: 3762, diff: 572, diff_percent: 17.9, currency: 'EUR' },
    { id: 2, bank_account_id: 10, account_name: 'eToro Portfolio', account_custom_name: null, label: 'NVIDIA', isin_code: 'US67066G1040', quantity: 8, unit_price: 130, unit_value: 148, valuation: 1184, diff: 144, diff_percent: 13.8, currency: 'EUR' },
    { id: 3, bank_account_id: 11, account_name: 'Ledger BTC', account_custom_name: null, label: 'Bitcoin', isin_code: null, quantity: 0.00042, unit_price: 96000, unit_value: 111905, valuation: 47, diff: 7, diff_percent: 17.5, currency: 'EUR' },
    { id: 4, bank_account_id: 12, account_name: 'MetaMask ETH', account_custom_name: null, label: 'Ethereum', isin_code: null, quantity: 0.0032, unit_price: 18400, unit_value: 17188, valuation: 55, diff: -4, diff_percent: -6.8, currency: 'EUR' },
    { id: 5, bank_account_id: 13, account_name: 'MetaMask SOL', account_custom_name: null, label: 'Solana', isin_code: null, quantity: 0.08, unit_price: 290, unit_value: 340, valuation: 27, diff: 4, diff_percent: 17.2, currency: 'EUR' },
  ];

  const preferences = { onboarded: 1, display_currency: 'EUR', crypto_display: 'native', kozy_enabled: 0 };
  const profile = { ...SANDBOX_PROFILE };

  return { accounts, connections, companies, transactions, investments, assets, preferences, profile };
}
