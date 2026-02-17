import { API } from '../config';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PiggyBank, Building2, BarChart3, Package, Plus, Pencil, Trash2, ChevronDown, X, ArrowLeft
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import EyeToggle from '../components/EyeToggle';
import ConfirmDialog from '../components/ConfirmDialog';
import ScopeSelect from '../components/ScopeSelect';
import { usePreferences } from '../PreferencesContext';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { useFilter } from '../FilterContext';
import { useApi, useAuthFetch, invalidateApi } from '../useApi';

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

interface BankAccount { id: number; name: string; custom_name: string | null; type: string; }

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
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
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
  const { prefs } = usePreferences();
  const { scope, appendScope } = useFilter();

  const holdingsUrl = useMemo(() => {
    let url = `${API}/fonds-euros`;
    if (filter) url += `?type=${filter}`;
    return url;
  }, [filter]);

  const accountsUrl = useMemo(() => appendScope(`${API}/bank/accounts`), [scope, appendScope]);

  const { data: holdings, refetch: refetchHoldings } = useApi<any[]>(holdingsUrl);
  const { data: accountsRaw } = useApi<BankAccount[]>(accountsUrl);

  const accounts = accountsRaw || [];
  const holdingList = holdings || [];

  const reload = () => {
    invalidateApi(holdingsUrl);
    refetchHoldings();
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

  const startEdit = (h: Holding) => {
    setForm({
      name: h.name,
      account_id: h.account_id ? String(h.account_id) : '',
      current_value: String(h.current_value),
      annual_rate: h.annual_rate ? String(h.annual_rate * 100) : '',
      last_update_date: h.last_update_date,
      type: h.type,
      reminder_months: h.reminder_months ? String(h.reminder_months) : '',
    });
    setEditingId(h.id);
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

  const deleteHolding = (id: number) => {
    setConfirmAction({
      message: 'Confirmer la suppression ?',
      onConfirm: async () => {
        setConfirmAction(null);
        await authFetch(`${API}/fonds-euros/${id}`, { method: 'DELETE' });
        reload();
      },
    });
  };

  const typeIcon = (type: string) => {
    const t = TYPES.find(tt => tt.id === type);
    return t ? t.icon : Package;
  };

  const totalValue = holdingList.reduce((s, h) => s + h.current_value, 0);

  return (
    &lt;div&gt;
      &lt;div className="flex items-center justify-between gap-2 mb-2 h-10"&gt;
        &lt;div className="flex items-center gap-2 min-w-0"&gt;
          &lt;button onClick={() =&gt; navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0"&gt;
            &lt;ArrowLeft size={20} /&gt;
          &lt;/button&gt;
          &lt;h1 className="text-xl font-semibold whitespace-nowrap"&gt;Fonds Euros&lt;/h1&gt;
          {holdingList.length &gt; 0 &amp;&amp; (
            &lt;EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} /&gt;
          )}
        &lt;/div&gt;
        &lt;div className="flex items-center gap-1 flex-shrink-0"&gt;
          &lt;span className="hidden md:block"&gt;&lt;ScopeSelect /&gt;&lt;/span&gt;
          &lt;button
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black"
          &gt;
            &lt;Plus size={16} /&gt; &lt;span className="hidden sm:inline"&gt;Ajouter&lt;/span&gt;
          &lt;/button&gt;
        &lt;/div&gt;
      &lt;/div&gt;
      {holdingList.length &gt; 0 &amp;&amp; (
        &lt;div className="text-sm text-muted mb-3"&gt;
          Total: {hideAmounts ? &lt;span className="amount-masked"&gt;{fmtCompact(totalValue)}&lt;/span&gt; : fmtCompact(totalValue)}
        &lt;/div&gt;
      )}

      {showForm &amp;&amp; (
        &lt;div className="bg-surface rounded-xl border border-border p-3.5 mb-3 md:max-w-2xl mx-auto"&gt;
          &lt;h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-2"&gt;
            {editingId ? 'Modifier le fonds' : 'Nouveau fonds'}
          &lt;/h2&gt;
          &lt;div className="space-y-3"&gt;
            &lt;input
              placeholder="Nom du fonds (ex: Fonds euros Suravenir Opportunités 2)" 
              value={form.name}
              onChange={e =&gt; setForm(f =&gt; ({ ...f, name: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            /&gt;
            &lt;select 
              value={form.type}
              onChange={e =&gt; setForm(f =&gt; ({ ...f, type: e.target.value as Holding['type'] }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            &gt;
              {TYPES.map(({ id, labelKey }) =&gt; (
                &lt;option key={id} value={id}&gt;{t(labelKey) || id.replace('-', ' ').toUpperCase()}&lt;/option&gt;
              ))}
            &lt;/select&gt;
            &lt;select 
              value={form.account_id}
              onChange={e =&gt; setForm(f =&gt; ({ ...f, account_id: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            &gt;
              &lt;option value=""&gt;Sélectionner un compte / assurance-vie&lt;/option&gt;
              {accounts.map(a =&gt; (
                &lt;option key={a.id} value={a.id.toString()}&gt;{a.custom_name || a.name}&lt;/option&gt;
              ))}
            &lt;/select&gt;
            &lt;div&gt;
              &lt;label className="text-xs text-muted mb-1 block font-medium"&gt;Mettre à jour la valeur&lt;/label&gt;
              &lt;input 
                type="number"
                placeholder="Valeur actuelle (€)"
                value={form.current_value}
                onChange={e =&gt; setForm(f =&gt; ({ ...f, current_value: e.target.value }))}
                className="w-full bg-accent-500/10 border-2 border-accent-500 rounded-lg px-3 py-2 text-sm font-semibold text-accent-400"
              /&gt;
            &lt;/div&gt;
            &lt;input
              type="date"
              placeholder="Date de mise à jour"
              value={form.last_update_date}
              onChange={e =&gt; setForm(f =&gt; ({ ...f, last_update_date: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            /&gt;
            &lt;input
              type="number"
              placeholder="Taux annuel (%)"
              value={form.annual_rate}
              onChange={e =&gt; setForm(f =&gt; ({ ...f, annual_rate: e.target.value }))}
              step="0.01"
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            /&gt;
            &lt;select 
              value={form.reminder_months}
              onChange={e =&gt; setForm(f =&gt; ({ ...f, reminder_months: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            &gt;
              &lt;option value=""&gt;Pas de rappel&lt;/option&gt;
              &lt;option value="3"&gt;Tous les 3 mois&lt;/option&gt;
              &lt;option value="6"&gt;Tous les 6 mois&lt;/option&gt;
              &lt;option value="12"&gt;Tous les 12 mois&lt;/option&gt;
            &lt;/select&gt;
            &lt;div className="flex gap-2 pt-2"&gt;
              &lt;button 
                onClick={save} 
                disabled={!form.name || !form.current_value}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black disabled:opacity-40"
              &gt;
                {editingId ? 'Sauvegarder' : 'Créer'}
              &lt;/button&gt;
              &lt;button 
                onClick={() =&gt; { setShowForm(false); resetForm(); }}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-transparent text-muted hover:text-white"
              &gt;
                Annuler
              &lt;/button&gt;
            &lt;/div&gt;
          &lt;/div&gt;
        &lt;/div&gt;
      )}

      {holdingList.length === 0 ? (
        &lt;div className="bg-surface rounded-xl border border-border p-8 text-center"&gt;
          &lt;PiggyBank className="mx-auto text-muted mb-3" size={32} /&gt;
          &lt;p className="text-muted text-sm"&gt;Aucun fonds euros ajouté.&lt;/p&gt;
          &lt;button onClick={startCreate} className="mt-4 px-6 py-2 bg-accent-500 text-black rounded-lg font-medium"&gt;
            Ajouter mon premier
          &lt;/button&gt;
        &lt;/div&gt;
      ) : (
        &lt;div className="space-y-3"&gt;
          {holdingList.map((h: Holding) =&gt; {
            const Icon = typeIcon(h.type);
            const expanded = expandedId === h.id;
            return (
              &lt;div key={h.id} className="bg-surface rounded-xl border border-border overflow-hidden"&gt;
                &lt;div 
                  className="px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
                  onClick={() =&gt; setExpandedId(expanded ? null : h.id)}
                &gt;
                  &lt;div className="flex items-center gap-2"&gt;
                    &lt;div className="w-8 h-8 rounded-lg bg-accent-500/10 items-center justify-center flex-shrink-0 hidden md:flex"&gt;
                      &lt;Icon size={16} className="text-accent-400" /&gt;
                    &lt;/div&gt;
                    &lt;p className="text-sm font-medium text-white truncate min-w-0 flex-1"&gt;{h.name}&lt;/p&gt;
                    &lt;span className="text-sm font-semibold text-accent-400 flex-shrink-0"&gt;
                      {f(h.current_value)}
                    &lt;/span&gt;
                    &lt;ChevronDown size={14} className={`text-muted flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`} /&gt;
                  &lt;/div&gt;
                  &lt;div className="mt-1 flex items-center gap-2 text-xs text-muted"&gt;
                    {h.account_name &amp;&amp; &lt;span&gt;{h.account_name}&lt;/span&gt;}
                    {h.annual_rate &amp;&amp; &lt;span className="text-green-400"&gt;{fmtPct(h.annual_rate * 100)}/an&lt;/span&gt;}
                    &lt;span&gt;{h.last_update_date}&lt;/span&gt;
                  &lt;/div&gt;
                &lt;/div&gt;
                {expanded &amp;&amp; (
                  &lt;div className="px-4 pb-3 border-t border-border/50 pt-3"&gt;
                    &lt;div className="flex gap-2 mb-3"&gt;
                      &lt;button onClick={e =&gt; { e.stopPropagation(); startEdit(h); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-white/10"&gt;
                        &lt;Pencil size={12} /&gt; Modifier
                      &lt;/button&gt;
                      &lt;button onClick={e =&gt; { e.stopPropagation(); deleteHolding(h.id); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-white/5 hover:bg-red-500/10 text-red-400"&gt;
                        &lt;Trash2 size={12} /&gt; Supprimer
                      &lt;/button&gt;
                    &lt;/div&gt;
                    {h.reminder_months &amp;&amp; (
                      &lt;p className="text-xs text-muted mb-2"&gt;Rappel tous les {h.reminder_months} mois&lt;/p&gt;
                    )}
                  &lt;/div&gt;
                )}
              &lt;/div&gt;
            );
          })}
        &lt;/div&gt;
      )}

      &lt;ConfirmDialog
        open={!!confirmAction}
        title="Supprimer"
        message={confirmAction?.message || ''}
        variant="danger"
        onConfirm={() =&gt; confirmAction?.onConfirm()}
        onCancel={() =&gt; setConfirmAction(null)}
      /&gt;
    &lt;/div&gt;
  );
}