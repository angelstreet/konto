import { ReactNode } from 'react';
import BottomNav from './BottomNav';
import Sidebar from './Sidebar';

interface Props {
  children: ReactNode;
  onLogout: () => void;
}

export default function Layout({ children, onLogout }: Props) {
  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar onLogout={onLogout} />
      </div>

      {/* Main content */}
      <main className="pb-20 md:pb-0 md:ml-60 px-4 md:px-8 pt-6 max-w-5xl mx-auto w-full">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <div className="md:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
