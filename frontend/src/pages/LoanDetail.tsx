import { API } from '../config';
import { useMemo, useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { ArrowLeft, GraduationCap, Upload } from 'lucide-react';
import { useApi } from '../useApi';
import { usePreferences } from '../PreferencesContext';
import { useAmountVisibility } from '../AmountVisibilityContext';

type LoanDetailResponse = {
  loan: {
    loan_id: number;
    name: string;
    type_label: string;
    remaining: number;
    monthly_payment: number | null;
    interest_rate: number | null;
    repaid_pct: number | null;
    installments_paid: number | null;
    installments_left: number | null;
    end_date: string | null;
  };
  monthly_breakdown: {
    capital: number | null;
    interest: number | null;
    insurance: number;
  };
  totals: {
    loan_cost: number;
    capital_total: number;
    interest_insurance_total: number;
    fees_total: number;
    repaid_total: number;
    repaid_capital: number;
    repaid_interest: number;
    repaid_insurance: number;
    remaining_total: number;
    remaining_to_repay: number;
    remaining_pct: number;
  };
  timeline: { year: number; remaining: number }[];
  linked_assets: {
    asset_id: number;
    name: string;
    usage: string | null;
    allocation_pct: number;
    allocation_amount: number;
  }[];
};

const LEARN_ITEMS = [
  'Réévaluez votre assurance emprunteur tous les 12-18 mois.',
  'Un remboursement partiel anticipé réduit fortement le coût total en début de prêt.',
  'Suivez votre taux d’endettement après chaque nouveau crédit.',
];

export default function LoanDetail() {
  const { loanId } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatCurrency } = usePreferences();
  const { hideAmounts } = useAmountVisibility();
  const [tab, setTab] = useState<'summary' | 'monthly' | 'learn' | 'assets'>('summary');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, loading, refetch } = useApi<LoanDetailResponse>(`${API}/loans/${loanId}`);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API}/loans/${loanId}/enrich`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      if (res.ok) {
        refetch();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const fc = (amount: number | null | undefined) => {
    const value = amount || 0;
    return hideAmounts ? <span className="amount-masked">{formatCurrency(value)}</span> : formatCurrency(value);
  };

  const progress = useMemo(() => {
    const pct = data?.loan?.repaid_pct || 0;
    return Math.max(0, Math.min(100, pct));
  }, [data]);

  if (loading && !data) return <div className="text-center text-muted py-10">Loading...</div>;
  if (!data) return <div className="text-center text-muted py-10">{t('loan_not_found') || 'Prêt introuvable'}</div>;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/loans')} className="p-2 rounded-lg hover:bg-surface"><ArrowLeft size={16} /></button>
          <h1 className="text-xl font-semibold truncate">{data.loan.name}</h1>
        </div>
        <div>
          <input type="file" ref={fileRef} onChange={handleFileUpload} accept=".pdf" className="hidden" />
          <button 
            onClick={() => fileRef.current?.click()} 
            disabled={uploading}
            className="px-3 py-1.5 text-sm bg-surface border border-border rounded-lg hover:bg-surface-2 flex items-center gap-2"
          >
            <Upload size={14} />
            {uploading ? '...' : 'Import PDF'}
          </button>
        </div>
      </div>
      <div className="text-muted text-sm mb-1">{data.loan.type_label}</div>
      <div className="text-4xl font-semibold text-accent-400 mb-3">{fc(data.loan.remaining)}</div>

      <div className="bg-surface rounded-xl border border-border p-3 mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm">{t('loan_repaid_sentence') || 'Vous avez déjà remboursé'} {Math.round(progress)} %</div>
          <div className="h-1.5 w-56 bg-background rounded-full overflow-hidden mt-2">
            <div className="h-full bg-accent-500" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="w-12 h-12 rounded-full border-4 border-accent-500 border-r-background" />
      </div>

      <div className="md:hidden mb-3 flex rounded-lg border border-border overflow-hidden text-sm">
        <button className={`flex-1 py-2 ${tab === 'summary' ? 'bg-surface text-white' : 'text-muted'}`} onClick={() => setTab('summary')}>{t('loan_tabs_summary') || 'Synthèse'}</button>
        <button className={`flex-1 py-2 ${tab === 'monthly' ? 'bg-surface text-white' : 'text-muted'}`} onClick={() => setTab('monthly')}>{t('loan_tabs_monthly') || 'Mensualité'}</button>
        <button className={`flex-1 py-2 ${tab === 'learn' ? 'bg-surface text-white' : 'text-muted'}`} onClick={() => setTab('learn')}>{t('loan_tabs_learn') || 'Apprendre'}</button>
        <button className={`flex-1 py-2 ${tab === 'assets' ? 'bg-surface text-white' : 'text-muted'}`} onClick={() => setTab('assets')}>{t('loan_tabs_linked_assets') || 'Actifs liés'}</button>
      </div>

      {(tab === 'summary' || tab === 'monthly' || window.innerWidth >= 768) && (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-3 mb-3">
          <div className="xl:col-span-3 bg-surface rounded-xl border border-border p-3">
            <div className="text-sm text-muted mb-2">{t('loan_remaining_timeline') || 'Évolution du capital restant dû'}</div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.timeline}>
                  <XAxis dataKey="year" tick={{ fill: '#8d9099', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#8d9099', fontSize: 11 }} width={80} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(value: any) => formatCurrency(Number(value || 0))} />
                  <Area type="monotone" dataKey="remaining" stroke="#c7a26b" fillOpacity={1} fill="url(#loanDetailArea)" />
                  <defs>
                    <linearGradient id="loanDetailArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6f5530" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="#1b1a17" stopOpacity={0.2} />
                    </linearGradient>
                  </defs>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="xl:col-span-2 bg-surface rounded-xl border border-border p-4">
            <div className="text-xs text-muted uppercase">{t('loan_monthly') || 'Mensualité'}</div>
            <div className="text-3xl mt-1">{data.loan.monthly_payment != null ? fc(data.loan.monthly_payment) : (t('loan_no_data') || 'Pas de données')}</div>
            <div className="mt-2 text-sm text-muted">{t('loan_capital') || 'Capital'}: {fc(data.monthly_breakdown.capital)}</div>
            <div className="text-sm text-muted">{t('loan_interest') || 'Intérêts'}: {fc(data.monthly_breakdown.interest)}</div>
            <div className="text-sm text-muted">{t('loan_insurance') || 'Assurance'}: {fc(data.monthly_breakdown.insurance)}</div>

            <div className="mt-4 text-sm">
              <div className="flex justify-between"><span className="text-muted">{t('loan_installments_paid') || 'Échéances payées'}</span><span>{data.loan.installments_paid ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_installments_left') || 'Échéances restantes'}</span><span>{data.loan.installments_left ?? '-'}</span></div>
              <div className="flex justify-between"><span className="text-muted">{t('loan_end_date') || 'Date de fin'}</span><span>{data.loan.end_date || '-'}</span></div>
            </div>
          </div>
        </div>
      )}

      {(tab === 'summary' || window.innerWidth >= 768) && (
        <>
          <div className="text-sm font-semibold mb-2">{t('loan_tabs_summary') || 'Synthèse'}</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="text-xs text-muted uppercase">{t('loan_total_cost') || "Coût total de l'emprunt"}</div>
              <div className="text-3xl mt-2">{fc(data.totals.loan_cost)}</div>
              <div className="text-sm text-muted mt-2">{t('loan_capital') || 'Capital'}: {fc(data.totals.capital_total)}</div>
              <div className="text-sm text-muted">{t('loan_interest') || 'Intérêts'} + {t('loan_insurance') || 'Assurance'}: {fc(data.totals.interest_insurance_total)}</div>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="text-xs text-muted uppercase">{t('loan_total_repaid') || 'Total remboursé'}</div>
              <div className="text-3xl mt-2">{fc(data.totals.repaid_total)}</div>
              <div className="text-sm text-muted mt-2">{t('loan_capital') || 'Capital'}: {fc(data.totals.repaid_capital)}</div>
              <div className="text-sm text-muted">{t('loan_interest') || 'Intérêts'}: {fc(data.totals.repaid_interest)}</div>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <div className="text-xs text-muted uppercase">{t('loan_remaining_principal') || 'Capital restant dû'}</div>
              <div className="text-3xl mt-2">{fc(data.totals.remaining_total)}</div>
              <div className="text-sm text-muted mt-2">{t('loan_remaining_total') || 'Reste à rembourser'}: {fc(data.totals.remaining_to_repay)}</div>
              <div className="text-sm text-muted">{t('loan_remaining_pct') || 'Reste à rembourser (%)'}: {Math.round(data.totals.remaining_pct)} %</div>
            </div>
          </div>
        </>
      )}

      {(tab === 'monthly' || window.innerWidth >= 768) && (
        <div className="md:hidden bg-surface rounded-xl border border-border p-4 mb-3">
          <div className="text-xs text-muted uppercase mb-2">{t('loan_monthly') || 'Mensualité'}</div>
          <div className="text-sm text-muted">{t('loan_capital') || 'Capital'}: {fc(data.monthly_breakdown.capital)}</div>
          <div className="text-sm text-muted">{t('loan_interest') || 'Intérêts'}: {fc(data.monthly_breakdown.interest)}</div>
          <div className="text-sm text-muted mb-2">{t('loan_insurance') || 'Assurance'}: {fc(data.monthly_breakdown.insurance)}</div>
          <div className="text-sm text-muted">{t('loan_installments_paid') || 'Échéances payées'}: {data.loan.installments_paid ?? '-'}</div>
          <div className="text-sm text-muted">{t('loan_installments_left') || 'Échéances restantes'}: {data.loan.installments_left ?? '-'}</div>
          <div className="text-sm text-muted">{t('loan_end_date') || 'Date de fin'}: {data.loan.end_date || '-'}</div>
        </div>
      )}

      {(tab === 'learn' || window.innerWidth >= 768) && (
        <div className={`${window.innerWidth >= 768 ? 'mb-3' : ''}`}>
          {tab === 'learn' && (
            <div className="space-y-2 mb-3">
              {LEARN_ITEMS.map((item) => (
                <div key={item} className="bg-surface rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2 text-accent-300 mb-1"><GraduationCap size={14} /> <span className="font-medium">{t('loan_tip') || 'Conseil'}</span></div>
                  <div className="text-sm text-muted">{item}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(tab === 'assets' || window.innerWidth >= 768) && (
        <>
          <div className="text-sm font-semibold mb-2">{t('loan_tabs_linked_assets') || 'Actifs liés'}</div>
          <div className="space-y-2">
            {data.linked_assets.length === 0 && (
              <div className="bg-surface rounded-xl border border-border p-4 text-muted text-sm">{t('loan_no_linked_assets') || 'Aucun actif lié'}</div>
            )}
            {data.linked_assets.map((asset) => (
              <Link to="/assets" key={asset.asset_id} className="block bg-surface rounded-xl border border-border p-4 hover:bg-surface-hover">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{asset.name}</div>
                    <div className="text-sm text-muted">{asset.usage || '-'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-muted">{asset.allocation_pct}%</div>
                    <div className="font-semibold text-accent-300">{fc(asset.allocation_amount)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
