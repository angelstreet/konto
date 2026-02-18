import { API } from '../config';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Search, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownLeft, SlidersHorizontal, X, RefreshCw, AlertTriangle, TrendingUp, TrendingDown, ChevronDown, Bitcoin } from 'lucide-react';
import { useFilter } from '../FilterContext';
import { useAmountVisibility } from '../AmountVisibilityContext';
import EyeToggle from '../components/EyeToggle';
import ScopeSelect from '../components/ScopeSelect';
import { useAuth } from '@clerk/clerk-react';
const clerkEnabledTx = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface Transaction {
  id: number;
  bank_account_id: number;
  date: string;
  amount: number;
  label: string;
  category: string | null;
  account_name: string;
  account_custom_name: string | null;
  account_currency: string | null;
}

interface Account {
  id: number;
  name: string;
  custom_name: string | null;
  provider: string;
  connection_expired: number;
  type: string;
  last_sync: string | null;
}

interface Investment {
  id: number;
  bank_account_id: number;
  label: string;
  isin_code: string | null;
  quantity: number;
  unit_price: number;
  unit_value: number;
  valuation: number;
  diff: number;
  diff_percent: number;
  portfolio_share: number;
  currency: string;
}

interface CachedTransactions {
  transactions: Transaction[];
  total: number;
}

interface CachedInvestments {
  investments: Investment[];
  total_valuation: number;
  total_diff: number;
}

const PAGE_SIZE = 50;

