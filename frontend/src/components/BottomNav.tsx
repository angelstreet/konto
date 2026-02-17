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

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around max-w-lg mx-auto">
        {items.map(({ path, icon: Icon, labelKey }) => {
          const morePaths = ['/more', '/income', '/assets', '/loans', '/budget', '/analysis', '/cashflow', '/bilan', '/reports', '/ledger', '/vat', '/fec-export', '/reconciliation', '/simulators', '/import', '/outils', '/settings'];
          const active = path === '/more' ? morePaths.includes(pathname) : pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center py-3 px-3 text-xs transition-colors min-h-[56px] justify-center ${
                active ? 'text-accent-400' : 'text-muted hover:text-white'
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
              <span className="mt-1">{t(labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
