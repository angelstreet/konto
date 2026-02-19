import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserButton } from '@clerk/clerk-react';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
import {
  LayoutDashboard,
  Landmark,
  Building2,
  Home,
  ArrowLeftRight,
  BookOpen,
  Receipt,
  Calculator,
  BarChart3,
  Banknote,
  FileSpreadsheet,
  FileBarChart,
  GitCompareArrows,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LucideIcon,
  Lock,
  User,
  Briefcase,
  TrendingUp,
} from 'lucide-react';

/* ── Navigation data structure ──────────────────────────────────────── */

interface NavLeaf {
  kind: 'leaf';
  path: string;
  icon: LucideIcon;
  labelKey: string;
  disabled?: boolean;
}

interface NavSubGroup {
  kind: 'subgroup';
  labelKey: string;
  icon: LucideIcon;
  children: NavLeaf[];
}

type NavChild = NavLeaf | NavSubGroup;

interface NavGroup {
  labelKey: string;
  children: NavChild[];
}

const navGroups: NavGroup[] = [
  {
    labelKey: '',
    children: [
      { kind: 'leaf', path: '/', icon: LayoutDashboard, labelKey: 'nav_dashboard' },
    ],
  },
  {
    labelKey: 'nav_group_patrimoine',
    children: [
      { kind: 'leaf', path: '/accounts', icon: Landmark, labelKey: 'nav_accounts' },
      { kind: 'leaf', path: '/companies', icon: Building2, labelKey: 'nav_companies' },
      { kind: 'leaf', path: '/assets', icon: Home, labelKey: 'nav_assets' },
      { kind: 'leaf', path: '/property-roi', icon: TrendingUp, labelKey: 'nav_property_roi' },
    ],
  },
  {
    labelKey: 'nav_group_transactions',
    children: [
      { kind: 'leaf', path: '/transactions', icon: ArrowLeftRight, labelKey: 'nav_transactions' },
    ],
  },
  {
    labelKey: 'nav_group_analyse',
    children: [
      {
        kind: 'subgroup',
        labelKey: 'nav_scope_perso',
        icon: User,
        children: [
          { kind: 'leaf', path: '/income', icon: Banknote, labelKey: 'nav_income' },
          { kind: 'leaf', path: '/budget', icon: BarChart3, labelKey: 'nav_budget' },
          { kind: 'leaf', path: '/bilan', icon: FileBarChart, labelKey: 'nav_bilan' },
          { kind: 'leaf', path: '/trends', icon: TrendingUp, labelKey: 'nav_trends' },
        ],
      },
      {
        kind: 'subgroup',
        labelKey: 'nav_scope_pro',
        icon: Briefcase,
        children: [
          { kind: 'leaf', path: '/analysis', icon: BarChart3, labelKey: 'nav_budget' },
          { kind: 'leaf', path: '/bilan-pro', icon: FileBarChart, labelKey: 'nav_bilan_pro' },
          { kind: 'leaf', path: '/trends-pro', icon: TrendingUp, labelKey: 'nav_trends' },
          { kind: 'leaf', path: '/ledger', icon: BookOpen, labelKey: 'nav_ledger', disabled: true },
          { kind: 'leaf', path: '/vat', icon: Receipt, labelKey: 'nav_vat', disabled: true },
        ],
      },
    ],
  },
  {
    labelKey: 'nav_group_outils',
    children: [
      { kind: 'leaf', path: '/rapport-patrimoine', icon: FileSpreadsheet, labelKey: 'nav_rapport_patrimoine' },
      { kind: 'leaf', path: '/reconciliation', icon: GitCompareArrows, labelKey: 'nav_reconciliation' },
      { kind: 'leaf', path: '/simulators', icon: Calculator, labelKey: 'nav_simulators' },
    ],
  },
];

/* ── Helpers ─────────────────────────────────────────────────────────── */

function allPaths(children: NavChild[]): string[] {
  const paths: string[] = [];
  for (const c of children) {
    if (c.kind === 'leaf') paths.push(c.path);
    else paths.push(...c.children.map(l => l.path));
  }
  return paths;
}

function isActive(path: string, pathname: string) {
  if (pathname === path) return true;
  if (path === '/') return false;
  const rest = pathname.slice(path.length);
  return rest.startsWith('/') || rest.startsWith('?');
}

function childContainsActive(children: NavChild[], pathname: string): boolean {
  return allPaths(children).some(p => isActive(p, pathname));
}

/* ── Component ───────────────────────────────────────────────────────── */

interface Props {
  onLogout: () => void;
}

