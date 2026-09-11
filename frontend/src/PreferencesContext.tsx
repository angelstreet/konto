import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { API } from './config';

export interface UserPreferences {
  onboarded: number;
  display_currency: string;
  crypto_display: string;
  kozy_enabled: number;
  hide_crypto: number;
}

interface PreferencesContextType {
  prefs: UserPreferences | null;
  loading: boolean;
  refresh: () => void;
  update: (partial: Partial<UserPreferences>) => Promise<void>;
  formatCurrency: (amount: number, fromCurrency?: string) => string;
  /** Same as formatCurrency but without cents — for tables and charts. */
  formatCurrencyRounded: (amount: number, fromCurrency?: string) => string;
  convertToDisplay: (amount: number, fromCurrency?: string) => number;
}

const PreferencesContext = createContext<PreferencesContextType>({
  prefs: null,
  loading: true,
  refresh: () => {},
  update: async () => {},
  formatCurrency: (n) => `€${n.toFixed(2)}`,
  formatCurrencyRounded: (n) => `€${Math.round(n)}`,
  convertToDisplay: (n) => n,
});

export function usePreferences() {
  return useContext(PreferencesContext);
}

const DEFAULT_PREFERENCES: UserPreferences = {
  onboarded: 1,
  display_currency: 'EUR',
  crypto_display: 'native',
  kozy_enabled: 0,
  hide_crypto: 0,
};

function normalizePreferences(input: any): UserPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    ...(input || {}),
  };
}

// Exchange rates cache (EUR-based: 1 EUR = X units)
/**
 * Units of each currency per 1 EUR. Only a fallback — live ECB rates are
 * fetched from /api/fx-rates on mount, since a hardcoded table drifts.
 */
const FALLBACK_RATES: Record<string, number> = { EUR: 1, USD: 1.08, GBP: 0.86, CHF: 0.94, CAD: 1.47, JPY: 162, XOF: 655.957 };

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

async function getHeaders(getToken?: () => Promise<string | null>): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (clerkEnabled && getToken) {
    const token = await getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [rates, setRates] = useState<Record<string, number>>(FALLBACK_RATES);

  let getToken: (() => Promise<string | null>) | undefined;
  if (clerkEnabled) {
    try { const auth = useAuth(); getToken = auth.getToken; } catch {}
  }
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const fetchPrefs = useCallback(() => {
    getHeaders(getTokenRef.current).then(headers =>
      fetch(`${API}/preferences`, { headers })
        .then(async r => {
          const data = await r.json().catch(() => null);
          if (!r.ok) throw new Error('preferences_fetch_failed');
          return data;
        })
        .then(data => {
          setPrefs(normalizePreferences(data));
          setLoading(false);
        })
        .catch(() => {
          setPrefs(DEFAULT_PREFERENCES);
          setLoading(false);
        })
    );
  }, []);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);

  // Live EUR reference rates; keeps the fallback for anything the feed omits.
  // Needs the auth header like every other /api call — Clerk guards /api/*.
  useEffect(() => {
    let cancelled = false;
    getHeaders(getTokenRef.current).then(headers =>
      fetch(`${API}/fx-rates`, { headers })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          if (cancelled || !data?.rates || Object.keys(data.rates).length === 0) return;
          setRates({ ...FALLBACK_RATES, ...data.rates });
        })
        .catch(() => {})
    );
    return () => { cancelled = true; };
  }, []);

  const update = async (partial: Partial<UserPreferences>) => {
    const headers = await getHeaders(getTokenRef.current);
    try {
      const res = await fetch(`${API}/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(partial),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error('preferences_update_failed');
      setPrefs(normalizePreferences(data));
    } catch {
      setPrefs(prev => normalizePreferences({ ...(prev || DEFAULT_PREFERENCES), ...partial }));
    }
  };

  const convertToDisplay = useCallback((amount: number, fromCurrency?: string) => {
    const displayCur = prefs?.display_currency || 'EUR';
    const from = fromCurrency || 'EUR';
    if (from === displayCur) return amount;
    const inEur = from === 'EUR' ? amount : amount / (rates[from] || 1);
    return displayCur === 'EUR' ? inEur : inEur * (rates[displayCur] || 1);
  }, [prefs?.display_currency, rates]);

  const formatCurrency = useCallback((amount: number, fromCurrency?: string) => {
    const displayCur = prefs?.display_currency || 'EUR';
    const converted = convertToDisplay(amount, fromCurrency);
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: displayCur }).format(converted);
  }, [prefs?.display_currency, convertToDisplay]);

  const formatCurrencyRounded = useCallback((amount: number, fromCurrency?: string) => {
    const displayCur = prefs?.display_currency || 'EUR';
    const converted = convertToDisplay(amount, fromCurrency);
    return new Intl.NumberFormat('de-DE', {
      style: 'currency', currency: displayCur, maximumFractionDigits: 0,
    }).format(converted);
  }, [prefs?.display_currency, convertToDisplay]);

  return (
    <PreferencesContext.Provider value={{ prefs, loading, refresh: fetchPrefs, update, formatCurrency, formatCurrencyRounded, convertToDisplay }}>
      {children}
    </PreferencesContext.Provider>
  );
}
