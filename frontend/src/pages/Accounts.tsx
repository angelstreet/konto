import { API } from '../config';
import { useTranslation } from 'react-i18next';
import { Landmark, Plus, RefreshCw, Pencil, Trash2, Eye, EyeOff, Check, X, Wallet, Bitcoin, Building2, CircleDollarSign } from 'lucide-react';
import { useState } from 'react';
import { useApi, invalidateAllApi } from '../useApi';
import { useFilter } from '../FilterContext';
import ScopeSelect from '../components/ScopeSelect';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '@clerk/clerk-react';

const clerkEnabledAcc = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

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
  currency: string | null;
  blockchain_address: string | null;
  blockchain_network: string | null;
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
  if (type === 'investment') return 'bg-purple-500/20 text-purple-400';
  return 'bg-white/5 text-muted';
}

function providerBadge(provider: string): { color: string; label: string } {
  if (provider === 'blockchain') return { color: 'bg-amber-500/20 text-amber-400', label: '⛓️' };
  if (provider === 'manual') return { color: 'bg-gray-500/20 text-gray-400', label: '✏️' };
  if (provider === 'coinbase') return { color: 'bg-blue-600/20 text-blue-400', label: '🪙' };
  return { color: 'bg-green-500/20 text-green-400', label: '🏦' };
}

interface BankConnection {
  id: number;
  status: string;
  provider_name: string | null;
  created_at: string;
}

type AddMode = null | 'choose' | 'manual' | 'blockchain';

