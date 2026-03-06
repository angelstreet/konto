import { API } from '../config';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Save, Trash2, Calculator, CheckCircle, AlertCircle, FileText, DollarSign, Users, TrendingUp, Plus, X } from 'lucide-react';
import { useAuth } from '@clerk/clerk-react';
import { useAmountVisibility } from '../AmountVisibilityContext';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface FiscalData {
  id: number;
  year: number;
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
  const { getToken } = useAuth();
  return getToken;
}

export default function Fiscal() {
  const { t } = useTranslation();
  const { hideAmounts } = useAmountVisibility();
  const getToken = useAuthToken();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fiscalData, setFiscalData] = useState<FiscalData[]>([]);
  const [eligibilities, setEligibilities] = useState<Eligibility[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear() - 1);
  const [showAddForm, setShowAddForm] = useState(false);
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
      formDataObj.append('year', String(formData.year || selectedYear));

      const res = await apiFetch(`${API}/fiscal/upload`, {
        method: 'POST',
        body: formDataObj as any
      });
      
      if (res.ok) {
        await loadFiscalData();
        alert(t('fiscal_upload_success') || 'Fiscal data extracted successfully');
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to parse PDF');
      }
    } catch (e) {
      console.error('Upload error:', e);
      alert('Failed to upload PDF');
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
        alert(err.error || 'Failed to save');
      }
    } catch (e) {
      console.error('Save error:', e);
    }
    setSaving(false);
  };

  const handleDelete = async (year: number) => {
    if (!confirm(`Delete fiscal data for ${year}?`)) return;
    
    try {
      await apiFetch(`${API}/fiscal/${year}`, { method: 'DELETE' });
      await loadFiscalData();
    } catch (e) {
      console.error('Delete error:', e);
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
        <div>
          <h1 className="text-2xl font-bold">{t('fiscal_title') || 'Fiscalité'}</h1>
          <p className="text-muted text-sm">{t('fiscal_subtitle') || 'Données fiscales et éligibilité aux aides'}</p>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
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
        <div className="flex gap-2 flex-wrap">
          {fiscalData.map(f => (
            <button
              key={f.year}
              onClick={() => setSelectedYear(f.year)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                selectedYear === f.year
                  ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30'
                  : 'bg-surface border border-border hover:bg-surface-hover'
              }`}
            >
              {f.year}
            </button>
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
              <div className="text-2xl font-bold font-mono">{fmt(currentData.revenu_imposable)}</div>
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
                    <div className="w-24 text-right font-mono text-sm">{fmt(currentData.breakdown_salaries)}</div>
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
                    <div className="w-24 text-right font-mono text-sm">{fmt(currentData.breakdown_lmnp)}</div>
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
                    <div className="w-24 text-right font-mono text-sm">{fmt(currentData.breakdown_dividendes)}</div>
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
                    <div className="w-24 text-right font-mono text-sm">{fmt(currentData.breakdown_revenus_fonciers)}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-surface border border-border rounded-xl p-4">
            <h3 className="font-medium mb-4">{t('eligibility_check') || 'Éligibilité aux aides'}</h3>
            {eligibilities.length === 0 ? (
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
    </div>
  );
}
