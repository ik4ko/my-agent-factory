'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldX, Crosshair } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import { pushSystemFeed } from '@/lib/fx/system-feed';
import { cn } from '@/lib/utils';
import type { StagedOrderRow } from '@/lib/types/database.types';

export const STAGED_ORDERS_KEY = ['staged-orders', 'pending'] as const;
const CHANNEL = 'staged-orders-approval';

/**
 * Human-in-the-loop approval track. Lists PENDING staged orders; the two
 * buttons record the human decision via PATCH /api/trading/action-order.
 * Renders nothing when the queue is empty — zero layout cost until the
 * pipeline actually stages a proposal.
 */
export function StagedOrders() {
  const supabase = useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);

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

  const { data: pending = [] } = useQuery<StagedOrderRow[]>({
    queryKey: STAGED_ORDERS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staged_orders')
        .select('*')
        .eq('human_approval_status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });

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

  if (pending.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-neon-green/20 bg-neon-green/[0.03] px-4 py-2">
      <div className="flex items-center gap-1.5 pb-1.5">
        <Crosshair className="size-3 text-neon-green" />
        <span className="text-[10px] uppercase tracking-widest text-neon-green/80">
          Approval Track
        </span>
        <span className="font-terminal text-[10px] text-muted-foreground/40">
          {pending.length} staged · awaiting manual verification
        </span>
      </div>

      <div className="space-y-1">
        {pending.map((order) => (
          <div
            key={order.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface-1 px-2.5 py-1.5 font-terminal text-[10px]"
          >
            <span className="font-semibold text-foreground">{order.underlying}</span>
            <span className={order.option_type === 'CALL' ? 'text-neon-green' : 'text-neon-red'}>
              {order.option_type} {order.strike}
            </span>
            <span className="text-muted-foreground/60">exp {order.expiration}</span>
            <span className="text-muted-foreground/60">
              LIMIT ${order.limit_price.toFixed(2)}
            </span>
            <span className="text-neon-cyan/80">
              ${order.calculated_position_size_usd.toLocaleString()} ·{' '}
              {(order.kelly_fraction * 100).toFixed(2)}% eq
            </span>
            <span className="text-neon-purple/70">E={order.expectancy.toFixed(2)}R</span>
            <span
              className={cn(
                'rounded border px-1 py-px text-[9px] tracking-wider',
                order.source === 'SANDBOX'
                  ? 'border-neon-orange/40 text-neon-orange/80'
                  : 'border-neon-cyan/40 text-neon-cyan/80',
              )}
            >
              {order.source}
            </span>

            <span className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                disabled={actingId !== null}
                onClick={() => void act(order, 'APPROVED')}
                className="flex items-center gap-1 rounded border border-neon-green/40 bg-neon-green/10 px-2 py-1 text-[9px] font-semibold tracking-wider text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-40"
              >
                <ShieldCheck className="size-3" /> [ APPROVE TRANSACTION ]
              </button>
              <button
                type="button"
                disabled={actingId !== null}
                onClick={() => void act(order, 'DENIED')}
                className="flex items-center gap-1 rounded border border-neon-red/40 bg-neon-red/10 px-2 py-1 text-[9px] font-semibold tracking-wider text-neon-red transition-colors hover:bg-neon-red/20 disabled:opacity-40"
              >
                <ShieldX className="size-3" /> [ DENY TRANSACTION ]
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
