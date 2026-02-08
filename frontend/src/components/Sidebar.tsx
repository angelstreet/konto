import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Landmark,
  ArrowLeftRight,
  Building2,
  Settings,
  LogOut,
} from 'lucide-react';

const navItems = [
  { path: '/', icon: LayoutDashboard, labelKey: 'dashboard' },
  { path: '/accounts', icon: Landmark, labelKey: 'accounts' },
  { path: '/transactions', icon: ArrowLeftRight, labelKey: 'transactions' },
  { path: '/company', icon: Building2, labelKey: 'company' },
  { path: '/settings', icon: Settings, labelKey: 'settings' },
];

interface Props {
  onLogout: () => void;
}

export default function Sidebar({ onLogout }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-surface border-r border-border flex flex-col">
      {/* Logo */}
      <div className="px-6 py-6 border-b border-border">
        <h1 className="text-xl font-bold text-gold-500 tracking-tight">Kompta</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ path, icon: Icon, labelKey }) => {
          const active = pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-gold-500/10 text-gold-400'
                  : 'text-muted hover:text-white hover:bg-surface-hover'
              }`}
            >
              <Icon size={18} strokeWidth={active ? 2.5 : 1.5} />
              <span>{t(labelKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-border">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-muted hover:text-red-400 hover:bg-surface-hover transition-colors"
        >
          <LogOut size={18} strokeWidth={1.5} />
          <span>{t('logout')}</span>
        </button>
      </div>
    </aside>
  );
}
