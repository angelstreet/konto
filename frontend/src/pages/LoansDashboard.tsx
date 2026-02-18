import { useNavigate } from 'react-router-dom';
import { useApi } from '../useApi';
import { useFilter } from '../FilterContext';
import { API } from '../config';
import { Banknote, Plus, ArrowLeft } from 'lucide-react';
import EyeToggle from '../components/EyeToggle';
import ScopeSelect from '../components/ScopeSelect';
import { useAmountVisibility } from '../AmountVisibilityContext';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M€`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k€`;
  return `${Math.round(n)}€`;
};

interface BankAccount {
  id: number;
  name: string;
  custom_name: string | null;
  bank_name: string | null;
  type: string;
  balance: number;
}

export default function LoansDashboard() {
  const navigate = useNavigate();
  const { appendScope } = useFilter();
  const { data: allAccounts } = useApi<BankAccount[]>(appendScope(`${API}/bank/accounts`));
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const f = (n: number): React.ReactNode => hideAmounts ? <span className="amount-masked">{fmt(n)}</span> : fmt(n);

  const loans = (allAccounts || []).filter(a => a.type === 'loan');
  const totalDebt = loans.reduce((sum, loan) => sum + Math.abs(loan.balance || 0), 0);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-4 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Emprunts</h1>
          {loans.length > 0 && <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="hidden md:block"><ScopeSelect /></span>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
            <Plus size={16} /> <span className="hidden sm:inline">Ajouter</span>
          </button>
        </div>
      </div>

      {/* Summary */}
      {loans.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 p-4 bg-gradient-to-r from-gray-900/50 to-gray-800/50 rounded-xl border border-gray-700">
          <div>
            <p className="text-sm text-muted uppercase tracking-wide mb-1">Capital restant dû</p>
            <p className="text-2xl font-bold text-red-400">
              {hideAmounts ? <span className="amount-masked">{fmtCompact(totalDebt)}</span> : fmtCompact(totalDebt)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted uppercase tracking-wide mb-1">Emprunts</p>
            <p className="text-2xl font-bold text-accent-400">{loans.length}</p>
          </div>
        </div>
      )}

      {/* Passifs table */}
      {loans.length === 0 && allAccounts !== null ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Banknote className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm mb-2">Aucun emprunt trouvé.</p>
          <p className="text-muted text-xs mb-6">Ajoutez vos prêts immobiliers, auto, conso pour suivre votre endettement.</p>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-black mx-auto">
            <Plus size={16} /> Ajouter un prêt
          </button>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-wider">Passifs</h2>
          </div>
          <div className="hidden md:grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-border/50">
            <span>Nom</span>
            <span className="text-right w-32">Banque</span>
            <span className="text-right w-40">Capital restant dû</span>
          </div>
          {loans.map((loan) => {
            const name = loan.custom_name || loan.name;
            const bankInitials = (loan.bank_name || name || '?').slice(0, 3).toUpperCase();
            const capital = Math.abs(loan.balance || 0);
            return (
              <div key={loan.id} className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_auto] gap-4 px-4 py-3.5 items-center border-b border-border/50 last:border-0 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-muted">{bankInitials}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    {loan.bank_name && <p className="text-xs text-muted">{loan.bank_name}</p>}
                  </div>
                </div>
                <span className="hidden md:block text-sm text-right text-muted tabular-nums w-32">
                  {loan.bank_name || '—'}
                </span>
                <span className="text-sm font-semibold text-right tabular-nums text-red-400 md:w-40">
                  {f(capital)}
                </span>
              </div>
            );
          })}
          {loans.length > 1 && (
            <div className="grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 items-center bg-white/5 border-t border-border/50">
              <span className="text-sm font-semibold">Total</span>
              <span className="hidden md:block w-32" />
              <span className="text-sm font-bold text-right tabular-nums text-red-400 md:w-40">
                {f(totalDebt)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
