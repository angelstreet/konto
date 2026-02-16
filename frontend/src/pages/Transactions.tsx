import { API } from '../config';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Search, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownLeft, SlidersHorizontal, X, RefreshCw, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
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
}

interface Account {
  id: number;
  name: string;
  custom_name: string | null;
  provider: string;
  connection_expired: number;
  type: string;
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

const PAGE_SIZE = 25;

export default function Transactions() {
  const { t } = useTranslation();
  let getTokenTx: (() => Promise<string | null>) | undefined;
  if (clerkEnabledTx) { try { const auth = useAuth(); getTokenTx = auth.getToken; } catch {} }
  const getTokenTxRef = { current: getTokenTx };
  const apiFetch = async (url: string, opts?: RequestInit) => {
    const headers: Record<string, string> = { ...(opts?.headers as Record<string, string> || {}) };
    if (clerkEnabledTx && getTokenTxRef.current) {
      const token = await getTokenTxRef.current();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, { ...opts, headers });
  };
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
  const [showFilters, setShowFilters] = useState(false);
  const hasActiveFilters = !!accountFilter || !!search;
  const [syncing, setSyncing] = useState(false);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [investmentsTotal, setInvestmentsTotal] = useState({ valuation: 0, diff: 0 });

  const filteredAccount = accountFilter ? accounts.find(a => String(a.id) === accountFilter) : null;
  const isInvestmentView = filteredAccount?.type === 'investment';
  const powensAccounts = accounts.filter(a => a.provider === 'powens');
  const hasPowensAccounts = powensAccounts.length > 0;

  const syncAccounts = async () => {
    const toSync = filteredAccount ? [filteredAccount] : powensAccounts;
    if (toSync.length === 0) return;
    setSyncing(true);
    try {
      for (const acc of toSync) {
        const res = await apiFetch(`${API}/bank/accounts/${acc.id}/sync`, { method: 'POST' });
        const result = await res.json();
        if (!res.ok || result.reconnect_required) {
          const connectRes = await apiFetchJson(`${API}/bank/connect-url`);
          window.location.href = connectRes.url;
          return;
        }
      }
      fetchTransactions();
    } finally {
      setSyncing(false);
    }
  };

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (accountFilter) params.set('account_id', accountFilter);
      if (search) params.set('search', search);
      if (scope === 'personal') params.set('usage', 'personal');
      else if (scope === 'pro') params.set('usage', 'professional');
      else if (typeof scope === 'number') params.set('company_id', String(scope));

      const res = await apiFetchJson(`${API}/transactions?${params}`);
      setTransactions(res.transactions);
      setTotal(res.total);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [page, accountFilter, search, scope]);

  useEffect(() => {
    apiFetchJson(appendScope(API + '/bank/accounts')).then((accs: Account[]) => setAccounts(accs)).catch(() => {});
  }, [scope, appendScope]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  // Fetch investments when filtering to an investment account
  useEffect(() => {
    if (!isInvestmentView) { setInvestments([]); setInvestmentsTotal({ valuation: 0, diff: 0 }); return; }
    apiFetchJson(`${API}/investments?account_id=${accountFilter}`)
      .then((data: any) => {
        setInvestments(data.investments || []);
        setInvestmentsTotal({ valuation: data.total_valuation || 0, diff: data.total_diff || 0 });
      })
      .catch(() => { setInvestments([]); setInvestmentsTotal({ valuation: 0, diff: 0 }); });
  }, [accountFilter, isInvestmentView]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(0);
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch { return d; }
  };

  const formatAmount = (n: number): React.ReactNode => {
    const formatted = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
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
          <ScopeSelect />
          {hasActiveFilters && (
            <button
              onClick={() => { setAccountFilter(''); setSearch(''); setSearchInput(''); setPage(0); }}
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
            <TrendingUp className="mx-auto text-muted mb-3" size={32} />
            <p className="text-muted text-sm mb-4">{t('no_investments')}</p>
            <button
              onClick={syncAccounts}
              disabled={syncing}
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg bg-accent-500 text-black transition-colors"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {t('sync')}
            </button>
          </div>
        ) : (
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            {/* Summary */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm text-muted">{investments.length} {t('positions')}</span>
              <div className="text-right">
                <span className="text-sm font-semibold text-accent-400">
                  {hideAmounts
                    ? <span className="amount-masked">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(investmentsTotal.valuation)}</span>
                    : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(investmentsTotal.valuation)
                  }
                </span>
                <span className={`ml-2 text-xs ${investmentsTotal.diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {investmentsTotal.diff >= 0 ? '+' : ''}{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(investmentsTotal.diff)}
                </span>
              </div>
            </div>
            <div className="divide-y divide-border">
              {investments.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${inv.diff >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                    {inv.diff >= 0 ? <TrendingUp size={14} className="text-green-400" /> : <TrendingDown size={14} className="text-red-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{inv.label}</p>
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      {inv.isin_code && <span className="font-mono">{inv.isin_code}</span>}
                      <span className="opacity-40">·</span>
                      <span>{inv.quantity} {t('units')}</span>
                      <span className="opacity-40">·</span>
                      <span>{t('buy_price')} {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(inv.unit_price)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-sm font-semibold ${inv.diff >= 0 ? 'text-green-400' : 'text-white'}`}>
                      {hideAmounts
                        ? <span className="amount-masked">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(inv.valuation)}</span>
                        : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(inv.valuation)
                      }
                    </p>
                    <p className={`text-[10px] ${inv.diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {inv.diff >= 0 ? '+' : ''}{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(inv.diff)}
                      {' '}({(inv.diff_percent * 100).toFixed(1)}%)
                    </p>
                  </div>
                </div>
              ))}
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
          ) : (filteredAccount?.provider === 'powens' || (!filteredAccount && hasPowensAccounts)) ? (
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
                    <span>{tx.amount >= 0 ? '+' : ''}{formatAmount(tx.amount)}</span>
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
                        {tx.amount >= 0 ? '+' : ''}{formatAmount(tx.amount)}
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
