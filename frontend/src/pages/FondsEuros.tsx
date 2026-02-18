import { API } from '../config';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PiggyBank, Building2, BarChart3, Package, Plus, ChevronDown, ArrowLeft
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import EyeToggle from '../components/EyeToggle';
import ConfirmDialog from '../components/ConfirmDialog';
import ScopeSelect from '../components/ScopeSelect';
import { usePreferences } from '../PreferencesContext';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { useFilter } from '../FilterContext';
import { useApi, useAuthFetch } from '../useApi';

const TYPES = [
  { id: 'fonds-euros', icon: PiggyBank, labelKey: 'fonds_euros' },
  { id: 'scpi', icon: Building2, labelKey: 'scpi' },
  { id: 'unites-compte', icon: BarChart3, labelKey: 'unites_compte' },
  { id: 'other', icon: Package, labelKey: 'other' },
] as const;

interface Holding {
  id: number;
  name: string;
  account_id?: number;
  account_name?: string;
  current_value: number;
  annual_rate?: number;
  last_update_date: string;
  type: string;
  reminder_months?: number;
}

interface BankAccount { 
  id: number; 
  name: string; 
  custom_name: string | null; 
  type: string; 
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M€`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k€`;
  return `${Math.round(n)}€`;
};
const fmtPct = (n: number) => `${n.toFixed(2)}%`;

