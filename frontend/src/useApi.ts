import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';

const CACHE_KEY = 'konto_api_cache';
const CACHE_TTL = 30_000; // 30 seconds — skip refetch if data is fresh
const cache = new Map<string, any>();
const cacheTimes = new Map<string, number>(); // url → timestamp of last fetch
const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Restore cache from sessionStorage on load (stale-while-revalidate)
try {
  const stored = sessionStorage.getItem(CACHE_KEY);
  if (stored) {
    const entries = JSON.parse(stored) as [string, any][];
    for (const [k, v] of entries) cache.set(k, v);
    // Restored data is stale — don't set cacheTimes so it will refetch
  }
} catch {}

function persistCache() {
  try {
    const entries = Array.from(cache.entries());
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {}
}

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
  let isLoaded = true;
  if (clerkEnabled) {
    try {
      const auth = useAuth();
      getToken = auth.getToken;
      isLoaded = auth.isLoaded;
    } catch {
      // Clerk not available (e.g. outside ClerkProvider)
    }
  }
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const fetchData = useCallback((force?: boolean) => {
    if (!url) return;
    // Skip refetch if data is fresh (within TTL) unless forced
    if (!force) {
      const lastFetch = cacheTimes.get(url);
      if (lastFetch && Date.now() - lastFetch < CACHE_TTL && cache.has(url)) return;
    }
    if (!cache.has(url)) setLoading(true);
    getAuthHeaders(getTokenRef.current)
      .then(headers => fetch(url, { headers }))
      .then(r => { if (!r.ok) throw new Error(`API ${r.status}`); return r.json(); })
      .then(d => {
        cache.set(url, d);
        cacheTimes.set(url, Date.now());
        persistCache();
        if (urlRef.current === url) setData(d);
      })
      .finally(() => setLoading(false));
  }, [url]);

  // Wait for Clerk to load before fetching, to avoid 401s
  useEffect(() => {
    urlRef.current = url;
    const cached = cache.get(url);
    if (cached !== undefined) {
      setData(cached);
      setLoading(false);
    } else {
      setData(null);
    }
    if (!isLoaded) return;
    fetchData();
  }, [url, fetchData, isLoaded]);

  const updateData = useCallback((d: T) => {
    cache.set(url, d);
    persistCache();
    setData(d);
  }, [url]);

  return { data, loading, refetch: () => fetchData(true), setData: updateData };
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
  cacheTimes.delete(url);
  persistCache();
}

export function invalidateAllApi() {
  cache.clear();
  cacheTimes.clear();
  persistCache();
}
