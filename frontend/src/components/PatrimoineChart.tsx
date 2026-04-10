import { API } from '../config';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const ranges = ['1m', '3m', '6m', '1y', 'max'] as const;
const rangeLabels: Record<string, string> = { '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1A', max: 'Max' };

// Module-level cache survives unmount/remount + sessionStorage persistence
type ChartPoint = { date: string; value: number };
const CACHE_KEY = 'konto_patrimoine_chart_cache';
const chartCache: Record<string, ChartPoint[]> = (() => {
  try {
    const stored = sessionStorage.getItem(CACHE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
})();
function persistChartCache() {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(chartCache)); } catch {}
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

export default function PatrimoineChart({ showNet = true, hideAmounts = false }: { showNet?: boolean; hideAmounts?: boolean }) {
  const [range, setRange] = useState<string>('6m');
  const cacheKey = `${range}:${showNet ? 'net' : 'brut'}`;
  const [data, setData] = useState<{ date: string; value: number }[]>(() => chartCache[cacheKey] || []);
  const [loading, setLoading] = useState(!chartCache[cacheKey]);
  const initialLoaded = useRef(!!chartCache[cacheKey]);
  const prevShowNet = useRef(showNet);

  // Auth — get Clerk token for API calls
  let getToken: (() => Promise<string | null>) | undefined;
  const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (clerkEnabled) {
    try {
      const auth = useAuth();
      getToken = auth.getToken;
    } catch {}
  }
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  useEffect(() => {
    // Show cached data immediately if available, then refetch in background
    const cached = chartCache[cacheKey];
    if (cached) {
      setData(cached);
      setLoading(false);
      initialLoaded.current = true;
    } else {
      const isNetToggle = prevShowNet.current !== showNet;
      if (!isNetToggle) setLoading(true);
    }
    prevShowNet.current = showNet;

    const params = new URLSearchParams({ range, category: 'all' });
    if (showNet) params.set('net', '1');
    (async () => {
      const headers: Record<string, string> = {};
      if (clerkEnabled && getTokenRef.current) {
        const token = await getTokenRef.current();
        if (token) headers['Authorization'] = `Bearer ${token}`;
      }
      return fetch(`${API}/dashboard/history?${params.toString()}`, { headers });
    })()
      .then(r => r.json())
      .then(d => {
        const history = d.history || [];
        chartCache[cacheKey] = history;
        persistChartCache();
        setData(history);
        if (history.length >= 2) initialLoaded.current = true;
      })
      .finally(() => setLoading(false));
  }, [range, showNet, cacheKey]);

  const latestValue = data.length > 0 ? data[data.length - 1].value : 0;
  const firstValue = data.length > 0 ? data[0].value : 0;
  const change = latestValue - firstValue;
  const changePct = firstValue !== 0 ? (change / Math.abs(firstValue)) * 100 : 0;

  // Hide only if we never got valid data (initial load returned <2 points)
  const hasValidData = data.length >= 2;
  if (!loading && !hasValidData && !initialLoaded.current) return null;

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="mb-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-sm font-medium text-muted tracking-wide whitespace-nowrap">{showNet ? 'Patrimoine net' : 'Patrimoine brut'}</h3>
          {hasValidData && (
            <>
              <span className="text-lg font-bold text-accent-400 whitespace-nowrap">{hideAmounts ? <span className="amount-masked">{formatCurrency(latestValue)}</span> : formatCurrency(latestValue)}</span>
              <span className={`text-xs font-medium whitespace-nowrap ${change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {hideAmounts ? <span className="amount-masked">{change >= 0 ? '+' : ''}{formatCurrency(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%)</span> : <>{change >= 0 ? '+' : ''}{formatCurrency(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(1)}%)</>}
              </span>
            </>
          )}
          <div className="flex gap-1 ml-auto flex-shrink-0">
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
      </div>

      {loading && !hasValidData ? (
        <div className="h-48 flex items-center justify-center text-muted text-sm">...</div>
      ) : hasValidData ? (
        <ResponsiveContainer width="100%" height={240}>
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
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
