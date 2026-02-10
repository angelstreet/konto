import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { API } from '../config';
import { useAuthFetch } from '../useApi';
import { useAmountVisibility } from '../AmountVisibilityContext';
import EyeToggle from '../components/EyeToggle';
import { ArrowLeft, Building2, Home } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

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

export default function PropertyROI() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const authFetch = useAuthFetch();
  const { hideAmounts, toggleHideAmounts } = useAmountVisibility();
  const [data, setData] = useState<ROIData | null>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(6);

  useEffect(() => {
    setLoading(true);
    authFetch(`${API}/properties/roi?months=${months}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
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
    <div className="p-3 sm:p-6 max-w-5xl mx-auto pb-24">
      {/* Header */}
      <div className="flex items-center justify-between h-10 mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/more')} className="md:hidden p-1"><ArrowLeft className="w-5 h-5" /></button>
          <Building2 className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">{t('nav_property_roi', 'Rendement Immobilier')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={months}
            onChange={(e) => setMonths(parseInt(e.target.value))}
            className="bg-card border border-border rounded-md px-2 py-1 text-sm"
          >
            <option value={3}>3 mois</option>
            <option value={6}>6 mois</option>
            <option value={12}>12 mois</option>
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
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2 text-center">
                      <p className="text-[10px] text-muted-foreground">Charges/mois</p>
                      <p className={`text-sm font-semibold text-red-500 ${h ? 'amount-masked' : ''}`}>
                        {h ? '•••' : fmt(prop.monthlyCosts)}
                      </p>
                    </div>
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
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                          <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis hide={h} tick={{ fontSize: 9 }} width={40} axisLine={false} tickLine={false} />
                          <Tooltip
                            formatter={(v: any) => h ? '•••' : fmt(v)}
                            labelFormatter={(l: any) => String(l)}
                            contentStyle={{ fontSize: 11, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6 }}
                          />
                          <Bar dataKey="revenue" name="Revenus" fill="#22c55e" radius={[2, 2, 0, 0]} />
                          <Bar dataKey="costs" name="Charges" fill="#ef4444" radius={[2, 2, 0, 0]} />
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
    </div>
  );
}
