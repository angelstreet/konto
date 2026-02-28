import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAmountVisibility } from '../AmountVisibilityContext';
import { useAuthFetch } from '../useApi';
import { API } from '../config';
import { useFilter } from '../FilterContext';
import { useEffect } from 'react';

interface DayData {
  date: string;
  income: number;
  expense: number;
  net: number;
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

function getColor(net: number): string {
  if (net === 0) return 'transparent';
  const intensity = Math.min(Math.abs(net) / 2000, 1);
  if (net > 0) {
    const g = Math.round(100 + intensity * 100);
    return `rgba(34, ${g + 55}, 62, ${0.3 + intensity * 0.5})`;
  } else {
    const r = Math.round(150 + intensity * 85);
    return `rgba(${r}, 50, 50, ${0.3 + intensity * 0.5})`;
  }
}

const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export default function CalendarHeatmap() {
  const authFetch = useAuthFetch();
  const { appendScope } = useFilter();
  const { hideAmounts } = useAmountVisibility();
  const [days, setDays] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [tooltip, setTooltip] = useState<{ day: DayData; x: number; y: number } | null>(null);

  useEffect(() => {
    setLoading(true);
    const url = appendScope(`${API}/analysis/cashflow?month=${current}`);
    authFetch(url)
      .then(r => r.json())
      .then(d => setDays(d.days || []))
      .finally(() => setLoading(false));
  }, [current]);

  const prevMonth = () => {
    const [y, m] = current.split('-').map(Number);
    const d = new Date(y, m - 2);
    setCurrent(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };
  const nextMonth = () => {
    const [y, m] = current.split('-').map(Number);
    const d = new Date(y, m);
    setCurrent(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const [year, month] = current.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  // Monday-based: 0=Mon,...,6=Sun
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (DayData | null)[] = [...Array(startOffset).fill(null)];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${current}-${String(d).padStart(2, '0')}`;
    cells.push(days.find(x => x.date === dateStr) || { date: dateStr, income: 0, expense: 0, net: 0 });
  }

  const monthLabel = new Date(year, month - 1).toLocaleString('fr-FR', { month: 'long', year: 'numeric' });

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="p-1 text-muted hover:text-white transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm font-medium capitalize">{monthLabel}</span>
        <button onClick={nextMonth} className="p-1 text-muted hover:text-white transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>

      {loading ? (
        <div className="text-center text-muted py-8 text-sm">Chargement...</div>
      ) : (
        <div className="relative">
          <div className="grid grid-cols-7 gap-1 mb-1">
            {DAY_LABELS.map((l, i) => (
              <div key={i} className="text-center text-xs text-muted py-1">{l}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell, i) => {
              if (!cell) return <div key={i} />;
              const d = new Date(cell.date).getDate();
              const bg = getColor(cell.net);
              const hasData = cell.income > 0 || cell.expense !== 0;
              return (
                <div
                  key={i}
                  className="aspect-square rounded-lg flex items-center justify-center text-xs cursor-pointer relative"
                  style={{ backgroundColor: hasData ? bg : undefined, border: hasData ? '1px solid rgba(255,255,255,0.05)' : '1px solid transparent' }}
                  onMouseEnter={e => {
                    if (hasData) {
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      setTooltip({ day: cell, x: rect.left, y: rect.bottom + 4 });
                    }
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <span className={hasData ? (cell.net >= 0 ? 'text-green-300' : 'text-red-300') : 'text-muted'}>
                    {d}
                  </span>
                </div>
              );
            })}
          </div>

          {tooltip && (
            <div
              className="fixed z-50 bg-background border border-border rounded-lg p-2 text-xs shadow-lg pointer-events-none"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <p className="text-muted mb-1">{new Date(tooltip.day.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</p>
              {tooltip.day.income > 0 && <p className="text-green-400">+{hideAmounts ? '••••' : formatCurrency(tooltip.day.income)}</p>}
              {tooltip.day.expense !== 0 && <p className="text-red-400">{hideAmounts ? '••••' : formatCurrency(tooltip.day.expense)}</p>}
              <p className={`font-medium ${tooltip.day.net >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                Net: {hideAmounts ? '••••' : formatCurrency(tooltip.day.net)}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted">
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(34, 155, 62, 0.6)' }} />
          <span>Revenus</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(220, 50, 50, 0.6)' }} />
          <span>Dépenses</span>
        </div>
      </div>
    </div>
  );
}
