import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useUser, useClerk as useClerkHook, SignIn } from '@clerk/clerk-react';
import { dark } from '@clerk/themes';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Transactions from './pages/Transactions';
import Company from './pages/Company';
import Settings from './pages/Settings';
import Assets from './pages/Assets';
import ComingSoon from './pages/ComingSoon';
import CreditSimulator from './pages/CreditSimulator';
import Report from './pages/Report';
import Income from './pages/Income';
import Analytics from './pages/Analytics';
import Invoices from './pages/Invoices';
import Bilan from './pages/Bilan';
import BilanPro from './pages/BilanPro';
import More from './pages/More';
import Outils from './pages/Outils';
import Onboarding from './pages/Onboarding';
import Trends from './pages/Trends';
import PropertyROI from './pages/PropertyROI';
import Profile from './pages/Profile';
import Import from './pages/Import';
import { FilterProvider } from './FilterContext';
import { PreferencesProvider, usePreferences } from './PreferencesContext';
import { AmountVisibilityProvider } from './AmountVisibilityContext';
import { LogoutProvider } from './LogoutContext';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/transactions" element={<Transactions />} />
      <Route path="/companies" element={<Company />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/assets" element={<Assets />} />
      <Route path="/analysis" element={<Analytics />} />
      <Route path="/cashflow" element={<ComingSoon titleKey="nav_cashflow" />} />
      <Route path="/ledger" element={<ComingSoon titleKey="nav_ledger" />} />
      <Route path="/rapport-patrimoine" element={<Report />} />
      <Route path="/reports" element={<Navigate to="/rapport-patrimoine" replace />} />
      <Route path="/vat" element={<ComingSoon titleKey="nav_vat" />} />
      <Route path="/fec-export" element={<ComingSoon titleKey="nav_fec_export" />} />
      <Route path="/budget" element={<Analytics />} />
      <Route path="/income" element={<Income />} />
      <Route path="/import" element={<Import />} />
      <Route path="/reconciliation" element={<Invoices />} />
      <Route path="/invoices" element={<Invoices />} />
      <Route path="/bilan" element={<Bilan />} />
      <Route path="/bilan-pro" element={<BilanPro />} />
      <Route path="/trends" element={<Trends />} />
      <Route path="/trends-pro" element={<Trends />} />
      <Route path="/property-roi" element={<PropertyROI />} />
      <Route path="/simulators" element={<CreditSimulator />} />
      <Route path="/outils" element={<Outils />} />
      <Route path="/more" element={<More />} />
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
          <h1 className="text-3xl font-bold mb-2 text-accent-400">Konto</h1>
          <p className="text-muted text-sm mb-8">Comptabilité simplifiée</p>
          <SignIn
            routing="hash"
            appearance={{
              baseTheme: dark,
              variables: {
                colorBackground: '#1a1a1a',
                colorText: '#e5e5e5',
                colorTextSecondary: '#888',
                colorPrimary: 'var(--accent-500, #d4a812)',
                colorInputBackground: '#111',
                colorInputText: '#e5e5e5',
                borderRadius: '0.5rem',
              },
              elements: {
                rootBox: 'w-full',
                card: 'bg-[#1a1a1a] border border-[#333] shadow-none',
                headerTitle: 'text-white',
                headerSubtitle: 'text-[#888]',
                formButtonPrimary: 'bg-[var(--accent-500,#d4a812)] hover:bg-[var(--accent-600,#b8920f)] text-black',
                formFieldInput: 'bg-[#111] border-[#333] text-white',
                formFieldLabel: 'text-[#888]',
                footerActionLink: 'text-[var(--accent-400,#e0b830)]',
                socialButtonsBlockButton: 'bg-[#222] border-[#333] text-white hover:bg-[#2a2a2a]',
                socialButtonsBlockButtonText: 'text-white',
                dividerLine: 'bg-[#333]',
                dividerText: 'text-[#666]',
                footer: 'bg-[#1a1a1a]',
                footerAction: 'bg-[#1a1a1a]',
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
    <LogoutProvider value={onLogout}>
      <AmountVisibilityProvider>
        <FilterProvider>
          <Layout onLogout={onLogout}>
            <AppRoutes />
          </Layout>
        </FilterProvider>
      </AmountVisibilityProvider>
    </LogoutProvider>
  );
}

function LegacyApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    () => {
      const stored = localStorage.getItem('konto_auth') === 'true';
      const loggedOut = sessionStorage.getItem('konto_logged_out') === 'true';
      const hostname = window.location.hostname;
      const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
      if (isLocal && !stored && !loggedOut) {
        localStorage.setItem('konto_auth', 'true');
        return true;
      }
      return stored;
    }
  );

  const login = () => {
    sessionStorage.removeItem('konto_logged_out');
    localStorage.setItem('konto_auth', 'true');
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('konto_auth');
    localStorage.removeItem('konto_sidebar_collapsed');
    sessionStorage.setItem('konto_logged_out', 'true');
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
    <LogoutProvider value={onLogout}>
      <AmountVisibilityProvider>
        <FilterProvider>
          <Layout onLogout={onLogout}>
            <AppRoutes />
          </Layout>
        </FilterProvider>
      </AmountVisibilityProvider>
    </LogoutProvider>
  );
}

export default function App() {
  if (clerkEnabled) {
    return <ClerkApp />;
  }
  return <LegacyApp />;
}
