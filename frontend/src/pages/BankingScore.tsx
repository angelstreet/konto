import { API } from '../config';
import { useEffect, useMemo, useState } from 'react';
import { useAuthFetch } from '../useApi';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Landmark, TrendingUp } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';

type AccountRow = {
  id: number;
  name: string;
  custom_name?: string | null;
  bank_name?: string | null;
  provider_bank_id?: string | null;
  provider_bank_name?: string | null;
  provider?: string | null;
  balance: number;
  type: string;
  hidden?: number;
};

type TxRow = {
  bank_account_id: number;
  amount: number;
  date: string;
};

type BankMetric = {
  bank: string;
  assets: number;
  loans: number;
  incomeIn: number;
  prevIncomeIn: number;
  chargesOut: number;
  prevChargesOut: number;
  debtService: number;
  netFlow: number;
  riskRatio: number;
  score: number;
  suggestedLoan: number;
  lowLoan: number;
  highLoan: number;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v || 0);
}

function fmtCompact(v: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(v || 0);
}

function ratioPct(v: number) {
  return `${Math.round((v || 0) * 100)}%`;
}

const PIE_COLORS = ['#f59e0b', '#22c55e', '#3b82f6', '#ef4444', '#14b8a6', '#eab308', '#a855f7'];

function deltaPct(current: number, previous: number) {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function normalizedLabel(v: string) {
  return v.replace(/\s+/g, ' ').trim();
}

const BIC_TO_BANK: Record<string, string> = {
  // CIC Group
  CMCIFRPPXXX: 'CIC',
  CMCIFRPP: 'CIC',
  // Credit Agricole
  AGRIFRPP887: 'Credit Agricole',
  AGRIFRPP: 'Credit Agricole',
  // BNP Paribas
  BNPAFRPP: 'BNP Paribas',
  BNPAFRPPXXX: 'BNP Paribas',
  // Société Générale
  SOGEFRPP: 'Société Générale',
  SOGEFRPPXXX: 'Société Générale',
  // LCL
  LYCFRPP: 'LCL',
  LYCFRPPXXX: 'LCL',
  // Banque Populaire
  CCBPFRPP: 'Banque Populaire',
  // Crédit Mutuel
  // HSBC
  CCFRFRPP: 'HSBC France',
  // La Banque Postale
  PSSTFRPP: 'La Banque Postale',
  // Fortuneo
  FTNOFRPP: 'Fortuneo',
  // Boursorama
  BOUSFRPP: 'Boursorama',
  // Hello Bank
  HELLFRPP: 'Hello bank!',
};

function bankIdentity(account: AccountRow): { key: string; label: string } {
  // Provider-level overrides
  if (account.provider === 'blockchain') {
    return { key: 'crypto', label: 'Crypto' };
  }

  if (account.provider_bank_id && account.provider_bank_name) {
    const label = normalizedLabel(account.provider_bank_name);
    return { key: `powens:${account.provider_bank_id}`, label };
  }
  if (account.provider_bank_name && normalizedLabel(account.provider_bank_name)) {
    const label = normalizedLabel(account.provider_bank_name);
    return { key: `powens-name:${label.toLowerCase()}`, label };
  }
  if (account.bank_name) {
    const raw = account.bank_name.trim();
    const mapped = BIC_TO_BANK[raw];
    if (mapped) {
      // BIC code — use friendly name, group by BIC key
      return { key: `bic:${raw}`, label: mapped };
    }
    const label = normalizedLabel(raw);
    if (label) return { key: `bank-name:${label.toLowerCase()}`, label };
  }
  // NULL bank_name: try to infer from account name for powens accounts
  if (account.provider === 'powens' || account.provider === 'manual') {
    if (account.provider === 'manual') {
      return { key: 'manual-other', label: 'Other' };
    }
    // Powens with no bank_name — group as CIC (most NULL powens accounts are CIC)
    const name = (account as any).name ?? '';
    if (/cic|contrat|PEA/i.test(name)) {
      return { key: 'bic:CMCIFRPPXXX', label: 'CIC' };
    }
    return { key: 'powens-unknown', label: 'CIC' };
  }
  return { key: 'other', label: 'Other' };
}

function scoreFor(m: Omit<BankMetric, 'score' | 'suggestedLoan' | 'lowLoan' | 'highLoan'>) {
  const debtPressure = clamp(1 - (m.debtService / Math.max(1, m.incomeIn)), 0, 1);
  const assetCoverage = clamp(m.assets / Math.max(1, m.loans || 1), 0, 2) / 2;
  const flowStability = clamp((m.netFlow / Math.max(1, m.incomeIn)) + 0.5, 0, 1);
  const relationshipDepth = clamp((m.assets + (m.incomeIn * 6)) / 250_000, 0, 1);
  return Math.round(100 * ((0.35 * debtPressure) + (0.3 * assetCoverage) + (0.2 * flowStability) + (0.15 * relationshipDepth)));
}

function loanCapacity(m: Omit<BankMetric, 'score' | 'suggestedLoan' | 'lowLoan' | 'highLoan'>, monthFactor: number) {
  const avgIncome = m.incomeIn / monthFactor;
  const avgCharges = m.chargesOut / monthFactor;
  const freeCash = Math.max(0, avgIncome - avgCharges);
  const cashflowCap = freeCash * 120;
  const collateralCap = Math.max(0, (m.assets * 0.6) - (m.loans * 0.2));
  const suggested = Math.round((cashflowCap * 0.6) + (collateralCap * 0.4));
  return {
    suggested,
    low: Math.round(suggested * 0.7),
    high: Math.round(suggested * 1.2),
  };
}

export default function BankingScore() {
  const navigate = useNavigate();
  const authFetch = useAuthFetch();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<BankMetric[]>([]);
  const [selectedBank, setSelectedBank] = useState('All');

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [accountsRes, txRes] = await Promise.all([
          authFetch(`${API}/bank/accounts`),
          authFetch(`${API}/transactions?limit=5000&offset=0`),
        ]);
        const accountsJson = await accountsRes.json();
        const txJson = await txRes.json();

        if (!accountsRes.ok) throw new Error(accountsJson?.error || 'Failed to load bank accounts');
        if (!txRes.ok) throw new Error(txJson?.error || 'Failed to load transactions');

        const accounts = (accountsJson as AccountRow[]).filter(a => !a.hidden);
        const txs = ((txJson?.transactions || []) as TxRow[]);

        const now = Date.now();
        const lookbackDays = 90;
        const lookbackMs = lookbackDays * 24 * 60 * 60 * 1000;
        const recentTx = txs.filter(t => {
          const d = new Date(t.date).getTime();
          return !Number.isNaN(d) && (now - d) <= lookbackMs;
        });

        const accountMap = new Map<number, AccountRow>();
        for (const a of accounts) accountMap.set(a.id, a);

        const byBank = new Map<string, Omit<BankMetric, 'score' | 'suggestedLoan' | 'lowLoan' | 'highLoan'>>();

        for (const a of accounts) {
          const identity = bankIdentity(a);
          if (!byBank.has(identity.key)) {
            byBank.set(identity.key, {
              bank: identity.label,
              assets: 0,
              loans: 0,
              incomeIn: 0,
              prevIncomeIn: 0,
              chargesOut: 0,
              prevChargesOut: 0,
              debtService: 0,
              netFlow: 0,
              riskRatio: 0,
            });
          }
          const m = byBank.get(identity.key)!;
          if (a.type === 'loan') {
            m.loans += Math.abs(Math.min(0, Number(a.balance || 0)));
          } else {
            m.assets += Math.max(0, Number(a.balance || 0));
          }
        }

        for (const t of recentTx) {
          const a = accountMap.get(Number(t.bank_account_id));
          if (!a) continue;
          const identity = bankIdentity(a);
          if (!byBank.has(identity.key)) continue;
          const m = byBank.get(identity.key)!;
          const amt = Number(t.amount || 0);
          if (amt > 0) m.incomeIn += amt;
          else m.chargesOut += Math.abs(amt);

          if (a.type === 'loan' && amt < 0) {
            m.debtService += Math.abs(amt);
          }
        }

        const prevTx = txs.filter(t => {
          const d = new Date(t.date).getTime();
          return !Number.isNaN(d) && (now - d) > lookbackMs && (now - d) <= (lookbackMs * 2);
        });

        for (const t of prevTx) {
          const a = accountMap.get(Number(t.bank_account_id));
          if (!a) continue;
          const identity = bankIdentity(a);
          if (!byBank.has(identity.key)) continue;
          const m = byBank.get(identity.key)!;
          const amt = Number(t.amount || 0);
          if (amt > 0) m.prevIncomeIn += amt;
          else m.prevChargesOut += Math.abs(amt);
        }

        const monthFactor = lookbackDays / 30;
        const enriched: BankMetric[] = Array.from(byBank.values()).map((m) => {
          m.netFlow = m.incomeIn - m.chargesOut;
          m.riskRatio = m.debtService / Math.max(1, m.incomeIn);
          const score = scoreFor(m);
          const cap = loanCapacity(m, monthFactor);
          return {
            ...m,
            score,
            suggestedLoan: cap.suggested,
            lowLoan: cap.low,
            highLoan: cap.high,
          };
        }).sort((a, b) => b.score - a.score);

        if (!mounted) return;
        setMetrics(enriched);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load banking score');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, [authFetch]);

  const filtered = useMemo(() => {
    if (selectedBank === 'All') return metrics;
    return metrics.filter(m => m.bank === selectedBank);
  }, [metrics, selectedBank]);

  const global = useMemo(() => {
    const base = (selectedBank === 'All' ? metrics : filtered);
    const sum = base.reduce((acc, m) => {
      acc.assets += m.assets;
      acc.loans += m.loans;
      acc.incomeIn += m.incomeIn;
      acc.prevIncomeIn += m.prevIncomeIn;
      acc.chargesOut += m.chargesOut;
      acc.prevChargesOut += m.prevChargesOut;
      acc.debtService += m.debtService;
      acc.netFlow += m.netFlow;
      acc.capacity += m.suggestedLoan;
      acc.scoreWeighted += (m.score * Math.max(1, m.incomeIn));
      acc.weight += Math.max(1, m.incomeIn);
      return acc;
    }, {
      assets: 0,
      loans: 0,
      incomeIn: 0,
      prevIncomeIn: 0,
      chargesOut: 0,
      prevChargesOut: 0,
      debtService: 0,
      netFlow: 0,
      capacity: 0,
      scoreWeighted: 0,
      weight: 0,
    });

    return {
      ...sum,
      score: Math.round(sum.scoreWeighted / Math.max(1, sum.weight)),
      debtRatio: sum.debtService / Math.max(1, sum.incomeIn),
      incomeDeltaPct: deltaPct(sum.incomeIn, sum.prevIncomeIn),
      chargesDeltaPct: deltaPct(sum.chargesOut, sum.prevChargesOut),
    };
  }, [metrics, filtered, selectedBank]);

  const bestBank = metrics[0] || null;
  const focusBank = selectedBank === 'All' ? bestBank : filtered[0] || null;
  const banksWithLoans = filtered.filter((m) => m.loans > 0);
  const pieData = banksWithLoans.map((m) => ({ name: m.bank, value: m.loans }));
  const stackedData = (selectedBank === 'All' ? metrics : filtered).filter((m) => m.loans > 0 || m.incomeIn > 0 || m.chargesOut > 0);

  const privateGaps = useMemo(() => {
    if (!focusBank) return [] as string[];
    const gaps: string[] = [];
    if (focusBank.riskRatio > 0.35) gaps.push('Debt service ratio is high for this bank relationship.');
    if (focusBank.netFlow < 0) gaps.push('Net monthly flow is negative on this bank perimeter.');
    if (focusBank.assets < focusBank.loans * 0.7) gaps.push('Asset coverage is weak compared to outstanding loans.');
    if (gaps.length === 0) gaps.push('No major weaknesses detected on current data window.');
    return gaps;
  }, [focusBank]);

  const advice = useMemo(() => {
    if (!focusBank) return [] as string[];
    const actions: string[] = [];
    const moveTarget = Math.max(10_000, Math.round(focusBank.loans * 0.2 / 1000) * 1000);
    actions.push(`Move around ${fmtCompact(moveTarget)} in stable savings to ${focusBank.bank} before application.`);
    actions.push('Concentrate salary inflow and recurring expenses on the target bank for 3-6 months.');
    actions.push('Ask for phased drawdown: part now, part after flow stabilization, to improve approval odds.');
    return actions;
  }, [focusBank]);

  return (
    <div className="space-y-4 max-w-6xl overflow-x-hidden">
      <div className="mb-2 space-y-2 md:space-y-0 md:flex md:items-center md:justify-between md:gap-2 md:h-10">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap flex items-center gap-2">
            <Landmark size={20} />
            Banking Score
          </h1>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <label className="hidden md:block text-xs text-muted">Bank</label>
          <select
            value={selectedBank}
            onChange={(e) => setSelectedBank(e.target.value)}
            className="w-full md:w-auto bg-surface border border-border rounded-lg text-xs text-white px-2.5 py-1.5 min-h-[36px]"
          >
            <option value="All">All banks</option>
            {metrics.map((m) => (
              <option key={m.bank} value={m.bank}>{m.bank}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className="text-sm text-muted py-8 text-center">Loading…</div>}
      {error && <div className="text-sm text-red-400 py-4">{error}</div>}

      {!loading && !error && (
        <>
          <div className="bg-surface border border-border rounded-xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg bg-background border border-border p-3">
                <div className="text-xs text-muted">Global Score</div>
                <div className="text-lg font-semibold text-accent-400">{global.score}/100</div>
              </div>
              <div className="rounded-lg bg-background border border-border p-3">
                <div className="text-xs text-muted">Income (90d)</div>
                <div className="text-lg font-semibold">{fmtCurrency(global.incomeIn)}</div>
                <div className={`text-[11px] mt-1 ${global.incomeDeltaPct === null ? 'text-muted' : global.incomeDeltaPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {global.incomeDeltaPct === null ? 'No previous period' : `${global.incomeDeltaPct >= 0 ? '+' : ''}${Math.round(global.incomeDeltaPct)}% vs prev 90d`}
                </div>
              </div>
              <div className="rounded-lg bg-background border border-border p-3">
                <div className="text-xs text-muted">Charges (90d)</div>
                <div className="text-lg font-semibold">{fmtCurrency(global.chargesOut)}</div>
                <div className={`text-[11px] mt-1 ${global.chargesDeltaPct === null ? 'text-muted' : global.chargesDeltaPct <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {global.chargesDeltaPct === null ? 'No previous period' : `${global.chargesDeltaPct >= 0 ? '+' : ''}${Math.round(global.chargesDeltaPct)}% vs prev 90d`}
                </div>
              </div>
              <div className="rounded-lg bg-background border border-border p-3">
                <div className="text-xs text-muted">Capacity estimate</div>
                <div className="text-lg font-semibold text-emerald-400">{fmtCurrency(global.capacity)}</div>
              </div>
            </div>
            <div className="mt-3 text-xs text-muted">
              Assets: {fmtCurrency(global.assets)} • Loans: {fmtCurrency(global.loans)} • Debt service / income (90d): {ratioPct(global.debtRatio)}
              {global.debtService === 0 && global.loans > 0 ? ' • No loan payment detected in the last 90 days' : ''}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-sm font-medium mb-3">Loans Distribution per Bank</div>
              <div className="h-56">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="name"
                        cx="35%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={2}
                      >
                        {pieData.map((entry, i) => (
                          <Cell key={`${entry.name}-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: any) => fmtCurrency(Number(v))}
                        contentStyle={{ backgroundColor: '#1f1f1f', border: '1px solid #3a3a3a', borderRadius: 8, color: '#e5e5e5' }}
                        itemStyle={{ color: '#e5e5e5' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-sm text-muted">No loan balance found in selected banks.</div>
                )}
              </div>
              {pieData.length > 0 && (
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                  {pieData.map((p, i) => (
                    <div key={p.name} className="flex items-center justify-between gap-2 text-muted">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="truncate">{p.name}</span>
                      </div>
                      <span className="text-white/90">{fmtCurrency(p.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-sm font-medium mb-3">Income + Charges per Bank (stacked, 90d)</div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={stackedData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="bank" tick={{ fontSize: 11, fill: '#9ca3af' }} interval={0} angle={-18} textAnchor="end" height={55} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickFormatter={(v) => fmtCompact(Number(v))} />
                    <Tooltip
                      formatter={(v: any) => fmtCurrency(Number(v))}
                      cursor={{ fill: 'rgba(120,120,120,0.22)' }}
                      contentStyle={{ backgroundColor: '#1f1f1f', border: '1px solid #3a3a3a', borderRadius: 8, color: '#e5e5e5' }}
                      itemStyle={{ color: '#e5e5e5' }}
                    />
                    <Bar dataKey="incomeIn" name="Income" stackId="flow" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="chargesOut" name="Charges" stackId="flow" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4 overflow-x-auto">
            <div className="text-sm font-medium mb-3">Bank Data</div>
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-xs text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2">Bank</th>
                  <th className="text-right py-2">Assets</th>
                  <th className="text-right py-2">Loans</th>
                  <th className="text-right py-2">Income</th>
                  <th className="text-right py-2">Charges</th>
                  <th className="text-right py-2">Net flow</th>
                  <th className="text-right py-2">Debt ratio</th>
                  <th className="text-right py-2">Score</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr key={m.bank} className="border-b border-border/50">
                    <td className="py-2">{m.bank}</td>
                    <td className="py-2 text-right">{fmtCurrency(m.assets)}</td>
                    <td className="py-2 text-right">{fmtCurrency(m.loans)}</td>
                    <td className="py-2 text-right">{fmtCurrency(m.incomeIn)}</td>
                    <td className="py-2 text-right">{fmtCurrency(m.chargesOut)}</td>
                    <td className={`py-2 text-right ${m.netFlow >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtCurrency(m.netFlow)}</td>
                    <td className="py-2 text-right">{ratioPct(m.riskRatio)}</td>
                    <td className="py-2 text-right font-semibold text-accent-400">{m.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-sm font-medium mb-3">Private Gaps</div>
              <div className="space-y-2">
                {privateGaps.map((g, i) => (
                  <div key={i} className="text-sm text-muted">• {g}</div>
                ))}
              </div>
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-sm font-medium mb-3">Win-Win Actions</div>
              <div className="space-y-2">
                {advice.map((a, i) => (
                  <div key={i} className="text-sm text-muted">• {a}</div>
                ))}
              </div>
            </div>

            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="text-sm font-medium mb-2">Negotiation Plan</div>
              {focusBank ? (
                <>
                  <div className="text-sm text-white mb-2">Target: <span className="text-accent-400">{focusBank.bank}</span></div>
                  <div className="text-sm text-muted">Suggested ask: {fmtCurrency(focusBank.lowLoan)} - {fmtCurrency(focusBank.highLoan)}</div>
                  <div className="text-xs text-muted mt-2 flex items-center gap-1.5"><TrendingUp size={13} /> Keep relationship long-term: transfer stable assets + recurring flows before asking.</div>
                </>
              ) : (
                <div className="text-sm text-muted">No bank data available yet.</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
