import { useState, useEffect, useCallback, useRef } from 'react';

const cache = new Map<string, any>();

export function useApi<T>(url: string): { data: T | null; loading: boolean; refetch: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T | null>(cache.get(url) ?? null);
  const [loading, setLoading] = useState(!cache.has(url));
  const urlRef = useRef(url);
  urlRef.current = url;

  const fetchData = useCallback(() => {
    setLoading(true);
    fetch(url)
      .then(r => r.json())
      .then(d => {
        cache.set(url, d);
        if (urlRef.current === url) setData(d);
      })
      .finally(() => setLoading(false));
  }, [url]);

  useEffect(() => {
    if (!cache.has(url)) {
      fetchData();
    }
  }, [url, fetchData]);

  const updateData = useCallback((d: T) => {
    cache.set(url, d);
    setData(d);
  }, [url]);

  return { data, loading, refetch: fetchData, setData: updateData };
}

export function invalidateApi(url: string) {
  cache.delete(url);
}

export function invalidateAllApi() {
  cache.clear();
}
