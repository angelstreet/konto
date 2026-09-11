import { useMemo, useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { ChevronDown, PieChart as PieIcon, Table2, SlidersHorizontal } from 'lucide-react';
import {
  buildPatrimoineRows, groupRows, withOtherBucket, sliceColor,
  type GroupBy, type PatrimoineRow, type Side, type BuildOptions,
} from '../lib/patrimoineRows';

const MAX_SLICES = 10;

const GROUP_OPTIONS: { id: GroupBy; label: string }[] = [
  { id: 'asset', label: 'Par actif' },
  { id: 'type', label: 'Par type' },
  { id: 'institution', label: 'Par établissement' },
];

interface Props extends BuildOptions {
  formatCurrency: (n: number, from?: string) => string;
  hideAmounts: boolean;
}

/**
 * Donut + ranked breakdown of every holding, with Actifs / Passifs tabs and a
 * grouping selector. Sits below the daily quote on the Synthèse page.
 */
export default function PatrimoineBreakdown({
  accountsByType, assets, showNet, hideCrypto, formatCurrency, hideAmounts,
}: Props) {
  const [side, setSide] = useState<Side>('actif');
  const [groupBy, setGroupBy] = useState<GroupBy>('asset');
  const [view, setView] = useState<'donut' | 'list'>('donut');
  const [compare, setCompare] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const allRows = useMemo(
    () => buildPatrimoineRows({ accountsByType, assets, showNet, hideCrypto }),
    [accountsByType, assets, showNet, hideCrypto],
  );

  const rows = useMemo(() => allRows.filter(r => r.side === side && r.value > 0), [allRows, side]);
  const slices = useMemo(() => withOtherBucket(groupRows(rows, groupBy), MAX_SLICES), [rows, groupBy]);
  const total = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices]);

  const fc = (n: number) =>
    hideAmounts ? <span className="amount-masked">{formatCurrency(n)}</span> : formatCurrency(n);

  const hasPassif = allRows.some(r => r.side === 'passif' && r.value > 0);
  const groupLabel = GROUP_OPTIONS.find(o => o.id === groupBy)?.label ?? 'Par actif';

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      {/* Tabs + controls */}
      <div className="flex items-center justify-between gap-3 border-b border-border mb-4">
        <div className="flex gap-6">
          {(['actif', 'passif'] as Side[]).map(s => {
            const active = side === s;
            const disabled = s === 'passif' && !hasPassif;
            return (
              <button
                key={s}
                onClick={() => setSide(s)}
                disabled={disabled}
                className={`relative pb-2.5 text-sm font-medium transition-colors ${
                  active ? 'text-accent-400' : disabled ? 'text-muted/40 cursor-not-allowed' : 'text-muted hover:text-foreground'
                }`}
              >
                {s === 'actif' ? 'Actifs' : 'Passifs'}
                {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-accent-400 rounded-full" />}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pb-2">
          {/* Grouping selector */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-border text-muted hover:text-foreground hover:border-accent-500/50 transition-colors"
            >
              {groupLabel}
              <ChevronDown size={14} className={menuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 mt-1 z-20 min-w-[170px] bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
                  {GROUP_OPTIONS.map(o => (
                    <button
                      key={o.id}
                      onClick={() => { setGroupBy(o.id); setMenuOpen(false); }}
                      className={`block w-full text-left px-3 py-2 text-xs transition-colors ${
                        groupBy === o.id ? 'text-accent-400 bg-accent-500/10' : 'text-muted hover:text-foreground hover:bg-surface-hover'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* View toggle */}
          <div className="flex bg-background rounded-full p-0.5 border border-border">
            <button
              onClick={() => setView('donut')}
              title="Graphique"
              className={`p-1.5 rounded-full transition-colors ${view === 'donut' ? 'bg-surface text-accent-400' : 'text-muted hover:text-foreground'}`}
            >
              <PieIcon size={15} />
            </button>
            <button
              onClick={() => setView('list')}
              title="Liste"
              className={`p-1.5 rounded-full transition-colors ${view === 'list' ? 'bg-surface text-accent-400' : 'text-muted hover:text-foreground'}`}
            >
              <Table2 size={15} />
            </button>
          </div>
        </div>
      </div>

      {slices.length === 0 ? (
        <p className="text-xs text-muted text-center py-10">Aucune donnée disponible</p>
      ) : (
        <>
          {/* Compare toggle */}
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setCompare(v => !v)}
              className={`flex items-center gap-1.5 text-xs transition-colors ${compare ? 'text-accent-400' : 'text-muted hover:text-accent-400'}`}
            >
              Comparer
              <SlidersHorizontal size={14} />
            </button>
          </div>

          <div className={`flex flex-col ${view === 'donut' ? 'lg:flex-row' : ''} items-center gap-6`}>
            {view === 'donut' && (
              <div className="relative flex-shrink-0" style={{ width: 220, height: 220 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={slices}
                      cx="50%"
                      cy="50%"
                      innerRadius={74}
                      outerRadius={105}
                      dataKey="value"
                      nameKey="label"
                      paddingAngle={2}
                      stroke="none"
                      isAnimationActive={false}
                    >
                      {slices.map((s, i) => (
                        <Cell key={s.key} fill={sliceColor(s.colorKey, i)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any, name: any) => [
                        hideAmounts ? '••••' : formatCurrency(value as number),
                        name,
                      ]}
                      contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-bold text-foreground">{fc(total)}</span>
                  <span className="text-xs text-muted">Total</span>
                </div>
              </div>
            )}

            {/* Ranked list */}
            <div className="flex-1 w-full space-y-2.5">
              {slices.map((s, i) => {
                const pct = total > 0 ? (s.value / total) * 100 : 0;
                const color = sliceColor(s.colorKey, i);
                return (
                  <div key={s.key} className="flex items-center gap-3 text-sm">
                    <span className="truncate text-foreground/90 w-[38%] min-w-0" title={s.label}>
                      {s.label}
                    </span>
                    <div className="flex-1 h-3 rounded-sm overflow-hidden bg-white/[0.04] min-w-0">
                      <div
                        className="h-full"
                        style={{
                          width: `${Math.max(pct, 1)}%`,
                          backgroundColor: color,
                          // Ticked bar, matching the reference design.
                          backgroundImage:
                            'repeating-linear-gradient(90deg, rgba(0,0,0,0.45) 0 1px, transparent 1px 4px)',
                        }}
                      />
                    </div>
                    <span className="tabular-nums text-right flex-shrink-0 w-20 text-foreground/90">
                      {compare ? fc(s.value) : `${pct.toFixed(2).replace('.', ',')} %`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type { PatrimoineRow };
