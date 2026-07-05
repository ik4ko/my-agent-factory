'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Power, Radio, ShieldOff, Skull } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useRiskStateQuery } from '@/hooks/use-risk-state-query';
import { useOrdersQuery } from '@/hooks/use-orders-query';
import { useLoopRunsQuery } from '@/hooks/use-loop-runs-query';
import { useLoopsQuery } from '@/hooks/use-loops-query';
import { PinActionModal } from '@/components/dashboard/pin-action-modal';
import type { OrderStatus, Regime } from '@/lib/types/database.types';

const ORDER_BADGE: Record<OrderStatus, 'success' | 'muted' | 'error' | 'warning' | 'secondary'> = {
  intent: 'muted',
  risk_blocked: 'error',
  dry_run: 'secondary',
  submitted: 'warning',
  filled: 'success',
  rejected: 'error',
  canceled: 'muted',
};

const REGIME_BADGE: Record<Regime, 'success' | 'warning' | 'error'> = {
  NORMAL: 'success',
  VOLATILE: 'warning',
  CRITICAL_HALT: 'error',
};

async function controlPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: json?.error ?? `request failed (${res.status})` };
  return { ok: true };
}

function usePortfolio() {
  return useQuery({
    queryKey: ['execution-portfolio'],
    queryFn: async () => {
      const res = await fetch('/api/execution/portfolio');
      if (!res.ok) throw new Error(`portfolio fetch failed (${res.status})`);
      return res.json() as Promise<{ adapter: string; portfolio: { cash: number; equity: number }; positions: { symbol: string; qty: number; avgCost: number; marketValue: number }[] }>;
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}

export function ResultsClient() {
  const { data: risk } = useRiskStateQuery();
  const { data: orders = [] } = useOrdersQuery();
  const { data: runs = [] } = useLoopRunsQuery();
  const { data: loops = [] } = useLoopsQuery();
  const { data: pf } = usePortfolio();
  const [modal, setModal] = useState<'kill' | 'arm' | 'disarm' | null>(null);

  const loopNameById = new Map(loops.map((l) => [l.id, l.name]));
  const today = new Date().toISOString().slice(0, 10);
  const todaysOrders = orders.filter((o) => o.created_at.slice(0, 10) === today);

  return (
    <div className="flex flex-col gap-4 pb-4">
      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        <Badge variant={risk ? REGIME_BADGE[risk.regime] : 'muted'}>{risk?.regime ?? '…'}</Badge>
        <Badge variant={risk?.feed_degraded ? 'error' : 'success'}>{risk?.feed_degraded ? 'feed degraded' : 'feed ok'}</Badge>
        <Badge variant={risk?.trading_enabled ? 'success' : 'muted'}>{risk?.trading_enabled ? 'ARMED' : 'disarmed (dry-run)'}</Badge>
        <Badge variant={risk?.kill_switch ? 'error' : 'muted'}>{risk?.kill_switch ? 'KILL ENGAGED' : 'kill clear'}</Badge>
        {risk?.halted && <Badge variant="error">HALTED: {risk.halt_reason?.slice(0, 40)}</Badge>}
      </div>

      {/* Portfolio */}
      <section className="rounded-lg border border-border p-3">
        <h2 className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">
          Portfolio {pf ? `(${pf.adapter})` : ''}
        </h2>
        <div className="mt-2 flex items-baseline gap-4">
          <div>
            <div className="text-2xl font-semibold text-foreground">${pf?.portfolio.equity.toFixed(2) ?? '—'}</div>
            <div className="text-xs text-muted-foreground">equity</div>
          </div>
          <div>
            <div className="text-sm text-foreground">${pf?.portfolio.cash.toFixed(2) ?? '—'}</div>
            <div className="text-xs text-muted-foreground">cash</div>
          </div>
        </div>
        {pf && pf.positions.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            {pf.positions.map((p) => (
              <div key={p.symbol} className="flex justify-between text-xs">
                <span className="font-medium">{p.symbol}</span>
                <span className="text-muted-foreground">
                  {p.qty} @ ${p.avgCost.toFixed(2)} · ${p.marketValue.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Today's orders */}
      <section className="rounded-lg border border-border p-3">
        <h2 className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">Today&apos;s orders ({todaysOrders.length})</h2>
        <div className="mt-2 flex flex-col gap-1.5">
          {todaysOrders.length === 0 && <p className="text-xs text-muted-foreground">No orders today.</p>}
          {todaysOrders.map((o) => (
            <div key={o.id} className="flex items-center justify-between text-xs">
              <span>
                {o.side} {o.symbol} {o.qty ?? ''}
              </span>
              <Badge variant={ORDER_BADGE[o.status]}>{o.status}</Badge>
            </div>
          ))}
        </div>
      </section>

      {/* Streaming loop runs */}
      <section className="rounded-lg border border-border p-3">
        <h2 className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">Loop runs</h2>
        <div className="mt-2 flex flex-col gap-1.5">
          {runs.slice(0, 10).map((r) => (
            <div key={r.id} className="flex items-center justify-between text-xs">
              <span className="truncate">{loopNameById.get(r.loop_id ?? '') ?? 'unknown'}</span>
              <Badge variant={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'error' : 'muted'}>{r.status}</Badge>
            </div>
          ))}
        </div>
      </section>

      {/* Sticky controls */}
      <div className="sticky bottom-0 mt-2 flex gap-2 rounded-lg border border-border bg-surface-1 p-2">
        <button
          onClick={() => setModal(risk?.trading_enabled ? 'disarm' : 'arm')}
          className={cn(
            'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border font-terminal text-xs font-bold uppercase tracking-wider',
            risk?.trading_enabled ? 'border-warning/40 bg-warning/10 text-warning' : 'border-primary/40 bg-primary/10 text-primary'
          )}
        >
          {risk?.trading_enabled ? <ShieldOff className="size-4" /> : <Power className="size-4" />}
          {risk?.trading_enabled ? 'Disarm' : 'Arm'}
        </button>
        <button
          onClick={() => setModal('kill')}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-neon-red/50 bg-neon-red/15 font-terminal text-xs font-bold uppercase tracking-wider text-neon-red"
        >
          <Skull className="size-4" /> Kill
        </button>
      </div>

      {modal === 'kill' && (
        <PinActionModal
          title="Kill switch"
          description="Cancels every open order and blocks all new orders until released. Loops keep running but every trade decision will be blocked."
          confirmLabel="Engage kill switch"
          danger
          onClose={() => setModal(null)}
          onConfirm={(pin) => controlPost('/api/control/kill', { pin, engaged: true })}
        />
      )}
      {modal === 'arm' && (
        <PinActionModal
          title="Arm trading"
          description="Loops will start placing REAL orders within your configured caps, with zero further approval. This is the single deliberate go-live flip."
          confirmLabel="Arm live"
          danger
          onClose={() => setModal(null)}
          onConfirm={(pin) => controlPost('/api/control/arm', { pin, enabled: true })}
        />
      )}
      {modal === 'disarm' && (
        <PinActionModal
          title="Disarm trading"
          description="Every trade decision goes back to dry-run — nothing further is placed at a broker."
          confirmLabel="Disarm"
          onClose={() => setModal(null)}
          onConfirm={(pin) => controlPost('/api/control/arm', { pin, enabled: false })}
        />
      )}

      {risk?.halted && (
        <p className="flex items-center gap-1.5 text-[11px] text-neon-red">
          <AlertTriangle className="size-3" /> System halted — arm/disarm still works but no orders place until un-halted.
        </p>
      )}
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
        <Radio className="size-3" /> live via Supabase Realtime — nothing here is cached.
      </p>
    </div>
  );
}
