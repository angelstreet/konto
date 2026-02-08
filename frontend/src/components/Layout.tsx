import { ReactNode, useState, useEffect } from 'react';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';
import { isSandbox, disableSandbox } from '../sandbox';

interface Props {
  children: ReactNode;
  onLogout: () => void;
}

export default function Layout({ children, onLogout }: Props) {
  const [collapsed, setCollapsed] = useState(
    () => {
      const stored = localStorage.getItem('kompta_sidebar_collapsed');
      return stored === null ? true : stored === 'true';
    }
  );

  useEffect(() => {
    const theme = localStorage.getItem('kompta_theme') || 'gold';
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
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-1.5 text-center text-xs text-amber-400 flex items-center justify-center gap-2">
          <span>🎮</span>
          <span>Mode démo — données fictives, rien n'est sauvegardé</span>
          <button onClick={handleLogout} className="ml-2 underline hover:text-amber-300">Quitter</button>
        </div>
      )}
      <div className="hidden md:block">
        <Sidebar onLogout={handleLogout} />
      </div>

      <main
        className={`pb-20 md:pb-0 px-4 md:px-8 pt-3 max-w-6xl w-full transition-all duration-200 ${
          collapsed ? 'md:ml-16' : 'md:ml-56'
        }`}
      >
        {children}
      </main>

      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
