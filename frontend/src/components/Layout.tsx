import { ReactNode, useState, useEffect } from 'react';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';

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
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setCollapsed(detail.collapsed);
    };
    window.addEventListener('sidebar-toggle', handler);
    return () => window.removeEventListener('sidebar-toggle', handler);
  }, []);

  // Apply theme from localStorage on mount
  useEffect(() => {
    const theme = localStorage.getItem('kompta_theme') || 'gold';
    document.documentElement.setAttribute('data-theme', theme);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar onLogout={onLogout} />
      </div>

      {/* Main content */}
      <main
        className={`pb-20 md:pb-0 px-4 md:px-8 pt-6 max-w-6xl w-full transition-all duration-200 ${
          collapsed ? 'md:ml-16' : 'md:ml-56'
        }`}
      >
        {children}
      </main>

      {/* Mobile bottom nav */}
      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
