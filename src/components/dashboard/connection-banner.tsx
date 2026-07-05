'use client';

import { useEffect, useState } from 'react';
import { WifiOff, Loader2, X } from 'lucide-react';
import { useConnectionStore, selectOverallStatus } from '@/lib/realtime/connection-store';
import { cn } from '@/lib/utils';

/**
 * Non-shifting realtime status toast. Fixed above the command dock so it
 * overlays rather than reflows the grid. Silent while connected/connecting;
 * only surfaces degraded states. Dismissible on click — clearing it hides the
 * current degraded state, and it re-arms automatically when the status
 * transitions to a *different* state (so a new problem still notifies).
 */
export function ConnectionBanner() {
  const status = useConnectionStore(selectOverallStatus);
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Hydration gate: the banner's visibility derives from client-only signals
  // (channel sockets, navigator.onLine). Server HTML and the client's first
  // paint therefore ALWAYS render null; degraded states may only surface
  // post-mount. This structurally prevents server/client tree divergence at
  // this node (which React reports against the adjacent sibling).
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Re-arm when the status changes away from the one the user dismissed.
  useEffect(() => {
    if (dismissed && status !== dismissed) setDismissed(null);
  }, [status, dismissed]);

  if (!isMounted) return null;
  if (status === 'connected' || status === 'connecting') return null;
  if (dismissed === status) return null;

  const offline = status === 'offline';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-auto flex items-center gap-2 rounded-full border px-3 py-1.5 font-terminal text-[10px] shadow-lg backdrop-blur',
          offline
            ? 'border-neon-red/30 bg-neon-red/10 text-neon-red'
            : 'border-neon-orange/30 bg-neon-orange/10 text-neon-orange'
        )}
      >
        {offline ? (
          <>
            <WifiOff className="size-3" />
            Connection lost — waiting for network
          </>
        ) : (
          <>
            <Loader2 className="size-3 animate-spin" />
            Reconnecting to realtime…
          </>
        )}
        <button
          onClick={() => setDismissed(status)}
          aria-label="Dismiss"
          className="ml-1 rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="size-2.5" />
        </button>
      </div>
    </div>
  );
}
