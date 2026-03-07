import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Landmark, MoreHorizontal, Menu } from 'lucide-react';
import { useState } from 'react';

// Mobile: 4 items max with hamburger for more
const mobileItems = [
  { path: '/', icon: LayoutDashboard, labelKey: 'nav_dashboard' },
  { path: '/accounts', icon: Landmark, labelKey: 'nav_accounts' },
  { path: '/transactions', icon: MoreHorizontal, labelKey: 'nav_transactions' },
  { path: 'more', icon: Menu, labelKey: 'more', isHamburger: true },
];

const morePaths = ['/more', '/income', '/assets', '/loans', '/budget', '/analysis', '/cashflow', '/bilan', '/bilan-pro', '/reports', '/ledger', '/vat', '/fec-export', '/reconciliation', '/simulators', '/import', '/outils', '/settings', '/ranking', '/fiscal', '/crypto', '/actions-fonds', '/property-roi', '/banking-score', '/subscriptions', '/trends', '/rapport-patrimoine', '/privacy'];

const moreLinks = [
  { path: '/accounts', label: 'Accounts' },
  { path: '/transactions', label: 'Transactions' },
  { path: '/loans', label: 'Loans' },
  { path: '/settings', label: 'Settings' },
  { path: '/fiscal', label: 'Fiscal' },
  { path: '/crypto', label: 'Crypto' },
  { path: '/banking-score', label: 'Banking Score' },
  { path: '/subscriptions', label: 'Subscriptions' },
  { path: '/privacy', label: 'Privacy Policy' },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [showDrawer, setShowDrawer] = useState(false);

  const items = mobileItems;

  const handleItemClick = (item: typeof items[0]) => {
    if (item.isHamburger) {
      setShowDrawer(true);
    } else {
      navigate(item.path);
    }
  };

  const isActive = (path: string) => {
    if (path === '/more' || path === 'more') {
      return morePaths.includes(pathname) || pathname.startsWith('/loans/');
    }
    return pathname === path;
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border pb-[env(safe-area-inset-bottom)] z-50">
        <div className="flex justify-around max-w-lg mx-auto">
          {items.map(({ path, icon: Icon, labelKey, isHamburger }) => {
            const active = isActive(path);
            return (
              <button
                key={path}
                onClick={() => handleItemClick({ path, icon: Icon, labelKey, isHamburger })}
                className={`flex flex-col items-center py-3 px-2 text-xs transition-colors min-h-[56px] justify-center flex-1 ${
                  active ? 'text-accent-400' : 'text-muted hover:text-white'
                }`}
              >
                <Icon size={22} strokeWidth={active ? 2.5 : 1.5} />
                <span className="mt-1">{isHamburger ? 'More' : t(labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Drawer overlay */}
      {showDrawer && (
        <div 
          className="fixed inset-0 bg-black/50 z-50"
          onClick={() => setShowDrawer(false)}
        >
          <div 
            className="absolute bottom-20 left-2 right-2 bg-surface border border-border rounded-lg shadow-xl p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {moreLinks.map(({ path, label }) => (
              <button
                key={path}
                onClick={() => {
                  navigate(path);
                  setShowDrawer(false);
                }}
                className={`w-full text-left px-4 py-3 text-sm rounded hover:bg-white/10 ${
                  pathname === path ? 'text-accent-400' : 'text-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
