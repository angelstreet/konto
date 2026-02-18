import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Landmark, ArrowLeftRight, Building2, Bitcoin, BarChart3, MoreHorizontal } from 'lucide-react';

const items = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav_dashboard' },
  { path: '/accounts', icon: Landmark, labelKey: 'nav_accounts' },
  { path: '/transactions', icon: ArrowLeftRight, labelKey: 'nav_transactions' },
  { path: '/companies', icon: Building2, labelKey: 'nav_companies' },
  { path: '/crypto', icon: Bitcoin, labelKey: 'nav_crypto' },
  { path: '/stocks', icon: BarChart3, labelKey: 'nav_stocks' },
  { path: '/more', icon: MoreHorizontal, labelKey: 'more' },
];

const morePaths = [
  '/more', '/income', '/assets', '/loans', '/budget', '/analysis', '/cashflow',
  '/bilan', '/reports', '/ledger', '/vat', '/fec-export', '/reconciliation',
  '/simulators', '/import', '/outils', '/settings', '/autres-actifs',
  '/loans', '/fonds-euros', '/property-roi', '/trends', '/trends-pro',
];

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-md border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex justify-around max-w-lg mx-auto px-1">
        {items.map(({ path, icon: Icon, labelKey }) => {
          const active = path === '/more' ? morePaths.includes(pathname) : pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="relative flex flex-col items-center py-2 px-2 flex-1 min-h-[56px] justify-center group"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {/* Active indicator pill */}
              {active && (
                <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-accent-400" />
              )}
              <Icon
                size={22}
                strokeWidth={active ? 2.5 : 1.5}
                className={`transition-colors duration-150 ${active ? 'text-accent-400' : 'text-muted group-hover:text-white'}`}
              />
              <span className={`mt-1 text-[10px] font-medium transition-colors duration-150 leading-none ${active ? 'text-accent-400' : 'text-muted group-hover:text-white'}`}>
                {t(labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
