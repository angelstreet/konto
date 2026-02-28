import { useAmountVisibility } from '../AmountVisibilityContext';

interface Category {
  name: string;
  icon: string;
  color: string;
  total: number;
  count: number;
  pct: number;
}

interface Props {
  categories: Category[];
  totalExpense: number;
}

function formatCurrency(v: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

export default function CategoryBreakdown({ categories }: Props) {
  const { hideAmounts } = useAmountVisibility();
  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Détail par catégorie</h3>
      <div className="space-y-3">
        {categories.map((cat, i) => {
          const pct = cat.pct;
          return (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-sm">
                  <span>{cat.icon}</span>
                  <span className="capitalize">{cat.name}</span>
                  <span className="text-xs text-muted">({cat.count})</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted text-xs">{pct}%</span>
                  <span className="text-red-400 font-medium w-24 text-right">{mask(formatCurrency(Math.abs(cat.total)))}</span>
                </div>
              </div>
              <div className="h-1.5 bg-surface-hover rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: cat.color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
