import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

const API = '/kompta/api';

export interface UserPreferences {
  onboarded: number;
  display_currency: string;
  crypto_display: string;
  kozy_enabled: number;
}

interface PreferencesContextType {
  prefs: UserPreferences | null;
  loading: boolean;
  refresh: () => void;
  update: (partial: Partial<UserPreferences>) => Promise<void>;
  formatCurrency: (amount: number, fromCurrency?: string) => string;
  convertToDisplay: (amount: number, fromCurrency?: string) => number;
}

const PreferencesContext = createContext<PreferencesContextType>({
  prefs: null,
  loading: true,
  refresh: () => {},
  update: async () => {},
  formatCurrency: (n) => `€${n.toFixed(2)}`,
  convertToDisplay: (n) => n,
});

export function usePreferences() {
  return useContext(PreferencesContext);
}

// Exchange rates cache (EUR-based: 1 EUR = X units)
const RATES: Record<string, number> = { EUR: 1, USD: 1.08, GBP: 0.86, CHF: 0.94, CAD: 1.47, JPY: 162, XOF: 655.96 };

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPrefs = useCallback(() => {
    fetch(`${API}/preferences`)
      .then(r => r.json())
      .then(data => {
        setPrefs(data);
        setLoading(false);
      })
      .catch(() => {
        // If API fails, set defaults so app still works
        setPrefs({ onboarded: 1, display_currency: 'EUR', crypto_display: 'native', kozy_enabled: 0 });
        setLoading(false);
      });
  }, []);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);

  const update = async (partial: Partial<UserPreferences>) => {
    const res = await fetch(`${API}/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await res.json();
    setPrefs(data);
  };

  const convertToDisplay = useCallback((amount: number, fromCurrency?: string) => {
    const displayCur = prefs?.display_currency || 'EUR';
    const from = fromCurrency || 'EUR';
    if (from === displayCur) return amount;
    // Convert: from → EUR → displayCur
    const inEur = from === 'EUR' ? amount : amount / (RATES[from] || 1);
    return displayCur === 'EUR' ? inEur : inEur * (RATES[displayCur] || 1);
  }, [prefs?.display_currency]);

  const formatCurrency = useCallback((amount: number, fromCurrency?: string) => {
    const displayCur = prefs?.display_currency || 'EUR';
    const converted = convertToDisplay(amount, fromCurrency);
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: displayCur }).format(converted);
  }, [prefs?.display_currency, convertToDisplay]);

  return (
    <PreferencesContext.Provider value={{ prefs, loading, refresh: fetchPrefs, update, formatCurrency, convertToDisplay }}>
      {children}
    </PreferencesContext.Provider>
  );
}
