import { Hono } from 'hono';
import db from '../db.js';
import { encrypt, decrypt } from '../crypto.js';
import { getUserId, decryptBankConn, decryptCoinbaseConn, decryptBinanceConn, decryptDriveConn,
         POWENS_CLIENT_ID, POWENS_CLIENT_SECRET, POWENS_DOMAIN, POWENS_API, REDIRECT_URI,
         classifyAccountType, classifyAccountSubtype, classifyAccountUsage, extractPowensBankMeta,
         refreshPowensToken, getDriveAccessToken, sha256, generateApiKey, getClientIP,
         calcInvestmentDiff, calcInvDiff, formatCurrencyFR, escapeHtml } from '../shared.js';


const router = new Hono();


// ========== CREDIT SIMULATION ==========

router.get('/api/rates/current', async (c) => {
  const result = await db.execute('SELECT duration, best_rate, avg_rate, updated_at FROM market_rates ORDER BY duration');

  if (result.rows.length === 0) {
    const defaults = [
      { duration: 7, best_rate: 2.80, avg_rate: 3.05 },
      { duration: 10, best_rate: 2.85, avg_rate: 3.10 },
      { duration: 15, best_rate: 2.95, avg_rate: 3.20 },
      { duration: 20, best_rate: 3.05, avg_rate: 3.35 },
      { duration: 25, best_rate: 3.15, avg_rate: 3.45 },
      { duration: 30, best_rate: 3.30, avg_rate: 3.60 },
    ];
    const now = new Date().toISOString();
    for (const d of defaults) {
      await db.execute({ sql: 'INSERT OR REPLACE INTO market_rates (duration, best_rate, avg_rate, updated_at) VALUES (?, ?, ?, ?)', args: [d.duration, d.best_rate, d.avg_rate, now] });
    }
    return c.json({ rates: defaults.map(d => ({ ...d, updated_at: now })) });
  }

  return c.json({ rates: result.rows });
});


// ========== TAX ESTIMATION ==========

router.post('/api/tax/estimate', async (c) => {
  const { gross_annual, country, canton, situation, children } = await c.req.json();
  if (!gross_annual || !country) return c.json({ error: 'Missing fields' }, 400);

  const kids = children || 0;
  let parts = 1;
  if (situation === 'married') parts = 2;
  parts += kids * 0.5;
  if (kids >= 3) parts += (kids - 2) * 0.5; // 3rd+ kid = 1 full part

  let tax = 0, brackets: { rate: number; amount: number }[] = [];

  if (country === 'FR') {
    // French progressive income tax (barème progressif IR 2024)
    const taxableIncome = gross_annual * 0.9; // 10% deduction
    const perPart = taxableIncome / parts;
    const frBrackets = [
      { limit: 11294, rate: 0 },
      { limit: 28797, rate: 0.11 },
      { limit: 82341, rate: 0.30 },
      { limit: 177106, rate: 0.41 },
      { limit: Infinity, rate: 0.45 },
    ];
    let prev = 0;
    for (const b of frBrackets) {
      const slice = Math.max(0, Math.min(perPart, b.limit) - prev);
      const amount = slice * b.rate * parts;
      if (slice > 0) brackets.push({ rate: b.rate * 100, amount });
      tax += amount;
      prev = b.limit;
      if (perPart <= b.limit) break;
    }
  } else if (country === 'CH') {
    // Simplified Swiss tax (federal + cantonal estimate)
    // Federal rates simplified
    const chfGross = gross_annual;
    const deductions = situation === 'married' ? 5400 : 2700;
    const childDeduction = kids * 6700;
    const taxable = Math.max(0, chfGross - deductions - childDeduction);

    // Simplified federal tax brackets
    const fedBrackets = [
      { limit: 17800, rate: 0 },
      { limit: 31600, rate: 0.0077 },
      { limit: 41400, rate: 0.0088 },
      { limit: 55200, rate: 0.026 },
      { limit: 72500, rate: 0.0307 },
      { limit: 78100, rate: 0.0334 },
      { limit: 103600, rate: 0.0361 },
      { limit: 134600, rate: 0.0388 },
      { limit: 176000, rate: 0.0415 },
      { limit: 755200, rate: 0.1315 },
      { limit: Infinity, rate: 0.135 },
    ];
    let fedTax = 0, prev = 0;
    for (const b of fedBrackets) {
      const slice = Math.max(0, Math.min(taxable, b.limit) - prev);
      fedTax += slice * b.rate;
      prev = b.limit;
      if (taxable <= b.limit) break;
    }

    // Cantonal multiplier
    const cantonMultipliers: Record<string, number> = {
      'ZH': 1.19, 'GE': 1.48, 'VD': 1.55, 'BE': 1.54, 'BS': 1.26,
      'LU': 1.05, 'AG': 1.09, 'SG': 1.15, 'TI': 1.30, 'VS': 1.25,
    };
    const multiplier = cantonMultipliers[canton || 'ZH'] || 1.19;
    tax = fedTax * (1 + multiplier);
    brackets = [{ rate: multiplier * 100, amount: tax }];
  }

  const netIncome = gross_annual - tax;
  const effectiveRate = gross_annual > 0 ? (tax / gross_annual) * 100 : 0;

  return c.json({ gross_annual, tax: Math.round(tax), netIncome: Math.round(netIncome), effectiveRate: Math.round(effectiveRate * 100) / 100, brackets, country, situation, children: kids, parts });
});

// ========== BORROWING CAPACITY ==========

router.post('/api/borrowing-capacity', async (c) => {
  const { net_monthly, existing_payments, rate, duration_years } = await c.req.json();
  if (!net_monthly) return c.json({ error: 'Missing net_monthly' }, 400);

  const maxPayment = net_monthly * 0.33;
  const available = Math.max(0, maxPayment - (existing_payments || 0));
  const r = (rate || 3.35) / 100 / 12;
  const n = (duration_years || 20) * 12;
  const maxLoan = r > 0 ? available * (1 - Math.pow(1 + r, -n)) / r : available * n;

  return c.json({
    net_monthly,
    max_payment: Math.round(maxPayment),
    available_payment: Math.round(available),
    max_loan: Math.round(maxLoan),
    rate: rate || 3.35,
    duration_years: duration_years || 20,
  });
});



export default router;
