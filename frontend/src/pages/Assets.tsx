import { API } from '../config';
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Home, Car, Watch, Package, Plus, Pencil, Trash2, ChevronDown, X, Eye, EyeOff, SlidersHorizontal,
} from 'lucide-react';

import ConfirmDialog from '../components/ConfirmDialog';
import ScopeSelect from '../components/ScopeSelect';
import { usePreferences } from '../PreferencesContext';
import { useFilter } from '../FilterContext';
import { useApi, useAuthFetch, invalidateApi } from '../useApi';

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
  purchase_price: number | null; notary_fees: number | null; travaux: number | null; purchase_date: string | null;
  current_value: number | null; current_value_date: string | null;
  linked_loan_account_id: number | null; loan_name: string | null; loan_balance: number | null;
  notes: string | null;
  address: string | null; citycode: string | null;
  latitude: number | null; longitude: number | null;
  surface: number | null; property_type: string | null;
  estimated_value: number | null; estimated_price_m2: number | null; estimation_date: string | null;
  property_usage: string | null; monthly_rent: number | null; tenant_name: string | null; kozy_property_id: string | null;
  costs: Cost[]; revenues: Revenue[];
  monthly_costs: number; monthly_revenues: number;
  pnl: number | null; pnl_percent: number | null;
  usage: string | null; company_id: number | null;
}

