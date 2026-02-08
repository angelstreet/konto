import { ReactNode } from 'react';
import BottomNav from './BottomNav';

interface Props {
  children: ReactNode;
  onLogout: () => void;
}

export default function Layout({ children, onLogout: _onLogout }: Props) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 pb-20 px-4 pt-6 max-w-lg mx-auto w-full">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
