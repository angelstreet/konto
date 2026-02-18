import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';

const cache = new Map<string, any>();
const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

/** Get auth headers — Clerk JWT if available, empty otherwise */
async function getAuthHeaders(getToken?: () => Promise<string | null>): Promise<Record<string, string>> {
  if (clerkEnabled && getToken) {
    const token = await getToken();
    if (token) return { Authorization: `Bearer ${token}` };
  }
  return {};
}

export function useApi<T>(url: string): { data: T | null; loading: boolean; refetch: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T | null>(cache.get(url) ?? null);
  const [loading, setLoading] = useState(!cache.has(url));
  const urlRef = useRef(url);

  let getToken: (() => Promise<string | null>) | undefined;
  if (clerkEnabled) {
    try {
      const auth = useAuth();
      getToken = auth.getToken;
    } catch {
      // Clerk not available (e.g. outside ClerkProvider)
    }
  }
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const fetchData = useCallback(() => {
    if (!url) return;
    if (!cache.has(url)) setLoading(true);
    getAuthHeaders(getTokenRef.current)
      .then(headers => fetch(url, { headers }))
      .then(r => r.json())
      .then(d => {
        cache.set(url, d);
        if (urlRef.current === url) setData(d);
      })
      .finally(() => setLoading(false));
  }, [url]);

  // When URL changes, show cached data immediately then always re-fetch
  useEffect(() => {
    urlRef.current = url;
    const cached = cache.get(url);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
    } else {
      setData(null);
    }
    fetchData();
  }, [url, fetchData]);

  const updateData = useCallback((d: T) => {
    cache.set(url, d);
    setData(d);
  }, [url]);

  return { data, loading, refetch: fetchData, setData: updateData };
}

/** Authenticated fetch helper for non-hook contexts */
export async function apiFetch(url: string, options: RequestInit = {}, getToken?: () => Promise<string | null>): Promise<Response> {
  const headers = await getAuthHeaders(getToken);
  return fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
}

/** Hook that returns an authenticated fetch function. Use in components. */
export function useAuthFetch() {
  let getToken: (() => Promise<string | null>) | undefined;
  if (clerkEnabled) {
    try {
      const auth = useAuth();
      getToken = auth.getToken;
    } catch {}
  }
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  return useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers = await getAuthHeaders(getTokenRef.current);
    const isFormData = options.body instanceof FormData;
    return fetch(url, {
      ...options,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
        ...(options.headers as Record<string, string> || {}),
      },
    });
  }, []);
}

export function invalidateApi(url: string) {
  cache.delete(url);
}

export function invalidateAllApi() {
  cache.clear();
}
