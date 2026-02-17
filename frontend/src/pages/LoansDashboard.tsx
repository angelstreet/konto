import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, Plus, ChevronDown } from 'lucide-react';
import EyeToggle from '../components/EyeToggle';
import ScopeSelect from '../components/ScopeSelect';
import { useAmountVisibility } from '../AmountVisibilityContext';

export default function LoansDashboard() {
  const { t } = useTranslation();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const f = (n: number) => hideAmounts ? `***€` : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

  // Mock data for expandable cards (#714)
  const loans = [
    {
      id: 1,
      name: 'CIC Prêt Immo Modulable (JND Construction)',
      bank: 'CIC',
      remaining: 415833,
      paid: 0.12,
      rate: 2.60,
      monthly: 2121,
      linkedProperty: 'Villa Miami',
    },
    {
      id: 2,
      name: 'CIC Prêt Immo Modulable (personal)',
      bank: 'CIC',
      remaining: 127800,
      paid: 0.31,
      rate: 1.15,
      monthly: 813,
      linkedProperty: 'T4 Vitrolles',
    },
  ];

  const [expanded, setExpanded] = useState<number | null>(null);

  const totalRemaining = loans.reduce((sum, loan) => sum + loan.remaining, 0);
  const totalMonthly = loans.reduce((sum, loan) => sum + loan.monthly, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 h-10">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold whitespace-nowrap">Prêts</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <ScopeSelect />
      </div>

      {/* Summary header */}
      <div className="bg-gradient-to-br from-red-900/80 to-red-800/80 backdrop-blur-sm rounded-2xl border border-red-700/50 p-6 mb-6 shadow-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div>
            <p className="text-red-300 text-sm font-medium uppercase tracking-wide mb-2">Capital restant dû</p>
            <p className="text-4xl lg:text-5xl font-bold text-white">{f(totalRemaining)}</p>
          </div>
          <div>
            <p className="text-red-300 text-sm font-medium uppercase tracking-wide mb-2">Mensualités totales</p>
            <p className="text-3xl font-bold text-red-400">{f(totalMonthly)}/mois</p>
          </div>
          <div className="text-right lg:text-left pt-4 lg:pt-0 border-t border-red-700/50">
            <p className="text-xs text-red-400">2 prêts actifs</p>
          </div>
        </div>
      </div>

      {loans.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <Banknote className="mx-auto text-muted mb-3" size={32} />
          <p className="text-muted text-sm mb-4">Aucun prêt ajouté.</p>
          <p className="text-muted text-xs mb-6">Ajoutez vos emprunts pour suivre votre endettement.</p>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-accent-500 text-black mx-auto">
            <Plus size={16} />
            + Ajouter un prêt
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {loans.map((loan) => {
            const isExpanded = expanded === loan.id;
            return (
              <div key={loan.id} className="bg-surface rounded-xl border border-border overflow-hidden">
                <div 
                  className="px-4 py-4 cursor-pointer hover:bg-surface-hover transition-colors flex items-center justify-between"
                  onClick={() => setExpanded(isExpanded ? null : loan.id)}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-10 h-10 bg-gradient-to-r from-red-500 to-orange-500 rounded-xl flex items-center justify-center">
                      <span className="text-white font-bold text-sm">CIC</span>
                    </div>
                    <div>
                      <p className="font-semibold text-white">{loan.name}</p>
                      <p className="text-xs text-muted">{loan.linkedProperty && `🔗 ${loan.linkedProperty}`}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-red-400">{f(loan.remaining)}</p>
                    <p className="text-xs text-muted">{loan.monthly.toLocaleString('fr-FR')}€/mois • {loan.rate}%</p>
                  </div>
                  <ChevronDown className={`ml-4 text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`} size={20} />
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 pt-2 border-t border-border/50">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-muted uppercase">Remboursé</p>
                        <p className="font-medium text-green-400">{(loan.paid * 100).toFixed(0)}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted uppercase">Taux</p>
                        <p className="font-medium">{loan.rate}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted uppercase">Mensualité</p>
                        <p className="font-medium text-orange-400">{f(loan.monthly)}/mois</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted uppercase">Bien lié</p>
                        <p className="font-medium">{loan.linkedProperty || '—'}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}