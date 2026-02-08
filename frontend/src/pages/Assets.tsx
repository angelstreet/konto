import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Home, Car, Watch, Package, Plus, Pencil, Trash2, ChevronDown, X
} from 'lucide-react';

const API = '/kompta/api';
const apiFetch = (url: string, opts?: RequestInit) =>
  fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts }).then(r => r.json());

const TYPES = [
  { id: 'real_estate', icon: Home, labelKey: 'asset_real_estate' },
  { id: 'vehicle', icon: Car, labelKey: 'asset_vehicle' },
  { id: 'valuable', icon: Watch, labelKey: 'asset_valuable' },
  { id: 'other', icon: Package, labelKey: 'asset_other' },
] as const;

interface Cost { id?: number; label: string; amount: number; frequency: string; category?: string; }
interface Revenue { id?: number; label: string; amount: number; frequency: string; }
interface Asset {
  id: number; type: string; name: string;
  purchase_price: number | null; purchase_date: string | null;
  current_value: number | null; current_value_date: string | null;
  linked_loan_account_id: number | null; loan_name: string | null; loan_balance: number | null;
  notes: string | null;
  costs: Cost[]; revenues: Revenue[];
  monthly_costs: number; monthly_revenues: number;
  pnl: number | null; pnl_percent: number | null;
}

