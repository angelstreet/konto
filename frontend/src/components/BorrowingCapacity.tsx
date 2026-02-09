import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditCard, ChevronDown } from 'lucide-react';
import { API } from '../config';
import { useAuthFetch } from '../useApi';

interface BorrowingResult {
  net_monthly: number;
  max_payment: number;
  available_payment: number;
  max_loan: number;
  rate: number;
  duration_years: number;
}

function fmt(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

export default function BorrowingCapacity({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const { t } = useTranslation();
  const authFetch = useAuthFetch();

  const [borrowInput, setBorrowInput] = useState({ net_monthly: '', existing_payments: '', rate: '3.35', duration_years: '20' });
  const [borrowResult, setBorrowResult] = useState<BorrowingResult | null>(null);
  const [borrowOpen, setBorrowOpen] = useState(defaultOpen);

  const estimateBorrowing = async () => {
    const body = {
      net_monthly: parseFloat(borrowInput.net_monthly) || 0,
      existing_payments: parseFloat(borrowInput.existing_payments) || 0,
      rate: parseFloat(borrowInput.rate) || 3.35,
      duration_years: parseInt(borrowInput.duration_years) || 20,
    };
    if (!body.net_monthly) return;
    const res = await authFetch(`${API}/borrowing-capacity`, { method: 'POST', body: JSON.stringify(body) });
    setBorrowResult(await res.json());
  };

  return (
    <section className="bg-surface rounded-xl border border-border p-4 space-y-2.5">
      <h2 className="text-lg font-semibold flex items-center gap-2 cursor-pointer select-none" onClick={() => setBorrowOpen(!borrowOpen)}>
        <CreditCard size={20} /> {t('borrowing_capacity')}
        <ChevronDown size={16} className={`text-muted transition-transform ${borrowOpen ? '' : '-rotate-90'}`} />
      </h2>

      {borrowOpen && (<>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted mb-1 block">{t('net_monthly_income')}</label>
            <input type="number" value={borrowInput.net_monthly} onChange={e => setBorrowInput({ ...borrowInput, net_monthly: e.target.value })}
              placeholder="3500" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('existing_payments')}</label>
            <input type="number" value={borrowInput.existing_payments} onChange={e => setBorrowInput({ ...borrowInput, existing_payments: e.target.value })}
              placeholder="0" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('interest_rate')} (%)</label>
            <input type="number" step="0.05" value={borrowInput.rate} onChange={e => setBorrowInput({ ...borrowInput, rate: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">{t('duration_years')}</label>
            <input type="number" value={borrowInput.duration_years} onChange={e => setBorrowInput({ ...borrowInput, duration_years: e.target.value })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <button onClick={estimateBorrowing}
          className="px-4 py-2 bg-accent-500 text-white rounded-lg text-sm font-medium hover:bg-accent-600 transition-colors">
          {t('estimate')}
        </button>

        {borrowResult && (
          <div className="bg-background rounded-lg p-5 space-y-3 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-muted mb-1">{t('max_monthly_payment')}</p>
                <p className="text-lg font-bold text-white">{fmt(borrowResult.max_payment)}</p>
                <p className="text-xs text-muted">33% × {fmt(borrowResult.net_monthly)}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1">{t('available_payment')}</p>
                <p className="text-lg font-bold text-yellow-400">{fmt(borrowResult.available_payment)}</p>
              </div>
              <div>
                <p className="text-xs text-muted mb-1">{t('max_borrowing')}</p>
                <p className="text-2xl font-bold text-green-400">{fmt(borrowResult.max_loan)}</p>
                <p className="text-xs text-muted">{t('over')} {borrowResult.duration_years} {t('years_at')} {borrowResult.rate}%</p>
              </div>
            </div>
            <p className="text-xs text-muted text-center mt-2">
              {t('borrowing_note')}
            </p>
          </div>
        )}
      </>)}
    </section>
  );
}
