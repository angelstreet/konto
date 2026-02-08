import { API } from '../config';
import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';


interface Rate { duration: number; best_rate: number; avg_rate: number; updated_at: string }

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
}

function formatCurrency0(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

export default function CreditSimulator() {
  const [amount, setAmount] = useState(200000);
  const [duration, setDuration] = useState(20);
  const [rate, setRate] = useState(3.35);
  const [insuranceRate, setInsuranceRate] = useState(0.34);
  const [rates, setRates] = useState<Rate[]>([]);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    fetch(`${API}/rates/current`)
      .then(r => r.json())
      .then(d => {
        setRates(d.rates || []);
        const match = (d.rates || []).find((r: Rate) => r.duration === duration);
        if (match) setRate(match.avg_rate);
      });
  }, []);

  // Auto-fill rate when duration changes
  useEffect(() => {
    const match = rates.find(r => r.duration === duration);
    if (match) setRate(match.avg_rate);
  }, [duration, rates]);

  const monthlyRate = rate / 100 / 12;
  const months = duration * 12;
  const insuranceMonthly = (amount * insuranceRate / 100) / 12;

  const monthlyPayment = useMemo(() => {
    if (monthlyRate === 0) return amount / months;
    return (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -months));
  }, [amount, monthlyRate, months]);

  const totalCost = monthlyPayment * months - amount;
  const totalInsurance = insuranceMonthly * months;
  const totalRepaid = monthlyPayment * months + totalInsurance;

  // Amortization schedule
  const schedule = useMemo(() => {
    const rows: { month: number; payment: number; interest: number; capital: number; remaining: number }[] = [];
    let remaining = amount;
    for (let m = 1; m <= months; m++) {
      const interest = remaining * monthlyRate;
      const capital = monthlyPayment - interest;
      remaining = Math.max(0, remaining - capital);
      rows.push({ month: m, payment: monthlyPayment, interest, capital, remaining });
    }
    return rows;
  }, [amount, monthlyRate, months, monthlyPayment]);

  // Chart data (yearly summary)
  const chartData = useMemo(() => {
    const yearly: { year: number; capital: number; interest: number; remaining: number }[] = [];
    for (let y = 1; y <= duration; y++) {
      const yearRows = schedule.filter(r => r.month > (y - 1) * 12 && r.month <= y * 12);
      yearly.push({
        year: y,
        capital: yearRows.reduce((s, r) => s + r.capital, 0),
        interest: yearRows.reduce((s, r) => s + r.interest, 0),
        remaining: yearRows[yearRows.length - 1]?.remaining || 0,
      });
    }
    return yearly;
  }, [schedule, duration]);

  const rateUpdated = rates[0]?.updated_at ? new Date(rates[0].updated_at).toLocaleDateString('fr-FR') : '';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Simulation de crédit</h1>
        {rateUpdated && <span className="text-xs text-muted">Taux mis à jour le {rateUpdated}</span>}
      </div>

      {/* Input sliders */}
      <div className="bg-surface rounded-xl border border-border p-4 mb-4 space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-muted">Montant emprunté</label>
            <span className="text-sm font-bold text-accent-400">{formatCurrency0(amount)}</span>
          </div>
          <input type="range" min={10000} max={1000000} step={5000} value={amount} onChange={e => setAmount(+e.target.value)}
            className="w-full accent-amber-500" />
          <div className="flex justify-between text-[10px] text-muted"><span>10k€</span><span>1M€</span></div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-muted">Durée</label>
            <span className="text-sm font-bold text-accent-400">{duration} ans</span>
          </div>
          <input type="range" min={5} max={30} step={1} value={duration} onChange={e => setDuration(+e.target.value)}
            className="w-full accent-amber-500" />
          <div className="flex justify-between text-[10px] text-muted"><span>5 ans</span><span>30 ans</span></div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">Taux d'intérêt (%)</label>
            <input type="number" step={0.01} value={rate} onChange={e => setRate(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Taux assurance (%)</label>
            <input type="number" step={0.01} value={insuranceRate} onChange={e => setInsuranceRate(+e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-surface rounded-xl border border-border p-3 text-center">
          <p className="text-xs text-muted mb-1">Mensualité</p>
          <p className="text-lg font-bold text-accent-400">{formatCurrency(monthlyPayment)}</p>
          <p className="text-[10px] text-muted">dont assurance {formatCurrency(insuranceMonthly)}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-3 text-center">
          <p className="text-xs text-muted mb-1">Coût du crédit</p>
          <p className="text-lg font-bold text-orange-400">{formatCurrency0(totalCost)}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-3 text-center">
          <p className="text-xs text-muted mb-1">Coût assurance</p>
          <p className="text-lg font-bold text-purple-400">{formatCurrency0(totalInsurance)}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-3 text-center col-span-2 sm:col-span-3">
          <p className="text-xs text-muted mb-1">Total remboursé</p>
          <p className="text-lg font-bold">{formatCurrency0(totalRepaid)}</p>
        </div>
      </div>

      {/* Chart: capital vs interest over time */}
      <div className="bg-surface rounded-xl border border-border p-4 mb-4">
        <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Capital vs Intérêts par année</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
            <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              formatter={(value: any, name: any) => [formatCurrency(value as number), name === 'capital' ? 'Capital' : name === 'interest' ? 'Intérêts' : 'Restant dû']}
              contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
            />
            <Legend formatter={(v: string) => v === 'capital' ? 'Capital' : v === 'interest' ? 'Intérêts' : 'Restant dû'} />
            <Line type="monotone" dataKey="capital" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="interest" stroke="#f97316" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="remaining" stroke="#6b7280" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Amortization table toggle */}
      <button
        onClick={() => setShowTable(!showTable)}
        className="text-sm text-accent-400 hover:text-accent-300 mb-3 transition-colors"
      >
        {showTable ? '▼ Masquer' : '▶ Voir'} le tableau d'amortissement
      </button>

      {showTable && (
        <div className="bg-surface rounded-xl border border-border overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-muted uppercase border-b border-border">
                <th className="px-3 py-2 text-left">Mois</th>
                <th className="px-3 py-2 text-right">Mensualité</th>
                <th className="px-3 py-2 text-right">Capital</th>
                <th className="px-3 py-2 text-right">Intérêts</th>
                <th className="px-3 py-2 text-right">Restant dû</th>
              </tr>
            </thead>
            <tbody>
              {schedule.filter((_, i) => i % 12 === 0 || i === schedule.length - 1).map(row => (
                <tr key={row.month} className="border-b border-border/50 hover:bg-surface-hover">
                  <td className="px-3 py-1.5">{row.month}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrency(row.payment)}</td>
                  <td className="px-3 py-1.5 text-right text-green-400">{formatCurrency(row.capital)}</td>
                  <td className="px-3 py-1.5 text-right text-orange-400">{formatCurrency(row.interest)}</td>
                  <td className="px-3 py-1.5 text-right">{formatCurrency0(row.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
