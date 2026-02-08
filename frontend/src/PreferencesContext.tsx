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
  formatCurrency: (amount: number, currency?: string) => string;
}

const PreferencesContext = createContext<PreferencesContextType>({
  prefs: null,
  loading: true,
  refresh: () => {},
  update: async () => {},
  formatCurrency: (n) => `€${n.toFixed(2)}`,
});

export function usePreferences() {
  return useContext(PreferencesContext);
}

// Exchange rates cache (EUR-based)
const RATES: Record<string, number> = { EUR: 1, USD: 1.08, CHF: 0.94 };

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

  const formatCurrency = useCallback((amount: number, fromCurrency?: string) => {
    const displayCur = prefs?.display_currency || 'EUR';
    let converted = amount;
    const from = fromCurrency || 'EUR';
    if (from !== displayCur) {
      // Convert: from → EUR → displayCur
      const inEur = from === 'EUR' ? amount : amount / (RATES[from] || 1);
      converted = displayCur === 'EUR' ? inEur : inEur * (RATES[displayCur] || 1);
    }
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: displayCur }).format(converted);
  }, [prefs?.display_currency]);

  return (
    <PreferencesContext.Provider value={{ prefs, loading, refresh: fetchPrefs, update, formatCurrency }}>
      {children}
    </PreferencesContext.Provider>
  );
}