interface BankAccount { id: number; name: string; custom_name: string | null; type: string; balance: number; }

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export default function Assets() {
  const { t } = useTranslation();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [form, setForm] = useState({
    type: 'real_estate', name: '', purchase_price: '', purchase_date: '',
    current_value: '', linked_loan_account_id: '', notes: '',
    costs: [] as Cost[], revenues: [] as Revenue[],
  });

  const load = useCallback(() => {
    const params = filter ? `?type=${filter}` : '';
    apiFetch(`${API}/assets${params}`).then(setAssets).catch(() => {});
    apiFetch(`${API}/bank/accounts`).then((a: BankAccount[]) => setAccounts(a)).catch(() => {});
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const loanAccounts = accounts.filter(a => a.type === 'loan');

  const resetForm = () => setForm({
    type: 'real_estate', name: '', purchase_price: '', purchase_date: '',
    current_value: '', linked_loan_account_id: '', notes: '',
    costs: [], revenues: [],
  });

  const startCreate = (type = 'real_estate') => {
    resetForm();
    setForm(f => ({ ...f, type }));
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (a: Asset) => {
    setForm({
      type: a.type, name: a.name,
      purchase_price: a.purchase_price ? String(a.purchase_price) : '',
      purchase_date: a.purchase_date || '',
      current_value: a.current_value ? String(a.current_value) : '',
      linked_loan_account_id: a.linked_loan_account_id ? String(a.linked_loan_account_id) : '',
      notes: a.notes || '',
      costs: a.costs || [],
      revenues: a.revenues || [],
    });
    setEditingId(a.id);
    setShowForm(true);
  };

  const save = async () => {
    const body = {
      type: form.type, name: form.name,
      purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
      purchase_date: form.purchase_date || null,
      current_value: form.current_value ? parseFloat(form.current_value) : null,
      current_value_date: form.current_value ? new Date().toISOString().split('T')[0] : null,
      linked_loan_account_id: form.linked_loan_account_id ? parseInt(form.linked_loan_account_id) : null,
      notes: form.notes || null,
      costs: form.costs.filter(c => c.label && c.amount),
      revenues: form.revenues.filter(r => r.label && r.amount),
    };

    if (editingId) {
      await apiFetch(`${API}/assets/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await apiFetch(`${API}/assets`, { method: 'POST', body: JSON.stringify(body) });
    }
    setShowForm(false);
    resetForm();
    load();
  };

  const deleteAsset = async (id: number) => {
    if (!confirm(t('confirm_delete_asset'))) return;
    await apiFetch(`${API}/assets/${id}`, { method: 'DELETE' });
    load();
  };

  const addCost = () => setForm(f => ({ ...f, costs: [...f.costs, { label: '', amount: 0, frequency: 'monthly' }] }));
  const addRevenue = () => setForm(f => ({ ...f, revenues: [...f.revenues, { label: '', amount: 0, frequency: 'monthly' }] }));
  const updateCost = (i: number, field: string, val: any) => {
    const costs = [...form.costs];
    (costs[i] as any)[field] = val;
    setForm(f => ({ ...f, costs }));
  };
  const removeCost = (i: number) => setForm(f => ({ ...f, costs: f.costs.filter((_, j) => j !== i) }));
  const updateRevenue = (i: number, field: string, val: any) => {
    const revenues = [...form.revenues];
    (revenues[i] as any)[field] = val;
    setForm(f => ({ ...f, revenues }));
  };
  const removeRevenue = (i: number) => setForm(f => ({ ...f, revenues: f.revenues.filter((_, j) => j !== i) }));

  const typeIcon = (type: string) => {
    const t = TYPES.find(tt => tt.id === type);
    return t ? t.icon : Package;
  };

  // Totals
  const totalValue = assets.reduce((s, a) => s + (a.current_value || a.purchase_price || 0), 0);
  const totalPnl = assets.reduce((s, a) => s + (a.pnl || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">{t('nav_assets')}</h1>
          {assets.length > 0 && (
            <p className="text-sm text-muted mt-1">
              {t('total_value')}: <span className="text-accent-400 font-semibold">{fmt(totalValue)}</span>
              {totalPnl !== 0 && (
                <span className={`ml-2 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ({totalPnl >= 0 ? '+' : ''}{fmt(totalPnl)})
                </span>
              )}
            </p>
          )}
        </div>
        <button onClick={() => startCreate()} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
          <Plus size={16} /> {t('add_asset')}
        </button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!filter ? 'bg-accent-500/20 text-accent-400' : 'bg-surface text-muted hover:text-white'}`}>
          {t('all')}
        </button>
        {TYPES.map(({ id, icon: Icon, labelKey }) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === id ? 'bg-accent-500/20 text-accent-400' : 'bg-surface text-muted hover:text-white'}`}>
            <Icon size={12} /> {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Asset form */}
      {showForm && (
        <div className="bg-surface rounded-xl border border-border p-5 mb-6">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">
            {editingId ? t('edit_asset') : t('new_asset')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm">
              {TYPES.map(({ id, labelKey }) => <option key={id} value={id}>{t(labelKey)}</option>)}
            </select>
            <input placeholder={t('asset_name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
            <input placeholder={t('purchase_price')} type="number" value={form.purchase_price}
              onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
            <input placeholder={t('purchase_date')} type="date" value={form.purchase_date}
              onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
            <input placeholder={t('current_value')} type="number" value={form.current_value}
              onChange={e => setForm(f => ({ ...f, current_value: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
            {loanAccounts.length > 0 && (
              <select value={form.linked_loan_account_id}
                onChange={e => setForm(f => ({ ...f, linked_loan_account_id: e.target.value }))}
                className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm">
                <option value="">{t('link_loan')}</option>
                {loanAccounts.map(a => (
                  <option key={a.id} value={a.id}>{a.custom_name || a.name} ({fmt(a.balance)})</option>
                ))}
              </select>
            )}
            <textarea placeholder={t('notes')} value={form.notes} rows={2}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm col-span-full" />
          </div>

          {/* Monthly costs */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted uppercase tracking-wide font-medium">{t('monthly_costs')}</span>
              <button onClick={addCost} className="text-xs text-accent-400 hover:text-accent-300">+ {t('add_cost')}</button>
            </div>
            {form.costs.map((cost, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input placeholder={t('cost_label')} value={cost.label}
                  onChange={e => updateCost(i, 'label', e.target.value)}
                  className="flex-1 bg-black/30 border border-border rounded-lg px-3 py-1.5 text-sm" />
                <input placeholder="€" type="number" value={cost.amount || ''}
                  onChange={e => updateCost(i, 'amount', parseFloat(e.target.value) || 0)}
                  className="w-24 bg-black/30 border border-border rounded-lg px-3 py-1.5 text-sm" />
                <select value={cost.frequency} onChange={e => updateCost(i, 'frequency', e.target.value)}
                  className="bg-black/30 border border-border rounded-lg px-2 py-1.5 text-xs">
                  <option value="monthly">/mois</option>
                  <option value="yearly">/an</option>
                  <option value="one_time">unique</option>
                </select>
                <button onClick={() => removeCost(i)} className="text-muted hover:text-red-400"><X size={14} /></button>
              </div>
            ))}
          </div>

          {/* Revenues (mainly for real estate) */}
          {(form.type === 'real_estate' || form.revenues.length > 0) && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted uppercase tracking-wide font-medium">{t('monthly_revenues')}</span>
                <button onClick={addRevenue} className="text-xs text-accent-400 hover:text-accent-300">+ {t('add_revenue')}</button>
              </div>
              {form.revenues.map((rev, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input placeholder={t('revenue_label')} value={rev.label}
                    onChange={e => updateRevenue(i, 'label', e.target.value)}
                    className="flex-1 bg-black/30 border border-border rounded-lg px-3 py-1.5 text-sm" />
                  <input placeholder="€" type="number" value={rev.amount || ''}
                    onChange={e => updateRevenue(i, 'amount', parseFloat(e.target.value) || 0)}
                    className="w-24 bg-black/30 border border-border rounded-lg px-3 py-1.5 text-sm" />
                  <select value={rev.frequency} onChange={e => updateRevenue(i, 'frequency', e.target.value)}
                    className="bg-black/30 border border-border rounded-lg px-2 py-1.5 text-xs">
                    <option value="monthly">/mois</option>
                    <option value="yearly">/an</option>
                  </select>
                  <button onClick={() => removeRevenue(i)} className="text-muted hover:text-red-400"><X size={14} /></button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button onClick={save} disabled={!form.name}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black disabled:opacity-40">
              {editingId ? t('save') : t('create')}
            </button>
            <button onClick={() => { setShowForm(false); resetForm(); }}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-transparent text-muted hover:text-white">
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Asset list */}
      {assets.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Home className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm">{t('no_assets')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assets.map(a => {
            const Icon = typeIcon(a.type);
            const expanded = expandedId === a.id;
            const netCashflow = a.monthly_revenues - a.monthly_costs;
            return (
              <div key={a.id} className="bg-surface rounded-xl border border-border overflow-hidden">
                {/* Main card */}
                <div className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
                  onClick={() => setExpandedId(expanded ? null : a.id)}>
                  <div className="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center flex-shrink-0">
                    <Icon size={20} className="text-accent-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{a.name}</p>
                    <p className="text-xs text-muted">
                      {a.purchase_date && `${t('purchased')} ${a.purchase_date}`}
                      {a.loan_name && <span className="ml-2">🔗 {a.loan_name}</span>}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-accent-400">
                      {fmt(a.current_value || a.purchase_price || 0)}
                    </p>
                    {a.pnl != null && (
                      <p className={`text-xs font-medium ${a.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {a.pnl >= 0 ? '+' : ''}{fmt(a.pnl)} ({fmtPct(a.pnl_percent!)})
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={e => { e.stopPropagation(); startEdit(a); }} className="p-1.5 text-muted hover:text-white"><Pencil size={14} /></button>
                    <button onClick={e => { e.stopPropagation(); deleteAsset(a.id); }} className="p-1.5 text-muted hover:text-red-400"><Trash2 size={14} /></button>
                    <ChevronDown size={14} className={`text-muted mt-1.5 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                  </div>
                </div>

                {/* Expanded details */}
                {expanded && (
                  <div className="px-4 pb-4 border-t border-border/50 pt-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      {a.purchase_price != null && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">{t('purchase_price')}</p>
                          <p>{fmt(a.purchase_price)}</p>
                        </div>
                      )}
                      {a.current_value != null && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">{t('current_value')}</p>
                          <p className="text-accent-400 font-semibold">{fmt(a.current_value)}</p>
                        </div>
                      )}
                      {a.loan_balance != null && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">{t('linked_loan')}</p>
                          <p className="text-red-400">{fmt(a.loan_balance)}</p>
                        </div>
                      )}
                      {a.pnl != null && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">P&L</p>
                          <p className={a.pnl >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                            {a.pnl >= 0 ? '+' : ''}{fmt(a.pnl)}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Costs */}
                    {a.costs.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] text-muted uppercase mb-1">{t('monthly_costs')} ({fmt(a.monthly_costs)}/mois)</p>
                        <div className="space-y-1">
                          {a.costs.map((c, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-muted">{c.label}</span>
                              <span>{fmt(c.amount)}{c.frequency === 'yearly' ? '/an' : c.frequency === 'one_time' ? '' : '/mois'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Revenues */}
                    {a.revenues.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] text-muted uppercase mb-1">{t('monthly_revenues')} ({fmt(a.monthly_revenues)}/mois)</p>
                        <div className="space-y-1">
                          {a.revenues.map((r, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-muted">{r.label}</span>
                              <span className="text-green-400">{fmt(r.amount)}{r.frequency === 'yearly' ? '/an' : '/mois'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Net cashflow */}
                    {(a.costs.length > 0 || a.revenues.length > 0) && (
                      <div className="mt-3 pt-2 border-t border-border/50 flex justify-between text-sm font-medium">
                        <span>{t('net_cashflow')}</span>
                        <span className={netCashflow >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {netCashflow >= 0 ? '+' : ''}{fmt(netCashflow)}/mois
                        </span>
                      </div>
                    )}

                    {a.notes && <p className="mt-2 text-xs text-muted italic">{a.notes}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
