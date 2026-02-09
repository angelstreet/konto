import { API } from '../config';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi, useAuthFetch } from '../useApi';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight } from 'lucide-react';


const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e', '#ec4899', '#6b7280'];

interface AnalyticsData {
  totalIncome: number;
  totalExpenses: number;
  savingsRate: number;
  topCategories: { category: string; amount: number; percentage: number }[];
  recurring: { label: string; avgAmount: number; months: number }[];
  trends: { period: string; income: number; expenses: number }[];
  mom: { income: number; expenses: number };
  yoy: { income: number; expenses: number; incomeChange: number; expensesChange: number };
  computed_at: string;
  cached: boolean;
}

function fmt(n: number) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function monthLabel(period: string) {
  const [y, m] = period.split('-');
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return `${months[parseInt(m) - 1]} ${y.slice(2)}`;
}

export default function Analytics() {
  const { t } = useTranslation();
  const authFetch = useAuthFetch();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const period = `${year}-${String(month).padStart(2, '0')}`;

  const { data, loading, refetch } = useApi<AnalyticsData>(`${API}/analytics?period=${period}`);
  const [refreshing, setRefreshing] = useState(false);

  const prev = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const next = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await authFetch(`${API}/analytics/recompute`, {
        method: 'POST',
        body: JSON.stringify({ period }),
      });
      refetch();
    } finally {
      setRefreshing(false);
    }
  }, [period, refetch]);

  const moisFr = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

  if (loading && !data) return <div className="p-6 text-muted">Chargement...</div>;

  const d = data!;

  const savingsColor = d.savingsRate >= 20 ? 'text-green-400' : d.savingsRate >= 0 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold text-white">{t('nav_analysis')}</h1>
        <div className="flex items-center gap-2">
          <button onClick={prev} className="p-2.5 rounded-lg bg-surface hover:bg-surface-hover text-muted min-w-[44px] min-h-[44px] flex items-center justify-center"><ChevronLeft size={16} /></button>
          <span className="text-white font-medium min-w-[140px] text-center">{moisFr[month - 1]} {year}</span>
          <button onClick={next} className="p-2.5 rounded-lg bg-surface hover:bg-surface-hover text-muted min-w-[44px] min-h-[44px] flex items-center justify-center"><ChevronRight size={16} /></button>
          <button onClick={handleRefresh} disabled={refreshing} className="p-2.5 rounded-lg bg-accent-500/10 text-accent-400 hover:bg-accent-500/20 disabled:opacity-50 ml-2 min-w-[44px] min-h-[44px] flex items-center justify-center">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Updated at */}
      {d.computed_at && (
        <p className="text-xs text-muted">Dernière mise à jour : {new Date(d.computed_at).toLocaleString('fr-FR')}</p>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Revenus" value={`${fmt(d.totalIncome)} €`} icon={<TrendingUp size={18} />} color="text-green-400" sub={d.mom.income !== 0 ? `${d.mom.income > 0 ? '+' : ''}${d.mom.income}% vs mois préc.` : undefined} />
        <Card label="Dépenses" value={`${fmt(d.totalExpenses)} €`} icon={<TrendingDown size={18} />} color="text-red-400" sub={d.mom.expenses !== 0 ? `${d.mom.expenses > 0 ? '+' : ''}${d.mom.expenses}% vs mois préc.` : undefined} />
        <Card label="Épargne" value={`${fmt(d.totalIncome - d.totalExpenses)} €`} icon={<TrendingUp size={18} />} color="text-blue-400" />
        <Card label="Taux d'épargne" value={`${d.savingsRate}%`} icon={<TrendingUp size={18} />} color={savingsColor} />
      </div>

      {/* YoY comparison */}
      {(d.yoy.income > 0 || d.yoy.expenses > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface rounded-xl p-4 border border-border">
            <p className="text-xs text-muted mb-1">Revenus vs même mois N-1</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">{fmt(d.yoy.income)} €</span>
              {d.yoy.incomeChange !== 0 && (
                <span className={`text-xs flex items-center gap-0.5 ${d.yoy.incomeChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {d.yoy.incomeChange > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {Math.abs(d.yoy.incomeChange)}%
                </span>
              )}
            </div>
          </div>
          <div className="bg-surface rounded-xl p-4 border border-border">
            <p className="text-xs text-muted mb-1">Dépenses vs même mois N-1</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">{fmt(d.yoy.expenses)} €</span>
              {d.yoy.expensesChange !== 0 && (
                <span className={`text-xs flex items-center gap-0.5 ${d.yoy.expensesChange < 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {d.yoy.expensesChange > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {Math.abs(d.yoy.expensesChange)}%
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Spending trends bar chart */}
        <div className="bg-surface rounded-xl p-4 border border-border">
          <h3 className="text-sm font-semibold text-white mb-3">Tendances (6 mois)</h3>
          {d.trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.trends.map(t => ({ ...t, label: monthLabel(t.period) }))}>
                <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => `${fmt(v)} €`} contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                <Bar dataKey="income" name="Revenus" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Dépenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted text-sm">Aucune donnée</p>
          )}
        </div>

        {/* Top categories donut */}
        <div className="bg-surface rounded-xl p-4 border border-border">
          <h3 className="text-sm font-semibold text-white mb-3">Top catégories de dépenses</h3>
          {d.topCategories.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={d.topCategories} dataKey="amount" nameKey="category" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {d.topCategories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => `${fmt(v)} €`} contentStyle={{ background: '#1f2937', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {d.topCategories.map((cat, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-muted truncate flex-1">{cat.category}</span>
                    <span className="text-white font-medium">{cat.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-muted text-sm">Aucune dépense</p>
          )}
        </div>
      </div>

      {/* Savings rate gauge */}
      <div className="bg-surface rounded-xl p-4 border border-border">
        <h3 className="text-sm font-semibold text-white mb-3">Taux d'épargne</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="h-4 bg-surface-hover rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${d.savingsRate >= 20 ? 'bg-green-500' : d.savingsRate >= 0 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(Math.max(d.savingsRate, 0), 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted mt-1">
              <span>0%</span>
              <span>20% (objectif)</span>
              <span>50%</span>
            </div>
          </div>
          <span className={`text-2xl font-bold ${savingsColor}`}>{d.savingsRate}%</span>
        </div>
      </div>

      {/* Recurring expenses */}
      {d.recurring.length > 0 && (
        <div className="bg-surface rounded-xl p-4 border border-border">
          <h3 className="text-sm font-semibold text-white mb-3">Dépenses récurrentes détectées</h3>
          <div className="space-y-2">
            {d.recurring.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                <span className="text-sm text-muted truncate flex-1">{r.label}</span>
                <span className="text-sm text-white font-medium">{fmt(r.avgAmount)} € /mois</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, icon, color, sub }: { label: string; value: string; icon: React.ReactNode; color: string; sub?: string }) {
  return (
    <div className="bg-surface rounded-xl p-4 border border-border">
      <div className="flex items-center gap-2 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-xs text-muted">{label}</span>
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}
