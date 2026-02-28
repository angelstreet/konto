import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { isSandbox } from './sandbox';

interface AmountVisibilityContextType {
  hideAmounts: boolean;
  toggleHideAmounts: () => void;
}

const AmountVisibilityContext = createContext<AmountVisibilityContextType>({
  hideAmounts: true,
  toggleHideAmounts: () => {},
});

export function useAmountVisibility() {
  return useContext(AmountVisibilityContext);
}

export function AmountVisibilityProvider({ children }: { children: ReactNode }) {
  // In sandbox/demo mode, amounts should always be visible by default.
  const [hideAmounts, setHideAmounts] = useState(
    () => {
      if (isSandbox()) {
        localStorage.setItem('konto_hide_amounts', 'false');
        return false;
      }
      return localStorage.getItem('konto_hide_amounts') !== 'false';
    }
  );

  const toggleHideAmounts = useCallback(() => {
    setHideAmounts(prev => {
      const next = !prev;
      localStorage.setItem('konto_hide_amounts', String(next));
      return next;
    });
  }, []);

  return (
    <AmountVisibilityContext.Provider value={{ hideAmounts, toggleHideAmounts }}>
      {children}
    </AmountVisibilityContext.Provider>
  );
}
