import { useTranslation } from 'react-i18next';
import { TrendingUp, Wallet, Landmark } from 'lucide-react';
import { useApi } from '../useApi';

const API = '/kompta/api';

interface DashboardAccount {
  id: number;
  name: string;
  balance: number;
  type: string;
}

interface DashboardData {
  totalBalance: number;
  accountCount: number;
  connectionCount: number;
  companyCount: number;
  accounts: DashboardAccount[];
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { data, loading } = useApi<DashboardData>(`${API}/dashboard`);

  const kpis = [
    { key: 'balance', value: data ? formatCurrency(data.totalBalance) : '—', icon: Wallet, color: 'text-accent-400' },
    { key: 'accounts', value: data ? String(data.accountCount) : '—', icon: Landmark, color: 'text-blue-400' },
    { key: 'company', value: data ? String(data.companyCount) : '—', icon: TrendingUp, color: 'text-green-400' },
  ];

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
        {t('accounts')}
      </h2>
      {loading ? (
        <div className="text-center text-muted py-8">Loading...</div>
      ) : data?.accounts.length ? (
        <div className="bg-surface rounded-xl border border-border divide-y divide-border">
          {data.accounts.map((acc) => (
            <div key={acc.id} className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-medium">{acc.name}</p>
              <p className="text-sm font-semibold" style={{ color: '#d4a812' }}>
                {formatCurrency(acc.balance)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border p-6 text-center text-muted text-sm">
          {t('no_accounts')}
        </div>
      )}
    </div>
  );
}
