import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Landmark,
  Building2,
  Home,
  TrendingUp,
  ArrowLeftRight,
  BarChart3,
  LineChart,
  BookOpen,
  Receipt,
  Calculator,
  Wallet,
  FileSpreadsheet,
  FileText,
  Upload,
  GitCompareArrows,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LucideIcon,
  Lock,
} from 'lucide-react';

interface NavItem {
  path: string;
  icon: LucideIcon;
  labelKey: string;
  disabled?: boolean;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    labelKey: '',
    items: [
      { path: '/', icon: LayoutDashboard, labelKey: 'nav_dashboard' },
    ],
  },
  {
    labelKey: 'nav_group_patrimoine',
    items: [
      { path: '/accounts', icon: Landmark, labelKey: 'nav_accounts' },
      { path: '/companies', icon: Building2, labelKey: 'nav_companies' },
      { path: '/real-estate', icon: Home, labelKey: 'nav_real_estate', disabled: true },
      { path: '/investments', icon: TrendingUp, labelKey: 'nav_investments', disabled: true },
    ],
  },
  {
    labelKey: 'nav_group_transactions',
    items: [
      { path: '/transactions', icon: ArrowLeftRight, labelKey: 'nav_transactions' },
    ],
  },
  {
    labelKey: 'nav_group_analyse',
    items: [
      { path: '/analysis', icon: BarChart3, labelKey: 'nav_analysis', disabled: true },
      { path: '/cashflow', icon: LineChart, labelKey: 'nav_cashflow', disabled: true },
    ],
  },
  {
    labelKey: 'nav_group_comptabilite',
    items: [
      { path: '/ledger', icon: BookOpen, labelKey: 'nav_ledger', disabled: true },
      { path: '/reports', icon: FileSpreadsheet, labelKey: 'nav_reports', disabled: true },
      { path: '/vat', icon: Receipt, labelKey: 'nav_vat', disabled: true },
      { path: '/fec-export', icon: FileText, labelKey: 'nav_fec_export', disabled: true },
    ],
  },
  {
    labelKey: 'nav_group_budget',
    items: [
      { path: '/budget', icon: Wallet, labelKey: 'nav_budget', disabled: true },
    ],
  },
  {
    labelKey: 'nav_group_outils',
    items: [
      { path: '/import', icon: Upload, labelKey: 'nav_import', disabled: true },
      { path: '/reconciliation', icon: GitCompareArrows, labelKey: 'nav_reconciliation', disabled: true },
      { path: '/simulators', icon: Calculator, labelKey: 'nav_simulators', disabled: true },
    ],
  },
];

interface Props {
  onLogout: () => void;
}

export default function Sidebar({ onLogout }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem('kompta_sidebar_collapsed');
    return stored === null ? true : stored === 'true';
  });

  // Track which group is currently active based on pathname
  const getActiveGroup = useCallback(() => {
    for (let gi = 0; gi < navGroups.length; gi++) {
      for (const item of navGroups[gi].items) {
        if (pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path))) {
          return gi;
        }
      }
    }
    return 0;
  }, [pathname]);

  const [openGroups, setOpenGroups] = useState<Set<number>>(() => {
    // Only open the group containing the active page + the first (dashboard) group
    const active = new Set<number>([0]);
    for (let gi = 0; gi < navGroups.length; gi++) {
      for (const item of navGroups[gi].items) {
        if (pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path))) {
          active.add(gi);
        }
      }
    }
    return active;
  });

  // Auto-open group when navigating to a page in it
  useEffect(() => {
    const ag = getActiveGroup();
    setOpenGroups(prev => {
      if (prev.has(ag)) return prev;
      const next = new Set(prev);
      next.add(ag);
      return next;
    });
  }, [pathname, getActiveGroup]);

  const toggleGroup = (gi: number) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(gi)) next.delete(gi);
      else next.add(gi);
      return next;
    });
  };

  useEffect(() => {
    localStorage.setItem('kompta_sidebar_collapsed', String(collapsed));
    window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed } }));
  }, [collapsed]);

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 bg-surface border-r border-border flex flex-col transition-all duration-200 z-50 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo + collapse toggle */}
      <div className="px-3 py-4 border-b border-border flex items-center justify-between min-h-[56px]">
        {!collapsed && (
          <h1 className="text-lg font-bold text-accent-400 tracking-tight">Kompta</h1>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-md text-muted hover:text-white hover:bg-surface-hover transition-colors"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1 scrollbar-thin">
        {navGroups.map((group, gi) => {
          const isOpen = openGroups.has(gi);
          const hasActiveItem = group.items.some(
            item => pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path))
          );

          return (
            <div key={gi}>
              {/* Group header — clickable to toggle */}
              {group.labelKey && !collapsed && (
                <button
                  onClick={() => toggleGroup(gi)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    hasActiveItem ? 'text-accent-400/70' : 'text-muted/50 hover:text-muted/80'
                  }`}
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown
                    size={12}
                    className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
                  />
                </button>
              )}
              {group.labelKey && collapsed && (
                <div className="border-t border-border/50 mx-2 my-1" />
              )}

              {/* Group items — show if no labelKey (dashboard), or if open, or if collapsed sidebar */}
              {(!group.labelKey || isOpen || collapsed) && (
                <div className="space-y-0.5">
                  {group.items.map(({ path, icon: Icon, labelKey, disabled }) => {
                    const active = pathname === path || (path !== '/' && pathname.startsWith(path));
                    return (
                      <button
                        key={path}
                        onClick={() => !disabled && navigate(path)}
                        disabled={disabled}
                        title={collapsed ? t(labelKey) : undefined}
                        className={`w-full flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors ${
                          collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'
                        } ${
                          disabled
                            ? 'text-muted/30 cursor-not-allowed'
                            : active
                            ? 'bg-accent-500/10 text-accent-400'
                            : 'text-muted hover:text-white hover:bg-surface-hover'
                        }`}
                      >
                        <Icon size={18} strokeWidth={active ? 2.5 : 1.5} />
                        {!collapsed && (
                          <span className="flex-1 text-left truncate">{t(labelKey)}</span>
                        )}
                        {!collapsed && disabled && <Lock size={12} className="text-muted/30" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Settings + Logout */}
      <div className="px-2 py-3 border-t border-border space-y-0.5">
        <button
          onClick={() => navigate('/settings')}
          title={collapsed ? t('settings') : undefined}
          className={`w-full flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors ${
            collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'
          } ${
            pathname === '/settings'
              ? 'bg-accent-500/10 text-accent-400'
              : 'text-muted hover:text-white hover:bg-surface-hover'
          }`}
        >
          <Settings size={18} strokeWidth={pathname === '/settings' ? 2.5 : 1.5} />
          {!collapsed && <span>{t('settings')}</span>}
        </button>
        <button
          onClick={onLogout}
          title={collapsed ? t('logout') : undefined}
          className={`w-full flex items-center gap-2.5 rounded-lg text-sm font-medium text-muted hover:text-red-400 hover:bg-surface-hover transition-colors ${
            collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2'
          }`}
        >
          <LogOut size={18} strokeWidth={1.5} />
          {!collapsed && <span>{t('logout')}</span>}
        </button>
      </div>
    </aside>
  );
}
