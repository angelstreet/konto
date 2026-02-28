import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
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

export default function CategoryDonut({ categories, totalExpense }: Props) {
  const { hideAmounts } = useAmountVisibility();
  const mask = (v: string) => hideAmounts ? <span className="amount-masked">{v}</span> : v;

  const data = categories.map(c => ({
    name: c.name,
    icon: c.icon,
    color: c.color,
    value: Math.abs(c.total),
    pct: c.pct,
  }));

  const top5 = data.slice(0, 5);

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">Répartition par catégorie</h3>
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative w-40 h-40 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={48} outerRadius={68} dataKey="value" stroke="none">
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: any) => [hideAmounts ? '••••' : formatCurrency(value as number)]}
                contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12, color: '#e5e5e5' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xs text-muted">Dépenses</span>
            <span className="text-sm font-bold text-red-400">{mask(formatCurrency(Math.abs(totalExpense)))}</span>
          </div>
        </div>
        <div className="flex-1 w-full space-y-2">
          {top5.map((cat, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className="text-base leading-none">{cat.icon}</span>
              <span className="text-muted capitalize flex-1 truncate">{cat.name}</span>
              <div className="w-16 h-1.5 rounded-full bg-surface-hover overflow-hidden flex-shrink-0">
                <div className="h-full rounded-full" style={{ width: `${cat.pct}%`, backgroundColor: cat.color }} />
              </div>
              <span className="text-muted w-8 text-right">{cat.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