export default function Sidebar({ onLogout }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem('konto_sidebar_collapsed');
    return stored === null ? true : stored === 'true';
  });

  // Track open group (lvl1) — accordion: only one at a time
  const [openGroup, setOpenGroup] = useState<number | null>(() => {
    let active: number | null = null;
    navGroups.forEach((g, gi) => {
      if (childContainsActive(g.children, pathname)) active = gi;
    });
    return active;
  });

  const [openSubGroups, setOpenSubGroups] = useState<Set<string>>(() => {
    const active = new Set<string>();
    navGroups.forEach((g, gi) => {
      g.children.forEach((c, ci) => {
        if (c.kind === 'subgroup' && childContainsActive(c.children, pathname)) {
          active.add(`${gi}-${ci}`);
        }
      });
    });
    return active;
  });

  // Auto-open group/subgroups when navigating
  useEffect(() => {
    navGroups.forEach((g, gi) => {
      if (childContainsActive(g.children, pathname)) {
        setOpenGroup(gi);
      }
      g.children.forEach((c, ci) => {
        if (c.kind === 'subgroup' && childContainsActive(c.children, pathname)) {
          const key = `${gi}-${ci}`;
          setOpenSubGroups(prev => {
            if (prev.has(key)) return prev;
            const next = new Set(prev);
            next.add(key);
            return next;
          });
        }
      });
    });
  }, [pathname]);

  const toggleGroup = (gi: number) => {
    setOpenGroup(prev => prev === gi ? null : gi);
  };

  const toggleSubGroup = (key: string) => {
    setOpenSubGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    localStorage.setItem('konto_sidebar_collapsed', String(collapsed));
    window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed } }));
  }, [collapsed]);

  /* ── Render a leaf nav item ──────────────────────────────────────── */
  const renderLeaf = (item: NavLeaf, indent: number = 0) => {
    const active = isActive(item.path, pathname);
    const pl = collapsed ? 'px-0 justify-center' : indent === 0 ? 'px-2.5' : indent === 1 ? 'pl-5 pr-2.5' : 'pl-9 pr-2.5';
    return (
      <button
        key={item.path}
        onClick={() => !item.disabled && navigate(item.path)}
        disabled={item.disabled}
        title={collapsed ? t(item.labelKey) : undefined}
        className={`w-full flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors py-2 ${pl} ${
          item.disabled
            ? 'text-muted/30 cursor-not-allowed'
            : active
            ? 'bg-accent-500/10 text-accent-400'
            : 'text-muted hover:text-white hover:bg-surface-hover'
        }`}
      >
        <item.icon size={18} strokeWidth={active ? 2.5 : 1.5} />
        {!collapsed && (
          <span className="flex-1 text-left truncate">{t(item.labelKey)}</span>
        )}
        {!collapsed && item.disabled && <Lock size={12} className="text-muted/30" />}
      </button>
    );
  };

  /* ── Render a subgroup (lvl2) ────────────────────────────────────── */
  const renderSubGroup = (sg: NavSubGroup, gi: number, ci: number) => {
    const key = `${gi}-${ci}`;
    const hasActive = childContainsActive(sg.children, pathname);
    // Analyse subgroups (Perso/Pro) are always expanded — no collapse toggle
    const parentGroup = navGroups[gi];
    const alwaysOpen = parentGroup.labelKey === 'nav_group_analyse';
    const isOpen = alwaysOpen || openSubGroups.has(key);

    if (collapsed) {
      // In collapsed mode, show children directly with a divider
      return (
        <div key={key}>
          <div className="border-t border-border/30 mx-3 my-0.5" />
          {sg.children.map(leaf => renderLeaf(leaf, 0))}
        </div>
      );
    }

    return (
      <div key={key}>
        <div
          onClick={alwaysOpen ? undefined : () => toggleSubGroup(key)}
          className={`w-full flex items-center gap-2.5 rounded-lg text-sm font-medium transition-colors py-2 pl-5 pr-2.5 ${
            alwaysOpen ? 'cursor-default' : 'cursor-pointer'
          } ${
            hasActive ? 'text-accent-400/80' : 'text-muted/70 hover:text-white hover:bg-surface-hover'
          }`}
        >
          <sg.icon size={16} strokeWidth={hasActive ? 2 : 1.5} />
          <span className="flex-1 text-left truncate">{t(sg.labelKey)}</span>
          {!alwaysOpen && (
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
            />
          )}
        </div>
        {isOpen && (
          <div className="space-y-0.5">
            {sg.children.map(leaf => renderLeaf(leaf, 2))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 bg-surface border-r border-border flex flex-col transition-all duration-200 z-50 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo + collapse toggle */}
      <div className="px-3 py-4 border-b border-border flex items-center justify-between min-h-[56px]">
        {!collapsed && (
          <h1 className="text-lg font-bold text-accent-400 tracking-tight">Konto</h1>
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
          const isOpen = openGroup === gi;
          const hasActiveItem = childContainsActive(group.children, pathname);

          return (
            <div key={gi}>
              {/* Group header */}
              {group.labelKey && !collapsed && (
                <button
                  onClick={() => toggleGroup(gi)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[12px] font-semibold uppercase tracking-wider transition-colors ${
                    hasActiveItem ? 'text-accent-400/70' : 'text-muted/60 hover:text-muted/80'
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

              {/* Group children */}
              {(!group.labelKey || isOpen || collapsed) && (
                <div className="space-y-0.5">
                  {group.children.map((child, ci) =>
                    child.kind === 'leaf'
                      ? renderLeaf(child, 0)
                      : renderSubGroup(child, gi, ci)
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Settings + Logout / Clerk UserButton */}
      <div className="px-2 py-3 border-t border-border space-y-0.5">
        {clerkEnabled && (
          <div className={`flex items-center ${collapsed ? 'justify-center py-2' : 'px-2.5 py-2 gap-2.5'}`}>
            <UserButton
              afterSignOutUrl="/konto/"
              appearance={{
                elements: {
                  avatarBox: 'w-7 h-7',
                },
              }}
            />
            {!collapsed && <span className="text-sm text-muted">Account</span>}
          </div>
        )}
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
        {!clerkEnabled && (
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
        )}
      </div>
    </aside>
  );
}
