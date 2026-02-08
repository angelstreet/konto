import { useState, useEffect, useCallback, useRef } from 'react';

const cache = new Map<string, any>();

export function useApi<T>(url: string): { data: T | null; loading: boolean; refetch: () => void } {
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

  return { data, loading, refetch: fetchData };
}

export function invalidateApi(url: string) {
  cache.delete(url);
}
