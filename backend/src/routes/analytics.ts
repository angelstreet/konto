import { Hono } from 'hono';
import db from '../db.js';
import { categorizeTransaction } from '../categorizer.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';
import benchmarks from '../../data/benchmarks.json' with { type: 'json' };

const router = new Hono();


// ========== SALARY BENCHMARKS ==========

const SALARY_BENCHMARKS: Record<string, Record<number, { p: number; gross: number }[]>> = {
  FR: {
    2021: [{ p: 10, gross: 13000 }, { p: 25, gross: 18800 }, { p: 50, gross: 25600 }, { p: 75, gross: 36200 }, { p: 90, gross: 50000 }, { p: 95, gross: 62000 }, { p: 99, gross: 95000 }],
    2022: [{ p: 10, gross: 13300 }, { p: 25, gross: 19100 }, { p: 50, gross: 26100 }, { p: 75, gross: 36900 }, { p: 90, gross: 51000 }, { p: 95, gross: 63500 }, { p: 99, gross: 98000 }],
    2023: [{ p: 10, gross: 13500 }, { p: 25, gross: 19500 }, { p: 50, gross: 26400 }, { p: 75, gross: 37500 }, { p: 90, gross: 52000 }, { p: 95, gross: 65000 }, { p: 99, gross: 100000 }],
  },
  CH: {
    2021: [{ p: 10, gross: 37000 }, { p: 25, gross: 54500 }, { p: 50, gross: 79200 }, { p: 75, gross: 107000 }, { p: 90, gross: 136000 }, { p: 95, gross: 160000 }, { p: 99, gross: 205000 }],
    2022: [{ p: 10, gross: 38000 }, { p: 25, gross: 56000 }, { p: 50, gross: 81456 }, { p: 75, gross: 110000 }, { p: 90, gross: 140000 }, { p: 95, gross: 165000 }, { p: 99, gross: 210000 }],
    2023: [{ p: 10, gross: 39000 }, { p: 25, gross: 57500 }, { p: 50, gross: 83000 }, { p: 75, gross: 112000 }, { p: 90, gross: 143000 }, { p: 95, gross: 168000 }, { p: 99, gross: 215000 }],
  },
  US: {
    2021: [{ p: 10, gross: 20000 }, { p: 25, gross: 32000 }, { p: 50, gross: 52000 }, { p: 75, gross: 82000 }, { p: 90, gross: 118000 }, { p: 95, gross: 150000 }, { p: 99, gross: 230000 }],
    2022: [{ p: 10, gross: 21000 }, { p: 25, gross: 33500 }, { p: 50, gross: 54000 }, { p: 75, gross: 86000 }, { p: 90, gross: 124000 }, { p: 95, gross: 157000 }, { p: 99, gross: 240000 }],
    2023: [{ p: 10, gross: 22000 }, { p: 25, gross: 35000 }, { p: 50, gross: 58000 }, { p: 75, gross: 90000 }, { p: 90, gross: 130000 }, { p: 95, gross: 165000 }, { p: 99, gross: 250000 }],
  },
  UK: {
    2021: [{ p: 10, gross: 14200 }, { p: 25, gross: 21800 }, { p: 50, gross: 31285 }, { p: 75, gross: 47000 }, { p: 90, gross: 68000 }, { p: 95, gross: 87000 }, { p: 99, gross: 150000 }],
    2022: [{ p: 10, gross: 14800 }, { p: 25, gross: 22500 }, { p: 50, gross: 32300 }, { p: 75, gross: 49000 }, { p: 90, gross: 71000 }, { p: 95, gross: 91000 }, { p: 99, gross: 155000 }],
    2023: [{ p: 10, gross: 15000 }, { p: 25, gross: 23000 }, { p: 50, gross: 35000 }, { p: 75, gross: 52000 }, { p: 90, gross: 75000 }, { p: 95, gross: 95000 }, { p: 99, gross: 160000 }],
  },
  DE: {
    2021: [{ p: 10, gross: 19200 }, { p: 25, gross: 28800 }, { p: 50, gross: 42600 }, { p: 75, gross: 58500 }, { p: 90, gross: 78000 }, { p: 95, gross: 97000 }, { p: 99, gross: 145000 }],
    2022: [{ p: 10, gross: 19600 }, { p: 25, gross: 29400 }, { p: 50, gross: 43200 }, { p: 75, gross: 59200 }, { p: 90, gross: 79000 }, { p: 95, gross: 98500 }, { p: 99, gross: 147000 }],
    2023: [{ p: 10, gross: 20000 }, { p: 25, gross: 30000 }, { p: 50, gross: 43750 }, { p: 75, gross: 60000 }, { p: 90, gross: 80000 }, { p: 95, gross: 100000 }, { p: 99, gross: 150000 }],
  },
};

router.get('/api/salary-benchmarks', (c) => {
  return c.json(SALARY_BENCHMARKS);
});

