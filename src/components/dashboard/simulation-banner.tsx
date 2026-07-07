'use client';

import { FlaskConical } from 'lucide-react';
import { useSimulationStatus } from '@/hooks/use-simulation-status';

/**
 * Trust guard: this control room uses trading vocabulary (kill switch, risk
 * auto-halt, realized PnL). Whenever the system is NOT operating on a fresh
 * live market feed with trading armed, this strip is rendered persistently —
 * it cannot be dismissed, so the LIVE sync badge and E-Stop button can never
 * imply real trading is occurring when it isn't.
 */
export function SimulationBanner() {
  const { simulated, reason, isLoading } = useSimulationStatus();
  if (isLoading || !simulated) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-neon-orange/50 bg-neon-orange/15 px-3 py-1"
    >
      <FlaskConical className="size-3 shrink-0 text-neon-orange" aria-hidden />
      <span className="font-terminal text-[11px] font-bold uppercase tracking-[0.2em] text-neon-orange">
        Simulation — no live market data
      </span>
      <span className="hidden truncate font-terminal text-[10px] text-neon-orange/70 sm:block" title={reason}>
        · {reason}
      </span>
    </div>
  );
}
