import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  Home,
  Wallet,
  FileBarChart,
  BarChart3,
  Wrench,
  GitCompareArrows,
  FileSpreadsheet,
  Settings,
  LucideIcon,
} from 'lucide-react';

interface MenuItem {
  path: string;
  icon: LucideIcon;
  labelKey: string;
  description?: string;
}

const menuItems: MenuItem[] = [
  { path: '/assets', icon: Home, labelKey: 'nav_assets' },
  { path: '/income', icon: Banknote, labelKey: 'nav_income' },
  { path: '/budget', icon: Wallet, labelKey: 'nav_budget' },
  { path: '/analysis', icon: BarChart3, labelKey: 'nav_analysis' },
  { path: '/bilan', icon: FileBarChart, labelKey: 'nav_bilan' },
  { path: '/reports', icon: FileSpreadsheet, labelKey: 'nav_reports' },
  { path: '/reconciliation', icon: GitCompareArrows, labelKey: 'nav_reconciliation' },
  { path: '/outils', icon: Wrench, labelKey: 'nav_outils' },
  { path: '/settings', icon: Settings, labelKey: 'settings' },
];

export default function More() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">{t('more') || 'Plus'}</h1>
      <div className="bg-surface rounded-xl border border-border divide-y divide-border">
        {menuItems.map(({ path, icon: Icon, labelKey }) => {
          const active = pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-hover ${
                active ? 'text-accent-400' : 'text-white'
              }`}
            >
              <Icon size={20} strokeWidth={1.5} className={active ? 'text-accent-400' : 'text-muted'} />
              <span className="text-sm font-medium">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
