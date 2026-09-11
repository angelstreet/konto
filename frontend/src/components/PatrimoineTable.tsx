import { Fragment, useMemo, useState } from 'react';
import { Plus, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react';
import {
  buildPatrimoineRows, sliceColor, AUTO_COLOR, TYPE_LABELS,
  type PatrimoineRow, type Side, type BuildOptions,
} from '../lib/patrimoineRows';

type SortKey = 'name' | 'typeLabel' | 'share' | 'value' | 'gain';
type SortDir = 'asc' | 'desc';

interface Props extends BuildOptions {
  formatCurrency: (n: number, from?: string) => string;
  hideAmounts: boolean;
}

/** Small ring showing a row's share of the total. */
function ShareRing({ pct, color }: { pct: number; color: string }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" className="flex-shrink-0 -rotate-90">
      <circle cx="9" cy="9" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
      <circle
        cx="9" cy="9" r={r} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
        strokeDasharray={`${(Math.min(pct, 100) / 100) * c} ${c}`}
      />
    </svg>
  );
}

function SortHeader({
  label, active, dir, onClick, align = 'left',
}: { label: string; active: boolean; dir: SortDir; onClick: () => void; align?: 'left' | 'right' }) {
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 text-xs font-medium transition-colors w-full ${
        align === 'right' ? 'justify-end' : ''
      } ${active ? 'text-foreground' : 'text-muted hover:text-foreground'}`}
    >
      {label}
      <Icon size={12} />
    </button>
  );
}

/** Multi-select filter chip (Type, Établissement). */
function FilterChip({
  label, options, selected, onChange,
}: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return null;
  const active = selected.length > 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${
          active
            ? 'border-accent-500 bg-accent-500/10 text-accent-400'
            : 'border-border text-muted hover:text-foreground hover:border-accent-500/50'
        }`}
      >
        {active ? <X size={13} onClick={e => { e.stopPropagation(); onChange([]); }} /> : <Plus size={13} />}
        {label}
        {active && <span className="tabular-nums">{selected.length}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-1 z-20 min-w-[190px] max-h-64 overflow-y-auto bg-surface border border-border rounded-lg shadow-xl py-1">
            {options.map(o => (
              <label
                key={o}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted hover:text-foreground hover:bg-surface-hover cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o)}
                  onChange={() => onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o])}
                  className="accent-current"
                />
                <span className="truncate">{o}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Detailed, filterable table of every holding — the tabular counterpart to
 * PatrimoineBreakdown on the Synthèse page.
 */
