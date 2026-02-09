import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, ChevronDown } from 'lucide-react';
import { API } from '../config';
import { useAuthFetch } from '../useApi';

interface TaxResult {
  gross_annual: number;
  tax: number;
  netIncome: number;
  effectiveRate: number;
  brackets: { rate: number; amount: number }[];
  country: string;
  parts: number;
}

function fmt(v: number, currency = 'EUR') {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}
function fmtCHF(v: number) { return fmt(v, 'CHF'); }

export default function TaxEstimation({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const authFetch = useAuthFetch();

  const [taxInput, setTaxInput] = useState({ gross_annual: '', country: 'FR', canton: 'ZH', situation: 'single', children: 0 });
  const [taxResult, setTaxResult] = useState<TaxResult | null>(null);
  const [taxOpen, setTaxOpen] = useState(defaultOpen);

  const cantons = ['ZH', 'GE', 'VD', 'BE', 'BS', 'LU', 'AG', 'SG', 'TI', 'VS'];
  const isCHF = taxInput.country === 'CH';
  const fmtTax = isCHF ? fmtCHF : fmt;

  const estimateTax = async () => {
    const body = { ...taxInput, gross_annual: parseFloat(taxInput.gross_annual) || 0 };
    if (!body.gross_annual) return;
    const res = await authFetch(`${API}/tax/estimate`, { method: 'POST', body: JSON.stringify(body) });
    setTaxResult(await res.json());
  };

  return (
    <section className="bg-surface rounded-xl border border-border p-4 space-y-2.5">
      <h2 className="text-lg font-semibold flex items-center gap-2 cursor-pointer select-none" onClick={() => setTaxOpen(!taxOpen)}>
        <Calculator size={20} /> {t('tax_estimation')}
        <ChevronDown size={16} className={`text-muted transition-transform ${taxOpen ? '' : '-rotate-90'}`} />
      </h2>

      {taxOpen && (<>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">{t('gross_annual')}</label>
            <input type="number" value={taxInput.gross_annual} onChange={e => setTaxInput({ ...taxInput, gross_annual: e.target.value })}
              placeholder="55000" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('country')}</label>
            <select value={taxInput.country} onChange={e => setTaxInput({ ...taxInput, country: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
              <option value="FR">🇫🇷 France</option>
              <option value="CH">🇨🇭 Suisse</option>
            </select>
          </div>
          {taxInput.country === 'CH' && (
            <div>
              <label className="text-xs text-muted mb-1 block">{t('canton')}</label>
              <select value={taxInput.canton} onChange={e => setTaxInput({ ...taxInput, canton: e.target.value })}
                className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
                {cantons.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-muted mb-1 block">{t('situation')}</label>
            <select value={taxInput.situation} onChange={e => setTaxInput({ ...taxInput, situation: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm">
              <option value="single">{t('single')}</option>
              <option value="married">{t('married')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('children')}</label>
            <input type="number" min={0} max={10} value={taxInput.children} onChange={e => setTaxInput({ ...taxInput, children: parseInt(e.target.value) || 0 })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <button onClick={estimateTax}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg text-sm font-medium hover:bg-accent-600 transition-colors">
          {t('estimate')}
        </button>

        {taxResult && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
            <div className="bg-background rounded-lg p-2.5 text-center">
              <p className="text-xs text-muted mb-1">{t('gross_annual')}</p>
              <p className="text-lg font-bold text-white">{fmtTax(taxResult.gross_annual)}</p>
            </div>
            <div className="bg-background rounded-lg p-2.5 text-center">
              <p className="text-xs text-muted mb-1">{t('estimated_tax')}</p>
              <p className="text-lg font-bold text-red-400">{fmtTax(taxResult.tax)}</p>
            </div>
            <div className="bg-background rounded-lg p-2.5 text-center">
              <p className="text-xs text-muted mb-1">{t('net_income')}</p>
              <p className="text-lg font-bold text-green-400">{fmtTax(taxResult.netIncome)}</p>
            </div>
            <div className="bg-background rounded-lg p-2.5 text-center">
              <p className="text-xs text-muted mb-1">{t('effective_rate')}</p>
              <p className="text-lg font-bold text-yellow-400">{taxResult.effectiveRate}%</p>
            </div>
          </div>
        )}
      </>)}
    </section>
  );
}
