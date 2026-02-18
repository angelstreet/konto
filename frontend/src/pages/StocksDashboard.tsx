import { useState, useMemo } from 'react';
import { ArrowLeft, Plus, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import EyeToggle from '../components/EyeToggle';
import ScopeSelect from '../components/ScopeSelect';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { useFilter } from '../FilterContext';
import { useApi } from '../useApi';
import { API } from '../config';

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M€`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k€`;
  return `${Math.round(n)}€`;
};

const CRYPTO_PROVIDERS = ['blockchain', 'coinbase', 'binance'];

type Tab = 'comptes' | 'transactions';

interface BankAccount {
  id: number;
  name: string;
  custom_name: string | null;
  bank_name: string | null;
  type: string;
  subtype: string | null;
  provider: string | null;
  balance: number;
  currency: string;
}

interface ApiTransaction {
  id: number;
  date: string;
  amount: number;
  label: string | null;
  category: string | null;
  account_name: string | null;
  account_custom_name: string | null;
}

interface TransactionsResponse {
  transactions: ApiTransaction[];
  total: number;
}

const fmtDate = (d: string) => {
  try {
    return new Date(d).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return d;
  }
};

export default function StocksDashboard() {
  const navigate = useNavigate();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const f = (n: number) =>
    hideAmounts ? <span className="amount-masked">{fmt(n)}</span> : fmt(n);
  const [activeTab, setActiveTab] = useState<Tab>('comptes');
  const [showAll, setShowAll] = useState(false);
  const { appendScope } = useFilter();

  const { data: allAccounts } = useApi<BankAccount[]>(appendScope(`${API}/bank/accounts`));
  const { data: txData } = useApi<TransactionsResponse>(
    appendScope(`${API}/transactions?limit=50`)
  );

  const accounts = useMemo(
    () =>
      (allAccounts || []).filter(
        (a) =>
          a.type === 'investment' &&
          a.subtype !== 'crypto' &&
          !CRYPTO_PROVIDERS.includes(a.provider || '')
      ),
    [allAccounts]
  );

  const transactions = txData?.transactions || [];

  const totalValue = accounts.reduce((s, a) => s + Math.abs(a.balance || 0), 0);

  const visibleAccounts = showAll ? accounts : accounts.slice(0, 10);

  const txByDate = transactions.reduce<Record<string, ApiTransaction[]>>((acc, tx) => {
    const key = fmtDate(tx.date);
    if (!acc[key]) acc[key] = [];
    acc[key].push(tx);
    return acc;
  }, {});

  if (accounts.length === 0 && allAccounts !== null) {
    return (
      <div>
        <div className="flex items-center justify-between gap-2 mb-4 h-10">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => navigate('/more')}
              className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-semibold whitespace-nowrap">Actions &amp; Fonds</h1>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="hidden md:block"><ScopeSelect /></span>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
              <Plus size={16} /> <span className="hidden sm:inline">Ajouter un compte</span>
            </button>
          </div>
        </div>
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-muted text-sm mb-2">Aucun compte d'investissement trouvé.</p>
          <p className="text-muted text-xs mb-6">
            Connectez vos comptes PEA, CTO, PER ou autres comptes d'investissement.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => navigate('/more')}
            className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Actions &amp; Fonds</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="hidden md:block"><ScopeSelect /></span>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
            <Plus size={16} /> <span className="hidden sm:inline">Ajouter un compte</span>
          </button>
        </div>
      </div>

      {/* Summary Header */}
      <div className="grid grid-cols-2 gap-3 mb-6 p-4 bg-gradient-to-r from-gray-900/50 to-gray-800/50 rounded-xl border border-gray-700">
        <div>
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Valeur totale</p>
          <p className="text-xl font-bold text-white">
            {hideAmounts ? <span className="amount-masked">{fmtCompact(totalValue)}</span> : fmtCompact(totalValue)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted uppercase tracking-wide mb-1">Comptes</p>
          <p className="text-xl font-bold text-accent-400">{accounts.length}</p>
        </div>
      </div>

      {/* Comptes / Transactions Tabs */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="flex border-b border-border">
          {(['comptes', 'transactions'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-white border-b-2 border-accent-500 -mb-px'
                  : 'text-muted hover:text-white'
              }`}
            >
              {tab === 'comptes' ? 'Comptes' : 'Transactions'}
            </button>
          ))}
        </div>

        {activeTab === 'comptes' && (
          <div>
            <div className="hidden md:grid md:grid-cols-[1fr_160px_160px] gap-4 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-border/50">
              <span>Nom</span>
              <span className="text-right">Type</span>
              <span className="text-right">Valeur</span>
            </div>
            {visibleAccounts.map((account) => {
              const displayName = account.custom_name || account.name;
              const value = Math.abs(account.balance || 0);
              const typeLabel = account.subtype?.toUpperCase() || account.type?.toUpperCase() || '—';
              const initials = displayName.slice(0, 2).toUpperCase();
              return (
                <div
                  key={account.id}
                  className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_160px_160px] gap-4 px-4 py-3.5 items-center border-b border-border/50 last:border-0 hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-accent-500/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-accent-400">{initials}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{displayName}</p>
                      {account.bank_name && (
                        <p className="text-xs text-muted">{account.bank_name}</p>
                      )}
                    </div>
                  </div>
                  <span className="hidden md:block text-sm text-right text-muted tabular-nums">
                    {typeLabel}
                  </span>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white tabular-nums">{f(value)}</p>
                  </div>
                </div>
              );
            })}
            {accounts.length > 10 && (
              <div className="px-4 py-3 border-t border-border/50 bg-white/5">
                <button
                  onClick={() => setShowAll(!showAll)}
                  className="flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors"
                >
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${showAll ? 'rotate-180' : ''}`}
                  />
                  {showAll
                    ? 'Réduire'
                    : `Voir ${accounts.length - 10} compte(s) supplémentaire(s)`}
                </button>
              </div>
            )}
            {/* Total row */}
            {accounts.length > 1 && (
              <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_160px_160px] gap-4 px-4 py-3 items-center bg-white/5 border-t border-border/50">
                <span className="text-sm font-semibold">Total</span>
                <span className="hidden md:block" />
                <span className="text-sm font-bold text-right tabular-nums">{f(totalValue)}</span>
              </div>
            )}
          </div>
        )}

        {activeTab === 'transactions' && (
          <div>
            {transactions.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted text-sm">Aucune transaction trouvée.</p>
              </div>
            ) : (
              Object.entries(txByDate).map(([date, txs]) => (
                <div key={date}>
                  <div className="px-4 py-2 bg-black/20 border-b border-border/30">
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider">{date}</p>
                  </div>
                  {txs.map((tx) => {
                    const accountLabel =
                      tx.account_custom_name || tx.account_name || '—';
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center gap-3 px-4 py-3 border-b border-border/20 last:border-0 hover:bg-white/5 transition-colors"
                      >
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            tx.amount >= 0 ? 'bg-green-500/20' : 'bg-blue-500/20'
                          }`}
                        >
                          <ChevronDown
                            size={14}
                            className={`${
                              tx.amount >= 0 ? 'text-green-400' : 'text-blue-400 rotate-180'
                            }`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          {tx.category && (
                            <div className="mb-0.5">
                              <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-500/20 text-gray-400">
                                {tx.category}
                              </span>
                            </div>
                          )}
                          <p className="text-sm text-white truncate">{tx.label || '—'}</p>
                          <p className="text-xs text-muted truncate">{accountLabel}</p>
                        </div>
                        <span
                          className={`text-sm font-semibold tabular-nums flex-shrink-0 ${
                            tx.amount >= 0 ? 'text-green-400' : 'text-white'
                          }`}
                        >
                          {tx.amount >= 0 ? '+' : ''}
                          {f(tx.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