interface BankAccount { id: number; name: string; custom_name: string | null; type: string; balance: number; }

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export default function Assets() {
  const { t } = useTranslation();
  const authFetch = useAuthFetch();
  const [hideAmounts, setHideAmounts] = useState(() => localStorage.getItem('kompta_hide_amounts') !== 'false');
  const f = (n: number): React.ReactNode => hideAmounts ? <span className="amount-masked">{fmt(n)}</span> : fmt(n);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [form, setForm] = useState({
    type: 'real_estate', name: '', purchase_price: '', notary_fees: '', travaux: '', purchase_date: '',
    current_value: '', linked_loan_account_id: '', notes: '',
    address: '', citycode: '', latitude: 0, longitude: 0,
    surface: '', property_type: 'Appartement',
    estimated_value: null as number | null, estimated_price_m2: null as number | null,
    property_usage: 'principal', monthly_rent: '', tenant_name: '',
    costs: [] as Cost[], revenues: [] as Revenue[],
    usage: 'personal' as string, company_id: '' as string,
  });
  const [addressQuery, setAddressQuery] = useState('');
  const [addressResults, setAddressResults] = useState<{ label: string; citycode: string; lat: number; lon: number }[]>([]);
  const [estimating, setEstimating] = useState(false);
  const { prefs } = usePreferences();
  const { scope, appendScope, companies } = useFilter();

  // Build assets URL with filter + scope params
  const assetsUrl = useMemo(() => {
    let url = `${API}/assets`;
    if (filter) url += `?type=${filter}`;
    if (scope === 'personal') url += (url.includes('?') ? '&' : '?') + 'usage=personal';
    else if (scope === 'pro') url += (url.includes('?') ? '&' : '?') + 'usage=professional';
    else if (typeof scope === 'number') url += (url.includes('?') ? '&' : '?') + `company_id=${scope}`;
    return url;
  }, [filter, scope]);

  const accountsUrl = useMemo(() => appendScope(`${API}/bank/accounts`), [scope, appendScope]);
  const kozyUrl = prefs?.kozy_enabled ? `${API}/kozy/properties` : '';

  const dashboardUrl = useMemo(() => appendScope(`${API}/dashboard`), [scope, appendScope]);

  const { data: assets, refetch: refetchAssets } = useApi<Asset[]>(assetsUrl);
  const { data: accountsRaw } = useApi<BankAccount[]>(accountsUrl);
  const { data: kozyData } = useApi<{ properties: any[] }>(kozyUrl);
  const { data: dashboardData } = useApi<{ totals: { brut: number; net: number } }>(dashboardUrl);

  const assetList = assets || [];
  const accounts = accountsRaw || [];
  const kozyProperties = kozyUrl && kozyData?.properties ? kozyData.properties : [];

  const reload = () => {
    invalidateApi(assetsUrl);
    invalidateApi(accountsUrl);
    refetchAssets();
  };

  const loanAccounts = accounts.filter(a => a.type === 'loan');

  const resetForm = () => {
    setForm({
      type: 'real_estate', name: '', purchase_price: '', notary_fees: '', travaux: '', purchase_date: '',
      current_value: '', linked_loan_account_id: '', notes: '',
      address: '', citycode: '', latitude: 0, longitude: 0,
      surface: '', property_type: 'Appartement',
      estimated_value: null, estimated_price_m2: null,
      property_usage: 'principal', monthly_rent: '', tenant_name: '',
      costs: [], revenues: [],
      usage: 'personal', company_id: '',
    });
    setAddressQuery('');
    setAddressResults([]);
    setAddressSelected(false);
  };

  const [addressSelected, setAddressSelected] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Address search with debounce
  useEffect(() => {
    if (addressQuery.length < 3 || addressSelected) { setAddressResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await authFetch(`${API}/estimation/geocode?q=${encodeURIComponent(addressQuery)}`).then(r => r.json());
        setAddressResults(res);
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [addressQuery, addressSelected]);

  const selectAddress = (addr: { label: string; citycode: string; lat: number; lon: number }) => {
    setForm(f => ({ ...f, address: addr.label, citycode: addr.citycode, latitude: addr.lat, longitude: addr.lon }));
    setAddressQuery(addr.label);
    setAddressSelected(true);
    setAddressResults([]);
    // Auto-estimate if we have surface
    if (form.surface) fetchEstimation(addr.citycode, addr.lat, addr.lon, parseFloat(form.surface), form.property_type);
  };

  const fetchEstimation = async (citycode: string, lat: number, lon: number, surface: number, propertyType: string) => {
    if (!citycode || !surface) return;
    setEstimating(true);
    try {
      const data = await authFetch(`${API}/estimation/price?citycode=${citycode}&lat=${lat}&lon=${lon}&surface=${surface}&type=${encodeURIComponent(propertyType)}`).then(r => r.json());
      if (data.estimation) {
        setForm(f => ({
          ...f,
          estimated_value: data.estimation.estimatedValue,
          estimated_price_m2: data.estimation.pricePerM2,
        }));
      }
    } catch {}
    setEstimating(false);
  };

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
      notary_fees: a.notary_fees ? String(a.notary_fees) : '',
      travaux: a.travaux ? String(a.travaux) : '',
      purchase_date: a.purchase_date || '',
      current_value: a.current_value ? String(a.current_value) : '',
      linked_loan_account_id: a.linked_loan_account_id ? String(a.linked_loan_account_id) : '',
      notes: a.notes || '',
      address: a.address || '', citycode: a.citycode || '',
      latitude: a.latitude || 0, longitude: a.longitude || 0,
      surface: a.surface ? String(a.surface) : '',
      property_type: a.property_type || 'Appartement',
      estimated_value: a.estimated_value, estimated_price_m2: a.estimated_price_m2,
      property_usage: a.property_usage || 'principal',
      monthly_rent: a.monthly_rent ? String(a.monthly_rent) : '',
      tenant_name: a.tenant_name || '',
      costs: a.costs || [],
      revenues: a.revenues || [],
      usage: a.usage || 'personal',
      company_id: a.company_id ? String(a.company_id) : '',
    });
    setAddressQuery(a.address || '');
    setEditingId(a.id);
    setShowForm(true);
  };

  const save = async () => {
    const body = {
      type: form.type, name: form.name,
      purchase_price: form.purchase_price ? parseFloat(form.purchase_price) : null,
      notary_fees: form.notary_fees ? parseFloat(form.notary_fees) : null,
      travaux: form.travaux ? parseFloat(form.travaux) : null,
      purchase_date: form.purchase_date || null,
      current_value: form.current_value ? parseFloat(form.current_value) : null,
      current_value_date: form.current_value ? new Date().toISOString().split('T')[0] : null,
      linked_loan_account_id: form.linked_loan_account_id ? parseInt(form.linked_loan_account_id) : null,
      notes: form.notes || null,
      address: form.address || null, citycode: form.citycode || null,
      latitude: form.latitude || null, longitude: form.longitude || null,
      surface: form.surface ? parseFloat(form.surface) : null,
      property_type: form.property_type || null,
      estimated_value: form.estimated_value || null,
      estimated_price_m2: form.estimated_price_m2 || null,
      property_usage: form.property_usage || 'principal',
      monthly_rent: form.monthly_rent ? parseFloat(form.monthly_rent) : null,
      tenant_name: form.tenant_name || null,
      costs: form.costs.filter(c => c.label && c.amount),
      revenues: form.revenues.filter(r => r.label && r.amount),
      usage: form.usage || 'personal',
      company_id: form.company_id ? parseInt(form.company_id) : null,
    };

    if (editingId) {
      await authFetch(`${API}/assets/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
      await authFetch(`${API}/assets`, { method: 'POST', body: JSON.stringify(body) });
    }
    setShowForm(false);
    resetForm();
    reload();
  };

  const deleteAsset = (id: number) => {
    setConfirmAction({
      message: t('confirm_delete_asset'),
      onConfirm: async () => {
        setConfirmAction(null);
        await authFetch(`${API}/assets/${id}`, { method: 'DELETE' });
        reload();
      },
    });
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
  const totalValue = assetList.reduce((s, a) => s + (a.current_value || a.purchase_price || 0), 0);
  const totalPnl = assetList.reduce((s, a) => s + (a.pnl || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h1 className="text-lg sm:text-xl font-semibold whitespace-nowrap truncate">{t('nav_assets')}</h1>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="hidden md:block"><ScopeSelect /></span>
          {assetList.length > 0 && (
            <button
              onClick={() => setHideAmounts(h => !h)}
              className="text-muted hover:text-white transition-colors p-2"
              title={hideAmounts ? t('show_all_balances') : t('hide_all_balances')}
            >
              {hideAmounts ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
          <button onClick={() => startCreate()} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
            <Plus size={16} /> <span className="hidden sm:inline">{t('add_asset')}</span>
          </button>
        </div>
      </div>
      {assetList.length > 0 ? (
        <p className="text-sm text-muted mb-2">
          {t('total_value')}: <span className="text-accent-400 font-semibold">{f(totalValue)}</span>
          {totalPnl !== 0 && (
            <span className={`ml-2 ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ({totalPnl >= 0 ? '+' : ''}{f(totalPnl)})
            </span>
          )}
          {dashboardData?.totals?.brut && dashboardData.totals.brut > 0 && (
            <span className="ml-2 text-muted">
              — {Math.round((totalValue / dashboardData.totals.brut) * 100)}% du patrimoine
            </span>
          )}
        </p>
      ) : null}

      {/* Mobile: Filtrer ▾ button */}
      <div className="md:hidden mb-3">
        <button
          onClick={() => setMobileFiltersOpen(o => !o)}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
            filter ? 'bg-accent-500/20 text-accent-400' : 'bg-surface text-muted hover:text-white'
          }`}
        >
          <SlidersHorizontal size={16} />
          {t('filters')}
          {filter && <span className="w-2 h-2 rounded-full bg-accent-500" />}
          <span className="text-[10px]">▾</span>
        </button>
        {mobileFiltersOpen && (
          <div className="mt-2 bg-surface rounded-xl border border-border p-3 space-y-3">
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">{t('filter_type')}</label>
              <select
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent-500"
              >
                <option value="">{t('all')}</option>
                {TYPES.map(({ id, labelKey }) => (
                  <option key={id} value={id}>{t(labelKey)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-muted uppercase tracking-wider mb-1 block">{t('scope_all')}</label>
              <ScopeSelect />
            </div>
            {filter && (
              <button
                onClick={() => setFilter('')}
                className="flex items-center gap-1 text-xs text-muted hover:text-white"
              >
                <X size={12} /> {t('clear_filters')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Desktop: Filter pills */}
      <div className="hidden md:flex gap-2 mb-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
        <button onClick={() => setFilter('')}
          className={`px-3 py-2.5 rounded-full text-xs font-medium min-h-[44px] transition-colors whitespace-nowrap flex-shrink-0 ${!filter ? 'bg-accent-500/20 text-accent-400' : 'bg-surface text-muted hover:text-white'}`}>
          {t('all')}
        </button>
        {TYPES.map(({ id, icon: Icon, labelKey }) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 rounded-full text-xs font-medium min-h-[44px] transition-colors whitespace-nowrap flex-shrink-0 ${filter === id ? 'bg-accent-500/20 text-accent-400' : 'bg-surface text-muted hover:text-white'}`}>
            <Icon size={12} /> {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Asset form */}
      {showForm && (
        <div className="bg-surface rounded-xl border border-border p-3.5 mb-3">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-2">
            {editingId ? t('edit_asset') : t('new_asset')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm">
              {TYPES.map(({ id, labelKey }) => <option key={id} value={id}>{t(labelKey)}</option>)}
            </select>
            <input placeholder={t('asset_name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
            <select
              value={form.usage === 'professional' && form.company_id ? form.company_id : form.usage}
              onChange={e => {
                const v = e.target.value;
                if (v === 'personal') setForm(f => ({ ...f, usage: 'personal', company_id: '' }));
                else {
                  const companyId = v;
                  setForm(f => ({ ...f, usage: 'professional', company_id: companyId }));
                }
              }}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="personal">{t('scope_personal')}</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {/* Real estate specific: address + surface + estimation */}
            {form.type === 'real_estate' && (
              <>
                <div className="col-span-full relative">
                  <input placeholder="Adresse du bien..." value={addressQuery}
                    onChange={e => { setAddressQuery(e.target.value); setAddressSelected(false); setForm(f => ({ ...f, address: e.target.value })); }}
                    className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
                  {addressResults.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {addressResults.map((r, i) => (
                        <button key={i} onClick={() => selectAddress(r)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors">
                          {r.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <input placeholder="Surface (m²)" type="number" value={form.surface}
                    onChange={e => {
                      const s = e.target.value;
                      setForm(f => ({ ...f, surface: s }));
                      if (s && form.citycode) fetchEstimation(form.citycode, form.latitude, form.longitude, parseFloat(s), form.property_type);
                    }}
                    className="flex-1 bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
                  <select value={form.property_type}
                    onChange={e => {
                      const pt = e.target.value;
                      setForm(f => ({ ...f, property_type: pt }));
                      if (form.surface && form.citycode) fetchEstimation(form.citycode, form.latitude, form.longitude, parseFloat(form.surface), pt);
                    }}
                    className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm">
                    <option value="Appartement">Appartement</option>
                    <option value="Maison">Maison</option>
                  </select>
                </div>
                {/* Estimation result */}
                {(form.estimated_value || estimating) && (
                  <div className="col-span-full bg-accent-500/10 border border-accent-500/20 rounded-lg p-3">
                    {estimating ? (
                      <p className="text-sm text-muted">Estimation en cours...</p>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-muted">Estimation DVF (prix du marché)</p>
                          <p className="text-lg font-bold text-accent-400">{fmt(form.estimated_value!)}</p>
                          <p className="text-xs text-muted">{form.estimated_price_m2?.toLocaleString('fr-FR')} €/m²</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted">Votre estimation</p>
                          <p className="text-sm font-medium">{form.current_value ? fmt(parseFloat(form.current_value)) : '—'}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            {/* Property usage */}
            {form.type === 'real_estate' && (
              <>
                <div className="col-span-full">
                  <label className="text-xs text-muted mb-1 block">Usage du bien</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'principal', label: '🏠 Résidence', desc: 'J\'y habite' },
                      { id: 'rented_long', label: '🔑 Location', desc: 'Longue durée' },
                      { id: 'rented_short', label: '🏖️ Saisonnier', desc: 'Kozy / Airbnb' },
                      { id: 'vacant', label: '📦 Vacant', desc: 'Inoccupé' },
                    ].map(u => (
                      <button key={u.id} type="button"
                        onClick={() => setForm(f => ({ ...f, property_usage: u.id }))}
                        className={`text-left px-3 py-2 rounded-lg border text-sm transition-all ${form.property_usage === u.id ? 'border-accent-500 bg-accent-500/10 text-white' : 'border-border bg-black/20 text-muted hover:text-white'}`}>
                        <p className="font-medium text-xs">{u.label}</p>
                        <p className="text-[10px] opacity-60">{u.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
                {/* Rent details for long-term rental */}
                {form.property_usage === 'rented_long' && (
                  <div className="col-span-full grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted mb-1 block">Loyer mensuel (€)</label>
                      <input type="number" placeholder="1200" value={form.monthly_rent}
                        onChange={e => setForm(f => ({ ...f, monthly_rent: e.target.value }))}
                        className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-muted mb-1 block">Locataire</label>
                      <input placeholder="Nom du locataire" value={form.tenant_name}
                        onChange={e => setForm(f => ({ ...f, tenant_name: e.target.value }))}
                        className="w-full bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
                    </div>
                  </div>
                )}
                {/* Short-term rental — Kozy link */}
                {form.property_usage === 'rented_short' && (
                  <div className="col-span-full bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                    <p className="text-xs text-blue-400 font-medium">🏖️ Location courte durée</p>
                    <p className="text-xs text-muted mt-1">Connectez Kozy pour synchroniser automatiquement les revenus, le taux d'occupation et le prix moyen/nuit.</p>
                    <p className="text-xs text-muted mt-1">→ Paramètres &gt; Connecter Kozy</p>
                  </div>
                )}
              </>
            )}
            <input placeholder={t('purchase_price')} type="number" value={form.purchase_price}
              onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))}
              className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
            {form.type === 'real_estate' && (
              <input placeholder={t('notary_fees')} type="number" value={form.notary_fees}
                onChange={e => setForm(f => ({ ...f, notary_fees: e.target.value }))}
                className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
            )}
            {form.type === 'real_estate' && (
              <input placeholder="Travaux (€)" type="number" value={form.travaux}
                onChange={e => setForm(f => ({ ...f, travaux: e.target.value }))}
                className="bg-black/30 border border-border rounded-lg px-3 py-2 text-sm" />
            )}
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
                  <option key={a.id} value={a.id}>{a.custom_name || a.name} ({f(a.balance)})</option>
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
      {assetList.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Home className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm">{t('no_assets')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assetList.map(a => {
            const Icon = typeIcon(a.type);
            const expanded = expandedId === a.id;
            const netCashflow = a.monthly_revenues - a.monthly_costs;
            return (
              <div key={a.id} className="bg-surface rounded-xl border border-border overflow-hidden">
                {/* Main card — 3 lines max on mobile, tap to expand */}
                <div className="px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
                  onClick={() => setExpandedId(expanded ? null : a.id)}>
                  {/* Line 1: Name */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-accent-500/10 flex items-center justify-center flex-shrink-0">
                      <Icon size={18} className="text-accent-400" />
                    </div>
                    <p className="text-sm font-medium text-white truncate flex-1 min-w-0">{a.name}</p>
                    <ChevronDown size={14} className={`text-muted flex-shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                  </div>
                  {/* Line 2: Value + PnL */}
                  <div className="ml-11 sm:ml-[52px] mt-1">
                    <span className="text-sm font-semibold text-accent-400">
                      {f(a.current_value || a.purchase_price || 0)}
                    </span>
                    {a.pnl != null && (
                      <span className={`text-xs font-medium ml-2 ${a.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {a.pnl >= 0 ? '+' : ''}{f(a.pnl)} ({fmtPct(a.pnl_percent!)})
                      </span>
                    )}
                  </div>
                  {/* Line 3: Usage badge + rent/loan */}
                  <div className="ml-11 sm:ml-[52px] mt-1 flex items-center gap-1.5 text-xs text-muted">
                    {a.usage === 'professional' && a.company_id ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400">
                        {companies.find(c => c.id === a.company_id)?.name || t('scope_pro')}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-muted">
                        {t('scope_personal')}
                      </span>
                    )}
                    {a.type === 'real_estate' && a.property_usage && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        a.property_usage === 'principal' ? 'bg-blue-500/20 text-blue-400' :
                        a.property_usage === 'rented_long' ? 'bg-green-500/20 text-green-400' :
                        a.property_usage === 'rented_short' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-white/5 text-muted'
                      }`}>
                        {a.property_usage === 'principal' ? '🏠' : a.property_usage === 'rented_long' ? '🔑' : a.property_usage === 'rented_short' ? '🏖️' : '📦'}
                        {a.property_usage === 'rented_long' && a.monthly_rent ? ` ${fmt(a.monthly_rent)}/mois` : ''}
                      </span>
                    )}
                    {a.loan_name && <span className="truncate">🔗 {a.loan_name}</span>}
                    {netCashflow !== 0 && (
                      <span className={`font-medium ${netCashflow >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {netCashflow >= 0 ? '+' : ''}{fmt(netCashflow)}/m
                      </span>
                    )}
                  </div>
                </div>

                {/* Expanded details */}
                {expanded && (
                  <div className="px-4 pb-3 border-t border-border/50 pt-3">
                    {/* Action buttons */}
                    <div className="flex gap-2 mb-3">
                      <button onClick={e => { e.stopPropagation(); startEdit(a); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted hover:text-white bg-white/5 hover:bg-white/10 transition-colors"><Pencil size={12} /> {t('edit')}</button>
                      <button onClick={e => { e.stopPropagation(); deleteAsset(a.id); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted hover:text-red-400 bg-white/5 hover:bg-red-500/10 transition-colors"><Trash2 size={12} /> {t('delete')}</button>
                    </div>
                    {a.purchase_date && <p className="text-xs text-muted mb-2">{t('purchased')} {a.purchase_date}</p>}
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {a.purchase_price != null && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">{t('purchase_price')}</p>
                          <p>{f(a.purchase_price)}</p>
                        </div>
                      )}
                      {a.notary_fees != null && a.notary_fees > 0 && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">{t('notary_fees')}</p>
                          <p>{f(a.notary_fees)}</p>
                        </div>
                      )}
                      {a.travaux != null && a.travaux > 0 && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">Travaux</p>
                          <p>{f(a.travaux)}</p>
                        </div>
                      )}
                      {a.purchase_price != null && ((a.notary_fees && a.notary_fees > 0) || (a.travaux && a.travaux > 0)) && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">Investissement total</p>
                          <p className="font-semibold">{f(a.purchase_price + (a.notary_fees || 0) + (a.travaux || 0))}</p>
                        </div>
                      )}
                      {a.current_value != null && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">{t('current_value')}</p>
                          <p className="text-accent-400 font-semibold">{f(a.current_value)}</p>
                        </div>
                      )}
                      {a.loan_balance != null && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">{t('linked_loan')}</p>
                          <p className="text-red-400">{f(a.loan_balance)}</p>
                        </div>
                      )}
                      {a.pnl != null && (
                        <div>
                          <p className="text-[10px] text-muted uppercase">P&L</p>
                          <p className={a.pnl >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                            {a.pnl >= 0 ? '+' : ''}{f(a.pnl)}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* DVF Estimation vs User value */}
                    {a.estimated_value != null && (
                      <div className="mt-3 bg-accent-500/5 border border-accent-500/20 rounded-lg p-3">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-[10px] text-muted uppercase">Estimation marché (DVF)</p>
                            <p className="text-accent-400 font-semibold">{f(a.estimated_value)}</p>
                            {a.estimated_price_m2 && <p className="text-[10px] text-muted">{a.estimated_price_m2.toLocaleString('fr-FR')} €/m²</p>}
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-muted uppercase">Votre estimation</p>
                            <p className="font-semibold">{a.current_value ? f(a.current_value) : '—'}</p>
                            {a.current_value && a.estimated_value && (
                              <p className={`text-[10px] ${a.current_value > a.estimated_value ? 'text-green-400' : 'text-orange-400'}`}>
                                {a.current_value > a.estimated_value ? '+' : ''}{((a.current_value - a.estimated_value) / a.estimated_value * 100).toFixed(1)}% vs marché
                              </p>
                            )}
                          </div>
                        </div>
                        {a.surface && <p className="text-[10px] text-muted mt-1">{a.surface} m² · {a.property_type} · {a.address}</p>}
                      </div>
                    )}

                    {/* Costs */}
                    {a.costs.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] text-muted uppercase mb-1">{t('monthly_costs')} ({f(a.monthly_costs)}/mois)</p>
                        <div className="space-y-1">
                          {a.costs.map((c, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-muted">{c.label}</span>
                              <span>{f(c.amount)}{c.frequency === 'yearly' ? '/an' : c.frequency === 'one_time' ? '' : '/mois'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Revenues */}
                    {a.revenues.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[10px] text-muted uppercase mb-1">{t('monthly_revenues')} ({f(a.monthly_revenues)}/mois)</p>
                        <div className="space-y-1">
                          {a.revenues.map((r, i) => (
                            <div key={i} className="flex justify-between text-xs">
                              <span className="text-muted">{r.label}</span>
                              <span className="text-green-400">{f(r.amount)}{r.frequency === 'yearly' ? '/an' : '/mois'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Net cashflow (including loan payment) */}
                    {(a.costs.length > 0 || a.revenues.length > 0 || a.loan_balance != null) && (() => {
                      const monthlyCf = a.monthly_revenues - a.monthly_costs;
                      const annualCf = monthlyCf * 12;
                      return (
                        <div className="mt-3 pt-2 border-t border-border/50 space-y-1">
                          <div className="flex justify-between text-sm font-medium">
                            <span>Cashflow mensuel</span>
                            <span className={monthlyCf >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {monthlyCf >= 0 ? '+' : ''}{f(monthlyCf)}/mois
                            </span>
                          </div>
                          <div className="flex justify-between text-sm font-medium">
                            <span>Cashflow annuel</span>
                            <span className={annualCf >= 0 ? 'text-green-400' : 'text-red-400'}>
                              {annualCf >= 0 ? '+' : ''}{f(annualCf)}/an
                            </span>
                          </div>
                          {a.purchase_price != null && annualCf !== 0 && (
                            <div className="flex justify-between text-xs text-muted">
                              <span>Rendement brut</span>
                              <span>{((a.monthly_revenues * 12) / (a.purchase_price + (a.notary_fees || 0) + (a.travaux || 0)) * 100).toFixed(1)}%</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {a.notes && <p className="mt-2 text-xs text-muted italic">{a.notes}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {/* Kozy Properties Section */}
      {prefs?.kozy_enabled && kozyProperties.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            <Home size={14} /> {t('kozy_properties')}
          </h2>
          <div className="space-y-2">
            {kozyProperties.map((p: any, i: number) => (
              <div key={p.id || i} className="bg-surface rounded-xl border border-border px-4 py-3 flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.address && <span className="text-xs text-muted ml-2">{p.address}</span>}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted">
                  {p.revenue != null && (
                    <span className="text-green-400">{t('kozy_revenue')}: {hideAmounts ? <span className="amount-masked">{fmt(p.revenue)}</span> : fmt(p.revenue)}</span>
                  )}
                  {p.occupancy != null && (
                    <span>{t('kozy_occupancy')}: {Math.round(p.occupancy * 100)}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
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