// Helper functions
function getBenchmarkPercentile(value: number, distro: Record<string, number>): number {
  const ps = Object.keys(distro).filter(k => k.startsWith('p')).sort((a, b) => parseFloat(a.slice(1)) - parseFloat(b.slice(1)));
  for (let i = 0; i < ps.length - 1; i++) {
    const p1 = parseFloat(ps[i].slice(1));
    const p2 = parseFloat(ps[i + 1].slice(1));
    const v1 = distro[ps[i]];
    const v2 = distro[ps[i + 1]];
    if (value >= v1 && value < v2) {
      return Math.round(p1 + (value - v1) / (v2 - v1) * (p2 - p1));
    }
  }
  if (value < distro[ps[0]]) return parseFloat(ps[0].slice(1));
  return 99;
}

function computeEmpiricalPercentile(value: number, values: number[]): number {
  if (values.length === 0) return 50;
  const lowerCount = values.filter((v: number) => v < value).length;
  return Math.round((lowerCount / values.length) * 100);
}

router.get('/api/ranking', async (c) => {
  const scope = c.req.query('scope') || 'world';
  const countryParam = c.req.query('country')?.toUpperCase();
  if (!['world', 'country', 'konto'].includes(scope)) {
    return c.json({ error: 'Invalid scope: world|country|konto' }, 400);
  }

  const userId = await getUserId(c);

  // Save country selection if provided
  if (countryParam && ['FR', 'DE', 'CH', 'US', 'CN'].includes(countryParam)) {
    await db.execute(
      "INSERT INTO user_profiles (user_id, country) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET country = ?",
      [userId, countryParam, countryParam]
    );
  }

  // User country (default to FR if not set)
  const profileRes = await db.execute('SELECT country FROM user_profiles WHERE user_id = ?', [userId]);
  const userCountry = String(profileRes.rows[0]?.country || 'FR').toUpperCase();

  // User net_worth: latest total snapshot
  const snapshotRes = await db.execute(
    "SELECT total_value FROM patrimoine_snapshots WHERE user_id = ? AND category = 'total' ORDER BY date DESC LIMIT 1",
    [userId]
  );
  const net_worth = Number(snapshotRes.rows[0]?.total_value) || 0;

  // User income: avg gross_annual
  const incomeRes = await db.execute(
    'SELECT AVG(gross_annual) as avg FROM income_entries WHERE user_id = ? GROUP BY user_id',
    [userId]
  );
  const income = Number(incomeRes.rows[0]?.avg) || 0;

  // User savings_rate: last 365 days personal tx
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const txRes = await db.execute(
    `SELECT amount FROM transactions t 
     JOIN bank_accounts ba ON t.bank_account_id = ba.id 
     WHERE ba.user_id = ? AND ba.usage = 'personal' AND date >= ?`,
    [userId, oneYearAgo]
  );
  let sum_pos = 0;
  let sum_neg = 0;
  for (const row of txRes.rows as any[]) {
    const amt = Number(row.amount);
    if (amt > 0) sum_pos += amt;
    else sum_neg += amt;
  }
  const savings_rate = sum_pos > 100 ? Math.round(((sum_pos + sum_neg) / sum_pos) * 100) : 0;

  let refs: any = null;
  const percentiles: Record<string, number> = {
    net_worth: 0,
    income: 0,
    savings_rate: 0,
  };

  if (scope === 'konto') {
    // Check user count
    const countRes = await db.execute(
      "SELECT COUNT(DISTINCT user_id) as cnt FROM bank_accounts WHERE usage = 'personal'"
    );
    const totalUsers = Number(countRes.rows[0]?.cnt || 0);
    if (totalUsers < 10) {
      return c.json({ available: false, message: 'Not enough users yet' });
    }

    // Other users net_worth
    const nwRes = await db.execute(
      `SELECT (SELECT total_value FROM patrimoine_snapshots ps WHERE ps.user_id = ba.user_id AND ps.category = 'total' ORDER BY ps.date DESC LIMIT 1) as nw
       FROM (SELECT DISTINCT user_id FROM bank_accounts WHERE usage = 'personal' AND user_id != ?) ba
       WHERE nw IS NOT NULL`,
      [userId]
    );
    const otherNetWorths = (nwRes.rows as any[]).map(r => Number(r.nw)).filter(v => !isNaN(v));

    // Other incomes
    const incRes = await db.execute(
      `SELECT AVG(gross_annual) as avg FROM income_entries ie 
       JOIN (SELECT DISTINCT user_id FROM bank_accounts WHERE usage = 'personal' AND user_id != ?) u ON ie.user_id = u.user_id
       GROUP BY ie.user_id
       HAVING avg IS NOT NULL`,
      [userId]
    );
    const otherIncomes = (incRes.rows as any[]).map(r => Number(r.avg)).filter(v => !isNaN(v));

    // Other savings_rates
    const srRes = await db.execute(
      `SELECT 
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as pos,
        SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as neg
       FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
       WHERE ba.usage = 'personal' AND t.date >= ? AND ba.user_id != ?
       GROUP BY ba.user_id
       HAVING pos > 100`,
      [oneYearAgo, userId]
    );
    const otherSRs = (srRes.rows as any[]).map(r => {
      const pos = Number(r.pos);
      const neg = Number(r.neg);
      return Math.round(((pos + neg) / pos) * 100);
    });

    percentiles.net_worth = computeEmpiricalPercentile(net_worth, otherNetWorths);
    percentiles.income = computeEmpiricalPercentile(income, otherIncomes);
    percentiles.savings_rate = computeEmpiricalPercentile(savings_rate, otherSRs);
  } else {
    let bench: any;
    if (scope === 'world') {
      const countries = Object.keys(benchmarks).filter((k: string) => k !== '_meta');
      const worldBench: Record<string, any> = { net_worth: {}, income: {}, savings_rate: {} };
      for (const metric of ['net_worth', 'income', 'savings_rate']) {
        for (const p of ['p10', 'p25', 'p50', 'p75', 'p90', 'p95', 'p99']) {
          let sum = 0;
          for (const country of countries) {
            sum += (benchmarks as Record<string,any>)[country][metric][p];
          }
          worldBench[metric][p] = sum / countries.length;
        }
      }
      bench = worldBench;
    } else {
      if (!userCountry || !(benchmarks as Record<string,any>)[userCountry]) {
        return c.json({ error: 'Set your country first (FR, DE, CH, US, CN)' }, 400);
      }
      bench = (benchmarks as Record<string,any>)[userCountry];
    }

    percentiles.net_worth = getBenchmarkPercentile(net_worth, bench.net_worth);
    percentiles.income = getBenchmarkPercentile(income, bench.income);
    percentiles.savings_rate = getBenchmarkPercentile(savings_rate, bench.savings_rate);
    refs = {
          net_worth: {
            min: bench.net_worth.p10,
            p25: bench.net_worth.p25,
            median: bench.net_worth.p50,
            p75: bench.net_worth.p75,
            max: bench.net_worth.p99,
          },
          income: {
            min: bench.income.p10,
            p25: bench.income.p25,
            median: bench.income.p50,
            p75: bench.income.p75,
            max: bench.income.p99,
          },
          savings_rate: {
            min: bench.savings_rate.p10,
            p25: bench.savings_rate.p25,
            median: bench.savings_rate.p50,
            p75: bench.savings_rate.p75,
            max: bench.savings_rate.p99,
          },
        };
  }

  return c.json({
    user: { net_worth, income, savings_rate },
    percentiles, ...(refs ? { refs } : {}),
    scope,
    user_country: userCountry || null,
    available: true
  });
});


