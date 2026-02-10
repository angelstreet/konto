import { API } from '../config';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import EyeToggle from '../components/EyeToggle';
import { useFilter } from '../FilterContext';
import ScopeSelect from '../components/ScopeSelect';

const CATEGORY_COLORS: Record<string, string> = {
  'Alimentation': '#22c55e',
  'Transport': '#3b82f6',
  'Logement': '#a855f7',
  'Santé': '#ec4899',
  'Loisirs': '#eab308',
  'Factures': '#f97316',
  'Virements': '#6366f1',
  'Autre': '#6b7280',
};

const RANGES = [
  { key: 'all', label: 'Tout', days: 0 },
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '1y', label: '1A', days: 365 },
] as const;

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

function getColor(cat: string) {
  return CATEGORY_COLORS[cat] || `hsl(${Math.abs(cat.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360}, 60%, 50%)`;
}

interface CashflowData {
  totalIncome: number;
  totalExpense: number;
  net: number;
  byCategory: Record<string, { income: number; expense: number; count: number }>;
  byMonth: { month: string; income: number; expense: number }[];
}

export default function Budget() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const authFetch = useAuthFetch();
  const { scope, appendScope } = useFilter();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;
  const [range, setRange] = useState('3m');
  const [data, setData] = useState<CashflowData | null>(null);
  const [loading, setLoading] = useState(true);

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
  }, [range, scope, appendScope]);

  const expenseCategories = data
    ? Object.entries(data.byCategory)
        .filter(([_, v]) => v.expense > 0)
        .map(([cat, v]) => ({ name: cat, value: v.expense }))
        .sort((a, b) => b.value - a.value)
    : [];

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('nav_budget') || 'Budget'}</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex items-center gap-2">
          <ScopeSelect />
          <div className="flex gap-1">
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
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div className="bg-surface rounded-xl border border-border p-3 text-center">
              <p className="text-xs text-muted mb-1">Entrées</p>
              <p className="text-lg font-bold text-green-400">{mask(formatCurrency(data.totalIncome))}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-3 text-center">
              <p className="text-xs text-muted mb-1">Sorties</p>
              <p className="text-lg font-bold text-red-400">{mask(formatCurrency(data.totalExpense))}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-3 text-center">
              <p className="text-xs text-muted mb-1">Solde</p>
              <p className={`text-lg font-bold ${data.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {mask(formatCurrency(data.net))}
              </p>
            </div>
          </div>

          {/* Monthly cashflow bar chart */}
          {data.byMonth.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-3 mb-2">
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
                    tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 10, fill: '#888' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value: any, name: any) => [formatCurrency(value as number), name === 'income' ? 'Entrées' : 'Sorties']}
                    contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="income" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Expense distribution donut */}
          {expenseCategories.length > 0 && (
            <div className="bg-surface rounded-xl border border-border p-3 mb-2">
              <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Répartition des dépenses</h3>
              <div className="flex items-center gap-4">
                <div className="w-40 h-40 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={expenseCategories}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        dataKey="value"
                        nameKey="name"
                        stroke="none"
                      >
                        {expenseCategories.map((entry) => (
                          <Cell key={entry.name} fill={getColor(entry.name)} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any) => [formatCurrency(value as number)]}
                        contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xs font-bold text-red-400">{mask(formatCurrency(data.totalExpense))}</span>
                  </div>
                </div>
                <div className="flex-1 space-y-1.5">
                  {expenseCategories.slice(0, 8).map(cat => {
                    const pct = data.totalExpense > 0 ? (cat.value / data.totalExpense) * 100 : 0;
                    return (
                      <div key={cat.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getColor(cat.name) }} />
                          <span className="text-muted truncate max-w-[120px]">{cat.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted">{pct.toFixed(1)}%</span>
                          <span className="font-medium">{mask(formatCurrency(cat.value))}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Category breakdown table */}
          <div className="bg-surface rounded-xl border border-border divide-y divide-border">
            <div className="px-4 py-2 flex items-center justify-between text-xs text-muted font-medium uppercase">
              <span>Catégorie</span>
              <div className="flex gap-3">
                <span className="w-20 text-right">Entrées</span>
                <span className="w-20 text-right">Sorties</span>
              </div>
            </div>
            {Object.entries(data.byCategory)
              .sort(([, a], [, b]) => b.expense - a.expense)
              .map(([cat, vals]) => (
                <div key={cat} className="px-4 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getColor(cat) }} />
                    <span className="text-sm">{cat}</span>
                    <span className="text-xs text-muted">({vals.count})</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-20 text-right text-sm text-green-400">
                      {vals.income > 0 ? mask(formatCurrency(vals.income)) : '–'}
                    </span>
                    <span className="w-20 text-right text-sm text-red-400">
                      {vals.expense > 0 ? mask(formatCurrency(vals.expense)) : '–'}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
