'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Read one operator-gated JSON endpoint.
 *
 * Every Medicare panel needs the same four things — data, a loading flag, an
 * error string, and a way to refetch after a mutation — and each of them had
 * grown its own copy. This is that shape, once.
 *
 * Two properties matter beyond deduplication:
 *
 * 1. No setState runs synchronously in the effect body. The previous pattern
 *    (`useEffect(() => { void load() })`, where `load` opened with
 *    `setLoading(true)`) triggers a cascading render and is rejected by the
 *    React Compiler lint rules. Here the effect only awaits, and every state
 *    write happens after the fetch resolves.
 *
 * 2. Results from a stale request are discarded. Switching client while a
 *    fetch is in flight would otherwise paint the previous client's record
 *    over the new one — which in a CRM means showing one member's coverage
 *    under another member's name.
 */
export function useOperatorFetch<T>(url: string | null, failureMessage: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the effect. A plain `reload()` that refetched inline
  // would have to duplicate the cancellation logic.
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    if (!url) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) throw new Error(body?.error ?? failureMessage);
        setData(body as T);
        setError(null);
      } catch (fetchError) {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : failureMessage);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, reloadCount, failureMessage]);

  /** Safe to call from event handlers — setState outside an effect is fine. */
  const reload = useCallback(() => {
    setLoading(true);
    setReloadCount((count) => count + 1);
  }, []);

  return { data, loading, error, reload, setError };
}
