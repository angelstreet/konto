import { API } from '../../config';
import { useAuthFetch } from '../../useApi';
import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

type AccountRow = {
  id: number;
  name: string;
  custom_name?: string | null;
  bank_name?: string | null;
  provider?: string | null;
  balance: number;
  type: string;
  subtype?: string | null;
  hidden?: number;
  currency?: string | null;
};

type InvestmentRow = {
  id: number;
  bank_account_id: number;
  account_name?: string | null;
  account_custom_name?: string | null;
  label: string;
  isin_code?: string | null;
  quantity?: number;
  unit_price?: number;
  unit_value?: number;
  valuation?: number;
  diff?: number;
  diff_percent?: number;
  currency?: string | null;
};

type TxRow = {
  id: number;
  bank_account_id: number;
  date: string;
  amount: number;
  label?: string | null;
  category?: string | null;
  account_name?: string | null;
  account_custom_name?: string | null;
};

type RangeKey = '1M' | '3M' | '1A' | 'TOUT';

const RANGES: { key: RangeKey; days: number | null }[] = [
  { key: '1M', days: 30 },
  { key: '3M', days: 90 },
  { key: '1A', days: 365 },
  { key: 'TOUT', days: null },
];

function fmtCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v || 0);
}

function shortDate(d: string) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
}


type Props = {
  title: string;
  accountFilter: (a: AccountRow) => boolean;
  emptyHint: string;
};

