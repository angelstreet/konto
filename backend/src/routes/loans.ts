import { Hono } from 'hono';
import db from '../db.js';
import { getUserId } from '../shared.js';
import { writeFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import nodePath from 'path';
import nodeOs from 'os';
import { fileURLToPath } from 'url';

const __dirnameFile = nodePath.dirname(fileURLToPath(import.meta.url));

const router = new Hono();

const MILESTONES = [10, 25, 50, 75, 90, 100];

function n(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function d(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return s || null;
}

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function monthsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return months > 0 ? months : null;
}

function toDateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function toYearlyTimeline(startYear: number, endYear: number, startValue: number): { year: number; remaining: number }[] {
  if (endYear <= startYear) {
    return [{ year: startYear, remaining: Math.round(startValue) }, { year: startYear + 1, remaining: 0 }];
  }
  const span = endYear - startYear;
  const rows: { year: number; remaining: number }[] = [];
  for (let i = 0; i <= span; i++) {
    const progress = i / span;
    const remaining = Math.max(0, Math.round(startValue * (1 - progress)));
    rows.push({ year: startYear + i, remaining });
  }
  return rows;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildScopeWhere(usage: string | undefined, companyId: string | undefined, alias = 'ba') {
  let where = `${alias}.user_id = ? AND ${alias}.type = 'loan' AND ${alias}.hidden = 0`;
  const args: any[] = [];
  if (usage === 'personal') {
    // Personal scope must exclude company-linked loans even if usage is mislabeled.
    where += ` AND (${alias}.usage = ? OR ${alias}.usage IS NULL) AND ${alias}.company_id IS NULL`;
    args.push('personal');
  } else if (usage === 'professional') {
    // Professional scope includes explicit professional usage or company-linked loans.
    where += ` AND (${alias}.usage = ? OR ${alias}.company_id IS NOT NULL)`;
    args.push('professional');
  } else if (companyId) {
    where += ` AND ${alias}.company_id = ?`;
    args.push(companyId);
  }
  return { where, args };
}

async function inferAndPersistLoanDetails(userId: number): Promise<void> {
  const ratesRes = await db.execute({
    sql: 'SELECT duration, avg_rate FROM market_rates WHERE avg_rate IS NOT NULL ORDER BY duration ASC',
    args: [],
  });
  const marketRates = ratesRes.rows as any[];
  const pickRate = (durationMonths: number): number => {
    const years = Math.max(1, Math.round(durationMonths / 12));
    if (!marketRates.length) return 1.9;
    let best = marketRates[0];
    let bestDiff = Math.abs(Number(best.duration || 0) - years);
    for (const row of marketRates) {
      const diff = Math.abs(Number(row.duration || 0) - years);
      if (diff < bestDiff) {
        best = row;
        bestDiff = diff;
      }
    }
    const rate = Number(best.avg_rate);
    return Number.isFinite(rate) ? rate : 1.9;
  };

  const loansRes = await db.execute({
    sql: `SELECT ba.id, ba.balance, ba.last_sync, ld.*
          FROM bank_accounts ba
          LEFT JOIN loan_details ld ON ld.bank_account_id = ba.id AND ld.user_id = ba.user_id
          WHERE ba.user_id = ? AND ba.type = 'loan' AND ba.hidden = 0`,
    args: [userId],
  });

  const txRes = await db.execute({
    sql: `SELECT t.bank_account_id, t.date, ABS(t.amount) as amount
          FROM transactions t
          JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE ba.user_id = ? AND ba.type = 'loan' AND t.amount < 0 AND t.date >= date('now', '-540 day')
          ORDER BY t.date DESC`,
    args: [userId],
  });

  const txByLoan = new Map<number, { date: string; amount: number }[]>();
  for (const row of txRes.rows as any[]) {
    const loanId = Number(row.bank_account_id);
    const amount = Number(row.amount || 0);
    if (!Number.isFinite(loanId) || !Number.isFinite(amount) || amount <= 0) continue;
    if (!txByLoan.has(loanId)) txByLoan.set(loanId, []);
    txByLoan.get(loanId)!.push({ date: String(row.date || ''), amount });
  }

  for (const row of loansRes.rows as any[]) {
    const loanId = Number(row.id);
    const source = String(row.source || '');
    if (source === 'manual') continue;

    const txs = txByLoan.get(loanId) || [];
    const hasTx = txs.length > 0;

    let median: number | null = null;
    if (hasTx) {
      const amounts = txs.map((t) => t.amount).sort((a, b) => a - b);
      const mid = Math.floor(amounts.length / 2);
      median = amounts.length % 2 === 0 ? (amounts[mid - 1] + amounts[mid]) / 2 : amounts[mid];
      if (!Number.isFinite(median) || median <= 0) median = null;
    }

    const remaining = Math.abs(Math.min(Number(row.balance || 0), 0));
    if (remaining <= 0) continue;
    if (median === null && row.monthly_payment) {
      const m = Number(row.monthly_payment);
      if (Number.isFinite(m) && m > 0) median = m;
    }
    if (median === null) {
      // Last-resort estimate when connector provides no schedule and no tx history.
      const assumedRemainingMonths = String(row.loan_type || '').includes('mortgage') ? 300 : 120;
      median = Math.max(50, Math.round((remaining / assumedRemainingMonths) * 100) / 100);
    }

    const tolerance = Math.max(5, median * 0.2);
    const recurring = txs.filter((t) => Math.abs(t.amount - median) <= tolerance);
    const monthSet = new Set(recurring.map((t) => t.date.slice(0, 7)));
    const inferredInstallmentsPaid = monthSet.size >= 2 ? monthSet.size : 0;
    const remainingMonths = Math.max(1, Math.ceil(remaining / median));
    const inferredDuration = inferredInstallmentsPaid + remainingMonths;
    const inferredStartDate = dateOnly(addMonths(new Date(), -inferredInstallmentsPaid));
    const inferredEndDate = dateOnly(addMonths(new Date(), remainingMonths));

    let inferredPrincipal: number | null = null;
    if (inferredDuration > inferredInstallmentsPaid) {
      const ratio = inferredInstallmentsPaid / inferredDuration;
      if (ratio > 0 && ratio < 0.98) {
        inferredPrincipal = Math.round((remaining / (1 - ratio)) * 100) / 100;
      }
    }
    if (inferredPrincipal === null) inferredPrincipal = remaining;

    const next = {
      loan_type: row.loan_type || 'amortizing',
      principal_amount: row.principal_amount ?? inferredPrincipal,
      start_date: row.start_date ?? inferredStartDate,
      end_date: row.end_date ?? inferredEndDate,
      duration_months: row.duration_months ?? inferredDuration,
      installments_paid: row.installments_paid ?? inferredInstallmentsPaid,
      interest_rate: row.interest_rate ?? pickRate(inferredDuration),
      monthly_payment: row.monthly_payment ?? Math.round(median * 100) / 100,
      insurance_monthly: row.insurance_monthly ?? 0,
      fees_total: row.fees_total ?? 0,
      source: row.source || (hasTx ? 'inferred' : 'estimated'),
    };

    await db.execute({
      sql: `INSERT INTO loan_details
            (user_id, bank_account_id, loan_type, principal_amount, start_date, end_date, duration_months,
             installments_paid, interest_rate, monthly_payment, insurance_monthly, fees_total, source, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(bank_account_id) DO UPDATE SET
              loan_type = COALESCE(loan_details.loan_type, excluded.loan_type),
              principal_amount = COALESCE(loan_details.principal_amount, excluded.principal_amount),
              start_date = COALESCE(loan_details.start_date, excluded.start_date),
              end_date = COALESCE(loan_details.end_date, excluded.end_date),
              duration_months = COALESCE(loan_details.duration_months, excluded.duration_months),
              installments_paid = COALESCE(loan_details.installments_paid, excluded.installments_paid),
              interest_rate = COALESCE(loan_details.interest_rate, excluded.interest_rate),
              monthly_payment = COALESCE(loan_details.monthly_payment, excluded.monthly_payment),
              insurance_monthly = COALESCE(loan_details.insurance_monthly, excluded.insurance_monthly),
              fees_total = COALESCE(loan_details.fees_total, excluded.fees_total),
              source = CASE WHEN loan_details.source = 'manual' THEN loan_details.source ELSE excluded.source END,
              updated_at = datetime('now')`,
      args: [
        userId,
        loanId,
        next.loan_type,
        next.principal_amount,
        next.start_date,
        next.end_date,
        next.duration_months,
        next.installments_paid,
        next.interest_rate,
        next.monthly_payment,
        next.insurance_monthly,
        next.fees_total,
        next.source,
      ],
    });
  }
}

async function loadMonthlyPaymentFallbacks(userId: number): Promise<Map<number, number>> {
  const txRes = await db.execute({
    sql: `SELECT t.bank_account_id, ABS(t.amount) as amount
          FROM transactions t
          JOIN bank_accounts ba ON ba.id = t.bank_account_id
          WHERE ba.user_id = ? AND ba.type = 'loan' AND t.amount < 0 AND t.date >= date('now', '-120 day')
          ORDER BY t.date DESC`,
    args: [userId],
  });

  const bucket = new Map<number, number[]>();
  for (const row of txRes.rows as any[]) {
    const id = Number(row.bank_account_id);
    const amt = Number(row.amount || 0);
    if (!Number.isFinite(id) || !Number.isFinite(amt) || amt <= 0) continue;
    if (!bucket.has(id)) bucket.set(id, []);
    bucket.get(id)!.push(amt);
  }

  const fallback = new Map<number, number>();
  for (const [id, amounts] of bucket.entries()) {
    amounts.sort((a, b) => a - b);
    const mid = Math.floor(amounts.length / 2);
    const median = amounts.length % 2 === 0 ? (amounts[mid - 1] + amounts[mid]) / 2 : amounts[mid];
    fallback.set(id, Math.round(median * 100) / 100);
  }
  return fallback;
}

function buildLoanComputed(raw: any, monthlyFallback: number | null) {
  const balance = Number(raw.balance || 0);
  const remaining = Math.abs(Math.min(balance, 0));
  const monthlyPayment = n(raw.monthly_payment) ?? monthlyFallback;
  const principal = n(raw.principal_amount) ?? (remaining > 0 ? remaining : null);
  const durationMonths = n(raw.duration_months)
    ?? monthsBetween(d(raw.start_date), d(raw.end_date));

  const repaidCapital = principal !== null ? Math.max(0, principal - remaining) : null;

  const installmentsPaid = n(raw.installments_paid)
    ?? (durationMonths !== null && repaidCapital !== null && principal && principal > 0
      ? Math.round(durationMonths * (repaidCapital / principal))
      : null);

  const installmentsLeft = durationMonths !== null
    ? Math.max(0, Math.round(durationMonths - (installmentsPaid || 0)))
    : null;

  const repaidPct = principal !== null && principal > 0
    ? Math.round(clamp((repaidCapital! / principal) * 100) * 100) / 100
    : (durationMonths !== null && installmentsPaid !== null && durationMonths > 0
      ? Math.round(clamp((installmentsPaid / durationMonths) * 100) * 100) / 100
      : null);

  const rate = n(raw.interest_rate);
  const insurance = n(raw.insurance_monthly) ?? 0;
  let interestMonthly: number | null = null;
  let capitalMonthly: number | null = null;

  if (monthlyPayment !== null) {
    if (rate !== null) {
      interestMonthly = Math.round((remaining * (rate / 100) / 12) * 100) / 100;
      capitalMonthly = Math.max(0, Math.round((monthlyPayment - insurance - interestMonthly) * 100) / 100);
    } else if (installmentsLeft && installmentsLeft > 0) {
      capitalMonthly = Math.round((remaining / installmentsLeft) * 100) / 100;
      interestMonthly = Math.max(0, Math.round((monthlyPayment - insurance - capitalMonthly) * 100) / 100);
    }
  }

  return {
    loan_id: Number(raw.id),
    name: raw.custom_name || raw.name || 'Prêt',
    provider: raw.bank_name || raw.provider_bank_name || null,
    currency: raw.currency || 'EUR',
    remaining,
    principal_amount: principal,
    monthly_payment: monthlyPayment,
    interest_rate: rate,
    start_date: d(raw.start_date),
    end_date: d(raw.end_date),
    duration_months: durationMonths,
    installments_paid: installmentsPaid,
    installments_left: installmentsLeft,
    repaid_capital: repaidCapital,
    repaid_pct: repaidPct,
    insurance_monthly: insurance,
    monthly_breakdown: {
      capital: capitalMonthly,
      interest: interestMonthly,
      insurance,
    },
    source: raw.source || 'provider',
    usage: raw.usage || 'personal',
    company_id: raw.company_id || null,
    updated_at: raw.last_sync || null,
  };
}

router.get('/api/loans/learn', async (c) => {
  return c.json({
    items: [
      {
        id: 'rate-negotiation',
        title: 'Négocier son taux',
        summary: 'Comparez au moins 3 banques et valorisez votre reste à vivre.',
      },
      {
        id: 'insurance-optimization',
        title: 'Optimiser l’assurance emprunteur',
        summary: 'Une délégation d’assurance peut réduire significativement le coût total.',
      },
      {
        id: 'early-repayment',
        title: 'Remboursement anticipé',
        summary: 'Vérifiez les indemnités et priorisez les prêts les plus coûteux.',
      },
    ],
  });
});

router.get('/api/loans/notifications', async (c) => {
  const userId = await getUserId(c);
  const res = await db.execute({
    sql: `SELECT e.id, e.bank_account_id as loan_id, e.milestone, e.triggered_at,
                 COALESCE(ba.custom_name, ba.name) as loan_name
          FROM loan_milestone_events e
          JOIN bank_accounts ba ON ba.id = e.bank_account_id
          WHERE e.user_id = ?
          ORDER BY e.id DESC
          LIMIT 50`,
    args: [userId],
  });
  return c.json({ notifications: res.rows });
});

router.get('/api/loans/export.csv', async (c) => {
  const userId = await getUserId(c);
  const usage = c.req.query('usage');
  const companyId = c.req.query('company_id');
  const { where, args } = buildScopeWhere(usage, companyId);
  const result = await db.execute({
    sql: `SELECT ba.id, COALESCE(ba.custom_name, ba.name) as name, ba.bank_name, ba.balance,
                 ld.monthly_payment, ld.interest_rate, ld.end_date, ld.principal_amount
          FROM bank_accounts ba
          LEFT JOIN loan_details ld ON ld.bank_account_id = ba.id AND ld.user_id = ba.user_id
          WHERE ${where}
          ORDER BY ABS(ba.balance) DESC`,
    args: [userId, ...args],
  });

  const lines = ['loan_id,name,bank,remaining,monthly_payment,interest_rate,end_date,principal_amount'];
  for (const row of result.rows as any[]) {
    lines.push([
      row.id,
      row.name,
      row.bank_name || '',
      Math.abs(Math.min(Number(row.balance || 0), 0)),
      row.monthly_payment ?? '',
      row.interest_rate ?? '',
      row.end_date ?? '',
      row.principal_amount ?? '',
    ].map(csvEscape).join(','));
  }

  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', 'attachment; filename="loans.csv"');
  return c.body(lines.join('\n'));
});

router.get('/api/loans', async (c) => {
  const userId = await getUserId(c);
  await inferAndPersistLoanDetails(userId);
  const usage = c.req.query('usage');
  const companyId = c.req.query('company_id');
  const { where, args } = buildScopeWhere(usage, companyId);

  const [rowsRes, monthlyFallbacks] = await Promise.all([
    db.execute({
      sql: `SELECT ba.*, ld.principal_amount, ld.start_date, ld.end_date, ld.duration_months,
                   ld.installments_paid, ld.interest_rate, ld.monthly_payment, ld.insurance_monthly,
                   ld.fees_total, ld.source
            FROM bank_accounts ba
            LEFT JOIN loan_details ld ON ld.bank_account_id = ba.id AND ld.user_id = ba.user_id
            WHERE ${where}
            ORDER BY ABS(ba.balance) DESC`,
      args: [userId, ...args],
    }),
    loadMonthlyPaymentFallbacks(userId),
  ]);

  const loans = (rowsRes.rows as any[]).map((r) => buildLoanComputed(r, monthlyFallbacks.get(Number(r.id)) ?? null));
  const totalOutstanding = loans.reduce((sum, l) => sum + l.remaining, 0);

  const weightedRateParts = loans.filter((l) => l.interest_rate !== null && l.remaining > 0);
  const weightedRateDen = weightedRateParts.reduce((s, l) => s + l.remaining, 0);
  const weightedRate = weightedRateDen > 0
    ? weightedRateParts.reduce((s, l) => s + l.remaining * (l.interest_rate || 0), 0) / weightedRateDen
    : null;

  const avgDurationMonthsParts = loans.filter((l) => l.duration_months !== null && l.remaining > 0);
  const avgDurationDen = avgDurationMonthsParts.reduce((s, l) => s + l.remaining, 0);
  const avgDurationYears = avgDurationDen > 0
    ? (avgDurationMonthsParts.reduce((s, l) => s + l.remaining * (l.duration_months || 0), 0) / avgDurationDen) / 12
    : null;

  const monthlyTotal = loans.reduce((s, l) => s + (l.monthly_payment || 0), 0);
  const monthlyCapital = loans.reduce((s, l) => s + (l.monthly_breakdown.capital || 0), 0);
  const monthlyInterest = loans.reduce((s, l) => s + (l.monthly_breakdown.interest || 0), 0);
  const monthlyInsurance = loans.reduce((s, l) => s + (l.monthly_breakdown.insurance || 0), 0);

  const distribution = loans
    .map((l) => ({
      loan_id: l.loan_id,
      name: l.name,
      remaining: Math.round(l.remaining * 100) / 100,
      share_pct: totalOutstanding > 0 ? Math.round((l.remaining / totalOutstanding) * 100) : 0,
    }))
    .sort((a, b) => b.remaining - a.remaining);

  const startYear = new Date().getFullYear();
  const maxKnownEnd = loans
    .map((l) => (l.end_date ? new Date(l.end_date).getFullYear() : null))
    .filter((x): x is number => x !== null)
    .reduce((m, y) => Math.max(m, y), startYear + 20);

  const timeline = toYearlyTimeline(startYear, Math.max(startYear + 2, maxKnownEnd), totalOutstanding);

  const notifications: any[] = [];
  for (const loan of loans) {
    const pct = Math.round(loan.repaid_pct || 0);
    if (!pct) continue;
    for (const milestone of MILESTONES) {
      if (pct < milestone) continue;
      const exists = await db.execute({
        sql: 'SELECT id FROM loan_milestone_events WHERE user_id = ? AND bank_account_id = ? AND milestone = ? LIMIT 1',
        args: [userId, loan.loan_id, milestone],
      });
      if (exists.rows.length > 0) continue;
      await db.execute({
        sql: 'INSERT INTO loan_milestone_events (user_id, bank_account_id, milestone) VALUES (?, ?, ?)',
        args: [userId, loan.loan_id, milestone],
      });
      notifications.push({ loan_id: loan.loan_id, loan_name: loan.name, milestone, repaid_pct: loan.repaid_pct });
    }
  }

  return c.json({
    date: toDateOnly(new Date().toISOString()),
    total_outstanding: Math.round(totalOutstanding * 100) / 100,
    currency: 'EUR',
    summary: {
      monthly_total: Math.round(monthlyTotal * 100) / 100,
      monthly_breakdown: {
        capital: Math.round(monthlyCapital * 100) / 100,
        interest: Math.round(monthlyInterest * 100) / 100,
        insurance: Math.round(monthlyInsurance * 100) / 100,
      },
      avg_duration_years: avgDurationYears !== null ? Math.round(avgDurationYears * 10) / 10 : null,
      avg_rate: weightedRate !== null ? Math.round(weightedRate * 100) / 100 : null,
      capacity_available: null,
    },
    distribution,
    timeline,
    notifications,
    loans,
  });
});

router.get('/api/loans/:loanId', async (c) => {
  const userId = await getUserId(c);
  await inferAndPersistLoanDetails(userId);
  const loanId = Number(c.req.param('loanId'));
  if (!Number.isFinite(loanId)) return c.json({ error: 'Invalid loan id' }, 400);

  const fallbackMap = await loadMonthlyPaymentFallbacks(userId);
  const result = await db.execute({
    sql: `SELECT ba.*, ld.principal_amount, ld.start_date, ld.end_date, ld.duration_months,
                 ld.installments_paid, ld.interest_rate, ld.monthly_payment, ld.insurance_monthly,
                 ld.fees_total, ld.loan_type, ld.source
          FROM bank_accounts ba
          LEFT JOIN loan_details ld ON ld.bank_account_id = ba.id AND ld.user_id = ba.user_id
          WHERE ba.user_id = ? AND ba.type = 'loan' AND ba.id = ? AND ba.hidden = 0
          LIMIT 1`,
    args: [userId, loanId],
  });
  if (result.rows.length === 0) return c.json({ error: 'Loan not found' }, 404);

  const loan = buildLoanComputed(result.rows[0] as any, fallbackMap.get(loanId) ?? null);

  const linkedRes = await db.execute({
    sql: `SELECT id, name, current_value, purchase_price, property_usage,
                 notary_fees, travaux, estimated_value, estimated_price_m2,
                 address, surface, property_type, purchase_date,
                 monthly_rent, tenant_name
          FROM assets
          WHERE user_id = ? AND linked_loan_account_id = ?
          ORDER BY created_at DESC`,
    args: [userId, loanId],
  });

  // Fetch costs and revenues for linked assets
  const linkedAssetIds = (linkedRes.rows as any[]).map(a => Number(a.id));
  let costsMap: Record<number, any[]> = {};
  let revenuesMap: Record<number, any[]> = {};
  if (linkedAssetIds.length > 0) {
    const placeholders = linkedAssetIds.map(() => '?').join(',');
    const costsRes = await db.execute({ sql: `SELECT * FROM asset_costs WHERE asset_id IN (${placeholders})`, args: linkedAssetIds });
    const revsRes = await db.execute({ sql: `SELECT * FROM asset_revenues WHERE asset_id IN (${placeholders})`, args: linkedAssetIds });
    for (const c of costsRes.rows as any[]) {
      if (!costsMap[c.asset_id]) costsMap[c.asset_id] = [];
      costsMap[c.asset_id].push({ id: c.id, label: c.label, amount: Number(c.amount), frequency: c.frequency });
    }
    for (const r of revsRes.rows as any[]) {
      if (!revenuesMap[r.asset_id]) revenuesMap[r.asset_id] = [];
      revenuesMap[r.asset_id].push({ id: r.id, label: r.label, amount: Number(r.amount), frequency: r.frequency });
    }
  }

  const linkedAssets = (linkedRes.rows as any[]).map((a) => {
    const costs = costsMap[Number(a.id)] || [];
    const revenues = revenuesMap[Number(a.id)] || [];
    const monthlyCosts = costs.reduce((s: number, c: any) => s + (c.frequency === 'yearly' ? c.amount / 12 : c.frequency === 'one_time' ? 0 : c.amount), 0);
    const monthlyRevenues = revenues.reduce((s: number, r: any) => s + (r.frequency === 'yearly' ? r.amount / 12 : r.amount), 0);
    const purchasePrice = Number(a.purchase_price || 0);
    const currentValue = Number(a.current_value || 0);
    const pnl = purchasePrice > 0 && currentValue > 0 ? currentValue - purchasePrice : null;
    return {
      asset_id: Number(a.id),
      name: a.name || 'Actif',
      usage: a.property_usage || null,
      allocation_pct: 100,
      allocation_amount: Math.round((currentValue || purchasePrice) * 100) / 100,
      purchase_price: purchasePrice || null,
      current_value: currentValue || null,
      notary_fees: a.notary_fees ? Number(a.notary_fees) : null,
      travaux: a.travaux ? Number(a.travaux) : null,
      estimated_value: a.estimated_value ? Number(a.estimated_value) : null,
      estimated_price_m2: a.estimated_price_m2 ? Number(a.estimated_price_m2) : null,
      address: a.address || null,
      surface: a.surface ? Number(a.surface) : null,
      property_type: a.property_type || null,
      purchase_date: a.purchase_date || null,
      monthly_rent: a.monthly_rent ? Number(a.monthly_rent) : null,
      pnl,
      pnl_percent: purchasePrice > 0 && pnl != null ? (pnl / purchasePrice) * 100 : null,
      costs,
      revenues,
      monthly_costs: Math.round(monthlyCosts * 100) / 100,
      monthly_revenues: Math.round(monthlyRevenues * 100) / 100,
    };
  });

  const principal = loan.principal_amount ?? loan.remaining;
  const installmentsPaid = loan.installments_paid || 0;
  const installmentsLeft = loan.installments_left || 0;
  const interestMonthly = loan.monthly_breakdown.interest || 0;
  const insuranceMonthly = loan.monthly_breakdown.insurance || 0;

  const repaidCapital = loan.repaid_capital || 0;
  const repaidInterest = Math.round(installmentsPaid * interestMonthly * 100) / 100;
  const repaidInsurance = Math.round(installmentsPaid * insuranceMonthly * 100) / 100;

  const remainingPct = Math.round((100 - (loan.repaid_pct || 0)) * 100) / 100;
  const monthly = loan.monthly_payment || (loan.remaining > 0 && installmentsLeft > 0 ? loan.remaining / installmentsLeft : 0);
  const remainingToRepay = Math.round(monthly * installmentsLeft * 100) / 100;
  const feesTotal = n((result.rows[0] as any).fees_total) || 0;

  const totalInterestInsurance = Math.round((interestMonthly + insuranceMonthly) * (installmentsPaid + installmentsLeft) * 100) / 100;
  const loanCost = Math.round((principal + totalInterestInsurance + feesTotal) * 100) / 100;

  const startYear = new Date().getFullYear();
  const endYear = loan.end_date ? new Date(loan.end_date).getFullYear() : startYear + Math.max(2, Math.ceil((loan.duration_months || 240) / 12));
  const timeline = toYearlyTimeline(startYear, Math.max(startYear + 2, endYear), loan.remaining);

  return c.json({
    loan: {
      loan_id: loan.loan_id,
      name: loan.name,
      type_label: (result.rows[0] as any).loan_type || 'Prêt amortissable',
      remaining: Math.round(loan.remaining * 100) / 100,
      monthly_payment: loan.monthly_payment,
      interest_rate: loan.interest_rate,
      repaid_pct: loan.repaid_pct,
      installments_paid: loan.installments_paid,
      installments_left: loan.installments_left,
      end_date: loan.end_date,
    },
    monthly_breakdown: loan.monthly_breakdown,
    totals: {
      loan_cost: loanCost,
      capital_total: Math.round(principal * 100) / 100,
      interest_insurance_total: totalInterestInsurance,
      fees_total: feesTotal,
      repaid_total: Math.round((repaidCapital + repaidInterest + repaidInsurance) * 100) / 100,
      repaid_capital: Math.round(repaidCapital * 100) / 100,
      repaid_interest: repaidInterest,
      repaid_insurance: repaidInsurance,
      remaining_total: Math.round(loan.remaining * 100) / 100,
      remaining_to_repay: remainingToRepay,
      remaining_pct: remainingPct,
    },
    timeline,
    linked_assets: linkedAssets,
  });
});

router.post('/api/loans', async (c) => {
  const userId = await getUserId(c);
  const body = await c.req.json();

  const name = d(body.name) || 'Nouveau prêt';
  const providerName = d(body.provider_name);
  const usage = body.usage === 'professional' ? 'professional' : 'personal';
  const companyId = body.company_id ? Number(body.company_id) : null;
  const remaining = Math.max(0, n(body.remaining) ?? 0);

  const ins = await db.execute({
    sql: `INSERT INTO bank_accounts
          (user_id, company_id, provider, name, custom_name, bank_name, balance, hidden, type, usage, currency, last_sync)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'loan', ?, 'EUR', ?)`,
    args: [userId, companyId, 'manual', name, d(body.custom_name), providerName, -remaining, usage, new Date().toISOString()],
  });

  const bankAccountId = Number(ins.lastInsertRowid);
  await db.execute({
    sql: `INSERT INTO loan_details
          (user_id, bank_account_id, loan_type, principal_amount, start_date, end_date, duration_months,
           installments_paid, interest_rate, monthly_payment, insurance_monthly, fees_total, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      userId,
      bankAccountId,
      d(body.loan_type) || 'amortizing',
      n(body.principal_amount),
      d(body.start_date),
      d(body.end_date),
      n(body.duration_months),
      n(body.installments_paid),
      n(body.interest_rate),
      n(body.monthly_payment),
      n(body.insurance_monthly) ?? 0,
      n(body.fees_total) ?? 0,
      'manual',
    ],
  });

  return c.json({ ok: true, loan_id: bankAccountId });
});

router.patch('/api/loans/:loanId', async (c) => {
  const userId = await getUserId(c);
  const loanId = Number(c.req.param('loanId'));
  if (!Number.isFinite(loanId)) return c.json({ error: 'Invalid loan id' }, 400);

  const body = await c.req.json();
  const updates: string[] = [];
  const args: any[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    args.push(d(body.name) || 'Prêt');
  }
  if (body.custom_name !== undefined) {
    updates.push('custom_name = ?');
    args.push(d(body.custom_name));
  }
  if (body.provider_name !== undefined) {
    updates.push('bank_name = ?');
    args.push(d(body.provider_name));
  }
  if (body.remaining !== undefined) {
    updates.push('balance = ?');
    args.push(-Math.max(0, n(body.remaining) ?? 0));
  }
  if (body.usage !== undefined) {
    updates.push('usage = ?');
    args.push(body.usage === 'professional' ? 'professional' : 'personal');
  }
  if (body.company_id !== undefined) {
    updates.push('company_id = ?');
    args.push(body.company_id ? Number(body.company_id) : null);
  }

  if (updates.length > 0) {
    await db.execute({
      sql: `UPDATE bank_accounts SET ${updates.join(', ')}, last_sync = ? WHERE id = ? AND user_id = ? AND type = 'loan'`,
      args: [...args, new Date().toISOString(), loanId, userId],
    });
  }

  const existingDetailsRes = await db.execute({
    sql: 'SELECT * FROM loan_details WHERE user_id = ? AND bank_account_id = ? LIMIT 1',
    args: [userId, loanId],
  });
  const existing: any = existingDetailsRes.rows[0] || {};

  await db.execute({
    sql: `INSERT INTO loan_details
          (user_id, bank_account_id, loan_type, principal_amount, start_date, end_date, duration_months,
           installments_paid, interest_rate, monthly_payment, insurance_monthly, fees_total, source, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(bank_account_id) DO UPDATE SET
            loan_type = excluded.loan_type,
            principal_amount = excluded.principal_amount,
            start_date = excluded.start_date,
            end_date = excluded.end_date,
            duration_months = excluded.duration_months,
            installments_paid = excluded.installments_paid,
            interest_rate = excluded.interest_rate,
            monthly_payment = excluded.monthly_payment,
            insurance_monthly = excluded.insurance_monthly,
            fees_total = excluded.fees_total,
            source = excluded.source,
            updated_at = datetime('now')`,
    args: [
      userId,
      loanId,
      body.loan_type !== undefined ? (d(body.loan_type) || 'amortizing') : (existing.loan_type || 'amortizing'),
      body.principal_amount !== undefined ? n(body.principal_amount) : n(existing.principal_amount),
      body.start_date !== undefined ? d(body.start_date) : d(existing.start_date),
      body.end_date !== undefined ? d(body.end_date) : d(existing.end_date),
      body.duration_months !== undefined ? n(body.duration_months) : n(existing.duration_months),
      body.installments_paid !== undefined ? n(body.installments_paid) : n(existing.installments_paid),
      body.interest_rate !== undefined ? n(body.interest_rate) : n(existing.interest_rate),
      body.monthly_payment !== undefined ? n(body.monthly_payment) : n(existing.monthly_payment),
      body.insurance_monthly !== undefined ? (n(body.insurance_monthly) ?? 0) : (n(existing.insurance_monthly) ?? 0),
      body.fees_total !== undefined ? (n(body.fees_total) ?? 0) : (n(existing.fees_total) ?? 0),
      body.source !== undefined ? (d(body.source) || 'manual') : (existing.source || 'manual'),
    ],
  });

  return c.json({ ok: true });
});

router.delete('/api/loans/:loanId', async (c) => {
  const userId = await getUserId(c);
  const loanId = Number(c.req.param('loanId'));
  if (!Number.isFinite(loanId)) return c.json({ error: 'Invalid loan id' }, 400);

  await db.execute({ sql: 'DELETE FROM loan_details WHERE user_id = ? AND bank_account_id = ?', args: [userId, loanId] });
  await db.execute({ sql: 'DELETE FROM loan_milestone_events WHERE user_id = ? AND bank_account_id = ?', args: [userId, loanId] });
  await db.execute({
    sql: "UPDATE bank_accounts SET hidden = 1, last_sync = ? WHERE user_id = ? AND id = ? AND type = 'loan'",
    args: [new Date().toISOString(), userId, loanId],
  });

  return c.json({ ok: true });
});

// Enrich loan from PDF - upload and parse amortization schedule
router.post('/api/loans/:loanId/enrich', async (c) => {
  const userId = await getUserId(c);
  const loanId = Number(c.req.param('loanId'));
  if (!Number.isFinite(loanId)) return c.json({ error: 'Invalid loan id' }, 400);

  const formData = await c.req.formData();
  const file = formData.get('file') as File;
  if (!file) return c.json({ error: 'file is required' }, 400);

  // Save uploaded file
  const tmpDir = nodeOs.tmpdir();
  const tmpPath = nodePath.join(tmpDir, `loan-${Date.now()}.pdf`);
  const buffer = await file.arrayBuffer();
  writeFileSync(tmpPath, Buffer.from(buffer));

  // Run parser
  // In dev __dirname = src/routes, in prod = dist/routes; scripts/ always at backend root
  const parserPath = nodePath.join(__dirnameFile, '..', '..', 'scripts', 'parse-loan-pdf.cjs');
  const result = await new Promise<any>((resolve) => {
    const child = spawn('node', [parserPath, tmpPath], { cwd: nodePath.dirname(parserPath) });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d: any) => stdout += d);
    child.stderr.on('data', (d: any) => stderr += d);
    child.on('close', async (code: any) => {
      try { unlinkSync(tmpPath); } catch {}
      
      if (code !== 0 || !stdout.trim()) {
        resolve({ error: 'Failed to parse PDF', detail: stderr });
        return;
      }
      
      try {
        const data = JSON.parse(stdout.trim());
        
        // Update loan details
        const updates: string[] = [];
        const args: any[] = [];
        if (data.originalAmount) { updates.push('principal_amount = ?'); args.push(data.originalAmount); }
        if (data.interestRate) { updates.push('interest_rate = ?'); args.push(data.interestRate); }
        if (data.startDate) { updates.push('start_date = ?'); args.push(data.startDate); }
        if (data.endDate) { updates.push('end_date = ?'); args.push(data.endDate); }
        if (data.monthlyPayment) { updates.push('monthly_payment = ?'); args.push(data.monthlyPayment); }
        if (data.insuranceMonthly) { updates.push('insurance_monthly = ?'); args.push(data.insuranceMonthly); }
        
        if (updates.length > 0) {
          args.push(loanId, userId);
          await db.execute({
            sql: `UPDATE loan_details SET ${updates.join(', ')}, updated_at = datetime('now') WHERE bank_account_id = ? AND user_id = ?`,
            args,
          });
        }
        
        resolve({ ok: true, data });
      } catch (e) {
        resolve({ error: 'Failed to parse JSON', detail: stdout });
      }
    });
  });

  if (result.error) return c.json({ error: result.error, detail: result.detail }, 500);
  return c.json(result);
});

export default router;
