'use client';

import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';
import {
  useConnectionStore,
  selectOverallStatus,
  type OverallStatus,
} from '@/lib/realtime/connection-store';
import { cn } from '@/lib/utils';

const PRESENTATION: Record<
  OverallStatus,
  { label: string; dot: string; text: string; pulse: boolean; icon: 'wifi' | 'off' | 'spin' }
> = {
  // "SYNC" (not "LIVE"): this badge reports the realtime DATABASE link only.
  // It must never read as a live-market/trading indicator.
  connected:    { label: 'SYNC',         dot: 'bg-neon-green',  text: 'text-neon-green',  pulse: true,  icon: 'wifi' },
  connecting:   { label: 'CONNECTING',   dot: 'bg-neon-cyan',   text: 'text-neon-cyan',   pulse: true,  icon: 'spin' },
  reconnecting: { label: 'RECONNECTING', dot: 'bg-neon-orange', text: 'text-neon-orange', pulse: true,  icon: 'spin' },
  offline:      { label: 'OFFLINE',      dot: 'bg-neon-red',    text: 'text-neon-red',    pulse: false, icon: 'off'  },
};

export function ConnectionIndicator() {
  const status = useConnectionStore(selectOverallStatus);
  const setOnline = useConnectionStore((s) => s.setOnline);

  // Mount guard: the overall status derives from Zustand state that only
  // becomes meaningful in the browser (navigator.onLine at module load, plus
  // channel subscriptions that mutate the store synchronously on mount). The
  // server and the first client paint would therefore disagree. We render a
  // fixed, browser-independent placeholder for SSR + first paint, then swap to
  // the live indicator once mounted — eliminating the hydration mismatch and
  // keeping the node safe for Vercel's static optimization pass.
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Reflect browser network reachability into the store (client only).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [setOnline]);

  // Deterministic SSR / first-paint placeholder — no store-derived classes.
  if (!isMounted) {
    return (
      <div
        className="flex items-center gap-1.5 font-terminal text-[10px] text-muted-foreground/50"
        role="status"
        aria-live="polite"
        suppressHydrationWarning
      >
        <Loader2 className="size-3 animate-spin" />
        <span>CONNECTING</span>
      </div>
    );
  }

  const p = PRESENTATION[status];

  return (
    <div
      className={cn('flex items-center gap-1.5 font-terminal text-[10px]', p.text)}
      role="status"
      aria-live="polite"
      title={`Realtime database link: ${p.label.toLowerCase()} — dashboard sync status only, not a market-data or trading indicator`}
      aria-label={`Realtime database link ${p.label.toLowerCase()}`}
    >
      {p.icon === 'wifi' && <Wifi className="size-3" />}
      {p.icon === 'off' && <WifiOff className="size-3" />}
      {p.icon === 'spin' && <Loader2 className="size-3 animate-spin" />}
      <span className={cn('relative flex size-1.5', !p.pulse && 'hidden')}>
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', p.dot)} />
        <span className={cn('relative inline-flex size-1.5 rounded-full', p.dot)} />
      </span>
      <span className={cn(status === 'connected' && 'animate-glow-pulse')}>{p.label}</span>
    </div>
  );
}
