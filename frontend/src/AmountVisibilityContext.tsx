import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

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
  // Match legacy Dashboard behavior: hidden by default (null or 'true' → hidden, 'false' → visible)
  const [hideAmounts, setHideAmounts] = useState(
    () => localStorage.getItem('kompta_hide_amounts') !== 'false'
  );

  const toggleHideAmounts = useCallback(() => {
    setHideAmounts(prev => {
      const next = !prev;
      // Store inverted to match legacy key: 'false' means hidden=false (visible)
      localStorage.setItem('kompta_hide_amounts', String(!next));
      return next;
    });
  }, []);

  return (
    <AmountVisibilityContext.Provider value={{ hideAmounts, toggleHideAmounts }}>
      {children}
    </AmountVisibilityContext.Provider>
  );
}
