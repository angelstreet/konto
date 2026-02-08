import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './index.css';
import './i18n/i18n';
import { installSandboxInterceptor } from './sandbox';

// Install sandbox fetch interceptor before rendering (if sandbox mode is active)
installSandboxInterceptor();

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const app = (
  <React.StrictMode>
    <BrowserRouter basename="/kompta">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  clerkPubKey
    ? <ClerkProvider publishableKey={clerkPubKey} afterSignInUrl="/kompta/" afterSignUpUrl="/kompta/">{app}</ClerkProvider>
    : app
);
