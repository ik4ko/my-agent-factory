'use client';

import { WifiOff, Loader2 } from 'lucide-react';
import { useConnectionStore, selectOverallStatus } from '@/lib/realtime/connection-store';
import { cn } from '@/lib/utils';

/**
 * Non-shifting realtime status toast. Fixed-positioned above the command bar
 * so it overlays rather than reflows the grid. Silent while connected or on
 * the initial connect; only surfaces degraded states.
 */
export function ConnectionBanner() {
  const status = useConnectionStore(selectOverallStatus);
  if (status === 'connected' || status === 'connecting') return null;

  const offline = status === 'offline';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center">
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'flex items-center gap-2 rounded-full border px-3 py-1.5 font-terminal text-[10px] shadow-lg backdrop-blur',
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
      </div>
    </div>
  );
}
