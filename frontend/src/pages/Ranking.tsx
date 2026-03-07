import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthFetch } from '../useApi';
import { API } from '../config';

type RankingScope = 'konto' | 'country' | 'world';

type RefData = {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
};

type RankingResponse = {
  user?: {
    net_worth: number;
    income: number;
    savings_rate: number;
  };
  percentiles?: {
    net_worth: number;
    income: number;
    savings_rate: number;
  };
  refs?: Record<string, RefData>;
  scope?: RankingScope;
  user_country?: string | null;
  available?: boolean;
};

const COUNTRIES = [
  { value: 'FR', flag: '🇫🇷', label: 'France' },
  { value: 'DE', flag: '🇩🇪', label: 'Germany' },
  { value: 'CH', flag: '🇨🇭', label: 'Switzerland' },
  { value: 'US', flag: '🇺🇸', label: 'United States' },
  { value: 'CN', flag: '🇨🇳', label: 'China' },
];

const METRICS = [
  { key: 'net_worth' as const, label: 'Net Worth' },
  { key: 'income' as const, label: 'Income' },
  { key: 'savings_rate' as const, label: 'Savings Rate' },
];

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function clampPercentile(v: number) { return clamp(Math.round(v || 0), 1, 99); }

function getRankLabel(key: string, p: number): string {
  const top = Math.max(1, 100 - p);
  return key === 'savings_rate' && p < 50 ? `Bottom ${p}%` : `Top ${top}%`;
}

function getRankColor(p: number) {
  if (p >= 75) return { text: 'text-emerald-400', bg: 'bg-emerald-500', bgLight: 'bg-emerald-500/20' };
  if (p >= 50) return { text: 'text-blue-400', bg: 'bg-blue-500', bgLight: 'bg-blue-500/20' };
  if (p >= 25) return { text: 'text-amber-400', bg: 'bg-amber-500', bgLight: 'bg-amber-500/20' };
  return { text: 'text-red-400', bg: 'bg-red-500', bgLight: 'bg-red-500/20' };
}

function fmt(key: string, v: number | undefined): string {
  if (v === undefined || v === null) return '\u2014';
  if (key === 'savings_rate') return `${Math.round(v)}%`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v) + ' €';
}

function getTopLabel(p: number): string {
  return `Top ${Math.max(1, 100 - clampPercentile(p))}%`;
}

function getTier(percentile: number): string {
  if (percentile >= 95) return 'Gold II';
  if (percentile >= 90) return 'Gold III';
  if (percentile >= 75) return 'Silver I';
  if (percentile >= 50) return 'Silver II';
  return 'Bronze';
}

function getTierProgress(percentile: number) {
  const p = clampPercentile(percentile);
  const marks = [50, 75, 90, 95, 99];
  const next = marks.find((m) => p < m) ?? null;
  if (!next) return { nextTier: 'Legend', progress: 100, nextPercentile: null as number | null };
  const prev = marks.filter((m) => m < next).slice(-1)[0] ?? 1;
  const progress = Math.max(0, Math.min(100, ((p - prev) / (next - prev)) * 100));
  return { nextTier: getTier(next), progress, nextPercentile: next };
}

