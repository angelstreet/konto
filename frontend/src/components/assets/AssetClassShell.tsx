import { API } from '../../config';
import { useAuthFetch } from '../../useApi';
import { useFilter } from '../../FilterContext';
import ScopeSelect from '../ScopeSelect';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ChevronDown } from 'lucide-react';

type AccountRow = {
  id: number;
  name: string;
  custom_name?: string | null;
  bank_name?: string | null;
  provider?: string | null;
  balance: number;
  balance_native?: number | null;
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
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v || 0);
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
  const { scope, appendScope } = useFilter();
  const authFetchRef = useRef(authFetch);
  authFetchRef.current = authFetch;
  const appendScopeRef = useRef(appendScope);
  appendScopeRef.current = appendScope;
  const [isMobile, setIsMobile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('1A');
  const [tab, setTab] = useState<'accounts' | 'transactions'>('accounts');
  const [selectedTx, setSelectedTx] = useState<TxRow | null>(null);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [cryptoPrices, setCryptoPrices] = useState<Record<string, number>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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
      const af = authFetchRef.current;
      const as = appendScopeRef.current;
      try {
        const [accRes, invRes, txRes, pricesRes] = await Promise.all([
          af(as(`${API}/bank/accounts`)),
          af(as(`${API}/investments`)),
          af(as(`${API}/transactions?limit=2000&offset=0`)),
          af(`${API}/crypto/prices`).catch(() => null),
        ]);

        const accJson = await accRes.json();
        const invJson = await invRes.json();
        const txJson = await txRes.json();

        if (!accRes.ok) throw new Error(accJson?.error || 'Failed loading accounts');
        if (!invRes.ok) throw new Error(invJson?.error || 'Failed loading investments');
        if (!txRes.ok) throw new Error(txJson?.error || 'Failed loading transactions');

        // Build currency→EUR price map
        // Response shape: { BTC: 84000, ETH: 3200, ... }
        let priceMap: Record<string, number> = {};
        if (pricesRes?.ok) {
          priceMap = await pricesRes.json();
        }

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
        setCryptoPrices(priceMap);
        setSelectedTx(filteredTx[0] || null);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed loading asset class');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => { mounted = false; };
  }, [accountFilter, scope]);

  const accountById = useMemo(() => {
    const m = new Map<number, AccountRow>();
    for (const a of accounts) m.set(a.id, a);
    return m;
  }, [accounts]);

  // Group coinbase/binance under provider, keep others individual
  const PROVIDER_GROUP = new Set(['coinbase', 'binance']);
  const providerLabels: Record<string, string> = { coinbase: 'Coinbase', binance: 'Binance' };

  type GroupRow = { key: string; label: string; isProvider: boolean; accounts: AccountRow[]; positions: InvestmentRow[]; total: number; perf: number };

  const grouped = useMemo(() => {
    const providerGroups = new Map<string, GroupRow>();
    const individualGroups: GroupRow[] = [];

    // First pass: assign accounts to groups
    for (const a of accounts) {
      const prov = a.provider || '';
      if (PROVIDER_GROUP.has(prov)) {
        if (!providerGroups.has(prov)) {
          providerGroups.set(prov, { key: `prov-${prov}`, label: providerLabels[prov] || prov, isProvider: true, accounts: [], positions: [], total: 0, perf: 0 });
        }
        providerGroups.get(prov)!.accounts.push(a);
      } else {
        individualGroups.push({ key: `acc-${a.id}`, label: a.custom_name || a.name, isProvider: false, accounts: [a], positions: [], total: 0, perf: 0 });
      }
    }

    const allGroups = [...providerGroups.values(), ...individualGroups];

    // Assign investments to groups
    const accToGroup = new Map<number, GroupRow>();
    for (const g of allGroups) {
      for (const a of g.accounts) accToGroup.set(a.id, g);
    }
    for (const inv of investments) {
      const g = accToGroup.get(inv.bank_account_id);
      if (g) {
        g.positions.push(inv);
        g.perf += Number(inv.diff || 0);
      }
    }

    // Calculate totals
    for (const g of allGroups) {
      if (g.isProvider) {
        // Use balance_native (EUR from Coinbase portfolio) when available
        g.total = g.accounts.reduce((s, a) => {
          if (a.balance_native) return s + a.balance_native;
          const bal = Math.max(0, Number(a.balance || 0));
          const cur = a.currency || 'EUR';
          const eurPrice = cryptoPrices[cur];
          return s + (eurPrice ? bal * eurPrice : 0);
        }, 0);
      } else {
        const invTotal = g.positions.reduce((s, p) => s + Number(p.valuation || 0), 0);
        if (g.positions.length > 0) {
          g.total = invTotal;
        } else {
          const a = g.accounts[0];
          const bal = Math.max(0, Number(a.balance || 0));
          const cur = a.currency || 'EUR';
          const eurPrice = cryptoPrices[cur];
          g.total = eurPrice ? bal * eurPrice : bal;
        }
      }
    }

    return allGroups.sort((a, b) => b.total - a.total);
  }, [accounts, investments, cryptoPrices]);

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
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">{title}</h1>
          <ScopeSelect />
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-2 text-xs rounded-md font-medium transition-colors min-h-[44px] min-w-[44px] ${
                range === r.key ? 'bg-accent-500/20 text-accent-400' : 'text-muted hover:text-white hover:bg-surface-hover'
              }`}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm text-muted py-8 text-center">Loading…</div>}
      {error && <div className="text-sm text-red-400 py-3">{error}</div>}

      {!loading && !error && hasData && (
        <div className="bg-surface rounded-xl border border-border p-3 sm:p-4 text-center">
          <p className="text-xs text-muted tracking-wider mb-1">Valeur totale</p>
          <p className="text-2xl sm:text-3xl font-bold text-accent-400">{fmtCurrency(totalValue)}</p>
        </div>
      )}

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
                  {grouped.map((g) => {
                    const collapseKey = g.key;
                    const isCollapsed = collapsed.has(collapseKey);
                    const toggleCollapse = () => setCollapsed(prev => {
                      const next = new Set(prev);
                      if (next.has(collapseKey)) next.delete(collapseKey); else next.add(collapseKey);
                      return next;
                    });

                    // Provider group (Coinbase/Binance) — show wallets as rows
                    if (g.isProvider) {
                      const wallets = g.accounts
                        .filter(a => Math.abs(a.balance || 0) >= 0.01)
                        .sort((a, b) => (b.balance_native || 0) - (a.balance_native || 0));
                      if (wallets.length === 0) return null;
                      return (
                        <div key={g.key} className="bg-surface border border-border rounded-xl overflow-hidden">
                          <button onClick={toggleCollapse} className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface-hover transition-colors">
                            <div className="flex items-center gap-2 min-w-0">
                              <ChevronDown size={16} className={`text-muted flex-shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                              <div className="font-medium text-left">{g.label}</div>
                              <span className="text-xs text-muted">{wallets.length} token{wallets.length > 1 ? 's' : ''}</span>
                            </div>
                            <div className="font-semibold">{fmtCurrency(g.total)}</div>
                          </button>
                          {!isCollapsed && (
                            <div className="border-t border-border divide-y divide-border/30">
                              {wallets.map(a => {
                                const name = (a.custom_name || a.name || '').replace(/\s*Wallet$/i, '').replace(/^Portefeuille en\s*/i, '').replace(/\s*staké$/i, '').trim();
                                return (
                                  <div key={a.id} className="px-4 py-2 flex items-center justify-between gap-2 hover:bg-surface-hover/50">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 flex-shrink-0">{a.currency}</span>
                                      <span className="text-sm truncate">{name}</span>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      {(a.balance_native ?? 0) > 0 && <span className="text-sm font-medium">{fmtCurrency(a.balance_native!)}</span>}
                                      <span className="text-[10px] text-muted ml-1">{Number(a.balance || 0).toLocaleString('de-DE', { maximumFractionDigits: 6 })} {a.currency}</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    }

                    // Individual account (blockchain, manual, etc.)
                    return (
                    <div key={g.key} className="bg-surface border border-border rounded-xl overflow-hidden">
                      <button onClick={toggleCollapse} className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-surface-hover transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronDown size={16} className={`text-muted flex-shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                          <div className="font-medium text-left truncate">{g.label}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-semibold">{fmtCurrency(g.total)}</div>
                          {g.perf !== 0 && <div className={`text-xs ${g.perf >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{g.perf >= 0 ? '+' : ''}{fmtCurrency(g.perf)}</div>}
                        </div>
                      </button>
                      {!isCollapsed && g.positions.length > 0 && (
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
                                    <td className="px-4 py-2 text-right">{(p.quantity || 0).toLocaleString('de-DE', { maximumFractionDigits: 6 })}</td>
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
                                  <div className="text-right">{(p.quantity || 0).toLocaleString('de-DE', { maximumFractionDigits: 6 })}</div>
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
                    );
                  })}
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
