import { API } from '../config';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Save, Trash2, Calculator, CheckCircle, AlertCircle, FileText, DollarSign, Users, TrendingUp, Plus, X } from 'lucide-react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import EyeToggle from '../components/EyeToggle';
import { useAuth } from '@clerk/clerk-react';
import { useAmountVisibility } from '../AmountVisibilityContext';
import ConfirmDialog from '../components/ConfirmDialog';
import AlertDialog from '../components/AlertDialog';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface FiscalData {
  id: number;
  year: number;
  fiscal_residency: string | null;
  revenu_brut_global: number | null;
  revenu_imposable: number | null;
  parts_fiscales: number;
  taux_marginal: number | null;
  taux_moyen: number | null;
  breakdown_salaries: number | null;
  breakdown_lmnp: number | null;
  breakdown_dividendes: number | null;
  breakdown_revenus_fonciers: number | null;
  deductions: number | null;
  cantonal_tax: number | null;
  federal_tax: number | null;
  total_imposition: number | null;
  created_at: string;
  updated_at: string;
}

interface Eligibility {
  name: string;
  description: string;
  eligible: boolean;
  estimatedAmount: number | null;
  frequency: string;
  conditions: string;
}

function useAuthToken() {
  let getToken: (() => Promise<string | null>) | undefined;
  if (clerkEnabled) {
    try {
      const auth = useAuth();
      getToken = auth.getToken;
    } catch {}
  }
  return getToken;
}

