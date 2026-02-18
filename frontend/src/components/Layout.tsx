import { ReactNode, useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import { isSandbox, disableSandbox } from '../sandbox';

interface Props {
  children: ReactNode;
  onLogout: () => void;
}

export default function Layout({ children, onLogout }: Props) {
  const location = useLocation();
  const [transitionKey, setTransitionKey] = useState(location.pathname);
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (prevPath.current !== location.pathname) {
      prevPath.current = location.pathname;
      setTransitionKey(location.pathname);
    }
  }, [location.pathname]);

  const [collapsed, setCollapsed] = useState(
    () => {
      const stored = localStorage.getItem('konto_sidebar_collapsed');
      return stored === null ? true : stored === 'true';
    }
  );

  useEffect(() => {
    const theme = localStorage.getItem('konto_theme') || 'gold';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setCollapsed(detail.collapsed);
    };
    window.addEventListener('sidebar-toggle', handler);
    return () => window.removeEventListener('sidebar-toggle', handler);
  }, []);

  const sandbox = isSandbox();

  const handleLogout = () => {
    if (sandbox) disableSandbox();
    onLogout();
  };

  return (
    <div className="min-h-screen bg-background">
      {sandbox && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-center text-xs text-amber-400 flex items-center justify-center gap-2">
          <span>🎮</span>
          <span className="truncate">Mode démo — données fictives, rien n'est sauvegardé</span>
          <button onClick={handleLogout} className="ml-2 underline hover:text-amber-300 py-1 px-2 min-h-[44px] flex items-center">Quitter</button>
        </div>
      )}
      <div className="hidden md:block">
        <Sidebar onLogout={handleLogout} />
      </div>

      <main
        className={`pb-24 md:pb-0 px-4 md:px-8 pt-3 max-w-6xl w-full transition-all duration-200 ${
          collapsed ? 'md:ml-16' : 'md:ml-56'
        }`}
      >
        <div key={transitionKey} className="page-transition">
          {children}
        </div>
      </main>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
