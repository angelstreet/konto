import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Treemap } from 'recharts';

const COLORS: Record<string, string> = {
  checking: '#9ca3af',
  savings: '#3b82f6',
  investment: '#a855f7',
  loan: '#f97316',
  real_estate: '#22c55e',
  vehicle: '#eab308',
  valuable: '#ec4899',
  other: '#6b7280',
};

const LABELS: Record<string, string> = {
  checking: 'Comptes courants',
  savings: 'Épargne',
  investment: 'Investissements',
  loan: 'Emprunts',
  real_estate: 'Immobilier',
  vehicle: 'Véhicules',
  valuable: 'Objets de valeur',
  other: 'Autres',
};

function formatCurrency(v: number) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

function TreemapCell({ x, y, width, height, name, value, posSum, hideAmounts }: any) {
  const label = LABELS[name] || name;
  const pct = posSum > 0 ? ((value / posSum) * 100).toFixed(1) : '0';
  const showLabel = width > 50 && height > 36;
  const showValue = width > 60 && height > 50;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4} fill={COLORS[name] || '#6b7280'} stroke="#1a1a1a" strokeWidth={2} />
      {showLabel && (
        <text x={x + width / 2} y={y + height / 2 - (showValue ? 8 : 0)} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={11} fontWeight={600}>
          {label}
        </text>
      )}
      {showValue && (
        <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle" dominantBaseline="central" fill="rgba(255,255,255,0.75)" fontSize={10}>
          {hideAmounts ? '••••' : `${formatCurrency(value)} (${pct}%)`}
        </text>
      )}
    </g>
  );
}

interface Props {
  data: { key: string; value: number }[];
  total: number;
  hideAmounts?: boolean;
  showNet?: boolean;
  loans?: number;
}

export default function DistributionDonut({ data, total, hideAmounts, showNet = true, loans = 0 }: Props) {
  const [view, setView] = useState<'donut' | 'treemap'>('donut');
  const positiveData = data.filter(d => d.value > 0);
  if (positiveData.length === 0) return null;
  const fc = (n: number): React.ReactNode => hideAmounts ? <span className="amount-masked">{formatCurrency(n)}</span> : formatCurrency(n);
  const posSum = positiveData.reduce((s, x) => s + x.value, 0);

  const treemapData = positiveData.map(d => ({ name: d.key, size: d.value }));

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted tracking-wide">Répartition du patrimoine</h3>
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
          <div className="w-40 h-40 relative flex-shrink-0" style={{ minWidth: 160, minHeight: 160 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
              <PieChart>
                <Pie
                  data={positiveData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  dataKey="value"
                  nameKey="key"
                  stroke="none"
                >
                  {positiveData.map((entry) => (
                    <Cell key={entry.key} fill={COLORS[entry.key] || '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any, name: any) => [fc(value as number), LABELS[name as string] || name]}
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-accent-400">{fc(total)}</span>
            </div>
          </div>
          <div className="flex-1 space-y-1.5">
            {positiveData.map(d => {
              const pct = posSum > 0 ? (d.value / posSum) * 100 : 0;
              return (
                <div key={d.key} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[d.key] || '#6b7280' }} />
                    <span className="text-muted">{LABELS[d.key] || d.key}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted">{pct.toFixed(1)}%</span>
                    <span className="font-medium">{fc(d.value)}</span>
                  </div>
                </div>
              );
            })}
            {showNet && loans < 0 && (
              <div className="flex items-center justify-between text-xs border-t border-border pt-1.5 mt-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS.loan }} />
                  <span className="text-muted">{LABELS.loan}</span>
                </div>
                <span className="font-medium text-orange-400">{fc(loans)}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <Treemap
                data={treemapData}
                dataKey="size"
                aspectRatio={4 / 3}
                content={<TreemapCell posSum={posSum} hideAmounts={hideAmounts} />}
              >
                <Tooltip
                  formatter={(value: any, name: any) => [hideAmounts ? '••••' : formatCurrency(value as number), LABELS[name as string] || name]}
                  contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
                />
              </Treemap>
            </ResponsiveContainer>
          </div>
          {showNet && loans < 0 && (
            <div className="flex items-center justify-between text-xs border-t border-border pt-1.5 mt-3">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS.loan }} />
                <span className="text-muted">{LABELS.loan}</span>
              </div>
              <span className="font-medium text-orange-400">{fc(loans)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
