import { API } from '../config';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Search, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownLeft, Eye, EyeOff, SlidersHorizontal, X } from 'lucide-react';
import { useFilter } from '../FilterContext';
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
}

const PAGE_SIZE = 25;

export default function Transactions() {
  const { t } = useTranslation();
  let getTokenTx: (() => Promise<string | null>) | undefined;
  if (clerkEnabledTx) { try { const auth = useAuth(); getTokenTx = auth.getToken; } catch {} }
  const getTokenTxRef = { current: getTokenTx };
  const apiFetch = async (url: string) => {
    const headers: Record<string, string> = {};
    if (clerkEnabledTx && getTokenTxRef.current) {
      const token = await getTokenTxRef.current();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, { headers }).then(r => r.json());
  };
  const [hideAmounts, setHideAmounts] = useState(() => localStorage.getItem('kompta_hide_amounts') !== 'false');
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

      const res = await apiFetch(`${API}/transactions?${params}`);
      setTransactions(res.transactions);
      setTotal(res.total);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [page, accountFilter, search, scope]);

  useEffect(() => {
    apiFetch(appendScope(API + '/bank/accounts')).then((accs: Account[]) => setAccounts(accs)).catch(() => {});
  }, [scope, appendScope]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

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
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('nav_transactions')}</h1>
          <button
            onClick={() => setHideAmounts(h => !h)}
            className="text-muted hover:text-white transition-colors p-2"
            title={hideAmounts ? t('show_all_balances') : t('hide_all_balances')}
          >
            {hideAmounts ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
          <span className="text-sm text-muted whitespace-nowrap">{total}</span>
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

      {/* Table */}
      {loading ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-muted text-sm">...</p>
        </div>
      ) : transactions.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <ArrowLeftRight className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm">{t('no_transactions')}</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {transactions.map(tx => (
              <div key={tx.id}>
                <div
                  onClick={() => setExpandedId(expandedId === tx.id ? null : tx.id)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  {/* Icon */}
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    tx.amount >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'
                  }`}>
                    {tx.amount >= 0
                      ? <ArrowDownLeft size={14} className="text-green-400" />
                      : <ArrowUpRight size={14} className="text-red-400" />
                    }
                  </div>

                  {/* Label + date/category — 2-line compact on mobile */}
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

                  {/* Amount */}
                  <div className={`text-sm font-semibold flex-shrink-0 text-right ${
                    tx.amount >= 0 ? 'text-green-400' : 'text-white'
                  }`}>
                    <span>{tx.amount >= 0 ? '+' : ''}{formatAmount(tx.amount)}</span>
                    {tx.category && <p className="text-[10px] text-accent-400 font-normal sm:hidden truncate max-w-[80px]">{tx.category}</p>}
                  </div>
                </div>

                {/* Expanded details */}
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

      {/* Pagination */}
      {totalPages > 1 && (
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
