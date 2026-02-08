import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';

const kpis = [
  { key: 'revenue', value: '€12,450', icon: TrendingUp, color: 'text-green-400' },
  { key: 'expenses', value: '€3,280', icon: TrendingDown, color: 'text-red-400' },
  { key: 'balance', value: '€9,170', icon: Wallet, color: 'text-gold-400' },
];

export default function Dashboard() {
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t('dashboard')}</h1>

      <div className="grid grid-cols-1 gap-3 mb-8">
        {kpis.map(({ key, value, icon: Icon, color }) => (
          <div key={key} className="bg-surface rounded-xl p-4 border border-border flex items-center gap-4">
            <Icon className={color} size={24} />
            <div>
              <p className="text-muted text-xs uppercase tracking-wide">{t(key)}</p>
              <p className="text-lg font-semibold">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-medium text-muted mb-3 uppercase tracking-wide">
        {t('recent_transactions')}
      </h2>
      <div className="bg-surface rounded-xl border border-border p-6 text-center text-muted text-sm">
        {t('no_transactions')}
      </div>
    </div>
  );
}
