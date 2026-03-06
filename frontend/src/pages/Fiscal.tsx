import { API } from '../config';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Save, Trash2, Calculator, CheckCircle, AlertCircle, FileText, DollarSign, Users, TrendingUp, Plus, X } from 'lucide-react';
import EyeToggle from '../components/EyeToggle';
import { useAuth } from '@clerk/clerk-react';
import { useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import ConfirmDialog from '../components/ConfirmDialog';
import AlertDialog from '../components/AlertDialog';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface FiscalData {
  id: number;
  year: number;
  fiscal_residency: string | null;  // FR, CH-ZH, CH-VD, etc.
  revenu_brut_global: number | null;
  revenu_imposable: number | null;
  parts_fiscales: number;
  taux_marginal: number | null;
  taux_moyen: number | null;
  breakdown_salaries: number | null;
  breakdown_lmnp: number | null;
  breakdown_dividendes: number | null;
  breakdown_revenus_fonciers: number | null;
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
  const authFetch = useAuthFetch();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const getToken = useAuthToken();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fiscalData, setFiscalData] = useState<FiscalData[]>([]);
  const [eligibilities, setEligibilities] = useState<Eligibility[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear() - 1);
  const [showAddForm, setShowAddForm] = useState(false);
  const [alertDialog, setAlertDialog] = useState<{open: boolean; title: string; message: string; variant: 'success' | 'error' | 'info'}>({open: false, title: '', message: '', variant: 'info'});
  const [confirmDialog, setConfirmDialog] = useState<{open: boolean; year: number | null}>({open: false, year: null});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<{
    year: number | string;
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
      
      const eligRes = await apiFetch(`${API}/fiscal/eligibilities`);
      const eligData = await eligRes.json();
      setEligibilities(eligData.eligibilities || []);
      
      if (data.fiscalData && data.fiscalData.length > 0) {
        setSelectedYear(data.fiscalData[0].year);
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
        await loadFiscalData();
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

  const handleDelete = async (year: number) => {
    setConfirmDialog({ open: true, year });
  };

  const confirmDelete = async () => {
    const year = confirmDialog.year;
    setConfirmDialog({ open: false, year: null });
    if (!year) return;
    
    try {
      await apiFetch(`${API}/fiscal/${year}`, { method: 'DELETE' });
      await loadFiscalData();
    } catch (e) {
      console.error('Delete error:', e);
      setAlertDialog({ open: true, title: t('error'), message: 'Failed to delete fiscal data', variant: 'error' });
    }
  };

  const resetForm = () => {
    setFormData({
      year: new Date().getFullYear() - 1,
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

  const currentData = fiscalData.find(f => f.year === selectedYear);

  const fmt = (v: number | null | undefined): string => {
    if (v == null) return '—';
    if (hideAmounts) return '••••';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
  };

  const fmtPct = (v: number | null | undefined): string => {
    if (v == null) return '—';
    return `${v}%`;
  };

  const breakdownTotal = currentData ? 
    (currentData.breakdown_salaries || 0) + 
    (currentData.breakdown_lmnp || 0) + 
    (currentData.breakdown_dividendes || 0) + 
    (currentData.breakdown_revenus_fonciers || 0) : 0;

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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {fiscalData.map(f => (
            <div key={f.year} className="relative">
              <button
                onClick={() => setSelectedYear(f.year)}
                className={`w-full px-4 py-3 rounded-xl font-medium transition-all ${
                  selectedYear === f.year
                    ? 'bg-accent-500/20 text-accent-400 border-2 border-accent-500/50'
                    : 'bg-surface border border-border hover:bg-surface-hover'
                }`}
              >
                <div className="text-lg">{f.year}</div>
                <div className="text-2xl mt-1">
                  {f.fiscal_residency === 'FR' ? '🇫🇷' : 
                   f.fiscal_residency?.startsWith('CH') ? '🇨🇭' :
                   f.fiscal_residency === 'BE' ? '🇧🇪' :
                   f.fiscal_residency === 'DE' ? '🇩🇪' : '🌍'}
                </div>
              </button>
              <select
                value={f.fiscal_residency || 'FR'}
                onChange={async (e) => {
                  const newResidency = e.target.value;
                  await authFetch(`${API}/fiscal/${f.year}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ fiscal_residency: newResidency }),
                  });
                  setFiscalData(prev => prev.map(item => item.year === f.year ? { ...item, fiscal_residency: newResidency } : item));
                }}
                className="absolute bottom-1 right-1 w-6 h-4 opacity-0 cursor-pointer"
                title="Changer la résidence"
              >
                <option value="FR">🇫🇷</option>
                <option value="CH-ZH">🇨🇭</option>
                <option value="CH-VD">🇨🇭</option>
                <option value="CH-GE">🇨🇭</option>
                <option value="CH-BE">🇨🇭</option>
                <option value="CH-OTHER">🇨🇭</option>
                <option value="BE">🇧🇪</option>
                <option value="DE">🇩🇪</option>
                <option value="OTHER">🌍</option>
              </select>
            </div>
          ))}
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
                <Users size={14} />
                {t('parts_fiscales') || 'Parts fiscales'}
              </div>
              <div className="text-2xl font-bold font-mono">{currentData.parts_fiscales}</div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted text-sm mb-1">
                <TrendingUp size={14} />
                {t('tmi') || 'Taux marginal'}
              </div>
              <div className="text-2xl font-bold font-mono text-orange-400">{fmtPct(currentData.taux_marginal)}</div>
            </div>
            <div className="bg-surface border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 text-muted text-sm mb-1">
                <Calculator size={14} />
                {t('taux_moyen') || 'Taux moyen'}
              </div>
              <div className="text-2xl font-bold font-mono text-blue-400">{fmtPct(currentData.taux_moyen)}</div>
            </div>
          </div>

          {breakdownTotal > 0 && (
            <div className="bg-surface border border-border rounded-xl p-4">
              <h3 className="font-medium mb-4">{t('income_breakdown') || 'Répartition des revenus'}</h3>
              <div className="space-y-3">
                {currentData.breakdown_salaries != null && currentData.breakdown_salaries > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted">{t('salaries') || 'Salaires'}</div>
                    <div className="flex-1 h-6 bg-background rounded overflow-hidden">
                      <div
                        className="h-full bg-green-500"
                        style={{ width: `${(currentData.breakdown_salaries / breakdownTotal) * 100}%` }}
                      />
                    </div>
                    <div className="w-24 text-right font-mono text-sm">{mask(fmt(currentData.breakdown_salaries))}</div>
                  </div>
                )}
                {currentData.breakdown_lmnp != null && currentData.breakdown_lmnp > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted">{t('lmnp') || 'LMNP'}</div>
                    <div className="flex-1 h-6 bg-background rounded overflow-hidden">
                      <div
                        className="h-full bg-purple-500"
                        style={{ width: `${(currentData.breakdown_lmnp / breakdownTotal) * 100}%` }}
                      />
                    </div>
                    <div className="w-24 text-right font-mono text-sm">{mask(fmt(currentData.breakdown_lmnp))}</div>
                  </div>
                )}
                {currentData.breakdown_dividendes != null && currentData.breakdown_dividendes > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted">{t('dividendes') || 'Dividendes'}</div>
                    <div className="flex-1 h-6 bg-background rounded overflow-hidden">
                      <div
                        className="h-full bg-yellow-500"
                        style={{ width: `${(currentData.breakdown_dividendes / breakdownTotal) * 100}%` }}
                      />
                    </div>
                    <div className="w-24 text-right font-mono text-sm">{mask(fmt(currentData.breakdown_dividendes))}</div>
                  </div>
                )}
                {currentData.breakdown_revenus_fonciers != null && currentData.breakdown_revenus_fonciers > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="w-24 text-sm text-muted">{t('revenus_fonciers') || 'Revenus fonciers'}</div>
                    <div className="flex-1 h-6 bg-background rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${(currentData.breakdown_revenus_fonciers / breakdownTotal) * 100}%` }}
                      />
                    </div>
                    <div className="w-24 text-right font-mono text-sm">{mask(fmt(currentData.breakdown_revenus_fonciers))}</div>
                  </div>
                )}
              </div>
            </div>
          )}

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
              onClick={() => handleDelete(currentData.year)}
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
        title={t('confirm_delete') || 'Confirmer la suppression'}
        message={confirmDialog.year ? `Delete fiscal data for ${confirmDialog.year}?` : ''}
        confirmLabel={t('delete') || 'Supprimer'}
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDialog({ open: false, year: null })}
      />
    </div>
  );
}
