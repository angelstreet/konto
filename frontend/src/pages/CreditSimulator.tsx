import { API } from '../config';
import { useState, useEffect, useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthFetch } from '../useApi';

interface Rate { duration: number; best_rate: number; avg_rate: number; updated_at: string }

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(v);
}

function formatCurrency0(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

function formatMobile(v: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(v));
}

export default function CreditSimulator() {
  const navigate = useNavigate();
  const authFetch = useAuthFetch();
  const [amount, setAmount] = useState(200000);
  const [duration, setDuration] = useState(20);
  const [differe, setDiffere] = useState(0);
  const [rate, setRate] = useState(3.35);
  const [insuranceRate, setInsuranceRate] = useState(0.34);
  const [rates, setRates] = useState<Rate[]>([]);
  const [showTable, setShowTable] = useState(false);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  useEffect(() => {
    authFetch(`${API}/rates/current`)
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

  // Deferred period: interest-only payments for `differe` months, then regular amortization
  const interestOnlyPayment = amount * monthlyRate;
  const activeMonths = months - differe;

  const monthlyPayment = useMemo(() => {
    if (activeMonths <= 0) return interestOnlyPayment;
    if (monthlyRate === 0) return amount / activeMonths;
    return (amount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -activeMonths));
  }, [amount, monthlyRate, activeMonths, interestOnlyPayment]);

  const totalCost = interestOnlyPayment * differe + (monthlyPayment * activeMonths - amount);
  const totalInsurance = insuranceMonthly * months;
  const totalRepaid = interestOnlyPayment * differe + monthlyPayment * activeMonths + totalInsurance;

  // Amortization schedule (with optional deferred period)
  const schedule = useMemo(() => {
    const rows: { month: number; payment: number; interest: number; capital: number; remaining: number; deferred?: boolean }[] = [];
    let remaining = amount;
    for (let m = 1; m <= months; m++) {
      if (m <= differe) {
        // Deferred: interest only, no capital repayment
        const interest = remaining * monthlyRate;
        rows.push({ month: m, payment: interest, interest, capital: 0, remaining, deferred: true });
      } else {
        const interest = remaining * monthlyRate;
        const capital = monthlyPayment - interest;
        remaining = Math.max(0, remaining - capital);
        rows.push({ month: m, payment: monthlyPayment, interest, capital, remaining });
      }
    }
    return rows;
  }, [amount, monthlyRate, months, monthlyPayment, differe]);

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
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => navigate('/more')} className="md:hidden text-muted hover:text-white transition-colors p-1 -ml-1 flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-semibold whitespace-nowrap">Simulateur de crédit</h1>
        </div>
        {rateUpdated && <span className="text-xs text-muted whitespace-nowrap flex-shrink-0">MAJ {rateUpdated.slice(0, 5)}</span>}
      </div>

      {/* Input sliders */}
      <div className="bg-surface rounded-xl border border-border p-4 mb-4 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-muted">Montant emprunté</label>
            <span className="text-sm font-bold text-accent-400">{formatCurrency0(amount)}</span>
          </div>
          <input type="range" min={10000} max={1000000} step={5000} value={amount} onChange={e => setAmount(+e.target.value)}
            className="w-full accent-amber-500" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-muted">Durée</label>
            <span className="text-sm font-bold text-accent-400">{duration} ans</span>
          </div>
          <input type="range" min={5} max={30} step={1} value={duration} onChange={e => setDuration(+e.target.value)}
            className="w-full accent-amber-500" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-muted">Différé</label>
            <span className="text-sm font-bold text-accent-400">{differe === 0 ? 'Aucun' : `${differe} mois`}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {[0, 1, 2, 3, 6, 9, 12].map(v => (
              <button
                key={v}
                onClick={() => setDiffere(v)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  differe === v
                    ? 'bg-accent-500 text-black border-accent-500 font-medium'
                    : 'bg-black/20 border-border text-muted hover:text-white hover:border-white/20'
                }`}
              >
                {v === 0 ? 'Aucun' : `${v}m`}
              </button>
            ))}
          </div>
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

      {/* Results — 2x2 grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-surface rounded-xl border border-border p-3 text-center">
          <p className="text-xs text-muted mb-1">Mensualité</p>
          {differe > 0 ? (
            <>
              <p className="text-[10px] text-muted">Différé (intérêts)</p>
              <p className="text-sm font-bold text-amber-400">{formatCurrency(interestOnlyPayment + insuranceMonthly)}</p>
              <p className="text-[10px] text-muted mt-0.5">Normal (avec ass.)</p>
              <p className="text-lg font-bold text-accent-400">{formatCurrency(monthlyPayment + insuranceMonthly)}</p>
            </>
          ) : (
            <p className="text-lg font-bold text-accent-400">
              {formatCurrency(monthlyPayment + insuranceMonthly)}
              <span className="text-[10px] font-normal text-muted ml-1">({formatCurrency(insuranceMonthly)} ass.)</span>
            </p>
          )}
        </div>
        <div className="bg-surface rounded-xl border border-border p-3 text-center">
          <p className="text-xs text-muted mb-1">Coût crédit</p>
          <p className="text-lg font-bold text-orange-400">{formatCurrency0(totalCost)}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-3 text-center">
          <p className="text-xs text-muted mb-1">Coût assurance</p>
          <p className="text-lg font-bold text-purple-400">{formatCurrency0(totalInsurance)}</p>
        </div>
        <div className="bg-surface rounded-xl border border-border p-3 text-center">
          <p className="text-xs text-muted mb-1">Total remboursé</p>
          <p className="text-lg font-bold">{formatCurrency0(totalRepaid)}</p>
        </div>
      </div>

      {/* Chart: stacked bar — capital vs interest per year */}
      <div className="bg-surface rounded-xl border border-border p-4 mb-4">
        <div className="mb-3">
          <h3 className="text-sm font-medium text-muted uppercase tracking-wide">Répartition annuelle des paiements</h3>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 0, right: 5, bottom: 0, left: 5 }} barCategoryGap="20%">
            <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
            <YAxis yAxisId="bars" tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} width={36} />
            <YAxis yAxisId="line" orientation="right" tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} width={36} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
              formatter={(value: any, name: any) => [
                formatCurrency(value as number),
                name === 'capital' ? '🟢 Capital remboursé' : name === 'interest' ? '🟠 Intérêts payés' : '⬜ Restant dû',
              ]}
              labelFormatter={(label: any) => `Année ${label}`}
            />
            <Legend formatter={(v: string) => v === 'capital' ? 'Capital remboursé' : v === 'interest' ? 'Intérêts payés' : 'Restant dû'} wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="bars" dataKey="interest" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
            <Bar yAxisId="bars" dataKey="capital" stackId="a" fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Line yAxisId="line" type="monotone" dataKey="remaining" stroke="#6b7280" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Amortization table toggle */}
      <button
        onClick={() => setShowTable(!showTable)}
        className="text-sm text-accent-400 hover:text-accent-300 mb-3 transition-colors py-3 min-h-[44px]"
      >
        {showTable ? '▼ Masquer' : '▶ Voir'} le tableau d'amortissement
      </button>

      {showTable && (
        <div className="bg-surface rounded-xl border border-border">
          <table className="w-full text-[11px] md:text-xs">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-muted uppercase border-b border-border">
                <th className="px-1 py-1 md:px-3 md:py-2 text-left">Année</th>
                <th className="px-1 py-1 md:px-3 md:py-2 text-right"><span className="md:hidden">Mens.</span><span className="hidden md:inline">Mensualité</span></th>
                <th className="px-1 py-1 md:px-3 md:py-2 text-right"><span className="md:hidden">Cap.</span><span className="hidden md:inline">Capital</span></th>
                <th className="px-1 py-1 md:px-3 md:py-2 text-right"><span className="md:hidden">Int.</span><span className="hidden md:inline">Intérêts</span></th>
                <th className="px-1 py-1 md:px-3 md:py-2 text-right"><span className="md:hidden">Reste</span><span className="hidden md:inline">Restant dû</span></th>
              </tr>
            </thead>
            <tbody>
              {schedule.filter((row, i) => {
                if (row.deferred) return i === differe - 1; // only show last deferred month
                return (row.month - differe) % 12 === 1 || i === schedule.length - 1; // yearly after deferral
              }).map(row => (
                <tr key={row.month} className={`border-b border-border/50 hover:bg-surface-hover ${row.deferred ? 'opacity-60' : ''}`}>
                  <td className="px-1 py-1 md:px-3 md:py-1.5">
                    {row.deferred
                      ? <span>M1–{differe} <span className="text-[9px] text-amber-400">diff.</span></span>
                      : `An ${Math.ceil((row.month - differe) / 12)}`}
                  </td>
                  <td className="px-1 py-1 md:px-3 md:py-1.5 text-right">{isMobile ? formatMobile(row.payment) : formatCurrency(row.payment)}</td>
                  <td className="px-1 py-1 md:px-3 md:py-1.5 text-right text-green-400">{isMobile ? formatMobile(row.capital) : formatCurrency(row.capital)}</td>
                  <td className="px-1 py-1 md:px-3 md:py-1.5 text-right text-orange-400">{isMobile ? formatMobile(row.interest) : formatCurrency(row.interest)}</td>
                  <td className="px-1 py-1 md:px-3 md:py-1.5 text-right">{isMobile ? formatMobile(row.remaining) : formatCurrency0(row.remaining)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