export default function PatrimoineTable({
  accountsByType, assets, showNet, hideCrypto, formatCurrency, hideAmounts,
}: Props) {
  const [side, setSide] = useState<Side>('actif');
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [institutions, setInstitutions] = useState<string[]>([]);
  const [groupByType, setGroupByType] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const allRows = useMemo(
    () => buildPatrimoineRows({ accountsByType, assets, showNet, hideCrypto }),
    [accountsByType, assets, showNet, hideCrypto],
  );

  const sideRows = useMemo(() => allRows.filter(r => r.side === side && r.value > 0), [allRows, side]);

  const typeOptions = useMemo(
    () => [...new Set(sideRows.map(r => r.typeLabel))].sort(),
    [sideRows],
  );
  const institutionOptions = useMemo(
    () => [...new Set(sideRows.map(r => r.institution).filter((x): x is string => !!x))].sort(),
    [sideRows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sideRows.filter(r => {
      if (types.length && !types.includes(r.typeLabel)) return false;
      if (institutions.length && (!r.institution || !institutions.includes(r.institution))) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.subtitle || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sideRows, types, institutions, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name) * dir;
        case 'typeLabel': return a.typeLabel.localeCompare(b.typeLabel) * dir;
        case 'gain': return ((a.gain ?? 0) - (b.gain ?? 0)) * dir;
        // Share is proportional to value, so both sort on the same field.
        case 'share':
        case 'value':
        default: return (a.value - b.value) * dir;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const filteredTotal = useMemo(() => sorted.reduce((s, r) => s + r.value, 0), [sorted]);
  const filteredGain = useMemo(
    () => sorted.reduce((s, r) => s + (r.gain ?? 0), 0),
    [sorted],
  );
  const gainBase = filteredTotal - filteredGain;
  const filteredGainPct = gainBase > 0 ? (filteredGain / gainBase) * 100 : null;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const fc = (n: number) =>
    hideAmounts ? <span className="amount-masked">{formatCurrency(n)}</span> : formatCurrency(n);

  const hasPassif = allRows.some(r => r.side === 'passif' && r.value > 0);

  // Rows are rendered flat, or bucketed under a type heading.
  const groups = useMemo(() => {
    if (!groupByType) return [{ label: null as string | null, rows: sorted }];
    const map = new Map<string, PatrimoineRow[]>();
    for (const r of sorted) {
      const list = map.get(r.typeLabel);
      if (list) list.push(r); else map.set(r.typeLabel, [r]);
    }
    return [...map.entries()]
      .map(([label, rows]) => ({ label, rows }))
      .sort((a, b) =>
        b.rows.reduce((s, r) => s + r.value, 0) - a.rows.reduce((s, r) => s + r.value, 0),
      );
  }, [sorted, groupByType]);

  const gainCell = (gain: number | null, pct: number | null) => {
    if (gain == null) return <span className="text-muted/40">—</span>;
    const positive = gain >= 0;
    const cls = positive ? 'text-green-400' : 'text-red-400';
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className={`tabular-nums ${cls}`}>
          {hideAmounts ? <span className="amount-masked">{formatCurrency(gain)}</span> : formatCurrency(gain)}
        </span>
        {pct != null && (
          <span className={`text-[11px] tabular-nums ${cls}`}>
            {positive ? '▲' : '▼'} {Math.abs(pct).toFixed(2).replace('.', ',')}%
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      {/* Tabs, filters and search share one row to keep the card compact */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border mb-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <div className="flex gap-5">
        {(['actif', 'passif'] as Side[]).map(s => {
          const active = side === s;
          const disabled = s === 'passif' && !hasPassif;
          return (
            <button
              key={s}
              onClick={() => { setSide(s); setTypes([]); setInstitutions([]); }}
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
        <div className="flex flex-wrap items-center gap-2 py-1.5">
          <FilterChip label="Type" options={typeOptions} selected={types} onChange={setTypes} />
          <FilterChip label="Établissement" options={institutionOptions} selected={institutions} onChange={setInstitutions} />
        </div>
        </div>
        <div className="flex items-center gap-3 py-1.5">
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            Grouper par type
            <button
              type="button"
              role="switch"
              aria-checked={groupByType}
              onClick={() => setGroupByType(v => !v)}
              className={`w-9 h-5 rounded-full transition-colors relative ${groupByType ? 'bg-accent-500' : 'bg-white/15'}`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  groupByType ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher"
              className="pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-full text-foreground placeholder:text-muted focus:outline-none focus:border-accent-500/60 w-40"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 pr-3"><SortHeader label="Nom" active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')} /></th>
              <th className="text-left py-2 px-3 w-32"><SortHeader label="Type" active={sortKey === 'typeLabel'} dir={sortDir} onClick={() => toggleSort('typeLabel')} /></th>
              <th className="text-left py-2 px-3 w-32"><SortHeader label="Répartition" active={sortKey === 'share'} dir={sortDir} onClick={() => toggleSort('share')} /></th>
              <th className="text-right py-2 px-3 w-32"><SortHeader label="Valeur" active={sortKey === 'value'} dir={sortDir} onClick={() => toggleSort('value')} align="right" /></th>
              <th className="text-right py-2 pl-3 w-32"><SortHeader label="+/- value" active={sortKey === 'gain'} dir={sortDir} onClick={() => toggleSort('gain')} align="right" /></th>
            </tr>
          </thead>
          <tbody>
            {/* Total */}
            <tr className="border-b border-border bg-white/[0.02]">
              <td className="py-3 pr-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Total</span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-white/5 text-muted">
                    {sorted.length} {side === 'actif' ? 'actif' : 'passif'}{sorted.length > 1 ? 's' : ''}
                  </span>
                </div>
              </td>
              <td className="px-3" />
              <td className="px-3" />
              <td className="px-3 text-right font-semibold tabular-nums">{fc(filteredTotal)}</td>
              <td className="pl-3 text-right">{gainCell(filteredGain || null, filteredGainPct)}</td>
            </tr>

            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-xs text-muted">Aucun résultat</td>
              </tr>
            )}

            {groups.map(group => (
              <Fragment key={group.label ?? '__flat__'}>
                {group.label && (
                  <tr className="bg-white/[0.02]">
                    <td colSpan={5} className="py-1.5 px-1 text-[11px] uppercase tracking-wider text-muted">
                      {group.label}
                    </td>
                  </tr>
                )}
                {group.rows.map((r, i) => {
                  const pct = filteredTotal > 0 ? (r.value / filteredTotal) * 100 : 0;
                  const color = sliceColor(AUTO_COLOR, i);
                  return (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-surface-hover/50 transition-colors">
                      <td className="py-3 pr-3 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                          <div className="min-w-0">
                            <p className="truncate text-foreground/90" title={r.name}>{r.name}</p>
                            {r.subtitle && <p className="text-[11px] text-muted truncate">{r.subtitle}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3">
                        <span className="text-[11px] px-2 py-1 rounded-md bg-white/5 text-muted whitespace-nowrap">
                          {r.typeLabel}
                        </span>
                      </td>
                      <td className="px-3">
                        <div className="flex items-center gap-2">
                          <ShareRing pct={pct} color={color} />
                          <span className="tabular-nums text-xs text-foreground/90">
                            {pct.toFixed(2).replace('.', ',')} %
                          </span>
                        </div>
                      </td>
                      <td className="px-3 text-right">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="tabular-nums">{fc(r.value)}</span>
                          {r.nativeValue != null && r.nativeCurrency && (
                            <span className="text-[11px] text-muted tabular-nums">
                              {hideAmounts
                                ? '••••'
                                : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(r.nativeValue)}{' '}
                              {r.nativeCurrency}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="pl-3 text-right">{gainCell(r.gain, r.gainPercent)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { TYPE_LABELS };
