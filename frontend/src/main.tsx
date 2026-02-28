import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './index.css';
import './i18n/i18n';
import { enableSandbox, installSandboxInterceptor } from './sandbox';

// Allow direct demo links like /konto/?demo=1 without Clerk sign-in.
const query = new URLSearchParams(window.location.search);
const demoParam = query.get('demo') === '1' || query.get('mode') === 'demo';
if (demoParam) {
  enableSandbox();
  query.delete('demo');
  query.delete('mode');
  const qs = query.toString();
  const cleanUrl = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', cleanUrl);
}

// Install sandbox fetch interceptor before rendering (if sandbox mode is active)
installSandboxInterceptor();

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const app = (
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.VITE_BASE_PATH || '/konto'} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  clerkPubKey
    ? <ClerkProvider
        publishableKey={clerkPubKey}
        signInFallbackRedirectUrl={import.meta.env.VITE_BASE_PATH || '/konto/'}
        signUpFallbackRedirectUrl={import.meta.env.VITE_BASE_PATH || '/konto/'}
      >
        {app}
      </ClerkProvider>
    : app
);
