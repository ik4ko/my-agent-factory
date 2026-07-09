'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import { pushSystemFeed } from '@/lib/fx/system-feed';
import { STAGED_ORDERS_KEY, useStagedOrders } from '@/hooks/use-staged-orders-query';
import { PanelChrome, ApprovalGate, DataChip, StatusBadge } from '@/components/deck';
import type { StagedOrderRow } from '@/lib/types/database.types';

// Re-exported for existing importers (SpatialWorkspace's KellyGrid).
export { STAGED_ORDERS_KEY };

const CHANNEL = 'staged-orders-approval';

/**
 * Human-in-the-loop approval GATE (Trading Room.dc.html §STAGED ORDERS).
 *
 * The presentation is the rose approval-gate treatment; the SAFETY LOGIC is
 * unchanged from before the reskin: it lists real PENDING staged_orders rows,
 * and APPROVE/REJECT record a human decision via PATCH
 * /api/trading/action-order (with CAS-collision handling). Nothing
 * auto-resolves — a real human click is required to clear the gate.
 */
export function StagedOrders() {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const [collidedId, setCollidedId] = useState<string | null>(null);

  // Realtime: INSERTs (new proposals) and UPDATEs (decisions from any
  // session) both refresh the pending list.
  useEffect(() => {
    const { setChannelStatus, clearChannel } = useConnectionStore.getState();
    const dispose = subscribeWithReconnect({
      client: supabase,
      name: CHANNEL,
      onStatusChange: (s) => setChannelStatus(CHANNEL, s),
      build: (channel) =>
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'staged_orders' },
          () => qc.invalidateQueries({ queryKey: STAGED_ORDERS_KEY }),
        ),
    });
    return () => {
      dispose();
      clearChannel(CHANNEL);
    };
  }, [qc, supabase]);

  const { data: pending = [] } = useStagedOrders();

  const act = async (order: StagedOrderRow, action: 'APPROVED' | 'DENIED') => {
    if (actingId) return;
    setActingId(order.id);
    try {
      const res = await fetch('/api/trading/action-order', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: order.id, action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 409) {
        // CAS collision: another session/agent decided this order first.
        setCollidedId(order.id);
        pushSystemFeed('SYSTEM', `Action collision avoided — ${order.underlying} ${order.option_type} ${order.strike} was already decided by another session`);
        setTimeout(() => {
          setCollidedId(null);
          qc.setQueryData<StagedOrderRow[]>(STAGED_ORDERS_KEY, (prev = []) =>
            prev.filter((o) => o.id !== order.id),
          );
        }, 1_200);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? `action failed (${res.status})`);
      pushSystemFeed(
        'STRATEGY',
        `Human verdict: ${order.underlying} ${order.option_type} ${order.strike} → ${action} (decision recorded — no live dispatch wired)`,
      );
      qc.invalidateQueries({ queryKey: STAGED_ORDERS_KEY });
    } catch (err) {
      pushSystemFeed(
        'SYSTEM',
        `Order action failed — ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    } finally {
      setActingId(null);
    }
  };

  const hasPending = pending.length > 0;

  return (
    <PanelChrome
      title="STAGED ORDERS"
      accent={hasPending ? 'gate' : 'default'}
      glow={hasPending}
      headerRight={
        hasPending ? (
          <StatusBadge status="pending" className="border-gate/40 !text-gate">
            {pending.length} · ACTION REQUIRED
          </StatusBadge>
        ) : (
          <span className="font-mono text-[8.5px] tracking-[0.14em] text-ink-low">QUEUE CLEAR</span>
        )
      }
      bodyClassName="p-[10px] flex flex-col gap-[10px]"
    >
      {!hasPending ? (
        <div className="flex h-full min-h-[7rem] flex-col items-center justify-center gap-1.5 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-low">No orders staged</span>
          <span className="max-w-[15rem] text-[11px] leading-relaxed text-ink-mid">
            Every proposal waits here for a human verdict — nothing auto-executes.
          </span>
        </div>
      ) : (
        pending.map((order) => {
          const isCall = order.option_type === 'CALL';
          const busy = actingId === order.id;
          const collided = collidedId === order.id;
          return (
            <ApprovalGate
              key={order.id}
              tag="AWAITING YOUR APPROVAL"
              busy={busy || collided}
              approveLabel={order.source === 'LIVE' ? 'APPROVE' : 'APPROVE (SIM)'}
              onApprove={() => void act(order, 'APPROVED')}
              onReject={() => void act(order, 'DENIED')}
            >
              <div className="flex items-center gap-[9px] font-mono">
                <span
                  className={`rounded-[3px] border px-2 py-[2px] text-[9px] font-bold tracking-[0.14em] ${
                    isCall
                      ? 'border-neon-green/45 bg-neon-green/10 text-neon-green'
                      : 'border-destructive/45 bg-destructive/10 text-destructive'
                  }`}
                >
                  {order.option_type}
                </span>
                <span className="text-[14px] font-bold text-ink-hi">
                  {order.underlying} {order.strike}
                </span>
                <span className="text-[10px] text-ink-mid">@ ${order.limit_price.toFixed(2)}</span>
                <span className="ml-auto tabular text-[10px] text-ink-mid">
                  est ${Math.round(order.calculated_position_size_usd).toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-[5px]">
                <DataChip>½ Kelly · {(order.kelly_fraction * 100).toFixed(2)}% of book</DataChip>
                <DataChip>E {order.expectancy.toFixed(2)}R · W {Math.round((order.win_rate > 1 ? order.win_rate / 100 : order.win_rate) * 100)}%</DataChip>
                <DataChip tone={order.source === 'SANDBOX' ? 'muted' : 'primary'}>{order.source}</DataChip>
              </div>
              <span className="font-mono text-[8.5px] text-ink-low">
                exp {order.expiration} · payoff {order.r_multiple.toFixed(1)}:1
              </span>
              {collided && (
                <span className="animate-fade-in-up self-start rounded-[3px] border border-warning/50 bg-warning/10 px-[6px] py-px font-mono text-[8px] tracking-[0.12em] text-warning">
                  ACTION COLLISION AVOIDED
                </span>
              )}
            </ApprovalGate>
          );
        })
      )}
    </PanelChrome>
  );
}
