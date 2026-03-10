import { useState, useEffect, useRef } from 'react';
import { API } from '../config';
import { useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import EyeToggle from '../components/EyeToggle';
import ScopeSelect from '../components/ScopeSelect';
import { useFilter } from '../FilterContext';
import { ArrowLeft, Home, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface Property {
  id: number;
  name: string;
  revenue: number;
  costs: number;
  net: number;
  monthlyRevenue: number;
  monthlyCosts: number;
  monthlyNet: number;
  occupancyRate: number;
  nights: number;
  bookings: number;
  revenueByMonth: Record<string, number>;
  costsByMonth: Record<string, number>;
  costsBreakdown?: { category: string; amount: number; items: { label: string; amount: number; date: string }[] }[];
}

interface ROIData {
  properties: Property[];
  summary: { totalRevenue: number; totalCosts: number; totalNet: number; propertyCount: number };
  period: { from: string; to: string; months: number };
}

function fmt(n: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

function monthLabel(m: string) {
  const [y, mo] = m.split('-');
  const names = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return `${names[parseInt(mo) - 1]} ${y.slice(2)}`;
}

const roiCache: Record<number, ROIData> = {};

export default function PropertyROI() {
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const { appendScope } = useFilter();
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<ROIData | null>(() => roiCache[6] ?? null);
  const [loading, setLoading] = useState(!roiCache[6]);
  const animatedProperties = useRef<Set<number>>(new Set());
  const [showChargesModal, setShowChargesModal] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);

  // Reset animation tracking when months filter changes
  useEffect(() => {
    animatedProperties.current = new Set();
  }, [months, appendScope, authFetch]);

  const handleMonthsChange = (value: string) => {
    const val = value === 'year' ? 12 : parseInt(value);
    setMonths(val);
  };

  useEffect(() => {
    if (roiCache[months]) {
      setData(roiCache[months]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const url = appendScope(`${API}/properties/roi?months=${months}`);
    authFetch(url)
      .then(r => r.json())
      .then(d => { roiCache[months] = d; setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [months]);

  const h = hideAmounts;

  // Build monthly chart data
  const getChartData = (prop: Property) => {
    const allMonths = new Set([...Object.keys(prop.revenueByMonth), ...Object.keys(prop.costsByMonth)]);
    return Array.from(allMonths).sort().map(m => ({
      month: monthLabel(m),
      revenue: Math.round(prop.revenueByMonth[m] || 0),
      costs: Math.round(prop.costsByMonth[m] || 0),
      net: Math.round((prop.revenueByMonth[m] || 0) - (prop.costsByMonth[m] || 0)),
    }));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden p-1"><ArrowLeft className="w-5 h-5" /></button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Rendement</h1>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <ScopeSelect />
          <select
            value={months === 12 ? 'year' : months}
            onChange={(e) => handleMonthsChange(e.target.value)}
            className="bg-card border border-border rounded-md px-2 py-1 text-sm"
          >
            <option value={3}>3 mois</option>
            <option value={6}>6 mois</option>
            <option value={12}>12 mois</option>
            <option value="year">Par an</option>
          </select>
          <EyeToggle hidden={hideAmounts} onToggle={toggleHideAmounts} />
        </div>
      </div>

      {loading && <div className="text-center text-muted-foreground py-12">Chargement…</div>}

      {!loading && data && (
        <>
          {/* Portfolio summary */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Revenus</p>
              <p className={`text-lg font-bold text-green-500 ${h ? 'amount-masked' : ''}`}>
                {h ? '•••' : fmt(data.summary.totalRevenue)}
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Charges</p>
              <p className={`text-lg font-bold text-red-500 ${h ? 'amount-masked' : ''}`}>
                {h ? '•••' : fmt(data.summary.totalCosts)}
              </p>
            </div>
            <div className="bg-card border border-border rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Net</p>
              <p className={`text-lg font-bold ${data.summary.totalNet >= 0 ? 'text-green-500' : 'text-red-500'} ${h ? 'amount-masked' : ''}`}>
                {h ? '•••' : fmt(data.summary.totalNet)}
              </p>
            </div>
          </div>

          {/* Property cards */}
          <div className="space-y-4">
            {data.properties.map(prop => {
              const chartData = getChartData(prop);
              return (
                <div key={prop.id} className="bg-card border border-border rounded-xl p-4">
                  {/* Property header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Home className="w-5 h-5 text-primary shrink-0" />
                      <div>
                        <h3 className="font-semibold text-sm leading-tight">{prop.name}</h3>
                        <p className="text-xs text-muted-foreground">
                          {prop.bookings} réservations · {prop.nights} nuits · {prop.occupancyRate}% occupation
                        </p>
                      </div>
                    </div>
                    <div className={`text-right ${h ? 'amount-masked' : ''}`}>
                      <p className={`text-sm font-bold ${prop.net >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {h ? '•••' : fmt(prop.monthlyNet)}/mois
                      </p>
                    </div>
                  </div>

                  {/* KPIs row */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Revenus/mois</p>
                      <p className={`text-sm font-semibold text-green-500 ${h ? 'amount-masked' : ''}`}>
                        {h ? '•••' : fmt(prop.monthlyRevenue)}
                      </p>
                    </div>
                    <button
                      onClick={() => { setSelectedProperty(prop); setShowChargesModal(true); }}
                      className="bg-red-500/5 border border-red-500/20 rounded-lg p-2 text-center hover:bg-red-500/10 transition-colors"
                    >
                      <p className="text-[10px] text-muted-foreground">Charges/mois</p>
                      <p className={`text-sm font-semibold text-red-500 ${h ? 'amount-masked' : ''}`}>
                        {h ? '•••' : fmt(prop.monthlyCosts)}
                      </p>
                    </button>
                    <div className={`rounded-lg p-2 text-center border ${prop.monthlyNet >= 0 ? 'bg-green-500/5 border-green-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                      <p className="text-[10px] text-muted-foreground">Net/mois</p>
                      <p className={`text-sm font-semibold ${prop.monthlyNet >= 0 ? 'text-green-500' : 'text-red-500'} ${h ? 'amount-masked' : ''}`}>
                        {h ? '•••' : fmt(prop.monthlyNet)}
                      </p>
                    </div>
                  </div>

                  {/* Monthly chart */}
                  {chartData.length > 0 && (
                    <div className="h-32">
                      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                        <BarChart data={chartData}>
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis hide={h} tick={{ fontSize: 9 }} width={40} axisLine={false} tickLine={false} />
                          <Tooltip
                            formatter={(v: any) => h ? '•••' : fmt(v)}
                            labelFormatter={(l: any) => String(l)}
                            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                            contentStyle={{ fontSize: 11, backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, color: '#e5e5e5' }}
                            itemStyle={{ color: '#e5e5e5' }}
                          />
                          <Bar dataKey="revenue" name="Revenus" fill="#22c55e" radius={[2, 2, 0, 0]} isAnimationActive={!animatedProperties.current.has(prop.id)} />
                          <Bar dataKey="costs" name="Charges" fill="#ef4444" radius={[2, 2, 0, 0]} isAnimationActive={!animatedProperties.current.has(prop.id)} onAnimationEnd={() => { animatedProperties.current.add(prop.id); }} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Charges breakdown modal */}
      {showChargesModal && selectedProperty && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowChargesModal(false)}>
          <div className="bg-[#1c1c1e] rounded-xl border border-white/10 p-4 max-w-md w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Répartition des charges</h2>
                <p className="text-sm text-muted-foreground">{selectedProperty.name}</p>
              </div>
              <button onClick={() => setShowChargesModal(false)} className="text-muted hover:text-white p-1">
                <X size={20} />
              </button>
            </div>

            {/* Donut chart */}
            {selectedProperty.costsBreakdown && selectedProperty.costsBreakdown.length > 0 && (
              <div className="h-40 mb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={selectedProperty.costsBreakdown.map(c => ({ name: c.category, value: c.amount }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={60}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {selectedProperty.costsBreakdown.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'][index % 6]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any) => h ? '•••' : fmt(v)}
                      contentStyle={{ fontSize: 11, backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, color: '#e5e5e5' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Charges list */}
            <div className="flex-1 overflow-auto">
              {selectedProperty.costsBreakdown && selectedProperty.costsBreakdown.length > 0 ? (
                <div className="space-y-3">
                  {selectedProperty.costsBreakdown.map((cat, idx) => (
                    <div key={cat.category} className="bg-surface rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full bg-[${{ 0: '#ef4444', 1: '#f97316', 2: '#eab308', 3: '#22c55e', 4: '#3b82f6', 5: '#8b5cf6'}[idx % 6]}]`} style={{ backgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'][idx % 6] }} />
                          <span className="text-sm font-medium text-white">{cat.category}</span>
                        </div>
                        <span className={`text-sm font-semibold text-red-400 ${h ? 'amount-masked' : ''}`}>
                          {h ? '•••' : fmt(cat.amount)}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {cat.items.slice(0, 5).map((item, i) => (
                          <div key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                            <span className="truncate flex-1">{item.label}</span>
                            <span className={`ml-2 ${h ? 'amount-masked' : ''}`}>{h ? '•••' : fmt(item.amount)}</span>
                          </div>
                        ))}
                        {cat.items.length > 5 && (
                          <div className="text-xs text-muted-foreground text-center pt-1">
                            +{cat.items.length - 5} autres...
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted py-8">
                  <p className="text-sm">Aucune détail de charges disponible</p>
                  <p className="text-xs mt-1">Les charges sont récupérées depuis les transactions bancaires</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
