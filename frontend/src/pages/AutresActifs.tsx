import { useState } from 'react';
import { ArrowLeft, Car, Watch, Package, Plus, Trash2, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import EyeToggle from '../components/EyeToggle';
import ScopeSelect from '../components/ScopeSelect';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { useFilter } from '../FilterContext';
import { useApi, useAuthFetch } from '../useApi';
import { API } from '../config';

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M€`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k€`;
  return `${Math.round(n)}€`;
};

const TYPES = [
  { id: 'vehicle', label: 'Véhicule', Icon: Car },
  { id: 'valuable', label: 'Objet de valeur', Icon: Watch },
  { id: 'other', label: 'Autre', Icon: Package },
] as const;

type AssetType = 'vehicle' | 'valuable' | 'other';

function typeIcon(type: string) {
  const entry = TYPES.find((t) => t.id === type);
  if (!entry) return <Package size={16} className="text-muted" />;
  return <entry.Icon size={16} className="text-muted" />;
}

function typeLabel(type: string) {
  return TYPES.find((t) => t.id === type)?.label ?? type;
}

interface Asset {
  id: number;
  type: string;
  name: string;
  current_value: number | null;
  purchase_price: number | null;
  purchase_date: string | null;
  notes: string | null;
}

export default function AutresActifs() {
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const f = (n: number) =>
    hideAmounts ? <span className="amount-masked">{fmt(n)}</span> : fmt(n);
  const { appendScope } = useFilter();

  const assetsUrl = appendScope(`${API}/assets`);
  const { data: allAssets, refetch: refetchAssets } = useApi<Asset[]>(assetsUrl);

  const assets = (allAssets || []).filter((a) => a.type !== 'real_estate');

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [form, setForm] = useState({
    name: '',
    type: 'vehicle' as AssetType,
    current_value: '',
    purchase_price: '',
    purchase_date: '',
    notes: '',
  });

  const resetForm = () => {
    setForm({ name: '', type: 'vehicle', current_value: '', purchase_price: '', purchase_date: '', notes: '' });
    setEditingId(null);
  };

  const startCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const startEdit = (asset: Asset) => {
    setForm({
      name: asset.name,
      type: asset.type as AssetType,
      current_value: asset.current_value != null ? String(asset.current_value) : '',
      purchase_price: asset.purchase_price != null ? String(asset.purchase_price) : '',
      purchase_date: asset.purchase_date || '',
      notes: asset.notes || '',
    });
    setEditingId(asset.id);
    setShowForm(true);
  };

  const save = async () => {
    const body = {
      name: form.name,
      type: form.type,
      current_value: form.current_value ? parseFloat(form.current_value) : null,
      purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
      purchase_date: form.purchase_date || null,
      notes: form.notes || null,
    };
    try {
      if (editingId) {
        await authFetch(`${API}/assets/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await authFetch(`${API}/assets`, { method: 'POST', body: JSON.stringify(body) });
      }
      setShowForm(false);
      resetForm();
      refetchAssets();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteAsset = async (id: number, name: string) => {
    setConfirmAction({
      message: `Supprimer "${name}" ?`,
      onConfirm: async () => {
        try {
          await authFetch(`${API}/assets/${id}`, { method: 'DELETE' });
          setConfirmAction(null);
          refetchAssets();
        } catch (e) {
          console.error(e);
          setConfirmAction(null);
        }
      },
    });
  };

  const totalValue = assets.reduce((s, a) => s + (a.current_value || 0), 0);

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
          <h1 className="text-xl font-semibold whitespace-nowrap">Autres Actifs</h1>
          {assets.length > 0 && (
            <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="hidden md:block">
            <ScopeSelect />
          </span>
          <button
            onClick={startCreate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black"
          >
            <Plus size={16} /> <span className="hidden sm:inline">Ajouter</span>
          </button>
        </div>
      </div>

      {/* Summary Header */}
      {assets.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-gradient-to-r from-gray-900/50 to-gray-800/50 rounded-xl border border-gray-700">
          <div>
            <p className="text-sm text-muted uppercase tracking-wide mb-1">Valeur totale</p>
            <p className="text-2xl font-bold text-white">
              {hideAmounts ? (
                <span className="amount-masked">{fmtCompact(totalValue)}</span>
              ) : (
                fmtCompact(totalValue)
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted uppercase tracking-wide mb-1">Nombre d'actifs</p>
            <p className="text-2xl font-bold text-accent-400">{assets.length}</p>
          </div>
        </div>
      )}

      {/* Add / Edit Form */}
      {showForm && (
        <div className="bg-surface rounded-xl border border-border p-3.5 mb-4 md:max-w-2xl mx-auto">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">
            {editingId ? "Modifier l'actif" : 'Nouvel actif'}
          </h2>
          <div className="space-y-3">
            <input
              placeholder="Nom (ex: Mercedes Classe A, Montre Rolex…)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AssetType }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            >
              {TYPES.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <div>
              <label className="text-xs text-muted mb-1 block font-medium">
                Valeur actuelle (€)
              </label>
              <input
                type="number"
                placeholder="30000"
                value={form.current_value}
                onChange={(e) => setForm((f) => ({ ...f, current_value: e.target.value }))}
                className="w-full bg-accent-500/10 border-2 border-accent-500 rounded-lg px-3 py-2 text-sm font-semibold text-accent-400"
              />
            </div>
            <input
              type="number"
              placeholder="Prix d'achat (€) — optionnel"
              value={form.purchase_price}
              onChange={(e) => setForm((f) => ({ ...f, purchase_price: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="date"
              placeholder="Date d'achat"
              value={form.purchase_date}
              onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            />
            <textarea
              placeholder="Notes — optionnel"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm resize-none"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                disabled={!form.name || !form.current_value}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black disabled:opacity-40"
              >
                {editingId ? 'Sauvegarder' : 'Créer'}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-white"
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assets Table */}
      {assets.length === 0 && allAssets !== null ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Car className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm mb-2">Aucun actif ajouté.</p>
          <p className="text-muted text-xs mb-6">
            Ajoutez vos véhicules, objets de valeur ou autres actifs pour suivre votre patrimoine.
          </p>
          <button
            onClick={startCreate}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-black mx-auto"
          >
            <Plus size={16} /> Ajouter un actif
          </button>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="hidden md:grid grid-cols-[1fr_160px_160px_auto] gap-4 px-4 py-2.5 text-xs font-semibold text-muted uppercase tracking-wider border-b border-border">
            <span>Nom</span>
            <span className="text-right">Prix d'achat</span>
            <span className="text-right">Valeur actuelle</span>
            <span />
          </div>
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_160px_160px_auto] gap-4 px-4 py-3.5 items-center border-b border-border/50 last:border-0 hover:bg-white/5 transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center flex-shrink-0">
                  {typeIcon(asset.type)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{asset.name}</p>
                  <p className="text-xs text-muted">{typeLabel(asset.type)}</p>
                </div>
              </div>
              <span className="hidden md:block text-sm text-right tabular-nums text-muted">
                {asset.purchase_price != null ? f(asset.purchase_price) : '—'}
              </span>
              <span className="text-sm font-medium text-right tabular-nums">
                {asset.current_value != null ? f(asset.current_value) : '—'}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => startEdit(asset)}
                  className="p-1.5 rounded-md text-muted hover:text-white hover:bg-white/10 transition-colors"
                  title="Modifier"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => deleteAsset(asset.id, asset.name)}
                  className="p-1.5 rounded-md text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Supprimer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {/* Total row */}
          {assets.length > 1 && (
            <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_160px_160px_auto] gap-4 px-4 py-3 items-center bg-white/5 border-t border-border/50">
              <span className="text-sm font-semibold">Total</span>
              <span className="hidden md:block" />
              <span className="text-sm font-bold text-right tabular-nums">{f(totalValue)}</span>
              <span />
            </div>
          )}
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