export default function Fiscal() {
  const { t } = useTranslation();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const getToken = useAuthToken();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fiscalData, setFiscalData] = useState<FiscalData[]>([]);
  const [eligibilities, setEligibilities] = useState<Eligibility[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [alertDialog, setAlertDialog] = useState<{open: boolean; title: string; message: string; variant: 'success' | 'error' | 'info'}>({open: false, title: '', message: '', variant: 'info'});
  const [confirmDialog, setConfirmDialog] = useState<{open: boolean; id: number | null}>({open: false, id: null});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<{
    year: number | string;
    fiscalResidency: string;
    revenuBrutGlobal: string;
    revenuImposable: string;
    partsFiscales: string;
    tauxMarginal: string;
    tauxMoyen: string;
    breakdownSalaries: string;
    breakdownLmnp: string;
    breakdownDividendes: string;
    breakdownRevenusFonciers: string;
  }>({
    year: new Date().getFullYear() - 1,
    fiscalResidency: 'FR',
    revenuBrutGlobal: '',
    revenuImposable: '',
    partsFiscales: '1',
    tauxMarginal: '',
    tauxMoyen: '',
    breakdownSalaries: '',
    breakdownLmnp: '',
    breakdownDividendes: '',
    breakdownRevenusFonciers: ''
  });

  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;

  const apiFetch = async (url: string, opts?: RequestInit) => {
    const headers: Record<string, string> = { ...(opts?.headers as Record<string, string> || {}) };
    if (clerkEnabled && getToken) {
      const token = await getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(url, { ...opts, headers });
  };

  useEffect(() => {
    loadFiscalData();
  }, []);

  const loadFiscalData = async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API}/fiscal`);
      const data = await res.json();
      setFiscalData(data.fiscalData || []);
      
      const eligRes = await apiFetch(`${API}/fiscal/eligibilities${selectedId ? `?id=${selectedId}` : ''}`);
      const eligData = await eligRes.json();
      setEligibilities(eligData.eligibilities || []);
      
      if (data.fiscalData && data.fiscalData.length > 0) {
        setSelectedId(prev => prev ?? data.fiscalData[0].id);
      }
    } catch (e) {
      console.error('Failed to load fiscal data:', e);
    }
    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formDataObj = new FormData();
      formDataObj.append('file', file);
      // Year is auto-detected from PDF

      const res = await apiFetch(`${API}/fiscal/upload`, {
        method: 'POST',
        body: formDataObj as any
      });
      
      if (res.ok) {
        const data = await res.json();
        await loadFiscalData();
        // No popup needed - data will show directly on page
        if (!data.fiscalData?.revenu_imposable && !data.fiscalData?.revenu_brut_global) {
          setAlertDialog({ open: true, title: t('warning'), message: t('fiscal_upload_partial') || 'PDF uploaded but some data could not be extracted. You can edit manually.', variant: 'info' });
        }
      } else {
        const err = await res.json();
        setAlertDialog({ open: true, title: t('error'), message: err.error || 'Failed to parse PDF', variant: 'error' });
      }
    } catch (e) {
      console.error('Upload error:', e);
      setAlertDialog({ open: true, title: t('error'), message: 'Failed to upload PDF', variant: 'error' });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const payload = {
        year: parseInt(formData.year as any),
        fiscalResidency: formData.fiscalResidency || 'FR',
        revenuBrutGlobal: formData.revenuBrutGlobal ? parseFloat(formData.revenuBrutGlobal) : null,
        revenuImposable: formData.revenuImposable ? parseFloat(formData.revenuImposable) : null,
        partsFiscales: parseFloat(formData.partsFiscales) || 1,
        tauxMarginal: formData.tauxMarginal ? parseFloat(formData.tauxMarginal) : null,
        tauxMoyen: formData.tauxMoyen ? parseFloat(formData.tauxMoyen) : null,
        breakdown: {
          salaries: formData.breakdownSalaries ? parseFloat(formData.breakdownSalaries) : null,
          lmnp: formData.breakdownLmnp ? parseFloat(formData.breakdownLmnp) : null,
          dividendes: formData.breakdownDividendes ? parseFloat(formData.breakdownDividendes) : null,
          revenusFonciers: formData.breakdownRevenusFonciers ? parseFloat(formData.breakdownRevenusFonciers) : null
        }
      };

      const res = await apiFetch(`${API}/fiscal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const saved = await res.json();
        await loadFiscalData();
        if (saved.fiscalData?.id) setSelectedId(saved.fiscalData.id);
        setShowAddForm(false);
        resetForm();
      } else {
        const err = await res.json();
        setAlertDialog({ open: true, title: t('error'), message: err.error || 'Failed to save', variant: 'error' });
      }
    } catch (e) {
      console.error('Save error:', e);
    }
    setSaving(false);
  };

  const handleDelete = (id: number) => {
    setConfirmDialog({ open: true, id });
  };

  const confirmDelete = async () => {
    const id = confirmDialog.id;
    setConfirmDialog({ open: false, id: null });
    if (!id) return;
    try {
      await apiFetch(`${API}/fiscal/${id}`, { method: 'DELETE' });
      setFiscalData(prev => prev.filter(f => f.id !== id));
      setSelectedId(prev => prev === id ? null : prev);
    } catch (e) {
      console.error('Delete error:', e);
      setAlertDialog({ open: true, title: t('error'), message: 'Failed to delete fiscal data', variant: 'error' });
    }
  };

  const resetForm = () => {
    setFormData({
      year: new Date().getFullYear() - 1,
      fiscalResidency: 'FR',
      revenuBrutGlobal: '',
      revenuImposable: '',
      partsFiscales: '1',
      tauxMarginal: '',
      tauxMoyen: '',
      breakdownSalaries: '',
      breakdownLmnp: '',
      breakdownDividendes: '',
      breakdownRevenusFonciers: ''
    });
  };

  const currentData = fiscalData.find(f => f.id === selectedId) ?? fiscalData[0] ?? null;

  const isCH = currentData?.fiscal_residency?.startsWith('CH') ?? false;
  const currency = isCH ? 'CHF' : 'EUR';
  const locale = isCH ? 'de-CH' : 'fr-FR';

  const fmt = (v: number | null | undefined): string => {
    if (v == null) return '—';
    if (hideAmounts) return '••••';
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
  };

  const fmtPct = (v: number | null | undefined): string => {
    if (v == null) return '—';
    return `${v}%`;
  };

  const rawBreakdown = currentData ? [
    { key: 'salaries', label: t('salaries') || 'Salaires', value: currentData.breakdown_salaries || 0, color: '#22c55e' },
    { key: 'lmnp', label: t('lmnp') || 'LMNP', value: currentData.breakdown_lmnp || 0, color: '#a855f7' },
    { key: 'dividendes', label: t('dividendes') || 'Dividendes', value: currentData.breakdown_dividendes || 0, color: '#eab308' },
    { key: 'revenus_fonciers', label: t('revenus_fonciers') || 'Revenus fonciers', value: currentData.breakdown_revenus_fonciers || 0, color: '#3b82f6' },
  ].filter(d => d.value > 0) : [];

  // If no breakdown, default to salary = revenu_imposable
  const breakdownData = rawBreakdown.length > 0
    ? rawBreakdown
    : currentData && (currentData.revenu_imposable || currentData.revenu_brut_global)
      ? [{ key: 'salaries', label: t('salaries') || 'Salaires', value: currentData.revenu_imposable || currentData.revenu_brut_global || 0, color: '#22c55e' }]
      : [];

  const breakdownTotal = breakdownData.reduce((sum, d) => sum + d.value, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-muted">{t('loading') || 'Loading...'}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{t('fiscal_title') || 'Fiscalité'}</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-black font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            <Upload size={18} />
            {uploading ? t('uploading') || '...' : t('upload_avis') || 'Importer PDF'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={handleFileUpload}
          />
          <button
            onClick={() => { resetForm(); setShowAddForm(true); }}
            className="flex items-center gap-2 px-4 py-2 border border-border hover:bg-surface-hover rounded-lg transition-colors"
          >
            <Plus size={18} />
            {t('manual_entry') || 'Saisie manuelle'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddForm(false)} />
          <div className="relative bg-surface border border-border rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-bold">{t('fiscal_data_entry') || 'Saisie des données fiscales'}</h2>
              <button onClick={() => setShowAddForm(false)} className="p-1 hover:bg-surface-hover rounded">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleManualSubmit} className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('tax_year') || 'Année fiscale'} *</label>
                  <input
                    type="number"
                    value={formData.year}
                    onChange={e => setFormData({ ...formData, year: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Pays *</label>
                  <select
                    value={formData.fiscalResidency}
                    onChange={e => setFormData({ ...formData, fiscalResidency: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                  >
                    <option value="FR">🇫🇷 France</option>
                    <option value="CH">🇨🇭 Suisse</option>
                    <option value="BE">🇧🇪 Belgique</option>
                    <option value="DE">🇩🇪 Allemagne</option>
                    <option value="OTHER">🌍 Autre</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('revenu_brut_global') || 'Revenu brut global'}</label>
                  <input
                    type="number"
                    value={formData.revenuBrutGlobal}
                    onChange={e => setFormData({ ...formData, revenuBrutGlobal: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('revenu_imposable') || 'Revenu imposable'} *</label>
                  <input
                    type="number"
                    value={formData.revenuImposable}
                    onChange={e => setFormData({ ...formData, revenuImposable: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">{t('parts_fiscales') || 'Parts fiscales'} *</label>
                  <input
                    type="number"
                    step="0.5"
                    value={formData.partsFiscales}
                    onChange={e => setFormData({ ...formData, partsFiscales: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('tmi') || 'TMI (%)'}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.tauxMarginal}
                    onChange={e => setFormData({ ...formData, tauxMarginal: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    placeholder="11"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">{t('taux_moyen') || 'Taux moyen (%)'}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.tauxMoyen}
                    onChange={e => setFormData({ ...formData, tauxMoyen: e.target.value })}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg"
                    placeholder="3.5"
                  />
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <p className="text-sm font-medium mb-2">{t('breakdown') || 'Répartition des revenus'}</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-muted mb-1">{t('salaries') || 'Salaires'}</label>
                    <input
                      type="number"
                      value={formData.breakdownSalaries}
                      onChange={e => setFormData({ ...formData, breakdownSalaries: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">{t('lmnp') || 'LMNP'}</label>
                    <input
                      type="number"
                      value={formData.breakdownLmnp}
                      onChange={e => setFormData({ ...formData, breakdownLmnp: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">{t('dividendes') || 'Dividendes'}</label>
                    <input
                      type="number"
                      value={formData.breakdownDividendes}
                      onChange={e => setFormData({ ...formData, breakdownDividendes: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1">{t('revenus_fonciers') || 'Revenus fonciers'}</label>
                    <input
                      type="number"
                      value={formData.breakdownRevenusFonciers}
                      onChange={e => setFormData({ ...formData, breakdownRevenusFonciers: e.target.value })}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border border-border hover:bg-surface-hover rounded-lg"
                >
                  {t('cancel') || 'Annuler'}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-black font-medium rounded-lg disabled:opacity-50"
                >
                  <Save size={18} />
                  {saving ? t('saving') || '...' : t('save') || 'Enregistrer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {fiscalData.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fiscalData.map(f => {
            const flag = f.fiscal_residency === 'FR' ? '🇫🇷'
              : f.fiscal_residency?.startsWith('CH') ? '🇨🇭'
              : f.fiscal_residency === 'BE' ? '🇧🇪'
              : f.fiscal_residency === 'DE' ? '🇩🇪' : '🌍';
            const isActive = selectedId === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-accent-500 text-white'
                    : 'bg-surface border border-border hover:bg-surface-hover text-muted hover:text-white'
                }`}
              >
                <span>{f.year}</span>
                <span>{flag}</span>
              </button>
            );
          })}
        </div>
      )}

      {fiscalData.length === 0 ? (
        <div className="text-center py-12 text-muted">
          <FileText size={48} className="mx-auto mb-4 opacity-30" />
          <p>{t('no_fiscal_data') || 'Aucune donnée fiscale'}</p>
          <p className="text-sm">{t('add_fiscal_data') || 'Importez un avis d\'imposition ou saisissez vos données manuellement'}</p>
        </div>
      ) : currentData ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted text-sm mb-1">
                <DollarSign size={14} />
                {t('revenu_imposable') || 'Revenu imposable'}
              </div>
              <div className="text-2xl font-bold font-mono">{mask(fmt(currentData.revenu_imposable))}</div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted text-sm mb-1">
                <Calculator size={14} />
                Impôts à payer
              </div>
              <div className="text-2xl font-bold font-mono text-red-400">
                {isCH
                  ? mask(fmt((currentData.cantonal_tax || 0) + (currentData.federal_tax || 0)))
                  : currentData.total_imposition != null
                    ? mask(fmt(currentData.total_imposition))
                    : currentData.taux_moyen && currentData.revenu_imposable
                      ? mask(fmt(Math.round(currentData.taux_moyen / 100 * currentData.revenu_imposable)))
                      : mask(fmt(0))}
              </div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted text-sm mb-1">
                <TrendingUp size={14} />
                {isCH ? 'Taux effectif' : currentData.taux_marginal != null ? (t('tmi') || 'Taux marginal') : 'Taux moyen'}
              </div>
              <div className="text-2xl font-bold font-mono text-orange-400">
                {isCH && currentData.revenu_imposable && ((currentData.cantonal_tax || 0) + (currentData.federal_tax || 0)) > 0
                  ? `${(((currentData.cantonal_tax || 0) + (currentData.federal_tax || 0)) / currentData.revenu_imposable * 100).toFixed(1)}%`
                  : fmtPct(currentData.taux_marginal ?? currentData.taux_moyen)}
              </div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted text-sm mb-1">
                <Users size={14} />
                {isCH ? 'Revenu brut' : (t('parts_fiscales') || 'Parts fiscales')}
              </div>
              <div className="text-2xl font-bold font-mono">
                {isCH ? mask(fmt(currentData.revenu_brut_global)) : String(currentData.parts_fiscales)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left — Répartition des revenus */}
            <div className="bg-surface border border-border rounded-xl p-4">
              <h3 className="font-medium mb-4">{t('income_breakdown') || 'Répartition des revenus'}</h3>
              {breakdownTotal > 0 ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-full h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={breakdownData}
                          dataKey="value"
                          nameKey="key"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={75}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {breakdownData.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: any, name: any) => [hideAmounts ? '••••' : fmt(value as number), breakdownData.find(d => d.key === name)?.label || name]}
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1f2937', borderRadius: 12, fontSize: 12, color: '#e5e7eb' }}
                          itemStyle={{ color: '#e5e7eb' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full space-y-2">
                    {breakdownData.map((d) => {
                      const pct = breakdownTotal > 0 ? (d.value / breakdownTotal) * 100 : 0;
                      return (
                        <div key={d.key} className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                            <span className="text-muted">{d.label}</span>
                          </div>
                          <div className="flex items-center gap-3 font-mono">
                            <span className="text-muted">{pct.toFixed(1)}%</span>
                            <span>{mask(fmt(d.value))}</span>
                          </div>
                        </div>
                      );
                    })}
                    <div className="pt-2 mt-2 border-t border-border flex items-center justify-between text-sm font-medium">
                      <span className="text-muted">Total</span>
                      <span className="font-mono">{mask(fmt(breakdownTotal))}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-40 text-muted text-sm">
                  Aucune répartition disponible
                </div>
              )}
            </div>

            {/* Right — Synthèse fiscale */}
            <div className="bg-surface border border-border rounded-xl p-4">
              <h3 className="font-medium mb-4">{isCH ? '🇨🇭 Synthèse fiscale' : '🇫🇷 Synthèse fiscale'}</h3>
              <div className="divide-y divide-border text-sm">
                {([
                  currentData.revenu_brut_global != null ? { label: 'Revenu brut global', value: fmt(currentData.revenu_brut_global) } : null,
                  isCH && currentData.deductions != null ? { label: 'Déductions', value: fmt(currentData.deductions), dim: true } : null,
                  currentData.revenu_imposable != null ? { label: 'Revenu imposable', value: fmt(currentData.revenu_imposable) } : null,
                  !isCH ? { label: 'Parts fiscales', value: String(currentData.parts_fiscales) } : null,
                  isCH && currentData.cantonal_tax != null ? { label: 'Impôt cantonal', value: fmt(currentData.cantonal_tax), accent: 'orange' } : null,
                  isCH && currentData.federal_tax != null ? { label: 'Impôt fédéral', value: fmt(currentData.federal_tax), accent: 'blue' } : null,
                  !isCH && currentData.taux_marginal != null ? { label: 'Taux marginal (TMI)', value: fmtPct(currentData.taux_marginal), accent: 'orange' } : null,
                  !isCH && currentData.taux_moyen != null ? { label: 'Taux moyen', value: fmtPct(currentData.taux_moyen), accent: 'blue' } : null,
                  (isCH ? (currentData.cantonal_tax || 0) + (currentData.federal_tax || 0) > 0 : !!(currentData.total_imposition != null || (currentData.taux_moyen && currentData.revenu_imposable))) ? {
                    label: 'Total impôts',
                    value: isCH
                      ? fmt((currentData.cantonal_tax || 0) + (currentData.federal_tax || 0))
                      : currentData.total_imposition != null
                        ? fmt(currentData.total_imposition)
                        : fmt(Math.round(currentData.taux_moyen! / 100 * currentData.revenu_imposable!)),
                    bold: true,
                  } : null,
                  (isCH
                    ? !!(currentData.revenu_imposable && (currentData.cantonal_tax || 0) + (currentData.federal_tax || 0) > 0)
                    : currentData.taux_moyen != null
                  ) ? {
                    label: 'Taux effectif',
                    value: isCH
                      ? `${(((currentData.cantonal_tax || 0) + (currentData.federal_tax || 0)) / currentData.revenu_imposable! * 100).toFixed(1)}%`
                      : fmtPct(currentData.taux_moyen),
                    accent: 'blue',
                  } : null,
                ] as any[]).filter(Boolean).map((row: any, i: number) => (
                  <div key={i} className="flex justify-between items-center py-2.5">
                    <span className={row.dim ? 'text-muted' : 'text-foreground'}>{row.label}</span>
                    <span className={`font-mono ${row.bold ? 'font-bold text-base' : ''} ${row.accent === 'orange' ? 'text-orange-400' : row.accent === 'blue' ? 'text-blue-400' : ''}`}>
                      {['Revenu', 'Total', 'Déductions', 'Impôt'].some(k => row.label.startsWith(k)) ? mask(row.value) : row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-4">
            <h3 className="font-medium mb-4">{t('eligibility_check') || 'Éligibilité aux aides'}</h3>
            {currentData?.fiscal_residency && !currentData.fiscal_residency.startsWith('FR') ? (
              <div className="text-muted text-sm bg-surface-2 rounded-lg p-4">
                <AlertCircle size={16} className="inline mr-2" />
                Les aides françaises (Prime d'activité, APL, France Rénov') ne sont disponibles que pour les résidents fiscaux français.
                <br />
                <span className="text-xs opacity-70">Résidence actuelle: {currentData.fiscal_residency}</span>
              </div>
            ) : eligibilities.length === 0 ? (
              <p className="text-muted text-sm">{t('no_eligibilities') || 'Aucune aide disponible pour votre situation'}</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {eligibilities.map((elig, idx) => (
                  <div
                    key={idx}
                    className={`border rounded-lg p-4 ${
                      elig.eligible
                        ? 'border-green-500/30 bg-green-500/5'
                        : 'border-red-500/30 bg-red-500/5'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {elig.eligible ? (
                        <CheckCircle size={20} className="text-green-400 flex-shrink-0" />
                      ) : (
                        <AlertCircle size={20} className="text-red-400 flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{elig.name}</div>
                        <div className="text-sm text-muted mt-1">{elig.description}</div>
                        {elig.eligible && elig.estimatedAmount ? (
                          <div className="mt-2 text-lg font-bold text-green-400">
                            ~{fmt(elig.estimatedAmount)}/{elig.frequency === 'monthly' ? 'mo' : 'one-time'}
                          </div>
                        ) : null}
                        <div className="mt-2 text-xs text-muted">{elig.conditions}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => handleDelete(currentData.id)}
              className="flex items-center gap-2 px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
              {t('delete_data') || 'Supprimer'}
            </button>
          </div>
        </>
      ) : null}

      <AlertDialog
        open={alertDialog.open}
        title={alertDialog.title}
        message={alertDialog.message}
        variant={alertDialog.variant}
        onClose={() => setAlertDialog(prev => ({ ...prev, open: false }))}
      />

      <ConfirmDialog
        open={confirmDialog.open}
        title={t('confirm_delete')}
        message={confirmDialog.id ? t('confirm_delete_fiscal') : ''}
        confirmLabel={t('delete') || 'Supprimer'}
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDialog({ open: false, id: null })}
      />
    </div>
  );
}