export default function Accounts() {
  const { t } = useTranslation();
  let getTokenAcc: (() => Promise<string | null>) | undefined;
  if (clerkEnabledAcc) { try { const auth = useAuth(); getTokenAcc = auth.getToken; } catch {} }
  const authFetch = async (url: string, opts?: RequestInit) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts?.headers as Record<string,string> || {}) };
    if (clerkEnabledAcc && getTokenAcc) {
      const token = await getTokenAcc();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, { ...opts, headers });
  };
  const { appendScope } = useFilter();
  const { data: accounts, loading: loadingAccounts, refetch: refetchAccounts, setData: setAccounts } = useApi<BankAccount[]>(appendScope(`${API}/bank/accounts`));
  const { data: connections, loading: loadingConnections, refetch: refetchConnections } = useApi<BankConnection[]>(`${API}/bank/connections`);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [allBalancesHidden, setAllBalancesHidden] = useState(() => localStorage.getItem('kompta_hide_amounts') !== 'false');
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [filterBank, setFilterBank] = useState('');
  const [filterType, setFilterType] = useState('');

  // Add account state
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [manualForm, setManualForm] = useState({ name: '', provider_name: '', balance: '', type: 'checking', currency: 'EUR' });
  const [blockchainForm, setBlockchainForm] = useState({ address: '', network: 'bitcoin', name: '' });
  const [addLoading, setAddLoading] = useState(false);

  // Balance update state
  const [updatingBalanceId, setUpdatingBalanceId] = useState<number | null>(null);
  const [newBalance, setNewBalance] = useState('');

  const loading = loadingAccounts || loadingConnections;

  const updateAccount = (id: number, patch: Partial<BankAccount>) => {
    if (!accounts) return;
    setAccounts(accounts.map(a => a.id === id ? { ...a, ...patch } : a));
  };

  const refetchAll = () => {
    invalidateAllApi();
    refetchAccounts();
    refetchConnections();
  };

  const connectBank = async () => {
    const res = await authFetch(`${API}/bank/connect-url`);
    const { url } = await res.json();
    window.location.href = url;
  };

  const connectCoinbase = async () => {
    const res = await authFetch(`${API}/coinbase/connect-url`);
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    window.location.href = data.url;
  };

  const syncAccount = async (id: number) => {
    const acc = (accounts || []).find(a => a.id === id);
    if (acc?.provider === 'blockchain') {
      await authFetch(`${API}/accounts/${id}/sync-blockchain`, { method: 'POST' });
    } else if (acc?.provider === 'coinbase') {
      await authFetch(`${API}/coinbase/sync`, { method: 'POST' });
    } else {
      await authFetch(`${API}/bank/accounts/${id}/sync`, { method: 'POST' });
    }
    refetchAll();
  };

  const toggleHidden = async (acc: BankAccount) => {
    const newHidden = acc.hidden ? 0 : 1;
    updateAccount(acc.id, { hidden: newHidden });
    await authFetch(`${API}/bank/accounts/${acc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hidden: newHidden }),
    });
    refetchAll();
  };

  const startEdit = (acc: BankAccount) => {
    setEditingId(acc.id);
    setEditName(acc.custom_name || acc.name);
  };

  const saveEdit = async (id: number) => {
    updateAccount(id, { custom_name: editName });
    setEditingId(null);
    await authFetch(`${API}/bank/accounts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_name: editName }),
    });
    refetchAll();
  };

  const deleteAccount = (id: number) => {
    setConfirmAction({
      message: t('confirm_delete_account'),
      onConfirm: async () => {
        setConfirmAction(null);
        if (accounts) setAccounts(accounts.filter(a => a.id !== id));
        await authFetch(`${API}/bank/accounts/${id}`, { method: 'DELETE' });
        refetchAll();
      },
    });
  };

  const submitManual = async () => {
    if (!manualForm.name.trim()) return;
    setAddLoading(true);
    await authFetch(`${API}/accounts/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: manualForm.name,
        provider_name: manualForm.provider_name || null,
        balance: parseFloat(manualForm.balance) || 0,
        type: manualForm.type,
        currency: manualForm.currency,
      }),
    });
    setAddLoading(false);
    setAddMode(null);
    setManualForm({ name: '', provider_name: '', balance: '', type: 'checking', currency: 'EUR' });
    refetchAll();
  };

  const submitBlockchain = async () => {
    if (!blockchainForm.address.trim()) return;
    setAddLoading(true);
    await authFetch(`${API}/accounts/blockchain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: blockchainForm.address,
        network: blockchainForm.network,
        name: blockchainForm.name || undefined,
      }),
    });
    setAddLoading(false);
    setAddMode(null);
    setBlockchainForm({ address: '', network: 'bitcoin', name: '' });
    refetchAll();
  };

  const submitBalanceUpdate = async (id: number) => {
    await authFetch(`${API}/accounts/${id}/update-balance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: parseFloat(newBalance) || 0 }),
    });
    setUpdatingBalanceId(null);
    setNewBalance('');
    refetchAll();
  };

  const formatBalance = (n: number, currency?: string | null) => {
    if (currency && currency !== 'EUR') {
      return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 8 })} ${currency}`;
    }
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
  };

  const maskNumber = (num: string) => {
    if (num.length <= 4) return num;
    return '••••' + num.slice(-4);
  };

  const ACCOUNT_TYPES = ['checking', 'savings', 'loan', 'investment'] as const;
  const ACCOUNT_USAGES = ['personal', 'professional'] as const;

  const cycleType = async (acc: BankAccount) => {
    const idx = ACCOUNT_TYPES.indexOf(acc.type as typeof ACCOUNT_TYPES[number]);
    const next = ACCOUNT_TYPES[(idx + 1) % ACCOUNT_TYPES.length];
    updateAccount(acc.id, { type: next });
    await authFetch(`${API}/bank/accounts/${acc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: next }),
    });
    refetchAll();
  };

  const cycleUsage = async (acc: BankAccount) => {
    const idx = ACCOUNT_USAGES.indexOf(acc.usage as typeof ACCOUNT_USAGES[number]);
    const next = ACCOUNT_USAGES[(idx + 1) % ACCOUNT_USAGES.length];
    updateAccount(acc.id, { usage: next });
    await authFetch(`${API}/bank/accounts/${acc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usage: next }),
    });
    refetchAll();
  };

  const allAccounts = accounts || [];
  const uniqueBanks = [...new Set(allAccounts.map(a => a.bank_name).filter(Boolean))] as string[];
  const uniqueTypes = [...new Set(allAccounts.map(a => a.type).filter(Boolean))];
  const filteredAccounts = allAccounts.filter(acc => {
    if (filterBank && acc.bank_name !== filterBank) return false;
    if (filterType && acc.type !== filterType) return false;
    return true;
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t('accounts')}</h1>
          {allAccounts.length > 0 && (
            <button
              onClick={() => setAllBalancesHidden(h => !h)}
              className="text-muted hover:text-white transition-colors p-1"
              title={allBalancesHidden ? t('show_all_balances') : t('hide_all_balances')}
            >
              {allBalancesHidden ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
          {!loading && filteredAccounts.length > 0 && (
            <span className="text-sm font-semibold text-accent-400">
              {allBalancesHidden ? '••••' : formatBalance(filteredAccounts.filter(a => !a.hidden && (!a.currency || a.currency === 'EUR')).reduce((sum, a) => sum + (a.balance || 0), 0))}
              <span className="text-muted font-normal text-xs ml-1">· {filteredAccounts.filter(a => !a.hidden).length}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ScopeSelect />
          <button
            onClick={() => setAddMode('choose')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-accent-500 text-black"
          >
            <Plus size={16} />
            {t('add_account')}
          </button>
        </div>
      </div>

      {/* === ADD ACCOUNT MODAL === */}
      {addMode && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setAddMode(null)}>
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>

            {/* Choose mode */}
            {addMode === 'choose' && (
              <>
                <h2 className="text-lg font-semibold mb-4">{t('add_account')}</h2>
                <div className="space-y-3">
                  <button onClick={connectBank} className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left">
                    <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center"><Building2 size={20} className="text-green-400" /></div>
                    <div>
                      <p className="font-medium">{t('add_bank_powens')}</p>
                      <p className="text-xs text-muted">{t('add_bank_powens_desc')}</p>
                    </div>
                  </button>
                  <button onClick={() => setAddMode('manual')} className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left">
                    <div className="w-10 h-10 rounded-full bg-gray-500/20 flex items-center justify-center"><Wallet size={20} className="text-gray-400" /></div>
                    <div>
                      <p className="font-medium">{t('add_manual')}</p>
                      <p className="text-xs text-muted">{t('add_manual_desc')}</p>
                    </div>
                  </button>
                  <button onClick={() => setAddMode('blockchain')} className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left">
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center"><Bitcoin size={20} className="text-amber-400" /></div>
                    <div>
                      <p className="font-medium">{t('add_blockchain')}</p>
                      <p className="text-xs text-muted">{t('add_blockchain_desc')}</p>
                    </div>
                  </button>
                  <button onClick={connectCoinbase} className="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left">
                    <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center"><CircleDollarSign size={20} className="text-blue-400" /></div>
                    <div>
                      <p className="font-medium">{t('add_coinbase')}</p>
                      <p className="text-xs text-muted">OAuth2 — {t('add_blockchain_desc')}</p>
                    </div>
                  </button>
                </div>
                <button onClick={() => setAddMode(null)} className="mt-4 w-full text-center text-sm text-muted hover:text-white">{t('cancel')}</button>
              </>
            )}

            {/* Manual account form */}
            {addMode === 'manual' && (
              <>
                <h2 className="text-lg font-semibold mb-4">{t('add_manual')}</h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted mb-1 block">{t('account_name')} *</label>
                    <input
                      value={manualForm.name}
                      onChange={e => setManualForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
                      placeholder="ex: Revolut, Yuh, eToro..."
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">{t('provider_name')}</label>
                    <input
                      value={manualForm.provider_name}
                      onChange={e => setManualForm(f => ({ ...f, provider_name: e.target.value }))}
                      className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
                      placeholder="ex: Revolut, Yuh..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted mb-1 block">{t('initial_balance')}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={manualForm.balance}
                        onChange={e => setManualForm(f => ({ ...f, balance: e.target.value }))}
                        className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted mb-1 block">{t('add_account_type')}</label>
                      <select
                        value={manualForm.type}
                        onChange={e => setManualForm(f => ({ ...f, type: e.target.value }))}
                        className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="checking">{t('account_type_checking')}</option>
                        <option value="savings">{t('account_type_savings')}</option>
                        <option value="investment">{t('account_type_investment')}</option>
                        <option value="loan">{t('account_type_loan')}</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setAddMode('choose')} className="flex-1 py-2 rounded-lg text-sm border border-border text-muted hover:text-white">{t('cancel')}</button>
                  <button
                    onClick={submitManual}
                    disabled={!manualForm.name.trim() || addLoading}
                    className="flex-1 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black disabled:opacity-50"
                  >
                    {addLoading ? '...' : t('create')}
                  </button>
                </div>
              </>
            )}

            {/* Blockchain wallet form */}
            {addMode === 'blockchain' && (
              <>
                <h2 className="text-lg font-semibold mb-4">{t('add_blockchain')}</h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted mb-1 block">{t('select_network')}</label>
                    <select
                      value={blockchainForm.network}
                      onChange={e => setBlockchainForm(f => ({ ...f, network: e.target.value }))}
                      className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="bitcoin">{t('network_bitcoin')}</option>
                      <option value="ethereum">{t('network_ethereum')}</option>
                      <option value="solana">{t('network_solana')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">{t('wallet_address')} *</label>
                    <input
                      value={blockchainForm.address}
                      onChange={e => setBlockchainForm(f => ({ ...f, address: e.target.value }))}
                      className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm font-mono text-xs"
                      placeholder={blockchainForm.network === 'bitcoin' ? 'bc1q...' : blockchainForm.network === 'ethereum' ? '0x...' : '...'}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted mb-1 block">{t('wallet_name')}</label>
                    <input
                      value={blockchainForm.name}
                      onChange={e => setBlockchainForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
                      placeholder="ex: Mon Ledger, MetaMask..."
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setAddMode('choose')} className="flex-1 py-2 rounded-lg text-sm border border-border text-muted hover:text-white">{t('cancel')}</button>
                  <button
                    onClick={submitBlockchain}
                    disabled={!blockchainForm.address.trim() || addLoading}
                    className="flex-1 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black disabled:opacity-50"
                  >
                    {addLoading ? '...' : t('create')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* === BALANCE UPDATE MODAL === */}
      {updatingBalanceId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setUpdatingBalanceId(null)}>
          <div className="bg-surface border border-border rounded-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{t('update_balance')}</h2>
            <div>
              <label className="text-xs text-muted mb-1 block">{t('new_balance')}</label>
              <input
                type="number"
                step="0.01"
                value={newBalance}
                onChange={e => setNewBalance(e.target.value)}
                className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && submitBalanceUpdate(updatingBalanceId)}
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setUpdatingBalanceId(null)} className="flex-1 py-2 rounded-lg text-sm border border-border text-muted hover:text-white">{t('cancel')}</button>
              <button onClick={() => submitBalanceUpdate(updatingBalanceId)} className="flex-1 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">{t('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Filters — dropdowns on mobile, pills on desktop */}
      {allAccounts.length > 0 && (uniqueBanks.length > 1 || uniqueTypes.length > 1) && (
        <>
          {/* Mobile: dropdowns */}
          <div className="flex gap-2 mb-4 sm:hidden">
            {uniqueBanks.length > 1 && (
              <select
                value={filterBank}
                onChange={e => setFilterBank(e.target.value)}
                className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="">{t('all')} — {t('filter_bank')}</option>
                {uniqueBanks.map(bank => (
                  <option key={bank} value={bank}>{bank}</option>
                ))}
              </select>
            )}
            {uniqueTypes.length > 1 && (
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white"
              >
                <option value="">{t('all')} — {t('filter_type')}</option>
                {uniqueTypes.map(type => (
                  <option key={type} value={type}>{t(`account_type_${type}`)}</option>
                ))}
              </select>
            )}
          </div>

          {/* Desktop: pills */}
          <div className="hidden sm:flex flex-wrap gap-2 mb-4">
            {uniqueBanks.length > 1 && (
              <>
                <button
                  onClick={() => setFilterBank('')}
                  className={`text-xs px-3 py-1 rounded-full transition-colors ${!filterBank ? 'bg-accent-500/20 text-accent-400' : 'bg-white/5 text-muted hover:text-white'}`}
                >
                  {t('all')}
                </button>
                {uniqueBanks.map(bank => (
                  <button
                    key={bank}
                    onClick={() => setFilterBank(filterBank === bank ? '' : bank)}
                    className={`text-xs px-3 py-1 rounded-full transition-colors ${filterBank === bank ? 'bg-accent-500/20 text-accent-400' : 'bg-white/5 text-muted hover:text-white'}`}
                  >
                    {bank}
                  </button>
                ))}
                {uniqueTypes.length > 1 && <span className="w-px h-5 bg-border self-center" />}
              </>
            )}
            {uniqueTypes.length > 1 && uniqueTypes.map(type => (
              <button
                key={type}
                onClick={() => setFilterType(filterType === type ? '' : type)}
                className={`text-xs px-3 py-1 rounded-full transition-colors ${filterType === type ? typeBadgeColor(type) : 'bg-white/5 text-muted hover:text-white'}`}
              >
                {t(`account_type_${type}`)}
              </button>
            ))}
          </div>
        </>
      )}

      {loading ? (
        <div className="text-center text-muted py-8">Loading...</div>
      ) : allAccounts.length === 0 && (connections || []).length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Landmark className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm mb-4">{t('no_accounts')}</p>
          <button
            onClick={() => setAddMode('choose')}
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg transition-colors bg-accent-500 text-black"
          >
            <Plus size={14} />
            {t('add_account')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAccounts.map(acc => {
            const prov = providerBadge(acc.provider);
            const { text: syncText, isStale } = getRelativeTime(acc.last_sync, t);
            return (
              <div key={acc.id} className={`bg-surface rounded-xl border border-border p-3 sm:p-4 ${acc.hidden ? 'opacity-50' : ''}`}>
                {/* Row 1: Name + Balance */}
                <div className="flex items-center justify-between gap-2">
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
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{prov.label}</span>
                        <p className="font-medium truncate">{acc.custom_name || acc.name}</p>
                      </div>
                    )}
                  </div>
                  <span
                    className={`text-base sm:text-lg font-semibold text-accent-400 whitespace-nowrap ${acc.provider === 'manual' ? 'cursor-pointer hover:underline' : ''}`}
                    onClick={() => {
                      if (acc.provider === 'manual') {
                        setUpdatingBalanceId(acc.id);
                        setNewBalance(String(acc.balance || 0));
                      }
                    }}
                    title={acc.provider === 'manual' ? t('update_balance') : undefined}
                  >
                    {acc.hidden || allBalancesHidden ? '••••' : formatBalance(acc.balance, acc.currency)}
                  </span>
                </div>

                {/* Row 2: Badges + Sync */}
                <div className="flex items-center gap-1.5 sm:gap-2 mt-1 flex-wrap">
                  {acc.bank_name && (
                    <span className="hidden sm:inline-flex text-xs px-2 py-0.5 rounded-full bg-white/5 text-muted">{acc.bank_name}</span>
                  )}
                  <button
                    onClick={() => cycleType(acc)}
                    className={`text-xs px-2 py-0.5 rounded-full cursor-pointer hover:ring-1 hover:ring-white/20 transition-all ${typeBadgeColor(acc.type)}`}
                  >
                    {t(`account_type_${acc.type || 'checking'}`)}
                  </button>
                  <button
                    onClick={() => cycleUsage(acc)}
                    className={`text-xs px-2 py-0.5 rounded-full cursor-pointer hover:ring-1 hover:ring-white/20 transition-all ${acc.usage === 'professional' ? 'bg-green-500/20 text-green-400' : 'bg-white/5 text-muted'}`}
                  >
                    {t(`account_usage_${acc.usage || 'personal'}`)}
                  </button>
                  {acc.currency && acc.currency !== 'EUR' && (
                    <span className="hidden sm:inline-flex text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{acc.currency}</span>
                  )}
                  {acc.blockchain_address && (
                    <span className="hidden sm:inline text-xs text-muted font-mono">{acc.blockchain_address.slice(0, 6)}...{acc.blockchain_address.slice(-4)}</span>
                  )}
                  {!acc.blockchain_address && acc.account_number && (
                    <span className="hidden sm:inline text-xs text-muted font-mono">
                      {acc.hidden || allBalancesHidden ? '••••••••' : maskNumber(acc.account_number)}
                    </span>
                  )}
                  {!acc.blockchain_address && !acc.account_number && acc.iban && (
                    <span className="hidden sm:inline text-xs text-muted font-mono">
                      {acc.hidden || allBalancesHidden ? '••••••••' : maskNumber(acc.iban)}
                    </span>
                  )}
                  <span className="hidden sm:inline w-px h-3 bg-border" />
                  <span className={`inline-block w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full ${isStale ? 'bg-red-500' : 'bg-green-500'}`} />
                  <span className="text-xs text-muted">{syncText}</span>
                </div>

                {/* Row 3: Action buttons */}
                <div className="flex items-center gap-1 mt-1 justify-end">
                  <button onClick={() => startEdit(acc)} className="text-muted hover:text-white transition-colors p-1" title={t('edit')}>
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => toggleHidden(acc)} className="text-muted hover:text-white transition-colors p-1" title={acc.hidden ? t('show') : t('hide')}>
                    {acc.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    onClick={() => syncAccount(acc.id)}
                    className={`transition-colors p-1 ${isStale ? 'text-orange-400 hover:text-orange-300' : 'text-muted hover:text-white'}`}
                    title={t('sync')}
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button onClick={() => deleteAccount(acc.id)} className="text-muted hover:text-red-400 transition-colors p-1" title={t('delete')}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={!!confirmAction}
        title={t('delete')}
        message={confirmAction?.message || ''}
        variant="danger"
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
