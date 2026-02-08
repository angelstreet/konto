import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Search, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
const apiFetch = (url: string) => fetch(url).then(r => r.json());

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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (accountFilter) params.set('account_id', accountFilter);
      if (search) params.set('search', search);

      const res = await apiFetch(`/kompta/api/transactions?${params}`);
      setTransactions(res.transactions);
      setTotal(res.total);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [page, accountFilter, search]);

  useEffect(() => {
    apiFetch('/kompta/api/bank/accounts').then((accs: Account[]) => setAccounts(accs)).catch(() => {});
  }, []);

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

  const formatAmount = (n: number) => {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">{t('nav_transactions')}</h1>
        <span className="text-sm text-muted">{total} {t('nav_transactions').toLowerCase()}</span>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
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

                  {/* Label + account */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{tx.label || '—'}</p>
                    <p className="text-xs text-muted truncate">
                      {tx.account_custom_name || tx.account_name}
                      {tx.category && <span className="ml-2 text-accent-400">{tx.category}</span>}
                    </p>
                  </div>

                  {/* Date */}
                  <div className="text-xs text-muted flex-shrink-0 hidden sm:block">
                    {formatDate(tx.date)}
                  </div>

                  {/* Amount */}
                  <div className={`text-sm font-semibold flex-shrink-0 ${
                    tx.amount >= 0 ? 'text-green-400' : 'text-white'
                  }`}>
                    {tx.amount >= 0 ? '+' : ''}{formatAmount(tx.amount)}
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
            className="flex items-center gap-1 text-sm text-muted hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-muted">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="flex items-center gap-1 text-sm text-muted hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
