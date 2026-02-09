import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Banknote,
  Home,
  FileBarChart,
  BarChart3,
  BookOpen,
  Receipt,
  Calculator,
  Wallet,
  FileSpreadsheet,
  Upload,
  GitCompareArrows,
  Settings,
  LucideIcon,
  ChevronDown,
  User,
  Briefcase,
  Lock,
} from 'lucide-react';

interface MenuItem {
  path: string;
  icon: LucideIcon;
  labelKey: string;
  disabled?: boolean;
}

interface MenuSubGroup {
  labelKey: string;
  icon: LucideIcon;
  items: MenuItem[];
}

interface MenuGroup {
  labelKey: string;
  items?: MenuItem[];
  subGroups?: MenuSubGroup[];
}

const menuGroups: MenuGroup[] = [
  {
    labelKey: 'nav_group_analyse',
    subGroups: [
      {
        labelKey: 'nav_scope_perso',
        icon: User,
        items: [
          { path: '/income', icon: Banknote, labelKey: 'nav_income' },
          { path: '/budget', icon: Wallet, labelKey: 'nav_budget' },
          { path: '/bilan', icon: FileBarChart, labelKey: 'nav_bilan' },
        ],
      },
      {
        labelKey: 'nav_scope_pro',
        icon: Briefcase,
        items: [
          { path: '/reports', icon: FileSpreadsheet, labelKey: 'nav_reports' },
          { path: '/analysis', icon: BarChart3, labelKey: 'nav_analysis' },
          { path: '/ledger', icon: BookOpen, labelKey: 'nav_ledger', disabled: true },
          { path: '/vat', icon: Receipt, labelKey: 'nav_vat', disabled: true },
        ],
      },
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
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => {
    // Auto-open subgroups containing active path
    const active = new Set<string>();
    menuGroups.forEach((g, gi) => {
      g.subGroups?.forEach((sg, si) => {
        if (sg.items.some(i => pathname === i.path)) {
          active.add(`${gi}-${si}`);
        }
      });
    });
    return active;
  });

  const toggleSub = (key: string) => {
    setOpenSubs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderItem = ({ path, icon: Icon, labelKey, disabled }: MenuItem) => {
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
        <span className="text-sm font-medium flex-1">{t(labelKey)}</span>
        {disabled && <Lock size={12} className="text-muted/30" />}
      </button>
    );
  };

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

            {/* Flat items */}
            {group.items && (
              <div className="bg-surface rounded-xl border border-border divide-y divide-border">
                {group.items.map(renderItem)}
              </div>
            )}

            {/* Nested subgroups */}
            {group.subGroups && (
              <div className="space-y-2">
                {group.subGroups.map((sg, si) => {
                  const key = `${gi}-${si}`;
                  const isOpen = openSubs.has(key);
                  const hasActive = sg.items.some(i => pathname === i.path);
                  return (
                    <div key={key} className="bg-surface rounded-xl border border-border overflow-hidden">
                      <button
                        onClick={() => toggleSub(key)}
                        className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors ${
                          hasActive ? 'text-accent-400' : 'text-white hover:bg-surface-hover'
                        }`}
                      >
                        <sg.icon size={20} strokeWidth={1.5} className={hasActive ? 'text-accent-400' : 'text-muted'} />
                        <span className="text-sm font-medium flex-1">{t(sg.labelKey)}</span>
                        <ChevronDown
                          size={14}
                          className={`text-muted transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
                        />
                      </button>
                      {isOpen && (
                        <div className="divide-y divide-border border-t border-border">
                          {sg.items.map(item => (
                            <button
                              key={item.path}
                              onClick={() => !item.disabled && navigate(item.path)}
                              disabled={item.disabled}
                              className={`w-full flex items-center gap-3 pl-8 pr-4 py-3 text-left transition-colors ${
                                item.disabled
                                  ? 'text-muted/30 cursor-not-allowed'
                                  : pathname === item.path
                                  ? 'text-accent-400 hover:bg-surface-hover'
                                  : 'text-white hover:bg-surface-hover'
                              }`}
                            >
                              <item.icon size={18} strokeWidth={1.5} className={item.disabled ? 'text-muted/30' : pathname === item.path ? 'text-accent-400' : 'text-muted'} />
                              <span className="text-sm font-medium flex-1">{t(item.labelKey)}</span>
                              {item.disabled && <Lock size={12} className="text-muted/30" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