export default function FondsEuros() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const f = (n: number): React.ReactNode => hideAmounts ? <span className="amount-masked">{fmt(n)}</span> : fmt(n);
  const [showForm, setShowForm ] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [form, setForm] = useState({
    name: '',
    account_id: '',
    current_value: '',
    annual_rate: '',
    last_update_date: '',
    type: 'fonds-euros' as Holding['type'],
    reminder_months: '',
  });
  usePreferences();
  const { scope, appendScope } = useFilter();

  const holdingsUrl = `${API}/fonds-euros`;

  const accountsUrl = useMemo(() => appendScope(`${API}/bank/accounts`), [scope, appendScope]);

  const { data: holdings } = useApi<any[]>(holdingsUrl);
  const { data: accountsRaw } = useApi<BankAccount[]>(accountsUrl);

  const accounts = accountsRaw || [];
  const holdingList = holdings || [];

  const reload = () => {
    window.location.reload();
  };

  const resetForm = () => {
    setForm({
      name: '',
      account_id: '',
      current_value: '',
      annual_rate: '',
      last_update_date: '',
      type: 'fonds-euros',
      reminder_months: '',
    });
  };

  const startCreate = () => {
    resetForm();
    setEditingId(null);
    setShowForm(true);
  };

  const save = async () => {
    const body = {
      name: form.name,
      account_id: form.account_id ? parseInt(form.account_id) : null,
      current_value: parseFloat(form.current_value),
      annual_rate: form.annual_rate ? parseFloat(form.annual_rate) / 100 : null,
      last_update_date: form.last_update_date || new Date().toISOString().split('T')[0],
      type: form.type,
      reminder_months: form.reminder_months ? parseInt(form.reminder_months) : null,
    };

    try {
      if (editingId) {
        await authFetch(`${API}/fonds-euros/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await authFetch(`${API}/fonds-euros`, { method: 'POST', body: JSON.stringify(body) });
      }
      setShowForm(false);
      resetForm();
      reload();
    } catch (e) {
      console.error(e);
    }
  };

  const totalValue = holdingList.reduce((s, h) => s + h.current_value, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Fonds Euros</h1>
          {holdingList.length > 0 && (
            <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="hidden md:block"><ScopeSelect /></span>
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black"
          >
            <Plus size={16} /> <span className="hidden sm:inline">Ajouter</span>
          </button>
        </div>
      </div>
      {/* Summary header */}
      {holdingList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-gradient-to-r from-gray-900/50 to-gray-800/50 rounded-xl border border-gray-700">
          <div>
            <p className="text-sm text-muted uppercase tracking-wide mb-1">Valeur totale</p>
            <p className="text-2xl font-bold">
              {hideAmounts ? <span className="amount-masked">{fmtCompact(totalValue)}</span> : fmtCompact(totalValue)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted uppercase tracking-wide mb-1">Taux moyen</p>
            <p className="text-2xl font-bold text-green-400">
              {holdingList.filter(h => h.annual_rate).length > 0
                ? fmtPct(holdingList.filter(h => h.annual_rate).reduce((s, h) => s + h.annual_rate * 100, 0) / holdingList.filter(h => h.annual_rate).length)
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted uppercase tracking-wide mb-1">Nombre de fonds</p>
            <p className="text-2xl font-bold text-accent-400">{holdingList.length}</p>
          </div>
        </div>
      )}


      {showForm && (
        <div className="bg-surface rounded-xl border border-border p-3.5 mb-3 md:max-w-2xl mx-auto">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-2">
            {editingId ? 'Modifier le fonds' : 'Nouveau fonds'}
          </h2>
          <div className="space-y-3">
            <input
              placeholder="Nom du fonds (ex: Fonds euros Suravenir Opportunités 2)" 
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <select 
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as Holding['type'] }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            >
              {TYPES.map(({ id, labelKey }) => (
                <option key={id} value={id}>{t(labelKey) || id.replace('-', ' ').toUpperCase()}</option>
              ))}
            </select>
            <select 
              value={form.account_id}
              onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Sélectionner un compte / assurance-vie</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id.toString()}>{a.custom_name || a.name}</option>
              ))}
            </select>
            <div>
              <label className="text-xs text-muted mb-1 block font-medium">Mettre à jour la valeur</label>
              <input 
                type="number"
                placeholder="Valeur actuelle (€)"
                value={form.current_value}
                onChange={e => setForm(f => ({ ...f, current_value: e.target.value }))}
                className="w-full bg-accent-500/10 border-2 border-accent-500 rounded-lg px-3 py-2 text-sm font-semibold text-accent-400"
              />
            </div>
            <input
              type="date"
              placeholder="Date de mise à jour"
              value={form.last_update_date}
              onChange={e => setForm(f => ({ ...f, last_update_date: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Taux annuel (%)"
              value={form.annual_rate}
              onChange={e => setForm(f => ({ ...f, annual_rate: e.target.value }))}
              step="0.01"
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <select 
              value={form.reminder_months}
              onChange={e => setForm(f => ({ ...f, reminder_months: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Pas de rappel</option>
              <option value="3">Tous les 3 mois</option>
              <option value="6">Tous les 6 mois</option>
              <option value="12">Tous les 12 mois</option>
            </select>
            <div className="flex gap-2 pt-2">
              <button 
                onClick={save} 
                disabled={!form.name || !form.current_value}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black disabled:opacity-40"
              >
                {editingId ? 'Sauvegarder' : 'Créer'}
              </button>
              <button 
                onClick={() => { setShowForm(false); resetForm(); }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-transparent text-muted hover:text-white"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {holdingList.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <PiggyBank className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm">Aucun fonds euros ajouté.</p>
          <button onClick={startCreate} className="mt-4 px-6 py-2 bg-accent-500 text-black rounded-lg font-medium">
            Ajouter mon premier
          </button>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {/* Group by account */}
          {(() => {
            const groups = (holdingList as Holding[]).reduce((acc: Record<string, Holding[]>, h: Holding) => {
              const key = h.account_name || 'Sans compte';
              if (!acc[key]) acc[key] = [];
              acc[key].push(h);
              return acc;
            }, {});
            return Object.entries(groups).map(([accountName, items]: [string, Holding[]]) => {
              const groupTotal = items.reduce((s: number, h: Holding) => s + h.current_value, 0);
              const initials = accountName.slice(0, 3).toUpperCase();
              return (
                <div key={accountName} className="border-b border-border last:border-0">
                  {/* Account header row */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors">
                    <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-bold text-muted">{initials}</span>
                    </div>
                    <span className="text-sm font-semibold flex-1 truncate">{accountName}</span>
                    <span className="text-sm font-semibold text-accent-400 tabular-nums">{f(groupTotal)}</span>
                    <ChevronDown size={14} className="text-muted flex-shrink-0" />
                  </div>
                  {/* Sub-rows for each fund */}
                  {items.map((h: Holding) => (
                    <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 pl-[52px] border-t border-border/30 hover:bg-white/5 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{h.name}</p>
                        <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                          {h.annual_rate && <span className="text-green-400">{fmtPct(h.annual_rate * 100)}/an</span>}
                          {h.last_update_date && <span>{h.last_update_date}</span>}
                        </div>
                      </div>
                      <span className="text-sm tabular-nums">{f(h.current_value)}</span>
                    </div>
                  ))}
                </div>
              );
            });
          })()}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmAction}
        title="Supprimer"
        message={confirmAction?.message || ''}
        variant="danger"
        onConfirm={() => confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
