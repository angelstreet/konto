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

  const loanDebts = loans.reduce((acc: Record<string, number>, loan) => {
    const bank = loan.bank_name || 'Non spécifié';
    acc[bank] = (acc[bank] || 0) + Math.abs(loan.balance || 0);
    return acc;
  }, {} as Record<string, number>);

  // Mock mensualité breakdown
  const monthlyBreakdown = [
    { label: 'Capital', value: 1800, pct: 60, color: '#3B82F6' },
    { label: 'Intérêts', value: 850, pct: 28, color: '#F59E0B' },
    { label: 'Assurance', value: 150, pct: 5, color: '#10B981' },
  ];
  const totalMonthly = monthlyBreakdown.reduce((sum, b) => sum + b.value, 0);

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

      {loans.length > 0 && (
        <>
          {/* € headline total debt */}
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

          {/* Finary Mensualité cards SVG bars */}
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-4 px-4">Mensualités estimées</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 px-4 mb-4">
              {monthlyBreakdown.map(({label, value, pct, color}, i) => (
                <div key={i} className="p-4 rounded-xl border bg-gradient-to-br" style={{borderColor: `${color}40`, background: `linear-gradient(to bottom right, ${color}20, ${color}30)`}}>
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">{label}</p>
                  <p className="text-xl font-bold">{fmtCompact(value)}</p>
                  <svg viewBox="0 0 100 12" className="w-full mt-2 h-3 bg-gray-800/50 rounded-full overflow-hidden">
                    <rect width={`${pct}%`} height="12" rx="6" fill={color}/>
                  </svg>
                  <p className="text-xs mt-1 font-mono text-gray-400">{pct}%</p>
                </div>
              ))}
            </div>
            <div className="px-4">
              <div className="p-4 border border-dashed border-gray-700 rounded-xl text-center bg-gray-900/30">
                <p className="text-sm text-muted mb-1 uppercase tracking-wide">Total mensuel</p>
                <p className="text-2xl font-bold text-red-400">{fmtCompact(totalMonthly)}</p>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 px-4">
            <div>
              <p className="text-xs text-muted uppercase tracking-wide mb-1">Durée moyenne</p>
              <p className="font-bold text-lg">19.2 ans</p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wide mb-1">Taux moyen</p>
              <p className="font-bold text-lg">3.1%</p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wide mb-1">Capacité d'endettement</p>
              <p className="font-bold text-lg">28%</p>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wide mb-1">Ratio dette</p>
              <p className="font-bold text-lg">65%</p>
            </div>
          </div>
        </>
      )}

      {/* Passifs table - bank col removed */}
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
          <div className="hidden md:grid grid-cols-[1fr_auto] gap-4 px-4 py-2 text-xs font-semibold text-muted uppercase tracking-wider border-b border-border/50">
            <span>Nom</span>
            <span className="text-right w-32">Capital restant dû</span>
          </div>
          {loans.map((loan) => {
            const name = loan.custom_name || loan.name;
            const bankInitials = (name || '?').slice(0, 3).toUpperCase();
            const capital = Math.abs(loan.balance || 0);
            return (
              <div key={loan.id} className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3.5 items-center border-b border-border/50 last:border-0 hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-surface-hover flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-bold text-muted">{bankInitials}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                  </div>
                </div>
                <span className="text-sm font-semibold text-right tabular-nums text-red-400 w-32">
                  {f(capital)}
                </span>
              </div>
            );
          })}
          {loans.length > 1 && (
            <div className="grid grid-cols-[1fr_auto] gap-4 px-4 py-3 items-center bg-white/5 border-t border-border/50">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-sm font-bold text-right tabular-nums text-red-400 w-32">
                {f(totalDebt)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Finary Analyse amortization SVG curve + treemap */}
      {loans.length > 0 && (
        <div className="mt-12">
          <div className="bg-surface rounded-xl border border-border p-6 mb-8">
            <h3 className="text-lg font-semibold mb-6 text-muted uppercase tracking-wider">Analyse</h3>
            <div className="mb-12">
              <p className="text-sm font-semibold text-muted uppercase tracking-wide mb-4">Courbe d'amortissement</p>
              <svg viewBox="0 0 520 260" className="w-full rounded-2xl bg-gray-900/30 border border-gray-700/50 p-4" preserveAspectRatio="xMidYMid meet">
                {/* X axis */}
                <line x1="60" y1="220" x2="460" y2="220" stroke="#6B7280" strokeWidth="2" />
                <line x1="60" y1="50" x2="60" y2="220" stroke="#6B7280" strokeWidth="2" />
                {/* Ticks */}
                <line x1="60" y1="225" x2="60" y2="215" stroke="#9CA3AF" strokeWidth="1.5" />
                <line x1="260" y1="225" x2="260" y2="215" stroke="#9CA3AF" strokeWidth="1.5" />
                <line x1="460" y1="225" x2="460" y2="215" stroke="#9CA3AF" strokeWidth="1.5" />
                {/* Curve */}
                <path d="M70 210 Q130 170 190 155 T310 135 T430 125" stroke="#DC2626" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.6" />
                <path d="M70 210 Q130 170 190 155 T310 135 T430 125" stroke="url(#amortGrad)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
                <defs>
                  <linearGradient id="amortGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FECACA" />
                    <stop offset="50%" stopColor="#EF4444" />
                    <stop offset="100%" stopColor="#B91C1C" />
                  </linearGradient>
                </defs>
                {/* Labels */}
                <text x="55" y="245" fontSize="13" fill="#9CA3AF" textAnchor="middle">0</text>
                <text x="255" y="245" fontSize="13" fill="#9CA3AF" textAnchor="middle">120 mois</text>
                <text x="455" y="245" fontSize="13" fill="#9CA3AF" textAnchor="middle">240 mois</text>
                <text x="250" y="45" fontSize="14" fill="#EF4444" fontWeight="bold" textAnchor="middle">Capital restant</text>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-muted uppercase tracking-wide mb-6">Répartition par banque</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 h-48 p-4 bg-gray-900/30 rounded-xl border border-gray-700/50 overflow-auto">
                {Object.entries(loanDebts)
                  .sort(([,a]:[string,number], [,b]:[string,number]) => b - a)
                  .map(([bank, debt]) => {
                    const pct = Math.round((debt / totalDebt) * 100);
                    const colSpan = Math.max(1, Math.ceil(pct / 25));
                    const rowSpan = Math.max(1, Math.ceil(pct / 25));
                    return (
                      <div
                        key={bank}
                        className="rounded-xl p-3 shadow-md flex flex-col justify-end text-white text-xs font-bold transition-all hover:scale-[1.02] cursor-pointer bg-gradient-to-br from-red-400 via-red-500 to-red-600"
                        style={{
                          gridColumnEnd: `span ${colSpan}`,
                          gridRowEnd: `span ${rowSpan}`,
                        }}
                      >
                        <span className="truncate leading-tight font-medium">{bank}</span>
                        <span className="text-red-100 font-bold">{pct}%</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}