function PercentileBar({ percentile, colorClass }: { percentile: number; colorClass: string }) {
  const p = clampPercentile(percentile);
  return (
    <div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${p}%` }} />
      </div>
      <div className="flex justify-between items-center mt-1 text-[10px] text-white/45">
        <span>0%</span>
        <span>{p}%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export default function Ranking() {
  const { t } = useTranslation();
  const authFetch = useAuthFetch();

  const [scope, setScope] = useState<RankingScope>('world');
  const [country, setCountry] = useState('FR');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Record<string, RankingResponse>>({});

  useEffect(() => {
    let mounted = true;
    const cacheKey = scope === 'country' ? `${scope}:${country}` : scope;
    const cached = cacheRef.current[cacheKey];

    if (cached) {
      setData(cached);
      setLoading(false);
    }

    const load = async () => {
      if (!cached) setLoading(true);
      setRefreshing(Boolean(cached));
      setError(null);
      try {
        const params = new URLSearchParams({ scope });
        if (scope === 'country') params.set('country', country);
        const res = await authFetch(`${API}/ranking?${params.toString()}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Failed to load ranking');
        if (!mounted) return;
        if (scope === 'country' && json?.user_country) {
          setCountry(String(json.user_country).toUpperCase());
        }
        cacheRef.current[cacheKey] = json;
        setData(json);
      } catch (e: any) {
        if (mounted) setError(e?.message || 'Failed to load ranking');
      } finally {
        if (mounted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };
    load();
    return () => { mounted = false; };
  }, [scope, country, authFetch]);

  const percentiles = useMemo(() => ({
    net_worth: clampPercentile(data?.percentiles?.net_worth || 0),
    income: clampPercentile(data?.percentiles?.income || 0),
    savings_rate: clampPercentile(data?.percentiles?.savings_rate || 0),
  }), [data]);

  const overallPercentile = Math.round((percentiles.net_worth + percentiles.income + percentiles.savings_rate) / 3);
  const tier = getTier(overallPercentile);
  const rankLabel = getTopLabel(overallPercentile);
  const tierProgress = getTierProgress(overallPercentile);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <div className="flex items-center gap-1 min-w-0">
          <h1 className="text-xl font-semibold whitespace-nowrap">{t('nav_ranking') || 'Ranking'}</h1>
        </div>
      </div>

      {/* Single scope selector row */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
        <button
          onClick={() => setScope('konto')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all ${
            scope === 'konto'
              ? 'bg-zinc-700 text-white'
              : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
        >
          <span>🏠</span>
          <span>Konto</span>
        </button>
        <button
          onClick={() => setScope('world')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all ${
            scope === 'world'
              ? 'bg-zinc-700 text-white'
              : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
          }`}
        >
          <span>🌍</span>
          <span>World</span>
        </button>
        {COUNTRIES.map((c) => (
          <button
            key={c.value}
            onClick={() => { setScope('country'); setCountry(c.value); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all ${
              scope === 'country' && country === c.value
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
          >
            <span>{c.flag}</span>
            <span>{c.label}</span>
          </button>
        ))}
      </div>

      {loading && !data && <div className="text-sm text-muted py-8 text-center">Loading…</div>}
      {error && <div className="text-sm text-red-400 py-4">{error}</div>}

      {data && scope === 'konto' && data?.available === false && (
        <div className="bg-surface border border-border rounded-xl p-6 text-center text-muted">Not enough users yet</div>
      )}

      {data && (scope !== 'konto' || data?.available !== false) && (
        <div className={`transition-opacity duration-150 ${refreshing ? 'opacity-50' : 'opacity-100'}`}>
          <div className="bg-surface border border-border rounded-xl p-4 mb-4">
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-xs text-muted mb-1">Rank</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-white">{tier}</span>
                  <span className="text-sm text-emerald-400 font-semibold">{rankLabel}</span>
                </div>
                <div className="text-xs text-muted mt-1">Ahead of {overallPercentile}%</div>
              </div>
            </div>
            <div className="mt-3">
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-accent-400" style={{ width: `${tierProgress.progress}%` }} />
              </div>
              {tierProgress.nextPercentile ? (
                <div className="text-[11px] text-muted mt-1.5">
                  Next: {tierProgress.nextTier} · need Top {100 - tierProgress.nextPercentile}%
                </div>
              ) : (
                <div className="text-[11px] text-emerald-400 mt-1.5">Top tier reached</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {METRICS.map((m) => {
              const p = percentiles[m.key];
              const color = getRankColor(p);
              const label = getRankLabel(m.key, p);
              const val = fmt(m.key, data?.user?.[m.key]);

              return (
                <div key={m.key} className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <div className="text-xs text-muted">{m.label}</div>
                      <div className="text-sm font-semibold text-white mt-0.5">{val}</div>
                    </div>
                    <div className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block ${color.bgLight} ${color.text}`}>
                      {label}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted mb-1">Ahead of {p}%</div>
                  <PercentileBar percentile={p} colorClass={color.bg} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
