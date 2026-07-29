'use client';

import { useCallback } from 'react';
import { RefreshCcw } from 'lucide-react';
import { BridgeHealth, type BridgeHealthData } from './bridge-health';
import { useOperatorFetch } from './use-operator-fetch';

/**
 * Standalone container for the Bridge Health tab.
 *
 * The presentational <BridgeHealth> and the /api/website-leads/health proxy
 * already existed and are used inside the website lead inbox. This adds only
 * the fetching a dedicated tab needs — deliberately NOT a second health
 * component or a second proxy route, because two implementations of "is the
 * lead bridge working" would eventually disagree, and the whole point of the
 * panel is to be trusted when it says something is wrong.
 *
 * The health token stays server-side in the proxy; the browser only ever
 * talks to that operator-gated route.
 */
export function BridgeHealthTab() {
  const { data, loading, error, reload } = useOperatorFetch<BridgeHealthData>(
    '/api/website-leads/health',
    'Could not reach the bridge health endpoint.',
  );

  const retryDelivery = useCallback(
    async (id: string) => {
      await fetch('/api/website-leads/health', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      }).catch(() => null);
      reload();
    },
    [reload],
  );

  // A failed read is reported as a bridge problem, never as a healthy-but-empty
  // panel — silent non-delivery is the exact failure this screen exists to catch.
  const health: BridgeHealthData | null = error ? { configured: true, error } : data;

  return (
    <div className="space-y-3 pb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Bridge health</div>
          <div className="mt-1 text-sm text-foreground/80">
            Website contact form → signed delivery → this CRM.
          </div>
        </div>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface-2 px-2.5 text-xs transition hover:border-primary/60 disabled:opacity-50"
        >
          <RefreshCcw className="size-3.5" /> Refresh
        </button>
      </div>

      {loading && !health ? (
        <div className="text-xs text-muted-foreground">Checking the bridge…</div>
      ) : (
        <BridgeHealth health={health} onRetry={retryDelivery} />
      )}
    </div>
  );
}
