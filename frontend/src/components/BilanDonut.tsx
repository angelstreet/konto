import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Treemap } from 'recharts';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { usePreferences } from '../PreferencesContext';

// ── Colors ────────────────────────────────────────────────────────────────
const ACTIF_COLORS: Record<string, string> = {
  real_estate: '#22c55e',
  checking: '#9ca3af',
  savings: '#3b82f6',
  investment: '#a855f7',
  crypto: '#f59e0b',
  vehicle: '#eab308',
  valuable: '#ec4899',
  other: '#6b7280',
};

const PASSIF_COLORS: Record<string, string> = {
  loan: '#60a5fa',
  mortgage: '#818cf8',
  credit: '#c084fc',
  other: '#6b7280',
};

const DEFAULT_ACTIF_COLOR = '#9ca3af';
const DEFAULT_PASSIF_COLOR = '#818cf8';

// ── Helpers ───────────────────────────────────────────────────────────────
function TreemapCell({ x, y, width, height, name, value, posSum, hideAmounts, isPassif, formatCurrency }: any) {
  const label = name;
  const pct = posSum > 0 ? ((value / posSum) * 100).toFixed(1) : '0';
  const showLabel = width > 50 && height > 36;
  const showValue = width > 60 && height > 50;
  const colors = isPassif ? PASSIF_COLORS : ACTIF_COLORS;
  const defaultColor = isPassif ? DEFAULT_PASSIF_COLOR : DEFAULT_ACTIF_COLOR;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={colors[name] || defaultColor} stroke="transparent" strokeWidth={2} />
      {showLabel && (
        <text x={x + width / 2} y={y + height / 2 - (showValue ? 8 : 0)} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={11} fontWeight={600}>
          {label}
        </text>
      )}
      {showValue && (
        <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle" dominantBaseline="central" fill="rgba(255,255,255,0.75)" fontSize={10}>
          {hideAmounts ? '••••' : `${formatCurrency(value)} · ${pct}%`}
        </text>
      )}
    </g>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────
interface BilanItem { name: string; type: string; balance: number }

interface Props {
  actif: { items: BilanItem[]; total: number };
  passif: { items: BilanItem[]; total: number };
}

type Tab = 'actif' | 'passif';

// ── Component ──────────────────────────────────────────────────────────────
export default function BilanDonut({ actif, passif }: Props) {
  // Values are stored in EUR; render them in the user's display currency.
  const { formatCurrencyRounded: formatCurrency } = usePreferences();
  const [tab, setTab] = useState<Tab>('actif');
  const [view, setView] = useState<'donut' | 'treemap'>('donut');
  const { hideAmounts } = useAmountVisibility();
  const fc = (n: number) => hideAmounts ? <span className="amount-masked">{formatCurrency(n)}</span> : formatCurrency(n);

  const items = tab === 'actif' ? actif.items : passif.items;
  const total = tab === 'actif' ? actif.total : passif.total;
  const colors = tab === 'actif' ? ACTIF_COLORS : PASSIF_COLORS;
  const defaultColor = tab === 'actif' ? DEFAULT_ACTIF_COLOR : DEFAULT_PASSIF_COLOR;
  const isPassif = tab === 'passif';

  const positiveData = items.filter(d => d.balance > 0);

  if (positiveData.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex gap-4 mb-4">
          <button
            onClick={() => setTab('actif')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${tab === 'actif' ? 'border-accent-500 bg-accent-500/10 text-accent-400' : 'border-border text-muted hover:border-accent-500/50'}`}
          >
            Actif
          </button>
          <button
            onClick={() => setTab('passif')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${tab === 'passif' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-border text-muted hover:border-blue-500/50'}`}
          >
            Passif
          </button>
        </div>
        <p className="text-xs text-muted text-center py-8">Aucune donnée disponible</p>
      </div>
    );
  }

  const posSum = positiveData.reduce((s, x) => s + x.balance, 0);
  const pieData = positiveData.map(d => ({ key: d.type || 'other', value: d.balance, name: d.name }));
  const treemapData = positiveData.map(d => ({ name: d.name, size: d.balance }));

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      {/* Tabs + view toggle */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('actif')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${tab === 'actif' ? 'border-accent-500 bg-accent-500/10 text-accent-400' : 'border-border text-muted hover:border-accent-500/50'}`}
          >
            Actif
          </button>
          <button
            onClick={() => setTab('passif')}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${tab === 'passif' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-border text-muted hover:border-blue-500/50'}`}
          >
            Passif
          </button>
        </div>
        <div className="flex bg-background rounded-lg p-0.5 border border-border">
          <button
            onClick={() => setView('donut')}
            className={`px-2 py-0.5 text-xs rounded-md transition-colors ${view === 'donut' ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}
          >
            Donut
          </button>
          <button
            onClick={() => setView('treemap')}
            className={`px-2 py-0.5 text-xs rounded-md transition-colors ${view === 'treemap' ? 'bg-surface text-foreground shadow-sm' : 'text-muted hover:text-foreground'}`}
          >
            Treemap
          </button>
        </div>
      </div>

      {view === 'donut' ? (
        <div className="flex flex-col sm:flex-row items-center gap-4">
          {/* Donut */}
          <div className="w-44 h-44 relative flex-shrink-0" style={{ minWidth: 176, minHeight: 176 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={64}
                  dataKey="value"
                  nameKey="name"
                  stroke="none"
                  isAnimationActive={false}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.key} fill={colors[entry.key] || defaultColor} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any) => [fc(value as number), name]}
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-foreground">{fc(total)}</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-1.5 w-full">
            {positiveData.map(d => {
              const pct = posSum > 0 ? (d.balance / posSum) * 100 : 0;
              const color = colors[d.type || 'other'] || defaultColor;
              return (
                <div key={d.name} className="flex items-center justify-between text-xs gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="truncate text-muted">{d.name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-muted">{pct.toFixed(1)}%</span>
                    <span className="font-medium tabular-nums">{fc(d.balance)}</span>
                  </div>
                </div>
              );
            })}
            {/* % bars */}
            <div className="mt-2 space-y-1">
              {positiveData.map(d => {
                const pct = posSum > 0 ? (d.balance / posSum) * 100 : 0;
                const color = colors[d.type || 'other'] || defaultColor;
                return (
                  <div key={d.name}>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Treemap */
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={treemapData}
              dataKey="size"
              aspectRatio={4 / 3}
              isAnimationActive={false}
              content={<TreemapCell posSum={posSum} hideAmounts={hideAmounts} isPassif={isPassif} formatCurrency={formatCurrency} />}
            >
              <Tooltip
                formatter={(value: any, name: any) => [hideAmounts ? '••••' : formatCurrency(value as number), name]}
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
              />
            </Treemap>
          </ResponsiveContainer>
        </div>
      )}

      {/* Total */}
      <div className="mt-3 text-center text-sm font-semibold border-t border-border pt-3">
        Total {tab === 'actif' ? 'Actif' : 'Passif'}:{' '}
        <span className={tab === 'passif' ? 'text-blue-400' : 'text-accent-400'}>{fc(total)}</span>
      </div>
    </div>
  );
}
