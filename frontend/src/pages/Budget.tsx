import { API } from '../config';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowLeft, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { useFilter } from '../FilterContext';
import EyeToggle from '../components/EyeToggle';
import CategoryDonut from '../components/CategoryDonut';
import CalendarHeatmap from '../components/CalendarHeatmap';
import CategoryBreakdown from '../components/CategoryBreakdown';

const RANGES = [
  { key: 'all', label: 'Tout', days: 0 },
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '1y', label: '1A', days: 365 },
] as const;

type ViewMode = 'graph' | 'calendar';

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

interface CashflowData {
  totalIncome: number;
  totalExpense: number;
  net: number;
  byCategory: Record<string, { income: number; expense: number; count: number }>;
  byMonth: { month: string; income: number; expense: number }[];
}

interface CategoryItem {
  name: string;
  icon: string;
  color: string;
  total: number;
  count: number;
  pct: number;
}

interface CategoriesData {
  categories: CategoryItem[];
  uncategorized?: { total: number; count: number };
}

export default function Budget() {
  const navigate = useNavigate();
  const { t: _t } = useTranslation();
  const authFetch = useAuthFetch();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const { appendScope } = useFilter();
  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;
  const [range, setRange] = useState('3m');
  const [viewMode, setViewMode] = useState<ViewMode>('graph');
  const [data, setData] = useState<CashflowData | null>(null);
  const [catData, setCatData] = useState<CategoriesData | null>(null);
  const [loading, setLoading] = useState(true);
  const barChartAnimated = useRef(false);

  useEffect(() => {
    barChartAnimated.current = false;
  }, [range]);

  useEffect(() => {
    setLoading(true);
    const days = RANGES.find(r => r.key === range)?.days ?? 90;
    const from = days === 0
      ? '2020-01-01'
      : new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    const to = new Date().toISOString().split('T')[0];
    authFetch(appendScope(`${API}/budget/cashflow?from=${from}&to=${to}`))
      .then(r => r.json())
      .then(d => setData(d))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => {
    authFetch(appendScope(`${API}/analysis/categories?months=6`))
      .then(r => r.json())
      .then(d => setCatData(d))
      .catch(() => {});
  }, []);

  const net = data ? data.net : 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Budget Perso</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex gap-1 flex-shrink-0">
          {RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-2 text-xs rounded-md font-medium transition-colors min-h-[44px] min-w-[44px] ${
                range === r.key ? 'bg-accent-500/20 text-accent-400' : 'text-muted hover:text-white hover:bg-surface-hover'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-muted py-8">Chargement...</div>
      ) : !data || (data.totalIncome === 0 && data.totalExpense === 0) ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center text-muted">
          <p className="text-lg mb-2">Aucune transaction sur cette période</p>
          <p className="text-sm">Synchronisez vos comptes pour voir votre budget.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-surface rounded-xl border border-border p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <TrendingUp size={12} className="text-green-400" />
                <p className="text-xs text-muted">Revenus</p>
              </div>
              <p className="text-base font-bold text-green-400">{mask(formatCurrency(data.totalIncome))}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <TrendingDown size={12} className="text-red-400" />
                <p className="text-xs text-muted">Dépenses</p>
              </div>
              <p className="text-base font-bold text-red-400">{mask(formatCurrency(data.totalExpense))}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-3 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                {net >= 0
                  ? <TrendingUp size={12} className="text-green-400" />
                  : <Minus size={12} className="text-red-400" />}
                <p className="text-xs text-muted">Épargne</p>
              </div>
              <p className={`text-base font-bold ${net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {mask(formatCurrency(net))}
              </p>
            </div>
          </div>

          {/* View toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setViewMode('graph')}
              className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                viewMode === 'graph' ? 'bg-accent-500/20 text-accent-400' : 'text-muted hover:text-white hover:bg-surface-hover'
              }`}
            >
              📊 Graphique
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                viewMode === 'calendar' ? 'bg-accent-500/20 text-accent-400' : 'text-muted hover:text-white hover:bg-surface-hover'
              }`}
            >
              📅 Calendrier
            </button>
          </div>

          {/* Main content: graph/calendar + donut side-by-side on desktop */}
          <div className="flex flex-col lg:flex-row gap-4 mb-4">
            <div className="flex-1">
              {viewMode === 'graph' ? (
                data.byMonth.length > 0 ? (
                  <div className="bg-surface rounded-xl border border-border p-4">
                    <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Cashflow mensuel</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={data.byMonth} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
                        <XAxis
                          dataKey="month"
                          tickFormatter={(m: string) => {
                            const [y, mo] = m.split('-');
                            return `${mo}/${y.slice(2)}`;
                          }}
                          tick={{ fontSize: 10, fill: '#888' }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tickFormatter={(v: number) => hideAmounts ? '' : `${(v / 1000).toFixed(0)}k`}
                          tick={{ fontSize: 10, fill: '#888' }}
                          axisLine={false}
                          tickLine={false}
                          width={40}
                        />
                        <Tooltip
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          formatter={(value: any, name: any) => [
                            hideAmounts ? <span className="amount-masked">{formatCurrency(value as number)}</span> : formatCurrency(value as number),
                            name === 'income' ? 'Entrées' : 'Sorties'
                          ]}
                          contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
                          itemStyle={{ color: '#e5e5e5' }}
                        />
                        <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} isAnimationActive={!barChartAnimated.current} />
                        <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} isAnimationActive={!barChartAnimated.current} onAnimationEnd={() => { barChartAnimated.current = true; }} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="bg-surface rounded-xl border border-border p-8 text-center text-muted text-sm">
                    Pas de données mensuelles disponibles
                  </div>
                )
              ) : (
                <CalendarHeatmap />
              )}
            </div>

            {/* Category donut — only show if data available */}
            {catData && catData.categories.length > 0 && (
              <div className="lg:w-80">
                <CategoryDonut categories={catData.categories} totalExpense={data.totalExpense} />
              </div>
            )}
          </div>

          {/* Category breakdown */}
          {catData && catData.categories.length > 0 && (
            <CategoryBreakdown categories={catData.categories} totalExpense={data.totalExpense} />
          )}
        </>
      )}
    </div>
  );
}
