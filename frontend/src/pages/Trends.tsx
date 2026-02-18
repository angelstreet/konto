import { API } from '../config';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowLeft, TrendingUp, AlertTriangle } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useApi } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import EyeToggle from '../components/EyeToggle';
import { useFilter } from '../FilterContext';

const CATEGORY_COLORS: Record<string, string> = {
  'Énergie': '#f59e0b',
  'Alimentation': '#22c55e',
  'Eau': '#06b6d4',
  'Transport': '#3b82f6',
  'Impôts & Taxes': '#ef4444',
  'Assurances': '#8b5cf6',
  'Internet & Mobile': '#6366f1',
  'Habillement': '#ec4899',
  'Loisirs': '#eab308',
  'Loyers & Charges': '#a855f7',
  'Autre': '#6b7280',
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

function getColor(cat: string) {
  return CATEGORY_COLORS[cat] || `hsl(${Math.abs(cat.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360}, 60%, 50%)`;
}

function monthLabel(m: string) {
  const [, mo] = m.split('-');
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return months[parseInt(mo) - 1] || mo;
}

interface TrendCategory {
  category: string;
  totalSpend: number;
  months: { month: string; amount: number; avgLast3: number | null; changePercent: number | null }[];
}

interface TrendsData {
  categories: TrendCategory[];
  allMonths: string[];
  scope: string;
}

const MONTH_RANGES = [
  { key: 6, label: '6M' },
  { key: 12, label: '1A' },
];

export default function Trends() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const { scope, appendScope: globalAppendScope, setScope, companies } = useFilter();
  const [monthRange, setMonthRange] = useState(6);
  const [selectedCompany, setSelectedCompany] = useState<number | 'pro'>('pro');

  const isPerso = pathname === '/trends';
  const isPro = pathname === '/trends-pro';

  // Auto-scope based on route
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
      const sep = url.includes('?') ? '&' : '?';
      if (typeof selectedCompany === 'number') {
        return `${url}${sep}usage=professional&company_id=${selectedCompany}`;
      }
      return `${url}${sep}usage=professional`;
    }
    return globalAppendScope(url);
  };

  const { data, loading } = useApi<TrendsData>(appendScope(`${API}/trends?months=${monthRange}`));

  // Find anomalies: latest month with changePercent > 10%
  const anomalies = (data?.categories || [])
    .map(c => {
      const latest = c.months[c.months.length - 1];
      if (latest && latest.changePercent !== null && latest.changePercent > 10) {
        return { category: c.category, change: latest.changePercent, amount: latest.amount, avg: latest.avgLast3 };
      }
      return null;
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between h-10 mb-2">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/more')} className="md:hidden p-1"><ArrowLeft className="w-5 h-5" /></button>
          <TrendingUp className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">{t('nav_trends', 'Tendances')}</h1>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
        <div className="flex items-center gap-2">
          {isPro && companies.length > 1 && (
            <select
              value={String(selectedCompany)}
              onChange={e => {
                const v = e.target.value;
                const val = v === 'pro' ? 'pro' as const : Number(v);
                setSelectedCompany(val);
                setScope(val);
              }}
              className="bg-surface border border-border rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent-500 transition-colors max-w-[120px] sm:max-w-none min-h-[36px]"
            >
              <option value="pro">Toutes</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Month range selector */}
      <div className="flex gap-1 mb-4">
        {MONTH_RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setMonthRange(r.key)}
            className={`px-3 py-1 text-sm rounded-md transition ${
              monthRange === r.key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-center text-muted-foreground py-12">Chargement…</div>}

      {!loading && data && (
        <>
          {/* Anomaly alerts */}
          {anomalies.length > 0 && (
            <div className="mb-4 space-y-2">
              {anomalies.map(a => (
                <div key={a.category} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>
                    <strong>{a.category}</strong> {hideAmounts ? '•••' : `+${a.change}%`} vs moyenne
                    {!hideAmounts && <span className="text-muted-foreground ml-1">({formatCurrency(a.amount)} vs moy. {formatCurrency(a.avg || 0)})</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Category charts — top 6 */}
          {data.categories.length === 0 && (
            <div className="text-center text-muted-foreground py-12">Aucune donnée de dépense trouvée</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.categories.map(cat => {
              const latestMonth = cat.months[cat.months.length - 1];
              const hasAnomaly = latestMonth?.changePercent !== null && (latestMonth?.changePercent ?? 0) > 10;
              const color = getColor(cat.category);

              return (
                <div
                  key={cat.category}
                  className={`bg-card rounded-lg p-3 border ${hasAnomaly ? 'border-red-500/50 ring-1 ring-red-500/20' : 'border-border'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                      <span className="text-sm font-medium truncate">{cat.category}</span>
                    </div>
                    <span className={`text-xs font-medium ${hideAmounts ? 'amount-masked' : ''}`}>
                      {hideAmounts ? '•••' : formatCurrency(cat.totalSpend)}
                    </span>
                  </div>

                  {hasAnomaly && (
                    <div className="flex items-center gap-1 mb-1">
                      <AlertTriangle className="w-3 h-3 text-red-500" />
                      <span className="text-xs text-red-500 font-medium">
                        +{latestMonth.changePercent}% vs moyenne
                      </span>
                    </div>
                  )}

                  <div className="h-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={cat.months.map(m => ({ ...m, label: monthLabel(m.month) }))}>
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        {!hideAmounts && (
                          <YAxis tick={{ fontSize: 9 }} width={35} axisLine={false} tickLine={false}
                            tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                        )}
                        <Tooltip
                          formatter={(v: any) => hideAmounts ? '•••' : formatCurrency(Number(v))}
                          labelFormatter={(l: any) => String(l)}
                          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                          contentStyle={{ fontSize: 11, backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, color: '#e5e5e5' }}
                          itemStyle={{ color: '#e5e5e5' }}
                        />
                        <Bar dataKey="amount" fill={color} radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Monthly detail (last 3 months) */}
                  <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                    {cat.months.slice(-3).map(m => (
                      <span key={m.month} className={hideAmounts ? 'amount-masked' : ''}>
                        {monthLabel(m.month)}: {hideAmounts ? '•••' : formatCurrency(m.amount)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
