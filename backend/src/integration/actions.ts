import db from '../db.js';
import { categorizeTransaction } from '../categorizer.js';
import { kontoDeeplink, kontoLoanDeeplink } from './deeplinks.js';

export type KontoIntegrationActionId =
  | 'konto.get_summary'
  | 'konto.list_loans'
  | 'konto.get_loan_detail';

export type KontoIntegrationAction = {
  id: KontoIntegrationActionId;
  app_id: 'konto';
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  artifact_hint: string;
  preferred_visualization: string;
  open_in_app: string;
};

export const kontoIntegrationActions: KontoIntegrationAction[] = [
  {
    id: 'konto.get_summary',
    app_id: 'konto',
    description: 'Return a high-level financial overview for the current user.',
    input_schema: {},
    output_schema: { type: 'object', properties: { summary: { type: 'object' } } },
    artifact_hint: 'stat_card',
    preferred_visualization: 'stat_card',
    open_in_app: kontoDeeplink('/dashboard'),
  },
  {
    id: 'konto.list_loans',
    app_id: 'konto',
    description: 'List the current user active loans.',
    input_schema: {},
    output_schema: { type: 'object', properties: { loans: { type: 'array' } } },
    artifact_hint: 'table',
    preferred_visualization: 'table',
    open_in_app: kontoDeeplink('/loans'),
  },
  {
    id: 'konto.get_loan_detail',
    app_id: 'konto',
    description: 'Return one loan detail by matching id, exact name, or partial name.',
    input_schema: {
      type: 'object',
      properties: {
        loan_id: { type: 'number' },
        loan_name: { type: 'string' },
      },
    },
    output_schema: { type: 'object', properties: { loan: { type: 'object' } } },
    artifact_hint: 'stat_card',
    preferred_visualization: 'stat_card',
    open_in_app: kontoDeeplink('/loans'),
  },
];

function roundMoney(value: unknown) {
  return Math.round((Number(value || 0)) * 100) / 100;
}

export async function runKontoIntegrationAction(actionId: KontoIntegrationActionId, userId: number, input: Record<string, any> = {}) {
  switch (actionId) {
    case 'konto.get_summary':
      return getSummary(userId);
    case 'konto.list_loans':
      return listLoans(userId);
    case 'konto.get_loan_detail':
      return getLoanDetail(userId, input);
  }
}

async function getSummary(userId: number) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0];
  const [accountsRes, investmentsRes, assetsRes, loansRes, txsRes, subTxsRes] = await Promise.all([
    db.execute({ sql: `SELECT balance, type FROM bank_accounts WHERE user_id = ? AND hidden = 0`, args: [userId] }),
    db.execute({ sql: `SELECT i.valuation, i.code_type as asset_class, i.isin_code as code FROM investments i JOIN bank_accounts ba ON i.bank_account_id = ba.id WHERE ba.user_id = ?`, args: [userId] }),
    db.execute({ sql: `SELECT current_value, purchase_price FROM assets WHERE user_id = ?`, args: [userId] }),
    db.execute({ sql: `SELECT balance FROM bank_accounts WHERE user_id = ? AND type = 'loan'`, args: [userId] }),
    db.execute({ sql: `SELECT t.amount, t.label FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.user_id = ? AND t.date >= ?`, args: [userId, monthStart] }),
    db.execute({ sql: `SELECT t.amount, t.label FROM transactions t JOIN bank_accounts ba ON t.bank_account_id = ba.id WHERE ba.user_id = ? AND t.amount < 0 AND t.date >= ?`, args: [userId, prevMonthStart] }),
  ]);

  const accounts = accountsRes.rows as any[];
  const investments = investmentsRes.rows as any[];
  const assets = assetsRes.rows as any[];
  const loans = loansRes.rows as any[];
  const totalBalance = accounts.filter((a) => a.type !== 'loan').reduce((s: number, a: any) => s + (a.balance || 0), 0);
  const totalInvestments = investments.reduce((s: number, i: any) => s + (i.valuation || 0), 0);
  const totalAssets = assets.reduce((s: number, a: any) => s + (a.current_value || a.purchase_price || 0), 0);
  const totalLoans = loans.reduce((s: number, l: any) => s + (l.balance || 0), 0);
  const patrimoineNet = totalBalance + totalInvestments + totalAssets + totalLoans;

  let income = 0;
  let expenses = 0;
  const catTotals = new Map<string, number>();
  for (const row of txsRes.rows as any[]) {
    if (row.amount > 0) income += row.amount;
    else {
      expenses += row.amount;
      const cat = categorizeTransaction(row.label || '');
      catTotals.set(cat.category, (catTotals.get(cat.category) || 0) + row.amount);
    }
  }

  const topCategories = [...catTotals.entries()]
    .sort((a, b) => a[1] - b[1]).slice(0, 5)
    .map(([name, amount]) => {
      const cat = categorizeTransaction(name);
      return { name, icon: cat.icon, pct: expenses !== 0 ? Math.round((amount / expenses) * 100) : 0 };
    });

  const subMap = new Map<string, number[]>();
  for (const r of subTxsRes.rows as any[]) {
    const key = (r.label || '').trim().toUpperCase().split(/\s+/).slice(0, 2).join(' ');
    if (!subMap.has(key)) subMap.set(key, []);
    subMap.get(key)!.push(r.amount);
  }

  let subCount = 0;
  let subMonthly = 0;
  for (const [, amounts] of subMap.entries()) {
    if (amounts.length >= 2) {
      subCount++;
      subMonthly += amounts[0];
    }
  }

  const summary = {
    patrimoine_net: roundMoney(patrimoineNet),
    accounts: { count: accounts.filter((a) => a.type !== 'loan').length, total_balance: roundMoney(totalBalance) },
    investments: { count: investments.length, total_value: roundMoney(totalInvestments) },
    assets: { count: assets.length, total_value: roundMoney(totalAssets) },
    loans: { count: loans.length, total_remaining: roundMoney(totalLoans) },
    monthly: { income: roundMoney(income), expenses: roundMoney(expenses), savings: roundMoney(income + expenses) },
    subscriptions: { count: subCount, monthly: roundMoney(subMonthly) },
    top_expense_categories: topCategories,
  };

  return {
    action_id: 'konto.get_summary',
    text_summary: `Net worth is ${summary.patrimoine_net} EUR with ${summary.loans.count} active loan(s).`,
    artifact_hint: 'stat_card',
    preferred_visualization: 'stat_card',
    open_in_app: kontoDeeplink('/dashboard'),
    data: { summary },
  };
}