// ========== ANALYTICS ==========

async function computeAnalytics(period: string, userId: number = 1, scope?: { usage?: string; company_id?: string }) {
  const [year, month] = period.split('-').map(Number);
  const startDate = `${period}-01`;
  const endDate = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;

  // Build scope filter (all queries JOIN ba via t.bank_account_id)
  let scopeClause = '';
  const scopeArgs: any[] = [];
  if (scope?.usage === 'personal') { scopeClause = " AND (ba.usage = 'personal' OR ba.usage IS NULL)"; }
  else if (scope?.usage === 'professional') { scopeClause = " AND ba.usage = 'professional'"; }
  else if (scope?.company_id) { scopeClause = ' AND ba.company_id = ?'; scopeArgs.push(scope.company_id); }

  const join = 'LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id';

  // Total income & expenses for the period
  const incomeRes = await db.execute({
    sql: `SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t ${join}
          WHERE t.date >= ? AND t.date < ? AND t.amount > 0${scopeClause}`,
    args: [startDate, endDate, ...scopeArgs]
  });
  const expenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total FROM transactions t ${join}
          WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}`,
    args: [startDate, endDate, ...scopeArgs]
  });

  const totalIncome = Number(incomeRes.rows[0]?.total || 0);
  const totalExpenses = Number(expenseRes.rows[0]?.total || 0);
  const savingsRate = totalIncome > 0 ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 100) : 0;

  // Top 5 expense categories
  const topCatsRes = await db.execute({
    sql: `SELECT COALESCE(t.category, 'Non catégorisé') as category, SUM(ABS(t.amount)) as total
          FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}
          GROUP BY t.category ORDER BY total DESC LIMIT 5`,
    args: [startDate, endDate, ...scopeArgs]
  });
  const topCategories = topCatsRes.rows.map((r: any) => ({
    category: r.category,
    amount: Number(r.total),
    percentage: totalExpenses > 0 ? Math.round((Number(r.total) / totalExpenses) * 100) : 0,
  }));

  // Previous month for MoM
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const prevStart = `${prevPeriod}-01`;
  const prevEnd = prevMonth === 12 ? `${prevYear + 1}-01-01` : `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-01`;

  const prevIncomeRes = await db.execute({
    sql: `SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount > 0${scopeClause}`,
    args: [prevStart, prevEnd, ...scopeArgs]
  });
  const prevExpenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}`,
    args: [prevStart, prevEnd, ...scopeArgs]
  });
  const prevIncome = Number(prevIncomeRes.rows[0]?.total || 0);
  const prevExpenses = Number(prevExpenseRes.rows[0]?.total || 0);

  const momIncome = prevIncome > 0 ? Math.round(((totalIncome - prevIncome) / prevIncome) * 100) : 0;
  const momExpenses = prevExpenses > 0 ? Math.round(((totalExpenses - prevExpenses) / prevExpenses) * 100) : 0;

  // YoY
  const yoyPeriod = `${year - 1}-${String(month).padStart(2, '0')}`;
  const yoyStart = `${yoyPeriod}-01`;
  const yoyEnd = month === 12 ? `${year}-01-01` : `${year - 1}-${String(month + 1).padStart(2, '0')}-01`;

  const yoyIncomeRes = await db.execute({
    sql: `SELECT COALESCE(SUM(t.amount), 0) as total FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount > 0${scopeClause}`,
    args: [yoyStart, yoyEnd, ...scopeArgs]
  });
  const yoyExpenseRes = await db.execute({
    sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as total FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}`,
    args: [yoyStart, yoyEnd, ...scopeArgs]
  });
  const yoyIncome = Number(yoyIncomeRes.rows[0]?.total || 0);
  const yoyExpenses = Number(yoyExpenseRes.rows[0]?.total || 0);

  // Recurring expenses (labels appearing 2+ months in last 3 months)
  const threeMonthsAgo = month <= 3
    ? `${year - 1}-${String(12 + month - 3).padStart(2, '0')}-01`
    : `${year}-${String(month - 3).padStart(2, '0')}-01`;

  const recurringRes = await db.execute({
    sql: `SELECT t.label, COUNT(DISTINCT strftime('%Y-%m', t.date)) as months, AVG(ABS(t.amount)) as avg_amount
          FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0 AND t.label IS NOT NULL${scopeClause}
          GROUP BY LOWER(t.label) HAVING months >= 2 ORDER BY avg_amount DESC LIMIT 10`,
    args: [threeMonthsAgo, endDate, ...scopeArgs]
  });
  const recurring = recurringRes.rows.map((r: any) => ({
    label: r.label,
    avgAmount: Math.round(Number(r.avg_amount) * 100) / 100,
    months: Number(r.months),
  }));

  // Spending trends (last 6 months)
  const trends = [];
  for (let i = 5; i >= 0; i--) {
    let m = month - i;
    let y = year;
    while (m <= 0) { m += 12; y--; }
    const p = `${y}-${String(m).padStart(2, '0')}`;
    const s = `${p}-01`;
    const e = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const inc = await db.execute({ sql: `SELECT COALESCE(SUM(t.amount), 0) as t FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount > 0${scopeClause}`, args: [s, e, ...scopeArgs] });
    const exp = await db.execute({ sql: `SELECT COALESCE(SUM(ABS(t.amount)), 0) as t FROM transactions t ${join} WHERE t.date >= ? AND t.date < ? AND t.amount < 0${scopeClause}`, args: [s, e, ...scopeArgs] });
    trends.push({ period: p, income: Number(inc.rows[0]?.t || 0), expenses: Number(exp.rows[0]?.t || 0) });
  }

  const metrics = {
    totalIncome, totalExpenses, savingsRate,
    topCategories, recurring, trends,
    mom: { income: momIncome, expenses: momExpenses },
    yoy: { income: yoyIncome, expenses: yoyExpenses, incomeChange: yoyIncome > 0 ? Math.round(((totalIncome - yoyIncome) / yoyIncome) * 100) : 0, expensesChange: yoyExpenses > 0 ? Math.round(((totalExpenses - yoyExpenses) / yoyExpenses) * 100) : 0 },
  };

  return { ...metrics, computed_at: new Date().toISOString() };
}

router.get('/api/analytics', async (c) => {
  const period = c.req.query('period') || new Date().toISOString().slice(0, 7);
  const userId = await getUserId(c);
  const usage = c.req.query('usage');
  const company_id = c.req.query('company_id');
  const scope = usage || company_id ? { usage: usage || undefined, company_id: company_id || undefined } : undefined;
  const result = await computeAnalytics(period, userId, scope);
  return c.json({ ...result, cached: false });
});


// ========== TRENDS — Universal Category Mapping + Anomaly Detection ==========

const CATEGORY_MAP: Record<string, string[]> = {
  'Énergie': ['edf', 'engie', 'electricite', 'électricité', 'gaz', 'gasoil', 'fioul', 'total energies', 'totalenergies', 'direct energie'],
  'Alimentation': ['carrefour', 'leclerc', 'auchan', 'lidl', 'aldi', 'intermarche', 'monoprix', 'picard', 'franprix', 'casino', 'super u', 'match', 'cora', 'spar', 'biocoop', 'naturalia', 'boulangerie', 'patisserie', 'restaurant', 'mcdo', 'burger', 'kebab', 'sushi', 'pizza', 'uber eats', 'deliveroo', 'just eat'],
  'Eau': ['eau', 'veolia', 'suez', 'lyonnaise des eaux', 'saur'],
  'Transport': ['essence', 'shell', 'bp ', 'sncf', 'ratp', 'navigo', 'uber', 'bolt', 'taxi', 'parking', 'stationnement', 'peage', 'péage', 'autoroute', 'vinci autoroute'],
  'Impôts & Taxes': ['impot', 'impôt', 'dgfip', 'tresor public', 'trésor public', 'taxe', 'prelevement a la source', 'urssaf', 'direction generale'],
  'Assurances': ['axa', 'maif', 'macif', 'matmut', 'groupama', 'allianz', 'generali', 'assurance', 'mutuelle', 'harmonie', 'mgen'],
  'Internet & Mobile': ['bouygues telecom', 'orange', 'sfr', 'free ', 'free mobile', 'sosh', 'red by sfr', 'b&you'],
  'Habillement': ['zara', 'h&m', 'kiabi', 'decathlon', 'nike', 'adidas', 'primark', 'uniqlo', 'celio', 'jules'],
  'Loisirs': ['netflix', 'spotify', 'disney', 'canal+', 'amazon prime', 'cinema', 'cinéma', 'fnac', 'cultura', 'jeux', 'playstation', 'xbox', 'steam', 'apple.com/bill'],
  'Loyers & Charges': ['loyer', 'copropriete', 'copropriété', 'syndic', 'foncia', 'nexity', 'credit immobilier', 'crédit immobilier', 'pret immobilier', 'prêt immobilier', 'emprunt', 'mortgage'],
};

function classifyTransaction(label: string): string {
  const lower = (label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lowerOrig = (label || '').toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_MAP)) {
    for (const kw of keywords) {
      if (lowerOrig.includes(kw) || lower.includes(kw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
        return cat;
      }
    }
  }
  return 'Autre';
}

router.get('/api/trends', async (c) => {
  const months = parseInt(c.req.query('months') || '6');
  const scope = c.req.query('usage') || c.req.query('scope') || 'personal'; // personal or professional
  const companyId = c.req.query('company_id') ? parseInt(c.req.query('company_id')!) : null;
  const userId = await getUserId(c);

  // Get date range
  const now = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const fromStr = fromDate.toISOString().split('T')[0];

  const companyFilter = companyId ? ' AND ba.company_id = ?' : '';
  const args: (string | number)[] = [fromStr, scope, userId];
  if (companyId) args.push(companyId);

  const result = await db.execute({
    sql: `SELECT t.date, t.amount, t.label, ba.usage
          FROM transactions t
          LEFT JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE t.date >= ? AND ba.usage = ? AND t.amount < 0 AND ba.user_id = ?${companyFilter}
          ORDER BY t.date`,
    args
  });

  // Group by category + month
  const grouped: Record<string, Record<string, number>> = {};
  for (const tx of result.rows as any[]) {
    const cat = classifyTransaction(tx.label);
    const month = tx.date?.substring(0, 7);
    if (!month) continue;
    if (!grouped[cat]) grouped[cat] = {};
    if (!grouped[cat][month]) grouped[cat][month] = 0;
    grouped[cat][month] += Math.abs(tx.amount);
  }

  // Build result with anomaly detection
  const allMonths: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
    allMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const categories: {
    category: string;
    totalSpend: number;
    months: { month: string; amount: number; avgLast3: number | null; changePercent: number | null }[];
  }[] = [];

  for (const [cat, monthData] of Object.entries(grouped)) {
    let totalSpend = 0;
    const monthEntries = allMonths.map((m, idx) => {
      const amount = monthData[m] || 0;
      totalSpend += amount;

      // Rolling 3-month average (from previous months)
      let avgLast3: number | null = null;
      let changePercent: number | null = null;
      if (idx >= 3) {
        const prev3 = [allMonths[idx - 1], allMonths[idx - 2], allMonths[idx - 3]];
        const avg = prev3.reduce((s, pm) => s + (monthData[pm] || 0), 0) / 3;
        avgLast3 = Math.round(avg * 100) / 100;
        if (avg > 0) {
          changePercent = Math.round(((amount - avg) / avg) * 100);
        }
      }

      return { month: m, amount: Math.round(amount * 100) / 100, avgLast3, changePercent };
    });

    categories.push({ category: cat, totalSpend: Math.round(totalSpend * 100) / 100, months: monthEntries });
  }

  // Sort by total spend descending, return top 6
  categories.sort((a, b) => b.totalSpend - a.totalSpend);

  return c.json({ categories: categories.slice(0, 6), allMonths, scope });
});


// ========== ANALYSIS ENDPOINTS ==========

router.get('/api/analysis/categories', async (c) => {
  const userId = await getUserId(c);
  const months = parseInt(c.req.query('months') || '6');
  const usage = c.req.query('usage');

  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - months);
  const fromStr = fromDate.toISOString().split('T')[0];

  let where = 'ba.user_id = ? AND t.date >= ?';
  const params: any[] = [userId, fromStr];
  if (usage === 'personal') { where += ' AND ba.usage = ?'; params.push('personal'); }
  else if (usage === 'professional') { where += ' AND ba.usage = ?'; params.push('professional'); }

  const txs = await db.execute({
    sql: `SELECT t.amount, t.label FROM transactions t
          JOIN bank_accounts ba ON t.bank_account_id = ba.id
          WHERE ${where} AND t.amount < 0`,
    args: params,
  });

  const catMap = new Map<string, { icon: string; color: string; total: number; count: number }>();
  let uncatTotal = 0, uncatCount = 0;

  for (const row of txs.rows as any[]) {
    const cat = categorizeTransaction(row.label || '');
    if (cat.category === 'autre') {
      uncatTotal += row.amount;
      uncatCount++;
    } else {
      if (!catMap.has(cat.category)) catMap.set(cat.category, { icon: cat.icon, color: cat.color, total: 0, count: 0 });
      const entry = catMap.get(cat.category)!;
      entry.total += row.amount;
      entry.count++;
    }
  }

  const allExpenses = (txs.rows as any[]).reduce((s: number, r: any) => s + r.amount, 0);
  const categories = [...catMap.entries()].map(([name, v]) => ({
    name, icon: v.icon, color: v.color,
    total: Math.round(v.total * 100) / 100,
    count: v.count,
    pct: allExpenses !== 0 ? Math.round((v.total / allExpenses) * 100) : 0,
  })).sort((a, b) => a.total - b.total);

  return c.json({
    categories,
    uncategorized: {
      total: Math.round(uncatTotal * 100) / 100,
      count: uncatCount,
      pct: allExpenses !== 0 ? Math.round((uncatTotal / allExpenses) * 100) : 0,
    },
    period: { from: fromStr, to: new Date().toISOString().split('T')[0] },
  });
});

router.get('/api/analysis/subscriptions', async (c) => {
  const userId = await getUserId(c);
  const usage = c.req.query('usage');

  let where = 'ba.user_id = ?';
  const params: any[] = [userId];
  if (usage === 'personal') { where += ' AND ba.usage = ?'; params.push('personal'); }
  else if (usage === 'professional') { where += ' AND ba.usage = ?'; params.push('professional'); }

  const txs = await db.execute({
    sql: `SELECT t.amount, t.label, t.date FROM transactions t
          JOIN bank_accounts ba ON t.bank_account_id = ba.id
          WHERE ${where} AND t.amount < 0
          ORDER BY t.date DESC`,
    args: params,
  });

  // Group by cleaned merchant name (first 3+ words, uppercased)
  const merchantMap = new Map<string, { amounts: number[]; dates: string[]; label: string }>();
  for (const row of txs.rows as any[]) {
    const label = (row.label || '').trim().toUpperCase();
    // Extract merchant: take first 2 meaningful words
    const words = label.replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const key = words.slice(0, 2).join(' ') || label.slice(0, 20);
    if (!merchantMap.has(key)) merchantMap.set(key, { amounts: [], dates: [], label: row.label });
    const entry = merchantMap.get(key)!;
    entry.amounts.push(row.amount);
    entry.dates.push(row.date);
  }

  const subscriptions: any[] = [];
  for (const [merchant, data] of merchantMap.entries()) {
    if (data.amounts.length < 2) continue;

    // Check if amounts are within ±10% of each other
    const avgAmount = data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length;
    const allSimilar = data.amounts.every(a => Math.abs(a - avgAmount) / Math.abs(avgAmount) <= 0.1);
    if (!allSimilar) continue;

    // Determine frequency: monthly if dates span with ~30d intervals, yearly if ~365d
    const sortedDates = [...data.dates].sort();
    let frequency: 'monthly' | 'yearly' | null = null;
    if (sortedDates.length >= 2) {
      const first = new Date(sortedDates[0]).getTime();
      const last = new Date(sortedDates[sortedDates.length - 1]).getTime();
      const avgDays = (last - first) / (sortedDates.length - 1) / 86400000;
      if (avgDays >= 25 && avgDays <= 35) frequency = 'monthly';
      else if (avgDays >= 340 && avgDays <= 390) frequency = 'yearly';
    }
    if (!frequency) continue;

    const cat = categorizeTransaction(data.label);
    const monthlyAmount = frequency === 'yearly' ? avgAmount / 12 : avgAmount;
    subscriptions.push({
      merchant,
      amount: Math.round(avgAmount * 100) / 100,
      frequency,
      category: cat.category,
      icon: cat.icon,
      color: cat.color,
      lastDate: sortedDates[sortedDates.length - 1],
      totalYearly: Math.round(monthlyAmount * 12 * 100) / 100,
      dates: sortedDates,
    });
  }

  const totalMonthly = subscriptions.reduce((s, sub) => s + (sub.frequency === 'monthly' ? sub.amount : sub.amount / 12), 0);
  const totalYearly = subscriptions.reduce((s, sub) => s + sub.totalYearly, 0);

  return c.json({
    subscriptions: subscriptions.sort((a, b) => a.amount - b.amount),
    totalMonthly: Math.round(totalMonthly * 100) / 100,
    totalYearly: Math.round(totalYearly * 100) / 100,
    count: subscriptions.length,
  });
});

router.get('/api/analysis/summary', async (c) => {
  const userId = await getUserId(c);
  const usage = c.req.query('usage');

  // Current month boundaries
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];

  let where = 'ba.user_id = ?';
  const params: any[] = [userId];
  if (usage === 'personal') { where += ' AND ba.usage = ?'; params.push('personal'); }
  else if (usage === 'professional') { where += ' AND ba.usage = ?'; params.push('professional'); }

  const [currentTxs, prevTxs] = await Promise.all([
    db.execute({
      sql: `SELECT t.amount, t.label FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ${where} AND t.date >= ?`,
      args: [...params, monthStart],
    }),
    db.execute({
      sql: `SELECT t.amount FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ${where} AND t.date >= ? AND t.date < ?`,
      args: [...params, prevMonthStart, monthStart],
    }),
  ]);

  let income = 0, expenses = 0;
  const catTotals = new Map<string, number>();
  for (const row of currentTxs.rows as any[]) {
    if (row.amount > 0) income += row.amount;
    else {
      expenses += row.amount;
      const cat = categorizeTransaction(row.label || '');
      catTotals.set(cat.category, (catTotals.get(cat.category) || 0) + row.amount);
    }
  }

  const topCategory = [...catTotals.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] || null;

  const prevTotal = (prevTxs.rows as any[]).reduce((s: number, r: any) => s + r.amount, 0);
  const currentNet = income + expenses;
  const trend = prevTotal !== 0 ? `${currentNet >= prevTotal ? '+' : ''}${Math.round(((currentNet - prevTotal) / Math.abs(prevTotal)) * 100)}%` : '—';

  // Subscriptions count (simplified: just count distinct monthly merchants from last 2 months)
  const sub2mo = await db.execute({
    sql: `SELECT t.label, t.amount FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
          WHERE ${where} AND t.amount < 0 AND t.date >= ?`,
    args: [...params, prevMonthStart],
  });
  // Group label -> amounts, keep those appearing in both months
  const subMap = new Map<string, number[]>();
  for (const r of sub2mo.rows as any[]) {
    const key = (r.label || '').trim().toUpperCase().split(/\s+/).slice(0, 2).join(' ');
    if (!subMap.has(key)) subMap.set(key, []);
    subMap.get(key)!.push(r.amount);
  }
  let subCount = 0, subMonthly = 0;
  for (const [, amounts] of subMap.entries()) {
    if (amounts.length >= 2) { subCount++; subMonthly += amounts[0]; }
  }

  return c.json({
    budget: {
      income: Math.round(income * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      top_category: topCategory,
    },
    subscriptions: {
      count: subCount,
      monthly: Math.round(subMonthly * 100) / 100,
    },
    cashflow: {
      current_month: Math.round(currentNet * 100) / 100,
      trend,
    },
  });
});

router.get('/api/analysis/cashflow', async (c) => {
  const userId = await getUserId(c);
  const usage = c.req.query('usage');
  const monthParam = c.req.query('month'); // e.g. 2026-02

  let year: number, month: number;
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    [year, month] = monthParam.split('-').map(Number);
  } else {
    const now = new Date();
    year = now.getFullYear();
    month = now.getMonth() + 1;
  }

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  let where = 'ba.user_id = ?';
  const params: any[] = [userId];
  if (usage === 'personal') { where += ' AND ba.usage = ?'; params.push('personal'); }
  else if (usage === 'professional') { where += ' AND ba.usage = ?'; params.push('professional'); }

  const txs = await db.execute({
    sql: `SELECT strftime('%Y-%m-%d', t.date) as day, t.amount
          FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id
          WHERE ${where} AND t.date >= ? AND t.date <= ?`,
    args: [...params, from, to],
  });

  const dayMap = new Map<string, { income: number; expense: number }>();
  for (const row of txs.rows as any[]) {
    const day = row.day as string;
    if (!dayMap.has(day)) dayMap.set(day, { income: 0, expense: 0 });
    const entry = dayMap.get(day)!;
    if (row.amount > 0) entry.income += row.amount;
    else entry.expense += row.amount;
  }

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const entry = dayMap.get(date) || { income: 0, expense: 0 };
    days.push({
      date,
      income: Math.round(entry.income * 100) / 100,
      expense: Math.round(entry.expense * 100) / 100,
      net: Math.round((entry.income + entry.expense) * 100) / 100,
    });
  }

  return c.json({ month: from.slice(0, 7), days });
});


// ========== PASSIVE INCOME ANALYSIS ==========

router.get('/api/analysis/passive-income', async (c) => {
  const userId = await getUserId(c);
  const usage = c.req.query('usage');
  const yearParam = c.req.query('year');
  const now = new Date();
  const selectedYear = yearParam ? parseInt(yearParam) : now.getFullYear();
  const isPastYear = selectedYear < now.getFullYear();

  // 1. Rental income from assets
  let assetWhere = 'user_id = ?';
  const assetParams: any[] = [userId];
  if (usage === 'personal') { assetWhere += " AND (usage = 'personal' OR usage IS NULL)"; }
  else if (usage === 'professional') { assetWhere += " AND usage = 'professional'"; }

  const assetsRes = await db.execute({
    sql: `SELECT id, name, type, current_value, purchase_price, monthly_rent FROM assets WHERE ${assetWhere} AND type = 'real_estate'`,
    args: assetParams,
  });
  const assets = assetsRes.rows as any[];

  // 2. Investment income (dividends/interest)
  let invWhere = 'ba.user_id = ?';
  const invParams: any[] = [userId];
  if (usage === 'personal') { invWhere += " AND ba.usage = 'personal'"; }
  else if (usage === 'professional') { invWhere += " AND ba.usage = 'professional'"; }

  const invRes = await db.execute({
    sql: `SELECT i.label, i.valuation, i.code_type FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id WHERE ${invWhere}`,
    args: invParams,
  });
  const investments = invRes.rows as any[];

  // Compute rental monthly
  const rentalItems = assets.map((a: any) => {
    const monthly = a.monthly_rent ? Number(a.monthly_rent) : Math.round((Number(a.current_value || a.purchase_price || 0)) * 0.004);
    return { source: a.name, type: 'rental', amount: monthly };
  });
  const rentalMonthly = rentalItems.reduce((s: number, r: any) => s + r.amount, 0);

  // Compute dividend monthly (2% annual yield / 12)
  const divItems = investments.map((inv: any) => {
    const valuation = Number(inv.valuation || 0);
    const monthly = Math.round((valuation * 0.02) / 12);
    return { source: inv.label || 'Investissement', type: 'dividend', amount: monthly };
  });
  const divMonthly = divItems.reduce((s: number, d: any) => s + d.amount, 0);

  const totalMonthly = rentalMonthly + divMonthly;
  const totalYearly = totalMonthly * 12;

  // Compute yield
  const totalAssetValue = assets.reduce((s: number, a: any) => s + Number(a.current_value || a.purchase_price || 0), 0);
  const totalInvValue = investments.reduce((s: number, i: any) => s + Number(i.valuation || 0), 0);
  const totalBase = totalAssetValue + totalInvValue;
  const yieldPct = totalBase > 0 ? Math.round((totalYearly / totalBase) * 1000) / 10 : 0;

  // Build received (all past months of selectedYear) and upcoming (future months of selectedYear)
  const upcoming: any[] = [];
  const received: any[] = [];

  for (let mo = 1; mo <= 12; mo++) {
    const rentDate = new Date(selectedYear, mo - 1, 5);
    const divDate = new Date(selectedYear, mo - 1, 15);
    const monthStr = `${selectedYear}-${String(mo).padStart(2, '0')}`;

    const rentIsFuture = rentDate > now;
    const divIsFuture = divDate > now;

    // Rental: monthly
    for (const r of rentalItems) {
      const dateStr = `${monthStr}-05`;
      if (rentIsFuture) {
        upcoming.push({ source: r.source, type: r.type, amount: r.amount, date: dateStr });
      } else {
        received.push({ source: r.source, type: r.type, amount: r.amount, date: dateStr });
      }
    }

    // Dividends: quarterly (months 3, 6, 9, 12)
    if (mo % 3 === 0) {
      for (const d2 of divItems) {
        if (d2.amount > 0) {
          const dateStr = `${monthStr}-15`;
          if (divIsFuture) {
            upcoming.push({ source: d2.source, type: d2.type, amount: d2.amount * 3, date: dateStr });
          } else {
            received.push({ source: d2.source, type: d2.type, amount: d2.amount * 3, date: dateStr });
          }
        }
      }
    }
  }

  upcoming.sort((a: any, b: any) => a.date.localeCompare(b.date));
  received.sort((a: any, b: any) => b.date.localeCompare(a.date));

  // By source breakdown
  const bySource: any[] = [];
  if (rentalMonthly > 0) bySource.push({ type: 'rental', label: 'Immobilier', monthly: Math.round(rentalMonthly), pct: totalMonthly > 0 ? Math.round((rentalMonthly / totalMonthly) * 100) : 0 });
  if (divMonthly > 0) bySource.push({ type: 'dividend', label: 'Dividendes', monthly: Math.round(divMonthly), pct: totalMonthly > 0 ? Math.round((divMonthly / totalMonthly) * 100) : 0 });

  return c.json({
    monthly: Math.round(totalMonthly),
    yearly: Math.round(totalYearly),
    yield_pct: yieldPct,
    year: selectedYear,
    is_past_year: isPastYear,
    upcoming,
    received,
    by_source: bySource,
  });
});



export default router;