export default function AssetClassShell({ title, accountFilter, emptyHint }: Props) {
  const authFetch = useAuthFetch();
  const [isMobile, setIsMobile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('1A');
  const [tab, setTab] = useState<'accounts' | 'transactions'>('accounts');
  const [selectedTx, setSelectedTx] = useState<TxRow | null>(null);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [accRes, invRes, txRes] = await Promise.all([
          authFetch(`${API}/bank/accounts`),
          authFetch(`${API}/investments`),
          authFetch(`${API}/transactions?limit=2000&offset=0`),
        ]);

        const accJson = await accRes.json();
        const invJson = await invRes.json();
        const txJson = await txRes.json();

        if (!accRes.ok) throw new Error(accJson?.error || 'Failed loading accounts');
        if (!invRes.ok) throw new Error(invJson?.error || 'Failed loading investments');
        if (!txRes.ok) throw new Error(txJson?.error || 'Failed loading transactions');

        const allAccounts = (accJson as AccountRow[]).filter(a => !a.hidden);
        const filteredAccounts = allAccounts.filter(accountFilter);
        const idSet = new Set(filteredAccounts.map(a => a.id));

        const allInv = (invJson?.investments || []) as InvestmentRow[];
        const filteredInv = allInv.filter(i => idSet.has(i.bank_account_id));

        const allTx = (txJson?.transactions || []) as TxRow[];
        const filteredTx = allTx.filter(t => idSet.has(t.bank_account_id));

        if (!mounted) return;
        setAccounts(filteredAccounts);
        setInvestments(filteredInv);
        setTxs(filteredTx);
        setSelectedTx(filteredTx[0] || null);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed loading asset class');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, [authFetch, accountFilter]);

  const accountById = useMemo(() => {
    const m = new Map<number, AccountRow>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  const grouped = useMemo(() => {
    const byAcc = new Map<number, { account: AccountRow; positions: InvestmentRow[]; total: number; perf: number }>();
    for (const a of accounts) byAcc.set(a.id, { account: a, positions: [], total: Math.max(0, Number(a.balance || 0)), perf: 0 });

    for (const inv of investments) {
      const row = byAcc.get(inv.bank_account_id);
      if (!row) continue;
      row.positions.push(inv);
      row.total += Number(inv.valuation || 0);
      row.perf += Number(inv.diff || 0);
    }

    return Array.from(byAcc.values()).sort((a, b) => b.total - a.total);
  }, [accounts, investments]);

  const totalValue = useMemo(() => grouped.reduce((s, g) => s + g.total, 0), [grouped]);
  const filteredTxByRange = useMemo(() => {
    const selected = RANGES.find(r => r.key === range)!;
    const effectiveDays = isMobile ? 180 : selected.days;
    if (!effectiveDays) return txs;
    const cutoff = Date.now() - (effectiveDays * 24 * 60 * 60 * 1000);
    return txs.filter(t => new Date(t.date).getTime() >= cutoff);
  }, [txs, range, isMobile]);

  const chartData = useMemo(() => {
    if (totalValue <= 0) return [] as { date: string; value: number }[];

    const selected = RANGES.find(r => r.key === range)!;
    const days = isMobile ? 180 : (selected.days || 365);
    const startTs = Date.now() - (days * 24 * 60 * 60 * 1000);

    const netByDate = new Map<string, number>();
    for (const t of filteredTxByRange) {
      const d = (t.date || '').slice(0, 10);
      netByDate.set(d, (netByDate.get(d) || 0) + Number(t.amount || 0));
    }

    const totalNet = Array.from(netByDate.values()).reduce((a, b) => a + b, 0);
    let running = Math.max(0, totalValue - totalNet);

    const out: { date: string; value: number }[] = [];
    for (let i = 0; i <= days; i++) {
      const d = new Date(startTs + (i * 24 * 60 * 60 * 1000));
      const key = d.toISOString().slice(0, 10);
      running += (netByDate.get(key) || 0);
      out.push({ date: key, value: Math.max(0, running) });
    }

    return out;
  }, [filteredTxByRange, totalValue, range, isMobile]);

  const chartPerf = useMemo(() => {
    if (chartData.length < 2) return { diff: 0, pct: 0 };
    const last = chartData[chartData.length - 1].value;
    // Use first non-zero value as base to avoid 0% when chart starts from 0
    const firstNonZero = chartData.find(d => d.value > 0)?.value ?? 0;
    const first = firstNonZero;
    const diff = last - first;
    const pct = first > 0 ? ((last / first) - 1) * 100 : 0;
    return { diff, pct };
  }, [chartData]);

  const hasData = grouped.length > 0 || txs.length > 0;

  return (
    <div className="space-y-4 max-w-7xl overflow-x-hidden">
      <div className="flex items-center justify-between gap-2 mb-2 min-h-10">
        <div className="flex items-center gap-1 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">{title}</h1>
        </div>
        {isMobile ? (
          <div className="px-3 py-1.5 text-xs rounded-md border border-border bg-surface text-muted whitespace-nowrap">
            6M
          </div>
        ) : (
          <div className="w-full sm:w-auto max-w-full rounded-lg bg-surface border border-border p-1 overflow-x-auto">
            <div className="flex items-center gap-1 min-w-max">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`px-3 py-2 text-xs rounded-md whitespace-nowrap min-h-[38px] ${range === r.key ? 'bg-accent-500/20 text-accent-400' : 'text-muted hover:text-white'}`}
                >
                  {r.key}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 sm:p-4 text-center">
        <p className="text-xs text-muted tracking-wider mb-1">Valeur totale</p>
        <p className="text-2xl sm:text-3xl font-bold text-accent-400">{fmtCurrency(totalValue)}</p>
      </div>

      {loading && <div className="text-sm text-muted py-8 text-center">Loading…</div>}
      {error && <div className="text-sm text-red-400 py-3">{error}</div>}

      {!loading && !error && (
        <>
          {!hasData && (
            <div className="bg-surface border border-border rounded-xl p-6 text-sm text-muted">{emptyHint}</div>
          )}

          {hasData && (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="h-[260px] sm:h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: '#9ca3af', fontSize: 11 }} minTickGap={24} />
                      <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} tickFormatter={(v) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v))} />
                      <Tooltip
                        formatter={(v: any) => fmtCurrency(Number(v))}
                        labelFormatter={(v: any) => new Date(v).toLocaleDateString('fr-FR')}
                        cursor={{ fill: 'rgba(120,120,120,0.22)' }}
                        contentStyle={{ backgroundColor: '#1f1f1f', border: '1px solid #3a3a3a', borderRadius: 8, color: '#e5e5e5' }}
                        itemStyle={{ color: '#e5e5e5' }}
                      />
                      <Line type="monotone" dataKey="value" stroke="#d4a812" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-surface border border-border rounded-xl p-4">
                <div className="text-2xl font-semibold mb-1">Performance</div>
                <div className={`text-2xl sm:text-3xl font-semibold ${chartPerf.diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {chartPerf.diff >= 0 ? '+' : ''}{fmtCurrency(chartPerf.diff)}
                </div>
                <div className={`inline-block mt-2 text-xs px-2 py-1 rounded ${chartPerf.diff >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                  {chartPerf.diff >= 0 ? '+' : ''}{chartPerf.pct.toFixed(2)}%
                </div>
                <p className="text-sm text-muted mt-4">Variation estimée sur la période sélectionnée, basée sur les flux et valorisations disponibles.</p>
              </div>
            </div>
          )}

          {hasData && (
            <>
              <div className="flex items-center gap-4 border-b border-border">
                <button onClick={() => setTab('accounts')} className={`pb-2 text-sm min-h-[38px] ${tab === 'accounts' ? 'text-accent-400 border-b-2 border-accent-400' : 'text-muted hover:text-white'}`}>
                  Comptes
                </button>
                <button onClick={() => setTab('transactions')} className={`pb-2 text-sm min-h-[38px] ${tab === 'transactions' ? 'text-accent-400 border-b-2 border-accent-400' : 'text-muted hover:text-white'}`}>
                  Transactions
                </button>
              </div>

              {tab === 'accounts' ? (
                <div className="space-y-3">
                  {grouped.map((g) => (
                    <div key={g.account.id} className="bg-surface border border-border rounded-xl overflow-hidden">
                      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 border-b border-border/50">
                        <div className="font-medium pr-2">{g.account.custom_name || g.account.name}</div>
                        <div className="text-right">
                          <div className="font-semibold">{fmtCurrency(g.total)}</div>
                          <div className={`text-xs ${g.perf >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{g.perf >= 0 ? '+' : ''}{fmtCurrency(g.perf)}</div>
                        </div>
                      </div>
                      {g.positions.length > 0 && (
                        <>
                          <div className="overflow-x-auto hidden md:block">
                            <table className="w-full min-w-[760px] text-sm">
                              <thead className="text-xs text-muted border-b border-border/50">
                                <tr>
                                  <th className="text-left px-4 py-2">Actif</th>
                                  <th className="text-right px-4 py-2">Quantité</th>
                                  <th className="text-right px-4 py-2">PRU</th>
                                  <th className="text-right px-4 py-2">Prix actuel</th>
                                  <th className="text-right px-4 py-2">Valeur</th>
                                  <th className="text-right px-4 py-2">P/L</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.positions.map((p) => (
                                  <tr key={p.id} className="border-b border-border/30">
                                    <td className="px-4 py-2">{p.label}</td>
                                    <td className="px-4 py-2 text-right">{(p.quantity || 0).toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</td>
                                    <td className="px-4 py-2 text-right">{fmtCurrency(Number(p.unit_price || 0))}</td>
                                    <td className="px-4 py-2 text-right">{fmtCurrency(Number(p.unit_value || 0))}</td>
                                    <td className="px-4 py-2 text-right">{fmtCurrency(Number(p.valuation || 0))}</td>
                                    <td className={`px-4 py-2 text-right ${Number(p.diff || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{Number(p.diff || 0) >= 0 ? '+' : ''}{fmtCurrency(Number(p.diff || 0))}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="md:hidden divide-y divide-border/30">
                            {g.positions.map((p) => (
                              <div key={p.id} className="px-4 py-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="text-sm font-medium pr-2">{p.label}</div>
                                  <div className={`text-sm font-medium whitespace-nowrap ${Number(p.diff || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {Number(p.diff || 0) >= 0 ? '+' : ''}{fmtCurrency(Number(p.diff || 0))}
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-2 text-xs">
                                  <div className="text-muted">Qté</div>
                                  <div className="text-right">{(p.quantity || 0).toLocaleString('fr-FR', { maximumFractionDigits: 6 })}</div>
                                  <div className="text-muted">Valeur</div>
                                  <div className="text-right">{fmtCurrency(Number(p.valuation || 0))}</div>
                                  <div className="text-muted">PRU / Actuel</div>
                                  <div className="text-right">{fmtCurrency(Number(p.unit_price || 0))} / {fmtCurrency(Number(p.unit_value || 0))}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
                  <div className="bg-surface border border-border rounded-xl overflow-hidden">
                    <div className="max-h-[560px] overflow-auto divide-y divide-border/40">
                      {filteredTxByRange.map((t) => {
                        const acc = accountById.get(t.bank_account_id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => setSelectedTx(t)}
                            className={`w-full text-left px-4 py-3 min-h-[56px] hover:bg-surface-hover transition-colors ${selectedTx?.id === t.id ? 'bg-surface-hover' : ''}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-sm">{t.label || 'Transaction'}</div>
                                <div className="text-xs text-muted mt-0.5">{new Date(t.date).toLocaleDateString('fr-FR')} • {acc?.custom_name || acc?.name || 'Compte'}</div>
                              </div>
                              <div className={`text-sm font-medium ${Number(t.amount || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {Number(t.amount || 0) >= 0 ? '+' : ''}{fmtCurrency(Number(t.amount || 0))}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-surface border border-border rounded-xl p-4">
                    <h3 className="text-lg font-medium mb-3">Détails transaction</h3>
                    {selectedTx ? (
                      <div className="space-y-2 text-sm">
                        <div className="text-muted">{selectedTx.label || 'Transaction'}</div>
                        <div className={`text-2xl font-semibold ${Number(selectedTx.amount || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {Number(selectedTx.amount || 0) >= 0 ? '+' : ''}{fmtCurrency(Number(selectedTx.amount || 0))}
                        </div>
                        <div className="pt-2 border-t border-border/60" />
                        <div className="flex items-center justify-between gap-3"><span className="text-muted">Date</span><span className="text-right">{new Date(selectedTx.date).toLocaleDateString('fr-FR')}</span></div>
                        <div className="flex items-center justify-between gap-3"><span className="text-muted">Compte</span><span className="text-right">{accountById.get(selectedTx.bank_account_id)?.custom_name || accountById.get(selectedTx.bank_account_id)?.name || '—'}</span></div>
                        <div className="flex items-center justify-between gap-3"><span className="text-muted">Catégorie</span><span className="text-right">{selectedTx.category || '—'}</span></div>
                      </div>
                    ) : (
                      <div className="text-sm text-muted">Aucune transaction sélectionnée.</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
