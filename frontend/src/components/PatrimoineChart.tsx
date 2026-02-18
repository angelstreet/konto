import { API } from '../config';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const ranges = ['1m', '3m', '6m', '1y', 'max'] as const;
const rangeLabels: Record<string, string> = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1A', max: 'Max' };

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

export default function PatrimoineChart({ showNet = true, hideAmounts = false }: { showNet?: boolean; hideAmounts?: boolean }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<string>('6m');
  const [data, setData] = useState<{ date: string; value: number }[]>([]);
  const [baselineDate, setBaselineDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ range, category: 'all' });
    if (showNet) params.set('net', '1');
    fetch(`${API}/dashboard/history?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        setData(d.history || []);
        setBaselineDate(d.baselineDate || null);
      })
      .finally(() => setLoading(false));
  }, [range, showNet]);

  const latestValue = data.length > 0 ? data[data.length - 1].value : 0;
  // Use the first snapshot on or after the baseline date (when current accounts were all present)
  const baselinePoint = baselineDate
    ? (data.find(d => d.date >= baselineDate) ?? data[0])
    : data[0];
  const firstValue = baselinePoint ? baselinePoint.value : 0;
  const change = latestValue - firstValue;
  const changePct = firstValue !== 0 ? (change / Math.abs(firstValue)) * 100 : 0;

  if (!loading && data.length < 2) return null;

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium text-muted tracking-wide">{t('patrimoine_evolution') || 'Évolution du patrimoine'}{!showNet ? ` (${t('balance_brut') || 'brut'})` : ''}</h3>
          {data.length > 0 && (
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-lg font-bold text-accent-400">{hideAmounts ? <span className="amount-masked">{formatCurrency(latestValue)}</span> : formatCurrency(latestValue)}</span>
              <span className={`text-xs font-medium ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {hideAmounts ? <span className="amount-masked">{change >= 0 ? '+' : ''}{formatCurrency(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%)</span> : <>{change >= 0 ? '+' : ''}{formatCurrency(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%)</>}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-1">
          {ranges.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                range === r ? 'bg-accent-500/20 text-accent-400' : 'text-muted hover:text-white hover:bg-surface-hover'
              }`}
            >
              {rangeLabels[r]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-muted text-sm">...</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
            <defs>
              <linearGradient id="patrimoineGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-accent-400, #d4a812)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-accent-400, #d4a812)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => {
                const date = new Date(d);
                return `${date.getDate()}/${date.getMonth() + 1}`;
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
              width={45}
            />
            <Tooltip
              formatter={(value: any) => [hideAmounts ? <span className="amount-masked">{formatCurrency(value as number)}</span> : formatCurrency(value as number), 'Patrimoine']}
              labelFormatter={(l: any) => new Date(String(l)).toLocaleDateString('fr-FR')}
              contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
              itemStyle={{ color: '#e5e5e5' }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#d4a812"
              strokeWidth={2}
              fill="url(#patrimoineGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
