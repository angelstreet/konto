import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  Home,
  FileBarChart,
  BarChart3,
  LineChart,
  BookOpen,
  Receipt,
  FileText,
  FileSpreadsheet,
  Wallet,
  Upload,
  GitCompareArrows,
  Calculator,
  Settings,
  LucideIcon,
} from 'lucide-react';

interface MenuItem {
  path: string;
  icon: LucideIcon;
  labelKey: string;
  disabled?: boolean;
}

interface MenuGroup {
  labelKey: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    labelKey: 'nav_group_analyse',
    items: [
      { path: '/analysis', icon: BarChart3, labelKey: 'nav_analysis' },
      { path: '/cashflow', icon: LineChart, labelKey: 'nav_cashflow', disabled: true },
    ],
  },
  {
    labelKey: 'nav_group_revenus',
    items: [
      { path: '/income', icon: Banknote, labelKey: 'nav_income' },
    ],
  },
  {
    labelKey: 'nav_group_budget',
    items: [
      { path: '/budget', icon: Wallet, labelKey: 'nav_budget' },
    ],
  },
  {
    labelKey: 'nav_group_comptabilite',
    items: [
      { path: '/ledger', icon: BookOpen, labelKey: 'nav_ledger', disabled: true },
      { path: '/reports', icon: FileSpreadsheet, labelKey: 'nav_reports' },
      { path: '/vat', icon: Receipt, labelKey: 'nav_vat', disabled: true },
      { path: '/fec-export', icon: FileText, labelKey: 'nav_fec_export', disabled: true },
      { path: '/bilan', icon: FileBarChart, labelKey: 'nav_bilan' },
    ],
  },
  {
    labelKey: 'nav_group_patrimoine',
    items: [
      { path: '/assets', icon: Home, labelKey: 'nav_assets' },
    ],
  },
  {
    labelKey: 'nav_group_outils',
    items: [
      { path: '/import', icon: Upload, labelKey: 'nav_import', disabled: true },
      { path: '/reconciliation', icon: GitCompareArrows, labelKey: 'nav_reconciliation' },
      { path: '/simulators', icon: Calculator, labelKey: 'nav_simulators' },
    ],
  },
  {
    labelKey: '',
    items: [
      { path: '/settings', icon: Settings, labelKey: 'settings' },
    ],
  },
];

export default function More() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 h-10">
        <h1 className="text-xl font-semibold whitespace-nowrap">{t('more') || 'Plus'}</h1>
      </div>
      <div className="space-y-4">
        {menuGroups.map((group, gi) => (
          <div key={gi}>
            {group.labelKey && (
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted/50 px-1 mb-1.5">
                {t(group.labelKey)}
              </h2>
            )}
            <div className="bg-surface rounded-xl border border-border divide-y divide-border">
              {group.items.map(({ path, icon: Icon, labelKey, disabled }) => {
                const active = pathname === path;
                return (
                  <button
                    key={path}
                    onClick={() => !disabled && navigate(path)}
                    disabled={disabled}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                      disabled
                        ? 'text-muted/30 cursor-not-allowed'
                        : active
                        ? 'text-accent-400 hover:bg-surface-hover'
                        : 'text-white hover:bg-surface-hover'
                    }`}
                  >
                    <Icon size={20} strokeWidth={1.5} className={disabled ? 'text-muted/30' : active ? 'text-accent-400' : 'text-muted'} />
                    <span className="text-sm font-medium">{t(labelKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