async function listLoans(userId: number) {
  const result = await db.execute({
    sql: `SELECT ba.id, COALESCE(ba.custom_name, ba.name) as name, ba.balance, ba.bank_name,
                 ld.monthly_payment, ld.interest_rate, ld.start_date, ld.end_date,
                 ld.duration_months, ld.installments_paid, ld.insurance_monthly, ld.source
          FROM bank_accounts ba
          LEFT JOIN loan_details ld ON ld.bank_account_id = ba.id AND ld.user_id = ba.user_id
          WHERE ba.user_id = ? AND ba.type = 'loan' AND ba.hidden = 0
          ORDER BY ba.balance ASC`,
    args: [userId],
  });

  const loans = (result.rows as any[]).map((r) => ({
    id: Number(r.id),
    name: r.name || '',
    remaining_amount: roundMoney(r.balance),
    monthly_payment: r.monthly_payment ? roundMoney(r.monthly_payment) : null,
    rate: r.interest_rate ? roundMoney(r.interest_rate) : null,
    start_date: r.start_date || null,
    end_date: r.end_date || null,
    duration_months: r.duration_months || null,
    installments_paid: r.installments_paid || null,
    insurance_monthly: r.insurance_monthly ? roundMoney(r.insurance_monthly) : null,
    provider: r.bank_name || null,
  }));

  const latestEndDate = loans.map((loan) => loan.end_date).filter(Boolean).sort().at(-1) || null;

  return {
    action_id: 'konto.list_loans',
    text_summary: loans.length === 0
      ? 'No active loans found.'
      : `Found ${loans.length} active loan(s).${latestEndDate ? ` The latest one ends on ${latestEndDate}.` : ''}`,
    artifact_hint: 'table',
    preferred_visualization: 'table',
    open_in_app: kontoDeeplink('/loans'),
    data: { loans },
  };
}

async function getLoanDetail(userId: number, input: Record<string, any>) {
  const list = await listLoans(userId);
  const loans = (list.data?.loans || []) as any[];
  const targetId = input.loan_id ? Number(input.loan_id) : null;
  const targetName = typeof input.loan_name === 'string' ? input.loan_name.trim().toLowerCase() : '';

  let loan = null;
  if (targetId) {
    loan = loans.find((entry) => entry.id === targetId) || null;
  }
  if (!loan && targetName) {
    loan = loans.find((entry) => entry.name.toLowerCase() === targetName) || loans.find((entry) => entry.name.toLowerCase().includes(targetName)) || null;
  }
  if (!loan && loans.length === 1) {
    loan = loans[0];
  }

  return {
    action_id: 'konto.get_loan_detail',
    text_summary: loan
      ? `${loan.name} ends on ${loan.end_date || 'an unknown date'} with ${loan.remaining_amount} EUR remaining.`
      : 'No matching loan found.',
    artifact_hint: 'stat_card',
    preferred_visualization: 'stat_card',
    open_in_app: kontoLoanDeeplink(loan?.id || null),
    data: { loan, loans_considered: loans.length },
  };
}
