import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Car, Watch, Package, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import EyeToggle from '../components/EyeToggle';
import ScopeSelect from '../components/ScopeSelect';
import { useAmountVisibility } from '../AmountVisibilityContext';

const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const fmtCompact = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M€`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k€`;
  return `${Math.round(n)}€`;
};

const periods = ['1J', '7J', '1M', '3M', 'YTD', '1A', 'TOUT'] as const;
type Period = typeof periods[number];

const mockChartData = [
  { date: '2025-02-01', value: 28000 },
  { date: '2025-08-01', value: 28000 },
  { date: '2026-02-17', value: 30000 },
];

export default function AutresActifs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const f = (n: number) => hideAmounts ? <span className="amount-masked">{fmt(n)}</span> : fmt(n);
  const [period, setPeriod] = useState<Period>('1A');

  const totalValue = 30000;
  const assetCount = 4;
  const oneYearChange = 0;
  const oneYearPct = 0;

  const chartData = useMemo(() => mockChartData, []);

  const formatDate = (value: string) => {
    const date = new Date(value);
    return date.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-4 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Autres Actifs</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="hidden md:block"><ScopeSelect /></span>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent-500 text-black">
            <Plus size={16} /> Ajouter
          </button>
        </div>
      </div>

      {/* Summary Header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 p-4 bg-gradient-to-r from-gray-900/50 to-gray-800/50 rounded-xl border border-gray-700">
        <div>
          <p className="text-sm text-muted uppercase tracking-wide mb-1">Valeur totale</p>
          <p className="text-2xl font-bold text-white">{f(totalValue)}</p>
        </div>
        <div>
          <p className="text-sm text-muted uppercase tracking-wide mb-1">Variation 1 an</p>
          <p className="text-2xl font-bold text-green-400">{oneYearChange >= 0 ? '+' : ''}{fmtCompact(oneYearChange)} <span className="text-lg">({fmtPct(oneYearPct)})</span></p>
        </div>
        <div>
          <p className="text-sm text-muted uppercase tracking-wide mb-1">Nombre d'actifs</p>
          <p className="text-2xl font-bold text-accent-400">{assetCount}</p>
        </div>
      </div>

      {/* Period Selector */}
      <div className="mb-6">
        <div className="flex gap-1 mb-4 overflow-x-auto pb-1 scrollbar-none">
          {periods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 transition-colors ${
                period === p
                  ? 'bg-accent-500/20 text-accent-400 border border-accent-500/30'
                  : 'bg-surface text-muted hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div className="bg-surface rounded-xl border border-border p-4 h-[250px]">
          <div className="h-full">
            {/* Mock chart - replace with Recharts LineChart */}
            <div className="h-full flex items-center justify-center text-muted text-sm">
              Flat line chart (grey, step function) - API data pending
            </div>
            {/* 
            <ResponsiveContainer height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                <XAxis dataKey="date" tickFormatter={formatDate} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtCompact} axisLine={false} tickLine={false} width={60} />
                <Tooltip />
                <Line type="step" dataKey="value" stroke="#9CA3AF" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
            */}
          </div>
        </div>
      </div>

      {/* CTA for empty or few assets */}
      <div className="text-center py-12">
        <Car className="mx-auto text-muted mb-3" size={48} />
        <h3 className="text-lg font-semibold mb-2">Complétez votre patrimoine</h3>
        <p className="text-muted mb-6 max-w-md mx-auto">Avez-vous des bijoux, montres ou véhicules à déclarer ? Ajoutez-les pour une vue complète de vos actifs illiquides.</p>
        <button className="px-8 py-3 bg-accent-500 text-black rounded-lg font-medium text-sm">
          + Ajouter un actif
        </button>
      </div>
    </div>
  );
}