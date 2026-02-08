import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useUser, useClerk as useClerkHook, SignIn } from '@clerk/clerk-react';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Transactions from './pages/Transactions';
import Company from './pages/Company';
import Settings from './pages/Settings';
import Assets from './pages/Assets';
import ComingSoon from './pages/ComingSoon';
import Budget from './pages/Budget';
import CreditSimulator from './pages/CreditSimulator';
import Report from './pages/Report';
import Income from './pages/Income';
import Analytics from './pages/Analytics';
import Invoices from './pages/Invoices';
import Bilan from './pages/Bilan';
import Onboarding from './pages/Onboarding';
import { FilterProvider } from './FilterContext';
import { PreferencesProvider, usePreferences } from './PreferencesContext';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/transactions" element={<Transactions />} />
      <Route path="/companies" element={<Company />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/assets" element={<Assets />} />
      <Route path="/analysis" element={<Analytics />} />
      <Route path="/cashflow" element={<ComingSoon titleKey="nav_cashflow" />} />
      <Route path="/ledger" element={<ComingSoon titleKey="nav_ledger" />} />
      <Route path="/reports" element={<Report />} />
      <Route path="/vat" element={<ComingSoon titleKey="nav_vat" />} />
      <Route path="/fec-export" element={<ComingSoon titleKey="nav_fec_export" />} />
      <Route path="/budget" element={<Budget />} />
      <Route path="/income" element={<Income />} />
      <Route path="/import" element={<ComingSoon titleKey="nav_import" />} />
      <Route path="/reconciliation" element={<Invoices />} />
      <Route path="/invoices" element={<Invoices />} />
      <Route path="/bilan" element={<Bilan />} />
      <Route path="/simulators" element={<CreditSimulator />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function ClerkApp() {
  const { isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerkHook();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-3xl font-bold mb-2 text-accent-400">Kompta</h1>
          <p className="text-muted text-sm mb-8">Comptabilité simplifiée</p>
          <SignIn
            routing="hash"
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'bg-surface border border-border shadow-none',
                headerTitle: 'text-white',
                headerSubtitle: 'text-muted',
                formButtonPrimary: 'bg-accent-500 hover:bg-accent-600',
                formFieldInput: 'bg-background border-border text-white',
                formFieldLabel: 'text-muted',
                footerActionLink: 'text-accent-400',
              },
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <PreferencesProvider>
      <ClerkAppInner onLogout={() => signOut()} />
    </PreferencesProvider>
  );
}

function ClerkAppInner({ onLogout }: { onLogout: () => void }) {
  const { prefs, loading, refresh } = usePreferences();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (prefs && !prefs.onboarded) {
    return <Onboarding onComplete={refresh} />;
  }

  return (
    <FilterProvider>
      <Layout onLogout={onLogout}>
        <AppRoutes />
      </Layout>
    </FilterProvider>
  );
}

function LegacyApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => localStorage.getItem('kompta_auth') === 'true'
  );

  const login = () => {
    localStorage.setItem('kompta_auth', 'true');
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('kompta_auth');
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return <Login onLogin={login} />;
  }

  return (
    <PreferencesProvider>
      <LegacyAppInner onLogout={logout} />
    </PreferencesProvider>
  );
}

function LegacyAppInner({ onLogout }: { onLogout: () => void }) {
  const { prefs, loading, refresh } = usePreferences();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (prefs && !prefs.onboarded) {
    return <Onboarding onComplete={refresh} />;
  }

  return (
    <FilterProvider>
      <Layout onLogout={onLogout}>
        <AppRoutes />
      </Layout>
    </FilterProvider>
  );
}

export default function App() {
  if (clerkEnabled) {
    return <ClerkApp />;
  }
  return <LegacyApp />;
}
