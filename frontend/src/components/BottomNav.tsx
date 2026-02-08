import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Landmark, ArrowLeftRight, MoreHorizontal } from 'lucide-react';

const items = [
  { path: '/', icon: LayoutDashboard, labelKey: 'dashboard' },
  { path: '/accounts', icon: Landmark, labelKey: 'accounts' },
  { path: '/transactions', icon: ArrowLeftRight, labelKey: 'transactions' },
  { path: '/settings', icon: MoreHorizontal, labelKey: 'more' },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border">
      <div className="flex justify-around max-w-lg mx-auto">
        {items.map(({ path, icon: Icon, labelKey }) => {
          const active = pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center py-2 px-3 text-xs transition-colors ${
                active ? 'text-gold-400' : 'text-muted hover:text-white'
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