export default function Transactions() {
  const { t } = useTranslation();
  let getTokenTx: (() => Promise<string | null>) | undefined;
  if (clerkEnabledTx) { try { const auth = useAuth(); getTokenTx = auth.getToken; } catch {} }
  const getTokenRef = useRef(getTokenTx);
  getTokenRef.current = getTokenTx;

  const apiFetchRef = useRef(async (url: string, opts?: RequestInit) => {
    const headers: Record<string, string> = { ...(opts?.headers as Record<string, string> || {}) };
    if (clerkEnabledTx && getTokenRef.current) {
      const token = await getTokenRef.current();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, { ...opts, headers });
  });
  const apiFetch = apiFetchRef.current;
  const apiFetchJson = async (url: string) => apiFetch(url).then(r => r.json());

  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const { scope, appendScope } = useFilter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedInvId, setExpandedInvId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [yearFilter, setYearFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const hasActiveFilters = !!accountFilter || !!search || !!yearFilter || !!monthFilter;
  const [syncing, setSyncing] = useState(false);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [investmentsTotal, setInvestmentsTotal] = useState({ valuation: 0, diff: 0 });
  const [fetchVersion, setFetchVersion] = useState(0);

  // Caches keyed by filter params
  const txCache = useRef<Map<string, CachedTransactions>>(new Map());
  const invCache = useRef<Map<string, CachedInvestments>>(new Map());

  const filteredAccount = accountFilter ? accounts.find(a => String(a.id) === accountFilter) : null;
  const isInvestmentView = filteredAccount?.type === 'investment' && filteredAccount?.provider !== 'blockchain';
  const powensAccounts = accounts.filter(a => a.provider === 'powens');
  const hasPowensAccounts = powensAccounts.length > 0;

  // Synchronous cache read during render — prevents flicker
  const txCacheKey = `${accountFilter}|${page}|${search}|${scope}|${yearFilter}|${monthFilter}`;
  const invCacheKey = `inv|${accountFilter}`;
  const [prevTxKey, setPrevTxKey] = useState('');
  const [prevInvKey, setPrevInvKey] = useState('');
  if (txCacheKey !== prevTxKey) {
    setPrevTxKey(txCacheKey);
    const cached = txCache.current.get(txCacheKey);
    if (cached) {
      setTransactions(cached.transactions);
      setTotal(cached.total);
      setLoading(false);
    }
  }
  if (invCacheKey !== prevInvKey) {
    setPrevInvKey(invCacheKey);
    const cached = invCache.current.get(invCacheKey);
    if (cached) {
      setInvestments(cached.investments);
      setInvestmentsTotal({ valuation: cached.total_valuation, diff: cached.total_diff });
      setLoading(false);
    }
  }

  const syncAccounts = async () => {
    // For blockchain accounts, call the blockchain sync endpoint
    if (filteredAccount?.provider === 'blockchain') {
      setSyncing(true);
      try {
        await apiFetch(`${API}/accounts/${filteredAccount.id}/sync-blockchain`, { method: 'POST' });
        txCache.current.clear();
        invCache.current.clear();
        setFetchVersion(v => v + 1);
      } finally {
        setSyncing(false);
      }
      return;
    }

    const toSync = filteredAccount ? [filteredAccount] : powensAccounts;
    if (toSync.length === 0) return;
    setSyncing(true);
    try {
      for (const acc of toSync) {
        const res = await apiFetch(`${API}/bank/accounts/${acc.id}/sync`, { method: 'POST' });
        const result = await res.json();
        if (result.reconnect_required) {
          const connectRes = await apiFetchJson(`${API}/bank/connect-url`);
          window.location.href = connectRes.url;
          return;
        }
      }
      // Invalidate caches and re-fetch
      txCache.current.clear();
      invCache.current.clear();
      setFetchVersion(v => v + 1);
    } finally {
      setSyncing(false);
    }
  };

  // Always fetch transactions (even for investment accounts) so data is ready when switching back
  useEffect(() => {
    const controller = new AbortController();

    // Only show loading if no cached data (cache is read synchronously in render above)
    if (!txCache.current.has(txCacheKey)) {
      setLoading(true);
    }

    const effectivePageSize = monthFilter ? 500 : PAGE_SIZE;
    const params = new URLSearchParams({
      limit: String(effectivePageSize),
      offset: String(page * effectivePageSize),
    });
    if (accountFilter) params.set('account_id', accountFilter);
    if (search) params.set('search', search);
    if (yearFilter) params.set('year', yearFilter);
    if (monthFilter) params.set('month', monthFilter);
    if (scope === 'personal') params.set('usage', 'personal');
    else if (scope === 'pro') params.set('usage', 'professional');
    else if (typeof scope === 'number') params.set('company_id', String(scope));

    fetch(`${API}/transactions?${params}`, { signal: controller.signal })
      .then(r => r.json())
      .then(res => {
        if (!controller.signal.aborted) {
          setTransactions(res.transactions);
          setTotal(res.total);
          if (res.years) setAvailableYears(res.years);
          txCache.current.set(txCacheKey, { transactions: res.transactions, total: res.total });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [page, accountFilter, search, yearFilter, monthFilter, scope, fetchVersion]);

  // Fetch accounts
  useEffect(() => {
    apiFetchJson(appendScope(API + '/bank/accounts'))
      .then((accs: Account[]) => setAccounts(accs))
      .catch(() => {});
  }, [scope, appendScope]);

  // Fetch investments when filtering to an investment account
  useEffect(() => {
    if (!isInvestmentView) {
      setInvestments([]);
      setInvestmentsTotal({ valuation: 0, diff: 0 });
      return;
    }

    const controller = new AbortController();

    // Only show loading if no cached data (cache is read synchronously in render above)
    if (!invCache.current.has(invCacheKey)) {
      setLoading(true);
    }

    fetch(`${API}/investments?account_id=${accountFilter}`, { signal: controller.signal })
      .then(r => r.json())
      .then((data: any) => {
        if (!controller.signal.aborted) {
          const inv = data.investments || [];
          const totVal = data.total_valuation || 0;
          const totDiff = data.total_diff || 0;
          setInvestments(inv);
          setInvestmentsTotal({ valuation: totVal, diff: totDiff });
          invCache.current.set(invCacheKey, { investments: inv, total_valuation: totVal, total_diff: totDiff });
          setLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setInvestments([]);
          setInvestmentsTotal({ valuation: 0, diff: 0 });
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [accountFilter, isInvestmentView, fetchVersion]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(0);
  };

  const fmtCur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
  const fmtPct = (p: number) => `${(p * 100).toFixed(1)}%`;

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return d; }
  };

  const cryptoCurrencies = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'POL', 'BNB', 'AVAX']);

  const formatAmount = (n: number, currency?: string | null): React.ReactNode => {
    let formatted: string;
    if (currency && cryptoCurrencies.has(currency)) {
      const decimals = currency === 'BTC' ? 8 : 6;
      formatted = `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: decimals }).format(n)} ${currency}`;
    } else {
      formatted = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
    }
    if (hideAmounts) return <span className="amount-masked">{formatted}</span>;
    return formatted;
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">{isInvestmentView ? t('positions') : t('nav_transactions')}</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
          <span className="text-sm text-muted whitespace-nowrap">{isInvestmentView ? investments.length : total}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mobile: single Filtrer ▾ button */}
          <div className="md:hidden">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
                hasActiveFilters ? 'bg-accent-500/20 text-accent-400' : 'bg-surface text-muted hover:text-white'
              }`}
            >
              <SlidersHorizontal size={16} />
              {t('filters')}
              {hasActiveFilters && (
                <span className="w-2 h-2 rounded-full bg-accent-500" />
              )}
              <span className="text-[10px]">▾</span>
            </button>
          </div>
          {/* Desktop: scope select */}
          <span className="hidden md:block"><ScopeSelect /></span>
        </div>
      </div>

      {/* Mobile filter panel */}
      {showFilters && (
        <div className="md:hidden mb-3 bg-surface rounded-xl border border-border p-3 space-y-3">
          <form onSubmit={handleSearch}>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={t('search_transactions')}
                className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500 transition-colors"
              />
            </div>
          </form>
          <select
            value={accountFilter}
            onChange={e => { setAccountFilter(e.target.value); setPage(0); }}
            className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
          >
            <option value="">{t('all_accounts_filter')}</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.custom_name || acc.name}
              </option>
            ))}
          </select>
          {availableYears.length > 0 && (
            <select
              value={yearFilter}
              onChange={e => { setYearFilter(e.target.value); setMonthFilter(''); setPage(0); }}
              className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
            >
              <option value="">{t('all_years', 'All years')}</option>
              {availableYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap gap-1">
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
              const keys = ['month_jan','month_feb','month_mar','month_apr','month_may','month_jun','month_jul','month_aug','month_sep','month_oct','month_nov','month_dec'];
              return (
                <button
                  key={m}
                  onClick={() => { setMonthFilter(monthFilter === String(m) ? '' : String(m)); setPage(0); }}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    monthFilter === String(m) ? 'bg-accent-500/25 text-accent-400' : 'bg-white/5 text-muted hover:text-white'
                  }`}
                >
                  {t(keys[m - 1])}
                </button>
              );
            })}
          </div>
          <ScopeSelect />
          {hasActiveFilters && (
            <button
              onClick={() => { setAccountFilter(''); setYearFilter(''); setMonthFilter(''); setSearch(''); setSearchInput(''); setPage(0); }}
              className="flex items-center gap-1 text-xs text-muted hover:text-white"
            >
              <X size={12} /> {t('clear_filters')}
            </button>
          )}
        </div>
      )}

      {/* Desktop filters */}
      <div className="hidden md:flex flex-row gap-3 mb-2">
        <form onSubmit={handleSearch} className="flex-1">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={t('search_transactions')}
              className="w-full bg-surface border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-accent-500 transition-colors"
            />
          </div>
        </form>
        <select
          value={accountFilter}
          onChange={e => { setAccountFilter(e.target.value); setPage(0); }}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
        >
          <option value="">{t('all_accounts_filter')}</option>
          {accounts.map(acc => (
            <option key={acc.id} value={acc.id}>
              {acc.custom_name || acc.name}
            </option>
          ))}
        </select>
        {availableYears.length > 0 && (
          <select
            value={yearFilter}
            onChange={e => { setYearFilter(e.target.value); setMonthFilter(''); setPage(0); }}
            className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-500"
          >
            <option value="">{t('all_years', 'All years')}</option>
            {availableYears.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}
      </div>

      {/* Month pills (desktop) */}
      <div className="hidden md:flex flex-wrap gap-1 mb-2">
        {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
          const keys = ['month_jan','month_feb','month_mar','month_apr','month_may','month_jun','month_jul','month_aug','month_sep','month_oct','month_nov','month_dec'];
          return (
            <button
              key={m}
              onClick={() => { setMonthFilter(monthFilter === String(m) ? '' : String(m)); setPage(0); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                monthFilter === String(m) ? 'bg-accent-500/25 text-accent-400' : 'bg-surface text-muted hover:text-white'
              }`}
            >
              {t(keys[m - 1])}
            </button>
          );
        })}
      </div>

      {/* Content: positions for investment accounts, transactions for others */}
      {loading ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-muted text-sm">...</p>
        </div>
      ) : isInvestmentView ? (
        /* === POSITIONS VIEW === */
        investments.length === 0 ? (
          <div className="bg-surface rounded-xl border border-border p-8 text-center">
            {filteredAccount?.provider === 'blockchain' ? (
              <>
                <Bitcoin className="mx-auto text-muted mb-3" size={32} />
                <p className="text-muted text-sm">{t('no_transactions')}</p>
              </>
            ) : (
              <>
                <TrendingUp className="mx-auto text-muted mb-3" size={32} />
                <p className="text-muted text-sm mb-4">{t('no_investments')}</p>
                {!filteredAccount?.last_sync && (
                  <button
                    onClick={syncAccounts}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-accent-500 text-black transition-colors"
                  >
                    <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                    {t('sync')}
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {/* Portfolio summary — only show when multiple positions */}
            {investments.length > 1 && (
              <div className="bg-surface rounded-xl border border-border p-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <p className="text-xs text-muted uppercase tracking-wider mb-1">{t('total_value')}</p>
                    <p className="text-2xl font-bold text-white">
                      {hideAmounts
                        ? <span className="amount-masked">{fmtCur(investmentsTotal.valuation)}</span>
                        : fmtCur(investmentsTotal.valuation)
                      }
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-lg font-semibold ${investmentsTotal.diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {investmentsTotal.diff >= 0 ? '+' : ''}{hideAmounts
                        ? <span className="amount-masked">{fmtCur(investmentsTotal.diff)}</span>
                        : fmtCur(investmentsTotal.diff)
                      }
                    </p>
                    <p className="text-xs text-muted">{investments.length} {t('positions')}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Positions list */}
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <div className="divide-y divide-border">
                {investments.map(inv => {
                  const isExpanded = investments.length === 1 || expandedInvId === inv.id;
                  const totalCost = inv.quantity * inv.unit_price;
                  return (
                    <div key={inv.id}>
                      <div
                        onClick={investments.length > 1 ? () => setExpandedInvId(isExpanded ? null : inv.id) : undefined}
                        className={`flex items-center gap-3 px-4 py-3 ${investments.length > 1 ? 'hover:bg-surface-hover cursor-pointer' : ''} transition-colors`}
                      >
                        <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${inv.diff >= 0 ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                          {inv.diff >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{inv.label}</p>
                          <div className="flex items-center gap-1.5 text-xs text-muted">
                            {inv.isin_code && <span className="font-mono text-[10px] opacity-70">{inv.isin_code}</span>}
                            <span className="opacity-40">·</span>
                            <span>{inv.quantity} {t('units')}</span>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-white">
                            {hideAmounts
                              ? <span className="amount-masked">{fmtCur(inv.valuation)}</span>
                              : fmtCur(inv.valuation)
                            }
                          </p>
                          <p className={`text-xs font-medium ${inv.diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {inv.diff >= 0 ? '+' : ''}{fmtCur(inv.diff)} <span className="opacity-70">({fmtPct(inv.diff_percent)})</span>
                          </p>
                        </div>
                        {investments.length > 1 && (
                          <ChevronDown size={14} className={`text-muted flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        )}
                      </div>
                      {/* Detail panel — always visible for single position, expandable for multiple */}
                      {isExpanded && (
                        <div className={`px-4 pb-4 pt-1 pl-[3.75rem] ${investments.length > 1 ? 'border-t border-border/50' : ''}`}>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-xs">
                            <div>
                              <span className="text-muted">{t('buy_price')}</span>
                              <p className="text-white font-medium">{fmtCur(inv.unit_price)}</p>
                            </div>
                            <div>
                              <span className="text-muted">{t('current_value')}</span>
                              <p className="text-white font-medium">{fmtCur(inv.unit_value)}</p>
                            </div>
                            <div>
                              <span className="text-muted">{t('units')}</span>
                              <p className="text-white font-medium">{inv.quantity}</p>
                            </div>
                            <div>
                              <span className="text-muted">{t('total_cost')}</span>
                              <p className="text-white font-medium">
                                {hideAmounts ? <span className="amount-masked">{fmtCur(totalCost)}</span> : fmtCur(totalCost)}
                              </p>
                            </div>
                            <div>
                              <span className="text-muted">{t('total_value')}</span>
                              <p className="text-white font-medium">
                                {hideAmounts ? <span className="amount-masked">{fmtCur(inv.valuation)}</span> : fmtCur(inv.valuation)}
                              </p>
                            </div>
                            <div>
                              <span className="text-muted">{t('pnl')}</span>
                              <p className={`font-semibold ${inv.diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {inv.diff >= 0 ? '+' : ''}{hideAmounts ? <span className="amount-masked">{fmtCur(inv.diff)}</span> : fmtCur(inv.diff)}
                                {' '}({fmtPct(inv.diff_percent)})
                              </p>
                            </div>
                            {investments.length > 1 && inv.portfolio_share > 0 && (
                              <div className="col-span-2 sm:col-span-3">
                                <span className="text-muted">{t('portfolio_weight')}</span>
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                                    <div className="h-full bg-accent-500 rounded-full" style={{ width: `${Math.min(inv.portfolio_share * 100, 100)}%` }} />
                                  </div>
                                  <span className="text-white font-medium text-xs">{(inv.portfolio_share * 100).toFixed(1)}%</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )
      ) : transactions.length === 0 ? (
        /* === EMPTY TRANSACTIONS === */
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          {filteredAccount?.connection_expired ? (
            <>
              <AlertTriangle className="mx-auto text-red-400 mb-3" size={32} />
              <p className="text-red-400 text-sm font-medium mb-1">{t('connection_expired_title')}</p>
              <p className="text-muted text-xs mb-4">{t('connection_expired_desc')}</p>
              <button
                onClick={syncAccounts}
                disabled={syncing}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {t('reconnect')}
              </button>
            </>
          ) : filteredAccount?.provider === 'blockchain' ? (
            <>
              <Bitcoin className="mx-auto text-muted mb-3" size={32} />
              <p className="text-muted text-sm mb-4">{t('no_transactions')}</p>
              <button
                onClick={syncAccounts}
                disabled={syncing}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-accent-500 text-black transition-colors"
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {t('sync')}
              </button>
            </>
          ) : (filteredAccount?.provider === 'powens' && !filteredAccount.last_sync) || (!filteredAccount && hasPowensAccounts) ? (
            <>
              <ArrowLeftRight className="mx-auto text-muted mb-3" size={32} />
              <p className="text-muted text-sm mb-4">{t('no_transactions')}</p>
              <button
                onClick={syncAccounts}
                disabled={syncing}
                className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-accent-500 text-black transition-colors"
              >
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                {t('sync')}
              </button>
            </>
          ) : (
            <>
              <ArrowLeftRight className="mx-auto text-muted mb-3" size={32} />
              <p className="text-muted text-sm">{t('no_transactions')}</p>
            </>
          )}
        </div>
      ) : (
        /* === TRANSACTIONS LIST === */
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {transactions.map(tx => (
              <div key={tx.id}>
                <div
                  onClick={() => setExpandedId(expandedId === tx.id ? null : tx.id)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    tx.amount >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'
                  }`}>
                    {tx.amount >= 0
                      ? <ArrowDownLeft size={14} className="text-green-400" />
                      : <ArrowUpRight size={14} className="text-red-400" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white truncate">{tx.label || '—'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <span className="sm:hidden">{formatDate(tx.date)}</span>
                      <span className="hidden sm:inline">{formatDate(tx.date)}</span>
                      <span className="opacity-40">·</span>
                      <span className="truncate">{tx.account_custom_name || tx.account_name}</span>
                      {tx.category && <span className="text-accent-400 truncate hidden sm:inline">{tx.category}</span>}
                    </div>
                  </div>
                  <div className={`text-sm font-semibold flex-shrink-0 text-right ${
                    tx.amount >= 0 ? 'text-green-400' : 'text-white'
                  }`}>
                    <span>{tx.amount >= 0 ? '+' : ''}{formatAmount(tx.amount, tx.account_currency)}</span>
                    {tx.category && <p className="text-[10px] text-accent-400 font-normal sm:hidden truncate max-w-[80px]">{tx.category}</p>}
                  </div>
                </div>
                {expandedId === tx.id && (
                  <div className="px-4 pb-3 pl-[3.75rem] grid grid-cols-2 gap-x-6 gap-y-2 text-xs border-t border-border/50 pt-3">
                    <div>
                      <span className="text-muted">{t('date')}</span>
                      <p className="text-white">{formatDate(tx.date)}</p>
                    </div>
                    <div>
                      <span className="text-muted">{t('amount')}</span>
                      <p className={tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {tx.amount >= 0 ? '+' : ''}{formatAmount(tx.amount, tx.account_currency)}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted">{t('account')}</span>
                      <p className="text-white">{tx.account_custom_name || tx.account_name}</p>
                    </div>
                    <div>
                      <span className="text-muted">{t('category')}</span>
                      <p className="text-accent-400">{tx.category || '—'}</p>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted">{t('label')}</span>
                      <p className="text-white break-all">{tx.label || '—'}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination (transactions only) */}
      {!isInvestmentView && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 text-sm text-muted hover:text-white disabled:opacity-30 transition-colors p-3 min-w-[44px] min-h-[44px] justify-center"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-muted">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 text-sm text-muted hover:text-white disabled:opacity-30 transition-colors p-3 min-w-[44px] min-h-[44px] justify-center"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
