import { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../useApi';
import { useFilter } from '../FilterContext';
import ScopeSelect from '../components/ScopeSelect';
import { API } from '../config';

interface DashboardData {
  totals: { net: number };
  patrimoine?: { netValue: number };
}

function formatEur(v: number, compact = false): string {
  if (compact && Math.abs(v) >= 1_000_000) {
    return (v / 1_000_000).toFixed(1).replace('.', ',') + 'M€';
  }
  if (compact && Math.abs(v) >= 1_000) {
    return Math.round(v / 1_000) + 'k€';
  }
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

function buildProjection(startBalance: number, monthlyContrib: number, annualRate: number, durationYears: number) {
  const months = durationYears * 12;
  const monthlyRate = annualRate / 100 / 12;
  const data: { year: number; contributions: number; gains: number; balance: number }[] = [];
  let balance = startBalance;
  let totalContribs = 0;
  for (let m = 0; m <= months; m++) {
    if (m > 0) {
      balance = balance * (1 + monthlyRate) + monthlyContrib;
      totalContribs += monthlyContrib;
    }
    const gains = Math.max(0, balance - startBalance - totalContribs);
    if (m % 12 === 0) {
      data.push({
        year: new Date().getFullYear() + m / 12,
        contributions: Math.round(startBalance + totalContribs),
        gains: Math.round(gains),
        balance: Math.round(balance),
      });
    }
  }
  return data;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  const total = (payload[0]?.value ?? 0) + (payload[1]?.value ?? 0);
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 text-sm shadow-lg">
      <p className="font-semibold text-white mb-1">{label}</p>
      <p className="text-blue-300">Contributions: {formatEur(payload[0]?.value ?? 0)}</p>
      <p className="text-emerald-400">Plus-values: {formatEur(payload[1]?.value ?? 0)}</p>
      <p className="text-white font-semibold mt-1">Total: {formatEur(total)}</p>
    </div>
  );
};

export default function PatrimoineSimulator() {
  const navigate = useNavigate();
  const { appendScope } = useFilter();
  const { data, loading } = useApi<DashboardData>(appendScope(`${API}/dashboard`));

  const startingBalance = useMemo(() => {
    if (!data) return 0;
    return data.totals?.net ?? data.patrimoine?.netValue ?? 0;
  }, [data]);

  const [annualRate, setAnnualRate] = useState(5.0);
  const [monthlyContrib, setMonthlyContrib] = useState(500);
  const [duration, setDuration] = useState(10);
  const [inflation, setInflation] = useState(2.0);

  const chartData = useMemo(
    () => buildProjection(startingBalance, monthlyContrib, annualRate, duration),
    [startingBalance, monthlyContrib, annualRate, duration]
  );

  const finalPoint = chartData[chartData.length - 1];
  const totalContributions = monthlyContrib * duration * 12;
  const totalGains = finalPoint ? Math.max(0, finalPoint.balance - startingBalance - totalContributions) : 0;
  const finalBalance = finalPoint?.balance ?? startingBalance;
  const gain = finalBalance - startingBalance;
  const realRate = ((1 + annualRate / 100) / (1 + inflation / 100) - 1) * 100;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-900">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="flex items-center justify-between px-4 pt-6 pb-4">
        <button onClick={() => navigate('/analysis')} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
          <span className="text-sm">Analyses</span>
        </button>
        <h1 className="text-base font-semibold">Simulateur patrimoine</h1>
        <ScopeSelect />
      </div>

      <div className="px-4 pb-8 max-w-2xl mx-auto space-y-6">
        <div>
          <p className="text-sm text-gray-400">Patrimoine actuel</p>
          <p className="text-2xl font-bold text-white">{formatEur(startingBalance)}</p>
          <p className="text-sm text-gray-400 mt-1">
            Projection à {duration} ans:{' '}
            <span className="text-white font-semibold">{formatEur(finalBalance)}</span>
            {gain > 0 && (
              <span className="text-emerald-400 ml-2">(+{formatEur(gain)})</span>
            )}
          </p>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradContrib" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="gradGains" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <XAxis dataKey="year" tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(v) => formatEur(v, true)}
                tick={{ fill: '#9ca3af', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={55}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value) => (
                  <span style={{ fontSize: 12, color: '#d1d5db' }}>
                    {value === 'contributions' ? 'Contributions' : 'Plus-values'}
                  </span>
                )}
              />
              <Area type="monotone" dataKey="contributions" stackId="1" stroke="#3b82f6" fill="url(#gradContrib)" strokeWidth={2} />
              <Area type="monotone" dataKey="gains" stackId="1" stroke="#10b981" fill="url(#gradGains)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-800 rounded-2xl p-4 space-y-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Paramètres</h2>

          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Rendement annuel</span>
              <span className="font-semibold text-blue-400">{annualRate.toFixed(1)} %</span>
            </div>
            <input type="range" min={0} max={15} step={0.5} value={annualRate}
              onChange={e => setAnnualRate(parseFloat(e.target.value))}
              className="w-full h-1 cursor-pointer accent-blue-500" />
            <div className="flex justify-between text-xs text-gray-600"><span>0 %</span><span>15 %</span></div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-400">Épargne mensuelle</span>
              <div className="flex items-center gap-1">
                <input type="number" min={0} max={5000} step={50} value={monthlyContrib}
                  onChange={e => setMonthlyContrib(Math.max(0, Math.min(5000, parseInt(e.target.value) || 0)))}
                  className="w-24 text-right bg-gray-700 text-white text-sm rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                <span className="text-gray-400 text-sm">€</span>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Durée</span>
              <span className="font-semibold text-blue-400">{duration} ans</span>
            </div>
            <input type="range" min={1} max={30} step={1} value={duration}
              onChange={e => setDuration(parseInt(e.target.value))}
              className="w-full h-1 cursor-pointer accent-blue-500" />
            <div className="flex justify-between text-xs text-gray-600"><span>1 an</span><span>30 ans</span></div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Inflation</span>
              <span className="font-semibold text-blue-400">{inflation.toFixed(1)} %</span>
            </div>
            <input type="range" min={0} max={5} step={0.5} value={inflation}
              onChange={e => setInflation(parseFloat(e.target.value))}
              className="w-full h-1 cursor-pointer accent-blue-500" />
            <div className="flex justify-between text-xs text-gray-600"><span>0 %</span><span>5 %</span></div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="bg-gray-800 rounded-2xl p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Contributions</p>
            <p className="text-sm font-bold text-blue-400">{formatEur(totalContributions)}</p>
            <p className="text-xs text-gray-600 mt-1">{monthlyContrib} × {duration * 12}</p>
          </div>
          <div className="bg-gray-800 rounded-2xl p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Plus-values</p>
            <p className="text-sm font-bold text-emerald-400">{formatEur(totalGains)}</p>
            <p className="text-xs text-gray-600 mt-1">intérêts composés</p>
          </div>
          <div className="bg-gray-800 rounded-2xl p-4 text-center">
            <p className="text-xs text-gray-400 mb-1">Total</p>
            <p className="text-sm font-bold text-white">{formatEur(finalBalance)}</p>
            <p className="text-xs text-gray-600 mt-1">à {duration} ans</p>
          </div>
        </div>

        <p className="text-xs text-gray-600 text-center">
          Taux réel (corrigé inflation) : {realRate.toFixed(2)} %
        </p>
      </div>
    </div>
  );
}
