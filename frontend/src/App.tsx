import { useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Transactions from './pages/Transactions';
import Company from './pages/Company';
import Settings from './pages/Settings';
import Assets from './pages/Assets';
import ComingSoon from './pages/ComingSoon';

export default function App() {
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
    <Layout onLogout={logout}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/companies" element={<Company />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/assets" element={<Assets />} />
        {/* Future pages — show coming soon */}
        <Route path="/analysis" element={<ComingSoon titleKey="nav_analysis" />} />
        <Route path="/cashflow" element={<ComingSoon titleKey="nav_cashflow" />} />
        <Route path="/ledger" element={<ComingSoon titleKey="nav_ledger" />} />
        <Route path="/reports" element={<ComingSoon titleKey="nav_reports" />} />
        <Route path="/vat" element={<ComingSoon titleKey="nav_vat" />} />
        <Route path="/fec-export" element={<ComingSoon titleKey="nav_fec_export" />} />
        <Route path="/budget" element={<ComingSoon titleKey="nav_budget" />} />
        <Route path="/import" element={<ComingSoon titleKey="nav_import" />} />
        <Route path="/reconciliation" element={<ComingSoon titleKey="nav_reconciliation" />} />
        <Route path="/simulators" element={<ComingSoon titleKey="nav_simulators" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
