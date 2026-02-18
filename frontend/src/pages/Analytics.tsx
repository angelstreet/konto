import { API } from '../config';
import { useState, useEffect } from 'react';
import { useApi } from '../useApi';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, ChevronLeft, ChevronRight, ArrowUpRight, ArrowDownRight, ArrowLeft } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAmountVisibility } from '../AmountVisibilityContext';
import EyeToggle from '../components/EyeToggle';
import { useFilter } from '../FilterContext';
import ScopeSelect from '../components/ScopeSelect';


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
  
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const period = `${year}-${String(month).padStart(2, '0')}`;

  const isPerso = pathname === '/budget';
  const isPro = pathname === '/analysis';

  const { appendScope: globalAppendScope, setScope, scope, companies } = useFilter();
  const [selectedCompany, setSelectedCompany] = useState<number | 'pro'>('pro');

  // Auto-scope based on menu context
  useEffect(() => {
    if (isPerso && scope !== 'personal') {
      setScope('personal');
    } else if (isPro) {
      if (companies.length === 1 && scope !== companies[0].id) {
        setScope(companies[0].id);
        setSelectedCompany(companies[0].id);
      } else if (companies.length > 1 && scope !== 'pro' && typeof scope !== 'number') {
        setScope('pro');
      }
    }
  }, [isPerso, isPro, companies, scope, setScope]);

  // Custom appendScope that enforces the menu context
  const appendScope = (url: string): string => {
    if (isPerso) {
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}usage=personal`;
    }
    if (isPro) {
      if (typeof selectedCompany === 'number') {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}company_id=${selectedCompany}`;
      }
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}usage=professional`;
    }
    return globalAppendScope(url);
  };
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;
  const { data, loading } = useApi<AnalyticsData>(appendScope(`${API}/analytics?period=${period}`));

  const prev = () => {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  };
  const next = () => {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  };

  const moisFr = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

  if (loading && !data) return <div className="p-6 text-muted">Chargement...</div>;

  const d = data!;

  const savingsColor = d.savingsRate >= 20 ? 'text-green-400' : d.savingsRate >= 0 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-3 max-w-6xl overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Budget</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isPro && companies.length > 1 && (
            <select
              value={String(selectedCompany)}
              onChange={e => {
                const v = e.target.value;
                const val = v === 'pro' ? 'pro' as const : Number(v);
                setSelectedCompany(val);
                setScope(val);
              }}
              className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent-500 transition-colors max-w-[120px] truncate min-h-[36px]"
            >
              <option value="pro">Toutes</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {!isPerso && !isPro && <ScopeSelect />}
        </div>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-center gap-3">
        <button onClick={prev} className="p-2 rounded-lg text-muted hover:text-white hover:bg-surface-hover"><ChevronLeft size={16} /></button>
        <span className="text-sm text-white font-medium min-w-[120px] text-center">{moisFr[month - 1]} {year}</span>
        <button onClick={next} className="p-2 rounded-lg text-muted hover:text-white hover:bg-surface-hover"><ChevronRight size={16} /></button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Revenus" value={mask(`${fmt(d.totalIncome)} €`)} icon={<TrendingUp size={18} />} color="text-green-400" sub={d.mom.income !== 0 ? `${d.mom.income > 0 ? '+' : ''}${d.mom.income}% vs mois préc.` : undefined} />
        <Card label="Dépenses" value={mask(`${fmt(d.totalExpenses)} €`)} icon={<TrendingDown size={18} />} color="text-red-400" sub={d.mom.expenses !== 0 ? `${d.mom.expenses > 0 ? '+' : ''}${d.mom.expenses}% vs mois préc.` : undefined} />
        <Card label="Épargne" value={mask(`${fmt(d.totalIncome - d.totalExpenses)} €`)} icon={<TrendingUp size={18} />} color="text-blue-400" />
        <Card label="Taux d'épargne" value={`${d.savingsRate}%`} icon={<TrendingUp size={18} />} color={savingsColor} />
      </div>

      {/* YoY comparison */}
      {(d.yoy.income > 0 || d.yoy.expenses > 0) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface rounded-xl p-3 border border-border">
            <p className="text-xs text-muted mb-1">Revenus vs même mois N-1</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">{mask(`${fmt(d.yoy.income)} €`)}</span>
              {d.yoy.incomeChange !== 0 && (
                <span className={`text-xs flex items-center gap-0.5 ${d.yoy.incomeChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {d.yoy.incomeChange > 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {Math.abs(d.yoy.incomeChange)}%
                </span>
              )}
            </div>
          </div>
          <div className="bg-surface rounded-xl p-3 border border-border">
            <p className="text-xs text-muted mb-1">Dépenses vs même mois N-1</p>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white">{mask(`${fmt(d.yoy.expenses)} €`)}</span>
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
      <div className="grid lg:grid-cols-2 gap-2.5">
        {/* Spending trends bar chart */}
        <div className="bg-surface rounded-xl p-3 border border-border">
          <h3 className="text-sm font-semibold text-white mb-3">Tendances (6 mois)</h3>
          {d.trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d.trends.map(t => ({ ...t, label: monthLabel(t.period) }))}>
                <XAxis dataKey="label" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => hideAmounts ? '' : `${(v / 1000).toFixed(0)}k`} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v: any) => hideAmounts ? <span className="amount-masked">{`${fmt(v)} €`}</span> : `${fmt(v)} €`} contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12 }} itemStyle={{ color: '#fff' }} />
                <Bar dataKey="income" name="Revenus" fill="#22c55e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Dépenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-muted text-sm">Aucune donnée</p>
          )}
        </div>

        {/* Top categories donut */}
        <div className="bg-surface rounded-xl p-3 border border-border">
          <h3 className="text-sm font-semibold text-white mb-3">Top catégories de dépenses</h3>
          {d.topCategories.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={200}>
                <PieChart>
                  <Pie data={d.topCategories} dataKey="amount" nameKey="category" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {d.topCategories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => hideAmounts ? <span className="amount-masked">{`${fmt(v)} €`}</span> : `${fmt(v)} €`} contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: 8, color: '#fff', fontSize: 12 }} itemStyle={{ color: '#fff' }} />
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

      {/* Recurring expenses */}
      {d.recurring.length > 0 && (
        <div className="bg-surface rounded-xl p-3 border border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Dépenses récurrentes</h3>
            <span className="text-sm font-bold text-orange-400">{mask(`${fmt(d.recurring.reduce((s, r) => s + r.avgAmount, 0))} € /mois`)}</span>
          </div>
          <div className="space-y-2">
            {d.recurring.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                <span className="text-sm text-muted truncate flex-1">{r.label}</span>
                <span className="text-sm text-white font-medium">{mask(`${fmt(r.avgAmount)} €`)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, icon, color, sub }: { label: string; value: React.ReactNode; icon: React.ReactNode; color: string; sub?: string }) {
  return (
    <div className="bg-surface rounded-xl p-3 border border-border">
      <div className="flex items-center gap-2 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-xs text-muted">{label}</span>
      </div>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted mt-0.5">{sub}</p>}
    </div>
  );
}
