import { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { useApi } from './useApi';

type Scope = 'all' | 'personal' | 'pro' | number;

interface Company {
  id: number;
  name: string;
}

interface FilterContextValue {
  scope: Scope;
  setScope: (s: Scope) => void;
  appendScope: (url: string) => string;
  companies: Company[];
}

const FilterContext = createContext<FilterContextValue>({
  scope: 'all',
  setScope: () => {},
  appendScope: (url) => url,
  companies: [],
});

export function useFilter() {
  return useContext(FilterContext);
}

function readScope(): Scope {
  const stored = localStorage.getItem('kompta_scope');
  if (!stored || stored === 'all') return 'all';
  if (stored === 'personal') return 'personal';
  if (stored === 'pro') return 'pro';
  const num = parseInt(stored, 10);
  return isNaN(num) ? 'all' : num;
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>(readScope);
  const { data: rawCompanies } = useApi<any[]>('/kompta/api/companies');

  const companies = useMemo(() => {
    if (!rawCompanies) return [];
    return rawCompanies.map((c: any) => ({ id: c.id, name: c.name }));
  }, [rawCompanies]);

  // Validate stored scope — if company_id doesn't exist, fallback
  useEffect(() => {
    if (companies.length > 0) {
      const current = readScope();
      if (typeof current === 'number' && !companies.some(c => c.id === current)) {
        setScopeState('all');
        localStorage.setItem('kompta_scope', 'all');
      }
    }
  }, [companies]);

  const setScope = (s: Scope) => {
    localStorage.setItem('kompta_scope', String(s));
    setScopeState(s);
  };

  const appendScope = (url: string): string => {
    if (scope === 'all') return url;
    const sep = url.includes('?') ? '&' : '?';
    if (scope === 'personal') return `${url}${sep}usage=personal`;
    if (scope === 'pro') return `${url}${sep}usage=professional`;
    return `${url}${sep}company_id=${scope}`;
  };

  return (
    <FilterContext.Provider value={{ scope, setScope, appendScope, companies }}>
      {children}
    </FilterContext.Provider>
  );
}
