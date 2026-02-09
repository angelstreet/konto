import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

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
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

interface Props {
  data: { key: string; value: number }[];
  total: number;
  hideAmounts?: boolean;
  showNet?: boolean;
  loans?: number;
}

export default function DistributionDonut({ data, total, hideAmounts, showNet = true, loans = 0 }: Props) {
  const positiveData = data.filter(d => d.value > 0);
  if (positiveData.length === 0) return null;
  const fc = (n: number): React.ReactNode => hideAmounts ? <span className="amount-masked">{formatCurrency(n)}</span> : formatCurrency(n);

  return (
    <div className="bg-surface rounded-xl border border-border p-4 mb-4">
      <div>
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="w-40 h-40 relative flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
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
                contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-bold text-accent-400">{fc(total)}</span>
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          {positiveData.map(d => {
            const posSum = positiveData.reduce((s, x) => s + x.value, 0);
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
      </div>{/* end collapsible */}
    </div>
  );
}
