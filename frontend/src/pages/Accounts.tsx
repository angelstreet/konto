import { useTranslation } from 'react-i18next';
import { Landmark, Plus, RefreshCw, ExternalLink, Pencil, Trash2, Eye, EyeOff, Check, X } from 'lucide-react';
import { useState } from 'react';
import { useApi, invalidateApi } from '../useApi';

const API = '/kompta/api';

interface BankAccount {
  id: number;
  name: string;
  custom_name: string | null;
  bank_name: string | null;
  account_number: string | null;
  iban: string | null;
  balance: number;
  hidden: number;
  provider: string;
  last_sync: string | null;
  type: string;
  usage: string;
}

function getRelativeTime(isoDate: string | null, t: (key: string, opts?: Record<string, unknown>) => string): { text: string; isStale: boolean } {
  if (!isoDate) return { text: t('sync_never'), isStale: true };
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const isStale = diffMs > 24 * 3600000;
  if (diffMin < 1) return { text: t('sync_just_now'), isStale };
  if (diffMin < 60) return { text: t('sync_minutes_ago', { count: diffMin }), isStale };
  if (diffHours < 24) return { text: t('sync_hours_ago', { count: diffHours }), isStale };
  return { text: t('sync_days_ago', { count: diffDays }), isStale };
}

function typeBadgeColor(type: string): string {
  if (type === 'savings') return 'bg-blue-500/20 text-blue-400';
  if (type === 'loan') return 'bg-orange-500/20 text-orange-400';
  return 'bg-white/5 text-muted';
}

interface BankConnection {
  id: number;
  status: string;
  provider_name: string | null;
  created_at: string;
}

export default function Accounts() {
  const { t } = useTranslation();
  const { data: accounts, loading: loadingAccounts, refetch: refetchAccounts } = useApi<BankAccount[]>(`${API}/bank/accounts`);
  const { data: connections, loading: loadingConnections, refetch: refetchConnections } = useApi<BankConnection[]>(`${API}/bank/connections`);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [allBalancesHidden, setAllBalancesHidden] = useState(false);

  const loading = loadingAccounts || loadingConnections;

  const refetchAll = () => {
    invalidateApi(`${API}/dashboard`);
    refetchAccounts();
    refetchConnections();
  };

  const connectBank = async () => {
    const res = await fetch(`${API}/bank/connect-url`);
    const { url } = await res.json();
    window.location.href = url;
  };

  const syncAccount = async (id: number) => {
    await fetch(`${API}/bank/accounts/${id}/sync`, { method: 'POST' });
    refetchAll();
  };

  const toggleHidden = async (acc: BankAccount) => {
    await fetch(`${API}/bank/accounts/${acc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: acc.hidden ? 0 : 1 }),
    });
    refetchAll();
  };

  const startEdit = (acc: BankAccount) => {
    setEditingId(acc.id);
    setEditName(acc.custom_name || acc.name);
  };

  const saveEdit = async (id: number) => {
    await fetch(`${API}/bank/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_name: editName }),
    });
    setEditingId(null);
    refetchAll();
  };

  const deleteAccount = async (id: number) => {
    if (!confirm(t('confirm_delete_account'))) return;
    await fetch(`${API}/bank/accounts/${id}`, { method: 'DELETE' });
    refetchAll();
  };

  const formatBalance = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

  const maskNumber = (num: string) => {
    if (num.length <= 4) return num;
    return '••••' + num.slice(-4);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('accounts')}</h1>
          {(accounts || []).length > 0 && (
            <button
              onClick={() => setAllBalancesHidden(h => !h)}
              className="text-muted hover:text-white transition-colors p-1"
              title={allBalancesHidden ? t('show_all_balances') : t('hide_all_balances')}
            >
              {allBalancesHidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>
        <button
          onClick={connectBank}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-accent-500 text-black"
        >
          <Plus size={16} />
          {t('connect_bank')}
        </button>
      </div>

      {loading ? (
        <div className="text-center text-muted py-8">Loading...</div>
      ) : (accounts || []).length === 0 && (connections || []).length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Landmark className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm mb-4">{t('no_accounts')}</p>
          <button
            onClick={connectBank}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors bg-accent-500 text-black"
          >
            <ExternalLink size={14} />
            {t('connect_bank')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {(accounts || []).map(acc => (
            <div key={acc.id} className={`bg-surface rounded-xl border border-border p-4 ${acc.hidden ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  {editingId === acc.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        className="bg-black/30 border border-border rounded px-2 py-1 text-sm w-48"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && saveEdit(acc.id)}
                      />
                      <button onClick={() => saveEdit(acc.id)} className="text-green-400 hover:text-green-300">
                        <Check size={16} />
                      </button>
                      <button onClick={() => setEditingId(null)} className="text-red-400 hover:text-red-300">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <p className="font-medium">{acc.custom_name || acc.name}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {acc.bank_name && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-muted">{acc.bank_name}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full ${typeBadgeColor(acc.type)}`}>
                      {t(`account_type_${acc.type || 'checking'}`)}
                    </span>
                    {acc.usage === 'professional' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                        {t('account_usage_professional')}
                      </span>
                    )}
                    {acc.account_number && (
                      <span className="text-xs text-muted font-mono">
                        {acc.hidden || allBalancesHidden ? '••••••••' : maskNumber(acc.account_number)}
                      </span>
                    )}
                    {acc.iban && !acc.account_number && (
                      <span className="text-xs text-muted font-mono">
                        {acc.hidden || allBalancesHidden ? '••••••••' : maskNumber(acc.iban)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {(() => {
                      const { text, isStale } = getRelativeTime(acc.last_sync, t);
                      return (
                        <>
                          <span className={`inline-block w-2 h-2 rounded-full ${isStale ? 'bg-red-500' : 'bg-green-500'}`} />
                          <span className="text-xs text-muted">{text}</span>
                        </>
                      );
                    })()}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <span className="text-lg font-semibold mr-2 text-accent-400">
                    {acc.hidden || allBalancesHidden ? '••••' : formatBalance(acc.balance)}
                  </span>
                  <button onClick={() => startEdit(acc)} className="text-muted hover:text-white transition-colors p-1" title={t('edit')}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => toggleHidden(acc)} className="text-muted hover:text-white transition-colors p-1" title={acc.hidden ? t('show') : t('hide')}>
                    {acc.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    onClick={() => syncAccount(acc.id)}
                    className={`transition-colors p-1 ${!acc.last_sync || Date.now() - new Date(acc.last_sync).getTime() > 24 * 3600000 ? 'text-orange-400 hover:text-orange-300' : 'text-muted hover:text-white'}`}
                    title={t('sync')}
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button onClick={() => deleteAccount(acc.id)} className="text-muted hover:text-red-400 transition-colors p-1" title={t('delete')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
